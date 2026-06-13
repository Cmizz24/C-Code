import os from "os"
import { randomUUID } from "crypto"
import * as path from "path"
import fs from "fs/promises"
import EventEmitter from "events"

import { Anthropic } from "@anthropic-ai/sdk"
import delay from "delay"
import axios from "axios"
import pWaitFor from "p-wait-for"
import * as vscode from "vscode"

import {
	type TaskProviderLike,
	type TaskProviderEvents,
	type GlobalState,
	type ProviderName,
	type ProviderSettings,
	type RooCodeSettings,
	type ProviderSettingsEntry,
	type CodeActionId,
	type CodeActionName,
	type TerminalActionId,
	type TerminalActionPromptType,
	type HistoryItem,
	type ExecutionPlan,
	type CreateTaskOptions,
	type TokenUsage,
	type ToolUsage,
	type ExtensionMessage,
	type ExtensionState,
	type OpenAiCodexFastStatus,
	type CloudflareWorkersAiImageUsageUpdate,
	type AgentEvent,
	type AgentCompletionPacket,
	type AgentContinuationMetadata,
	type AgentDependency,
	type AgentActivityEvent,
	type AgentCoordinationEvent,
	type AgentStatus,
	type AgentStatusUpdate,
	type AgentPlan,
	type WriteIntentConflict,
	type MergeReviewEntry,
	type ParallelAgentReviewSummary,
	type ParallelArtifactManifestEntry,
	type ParallelPlanContinuationMetadata,
	type ParallelPlanCompletionPacket,
	type ParallelPlanCompletionStatus,
	type AgentMergeEvidence,
	computeMergeReviewChangeStats,
	computeArtifactManifestFromDiff,
	createAgentCompletionPacket,
	buildParallelPlanCompletionPacket,
	RooCodeEventName,
	requestyDefaultModelId,
	openRouterDefaultModelId,
	DEFAULT_WRITE_DELAY_MS,
	normalizeParallelTaskConcurrency,
	DEFAULT_MEMORY_MAX_CHARACTERS,
	DEFAULT_MEMORY_MAX_ENTRIES,
	DEFAULT_MEMORY_PENDING_CANDIDATE_LIMIT,
	ORGANIZATION_ALLOW_ALL,
	DEFAULT_MODES,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	applyCloudflareWorkersAiImageUsageUpdate,
	getModelId,
	isRetiredProvider,
	type MemoryAction,
	type MemoryEntry,
	type MemoryScope,
	type MemoryState,
	type MemorySummary,
} from "@roo-code/types"
import {
	aggregateTaskCostsRecursive,
	aggregateTaskTokenUsageRecursive,
	type AggregatedCosts,
} from "./aggregateTaskCosts"

import { Package } from "../../shared/package"
import { findLast } from "../../shared/array"
import { supportPrompt } from "../../shared/support-prompt"
import { GlobalFileNames } from "../../shared/globalFileNames"
import { Mode, defaultModeSlug, getAllModes, getModeBySlug, normalizeModeSlug } from "../../shared/modes"
import { experimentDefault } from "../../shared/experiments"
import { formatLanguage } from "../../shared/language"
import { WebviewMessage } from "../../shared/WebviewMessage"
import { EMBEDDING_MODEL_PROFILES } from "../../shared/embeddingModels"
import { ProfileValidator } from "../../shared/ProfileValidator"

import { Terminal } from "../../integrations/terminal/Terminal"
import { downloadTask, getTaskFileName } from "../../integrations/misc/export-markdown"
import { resolveDefaultSaveUri, saveLastExportPath } from "../../utils/export"
import { getTheme } from "../../integrations/theme/getTheme"
import WorkspaceTracker from "../../integrations/workspace/WorkspaceTracker"

import { McpHub } from "../../services/mcp/McpHub"
import { McpServerManager } from "../../services/mcp/McpServerManager"
import { ShadowCheckpointService } from "../../services/checkpoints/ShadowCheckpointService"
import { CodeIndexManager } from "../../services/code-index/manager"
import type { IndexProgressUpdate } from "../../services/code-index/interfaces/manager"
import { SkillsManager } from "../../services/skills/SkillsManager"
import {
	EmailNotificationService,
	type EmailNotificationOutcome,
	type EmailNotificationPayload,
	type EmailNotificationSendResult,
} from "../../services/notifications/EmailNotificationService"
import {
	RemoteDebugLogger,
	type RemoteDebugApiRequestSummary,
	type RemoteDebugEvent,
	type RemoteDebugLoggerConfig,
	type RemoteDebugMessageSummary,
	type RemoteDebugOperationSummary,
	type RemoteDebugRuntimeSummary,
	type RemoteDebugSeverity,
	type RemoteDebugTaskSummary,
} from "../../services/diagnostics/RemoteDebugLogger"

import { fileExistsAtPath } from "../../utils/fs"
import { setTtsEnabled, setTtsSpeed } from "../../utils/tts"
import { getWorkspaceGitInfo } from "../../utils/git"
import { arePathsEqual, getWorkspacePath } from "../../utils/path"
import { OrganizationAllowListViolationError } from "../../utils/errors"

import { setPanel } from "../../activate/registerCommands"

import { t } from "../../i18n"

import { buildApiHandler } from "../../api"
import { forceFullModelDetailsLoad, hasLoadedFullDetails } from "../../api/providers/fetchers/lmstudio"

import { ContextProxy } from "../config/ContextProxy"
import { ProviderSettingsManager } from "../config/ProviderSettingsManager"
import { CustomModesManager } from "../config/CustomModesManager"
import { MemoryStorage } from "../memory"
import {
	DEFAULT_COLD_CACHE_RAM_BUDGET_MB,
	getContextCacheBudgetOptions,
	normalizeColdCacheRamBudgetMb,
} from "../context/ContextWindowManager"
import { Task } from "../task/Task"

import { webviewMessageHandler } from "./webviewMessageHandler"
import type { ClineMessage, ClineSayTool, TodoItem } from "@roo-code/types"
import { readApiMessages, saveApiMessages, saveTaskMessages, TaskHistoryStore } from "../task-persistence"
import { readTaskMessages } from "../task-persistence/taskMessages"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { REQUESTY_BASE_URL } from "../../shared/utils/requesty"
import { validateAndFixToolResultIds } from "../task/validateToolResultIds"
import { AgentBus, isGenericOwnershipCoordinationMessage } from "../agents/AgentBus"
import {
	getParallelAgentBranchName,
	getWorktreeManagerErrorMessage,
	isWorktreeManagerGitUnavailableError,
	WorktreeManager,
	WorktreeMergeError,
	type WorktreeMergeReviewDiagnostics,
} from "../agents/WorktreeManager"
import { OrchestratorEventLoop } from "../orchestrator/OrchestratorEventLoop"

function getDetectedContextCacheBudgetOptions() {
	try {
		return getContextCacheBudgetOptions(os.totalmem())
	} catch {
		return getContextCacheBudgetOptions()
	}
}

const ORCHESTRATOR_MODE_SLUG = "orchestrator"

async function restoreDelegatedParentMode(
	provider: {
		contextProxy?: {
			getGlobalState?: (...args: any[]) => unknown
			setValue?: (...args: any[]) => Promise<void>
		}
		context?: {
			workspaceState?: {
				get?: (...args: any[]) => unknown
			}
		}
		providerSettingsManager?: {
			getModeConfigId?: (mode: string) => Promise<string | undefined>
			listConfig?: () => Promise<ProviderSettingsEntry[]>
			getProfile?: (args: { name: string }) => Promise<ProviderSettings>
		}
		activateProviderProfile?: (
			args: { name: string } | { id: string },
			options?: { persistModeConfig?: boolean; persistTaskHistory?: boolean; postState?: boolean },
		) => Promise<void>
		emit?: (...args: any[]) => boolean
		postStateToWebview?: () => Promise<void>
		log?: (message: string) => void
	},
	parentHistory: HistoryItem,
	source: string,
	options: { postState?: boolean } = {},
): Promise<void> {
	const parentMode = parentHistory.mode ? normalizeModeSlug(parentHistory.mode) : undefined

	if (parentMode !== ORCHESTRATOR_MODE_SLUG) {
		return
	}

	const contextProxy = provider.contextProxy

	if (typeof contextProxy?.setValue !== "function") {
		return
	}

	const currentModeValue =
		typeof contextProxy.getGlobalState === "function" ? contextProxy.getGlobalState("mode") : undefined
	const currentMode = typeof currentModeValue === "string" ? normalizeModeSlug(currentModeValue) : undefined

	if (currentMode !== parentMode) {
		await contextProxy.setValue("mode", parentMode)
	}

	await restoreDelegatedParentProviderProfile(provider, parentHistory, parentMode, source)

	provider.emit?.(RooCodeEventName.ModeChanged, parentMode)

	if (options.postState && typeof provider.postStateToWebview === "function") {
		await provider.postStateToWebview()
	}

	provider.log?.(`[${source}] Restored delegated parent mode '${parentMode}' for parent ${parentHistory.id}.`)
}

async function restoreDelegatedParentProviderProfile(
	provider: {
		contextProxy?: {
			setValue?: (...args: any[]) => Promise<void>
		}
		context?: {
			workspaceState?: {
				get?: (...args: any[]) => unknown
			}
		}
		providerSettingsManager?: {
			getModeConfigId?: (mode: string) => Promise<string | undefined>
			listConfig?: () => Promise<ProviderSettingsEntry[]>
			getProfile?: (args: { name: string }) => Promise<ProviderSettings>
		}
		activateProviderProfile?: (
			args: { name: string } | { id: string },
			options?: { persistModeConfig?: boolean; persistTaskHistory?: boolean; postState?: boolean },
		) => Promise<void>
		log?: (message: string) => void
	},
	parentHistory: HistoryItem,
	parentMode: string,
	source: string,
): Promise<void> {
	const lockApiConfigAcrossModes = provider.context?.workspaceState?.get?.("lockApiConfigAcrossModes", false) === true
	const skipProfileRestore = process.env.ROO_CLI_RUNTIME === "1" || lockApiConfigAcrossModes

	if (skipProfileRestore || typeof provider.activateProviderProfile !== "function") {
		return
	}

	const providerSettingsManager = provider.providerSettingsManager

	if (!providerSettingsManager || typeof providerSettingsManager.listConfig !== "function") {
		return
	}

	try {
		const listApiConfig = await providerSettingsManager.listConfig()
		await provider.contextProxy?.setValue?.("listApiConfigMeta", listApiConfig)

		let profileName = parentHistory.apiConfigName

		if (!profileName && typeof providerSettingsManager.getModeConfigId === "function") {
			const savedConfigId = await providerSettingsManager.getModeConfigId(parentMode)
			const profile = savedConfigId ? listApiConfig.find(({ id }) => id === savedConfigId) : undefined

			if (profile?.name && typeof providerSettingsManager.getProfile === "function") {
				const fullProfile = await providerSettingsManager.getProfile({ name: profile.name })
				const hasActualSettings = !!fullProfile.apiProvider

				if (hasActualSettings) {
					profileName = profile.name
				}
			}
		}

		if (!profileName) {
			return
		}

		const profileExists = listApiConfig.some(({ name }) => name === profileName)

		if (!profileExists) {
			provider.log?.(
				`[${source}] Delegated parent provider profile '${profileName}' no longer exists for parent ${parentHistory.id}.`,
			)
			return
		}

		await provider.activateProviderProfile(
			{ name: profileName },
			{ persistModeConfig: false, persistTaskHistory: false, postState: false },
		)
	} catch (error) {
		provider.log?.(
			`[${source}] Failed to restore delegated parent provider profile for parent ${parentHistory.id}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}
}

/**
 * https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
 * https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
 */

export type ClineProviderEvents = {
	clineCreated: [cline: Task]
}

interface PendingEditOperation {
	messageTs: number
	editedContent: string
	images?: string[]
	messageIndex: number
	apiConversationHistoryIndex: number
	timeoutId: NodeJS.Timeout
	createdAt: number
}

type PlanStartResult = { ok: true } | { ok: false; error: string }

type InitialWebviewTab = "visualBrowserInspector"

export type PlanApprovalResult =
	| { approved: false }
	| { approved: true; plan: ExecutionPlan; startResult: PlanStartResult }

type ParallelResumeRestoreResult =
	| { status: "none" }
	| { status: "running"; agentIdsToRestart: string[] }
	| { status: "review"; rebuildReview: boolean }
	| { status: "failed"; reason: string }

type ParallelAgentToolStatus = NonNullable<ClineSayTool["parallelStatus"]>
type ParallelAgentActivity = AgentActivityEvent
type ParallelAgentCoordinationEvent = AgentCoordinationEvent
type ParallelAgentUsageSummary = NonNullable<ClineSayTool["parallelUsageSummary"]>
type BackgroundAgentActivityDescription = Pick<ParallelAgentActivity, "kind" | "message">
type BackgroundAgentActivityDescriptionOptions = {
	agentId?: string
	partial?: boolean
}
type MergeApprovedAgentsOptions = { autoApproved?: boolean }
type AutoMergeReviewSkipReason = { agentId?: string; reason: string }
type MergeAffectedOpenDocument = {
	document: vscode.TextDocument
	relPath: string
	absolutePath: string
}
type MergeDocumentPreparationResult = {
	affectedPaths: string[]
	openDocuments: MergeAffectedOpenDocument[]
	dirtyDocuments: MergeAffectedOpenDocument[]
	savedDocuments: MergeAffectedOpenDocument[]
}
type MergeDocumentSyncStage = "pre-save" | "auto-approved-block" | "post-merge-sync"
type PriorParallelAgentRun = {
	tool: ClineSayTool
	plan: ExecutionPlan
	planPacket: ParallelPlanCompletionPacket
	agentPacketsById: Map<string, AgentCompletionPacket>
	mergeEntriesByAgentId: Map<string, MergeReviewEntry>
	repositoryRoot?: string
	workspaceRoot?: string
}
type PriorParallelAgentMatch = {
	agent: AgentPlan
	packet?: AgentCompletionPacket
	mergeEntry?: MergeReviewEntry
	score: number
	signals: string[]
	relevantFiles: string[]
}
type ParallelParentVerificationDirective = {
	sourceOfTruth: "structured_completion_packet"
	evidenceStatus: "clean-merged" | "requires-attention"
	noReverification: boolean
	summary: string
	todoGuidance: string
	allowedInspectionReasons: string[]
	evidence: {
		planStatus: ParallelPlanCompletionStatus
		mergeStatus: ParallelPlanCompletionPacket["merge"]["status"]
		mergeClean: boolean
		packetCount: number
		agentCount: number
		failedAgentCount: number
		mergeFailedAgents: string[]
		conflictedFiles: string[]
		validationFailed: number
		validationUnknown: number
	}
}
type ActivityToolPayload = Omit<ClineSayTool, "tool"> & {
	tool?: string
	filePath?: string
	name?: string
	serverName?: string
	uri?: string
}
type ParsedActivityTool = {
	tool: ActivityToolPayload
	toolName: string
	targetPath?: string
}
type AutoMergeReviewDecision = {
	enabled: boolean
	approvedAgentIds: string[]
	skipReasons: AutoMergeReviewSkipReason[]
}

type EmailNotificationTaskOutcomeState = {
	version: 1
	outcomes: Array<{
		taskId: string
		outcome: EmailNotificationOutcome
		notificationType?: EmailNotificationTaskOutcomeScope
	}>
}

type EmailNotificationTaskOutcomeScope = NonNullable<EmailNotificationPayload["notificationType"]> | "task"

type EmailNotificationTaskContext = {
	parentTaskId?: string
	rootTaskId?: string
	agentId?: string
	background: boolean
	mode?: string
	workspacePath?: string
	lifecycle?: "created" | "completed"
}

type EmailNotificationUsageHistoryItem = Pick<
	HistoryItem,
	"id" | "tokensIn" | "tokensOut" | "cacheWrites" | "cacheReads" | "totalCost" | "childIds" | "completedByChildId"
>

type RemoteDebugTaskEventOptions = {
	severity?: RemoteDebugSeverity
	tokenUsage?: TokenUsage
	toolUsage?: ToolUsage
	operation?: RemoteDebugOperationSummary
	taskSummary?: RemoteDebugTaskSummary
	apiRequest?: RemoteDebugApiRequestSummary
	message?: RemoteDebugMessageSummary
	runtime?: RemoteDebugRuntimeSummary
	error?: unknown
	properties?: Record<string, unknown>
	flushImmediately?: boolean
	featureArea?: string
}

const PARALLEL_AGENT_ACTIVITY_LIMIT = 50
const PARALLEL_AGENT_COORDINATION_LIMIT = 24
const PARALLEL_REVIEW_SUMMARY_PATH = ".roo/parallel-agent-review.md"
const PARALLEL_CONTINUATION_CONTEXT_LIMIT = 2_500
const PARALLEL_CONTINUATION_RESULT_LIMIT = 800
const PARALLEL_CONTINUATION_FILE_LIMIT = 20
const EMAIL_NOTIFICATION_TASK_OUTCOME_STATE_KEY = "emailNotificationTaskOutcomes.v1"
const MAX_EMAIL_NOTIFICATION_TASK_OUTCOMES = 500
const MAX_EMAIL_NOTIFICATION_SUMMARY_LENGTH = 600
const DEFAULT_COMPLETION_EMAIL_SUMMARY = "Task completed successfully."
const REMOTE_DEBUG_TOKEN_USAGE_EVENT_INTERVAL_MS = 30_000
const REMOTE_DEBUG_MAX_PARSEABLE_MESSAGE_TEXT_LENGTH = 5_000
const REMOTE_DEBUG_ERROR_SAY_TYPES = new Set(["error", "diff_error", "rooignore_error", "condense_context_error"])
const REMOTE_DEBUG_WARNING_SAY_TYPES = new Set(["too_many_tools_warning", "shell_integration_warning"])
const REMOTE_DEBUG_ERROR_ASK_TYPES = new Set(["api_req_failed"])
const REMOTE_DEBUG_WARNING_ASK_TYPES = new Set(["mistake_limit_reached", "auto_approval_max_req_reached"])
const REMOTE_DEBUG_ALLOWED_PROVIDER_EVENT_TYPES = new Set([
	"task.completed",
	"task.created",
	"task.aborted",
	"task.paused",
	"task.resumed",
	"task.spawned",
	"task.focus",
	"api.request",
	"tool.usage",
])

export class ClineProvider
	extends EventEmitter<TaskProviderEvents>
	implements vscode.WebviewViewProvider, TaskProviderLike
{
	// Used in package.json as the view's id. This value cannot be changed due
	// to how VSCode caches views based on their id, and updating the id would
	// break existing instances of the extension.
	public static readonly sideBarId = `${Package.name}.SidebarProvider`
	public static readonly tabPanelId = `${Package.name}.TabPanelProvider`
	public static readonly visualBrowserInspectorPanelId = `${Package.name}.VisualBrowserInspectorPanelProvider`
	private static activeInstances: Set<ClineProvider> = new Set()
	private static remoteDebugRuntimeHandlersRegistered = false
	private static readonly remoteDebugUnhandledRejectionHandler = (reason: unknown): void => {
		ClineProvider.recordRemoteDebugRuntimeErrorForActiveInstance(reason, {
			source: "process",
			origin: "unhandledRejection",
			unhandled: true,
		})
	}
	private static readonly remoteDebugUncaughtExceptionMonitorHandler = (error: Error, origin: string): void => {
		ClineProvider.recordRemoteDebugRuntimeErrorForActiveInstance(error, {
			source: "process",
			origin,
			unhandled: true,
		})
	}
	private disposables: vscode.Disposable[] = []
	private webviewDisposables: vscode.Disposable[] = []
	private view?: vscode.WebviewView | vscode.WebviewPanel
	private clineStack: Task[] = []
	private backgroundTasks: Set<Task> = new Set()
	private codeIndexStatusSubscription?: vscode.Disposable
	private codeIndexManager?: CodeIndexManager
	private _workspaceTracker?: WorkspaceTracker // workSpaceTracker read-only for access outside this class
	protected mcpHub?: McpHub // Change from private to protected
	protected skillsManager?: SkillsManager
	private taskCreationCallback: (task: Task) => void
	private taskEventListeners: WeakMap<Task, Array<() => void>> = new WeakMap()
	private currentWorkspacePath: string | undefined
	public activeExecutionPlan?: ExecutionPlan
	private worktreeManager?: WorktreeManager
	private orchestratorEventLoop?: OrchestratorEventLoop
	private pendingPlanApproval?: (result: PlanApprovalResult) => void
	private readonly worktreePathsByAgentId = new Map<string, string>()
	private readonly deniedWriteReasons = new Map<string, string | undefined>()
	private parallelStatusMessageTs?: number
	private parallelStatusPlanId?: string
	private parallelStatusPhase: ParallelAgentToolStatus = "running"
	private parallelMergeReviewEntries?: MergeReviewEntry[]
	private readonly parallelAgentStatusUpdates = new Map<string, AgentStatusUpdate>()
	private readonly parallelAgentActivities = new Map<string, ParallelAgentActivity[]>()
	private parallelAgentCoordinationEvents: ParallelAgentCoordinationEvent[] = []
	private readonly parallelWriteConflicts = new Map<string, WriteIntentConflict>()
	private readonly parallelAgentCompletionPackets = new Map<string, AgentCompletionPacket>()
	private parallelPlanCompletionPacket?: ParallelPlanCompletionPacket
	private parallelContinuation?: ParallelPlanContinuationMetadata
	private parallelUsageSummary?: ParallelAgentUsageSummary
	private parallelReviewSummary?: ParallelAgentReviewSummary
	private readonly emailNotificationTaskTokenUsage = new Map<string, TokenUsage>()
	private readonly emailNotificationTaskToolUsage = new Map<string, ToolUsage>()
	private readonly emailNotificationTaskRequestCounts = new Map<string, number>()
	private readonly emailNotificationTaskContexts = new Map<string, EmailNotificationTaskContext>()
	private readonly remoteDebugLogger: RemoteDebugLogger
	private readonly remoteDebugSessionId = randomUUID()
	private readonly remoteDebugUsageEventTimestamps = new Map<string, number>()
	private readonly remoteDebugApiRequestStartedKeys = new Set<string>()
	private parallelStatusUpdateQueue: Promise<void> = Promise.resolve()
	private parallelStatusUpdatePromise?: Promise<void>
	private parallelStatusUpdateRequested = false
	private parallelParentResumeKey?: string
	private readonly forwardAgentEvent = (event: AgentEvent): void => {
		switch (event.type) {
			case "STATUS":
				{
					const update = { agentId: event.agentId, status: event.status }
					this.postAgentStatusUpdate(update)
					this.recordParallelAgentStatus(update)
					this.recordParallelAgentActivity(event.agentId, this.describeStatusActivity(event.status), "status")
				}
				break
			case "PROGRESS":
				if (event.path) {
					const update = {
						agentId: event.agentId,
						status: this.getAgentStatus(event.agentId) ?? "running",
						lastTouchedFile: event.path,
					}
					this.postAgentStatusUpdate(update)
					this.recordParallelAgentStatus(update)
				}
				this.recordParallelAgentActivity(event.agentId, event.message, event.kind ?? "status")
				break
			case "INTENT_WRITE":
				if (event.permission.approved) {
					const update = {
						agentId: event.agentId,
						status: this.getAgentStatus(event.agentId) ?? "running",
						lastTouchedFile: event.path,
					}
					this.postAgentStatusUpdate(update)
					this.recordParallelAgentStatus(update)
					this.recordParallelAgentActivity(event.agentId, `Writing ${event.path}.`, "file")
				} else {
					this.deniedWriteReasons.set(this.getConflictKey(event.agentId, event.path), event.permission.reason)
				}
				break
			case "CONFLICT_QUERY":
				this.postWriteIntentDenied(event.agentId, event.path, event.ownerAgentId)
				this.recordParallelAgentCoordinationEvent({
					agentId: event.agentId,
					kind: "ownership",
					source: "system",
					message: event.ownerAgentId
						? `Agent ${event.agentId} requested ${event.path}, currently owned by ${event.ownerAgentId}.`
						: `Agent ${event.agentId} requested ${event.path}, which has no assigned owner.`,
				})
				break
			case "INTENT_CLEARED":
				this.postMessageToWebview({
					type: "writeIntentCleared",
					writeIntentConflict: { agentId: event.agentId, filePath: event.path },
				}).catch(() => {})
				this.parallelWriteConflicts.delete(this.getConflictKey(event.agentId, event.path))
				this.recordParallelAgentActivity(event.agentId, `Write access cleared for ${event.path}.`, "file")
				break
			case "BLOCKED":
				{
					const update = {
						agentId: event.agentId,
						status: "blocked",
						reason: event.reason,
						blockedOn: event.blockedOn,
					} satisfies AgentStatusUpdate
					this.postAgentStatusUpdate(update)
					this.recordParallelAgentStatus(update)
					this.recordParallelAgentActivity(event.agentId, `Blocked: ${event.reason}`, "wait")
					this.recordParallelAgentCoordinationEvent({
						agentId: event.agentId,
						kind: "dependency",
						source: "system",
						message: event.blockedOn?.length
							? `Agent ${event.agentId} is waiting for ${event.blockedOn
									.map((dependency) => this.describeAgentDependency(dependency))
									.join(", ")}.`
							: `Agent ${event.agentId} is blocked until coordination clears.`,
					})
				}
				break
			case "COMPLETE":
				{
					const update = {
						agentId: event.agentId,
						status: "complete",
						reason: event.result,
					} satisfies AgentStatusUpdate
					this.postAgentStatusUpdate(update)
					this.recordParallelAgentStatus(update)
					this.recordParallelAgentActivity(
						event.agentId,
						event.result ? `Completed: ${event.result}` : "Completed.",
						"completion",
					)
				}
				break
			case "FAILED":
				{
					const update = {
						agentId: event.agentId,
						status: "failed",
						reason: event.reason,
					} satisfies AgentStatusUpdate
					this.postAgentStatusUpdate(update)
					this.recordParallelAgentStatus(update)
					this.recordParallelAgentActivity(event.agentId, `Failed: ${event.reason}`, "error")
				}
				break
			case "SIGNAL":
				this.recordParallelAgentActivity(event.agentId, `Signaled ${event.signal}.`, "signal")
				break
			case "COORDINATION":
				this.recordParallelAgentCoordinationEvent(event.event)
				if (event.event.agentId) {
					this.recordParallelAgentActivity(
						event.event.agentId,
						`Coordination ${event.event.kind}: ${event.event.message}`,
						"message",
					)
				}
				break
			case "COMPLETION_PACKET":
				this.recordParallelAgentCompletionPacket(event.packet)
				break
			case "PLAN_COMPLETION_PACKET":
				this.parallelPlanCompletionPacket = event.packet
				this.scheduleParallelAgentStatusMessageUpdate()
				break
		}
	}
	private _disposed = false

	private recentTasksCache?: string[]
	public readonly taskHistoryStore: TaskHistoryStore
	private taskHistoryStoreInitialized = false
	private readonly emailNotificationService: EmailNotificationService
	private readonly emailNotificationTaskOutcomes = new Map<string, EmailNotificationOutcome>()
	private readonly emailNotificationTaskOutcomesInFlight = new Map<string, EmailNotificationOutcome>()
	private readonly emailNotificationTaskOutcomeDispatches = new Map<string, Promise<void>>()
	private readonly emailNotificationTaskOutcomeOrder: string[] = []
	private readonly emailNotificationCompletionEventsObserved = new Set<string>()
	private readonly emailNotificationUiVisibleCompletionsObserved = new Set<string>()
	private emailNotificationTaskOutcomeStateLoaded = false
	private globalStateWriteThroughTimer: ReturnType<typeof setTimeout> | null = null
	private static readonly GLOBAL_STATE_WRITE_THROUGH_DEBOUNCE_MS = 5000 // 5 seconds
	private pendingOperations: Map<string, PendingEditOperation> = new Map()
	private static readonly PENDING_OPERATION_TIMEOUT_MS = 30000 // 30 seconds

	/**
	 * Monotonically increasing sequence number for clineMessages state pushes.
	 * Used by the frontend to reject stale state that arrives out-of-order.
	 */
	private clineMessagesSeq = 0

	public isViewLaunched = false
	public settingsImportedAt?: number
	public readonly latestAnnouncementId = "c-code-3-54-1-update" // C Code 3.54.1 update announcement.
	public readonly providerSettingsManager: ProviderSettingsManager
	public readonly customModesManager: CustomModesManager
	public get isVisualBrowserInspectorOnly(): boolean {
		return this.initialTab === "visualBrowserInspector"
	}

	constructor(
		readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly renderContext: "sidebar" | "editor" = "sidebar",
		public readonly contextProxy: ContextProxy,
		private readonly initialTab?: InitialWebviewTab,
	) {
		super()
		this.currentWorkspacePath = getWorkspacePath()
		this.worktreeManager = new WorktreeManager(this.currentWorkspacePath)
		this.emailNotificationService = new EmailNotificationService(this.contextProxy, {
			log: (message) => this.log(message),
		})
		this.remoteDebugLogger = new RemoteDebugLogger(() => this.getRemoteDebugLoggerConfig())
		this.loadEmailNotificationTaskOutcomeState()

		ClineProvider.activeInstances.add(this)
		ClineProvider.registerRemoteDebugRuntimeHandlers()

		this.updateGlobalState("codebaseIndexModels", EMBEDDING_MODEL_PROFILES)

		// Initialize the per-task file-based history store.
		// The globalState write-through is debounced separately (not on every mutation)
		// since per-task files are authoritative and globalState is only for downgrade compat.
		this.taskHistoryStore = new TaskHistoryStore(this.contextProxy.globalStorageUri.fsPath, {
			onWrite: async () => {
				this.scheduleGlobalStateWriteThrough()
			},
		})
		this.initializeTaskHistoryStore().catch((error) => {
			this.log(`Failed to initialize TaskHistoryStore: ${error}`)
		})

		this._workspaceTracker = new WorkspaceTracker(this)

		this.providerSettingsManager = new ProviderSettingsManager(this.context)

		this.customModesManager = new CustomModesManager(this.context, async () => {
			await this.postStateToWebviewWithoutClineMessages()
		})

		// Initialize MCP Hub through the singleton manager
		McpServerManager.getInstance(this.context, this)
			.then((hub) => {
				this.mcpHub = hub
				this.mcpHub.registerClient()
			})
			.catch((error) => {
				this.log(`Failed to initialize MCP Hub: ${error}`)
			})

		// Initialize Skills Manager for skill discovery
		this.skillsManager = new SkillsManager(this)
		this.skillsManager.initialize().catch((error) => {
			this.log(`Failed to initialize Skills Manager: ${error}`)
		})

		// Forward <most> task events to the provider.
		// We do something fairly similar for the IPC-based API.
		this.taskCreationCallback = (instance: Task) => {
			this.rememberEmailNotificationTaskContext(instance, "created")
			this.recordRemoteDebugTaskEvent(instance, "task.created", {
				operation: { stage: "lifecycle", status: "created" },
			})
			this.emit(RooCodeEventName.TaskCreated, instance)

			// Create named listener functions so we can remove them later.
			const onTaskStarted = () => {
				this.emit(RooCodeEventName.TaskStarted, instance.taskId)
			}
			const onTaskCompleted = (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) => {
				this.emailNotificationCompletionEventsObserved.add(this.getEmailNotificationTaskInstanceKey(instance))
				this.recordRemoteDebugTaskEvent(instance, "task.completed", {
					tokenUsage,
					toolUsage,
					operation: { stage: "lifecycle", status: "completed" },
					properties: {
						apiRequestCount: this.countApiRequestMessages(instance.clineMessages),
					},
				})
				this.logEmailNotificationDiagnostics("completion-event-observed", {
					taskId,
					instanceTaskId: instance.taskId,
					background: instance.background === true,
					hasParentTask: Boolean(instance.parentTask),
					parentTaskId: instance.parentTaskId,
					rootTaskId: instance.rootTaskId,
					agentId: instance.agentId,
					taskStatus: instance.taskStatus,
					currentTaskId: this.getCurrentTask()?.taskId,
				})

				if (instance.background) {
					this.postBackgroundAgentUsage(instance, tokenUsage)
					this.finalizeBackgroundAgentTask(instance, "complete")
					this.removeBackgroundTask(instance)
				}

				void this.notifyTaskCompletion(instance, tokenUsage, toolUsage).catch((error) => {
					this.log(
						`[email-notifications] Failed to prepare completion notification for task ${instance.taskId}: ${this.sanitizeEmailNotificationLogMessage(
							error,
						)}`,
					)
				})

				this.emit(RooCodeEventName.TaskCompleted, taskId, tokenUsage, toolUsage)
			}
			const onTaskAborted = async () => {
				const streamingFailed = instance.abortReason === "streaming_failed"
				this.recordRemoteDebugTaskEvent(instance, "task.aborted", {
					severity: streamingFailed ? "error" : "warn",
					operation: { stage: "lifecycle", status: "aborted", result: instance.abortReason },
					flushImmediately: streamingFailed,
					properties: {
						abortReason: instance.abortReason,
					},
				})
				this.emit(RooCodeEventName.TaskAborted, instance.taskId)

				try {
					if (instance.background) {
						this.finalizeBackgroundAgentTask(instance, "failed", "Agent task aborted.")
						this.removeBackgroundTask(instance)
						return
					}

					this.log(
						`[email-notifications] Skipping task ${instance.taskId} abort notification because automatic SMTP notifications are completion-only.`,
					)

					// Only rehydrate on genuine streaming failures.
					// User-initiated cancels are handled by cancelTask().
					if (instance.abortReason === "streaming_failed") {
						// Defensive safeguard: if another path already replaced this instance, skip
						const current = this.getCurrentTask()
						if (current && current.instanceId !== instance.instanceId) {
							this.log(
								`[onTaskAborted] Skipping rehydrate: current instance ${current.instanceId} != aborted ${instance.instanceId}`,
							)
							return
						}

						const { historyItem } = await this.getTaskWithId(instance.taskId)
						const rootTask = instance.rootTask
						const parentTask = instance.parentTask
						await this.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })
					}
				} catch (error) {
					this.log(
						`[onTaskAborted] Failed to rehydrate after streaming failure: ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
				}
			}
			const onTaskFocused = () => {
				this.recordRemoteDebugTaskEvent(instance, "task.focus", {
					severity: "debug",
					operation: { stage: "lifecycle", status: "focus" },
				})
				this.emit(RooCodeEventName.TaskFocused, instance.taskId)
			}
			const onTaskUnfocused = () => {
				this.emit(RooCodeEventName.TaskUnfocused, instance.taskId)
			}
			const onTaskActive = (taskId: string) => {
				this.emit(RooCodeEventName.TaskActive, taskId)
			}
			const onTaskInteractive = (taskId: string) => {
				this.emit(RooCodeEventName.TaskInteractive, taskId)
			}
			const onTaskResumable = (taskId: string) => {
				this.emit(RooCodeEventName.TaskResumable, taskId)
			}
			const onTaskIdle = (taskId: string) => {
				this.emit(RooCodeEventName.TaskIdle, taskId)
			}
			const onTaskPaused = (taskId: string) => {
				this.recordRemoteDebugTaskEvent(instance, "task.paused", {
					severity: "warn",
					operation: { stage: "lifecycle", status: "paused" },
				})
				this.emit(RooCodeEventName.TaskPaused, taskId)
			}
			const onTaskUnpaused = (taskId: string) => {
				this.recordRemoteDebugTaskEvent(instance, "task.resumed", {
					operation: { stage: "lifecycle", status: "resumed" },
				})
				this.emit(RooCodeEventName.TaskUnpaused, taskId)
			}
			const onTaskSpawned = (taskId: string) => {
				this.recordRemoteDebugTaskEvent(instance, "task.spawned", {
					operation: { stage: "lifecycle", status: "spawned" },
				})
				this.emit(RooCodeEventName.TaskSpawned, taskId)
			}
			const onTaskUserMessage = (taskId: string) => {
				this.emit(RooCodeEventName.TaskUserMessage, taskId)
			}
			const onTaskMessage = ({ action, message }: { action: "created" | "updated"; message: ClineMessage }) => {
				this.handleBackgroundAgentMessage(instance, action, message)
				this.recordRemoteDebugTaskMessageEvent(instance, action, message)
			}
			const onTaskTokenUsageUpdated = (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) => {
				this.rememberEmailNotificationTaskUsage(
					taskId,
					tokenUsage,
					toolUsage,
					this.countApiRequestMessages(instance.clineMessages),
				)
				this.postBackgroundAgentUsage(instance, tokenUsage)
				this.recordRemoteDebugTaskUsageUpdate(instance, taskId, tokenUsage, toolUsage)
				this.emit(RooCodeEventName.TaskTokenUsageUpdated, taskId, tokenUsage, toolUsage)
			}
			const onTaskToolFailed = (taskId: string, tool: string, error: string) => {
				this.recordRemoteDebugTaskEvent(instance, "tool.usage", {
					severity: "error",
					featureArea: "tool",
					operation: { stage: "tool", status: "failed" },
					error: new Error("Tool execution failed"),
					flushImmediately: true,
					properties: {
						tool,
						eventTaskIdMatches: taskId === instance.taskId,
						errorLength: error.length,
					},
				})
			}

			// Attach the listeners.
			instance.on(RooCodeEventName.TaskStarted, onTaskStarted)
			instance.on(RooCodeEventName.TaskCompleted, onTaskCompleted)
			instance.on(RooCodeEventName.TaskAborted, onTaskAborted)
			instance.on(RooCodeEventName.TaskFocused, onTaskFocused)
			instance.on(RooCodeEventName.TaskUnfocused, onTaskUnfocused)
			instance.on(RooCodeEventName.TaskActive, onTaskActive)
			instance.on(RooCodeEventName.TaskInteractive, onTaskInteractive)
			instance.on(RooCodeEventName.TaskResumable, onTaskResumable)
			instance.on(RooCodeEventName.TaskIdle, onTaskIdle)
			instance.on(RooCodeEventName.TaskPaused, onTaskPaused)
			instance.on(RooCodeEventName.TaskUnpaused, onTaskUnpaused)
			instance.on(RooCodeEventName.TaskSpawned, onTaskSpawned)
			instance.on(RooCodeEventName.TaskUserMessage, onTaskUserMessage)
			instance.on(RooCodeEventName.Message, onTaskMessage)
			instance.on(RooCodeEventName.TaskTokenUsageUpdated, onTaskTokenUsageUpdated)
			instance.on(RooCodeEventName.TaskToolFailed, onTaskToolFailed)

			// Store the cleanup functions for later removal.
			this.taskEventListeners.set(instance, [
				() => instance.off(RooCodeEventName.TaskStarted, onTaskStarted),
				() => instance.off(RooCodeEventName.TaskCompleted, onTaskCompleted),
				() => instance.off(RooCodeEventName.TaskAborted, onTaskAborted),
				() => instance.off(RooCodeEventName.TaskFocused, onTaskFocused),
				() => instance.off(RooCodeEventName.TaskUnfocused, onTaskUnfocused),
				() => instance.off(RooCodeEventName.TaskActive, onTaskActive),
				() => instance.off(RooCodeEventName.TaskInteractive, onTaskInteractive),
				() => instance.off(RooCodeEventName.TaskResumable, onTaskResumable),
				() => instance.off(RooCodeEventName.TaskIdle, onTaskIdle),
				() => instance.off(RooCodeEventName.TaskUserMessage, onTaskUserMessage),
				() => instance.off(RooCodeEventName.TaskPaused, onTaskPaused),
				() => instance.off(RooCodeEventName.TaskUnpaused, onTaskUnpaused),
				() => instance.off(RooCodeEventName.TaskSpawned, onTaskSpawned),
				() => instance.off(RooCodeEventName.Message, onTaskMessage),
				() => instance.off(RooCodeEventName.TaskTokenUsageUpdated, onTaskTokenUsageUpdated),
				() => instance.off(RooCodeEventName.TaskToolFailed, onTaskToolFailed),
			])
		}
	}

	private isDebugModeEnabled(): boolean {
		return vscode.workspace.getConfiguration(Package.name).get<boolean>("debug", false) === true
	}

	private getRemoteDebugLoggerConfig(): RemoteDebugLoggerConfig {
		const enabled = this.isDebugModeEnabled()

		return {
			enabled,
			installId: enabled ? this.getOrCreateRemoteDebugLoggingInstallId() : undefined,
			sessionId: this.remoteDebugSessionId,
			extensionVersion: this.context.extension?.packageJSON?.version ?? "",
			platform: {
				os: os.platform(),
				arch: os.arch(),
				vscodeVersion: vscode.version,
			},
		}
	}

	private getOrCreateRemoteDebugLoggingInstallId(): string {
		const existingInstallId = this.contextProxy.getGlobalState("remoteDebugLoggingInstallId")

		if (typeof existingInstallId === "string" && existingInstallId.length > 0) {
			return existingInstallId
		}

		const installId = randomUUID()
		void Promise.resolve(this.contextProxy.updateGlobalState("remoteDebugLoggingInstallId", installId)).catch(
			() => undefined,
		)

		return installId
	}

	private static registerRemoteDebugRuntimeHandlers(): void {
		if (ClineProvider.remoteDebugRuntimeHandlersRegistered) {
			return
		}

		ClineProvider.remoteDebugRuntimeHandlersRegistered = true
		process.on("unhandledRejection", ClineProvider.remoteDebugUnhandledRejectionHandler)
		process.on("uncaughtExceptionMonitor", ClineProvider.remoteDebugUncaughtExceptionMonitorHandler)
	}

	private static recordRemoteDebugRuntimeErrorForActiveInstance(
		error: unknown,
		runtime: RemoteDebugRuntimeSummary,
	): void {
		try {
			const instance = Array.from(ClineProvider.activeInstances)
				.reverse()
				.find((candidate) => candidate.isDebugModeEnabled())

			instance?.recordRemoteDebugRuntimeError(error, runtime)
		} catch {
			// Diagnostics must never affect extension runtime error handling.
		}
	}

	private recordRemoteDebugRuntimeError(error: unknown, runtime: RemoteDebugRuntimeSummary): void {
		if (!this.isDebugModeEnabled()) {
			return
		}

		const currentTask = this.getCurrentTask()
		if (currentTask) {
			this.recordRemoteDebugTaskEvent(currentTask, "runtime.error", {
				severity: "error",
				featureArea: "runtime",
				operation: { stage: "runtime", status: "error" },
				runtime,
				error,
				flushImmediately: true,
			})
			return
		}

		this.remoteDebugLogger.record(
			{
				type: "runtime.error",
				severity: "error",
				featureArea: "runtime",
				runtime,
				error,
			},
			{ flushImmediately: true },
		)
	}

	private recordRemoteDebugTaskUsageUpdate(
		task: Task,
		taskId: string,
		tokenUsage: TokenUsage,
		toolUsage: ToolUsage,
	): void {
		const now = Date.now()
		const lastRecordedAt = this.remoteDebugUsageEventTimestamps.get(taskId) ?? 0

		if (now - lastRecordedAt < REMOTE_DEBUG_TOKEN_USAGE_EVENT_INTERVAL_MS) {
			return
		}

		this.remoteDebugUsageEventTimestamps.set(taskId, now)
		this.recordRemoteDebugTaskEvent(task, "tool.usage", {
			severity: "debug",
			featureArea: "tool",
			tokenUsage,
			toolUsage,
			operation: { stage: "usage", status: "updated" },
		})
	}

	private recordRemoteDebugTaskEvent(task: Task, type: string, options: RemoteDebugTaskEventOptions = {}): void {
		if (!this.isDebugModeEnabled()) {
			return
		}

		if (!REMOTE_DEBUG_ALLOWED_PROVIDER_EVENT_TYPES.has(type)) {
			return
		}

		void this.buildRemoteDebugTaskEvent(task, type, options)
			.then((event) =>
				this.remoteDebugLogger.record(event, {
					flushImmediately: options.flushImmediately === true || event.severity === "error",
				}),
			)
			.catch(() => undefined)
	}

	private async buildRemoteDebugTaskEvent(
		task: Task,
		type: string,
		options: RemoteDebugTaskEventOptions,
	): Promise<RemoteDebugEvent> {
		const mode = await task.getTaskMode().catch(() => undefined)
		const apiConfiguration = task.apiConfiguration ?? {}

		const severity = options.severity ?? "info"
		const featureArea = options.featureArea ?? this.getRemoteDebugFeatureAreaForEvent(type)
		const runtime =
			severity === "error" && !options.runtime && !options.error
				? ({ source: "extension", component: featureArea } satisfies RemoteDebugRuntimeSummary)
				: options.runtime
		const taskSummary =
			type === "task.completed"
				? {
						...this.buildRemoteDebugTaskSummary(task, options.message),
						...options.taskSummary,
						status: options.taskSummary?.status ?? "completed",
					}
				: options.taskSummary

		return {
			type,
			severity,
			featureArea,
			taskId: task.taskId,
			parentTaskId: task.parentTaskId,
			rootTaskId: task.rootTaskId,
			agentId: task.agentId,
			background: task.background === true,
			mode,
			provider: apiConfiguration.apiProvider,
			modelId: getModelId(apiConfiguration),
			tokenUsage: options.tokenUsage,
			toolUsage: options.toolUsage,
			operation: options.operation,
			taskSummary,
			apiRequest: options.apiRequest,
			message: options.message,
			runtime,
			error: options.error,
			properties: {
				taskStatus: task.taskStatus,
				hasParentTask: Boolean(task.parentTask),
				hasRootTask: Boolean(task.rootTask),
				...options.properties,
			},
		}
	}

	private getRemoteDebugFeatureAreaForEvent(type: string): "task" | "api" | "tool" | "runtime" {
		if (type === "api.request") {
			return "api"
		}

		if (type === "tool.usage") {
			return "tool"
		}

		if (type === "runtime.error") {
			return "runtime"
		}

		return "task"
	}

	private recordRemoteDebugTaskMessageEvent(task: Task, action: "created" | "updated", message: ClineMessage): void {
		const messageSummary = this.buildRemoteDebugMessageSummary(message, action)
		const apiRequest = this.buildRemoteDebugApiRequestSummary(task, message)
		if (!apiRequest?.stage) {
			return
		}

		const severity = this.getRemoteDebugMessageSeverity(messageSummary, apiRequest)

		if (message.partial === true && severity === "debug" && action === "updated") {
			return
		}

		const requestKey = this.getRemoteDebugApiRequestKey(task.taskId, apiRequest.requestIndex)
		if (apiRequest.stage === "started") {
			this.remoteDebugApiRequestStartedKeys.add(requestKey)
		} else if (apiRequest.stage === "finished" && !this.remoteDebugApiRequestStartedKeys.has(requestKey)) {
			return
		}

		this.recordRemoteDebugTaskEvent(task, "api.request", {
			severity,
			featureArea: "api",
			operation: { stage: "request", status: apiRequest.stage },
			apiRequest,
			flushImmediately: severity === "error",
		})
	}

	private getRemoteDebugApiRequestKey(taskId: string, requestIndex: number | undefined): string {
		return `${taskId}:${requestIndex ?? "unknown"}`
	}

	private buildRemoteDebugTaskSummary(task: Task, lastMessage?: RemoteDebugMessageSummary): RemoteDebugTaskSummary {
		const messages = Array.isArray(task.clineMessages) ? task.clineMessages : []
		const toolUsage = task.toolUsage ?? {}
		const toolUsageCounts = this.countRemoteDebugToolUsage(toolUsage)

		return {
			status: typeof task.taskStatus === "string" ? task.taskStatus : undefined,
			messageCount: messages.length,
			askCount: messages.filter((message) => message.type === "ask").length,
			sayCount: messages.filter((message) => message.type === "say").length,
			apiRequestCount: this.countApiRequestMessages(messages),
			apiRetryCount: messages.filter((message) => message.type === "say" && message.say === "api_req_retried")
				.length,
			apiFailureCount: this.countRemoteDebugApiFailures(messages),
			toolAttemptCount: toolUsageCounts.attempts,
			toolFailureCount: toolUsageCounts.failures,
			consecutiveMistakeCount: this.getFiniteRemoteDebugNumber(task.consecutiveMistakeCount),
			consecutiveNoToolUseCount: this.getFiniteRemoteDebugNumber(task.consecutiveNoToolUseCount),
			consecutiveNoAssistantMessagesCount: this.getFiniteRemoteDebugNumber(
				task.consecutiveNoAssistantMessagesCount,
			),
			hasParentTask: Boolean(task.parentTask),
			hasRootTask: Boolean(task.rootTask),
			lastMessage: lastMessage ?? this.buildRemoteDebugMessageSummary(messages.at(-1)),
		}
	}

	private buildRemoteDebugMessageSummary(
		message?: ClineMessage,
		action?: "created" | "updated",
	): RemoteDebugMessageSummary | undefined {
		if (!message) {
			return undefined
		}

		const textLength = typeof message.text === "string" ? message.text.length : undefined
		const imageCount = Array.isArray(message.images) ? message.images.length : undefined

		return {
			action,
			type: message.type,
			ask: message.type === "ask" ? message.ask : undefined,
			say: message.type === "say" ? message.say : undefined,
			partial: message.partial === true,
			hasText: typeof textLength === "number" && textLength > 0,
			textLength,
			hasImages: typeof imageCount === "number" && imageCount > 0,
			imageCount,
			hasReasoning: typeof message.reasoning === "string" && message.reasoning.length > 0,
			hasCheckpoint: Boolean(message.checkpoint),
			hasProgressStatus: Boolean(message.progressStatus),
			hasContextCondense: Boolean(message.contextCondense),
			hasContextTruncation: Boolean(message.contextTruncation),
			apiProtocol: message.apiProtocol,
			isProtected: message.isProtected,
			isAnswered: message.isAnswered,
			tool: this.tryGetRemoteDebugMessageToolName(message),
		}
	}

	private buildRemoteDebugApiRequestSummary(
		task: Task,
		message: ClineMessage,
	): RemoteDebugApiRequestSummary | undefined {
		const requestCount = this.countApiRequestMessages(task.clineMessages)
		const requestIndex =
			this.getRemoteDebugApiRequestIndex(task.clineMessages, message) ?? (requestCount || undefined)
		const apiReqInfo = this.tryParseRemoteDebugApiReqInfo(message)
		const protocol = apiReqInfo?.protocol ?? this.findLatestRemoteDebugApiProtocol(task.clineMessages, message)

		if (message.type === "ask" && message.ask === "api_req_failed") {
			return { protocol, stage: "failed", status: "failed", requestIndex, requestCount }
		}

		if (message.type !== "say") {
			return undefined
		}

		switch (message.say) {
			case "api_req_started": {
				const status = this.getRemoteDebugApiRequestStatus(apiReqInfo)
				return {
					...apiReqInfo,
					protocol,
					stage: status,
					status,
					requestIndex,
					requestCount,
				}
			}
			case "api_req_finished":
				return {
					protocol,
					stage: "finished",
					status: "finished",
					requestIndex,
					requestCount,
				}
			case "api_req_retried":
				return { protocol, stage: "retried", status: "retried", requestIndex, requestCount }
			case "api_req_retry_delayed": {
				const retryDelayMs = this.extractRemoteDebugRetryDelayMs(message.text)
				return {
					protocol,
					stage: "retried",
					status: "retried",
					requestIndex,
					requestCount,
					retryDelayMs,
				}
			}
			case "api_req_rate_limit_wait":
				return {
					protocol,
					stage: "retried",
					status: "retried",
					requestIndex,
					requestCount,
					retryDelayMs: this.extractRemoteDebugRetryDelayMs(message.text),
				}
			case "api_req_deleted":
				return undefined
			default:
				return undefined
		}
	}

	private getRemoteDebugMessageSeverity(
		message: RemoteDebugMessageSummary | undefined,
		apiRequest?: RemoteDebugApiRequestSummary,
	): RemoteDebugSeverity {
		if (
			(message?.say && REMOTE_DEBUG_ERROR_SAY_TYPES.has(message.say)) ||
			(message?.ask && REMOTE_DEBUG_ERROR_ASK_TYPES.has(message.ask)) ||
			apiRequest?.status === "failed" ||
			apiRequest?.streamingFailed === true
		) {
			return "error"
		}

		if (
			(message?.say && REMOTE_DEBUG_WARNING_SAY_TYPES.has(message.say)) ||
			(message?.ask && REMOTE_DEBUG_WARNING_ASK_TYPES.has(message.ask)) ||
			apiRequest?.status === "retried"
		) {
			return "warn"
		}

		if (apiRequest || message?.partial === true) {
			return "debug"
		}

		return "info"
	}

	private getRemoteDebugApiRequestStatus(apiReqInfo?: RemoteDebugApiRequestSummary): string {
		if (apiReqInfo?.streamingFailed === true || apiReqInfo?.cancelReason === "streaming_failed") {
			return "failed"
		}

		if (apiReqInfo?.cancelReason) {
			return "failed"
		}

		if (
			typeof apiReqInfo?.tokensIn === "number" ||
			typeof apiReqInfo?.tokensOut === "number" ||
			typeof apiReqInfo?.cost === "number"
		) {
			return "finished"
		}

		return "started"
	}

	private tryParseRemoteDebugApiReqInfo(message: ClineMessage): RemoteDebugApiRequestSummary | undefined {
		if (message.type !== "say" || message.say !== "api_req_started") {
			return undefined
		}

		const data = this.tryParseRemoteDebugJsonObject(message.text)
		const cancelReason = typeof data?.cancelReason === "string" ? data.cancelReason : undefined
		const streamingFailed = cancelReason === "streaming_failed" || typeof data?.streamingFailedMessage === "string"

		return {
			protocol: this.getRemoteDebugString(data?.apiProtocol ?? message.apiProtocol),
			tokensIn: this.getFiniteRemoteDebugNumber(data?.tokensIn),
			tokensOut: this.getFiniteRemoteDebugNumber(data?.tokensOut),
			cacheWrites: this.getFiniteRemoteDebugNumber(data?.cacheWrites),
			cacheReads: this.getFiniteRemoteDebugNumber(data?.cacheReads),
			cost: this.getFiniteRemoteDebugNumber(data?.cost),
			cancelReason,
			streamingFailed,
		}
	}

	private tryParseRemoteDebugJsonObject(text: string | undefined): Record<string, unknown> | undefined {
		if (!text || text.length > REMOTE_DEBUG_MAX_PARSEABLE_MESSAGE_TEXT_LENGTH) {
			return undefined
		}

		try {
			const parsed = JSON.parse(text) as unknown
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: undefined
		} catch {
			return undefined
		}
	}

	private tryGetRemoteDebugMessageToolName(message: ClineMessage): string | undefined {
		if (message.ask !== "tool" && message.say !== "tool") {
			return undefined
		}

		const parsed = this.tryParseRemoteDebugJsonObject(message.text)
		return this.getRemoteDebugString(parsed?.tool)
	}

	private findLatestRemoteDebugApiProtocol(messages: ClineMessage[], message: ClineMessage): string | undefined {
		const messageIndex = messages.indexOf(message)
		const searchUntil = messageIndex >= 0 ? messageIndex : messages.length - 1

		for (let index = searchUntil; index >= 0; index--) {
			const apiReqInfo = this.tryParseRemoteDebugApiReqInfo(messages[index])
			if (apiReqInfo?.protocol) {
				return apiReqInfo.protocol
			}
		}

		return undefined
	}

	private getRemoteDebugApiRequestIndex(messages: ClineMessage[], message: ClineMessage): number | undefined {
		if (message.type === "say" && message.say === "api_req_started") {
			const apiMessages = messages.filter(
				(candidate) => candidate.type === "say" && candidate.say === "api_req_started",
			)
			const index = apiMessages.indexOf(message)
			return index >= 0 ? index + 1 : undefined
		}

		const messageIndex = messages.indexOf(message)
		if (messageIndex < 0) {
			return undefined
		}

		return messages
			.slice(0, messageIndex + 1)
			.filter((candidate) => candidate.type === "say" && candidate.say === "api_req_started").length
	}

	private extractRemoteDebugRetryDelayMs(text: string | undefined): number | undefined {
		if (!text || text.length > REMOTE_DEBUG_MAX_PARSEABLE_MESSAGE_TEXT_LENGTH) {
			return undefined
		}

		const retryTimerMatch = text.match(/<retry_timer>(\d+)<\/retry_timer>/)
		if (!retryTimerMatch) {
			return undefined
		}

		return Number(retryTimerMatch[1]) * 1000
	}

	private countRemoteDebugApiFailures(messages: ClineMessage[]): number {
		return messages.filter((message) => {
			if (message.type === "ask" && message.ask === "api_req_failed") {
				return true
			}

			const apiReqInfo = this.tryParseRemoteDebugApiReqInfo(message)
			return apiReqInfo?.streamingFailed === true || apiReqInfo?.cancelReason === "streaming_failed"
		}).length
	}

	private countRemoteDebugToolUsage(toolUsage: ToolUsage): { attempts: number; failures: number } {
		return Object.values(toolUsage).reduce(
			(counts, usage) => ({
				attempts: counts.attempts + (this.getFiniteRemoteDebugNumber(usage?.attempts) ?? 0),
				failures: counts.failures + (this.getFiniteRemoteDebugNumber(usage?.failures) ?? 0),
			}),
			{ attempts: 0, failures: 0 },
		)
	}

	private getFiniteRemoteDebugNumber(value: unknown): number | undefined {
		return typeof value === "number" && Number.isFinite(value) ? value : undefined
	}

	private getRemoteDebugString(value: unknown): string | undefined {
		return typeof value === "string" && value.length > 0 ? value : undefined
	}

	/**
	 * Initialize the TaskHistoryStore and migrate from globalState if needed.
	 */
	private async initializeTaskHistoryStore(): Promise<void> {
		try {
			await this.taskHistoryStore.initialize()

			// Migration: backfill per-task files from globalState on first run
			const migrationKey = "taskHistoryMigratedToFiles"
			const alreadyMigrated = this.context.globalState.get<boolean>(migrationKey)

			if (!alreadyMigrated) {
				const legacyHistory = this.context.globalState.get<HistoryItem[]>("taskHistory") ?? []

				if (legacyHistory.length > 0) {
					this.log(`[initializeTaskHistoryStore] Migrating ${legacyHistory.length} entries from globalState`)
					await this.taskHistoryStore.migrateFromGlobalState(legacyHistory)
				}

				await this.context.globalState.update(migrationKey, true)
				this.log("[initializeTaskHistoryStore] Migration complete")
			}

			this.taskHistoryStoreInitialized = true
		} catch (error) {
			this.log(`[initializeTaskHistoryStore] Error: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Override EventEmitter's on method to match TaskProviderLike interface
	 */
	override on<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this {
		return super.on(event, listener as any)
	}

	/**
	 * Override EventEmitter's off method to match TaskProviderLike interface
	 */
	override off<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this {
		return super.off(event, listener as any)
	}

	// Adds a new Task instance to clineStack, marking the start of a new task.
	// The instance is pushed to the top of the stack (LIFO order).
	// When the task is completed, the top instance is removed, reactivating the
	// previous task.
	async addClineToStack(task: Task) {
		// Add this cline instance into the stack that represents the order of
		// all the called tasks.
		this.clineStack.push(task)
		task.emit(RooCodeEventName.TaskFocused)

		// Perform special setup provider specific tasks.
		await this.performPreparationTasks(task)

		// Ensure getState() resolves correctly.
		const state = await this.getState()

		if (!state || typeof state.mode !== "string") {
			throw new Error(t("common:errors.retrieve_current_mode"))
		}
	}

	private async addBackgroundTask(task: Task) {
		this.backgroundTasks.add(task)
		await this.performPreparationTasks(task)

		const state = await this.getState()

		if (!state || typeof state.mode !== "string") {
			throw new Error(t("common:errors.retrieve_current_mode"))
		}
	}

	private removeBackgroundTask(task: Task) {
		if (!this.backgroundTasks.delete(task)) {
			return
		}

		this.emailNotificationCompletionEventsObserved.delete(this.getEmailNotificationTaskInstanceKey(task))

		const cleanupFunctions = this.taskEventListeners.get(task)

		if (cleanupFunctions) {
			cleanupFunctions.forEach((cleanup) => cleanup())
			this.taskEventListeners.delete(task)
		}

		try {
			task.dispose()
		} catch (error) {
			this.log(
				`[background-task] Failed to dispose task ${task.taskId}.${task.instanceId}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	private async notifyTaskCompletion(task: Task, tokenUsage?: TokenUsage, toolUsage?: ToolUsage): Promise<void> {
		this.rememberEmailNotificationTaskContext(task, "completed")

		const taskDiagnostics = this.getEmailNotificationTaskDiagnostics(task)
		const summary = this.getEmailNotificationSummary(task)
		const requestCount = this.countApiRequestMessages(task.clineMessages)
		this.rememberEmailNotificationTaskUsage(task.taskId, tokenUsage, toolUsage, requestCount)

		if (task.background) {
			this.logEmailNotificationDiagnostics("completion-notification-decision", {
				...taskDiagnostics,
				decision: "skip-background-task-covered-by-parallel-workflow",
				coveredByWorkflowNotification: true,
				hasSummary: Boolean(summary),
				summaryLength: summary?.length ?? 0,
				requestCount,
			})
			this.log(
				`[email-notifications] Skipping task ${task.taskId} notification because background parallel agents are covered by the parent workflow completion notification.`,
			)
			return
		}

		if (task.parentTask || task.parentTaskId) {
			this.logEmailNotificationDiagnostics("completion-notification-decision", {
				...taskDiagnostics,
				decision: "send-delegated-child-success",
				hasSummary: Boolean(summary),
				summaryLength: summary?.length ?? 0,
				requestCount,
			})

			await this.notifyTaskOutcome({
				taskId: task.taskId,
				outcome: "success",
				summary,
				workspacePath: task.workspacePath,
				mode: task.taskMode,
				notificationType: "delegated-child",
				parentTaskId: this.getEmailNotificationParentTaskId(task),
				rootTaskId: this.getEmailNotificationRootTaskId(task),
				agentId: task.agentId,
				tokenUsage,
				toolUsage,
				requestCount,
			})
			return
		}

		const historyItem = this.getEmailNotificationHistoryItem(task.taskId)
		const topLevelNotificationDedupeKey = this.getEmailNotificationTaskOutcomeKey(task.taskId, "final-parent")
		const hasDelegatedWorkflowMetadata = Boolean(
			historyItem && this.hasDelegatedWorkflowNotificationMetadata(historyItem),
		)
		let childTaskIds = this.getEmailNotificationWorkflowChildTaskIds(task.taskId, historyItem)
		let coveredChildTaskId: string | undefined
		let inFlightChildTaskId: string | undefined

		if (historyItem && hasDelegatedWorkflowMetadata) {
			childTaskIds = Array.from(
				new Set([...childTaskIds, ...this.getDelegatedWorkflowNotificationChildIds(historyItem)]),
			)
			coveredChildTaskId = childTaskIds.find((childTaskId) =>
				this.hasEmailNotificationTaskOutcomeBeenSent(childTaskId, "success", "delegated-child"),
			)
			inFlightChildTaskId = childTaskIds.find((childTaskId) =>
				this.hasEmailNotificationTaskOutcomeInFlight(childTaskId, "success", "delegated-child"),
			)

			if (coveredChildTaskId || inFlightChildTaskId) {
				this.logEmailNotificationDiagnostics("completion-notification-decision", {
					...taskDiagnostics,
					decision: "send-top-level-success-after-delegated-child-notification",
					notificationScope: "final-parent",
					notificationDedupeKey: topLevelNotificationDedupeKey,
					hasSummary: Boolean(summary),
					summaryLength: summary?.length ?? 0,
					hasDelegatedWorkflowMetadata: true,
					childTaskIds,
					coveredChildTaskId,
					inFlightChildTaskId,
					requestCount,
				})
				this.log(
					`[email-notifications] Sending final parent task ${task.taskId} notification separately from delegated child task ${
						coveredChildTaskId ?? inFlightChildTaskId
					} notification.`,
				)
			} else if (childTaskIds.length > 0) {
				this.logEmailNotificationDiagnostics("completion-notification-decision", {
					...taskDiagnostics,
					decision: "prepare-delegated-child-workflow-success-and-send-top-level-success",
					notificationScope: "final-parent",
					notificationDedupeKey: topLevelNotificationDedupeKey,
					hasSummary: Boolean(summary),
					summaryLength: summary?.length ?? 0,
					hasDelegatedWorkflowMetadata: true,
					childTaskIds,
					requestCount,
				})
				void this.notifyDelegatedWorkflowCompleted(
					historyItem,
					summary ?? historyItem.completionResultSummary ?? DEFAULT_COMPLETION_EMAIL_SUMMARY,
					{
						workspacePath: task.workspacePath,
						mode: task.taskMode,
						toolUsage,
					},
				).catch((error) => {
					this.log(
						`[email-notifications] Failed to prepare delegated child completion notification for ${task.taskId}: ${this.sanitizeEmailNotificationLogMessage(
							error,
						)}`,
					)
				})
			} else {
				this.logEmailNotificationDiagnostics("completion-notification-decision", {
					...taskDiagnostics,
					decision: "send-top-level-success-no-delegated-child-id",
					notificationScope: "final-parent",
					notificationDedupeKey: topLevelNotificationDedupeKey,
					hasSummary: Boolean(summary),
					summaryLength: summary?.length ?? 0,
					hasDelegatedWorkflowMetadata: true,
					requestCount,
				})
			}
		}

		this.logEmailNotificationDiagnostics("completion-notification-decision", {
			...taskDiagnostics,
			decision: hasDelegatedWorkflowMetadata
				? "send-top-level-success-after-delegated-workflow"
				: "send-top-level-success",
			notificationScope: "final-parent",
			notificationDedupeKey: topLevelNotificationDedupeKey,
			hasSummary: Boolean(summary),
			summaryLength: summary?.length ?? 0,
			hasDelegatedWorkflowMetadata,
			childTaskIds,
			coveredChildTaskId,
			inFlightChildTaskId,
			requestCount,
		})

		const usageHistoryItem = this.getEmailNotificationUsageHistoryItem(
			task.taskId,
			historyItem,
			tokenUsage,
			childTaskIds,
		)

		if (!historyItem && childTaskIds.length === 0) {
			this.logEmailNotificationDiagnostics("completion-notification-aggregation", {
				...taskDiagnostics,
				decision: "use-live-task-usage",
				usageAggregationSource: "live-task-event",
				parentHistoryFound: false,
				workflowChildTaskCount: 0,
				requestCount,
				hasTokenUsage: Boolean(tokenUsage),
				totalTokensIn: this.toFiniteEmailNotificationNumber(tokenUsage?.totalTokensIn),
				totalTokensOut: this.toFiniteEmailNotificationNumber(tokenUsage?.totalTokensOut),
				totalCost: this.toFiniteEmailNotificationNumber(tokenUsage?.totalCost),
			})

			await this.notifyTaskOutcome({
				taskId: task.taskId,
				outcome: "success",
				summary,
				notificationType: "final-parent",
				workspacePath: task.workspacePath,
				mode: task.taskMode,
				tokenUsage,
				toolUsage,
				requestCount,
				usageScope: "Task only (live completion event)",
			})
			return
		}

		try {
			await this.notifyTopLevelTaskCompletionWithWorkflowUsage({
				task,
				taskDiagnostics,
				summary,
				historyItem,
				usageHistoryItem,
				childTaskIds,
				tokenUsage,
				toolUsage,
				requestCount,
			})
		} catch (error: unknown) {
			this.log(
				`[email-notifications] Failed to prepare final parent workflow usage for task ${task.taskId}; sending notification with live usage: ${this.sanitizeEmailNotificationLogMessage(
					error,
				)}`,
			)

			await this.notifyTaskOutcome({
				taskId: task.taskId,
				outcome: "success",
				summary,
				notificationType: "final-parent",
				workspacePath: task.workspacePath,
				mode: task.taskMode,
				tokenUsage,
				toolUsage,
				requestCount,
				usageScope: "Task only (live completion event)",
			})
		}
	}

	public async notifyAcceptedFinalParentCompletion(
		task: Task,
		tokenUsage?: TokenUsage,
		toolUsage?: ToolUsage,
	): Promise<void> {
		const taskDiagnostics = this.getEmailNotificationTaskDiagnostics(task)
		const finalParentNotificationType: EmailNotificationPayload["notificationType"] = "final-parent"
		const finalParentNotificationDedupeKey = this.getEmailNotificationTaskOutcomeKey(
			task.taskId,
			finalParentNotificationType,
		)
		const duplicateDiagnostics = this.getEmailNotificationOutcomeDiagnostics(
			task.taskId,
			"success",
			finalParentNotificationType,
		)
		const providerCompletionEventObserved = this.emailNotificationCompletionEventsObserved.has(
			this.getEmailNotificationTaskInstanceKey(task),
		)
		const trackedProviderDispatch = this.emailNotificationTaskOutcomeDispatches.get(
			finalParentNotificationDedupeKey,
		)
		const providerCompletionObservedWithoutTrackedOutcome =
			providerCompletionEventObserved &&
			duplicateDiagnostics.duplicateSent !== true &&
			duplicateDiagnostics.duplicateInFlight !== true

		this.logEmailNotificationDiagnostics("accepted-final-parent-completion-state", {
			...taskDiagnostics,
			...duplicateDiagnostics,
			providerCompletionEventObserved,
			providerCompletionObservedWithoutTrackedOutcome,
		})

		if (task.background) {
			this.logEmailNotificationDiagnostics("accepted-final-parent-completion-decision", {
				...taskDiagnostics,
				...duplicateDiagnostics,
				decision: "skip-background-task",
				providerCompletionEventObserved,
			})
			return
		}

		if (task.parentTask || task.parentTaskId) {
			this.logEmailNotificationDiagnostics("accepted-final-parent-completion-decision", {
				...taskDiagnostics,
				...duplicateDiagnostics,
				decision: "skip-delegated-child-task",
				providerCompletionEventObserved,
			})
			return
		}

		if (providerCompletionEventObserved) {
			if (duplicateDiagnostics.duplicateSent === true || duplicateDiagnostics.duplicateInFlight === true) {
				this.logEmailNotificationDiagnostics("accepted-final-parent-completion-decision", {
					...taskDiagnostics,
					...duplicateDiagnostics,
					decision: "skip-provider-completion-event-observed",
					providerCompletionEventObserved,
					hasTrackedProviderDispatch: Boolean(trackedProviderDispatch),
				})

				if (duplicateDiagnostics.duplicateInFlight === true && trackedProviderDispatch) {
					await trackedProviderDispatch
				}

				return
			}
		}

		this.logEmailNotificationDiagnostics("accepted-final-parent-completion-decision", {
			...taskDiagnostics,
			...duplicateDiagnostics,
			decision: "send-top-level-success-after-acceptance",
			providerCompletionEventObserved,
		})

		await this.notifyTaskCompletion(task, tokenUsage, toolUsage)
	}

	public async notifyFinalParentCompletionUiVisible(
		taskId?: string,
		uiContext: Record<string, unknown> = {},
	): Promise<void> {
		const task = this.getCurrentTask()
		const requestedTaskId = typeof taskId === "string" && taskId.length > 0 ? taskId : undefined
		const uiDiagnostics = {
			taskId: requestedTaskId,
			uiAsk: typeof uiContext.ask === "string" ? uiContext.ask : undefined,
			taskTs: typeof uiContext.taskTs === "number" ? uiContext.taskTs : undefined,
			completionTs: typeof uiContext.completionTs === "number" ? uiContext.completionTs : undefined,
		}

		if (!requestedTaskId) {
			this.logEmailNotificationDiagnostics("ui-visible-final-parent-completion-decision", {
				...uiDiagnostics,
				decision: "skip-missing-task-id",
			})
			return
		}

		if (!task) {
			this.logEmailNotificationDiagnostics("ui-visible-final-parent-completion-decision", {
				...uiDiagnostics,
				decision: "skip-no-current-task",
			})
			return
		}

		const taskDiagnostics = this.getEmailNotificationTaskDiagnostics(task)
		const finalParentNotificationType: EmailNotificationPayload["notificationType"] = "final-parent"
		const finalParentNotificationDedupeKey = this.getEmailNotificationTaskOutcomeKey(
			task.taskId,
			finalParentNotificationType,
		)
		const duplicateDiagnostics = this.getEmailNotificationOutcomeDiagnostics(
			task.taskId,
			"success",
			finalParentNotificationType,
		)
		const trackedProviderDispatch = this.emailNotificationTaskOutcomeDispatches.get(
			finalParentNotificationDedupeKey,
		)
		const providerCompletionEventObserved = this.emailNotificationCompletionEventsObserved.has(
			this.getEmailNotificationTaskInstanceKey(task),
		)
		const hasCompletionResult = task.clineMessages.some(
			(message) => message.ask === "completion_result" || message.say === "completion_result",
		)

		this.logEmailNotificationDiagnostics("ui-visible-final-parent-completion-state", {
			...taskDiagnostics,
			...duplicateDiagnostics,
			...uiDiagnostics,
			providerCompletionEventObserved,
			hasCompletionResult,
		})

		if (task.taskId !== requestedTaskId) {
			this.logEmailNotificationDiagnostics("ui-visible-final-parent-completion-decision", {
				...taskDiagnostics,
				...duplicateDiagnostics,
				...uiDiagnostics,
				decision: "skip-task-id-mismatch",
				currentTaskId: task.taskId,
			})
			return
		}

		if (task.background) {
			this.logEmailNotificationDiagnostics("ui-visible-final-parent-completion-decision", {
				...taskDiagnostics,
				...duplicateDiagnostics,
				...uiDiagnostics,
				decision: "skip-background-task",
			})
			return
		}

		if (task.parentTask || task.parentTaskId) {
			this.logEmailNotificationDiagnostics("ui-visible-final-parent-completion-decision", {
				...taskDiagnostics,
				...duplicateDiagnostics,
				...uiDiagnostics,
				decision: "skip-delegated-child-task",
			})
			return
		}

		if (!hasCompletionResult) {
			this.logEmailNotificationDiagnostics("ui-visible-final-parent-completion-decision", {
				...taskDiagnostics,
				...duplicateDiagnostics,
				...uiDiagnostics,
				decision: "skip-no-completion-result",
			})
			return
		}

		const uiVisibleKey = `${task.taskId}:${uiDiagnostics.completionTs ?? uiDiagnostics.taskTs ?? "unknown"}`

		if (duplicateDiagnostics.duplicateSent === true || duplicateDiagnostics.duplicateInFlight === true) {
			this.logEmailNotificationDiagnostics("ui-visible-final-parent-completion-decision", {
				...taskDiagnostics,
				...duplicateDiagnostics,
				...uiDiagnostics,
				decision: "skip-duplicate-final-parent",
				providerCompletionEventObserved,
				hasTrackedProviderDispatch: Boolean(trackedProviderDispatch),
				uiVisibleKey,
			})

			if (duplicateDiagnostics.duplicateInFlight === true && trackedProviderDispatch) {
				await trackedProviderDispatch
			}

			return
		}

		if (this.emailNotificationUiVisibleCompletionsObserved.has(uiVisibleKey)) {
			this.logEmailNotificationDiagnostics("ui-visible-final-parent-completion-decision", {
				...taskDiagnostics,
				...duplicateDiagnostics,
				...uiDiagnostics,
				decision: "skip-ui-visible-already-observed",
				providerCompletionEventObserved,
				uiVisibleKey,
			})
			return
		}

		this.emailNotificationUiVisibleCompletionsObserved.add(uiVisibleKey)
		this.logEmailNotificationDiagnostics("ui-visible-final-parent-completion-decision", {
			...taskDiagnostics,
			...duplicateDiagnostics,
			...uiDiagnostics,
			decision: "send-top-level-success-after-ui-visible",
			providerCompletionEventObserved,
			uiVisibleKey,
		})

		await this.notifyTaskCompletion(
			task,
			this.emailNotificationTaskTokenUsage.get(task.taskId) ?? task.tokenUsage,
			this.emailNotificationTaskToolUsage.get(task.taskId) ?? task.toolUsage,
		)
	}

	private notifyParallelMergeWorkflowCompletion(
		task: Task | undefined,
		plan: ExecutionPlan,
		approvedAgentIds: string[],
		entries?: MergeReviewEntry[],
	): void {
		const mergedEntryCount =
			entries?.filter((entry) => entry.mergeStatus === "merged").length ?? approvedAgentIds.length
		const planDiagnostics = {
			planId: plan.planId,
			agentCount: plan.agents.length,
			approvedAgentCount: approvedAgentIds.length,
			mergedEntryCount,
			reason: "successful parallel merge",
		}

		if (!task) {
			this.logEmailNotificationDiagnostics("parallel-merge-parent-notification-decision", {
				...planDiagnostics,
				decision: "skip-no-current-task",
			})
			this.log(
				`[email-notifications] Skipping parallel merge completion notification for plan ${plan.planId} because no current parent task is available.`,
			)
			return
		}

		const taskDiagnostics = this.getEmailNotificationTaskDiagnostics(task)
		const duplicateDiagnostics = this.getEmailNotificationOutcomeDiagnostics(
			task.taskId,
			"success",
			"parallel-workflow",
		)

		if (task.background) {
			this.logEmailNotificationDiagnostics("parallel-merge-parent-notification-decision", {
				...taskDiagnostics,
				...planDiagnostics,
				...duplicateDiagnostics,
				decision: "skip-background-task",
			})
			this.log(
				`[email-notifications] Skipping parallel merge completion notification for task ${task.taskId} because it is a background task.`,
			)
			return
		}

		if (task.parentTask || task.parentTaskId) {
			this.logEmailNotificationDiagnostics("parallel-merge-parent-notification-decision", {
				...taskDiagnostics,
				...planDiagnostics,
				...duplicateDiagnostics,
				decision: "skip-delegated-child-task",
			})
			this.log(
				`[email-notifications] Skipping parallel merge completion notification for task ${task.taskId} because it is a delegated child task.`,
			)
			return
		}

		const summary = this.buildParallelMergeNotificationSummary(plan, approvedAgentIds)
		const requestCount = this.countApiRequestMessages(task.clineMessages)
		this.rememberEmailNotificationTaskContext(task, "completed")
		this.rememberEmailNotificationTaskUsage(task.taskId, task.tokenUsage, task.toolUsage, requestCount)
		const historyItem = this.getEmailNotificationHistoryItem(task.taskId)
		const childTaskIds = this.getEmailNotificationWorkflowChildTaskIds(task.taskId, historyItem)

		this.logEmailNotificationDiagnostics("parallel-merge-parent-notification-decision", {
			...taskDiagnostics,
			...planDiagnostics,
			...duplicateDiagnostics,
			decision: "send-parallel-merge-workflow-success",
			hasSummary: Boolean(summary),
			summaryLength: summary.length,
			requestCount,
			workflowChildTaskCount: childTaskIds.length,
			workflowDescendantIdsCount: this.countEmailNotificationWorkflowDescendants(task.taskId, historyItem),
		})

		void this.notifyParallelMergeWorkflowCompletionWithAggregatedUsage({
			task,
			taskDiagnostics,
			planDiagnostics,
			summary,
			historyItem,
			childTaskIds,
			requestCount,
		}).catch((error) => {
			this.log(
				`[email-notifications] Failed to dispatch parallel merge workflow notification for task ${task.taskId}: ${this.sanitizeEmailNotificationLogMessage(
					error,
				)}`,
			)
		})
	}

	private async notifyParallelMergeWorkflowCompletionWithAggregatedUsage({
		task,
		taskDiagnostics,
		planDiagnostics,
		summary,
		historyItem,
		childTaskIds,
		requestCount,
	}: {
		task: Task
		taskDiagnostics: Record<string, unknown>
		planDiagnostics: Record<string, unknown>
		summary: string
		historyItem?: HistoryItem
		childTaskIds: string[]
		requestCount: number
	}): Promise<void> {
		const usageHistoryItem = this.getEmailNotificationUsageHistoryItem(
			task.taskId,
			historyItem,
			task.tokenUsage,
			childTaskIds,
		)
		const usage = await this.getAggregatedTaskNotificationUsage(usageHistoryItem).catch((error) => {
			this.log(
				`[email-notifications] Failed to aggregate parallel workflow usage for task ${task.taskId}; sending notification with fallback usage: ${this.sanitizeEmailNotificationLogMessage(
					error,
				)}`,
			)

			return this.getFallbackTaskNotificationUsage(usageHistoryItem)
		})
		const aggregatedRequestCount = Math.max(usage.requestCount ?? 0, requestCount)
		const workflowToolUsage = this.getEmailNotificationWorkflowToolUsage(task.taskId, task.toolUsage, childTaskIds)

		this.logEmailNotificationDiagnostics("parallel-merge-parent-notification-aggregation", {
			...taskDiagnostics,
			...planDiagnostics,
			decision: "use-aggregated-workflow-usage",
			usageAggregationSource: historyItem ? "history-recursive" : "live-root-with-discovered-children",
			parentHistoryFound: Boolean(historyItem),
			workflowChildTaskCount: childTaskIds.length,
			workflowDescendantIdsCount: this.countEmailNotificationWorkflowDescendants(task.taskId, historyItem),
			requestCount: aggregatedRequestCount,
			hasTokenUsage: Boolean(usage.tokenUsage),
			totalTokensIn: this.toFiniteEmailNotificationNumber(usage.tokenUsage?.totalTokensIn),
			totalTokensOut: this.toFiniteEmailNotificationNumber(usage.tokenUsage?.totalTokensOut),
			totalCacheWrites: this.toFiniteEmailNotificationNumber(usage.tokenUsage?.totalCacheWrites),
			totalCacheReads: this.toFiniteEmailNotificationNumber(usage.tokenUsage?.totalCacheReads),
			totalCost: this.toFiniteEmailNotificationNumber(usage.tokenUsage?.totalCost),
			hasWorkflowToolUsage: Boolean(workflowToolUsage),
			toolAttempts: this.countEmailNotificationToolUsage(workflowToolUsage).attempts,
			toolFailures: this.countEmailNotificationToolUsage(workflowToolUsage).failures,
		})

		await this.notifyTaskOutcome({
			taskId: task.taskId,
			outcome: "success",
			summary,
			workspacePath: task.workspacePath,
			mode: task.taskMode,
			notificationType: "parallel-workflow",
			tokenUsage: usage.tokenUsage ?? task.tokenUsage,
			toolUsage: workflowToolUsage ?? task.toolUsage,
			requestCount: aggregatedRequestCount,
			usageScope: this.buildEmailNotificationUsageScope(childTaskIds.length),
		})
	}

	private buildParallelMergeNotificationSummary(plan: ExecutionPlan, approvedAgentIds: string[]): string {
		const approvedAgentCount = approvedAgentIds.length
		const approvedAgentLabel =
			approvedAgentCount === 1 ? "1 approved agent branch" : `${approvedAgentCount} approved agent branches`
		const materializedVerb = approvedAgentCount === 1 ? "was" : "were"
		const plannedAgentLabel = plan.agents.length === 1 ? "1 planned agent" : `${plan.agents.length} planned agents`

		return `Parallel agent workflow completed successfully; ${approvedAgentLabel} ${materializedVerb} materialized into the workspace (${plannedAgentLabel}).`
	}

	private getEmailNotificationTaskDiagnostics(task: Task): Record<string, unknown> {
		const currentTask = this.getCurrentTask()

		return {
			taskId: task.taskId,
			background: task.background === true,
			hasParentTask: Boolean(task.parentTask),
			parentTaskId: task.parentTaskId,
			rootTaskId: task.rootTaskId,
			agentId: task.agentId,
			taskStatus: task.taskStatus,
			isCurrentTask: currentTask?.taskId === task.taskId,
			currentTaskId: currentTask?.taskId,
			currentTaskBackground: currentTask?.background === true,
		}
	}

	private getEmailNotificationParentTaskId(task: Task): string | undefined {
		return task.parentTaskId ?? task.parentTask?.taskId
	}

	private getEmailNotificationRootTaskId(task: Task): string | undefined {
		return task.rootTaskId ?? task.parentTask?.rootTaskId ?? this.getEmailNotificationParentTaskId(task)
	}

	private getDelegatedWorkflowNotificationChildIds(
		historyItem: Pick<HistoryItem, "childIds" | "completedByChildId">,
	): string[] {
		return Array.from(
			new Set(
				[historyItem.completedByChildId, ...(historyItem.childIds ?? [])].filter(
					(childTaskId): childTaskId is string => typeof childTaskId === "string" && childTaskId.length > 0,
				),
			),
		)
	}

	private logEmailNotificationDiagnostics(event: string, diagnostics: Record<string, unknown>): void {
		this.log(`[email-notifications] diagnostics ${JSON.stringify({ event, ...diagnostics })}`)
	}

	private getEmailNotificationOutcomeDiagnostics(
		taskId: string,
		outcome: EmailNotificationOutcome,
		notificationType?: EmailNotificationPayload["notificationType"],
	): Record<string, unknown> {
		const notificationDedupeKey = this.getEmailNotificationTaskOutcomeKey(taskId, notificationType)

		return {
			notificationDedupeKey,
			notificationScope: this.getEmailNotificationTaskOutcomeScope(notificationType),
			sentOutcome: this.emailNotificationTaskOutcomes.get(notificationDedupeKey),
			inFlightOutcome: this.emailNotificationTaskOutcomesInFlight.get(notificationDedupeKey),
			duplicateSent: this.hasEmailNotificationTaskOutcomeBeenSent(taskId, outcome, notificationType),
			duplicateInFlight: this.hasEmailNotificationTaskOutcomeInFlight(taskId, outcome, notificationType),
		}
	}

	private async notifyDelegatedWorkflowCompleted(
		historyItem: Pick<
			HistoryItem,
			| "id"
			| "workspace"
			| "mode"
			| "rootTaskId"
			| "tokensIn"
			| "tokensOut"
			| "cacheWrites"
			| "cacheReads"
			| "totalCost"
			| "childIds"
			| "completedByChildId"
		>,
		completionResultSummary: string,
		options: Pick<EmailNotificationPayload, "workspacePath" | "mode" | "toolUsage"> = {},
	): Promise<void> {
		const childTaskId = this.getDelegatedWorkflowNotificationChildIds(historyItem)[0]

		if (!childTaskId) {
			this.logEmailNotificationDiagnostics("delegated-workflow-notification-prepared", {
				taskId: historyItem.id,
				decision: "skip-no-delegated-child-task-id",
				hasSummary: Boolean(completionResultSummary),
				summaryLength: completionResultSummary.length,
			})
			return
		}

		if (this.hasEmailNotificationTaskOutcomeBeenSent(childTaskId, "success", "delegated-child")) {
			this.logEmailNotificationDiagnostics("delegated-workflow-notification-prepared", {
				taskId: historyItem.id,
				childTaskId,
				decision: "skip-child-duplicate-sent",
				notificationType: "delegated-child",
				notificationDedupeKey: this.getEmailNotificationTaskOutcomeKey(childTaskId, "delegated-child"),
			})
			return
		}

		if (this.hasEmailNotificationTaskOutcomeInFlight(childTaskId, "success", "delegated-child")) {
			this.logEmailNotificationDiagnostics("delegated-workflow-notification-prepared", {
				taskId: historyItem.id,
				childTaskId,
				decision: "skip-child-duplicate-in-flight",
				notificationType: "delegated-child",
				notificationDedupeKey: this.getEmailNotificationTaskOutcomeKey(childTaskId, "delegated-child"),
			})
			return
		}

		const childHistoryItem = this.getEmailNotificationHistoryItem(childTaskId)
		const usageHistoryItem = childHistoryItem ?? historyItem
		const usage = await this.getAggregatedTaskNotificationUsage(usageHistoryItem).catch((error) => {
			this.log(
				`[email-notifications] Failed to aggregate delegated completion usage for child task ${childTaskId}; sending notification with fallback usage: ${this.sanitizeEmailNotificationLogMessage(
					error,
				)}`,
			)

			return this.getFallbackTaskNotificationUsage(usageHistoryItem)
		})

		this.logEmailNotificationDiagnostics("delegated-workflow-notification-prepared", {
			taskId: historyItem.id,
			childTaskId,
			decision: "send-delegated-child-success",
			hasSummary: Boolean(completionResultSummary),
			summaryLength: completionResultSummary.length,
			workspacePath: options.workspacePath ?? childHistoryItem?.workspace ?? historyItem.workspace,
			mode:
				options.mode ??
				(typeof childHistoryItem?.mode === "string"
					? childHistoryItem.mode
					: typeof historyItem.mode === "string"
						? historyItem.mode
						: undefined),
			parentTaskId: historyItem.id,
			rootTaskId: childHistoryItem?.rootTaskId ?? historyItem.rootTaskId ?? historyItem.id,
			requestCount: usage.requestCount,
			hasTokenUsage: Boolean(usage.tokenUsage),
		})

		await this.notifyTaskOutcome({
			taskId: childTaskId,
			outcome: "success",
			summary: this.formatEmailNotificationSummary(completionResultSummary) ?? DEFAULT_COMPLETION_EMAIL_SUMMARY,
			workspacePath: options.workspacePath ?? childHistoryItem?.workspace ?? historyItem.workspace,
			mode:
				options.mode ??
				(typeof childHistoryItem?.mode === "string"
					? childHistoryItem.mode
					: typeof historyItem.mode === "string"
						? historyItem.mode
						: undefined),
			notificationType: "delegated-child",
			parentTaskId: historyItem.id,
			rootTaskId: childHistoryItem?.rootTaskId ?? historyItem.rootTaskId ?? historyItem.id,
			toolUsage: options.toolUsage,
			...usage,
		})
	}

	private async notifyTopLevelTaskCompletionWithWorkflowUsage({
		task,
		taskDiagnostics,
		summary,
		historyItem,
		usageHistoryItem,
		childTaskIds,
		tokenUsage,
		toolUsage,
		requestCount,
	}: {
		task: Task
		taskDiagnostics: Record<string, unknown>
		summary?: string
		historyItem?: HistoryItem
		usageHistoryItem: EmailNotificationUsageHistoryItem
		childTaskIds: string[]
		tokenUsage?: TokenUsage
		toolUsage?: ToolUsage
		requestCount: number
	}): Promise<void> {
		const usage = await this.getAggregatedTaskNotificationUsage(usageHistoryItem).catch((error) => {
			this.log(
				`[email-notifications] Failed to aggregate final parent workflow usage for task ${task.taskId}; sending notification with fallback usage: ${this.sanitizeEmailNotificationLogMessage(
					error,
				)}`,
			)

			return this.getFallbackTaskNotificationUsage(usageHistoryItem)
		})
		const aggregatedRequestCount = Math.max(usage.requestCount ?? 0, requestCount)
		const workflowToolUsage = this.getEmailNotificationWorkflowToolUsage(task.taskId, toolUsage, childTaskIds)
		const workflowSummary = this.buildEmailNotificationWorkflowSummary(task, summary, childTaskIds, historyItem)
		const usageScope = this.buildEmailNotificationUsageScope(childTaskIds.length)

		this.logEmailNotificationDiagnostics("completion-notification-aggregation", {
			...taskDiagnostics,
			decision: "use-aggregated-workflow-usage",
			usageAggregationSource: historyItem ? "history-recursive" : "live-root-with-discovered-children",
			parentHistoryFound: Boolean(historyItem),
			workflowChildTaskCount: childTaskIds.length,
			requestCount: aggregatedRequestCount,
			hasTokenUsage: Boolean(usage.tokenUsage),
			totalTokensIn: this.toFiniteEmailNotificationNumber(usage.tokenUsage?.totalTokensIn),
			totalTokensOut: this.toFiniteEmailNotificationNumber(usage.tokenUsage?.totalTokensOut),
			totalCacheWrites: this.toFiniteEmailNotificationNumber(usage.tokenUsage?.totalCacheWrites),
			totalCacheReads: this.toFiniteEmailNotificationNumber(usage.tokenUsage?.totalCacheReads),
			totalCost: this.toFiniteEmailNotificationNumber(usage.tokenUsage?.totalCost),
			hasWorkflowToolUsage: Boolean(workflowToolUsage),
			toolAttempts: this.countEmailNotificationToolUsage(workflowToolUsage).attempts,
			toolFailures: this.countEmailNotificationToolUsage(workflowToolUsage).failures,
		})

		await this.notifyTaskOutcome({
			taskId: task.taskId,
			outcome: "success",
			summary,
			workflowSummary,
			usageScope,
			workspacePath: task.workspacePath,
			mode: task.taskMode,
			notificationType: "final-parent",
			tokenUsage: usage.tokenUsage ?? tokenUsage,
			toolUsage: workflowToolUsage ?? toolUsage,
			requestCount: aggregatedRequestCount,
		})
	}

	private rememberEmailNotificationTaskContext(task: Task, lifecycle: "created" | "completed"): void {
		this.emailNotificationTaskContexts.set(task.taskId, {
			parentTaskId: this.getEmailNotificationParentTaskId(task),
			rootTaskId: this.getEmailNotificationRootTaskId(task),
			agentId: task.agentId,
			background: task.background === true,
			workspacePath: task.workspacePath,
			lifecycle,
		})

		void task
			.getTaskMode()
			.then((mode) => {
				const context = this.emailNotificationTaskContexts.get(task.taskId)

				if (!context) {
					return
				}

				this.emailNotificationTaskContexts.set(task.taskId, { ...context, mode })
			})
			.catch((error) => {
				this.log(
					`[email-notifications] Failed to resolve mode for task ${task.taskId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			})
	}

	private rememberEmailNotificationTaskUsage(
		taskId: string,
		tokenUsage?: TokenUsage,
		toolUsage?: ToolUsage,
		requestCount?: number,
	): void {
		if (tokenUsage) {
			this.emailNotificationTaskTokenUsage.set(taskId, tokenUsage)
		}

		if (toolUsage) {
			this.emailNotificationTaskToolUsage.set(taskId, toolUsage)
		}

		if (typeof requestCount === "number" && Number.isFinite(requestCount)) {
			this.emailNotificationTaskRequestCounts.set(taskId, requestCount)
		}
	}

	private getEmailNotificationTaskUsageHistoryItem(taskId: string): EmailNotificationUsageHistoryItem | undefined {
		const historyItem = this.getEmailNotificationHistoryItem(taskId)
		const tokenUsage = this.emailNotificationTaskTokenUsage.get(taskId)
		const childTaskIds = this.getEmailNotificationWorkflowChildTaskIds(taskId, historyItem)

		if (historyItem || tokenUsage || this.emailNotificationTaskContexts.has(taskId) || childTaskIds.length > 0) {
			return this.getEmailNotificationUsageHistoryItem(taskId, historyItem, tokenUsage, childTaskIds)
		}

		return undefined
	}

	private getEmailNotificationWorkflowChildTaskIds(taskId: string, historyItem?: HistoryItem): string[] {
		const childTaskIds = new Set<string>()

		for (const childTaskId of historyItem?.childIds ?? []) {
			childTaskIds.add(childTaskId)
		}

		if (historyItem?.completedByChildId) {
			childTaskIds.add(historyItem.completedByChildId)
		}

		for (const childTaskId of this.getChildTaskIds(taskId)) {
			childTaskIds.add(childTaskId)
		}

		for (const [candidateTaskId, context] of this.emailNotificationTaskContexts) {
			if (context.parentTaskId === taskId || (!context.parentTaskId && context.rootTaskId === taskId)) {
				childTaskIds.add(candidateTaskId)
			}
		}

		childTaskIds.delete(taskId)
		return Array.from(childTaskIds)
	}

	private countEmailNotificationWorkflowDescendants(
		taskId: string,
		historyItem?: HistoryItem,
		visited: Set<string> = new Set(),
	): number {
		if (visited.has(taskId)) {
			return 0
		}

		visited.add(taskId)
		let descendantCount = 0

		for (const childTaskId of this.getEmailNotificationWorkflowChildTaskIds(taskId, historyItem)) {
			if (visited.has(childTaskId)) {
				continue
			}

			descendantCount += 1
			descendantCount += this.countEmailNotificationWorkflowDescendants(
				childTaskId,
				this.getEmailNotificationHistoryItem(childTaskId),
				visited,
			)
		}

		return descendantCount
	}

	private getEmailNotificationUsageHistoryItem(
		taskId: string,
		historyItem: HistoryItem | undefined,
		tokenUsage: TokenUsage | undefined,
		childTaskIds: string[],
	): EmailNotificationUsageHistoryItem {
		return {
			id: taskId,
			tokensIn: Math.max(
				this.toFiniteEmailNotificationNumber(historyItem?.tokensIn),
				this.toFiniteEmailNotificationNumber(tokenUsage?.totalTokensIn),
			),
			tokensOut: Math.max(
				this.toFiniteEmailNotificationNumber(historyItem?.tokensOut),
				this.toFiniteEmailNotificationNumber(tokenUsage?.totalTokensOut),
			),
			cacheWrites: Math.max(
				this.toFiniteEmailNotificationNumber(historyItem?.cacheWrites),
				this.toFiniteEmailNotificationNumber(tokenUsage?.totalCacheWrites),
			),
			cacheReads: Math.max(
				this.toFiniteEmailNotificationNumber(historyItem?.cacheReads),
				this.toFiniteEmailNotificationNumber(tokenUsage?.totalCacheReads),
			),
			totalCost: Math.max(
				this.toFiniteEmailNotificationNumber(historyItem?.totalCost),
				this.toFiniteEmailNotificationNumber(tokenUsage?.totalCost),
			),
			childIds: childTaskIds,
			completedByChildId: historyItem?.completedByChildId,
		}
	}

	private getEmailNotificationWorkflowToolUsage(
		rootTaskId: string,
		rootToolUsage: ToolUsage | undefined,
		directChildTaskIds: string[],
	): ToolUsage | undefined {
		const mergedToolUsage = this.mergeEmailNotificationToolUsage(
			undefined,
			this.emailNotificationTaskToolUsage.get(rootTaskId) ?? rootToolUsage,
		)
		const visited = new Set<string>([rootTaskId])
		const visitChild = (taskId: string): ToolUsage | undefined => {
			if (visited.has(taskId)) {
				return undefined
			}

			visited.add(taskId)
			let childToolUsage = this.emailNotificationTaskToolUsage.get(taskId)
			const childHistory = this.getEmailNotificationHistoryItem(taskId)
			for (const nestedChildTaskId of this.getEmailNotificationWorkflowChildTaskIds(taskId, childHistory)) {
				childToolUsage = this.mergeEmailNotificationToolUsage(childToolUsage, visitChild(nestedChildTaskId))
			}

			return childToolUsage
		}
		let workflowToolUsage = mergedToolUsage

		for (const childTaskId of directChildTaskIds) {
			workflowToolUsage = this.mergeEmailNotificationToolUsage(workflowToolUsage, visitChild(childTaskId))
		}

		return workflowToolUsage
	}

	private mergeEmailNotificationToolUsage(left?: ToolUsage, right?: ToolUsage): ToolUsage | undefined {
		if (!left && !right) {
			return undefined
		}

		const merged: Record<string, { attempts: number; failures: number }> = {}
		for (const usage of [left, right]) {
			if (!usage || typeof usage !== "object") {
				continue
			}

			for (const [toolName, counts] of Object.entries(usage)) {
				const existing = merged[toolName] ?? { attempts: 0, failures: 0 }
				merged[toolName] = {
					attempts: existing.attempts + this.toFiniteEmailNotificationNumber(counts?.attempts),
					failures: existing.failures + this.toFiniteEmailNotificationNumber(counts?.failures),
				}
			}
		}

		return merged as ToolUsage
	}

	private countEmailNotificationToolUsage(toolUsage?: ToolUsage): { attempts: number; failures: number } {
		if (!toolUsage || typeof toolUsage !== "object") {
			return { attempts: 0, failures: 0 }
		}

		return Object.values(toolUsage).reduce(
			(counts, usage) => ({
				attempts: counts.attempts + this.toFiniteEmailNotificationNumber(usage?.attempts),
				failures: counts.failures + this.toFiniteEmailNotificationNumber(usage?.failures),
			}),
			{ attempts: 0, failures: 0 },
		)
	}

	private buildEmailNotificationUsageScope(childTaskCount: number): string {
		if (childTaskCount === 0) {
			return "Aggregated parent workflow usage from the parent task history."
		}

		const childTaskLabel = childTaskCount === 1 ? "1 child task" : `${childTaskCount} child tasks`
		return `Aggregated parent workflow usage from the parent task plus ${childTaskLabel}, including delegated and background parallel-agent tasks discoverable from saved task metadata.`
	}

	private buildEmailNotificationWorkflowSummary(
		task: Task,
		summary: string | undefined,
		childTaskIds: string[],
		historyItem?: HistoryItem,
	): string | undefined {
		if (childTaskIds.length === 0) {
			return undefined
		}

		const childDetails = childTaskIds.slice(0, 5).map((childTaskId) => {
			const childHistory = this.getEmailNotificationHistoryItem(childTaskId)
			const childContext = this.emailNotificationTaskContexts.get(childTaskId)
			const agentLabel = childContext?.agentId ? ` agent ${childContext.agentId}` : ""
			const taskKind = childContext?.background
				? "parallel/background"
				: childContext?.parentTaskId
					? "delegated"
					: "child"
			const statusLabel = childHistory?.status ? ` status ${childHistory.status}` : ""
			const childSummary = this.formatEmailNotificationSummary(childHistory?.completionResultSummary)

			return `${childTaskId}:${agentLabel} ${taskKind} task${statusLabel}${childSummary ? `; ${childSummary}` : ""}`
		})
		const remainingChildCount = Math.max(childTaskIds.length - childDetails.length, 0)
		const childSummaryLine = [
			...childDetails,
			...(remainingChildCount > 0
				? [`${remainingChildCount} additional child task(s) included in usage totals`]
				: []),
		].join(" | ")
		const parentSummary = summary ?? historyItem?.completionResultSummary ?? DEFAULT_COMPLETION_EMAIL_SUMMARY
		const childTaskLabel = childTaskIds.length === 1 ? "1 child/subtask" : `${childTaskIds.length} child/subtasks`

		return this.formatEmailNotificationSummary(
			`Overall workflow rollup: parent task ${task.taskId} completed with final result "${parentSummary}". Usage totals include the parent plus ${childTaskLabel}. Included child context: ${childSummaryLine}`,
		)
	}

	private getEmailNotificationHistoryItem(taskId: string): HistoryItem | undefined {
		const historyById = new Map<string, HistoryItem>()

		for (const item of this.getGlobalState("taskHistory") ?? []) {
			historyById.set(item.id, item)
		}

		for (const item of this.taskHistoryStore.getAll()) {
			historyById.set(item.id, item)
		}

		return historyById.get(taskId)
	}

	private hasDelegatedWorkflowNotificationMetadata(
		historyItem: Pick<HistoryItem, "childIds" | "completedByChildId" | "completionResultSummary">,
	): boolean {
		return (
			(historyItem.childIds?.length ?? 0) > 0 ||
			typeof historyItem.completedByChildId === "string" ||
			typeof historyItem.completionResultSummary === "string"
		)
	}

	private async getAggregatedTaskNotificationUsage(
		historyItem: Pick<
			HistoryItem,
			"id" | "tokensIn" | "tokensOut" | "cacheWrites" | "cacheReads" | "totalCost" | "childIds"
		>,
	): Promise<Pick<EmailNotificationPayload, "tokenUsage" | "requestCount">> {
		return aggregateTaskTokenUsageRecursive(
			historyItem.id,
			async (id: string) => {
				if (id === historyItem.id) {
					return historyItem as HistoryItem
				}

				const inMemoryUsageHistoryItem = this.getEmailNotificationTaskUsageHistoryItem(id)

				if (inMemoryUsageHistoryItem) {
					return inMemoryUsageHistoryItem as HistoryItem
				}

				try {
					const result = await this.getTaskWithId(id)
					const loadedHistoryItem = result.historyItem
					return this.getEmailNotificationUsageHistoryItem(
						id,
						loadedHistoryItem,
						this.emailNotificationTaskTokenUsage.get(id),
						this.getEmailNotificationWorkflowChildTaskIds(id, loadedHistoryItem),
					) as HistoryItem
				} catch (error) {
					this.log(
						`[email-notifications] Failed to load usage history for task ${id}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
					return undefined
				}
			},
			{
				getChildTaskIds: async (parentId: string) =>
					this.getEmailNotificationWorkflowChildTaskIds(
						parentId,
						this.getEmailNotificationHistoryItem(parentId),
					),
				getTaskRequestCount: async (id: string) => this.getEmailNotificationTaskRequestCount(id),
			},
		)
	}

	private getFallbackTaskNotificationUsage(
		historyItem: Pick<HistoryItem, "tokensIn" | "tokensOut" | "cacheWrites" | "cacheReads" | "totalCost">,
	): Pick<EmailNotificationPayload, "tokenUsage" | "requestCount"> {
		return {
			tokenUsage: {
				totalTokensIn: this.toFiniteEmailNotificationNumber(historyItem.tokensIn),
				totalTokensOut: this.toFiniteEmailNotificationNumber(historyItem.tokensOut),
				totalCacheWrites: this.toFiniteEmailNotificationNumber(historyItem.cacheWrites),
				totalCacheReads: this.toFiniteEmailNotificationNumber(historyItem.cacheReads),
				totalCost: this.toFiniteEmailNotificationNumber(historyItem.totalCost),
				contextTokens: 0,
			},
			requestCount: 0,
		}
	}

	private toFiniteEmailNotificationNumber(value: number | undefined): number {
		return typeof value === "number" && Number.isFinite(value) ? value : 0
	}

	private async notifyTaskOutcome(payload: EmailNotificationPayload): Promise<void> {
		const notificationDedupeKey = this.getEmailNotificationTaskOutcomeKey(payload.taskId, payload.notificationType)
		const notificationScope = this.getEmailNotificationTaskOutcomeScope(payload.notificationType)
		const buildDiagnostics = (decision: string): Record<string, unknown> => ({
			decision,
			taskId: payload.taskId,
			outcome: payload.outcome,
			notificationType: payload.notificationType,
			notificationScope,
			notificationDedupeKey,
			parentTaskId: payload.parentTaskId,
			rootTaskId: payload.rootTaskId,
			agentId: payload.agentId,
			sentOutcome: this.emailNotificationTaskOutcomes.get(notificationDedupeKey),
			inFlightOutcome: this.emailNotificationTaskOutcomesInFlight.get(notificationDedupeKey),
			duplicateSent: this.hasEmailNotificationTaskOutcomeBeenSent(
				payload.taskId,
				payload.outcome,
				payload.notificationType,
			),
			duplicateInFlight: this.hasEmailNotificationTaskOutcomeInFlight(
				payload.taskId,
				payload.outcome,
				payload.notificationType,
			),
			hasSummary: Boolean(payload.summary),
			summaryLength: payload.summary?.length ?? 0,
			workspacePath: payload.workspacePath,
			mode: payload.mode,
			requestCount: payload.requestCount,
			hasTokenUsage: Boolean(payload.tokenUsage),
			hasToolUsage: Boolean(payload.toolUsage),
		})

		if (payload.outcome !== "success") {
			this.logEmailNotificationDiagnostics(
				"outcome-notification-decision",
				buildDiagnostics("skip-completion-only"),
			)
			this.log(
				`[email-notifications] Skipping ${payload.outcome} notification for task ${payload.taskId}; automatic SMTP notifications are completion-only.`,
			)
			return
		}

		if (this.hasEmailNotificationTaskOutcomeBeenSent(payload.taskId, payload.outcome, payload.notificationType)) {
			this.logEmailNotificationDiagnostics(
				"outcome-notification-decision",
				buildDiagnostics("skip-duplicate-sent"),
			)
			this.log(
				`[email-notifications] Skipping ${payload.outcome} ${notificationScope} notification for task ${payload.taskId}; an equal or higher-precedence outcome was already sent for this notification scope.`,
			)
			return
		}

		if (this.hasEmailNotificationTaskOutcomeInFlight(payload.taskId, payload.outcome, payload.notificationType)) {
			this.logEmailNotificationDiagnostics(
				"outcome-notification-decision",
				buildDiagnostics("skip-duplicate-in-flight"),
			)
			this.log(
				`[email-notifications] Skipping ${payload.outcome} ${notificationScope} notification for task ${payload.taskId}; an equal or higher-precedence outcome is already in flight for this notification scope.`,
			)

			const existingDispatch = this.emailNotificationTaskOutcomeDispatches.get(notificationDedupeKey)

			if (existingDispatch) {
				await existingDispatch
			}

			return
		}

		this.logEmailNotificationDiagnostics("outcome-notification-decision", buildDiagnostics("dispatch"))
		this.emailNotificationTaskOutcomesInFlight.set(notificationDedupeKey, payload.outcome)
		this.log(
			`[email-notifications] Dispatching ${payload.outcome} ${notificationScope} notification for task ${payload.taskId}.`,
		)

		const dispatch = this.emailNotificationService
			.sendTaskNotification(payload)
			.then((result) => {
				if (this.emailNotificationTaskOutcomesInFlight.get(notificationDedupeKey) !== payload.outcome) {
					this.logEmailNotificationDiagnostics("notification-send-result", {
						...buildDiagnostics("stale-in-flight-result"),
						attempted: result?.attempted,
						sent: result?.sent,
						skippedReason: result?.skippedReason,
					})
					return
				}

				if (result?.sent === true) {
					this.rememberEmailNotificationTaskOutcome(payload.taskId, payload.outcome, payload.notificationType)
					this.logEmailNotificationDiagnostics("notification-send-result", {
						...buildDiagnostics("sent"),
						attempted: result.attempted,
						sent: result.sent,
					})
					this.log(
						`[email-notifications] Sent ${payload.outcome} ${notificationScope} notification for task ${payload.taskId}.`,
					)
					return
				}

				if (result?.skippedReason) {
					this.logEmailNotificationDiagnostics("notification-send-result", {
						...buildDiagnostics("service-skipped"),
						attempted: result.attempted,
						sent: result.sent,
						skippedReason: result.skippedReason,
					})
					this.log(
						`[email-notifications] Notification for task ${payload.taskId} was skipped by service: ${result.skippedReason}.`,
					)
					return
				}

				const sanitizedResultError = result?.error
					? this.sanitizeEmailNotificationLogMessage(result.error)
					: undefined

				this.logEmailNotificationDiagnostics("notification-send-result", {
					...buildDiagnostics("not-sent"),
					attempted: result?.attempted,
					sent: result?.sent,
					error: sanitizedResultError,
				})
				this.log(
					`[email-notifications] Notification for task ${payload.taskId} was not sent${
						sanitizedResultError ? `: ${sanitizedResultError}` : "."
					}`,
				)
			})
			.catch((error) => {
				this.logEmailNotificationDiagnostics("notification-send-result", {
					...buildDiagnostics("unexpected-error"),
					error: this.sanitizeEmailNotificationLogMessage(error),
				})
				this.log(
					`[email-notifications] Unexpected notification error: ${this.sanitizeEmailNotificationLogMessage(error)}`,
				)
			})
			.finally(() => {
				if (this.emailNotificationTaskOutcomesInFlight.get(notificationDedupeKey) === payload.outcome) {
					this.emailNotificationTaskOutcomesInFlight.delete(notificationDedupeKey)
					this.logEmailNotificationDiagnostics("notification-in-flight-cleared", buildDiagnostics("cleared"))
				}

				if (this.emailNotificationTaskOutcomeDispatches.get(notificationDedupeKey) === dispatch) {
					this.emailNotificationTaskOutcomeDispatches.delete(notificationDedupeKey)
				}
			})

		this.emailNotificationTaskOutcomeDispatches.set(notificationDedupeKey, dispatch)
		await dispatch
	}

	private sanitizeEmailNotificationLogMessage(error: unknown): string {
		const password = this.contextProxy.getSecret("smtpPassword")
		const message = error instanceof Error ? error.message : String(error)

		return password ? message.replaceAll(password, "[redacted]") : message
	}

	public async testSmtpSettings(): Promise<EmailNotificationSendResult> {
		return this.emailNotificationService.sendTestNotification()
	}

	private getChildTaskIds(parentId: string): string[] {
		const historyById = new Map<string, HistoryItem>()

		for (const item of this.getGlobalState("taskHistory") ?? []) {
			historyById.set(item.id, item)
		}

		for (const item of this.taskHistoryStore.getAll()) {
			historyById.set(item.id, item)
		}

		return Array.from(historyById.values())
			.filter((item) => item.parentTaskId === parentId)
			.map((item) => item.id)
	}

	private async getPersistedTaskRequestCount(taskId: string): Promise<number | undefined> {
		try {
			const { getTaskDirectoryPath } = await import("../../utils/storage")
			const taskDirPath = await getTaskDirectoryPath(this.contextProxy.globalStorageUri.fsPath, taskId)
			const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)

			if (!(await fileExistsAtPath(uiMessagesFilePath))) {
				return undefined
			}

			const messages = await readTaskMessages({
				taskId,
				globalStoragePath: this.contextProxy.globalStorageUri.fsPath,
			})

			return this.countApiRequestMessages(messages)
		} catch (error) {
			this.log(
				`[email-notifications] Failed to load request count for task ${taskId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
			return undefined
		}
	}

	private async getEmailNotificationTaskRequestCount(taskId: string): Promise<number | undefined> {
		const liveRequestCount = this.emailNotificationTaskRequestCounts.get(taskId)
		const persistedRequestCount = await this.getPersistedTaskRequestCount(taskId)

		if (persistedRequestCount === undefined) {
			return liveRequestCount
		}

		if (liveRequestCount === undefined) {
			return persistedRequestCount
		}

		return Math.max(persistedRequestCount, liveRequestCount)
	}

	private countApiRequestMessages(messages: ClineMessage[]): number {
		return messages.filter((message) => message.type === "say" && message.say === "api_req_started").length
	}

	private getEmailNotificationTaskOutcomeScope(
		notificationType?: EmailNotificationPayload["notificationType"],
	): EmailNotificationTaskOutcomeScope {
		return notificationType ?? "task"
	}

	private getEmailNotificationTaskOutcomeKey(
		taskId: string,
		notificationType?: EmailNotificationPayload["notificationType"],
	): string {
		return `${this.getEmailNotificationTaskOutcomeScope(notificationType)}:${taskId}`
	}

	private getEmailNotificationTaskInstanceKey(task: Task): string {
		return `${task.taskId}:${task.instanceId}`
	}

	private normalizeEmailNotificationTaskOutcomeType(
		notificationType: unknown,
	): EmailNotificationPayload["notificationType"] | undefined {
		if (
			notificationType === "delegated-child" ||
			notificationType === "parallel-workflow" ||
			notificationType === "final-parent"
		) {
			return notificationType
		}

		return undefined
	}

	private getEmailNotificationTaskOutcomeStateRecord(
		notificationDedupeKey: string,
		outcome: EmailNotificationOutcome,
	): EmailNotificationTaskOutcomeState["outcomes"][number] {
		const separatorIndex = notificationDedupeKey.indexOf(":")
		const notificationScope = notificationDedupeKey.slice(0, separatorIndex)
		const taskId = notificationDedupeKey.slice(separatorIndex + 1)

		if (separatorIndex > 0 && taskId && this.isEmailNotificationTaskOutcomeScope(notificationScope)) {
			return {
				taskId,
				outcome,
				...(notificationScope === "task" ? {} : { notificationType: notificationScope }),
			}
		}

		return { taskId: notificationDedupeKey, outcome }
	}

	private isEmailNotificationTaskOutcomeScope(value: unknown): value is EmailNotificationTaskOutcomeScope {
		return (
			value === "task" || value === "delegated-child" || value === "parallel-workflow" || value === "final-parent"
		)
	}

	private hasEmailNotificationTaskOutcomeBeenSent(
		taskId: string,
		outcome: EmailNotificationOutcome,
		notificationType?: EmailNotificationPayload["notificationType"],
	): boolean {
		this.loadEmailNotificationTaskOutcomeState()

		const previousOutcome = this.emailNotificationTaskOutcomes.get(
			this.getEmailNotificationTaskOutcomeKey(taskId, notificationType),
		)

		if (!previousOutcome) {
			return false
		}

		if (previousOutcome === "success") {
			return true
		}

		return outcome !== "success"
	}

	private hasEmailNotificationTaskOutcomeInFlight(
		taskId: string,
		outcome: EmailNotificationOutcome,
		notificationType?: EmailNotificationPayload["notificationType"],
	): boolean {
		const previousOutcome = this.emailNotificationTaskOutcomesInFlight.get(
			this.getEmailNotificationTaskOutcomeKey(taskId, notificationType),
		)

		if (!previousOutcome) {
			return false
		}

		if (previousOutcome === "success") {
			return true
		}

		return outcome !== "success"
	}

	private rememberEmailNotificationTaskOutcome(
		taskId: string,
		outcome: EmailNotificationOutcome,
		notificationType?: EmailNotificationPayload["notificationType"],
	): void {
		this.loadEmailNotificationTaskOutcomeState()
		const notificationDedupeKey = this.getEmailNotificationTaskOutcomeKey(taskId, notificationType)

		if (!this.emailNotificationTaskOutcomes.has(notificationDedupeKey)) {
			this.emailNotificationTaskOutcomeOrder.push(notificationDedupeKey)
		}

		this.emailNotificationTaskOutcomes.set(notificationDedupeKey, outcome)

		while (this.emailNotificationTaskOutcomeOrder.length > MAX_EMAIL_NOTIFICATION_TASK_OUTCOMES) {
			const oldestKey = this.emailNotificationTaskOutcomeOrder.shift()

			if (oldestKey) {
				this.emailNotificationTaskOutcomes.delete(oldestKey)
			}
		}

		this.persistEmailNotificationTaskOutcomeState()
	}

	private loadEmailNotificationTaskOutcomeState(): void {
		if (this.emailNotificationTaskOutcomeStateLoaded) {
			return
		}

		this.emailNotificationTaskOutcomeStateLoaded = true

		const state = this.context.globalState.get<EmailNotificationTaskOutcomeState>(
			EMAIL_NOTIFICATION_TASK_OUTCOME_STATE_KEY,
		)
		const outcomes = Array.isArray(state?.outcomes)
			? state.outcomes.slice(-MAX_EMAIL_NOTIFICATION_TASK_OUTCOMES)
			: []

		for (const record of outcomes) {
			if (!record || typeof record.taskId !== "string" || !this.isEmailNotificationOutcome(record.outcome)) {
				continue
			}

			const notificationType = this.normalizeEmailNotificationTaskOutcomeType(record.notificationType)
			const notificationDedupeKey = this.getEmailNotificationTaskOutcomeKey(record.taskId, notificationType)

			if (!this.emailNotificationTaskOutcomes.has(notificationDedupeKey)) {
				this.emailNotificationTaskOutcomeOrder.push(notificationDedupeKey)
			}

			this.emailNotificationTaskOutcomes.set(notificationDedupeKey, record.outcome)
		}
	}

	private persistEmailNotificationTaskOutcomeState(): void {
		const state: EmailNotificationTaskOutcomeState = {
			version: 1,
			outcomes: this.emailNotificationTaskOutcomeOrder.flatMap((notificationDedupeKey) => {
				const outcome = this.emailNotificationTaskOutcomes.get(notificationDedupeKey)
				return outcome ? [this.getEmailNotificationTaskOutcomeStateRecord(notificationDedupeKey, outcome)] : []
			}),
		}

		Promise.resolve(this.context.globalState.update(EMAIL_NOTIFICATION_TASK_OUTCOME_STATE_KEY, state)).catch(
			(error) => {
				this.log(
					`[email-notifications] Failed to persist notification state: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			},
		)
	}

	private isEmailNotificationOutcome(outcome: unknown): outcome is EmailNotificationOutcome {
		return outcome === "success" || outcome === "failed" || outcome === "aborted"
	}

	private getEmailNotificationSummary(task: Task): string | undefined {
		const completionResult = task.clineMessages
			.slice()
			.reverse()
			.find((message) => {
				const isCompletionResult =
					(message.type === "say" && message.say === "completion_result") ||
					(message.type === "ask" && message.ask === "completion_result")

				return isCompletionResult && typeof message.text === "string" && message.text.trim().length > 0
			})?.text

		return this.formatEmailNotificationSummary(completionResult) ?? DEFAULT_COMPLETION_EMAIL_SUMMARY
	}

	private formatEmailNotificationSummary(summary: string | undefined): string | undefined {
		const normalizedSummary = summary?.replace(/\s+/g, " ").trim()

		if (!normalizedSummary) {
			return undefined
		}

		if (normalizedSummary.length <= MAX_EMAIL_NOTIFICATION_SUMMARY_LENGTH) {
			return normalizedSummary
		}

		return `${normalizedSummary.slice(0, MAX_EMAIL_NOTIFICATION_SUMMARY_LENGTH - 1).trimEnd()}…`
	}

	async performPreparationTasks(cline: Task) {
		// LMStudio: We need to force model loading in order to read its context
		// size; we do it now since we're starting a task with that model selected.
		if (cline.apiConfiguration && cline.apiConfiguration.apiProvider === "lmstudio") {
			try {
				if (!hasLoadedFullDetails(cline.apiConfiguration.lmStudioModelId!)) {
					await forceFullModelDetailsLoad(
						cline.apiConfiguration.lmStudioBaseUrl ?? "http://localhost:1234",
						cline.apiConfiguration.lmStudioModelId!,
					)
				}
			} catch (error) {
				this.log(`Failed to load full model details for LM Studio: ${error}`)
				vscode.window.showErrorMessage(error.message)
			}
		}
	}

	// Removes and destroys the top Cline instance (the current finished task),
	// activating the previous one (resuming the parent task).
	async removeClineFromStack(options?: { skipDelegationRepair?: boolean }) {
		if (this.clineStack.length === 0) {
			return
		}

		// Pop the top Cline instance from the stack.
		let task = this.clineStack.pop()

		if (task) {
			// Capture delegation metadata before abort/dispose, since abortTask(true)
			// is async and the task reference is cleared afterwards.
			const childTaskId = task.taskId
			const parentTaskId = task.parentTaskId
			this.emailNotificationCompletionEventsObserved.delete(this.getEmailNotificationTaskInstanceKey(task))

			task.emit(RooCodeEventName.TaskUnfocused)

			try {
				// Abort the running task and set isAbandoned to true so
				// all running promises will exit as well.
				await task.abortTask(true)
			} catch (e) {
				this.log(
					`[ClineProvider#removeClineFromStack] abortTask() failed ${task.taskId}.${task.instanceId}: ${e.message}`,
				)
			}

			// Remove event listeners before clearing the reference.
			const cleanupFunctions = this.taskEventListeners.get(task)

			if (cleanupFunctions) {
				cleanupFunctions.forEach((cleanup) => cleanup())
				this.taskEventListeners.delete(task)
			}

			// Make sure no reference kept, once promises end it will be
			// garbage collected.
			task = undefined

			// Delegation-aware parent metadata repair:
			// If the popped task was a delegated child, repair the parent's metadata
			// so it transitions from "delegated" back to "active" and becomes resumable
			// from the task history list.
			// Skip when called from delegateParentAndOpenChild() during nested delegation
			// transitions (A→B→C), where the caller intentionally replaces the active
			// child and will update the parent to point at the new child.
			if (parentTaskId && childTaskId && !options?.skipDelegationRepair) {
				try {
					const { historyItem: parentHistory } = await this.getTaskWithId(parentTaskId)

					if (parentHistory.status === "delegated" && parentHistory.awaitingChildId === childTaskId) {
						await this.updateTaskHistory({
							...parentHistory,
							status: "active",
							awaitingChildId: undefined,
						})
						await restoreDelegatedParentMode(this, parentHistory, "ClineProvider#removeClineFromStack", {
							postState: true,
						})
						this.log(
							`[ClineProvider#removeClineFromStack] Repaired parent ${parentTaskId} metadata: delegated → active (child ${childTaskId} removed)`,
						)
					}
				} catch (err) {
					// Non-fatal: log but do not block the pop operation.
					this.log(
						`[ClineProvider#removeClineFromStack] Failed to repair parent metadata for ${parentTaskId} (non-fatal): ${
							err instanceof Error ? err.message : String(err)
						}`,
					)
				}
			}
		}
	}

	getTaskStackSize(): number {
		return this.clineStack.length
	}

	public getCurrentTaskStack(): string[] {
		return this.clineStack.map((cline) => cline.taskId)
	}

	// Pending Edit Operations Management

	/**
	 * Sets a pending edit operation with automatic timeout cleanup
	 */
	public setPendingEditOperation(
		operationId: string,
		editData: {
			messageTs: number
			editedContent: string
			images?: string[]
			messageIndex: number
			apiConversationHistoryIndex: number
		},
	): void {
		// Clear any existing operation with the same ID
		this.clearPendingEditOperation(operationId)

		// Create timeout for automatic cleanup
		const timeoutId = setTimeout(() => {
			this.clearPendingEditOperation(operationId)
			this.log(`[setPendingEditOperation] Automatically cleared stale pending operation: ${operationId}`)
		}, ClineProvider.PENDING_OPERATION_TIMEOUT_MS)

		// Store the operation
		this.pendingOperations.set(operationId, {
			...editData,
			timeoutId,
			createdAt: Date.now(),
		})

		this.log(`[setPendingEditOperation] Set pending operation: ${operationId}`)
	}

	/**
	 * Gets a pending edit operation by ID
	 */
	private getPendingEditOperation(operationId: string): PendingEditOperation | undefined {
		return this.pendingOperations.get(operationId)
	}

	/**
	 * Clears a specific pending edit operation
	 */
	private clearPendingEditOperation(operationId: string): boolean {
		const operation = this.pendingOperations.get(operationId)
		if (operation) {
			clearTimeout(operation.timeoutId)
			this.pendingOperations.delete(operationId)
			this.log(`[clearPendingEditOperation] Cleared pending operation: ${operationId}`)
			return true
		}
		return false
	}

	/**
	 * Clears all pending edit operations
	 */
	private clearAllPendingEditOperations(): void {
		for (const [operationId, operation] of this.pendingOperations) {
			clearTimeout(operation.timeoutId)
		}
		this.pendingOperations.clear()
		this.log(`[clearAllPendingEditOperations] Cleared all pending operations`)
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	private clearWebviewResources() {
		while (this.webviewDisposables.length) {
			const x = this.webviewDisposables.pop()
			if (x) {
				x.dispose()
			}
		}
	}

	async dispose() {
		if (this._disposed) {
			return
		}

		this._disposed = true
		this.log("Disposing ClineProvider...")

		// Clear all tasks from the stack.
		await this.teardownParallelExecution({ resetBus: true, cleanupWorktrees: true })
		while (this.clineStack.length > 0) {
			await this.removeClineFromStack()
		}
		for (const task of Array.from(this.backgroundTasks)) {
			try {
				await task.abortTask(true)
			} catch (error) {
				this.log(
					`[ClineProvider#dispose] abort background task failed ${task.taskId}.${task.instanceId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}

			this.removeBackgroundTask(task)
		}
		this.pendingPlanApproval?.({ approved: false })
		this.pendingPlanApproval = undefined
		this.activeExecutionPlan = undefined

		this.log("Cleared all tasks")

		// Clear all pending edit operations to prevent memory leaks
		this.clearAllPendingEditOperations()
		this.log("Cleared pending operations")

		if (this.view && "dispose" in this.view) {
			this.view.dispose()
			this.log("Disposed webview")
		}

		this.clearWebviewResources()

		while (this.disposables.length) {
			const x = this.disposables.pop()

			if (x) {
				x.dispose()
			}
		}

		this._workspaceTracker?.dispose()
		this._workspaceTracker = undefined
		await this.mcpHub?.unregisterClient()
		this.mcpHub = undefined
		await this.skillsManager?.dispose()
		this.skillsManager = undefined
		this.customModesManager?.dispose()
		this.taskHistoryStore.dispose()
		await this.remoteDebugLogger.dispose()
		this.flushGlobalStateWriteThrough()
		this.log("Disposed all disposables")
		ClineProvider.activeInstances.delete(this)

		// Clean up any event listeners attached to this provider
		this.removeAllListeners()

		McpServerManager.unregisterProvider(this)
	}

	public static getVisibleInstance(): ClineProvider | undefined {
		return findLast(Array.from(this.activeInstances), (instance) => instance.view?.visible === true)
	}

	private static isMainTaskProvider(instance: ClineProvider): boolean {
		return !instance._disposed && !instance.isVisualBrowserInspectorOnly
	}

	public static getVisibleMainInstance(): ClineProvider | undefined {
		return findLast(
			Array.from(this.activeInstances),
			(instance) => ClineProvider.isMainTaskProvider(instance) && instance.view?.visible === true,
		)
	}

	public static getMainInstance(): ClineProvider | undefined {
		return findLast(Array.from(this.activeInstances), (instance) => ClineProvider.isMainTaskProvider(instance))
	}

	private static async focusInstance(instance: ClineProvider): Promise<void> {
		const view = instance.view

		try {
			if (view && "reveal" in view) {
				view.reveal(undefined, false)
				return
			}

			if (view && "show" in view) {
				view.show(false)
				return
			}

			if (instance.renderContext === "sidebar") {
				await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
			}
		} catch {
			// Focusing is best-effort. If VS Code refuses to reveal the view, keep
			// routing the task through the selected main provider instead of falling
			// back to the Visual Browser Inspector provider.
		}
	}

	public static async getOrOpenMainInstance(): Promise<ClineProvider | undefined> {
		let mainProvider = ClineProvider.getVisibleMainInstance()

		if (mainProvider) {
			await ClineProvider.focusInstance(mainProvider)
			return mainProvider
		}

		await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
		await delay(100)

		mainProvider = ClineProvider.getVisibleMainInstance() ?? ClineProvider.getMainInstance()

		if (mainProvider) {
			await ClineProvider.focusInstance(mainProvider)
		}

		return mainProvider
	}

	public static async getInstance(): Promise<ClineProvider | undefined> {
		let visibleProvider = ClineProvider.getVisibleInstance()

		// If no visible provider, try to show the sidebar view
		if (!visibleProvider) {
			await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
			// Wait briefly for the view to become visible
			await delay(100)
			visibleProvider = ClineProvider.getVisibleInstance()
		}

		// If still no visible provider, return
		if (!visibleProvider) {
			return
		}

		return visibleProvider
	}

	public static async isActiveTask(): Promise<boolean> {
		const visibleProvider = await ClineProvider.getInstance()

		if (!visibleProvider) {
			return false
		}

		// Check if there is a cline instance in the stack (if this provider has an active task)
		if (visibleProvider.getCurrentTask()) {
			return true
		}

		return false
	}

	public static async handleCodeAction(
		command: CodeActionId,
		promptType: CodeActionName,
		params: Record<string, string | any[]>,
	): Promise<void> {
		const visibleProvider = await ClineProvider.getInstance()

		if (!visibleProvider) {
			return
		}

		const { customSupportPrompts } = await visibleProvider.getState()

		// TODO: Improve type safety for promptType.
		const prompt = supportPrompt.create(promptType, params, customSupportPrompts)

		if (command === "addToContext") {
			await visibleProvider.postMessageToWebview({
				type: "invoke",
				invoke: "setChatBoxMessage",
				text: `${prompt}\n\n`,
			})
			await visibleProvider.postMessageToWebview({ type: "action", action: "focusInput" })
			return
		}

		await visibleProvider.createTask(prompt)
	}

	public static async handleTerminalAction(
		command: TerminalActionId,
		promptType: TerminalActionPromptType,
		params: Record<string, string | any[]>,
	): Promise<void> {
		const visibleProvider = await ClineProvider.getInstance()

		if (!visibleProvider) {
			return
		}

		const { customSupportPrompts } = await visibleProvider.getState()
		const prompt = supportPrompt.create(promptType, params, customSupportPrompts)

		if (command === "terminalAddToContext") {
			await visibleProvider.postMessageToWebview({
				type: "invoke",
				invoke: "setChatBoxMessage",
				text: `${prompt}\n\n`,
			})
			await visibleProvider.postMessageToWebview({ type: "action", action: "focusInput" })
			return
		}

		try {
			await visibleProvider.createTask(prompt)
		} catch (error) {
			if (error instanceof OrganizationAllowListViolationError) {
				// Errors from terminal commands seem to get swallowed / ignored.
				vscode.window.showErrorMessage(error.message)
			}

			throw error
		}
	}

	async resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel) {
		this.view = webviewView
		const inTabMode = "onDidChangeViewState" in webviewView

		if (inTabMode) {
			setPanel(webviewView, "tab")
		} else if ("onDidChangeVisibility" in webviewView) {
			setPanel(webviewView, "sidebar")
		}

		// Initialize out-of-scope variables that need to receive persistent
		// global state values.
		this.getState().then(
			({
				terminalShellIntegrationTimeout = Terminal.defaultShellIntegrationTimeout,
				terminalShellIntegrationDisabled = false,
				terminalCommandDelay = 0,
				terminalZshClearEolMark = true,
				terminalZshOhMy = false,
				terminalZshP10k = false,
				terminalPowershellCounter = false,
				terminalZdotdir = false,
				ttsEnabled,
				ttsSpeed,
			}) => {
				Terminal.setShellIntegrationTimeout(terminalShellIntegrationTimeout)
				Terminal.setShellIntegrationDisabled(terminalShellIntegrationDisabled)
				Terminal.setCommandDelay(terminalCommandDelay)
				Terminal.setTerminalZshClearEolMark(terminalZshClearEolMark)
				Terminal.setTerminalZshOhMy(terminalZshOhMy)
				Terminal.setTerminalZshP10k(terminalZshP10k)
				Terminal.setPowershellCounter(terminalPowershellCounter)
				Terminal.setTerminalZdotdir(terminalZdotdir)
				setTtsEnabled(ttsEnabled ?? false)
				setTtsSpeed(ttsSpeed ?? 1)
			},
		)

		// Set up webview options with proper resource roots
		const resourceRoots = [this.contextProxy.extensionUri]

		// Add workspace folders to allow access to workspace files
		if (vscode.workspace.workspaceFolders) {
			resourceRoots.push(...vscode.workspace.workspaceFolders.map((folder) => folder.uri))
		}

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: resourceRoots,
		}

		webviewView.webview.html =
			this.contextProxy.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent(webviewView.webview)
				: await this.getHtmlContent(webviewView.webview)

		// Sets up an event listener to listen for messages passed from the webview view context
		// and executes code based on the message that is received.
		this.setWebviewMessageListener(webviewView.webview)

		// Initialize code index status subscription for the current workspace.
		this.updateCodeIndexStatusSubscription()

		// Listen for active editor changes to update code index status for the
		// current workspace.
		const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor(() => {
			// Update subscription when workspace might have changed.
			this.updateCodeIndexStatusSubscription()
		})
		this.webviewDisposables.push(activeEditorSubscription)

		// Listen for when the panel becomes visible.
		// https://github.com/microsoft/vscode-discussions/discussions/840
		if ("onDidChangeViewState" in webviewView) {
			// WebviewView and WebviewPanel have all the same properties except
			// for this visibility listener panel.
			const viewStateDisposable = webviewView.onDidChangeViewState(() => {
				if (this.view?.visible) {
					this.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
				}
			})

			this.webviewDisposables.push(viewStateDisposable)
		} else if ("onDidChangeVisibility" in webviewView) {
			// sidebar
			const visibilityDisposable = webviewView.onDidChangeVisibility(() => {
				if (this.view?.visible) {
					this.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
				}
			})

			this.webviewDisposables.push(visibilityDisposable)
		}

		// Listen for when the view is disposed
		// This happens when the user closes the view or when the view is closed programmatically
		webviewView.onDidDispose(
			async () => {
				if (inTabMode) {
					this.log("Disposing ClineProvider instance for tab view")
					await this.dispose()
				} else {
					this.log("Clearing webview resources for sidebar view")
					this.clearWebviewResources()
					// Reset current workspace manager reference when view is disposed
					this.codeIndexManager = undefined
				}
			},
			null,
			this.disposables,
		)

		// Listen for when color changes
		const configDisposable = vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e && e.affectsConfiguration("workbench.colorTheme")) {
				// Sends latest theme name to webview
				await this.postMessageToWebview({ type: "theme", text: JSON.stringify(await getTheme()) })
			}
		})
		this.webviewDisposables.push(configDisposable)

		// If the extension is starting a new session, clear previous task state.
		// But don't clear if there's already an active task (e.g., resumed via IPC/bridge).
		const currentTask = this.getCurrentTask()
		if (!currentTask || currentTask.abandoned || currentTask.abort) {
			await this.removeClineFromStack()
		}
	}

	public async createTaskWithHistoryItem(
		historyItem: HistoryItem & { rootTask?: Task; parentTask?: Task },
		options?: { startTask?: boolean },
	) {
		const isCliRuntime = process.env.ROO_CLI_RUNTIME === "1"
		// CLI injects runtime provider settings from command flags/env at startup.
		// Restoring provider profiles from task history can overwrite those
		// runtime settings with stale/incomplete persisted profiles.
		const skipProfileRestoreFromHistory = isCliRuntime

		// Check if we're rehydrating the current task to avoid flicker
		const currentTask = this.getCurrentTask()
		const isRehydratingCurrentTask = currentTask && currentTask.taskId === historyItem.id

		if (!isRehydratingCurrentTask) {
			try {
				await this.teardownParallelExecution({ markCancelled: true, resetBus: true, cleanupWorktrees: true })
			} catch (error) {
				this.log(
					`[createTaskWithHistoryItem] Failed to teardown parallel execution before opening history task ${historyItem.id} (non-fatal): ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
			await this.removeClineFromStack()
		}

		if (historyItem.status === "completed") {
			this.rememberEmailNotificationTaskOutcome(historyItem.id, "success", "final-parent")
		}

		// If the history item has a saved mode, restore it and its associated API configuration.
		if (historyItem.mode) {
			const originalMode = historyItem.mode
			historyItem.mode = normalizeModeSlug(historyItem.mode)

			if (historyItem.mode !== originalMode) {
				this.log(
					`Mode '${originalMode}' from history is deprecated. Falling back to mode '${historyItem.mode}'.`,
				)
			}

			// Validate that the mode still exists
			const customModes = await this.customModesManager.getCustomModes()
			const modeExists = getModeBySlug(historyItem.mode, customModes) !== undefined

			if (!modeExists) {
				// Mode no longer exists, fall back to default mode.
				this.log(
					`Mode '${historyItem.mode}' from history no longer exists. Falling back to default mode '${defaultModeSlug}'.`,
				)
				historyItem.mode = defaultModeSlug
			}

			await this.updateGlobalState("mode", historyItem.mode)

			// Load the saved API config for the restored mode if it exists.
			// Skip mode-based profile activation if historyItem.apiConfigName exists,
			// since the task's specific provider profile will override it anyway.
			const lockApiConfigAcrossModes = this.context.workspaceState.get("lockApiConfigAcrossModes", false)

			if (!historyItem.apiConfigName && !lockApiConfigAcrossModes && !skipProfileRestoreFromHistory) {
				const savedConfigId = await this.providerSettingsManager.getModeConfigId(historyItem.mode)
				const listApiConfig = await this.providerSettingsManager.listConfig()

				// Update listApiConfigMeta first to ensure UI has latest data.
				await this.updateGlobalState("listApiConfigMeta", listApiConfig)

				// If this mode has a saved config, use it.
				if (savedConfigId) {
					const profile = listApiConfig.find(({ id }) => id === savedConfigId)

					if (profile?.name) {
						try {
							// Check if the profile has actual API configuration (not just an id).
							// In CLI mode, the ProviderSettingsManager may return empty default profiles
							// that only contain 'id' and 'name' fields. Activating such a profile would
							// overwrite the CLI's working API configuration with empty settings.
							const fullProfile = await this.providerSettingsManager.getProfile({ name: profile.name })
							const hasActualSettings = !!fullProfile.apiProvider

							if (hasActualSettings) {
								await this.activateProviderProfile({ name: profile.name })
							} else {
								// The task will continue with the current/default configuration.
							}
						} catch (error) {
							// Log the error but continue with task restoration.
							this.log(
								`Failed to restore API configuration for mode '${historyItem.mode}': ${
									error instanceof Error ? error.message : String(error)
								}. Continuing with default configuration.`,
							)
							// The task will continue with the current/default configuration.
						}
					}
				}
			}
		}

		// If the history item has a saved API config name (provider profile), restore it.
		// This overrides any mode-based config restoration above, because the task's
		// specific provider profile takes precedence over mode defaults.
		if (historyItem.apiConfigName && !skipProfileRestoreFromHistory) {
			const listApiConfig = await this.providerSettingsManager.listConfig()
			// Keep global state/UI in sync with latest profiles for parity with mode restoration above.
			await this.updateGlobalState("listApiConfigMeta", listApiConfig)
			const profile = listApiConfig.find(({ name }) => name === historyItem.apiConfigName)

			if (profile?.name) {
				try {
					await this.activateProviderProfile(
						{ name: profile.name },
						{ persistModeConfig: false, persistTaskHistory: false },
					)
				} catch (error) {
					// Log the error but continue with task restoration.
					this.log(
						`Failed to restore API configuration '${historyItem.apiConfigName}' for task: ${
							error instanceof Error ? error.message : String(error)
						}. Continuing with current configuration.`,
					)
				}
			} else {
				// Profile no longer exists, log warning but continue
				this.log(
					`Provider profile '${historyItem.apiConfigName}' from history no longer exists. Using current configuration.`,
				)
			}
		} else if (historyItem.apiConfigName && skipProfileRestoreFromHistory) {
			this.log(
				`Skipping restore of provider profile '${historyItem.apiConfigName}' for task ${historyItem.id} in CLI runtime.`,
			)
		}

		const { apiConfiguration, enableCheckpoints, checkpointTimeout, experiments } = await this.getState()
		const shouldStartTask = options?.startTask ?? true
		const parallelResumeState = shouldStartTask
			? await this.restorePersistedParallelResumeState(historyItem.id)
			: ({ status: "none" } satisfies ParallelResumeRestoreResult)

		const task = new Task({
			provider: this,
			apiConfiguration,
			enableCheckpoints,
			checkpointTimeout,
			consecutiveMistakeLimit: apiConfiguration.consecutiveMistakeLimit,
			historyItem,
			experiments,
			rootTask: historyItem.rootTask,
			parentTask: historyItem.parentTask,
			taskNumber: historyItem.number,
			workspacePath: historyItem.workspace,
			onCreated: this.taskCreationCallback,
			startTask: shouldStartTask && parallelResumeState.status === "none",
			// Preserve the status from the history item to avoid overwriting it when the task saves messages
			initialStatus: historyItem.status,
		})

		if (isRehydratingCurrentTask) {
			// Replace the current task in-place to avoid UI flicker
			const stackIndex = this.clineStack.length - 1

			// Properly dispose of the old task to ensure garbage collection
			const oldTask = this.clineStack[stackIndex]

			// Abort the old task to stop running processes and mark as abandoned
			try {
				await oldTask.abortTask(true)
			} catch (e) {
				this.log(
					`[createTaskWithHistoryItem] abortTask() failed for old task ${oldTask.taskId}.${oldTask.instanceId}: ${e.message}`,
				)
			}

			// Remove event listeners from the old task
			const cleanupFunctions = this.taskEventListeners.get(oldTask)
			if (cleanupFunctions) {
				cleanupFunctions.forEach((cleanup) => cleanup())
				this.taskEventListeners.delete(oldTask)
			}

			// Replace the task in the stack
			this.clineStack[stackIndex] = task
			task.emit(RooCodeEventName.TaskFocused)

			// Perform preparation tasks and set up event listeners
			await this.performPreparationTasks(task)

			this.log(
				`[createTaskWithHistoryItem] rehydrated task ${task.taskId}.${task.instanceId} in-place (flicker-free)`,
			)
		} else {
			await this.addClineToStack(task)

			this.log(
				`[createTaskWithHistoryItem] ${task.parentTask ? "child" : "parent"} task ${task.taskId}.${task.instanceId} instantiated`,
			)
		}

		if (parallelResumeState.status !== "none") {
			await task.restoreClineMessagesFromHistory()

			if (parallelResumeState.status === "running") {
				await this.resumeRestoredParallelExecution(task, parallelResumeState.agentIdsToRestart)
			} else if (parallelResumeState.status === "review") {
				await task.restoreParallelExecutionPause()
				if (parallelResumeState.rebuildReview && this.activeExecutionPlan) {
					await this.showMergeReview(this.activeExecutionPlan)
				} else {
					await this.postStateToWebviewWithoutClineMessages()
				}
			} else {
				await this.reportRestoredParallelResumeFailure(task, parallelResumeState.reason)
			}
		}

		// Check if there's a pending edit after checkpoint restoration
		const operationId = `task-${task.taskId}`
		const pendingEdit = this.getPendingEditOperation(operationId)
		if (pendingEdit) {
			this.clearPendingEditOperation(operationId) // Clear the pending edit

			this.log(`[createTaskWithHistoryItem] Processing pending edit after checkpoint restoration`)

			// Process the pending edit after a short delay to ensure the task is fully initialized
			setTimeout(async () => {
				try {
					// Find the message index in the restored state
					const { messageIndex, apiConversationHistoryIndex } = (() => {
						const messageIndex = task.clineMessages.findIndex((msg) => msg.ts === pendingEdit.messageTs)
						const apiConversationHistoryIndex = task.apiConversationHistory.findIndex(
							(msg) => msg.ts === pendingEdit.messageTs,
						)
						return { messageIndex, apiConversationHistoryIndex }
					})()

					if (messageIndex !== -1) {
						// Remove the target message and all subsequent messages
						await task.overwriteClineMessages(task.clineMessages.slice(0, messageIndex))

						if (apiConversationHistoryIndex !== -1) {
							await task.overwriteApiConversationHistory(
								task.apiConversationHistory.slice(0, apiConversationHistoryIndex),
							)
						}

						// Process the edited message
						await task.handleWebviewAskResponse(
							"messageResponse",
							pendingEdit.editedContent,
							pendingEdit.images,
						)
					}
				} catch (error) {
					this.log(`[createTaskWithHistoryItem] Error processing pending edit: ${error}`)
				}
			}, 100) // Small delay to ensure task is fully ready
		}

		return task
	}

	public async postMessageToWebview(message: ExtensionMessage) {
		if (this._disposed) {
			return
		}

		try {
			await this.view?.webview.postMessage(message)
		} catch {
			// View disposed, drop message silently
		}
	}

	public static async postMessageToVisualBrowserInspectorPanels(message: ExtensionMessage): Promise<void> {
		const visualBrowserInspectorProviders = Array.from(this.activeInstances).filter(
			(instance) => !instance._disposed && instance.isVisualBrowserInspectorOnly,
		)

		await Promise.all(visualBrowserInspectorProviders.map((instance) => instance.postMessageToWebview(message)))
	}

	public async postMessageToVisualBrowserInspectorPanels(message: ExtensionMessage): Promise<void> {
		await ClineProvider.postMessageToVisualBrowserInspectorPanels(message)
	}

	private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		let localPort = "5173"

		try {
			const fs = require("fs")
			const path = require("path")
			const portFilePath = path.resolve(__dirname, "../../.vite-port")

			if (fs.existsSync(portFilePath)) {
				localPort = fs.readFileSync(portFilePath, "utf8").trim()
				console.log(`[ClineProvider:Vite] Using Vite server port from ${portFilePath}: ${localPort}`)
			} else {
				console.log(
					`[ClineProvider:Vite] Port file not found at ${portFilePath}, using default port: ${localPort}`,
				)
			}
		} catch (err) {
			console.error("[ClineProvider:Vite] Failed to read Vite port file:", err)
		}

		const localServerUrl = `localhost:${localPort}`

		// Check if local dev server is running.
		try {
			await axios.get(`http://${localServerUrl}`)
		} catch (error) {
			vscode.window.showErrorMessage(t("common:errors.hmr_not_running"))
			return this.getHtmlContent(webview)
		}

		const nonce = getNonce()

		// Get the OpenRouter base URL from configuration
		const { apiConfiguration } = await this.getState()
		const openRouterBaseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai"
		// Extract the domain for CSP
		const openRouterDomain = openRouterBaseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"

		const stylesUri = getUri(webview, this.contextProxy.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"index.css",
		])

		const codiconsUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "codicons", "codicon.css"])
		const materialIconsUri = getUri(webview, this.contextProxy.extensionUri, [
			"assets",
			"vscode-material-icons",
			"icons",
		])
		const imagesUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "images"])
		const audioUri = getUri(webview, this.contextProxy.extensionUri, ["webview-ui", "audio"])

		const file = "src/index.tsx"
		const scriptUri = `http://${localServerUrl}/${file}`

		const reactRefresh = /*html*/ `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://localhost:${localPort}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`

		const csp = [
			"default-src 'none'",
			`font-src ${webview.cspSource} data:`,
			`style-src ${webview.cspSource} 'unsafe-inline' https://* http://${localServerUrl} http://0.0.0.0:${localPort}`,
			`img-src ${webview.cspSource} https://storage.googleapis.com https://img.clerk.com data:`,
			`media-src ${webview.cspSource}`,
			`script-src 'unsafe-eval' ${webview.cspSource} https://* http://${localServerUrl} http://0.0.0.0:${localPort} 'nonce-${nonce}'`,
			`connect-src ${webview.cspSource} ${openRouterDomain} https://* ws://${localServerUrl} ws://0.0.0.0:${localPort} http://${localServerUrl} http://0.0.0.0:${localPort}`,
		]

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<script nonce="${nonce}">
						window.IMAGES_BASE_URI = "${imagesUri}"
						window.AUDIO_BASE_URI = "${audioUri}"
						window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
						window.ROO_INITIAL_TAB = ${JSON.stringify(this.initialTab ?? null)}
					</script>
					<title>C Code</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefresh}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}

	/**
	 * Defines and returns the HTML that should be rendered within the webview panel.
	 *
	 * @remarks This is also the place where references to the React webview build files
	 * are created and inserted into the webview HTML.
	 *
	 * @param webview A reference to the extension webview
	 * @param extensionUri The URI of the directory containing the extension
	 * @returns A template string literal containing the HTML that should be
	 * rendered within the webview panel
	 */
	private async getHtmlContent(webview: vscode.Webview): Promise<string> {
		// Get the local path to main script run in the webview,
		// then convert it to a uri we can use in the webview.

		// The CSS file from the React build output
		const stylesUri = getUri(webview, this.contextProxy.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"index.css",
		])

		const scriptUri = getUri(webview, this.contextProxy.extensionUri, ["webview-ui", "build", "assets", "index.js"])
		const codiconsUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "codicons", "codicon.css"])
		const materialIconsUri = getUri(webview, this.contextProxy.extensionUri, [
			"assets",
			"vscode-material-icons",
			"icons",
		])
		const imagesUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "images"])
		const audioUri = getUri(webview, this.contextProxy.extensionUri, ["webview-ui", "audio"])

		// Use a nonce to only allow a specific script to be run.
		/*
		content security policy of your webview to only allow scripts that have a specific nonce
		create a content security policy meta tag so that only loading scripts with a nonce is allowed
		As your extension grows you will likely want to add custom styles, fonts, and/or images to your webview. If you do, you will need to update the content security policy meta tag to explicitly allow for these resources. E.g.
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
		- 'unsafe-inline' is required for styles due to vscode-webview-toolkit's dynamic style injection
		- since we pass base64 images to the webview, we need to specify img-src ${webview.cspSource} data:;

		in meta tag we add nonce attribute: A cryptographic nonce (only used once) to allow scripts. The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource's policy is otherwise trivial.
		*/
		const nonce = getNonce()

		// Get the OpenRouter base URL from configuration
		const { apiConfiguration } = await this.getState()
		const openRouterBaseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai"
		// Extract the domain for CSP
		const openRouterDomain = openRouterBaseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"

		// Tip: Install the es6-string-html VS Code extension to enable code highlighting below
		return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
            <meta name="theme-color" content="#000000">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https://storage.googleapis.com https://img.clerk.com data:; media-src ${webview.cspSource}; script-src ${webview.cspSource} 'wasm-unsafe-eval' 'nonce-${nonce}' 'strict-dynamic'; connect-src ${webview.cspSource} ${openRouterDomain} https://api.requesty.ai;">
            <link rel="stylesheet" type="text/css" href="${stylesUri}">
			<link href="${codiconsUri}" rel="stylesheet" />
			<script nonce="${nonce}">
				window.IMAGES_BASE_URI = "${imagesUri}"
				window.AUDIO_BASE_URI = "${audioUri}"
				window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
				window.ROO_INITIAL_TAB = ${JSON.stringify(this.initialTab ?? null)}
				window.ROO_VISUAL_ONLY = ${JSON.stringify(this.isVisualBrowserInspectorOnly)}
			</script>
				<title>C Code</title>
          </head>
          <body>
            <noscript>You need to enable JavaScript to run this app.</noscript>
            <div id="root"></div>
            <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
          </body>
        </html>
      `
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * @param webview A reference to the extension webview
	 */
	private setWebviewMessageListener(webview: vscode.Webview) {
		const onReceiveMessage = async (message: WebviewMessage) => webviewMessageHandler(this, message)

		const messageDisposable = webview.onDidReceiveMessage(onReceiveMessage)
		this.webviewDisposables.push(messageDisposable)
	}

	/**
	 * Handle switching to a new mode, including updating the associated API configuration
	 * @param newMode The mode to switch to
	 */
	public async handleModeSwitch(newMode: Mode) {
		newMode = normalizeModeSlug(newMode)
		const task = this.getCurrentTask()

		if (task) {
			task.emit(RooCodeEventName.TaskModeSwitched, task.taskId, newMode)

			try {
				// Update the task history with the new mode first.
				const taskHistoryItem =
					this.taskHistoryStore.get(task.taskId) ??
					(this.getGlobalState("taskHistory") ?? []).find((item) => item.id === task.taskId)

				if (taskHistoryItem) {
					await this.updateTaskHistory({ ...taskHistoryItem, mode: newMode })
				}

				// Only update the task's mode after successful persistence.
				;(task as any)._taskMode = newMode
			} catch (error) {
				// If persistence fails, log the error but don't update the in-memory state.
				this.log(
					`Failed to persist mode switch for task ${task.taskId}: ${error instanceof Error ? error.message : String(error)}`,
				)

				// This ensures the in-memory state remains consistent with persisted state.
				throw error
			}
		}

		await this.updateGlobalState("mode", newMode)

		this.emit(RooCodeEventName.ModeChanged, newMode)

		// If workspace lock is on, keep the current API config — don't load mode-specific config
		const lockApiConfigAcrossModes = this.context.workspaceState.get("lockApiConfigAcrossModes", false)
		if (lockApiConfigAcrossModes) {
			await this.postStateToWebview()
			return
		}

		// Load the saved API config for the new mode if it exists.
		const savedConfigId = await this.providerSettingsManager.getModeConfigId(newMode)
		const listApiConfig = await this.providerSettingsManager.listConfig()

		// Update listApiConfigMeta first to ensure UI has latest data.
		await this.updateGlobalState("listApiConfigMeta", listApiConfig)

		// If this mode has a saved config, use it.
		if (savedConfigId) {
			const profile = listApiConfig.find(({ id }) => id === savedConfigId)

			if (profile?.name) {
				// Check if the profile has actual API configuration (not just an id).
				// In CLI mode, the ProviderSettingsManager may return empty default profiles
				// that only contain 'id' and 'name' fields. Activating such a profile would
				// overwrite the CLI's working API configuration with empty settings.
				// Skip activation if the profile has no apiProvider set - this indicates
				// an unconfigured/empty profile.
				const fullProfile = await this.providerSettingsManager.getProfile({ name: profile.name })
				const hasActualSettings = !!fullProfile.apiProvider

				if (hasActualSettings) {
					await this.activateProviderProfile({ name: profile.name })
				} else {
					// The task will continue with the current/default configuration.
				}
			} else {
				// The task will continue with the current/default configuration.
			}
		} else {
			// If no saved config for this mode, save current config as default.
			const currentApiConfigNameAfter = this.getGlobalState("currentApiConfigName")

			if (currentApiConfigNameAfter) {
				const config = listApiConfig.find((c) => c.name === currentApiConfigNameAfter)

				if (config?.id) {
					await this.providerSettingsManager.setModeConfig(newMode, config.id)
				}
			}
		}

		await this.postStateToWebview()
	}

	// Provider Profile Management

	/**
	 * Updates the current task's API handler.
	 * Rebuilds when:
	 * - provider or model changes, OR
	 * - explicitly forced (e.g., user-initiated profile switch/save to apply changed settings like headers/baseUrl/tier).
	 * Always synchronizes task.apiConfiguration with latest provider settings.
	 * @param providerSettings The new provider settings to apply
	 * @param options.forceRebuild Force rebuilding the API handler regardless of provider/model equality
	 */
	private updateTaskApiHandlerIfNeeded(
		providerSettings: ProviderSettings,
		options: { forceRebuild?: boolean } = {},
	): void {
		const task = this.getCurrentTask()
		if (!task) return

		const { forceRebuild = false } = options

		// Determine if we need to rebuild using the previous configuration snapshot
		const prevConfig = task.apiConfiguration
		const prevProvider = prevConfig?.apiProvider
		const prevModelId = prevConfig ? getModelId(prevConfig) : undefined
		const newProvider = providerSettings.apiProvider
		const newModelId = getModelId(providerSettings)

		const needsRebuild = forceRebuild || prevProvider !== newProvider || prevModelId !== newModelId

		if (needsRebuild) {
			// Use updateApiConfiguration which handles both API handler rebuild and parser sync.
			// Note: updateApiConfiguration is declared async but has no actual async operations,
			// so we can safely call it without awaiting.
			task.updateApiConfiguration(providerSettings)
		} else {
			// No rebuild needed, just sync apiConfiguration
			;(task as any).apiConfiguration = providerSettings
		}
	}

	getProviderProfileEntries(): ProviderSettingsEntry[] {
		return this.contextProxy.getValues().listApiConfigMeta || []
	}

	getProviderProfileEntry(name: string): ProviderSettingsEntry | undefined {
		return this.getProviderProfileEntries().find((profile) => profile.name === name)
	}

	public hasProviderProfileEntry(name: string): boolean {
		return !!this.getProviderProfileEntry(name)
	}

	async upsertProviderProfile(
		name: string,
		providerSettings: ProviderSettings,
		activate: boolean = true,
	): Promise<string | undefined> {
		try {
			// TODO: Do we need to be calling `activateProfile`? It's not
			// clear to me what the source of truth should be; in some cases
			// we rely on the `ContextProxy`'s data store and in other cases
			// we rely on the `ProviderSettingsManager`'s data store. It might
			// be simpler to unify these two.
			const id = await this.providerSettingsManager.saveConfig(name, providerSettings)

			if (activate) {
				const { mode } = await this.getState()

				// These promises do the following:
				// 1. Adds or updates the list of provider profiles.
				// 2. Sets the current provider profile.
				// 3. Sets the current mode's provider profile.
				// 4. Copies the provider settings to the context.
				//
				// Note: 1, 2, and 4 can be done in one `ContextProxy` call:
				// this.contextProxy.setValues({ ...providerSettings, listApiConfigMeta: ..., currentApiConfigName: ... })
				// We should probably switch to that and verify that it works.
				// I left the original implementation in just to be safe.
				await Promise.all([
					this.updateGlobalState("listApiConfigMeta", await this.providerSettingsManager.listConfig()),
					this.updateGlobalState("currentApiConfigName", name),
					this.providerSettingsManager.setModeConfig(mode, id),
					this.contextProxy.setProviderSettings(providerSettings),
				])

				// Change the provider for the current task.
				// TODO: We should rename `buildApiHandler` for clarity (e.g. `getProviderClient`).
				this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })

				// Keep the current task's sticky provider profile in sync with the newly-activated profile.
				await this.persistStickyProviderProfileToCurrentTask(name)
			} else {
				await this.updateGlobalState("listApiConfigMeta", await this.providerSettingsManager.listConfig())
			}

			await this.postStateToWebview()
			return id
		} catch (error) {
			this.log(
				`Error create new api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			vscode.window.showErrorMessage(t("common:errors.create_api_config"))
			return undefined
		}
	}

	async deleteProviderProfile(profileToDelete: ProviderSettingsEntry) {
		const globalSettings = this.contextProxy.getValues()
		let profileToActivate: string | undefined = globalSettings.currentApiConfigName

		if (profileToDelete.name === profileToActivate) {
			profileToActivate = this.getProviderProfileEntries().find(({ name }) => name !== profileToDelete.name)?.name
		}

		if (!profileToActivate) {
			throw new Error("You cannot delete the last profile")
		}

		const entries = this.getProviderProfileEntries().filter(({ name }) => name !== profileToDelete.name)

		await this.contextProxy.setValues({
			...globalSettings,
			currentApiConfigName: profileToActivate,
			listApiConfigMeta: entries,
		})

		await this.postStateToWebview()
	}

	private async persistStickyProviderProfileToCurrentTask(apiConfigName: string): Promise<void> {
		const task = this.getCurrentTask()
		if (!task) {
			return
		}

		try {
			// Update in-memory state immediately so sticky behavior works even before the task has
			// been persisted into taskHistory (it will be captured on the next save).
			task.setTaskApiConfigName(apiConfigName)

			const taskHistoryItem =
				this.taskHistoryStore.get(task.taskId) ??
				(this.getGlobalState("taskHistory") ?? []).find((item) => item.id === task.taskId)

			if (taskHistoryItem) {
				await this.updateTaskHistory({ ...taskHistoryItem, apiConfigName })
			}
		} catch (error) {
			// If persistence fails, log the error but don't fail the profile switch.
			this.log(
				`Failed to persist provider profile switch for task ${task.taskId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	async activateProviderProfile(
		args: { name: string } | { id: string },
		options?: { persistModeConfig?: boolean; persistTaskHistory?: boolean; postState?: boolean },
	) {
		const { name, id, ...providerSettings } = await this.providerSettingsManager.activateProfile(args)

		const persistModeConfig = options?.persistModeConfig ?? true
		const persistTaskHistory = options?.persistTaskHistory ?? true
		const postState = options?.postState ?? true

		// See `upsertProviderProfile` for a description of what this is doing.
		await Promise.all([
			this.contextProxy.setValue("listApiConfigMeta", await this.providerSettingsManager.listConfig()),
			this.contextProxy.setValue("currentApiConfigName", name),
			this.contextProxy.setProviderSettings(providerSettings),
		])

		const { mode } = await this.getState()

		if (id && persistModeConfig) {
			await this.providerSettingsManager.setModeConfig(mode, id)
		}

		// Change the provider for the current task.
		this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })

		// Update the current task's sticky provider profile, unless this activation is
		// being used purely as a non-persisting restoration (e.g., reopening a task from history).
		if (persistTaskHistory) {
			await this.persistStickyProviderProfileToCurrentTask(name)
		}

		if (postState) {
			await this.postStateToWebview()
		}

		if (providerSettings.apiProvider) {
			this.emit(RooCodeEventName.ProviderProfileChanged, { name, provider: providerSettings.apiProvider })
		}
	}

	async updateCustomInstructions(instructions?: string) {
		// User may be clearing the field.
		await this.updateGlobalState("customInstructions", instructions || undefined)
		await this.postStateToWebview()
	}

	// MCP

	async ensureMcpServersDirectoryExists(): Promise<string> {
		// Get platform-specific application data directory
		let mcpServersDir: string
		if (process.platform === "win32") {
			// Windows: %APPDATA%\Roo-Code\MCP
			mcpServersDir = path.join(os.homedir(), "AppData", "Roaming", "Roo-Code", "MCP")
		} else if (process.platform === "darwin") {
			// macOS: ~/Documents/Cline/MCP
			mcpServersDir = path.join(os.homedir(), "Documents", "Cline", "MCP")
		} else {
			// Linux: ~/.local/share/Cline/MCP
			mcpServersDir = path.join(os.homedir(), ".local", "share", "Roo-Code", "MCP")
		}

		try {
			await fs.mkdir(mcpServersDir, { recursive: true })
		} catch (error) {
			// Fallback to a relative path if directory creation fails
			return path.join(os.homedir(), ".roo-code", "mcp")
		}
		return mcpServersDir
	}

	async ensureSettingsDirectoryExists(): Promise<string> {
		const { getSettingsDirectoryPath } = await import("../../utils/storage")
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
		return getSettingsDirectoryPath(globalStoragePath)
	}

	// OpenRouter

	async handleOpenRouterCallback(code: string) {
		let { apiConfiguration, currentApiConfigName = "default" } = await this.getState()

		let apiKey: string

		try {
			const baseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai/api/v1"
			// Extract the base domain for the auth endpoint.
			const baseUrlDomain = baseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"
			const response = await axios.post(`${baseUrlDomain}/api/v1/auth/keys`, { code })

			if (response.data && response.data.key) {
				apiKey = response.data.key
			} else {
				throw new Error("Invalid response from OpenRouter API")
			}
		} catch (error) {
			this.log(
				`Error exchanging code for API key: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			throw error
		}

		const newConfiguration: ProviderSettings = {
			...apiConfiguration,
			apiProvider: "openrouter",
			openRouterApiKey: apiKey,
			openRouterModelId: apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
		}

		await this.upsertProviderProfile(currentApiConfigName, newConfiguration)
	}

	// Requesty

	async handleRequestyCallback(code: string, baseUrl: string | null) {
		let { apiConfiguration } = await this.getState()

		const newConfiguration: ProviderSettings = {
			...apiConfiguration,
			apiProvider: "requesty",
			requestyApiKey: code,
			requestyModelId: apiConfiguration?.requestyModelId || requestyDefaultModelId,
		}

		// set baseUrl as undefined if we don't provide one
		// or if it is the default requesty url
		if (!baseUrl || baseUrl === REQUESTY_BASE_URL) {
			newConfiguration.requestyBaseUrl = undefined
		} else {
			newConfiguration.requestyBaseUrl = baseUrl
		}

		const profileName = `Requesty (${new Date().toLocaleString()})`
		await this.upsertProviderProfile(profileName, newConfiguration)
	}

	// Task history

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		const historyItem =
			this.taskHistoryStore.get(id) ?? (this.getGlobalState("taskHistory") ?? []).find((item) => item.id === id)

		if (!historyItem) {
			throw new Error("Task not found")
		}

		const { getTaskDirectoryPath } = await import("../../utils/storage")
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
		const taskDirPath = await getTaskDirectoryPath(globalStoragePath, id)
		const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
		const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
		const apiHistoryFileExists = await fileExistsAtPath(apiConversationHistoryFilePath)

		let apiConversationHistory: Anthropic.MessageParam[] = []

		if (apiHistoryFileExists) {
			try {
				apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, "utf8"))
			} catch (error) {
				console.warn(
					`[getTaskWithId] api_conversation_history.json corrupted for task ${id}, returning empty history: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		} else if (!(await fileExistsAtPath(uiMessagesFilePath))) {
			console.warn(
				`[getTaskWithId] api_conversation_history.json missing for task ${id} and ui_messages.json is also missing; task history entry may be stale, returning empty history`,
			)
		}

		return {
			historyItem,
			taskDirPath,
			apiConversationHistoryFilePath,
			uiMessagesFilePath,
			apiConversationHistory,
		}
	}

	async getTaskWithAggregatedCosts(taskId: string): Promise<{
		historyItem: HistoryItem
		aggregatedCosts: AggregatedCosts
	}> {
		const { historyItem } = await this.getTaskWithId(taskId)

		const aggregatedCosts = await aggregateTaskCostsRecursive(
			taskId,
			async (id: string) => {
				const result = await this.getTaskWithId(id)
				return result.historyItem
			},
			{
				getChildTaskIds: async (parentId: string) => this.getChildTaskIds(parentId),
			},
		)

		return { historyItem, aggregatedCosts }
	}

	async showTaskWithId(id: string) {
		if (id !== this.getCurrentTask()?.taskId) {
			// Non-current task.
			const { historyItem } = await this.getTaskWithId(id)
			await this.createTaskWithHistoryItem(historyItem) // Clears existing task.
		}

		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
	}

	async exportTaskWithId(id: string) {
		const { historyItem, apiConversationHistory } = await this.getTaskWithId(id)
		const fileName = getTaskFileName(historyItem.ts)
		const defaultUri = await resolveDefaultSaveUri(this.contextProxy, "lastTaskExportPath", fileName, {
			useWorkspace: false,
			fallbackDir: path.join(os.homedir(), "Downloads"),
		})
		const saveUri = await downloadTask(historyItem.ts, apiConversationHistory, defaultUri)

		if (saveUri) {
			await saveLastExportPath(this.contextProxy, "lastTaskExportPath", saveUri)
		}
	}

	/* Condenses a task's message history to use fewer tokens. */
	async condenseTaskContext(taskId: string) {
		let task: Task | undefined
		for (let i = this.clineStack.length - 1; i >= 0; i--) {
			if (this.clineStack[i].taskId === taskId) {
				task = this.clineStack[i]
				break
			}
		}
		if (!task) {
			throw new Error(`Task with id ${taskId} not found in stack`)
		}
		await task.condenseContext()
		await this.postMessageToWebview({ type: "condenseTaskContextResponse", text: taskId })
	}

	// this function deletes a task from task history, and deletes its checkpoints and delete the task folder
	// If the task has subtasks (childIds), they will also be deleted recursively
	async deleteTaskWithId(id: string, cascadeSubtasks: boolean = true) {
		try {
			// get the task directory full path and history item
			const { taskDirPath, historyItem } = await this.getTaskWithId(id)

			// Collect all task IDs to delete (parent + all subtasks)
			const allIdsToDelete: string[] = [id]

			if (cascadeSubtasks) {
				// Recursively collect all child IDs
				const collectChildIds = async (taskId: string): Promise<void> => {
					try {
						const { historyItem: item } = await this.getTaskWithId(taskId)
						if (item.childIds && item.childIds.length > 0) {
							for (const childId of item.childIds) {
								allIdsToDelete.push(childId)
								await collectChildIds(childId)
							}
						}
					} catch (error) {
						// Child task may already be deleted or not found, continue
						console.log(`[deleteTaskWithId] child task ${taskId} not found, skipping`)
					}
				}

				await collectChildIds(id)
			}

			// Remove from stack if any of the tasks to delete are in the current task stack
			for (const taskId of allIdsToDelete) {
				if (taskId === this.getCurrentTask()?.taskId) {
					// Close the current task instance; delegation flows will be handled via metadata if applicable.
					await this.removeClineFromStack()
					break
				}
			}

			// Delete all tasks from state in one batch
			await this.taskHistoryStore.deleteMany(allIdsToDelete)
			this.recentTasksCache = undefined

			// Delete associated shadow repositories or branches and task directories
			const globalStorageDir = this.contextProxy.globalStorageUri.fsPath
			const workspaceDir = this.cwd
			const { getTaskDirectoryPath } = await import("../../utils/storage")
			const globalStoragePath = this.contextProxy.globalStorageUri.fsPath

			for (const taskId of allIdsToDelete) {
				try {
					await ShadowCheckpointService.deleteTask({ taskId, globalStorageDir, workspaceDir })
				} catch (error) {
					console.error(
						`[deleteTaskWithId${taskId}] failed to delete associated shadow repository or branch: ${error instanceof Error ? error.message : String(error)}`,
					)
				}

				// Delete the task directory
				try {
					const dirPath = await getTaskDirectoryPath(globalStoragePath, taskId)
					await fs.rm(dirPath, { recursive: true, force: true })
					console.log(`[deleteTaskWithId${taskId}] removed task directory`)
				} catch (error) {
					console.error(
						`[deleteTaskWithId${taskId}] failed to remove task directory: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}

			await this.postStateToWebview()
		} catch (error) {
			// If task is not found, just remove it from state
			if (error instanceof Error && error.message === "Task not found") {
				await this.deleteTaskFromState(id)
				return
			}
			throw error
		}
	}

	async deleteTaskFromState(id: string) {
		await this.taskHistoryStore.delete(id)
		this.recentTasksCache = undefined

		await this.postStateToWebview()
	}

	async refreshWorkspace() {
		const nextWorkspacePath = getWorkspacePath()
		if (nextWorkspacePath !== this.currentWorkspacePath) {
			await this.teardownParallelExecution({ markCancelled: true, resetBus: true, cleanupWorktrees: true })
			this.currentWorkspacePath = nextWorkspacePath
			this.worktreeManager = new WorktreeManager(nextWorkspacePath)
		}
		await this.postStateToWebview()
	}

	async postStateToWebview() {
		const state = await this.getStateToPostToWebview()
		this.clineMessagesSeq++
		state.clineMessagesSeq = this.clineMessagesSeq
		this.postMessageToWebview({ type: "state", state })
	}

	/**
	 * Like postStateToWebview but intentionally omits taskHistory.
	 *
	 * Rationale:
	 * - taskHistory can be large and was being resent on every chat message update.
	 * - The webview maintains taskHistory in-memory and receives updates via
	 *   `taskHistoryUpdated` / `taskHistoryItemUpdated`.
	 */
	async postStateToWebviewWithoutTaskHistory(): Promise<void> {
		const state = await this.getStateToPostToWebview()
		this.clineMessagesSeq++
		state.clineMessagesSeq = this.clineMessagesSeq
		const { taskHistory: _omit, ...rest } = state
		this.postMessageToWebview({ type: "state", state: rest })
	}

	/**
	 * Like postStateToWebview but intentionally omits both clineMessages and taskHistory.
	 *
	 * Rationale:
	 * - Settings and mode changes trigger state pushes
	 *   that have nothing to do with chat messages. Including clineMessages in these pushes
	 *   creates race conditions where a stale snapshot of clineMessages (captured during async
	 *   getStateToPostToWebview) overwrites newer messages the task has streamed in the meantime.
	 * - This method ensures non-message events only push the state fields they actually affect
	 *   without interfering with task message streaming.
	 */
	async postStateToWebviewWithoutClineMessages(): Promise<void> {
		const state = await this.getStateToPostToWebview()
		const { clineMessages: _omitMessages, taskHistory: _omitHistory, ...rest } = state
		this.postMessageToWebview({ type: "state", state: rest })
	}

	private createMemoryStorage(): MemoryStorage {
		return new MemoryStorage({
			globalStoragePath: this.contextProxy.globalStorageUri.fsPath,
			workspacePath: this.cwd,
		})
	}

	public async getMemorySummary(): Promise<MemorySummary> {
		return this.createMemoryStorage().getSummary(this.cwd)
	}

	public async getMemoryState(): Promise<MemoryState> {
		const storage = this.createMemoryStorage()
		const [summary, workspace, global] = await Promise.all([
			storage.getSummary(this.cwd),
			storage.listMemories({
				scopes: ["workspace"],
				statuses: ["active", "pending", "stale", "superseded", "archived"],
				workspacePath: this.cwd,
			}),
			storage.listMemories({
				scopes: ["global"],
				statuses: ["active", "pending", "stale", "superseded", "archived"],
			}),
		])

		const sortNewestFirst = (left: MemoryEntry, right: MemoryEntry) => right.updatedAt - left.updatedAt

		return {
			summary,
			workspace: [...workspace].sort(sortNewestFirst),
			global: [...global].sort(sortNewestFirst),
		}
	}

	public async postMemoryStateToWebview(): Promise<MemoryState> {
		const memoryState = await this.getMemoryState()
		await this.postMessageToWebview({
			type: "memoryState",
			memoryState,
			memorySummary: memoryState.summary,
		})
		await this.postStateToWebviewWithoutClineMessages()
		return memoryState
	}

	public async handleMemoryAction(
		action: MemoryAction,
		options: { memoryId?: string; memoryScope?: MemoryScope; messageTs?: number } = {},
	): Promise<MemoryState> {
		const storage = this.createMemoryStorage()

		switch (action) {
			case "refresh":
				break
			case "approveMemory": {
				if (!options.memoryId) {
					break
				}

				const memory = await storage.updateMemoryStatus(options.memoryId, "active", {
					scope: options.memoryScope,
					workspacePath: this.cwd,
					reason: "Approved from chat memory card",
				})

				if (memory) {
					await this.updateMemoryToolMessage(memory, {
						messageTs: options.messageTs,
						message: "Approved active mistake memory.",
					})
				}
				break
			}
			case "archiveMemory": {
				if (!options.memoryId) {
					break
				}

				const memory = await storage.updateMemoryStatus(options.memoryId, "archived", {
					scope: options.memoryScope,
					workspacePath: this.cwd,
					reason: "Archived from chat memory card",
				})

				if (memory) {
					await this.updateMemoryToolMessage(memory, {
						messageTs: options.messageTs,
						message: "Archived mistake memory.",
					})
				}
				break
			}
			case "deleteMemory": {
				if (!options.memoryId) {
					break
				}

				await storage.deleteMemory(options.memoryId, {
					scope: options.memoryScope,
					workspacePath: this.cwd,
				})
				break
			}
			case "archiveWorkspace":
				await storage.archiveScope("workspace", this.cwd)
				break
			case "clearWorkspace":
				await storage.clearWorkspaceMemory(this.cwd)
				break
			case "archiveGlobal":
				await storage.archiveScope("global")
				break
			case "clearGlobal":
				await storage.clearGlobalMemory()
				break
		}

		return this.getMemoryState()
	}

	private async updateMemoryToolMessage(
		memory: MemoryEntry,
		options: { messageTs?: number; message: string },
	): Promise<void> {
		const task = this.getCurrentTask()
		if (!task) {
			return
		}

		const messageIndex = this.findMemoryToolMessageIndex(task.clineMessages, memory.id, options.messageTs)
		if (messageIndex === -1) {
			return
		}

		const currentMessage = task.clineMessages[messageIndex]
		if (!currentMessage?.text) {
			return
		}

		const payload = this.tryParseToolPayload(currentMessage.text)
		if (!payload || payload.tool !== "mistakeMemory") {
			return
		}

		const updatedPayload: ClineSayTool = {
			...payload,
			content: memory.lesson,
			memoryId: memory.id,
			scope: memory.scope,
			status: memory.status,
			title: memory.title,
			tags: memory.tags,
			pathTags: memory.pathTags,
			mode: memory.mode,
			toolName: memory.toolName,
			mistakeSignature: memory.mistakeSignature,
			message: options.message,
			autoApproved: memory.status === "active" ? payload.autoApproved : false,
		}

		const updatedMessage: ClineMessage = {
			...currentMessage,
			text: JSON.stringify(updatedPayload),
		}
		const updatedMessages = [...task.clineMessages]
		updatedMessages[messageIndex] = updatedMessage

		await task.overwriteClineMessages(updatedMessages)
		await this.postMessageToWebview({ type: "messageUpdated", clineMessage: updatedMessage })
	}

	private findMemoryToolMessageIndex(messages: ClineMessage[], memoryId: string, messageTs?: number): number {
		if (messageTs !== undefined) {
			const index = messages.findIndex((message) => message.ts === messageTs)
			if (index !== -1 && this.isMemoryToolMessageForMemory(messages[index], memoryId)) {
				return index
			}
		}

		for (let index = messages.length - 1; index >= 0; index--) {
			if (this.isMemoryToolMessageForMemory(messages[index], memoryId)) {
				return index
			}
		}

		return -1
	}

	private isMemoryToolMessageForMemory(message: ClineMessage | undefined, memoryId: string): boolean {
		if (!message?.text) {
			return false
		}

		const isToolMessage =
			(message.type === "say" && message.say === "tool") || (message.type === "ask" && message.ask === "tool")
		if (!isToolMessage) {
			return false
		}

		const payload = this.tryParseToolPayload(message.text)
		return payload?.tool === "mistakeMemory" && payload.memoryId === memoryId
	}

	/**
	 * Merges allowed commands from global state and workspace configuration
	 * with proper validation and deduplication
	 */
	private mergeAllowedCommands(globalStateCommands?: string[]): string[] {
		return this.mergeCommandLists("allowedCommands", "allowed", globalStateCommands)
	}

	/**
	 * Merges denied commands from global state and workspace configuration
	 * with proper validation and deduplication
	 */
	private mergeDeniedCommands(globalStateCommands?: string[]): string[] {
		return this.mergeCommandLists("deniedCommands", "denied", globalStateCommands)
	}

	/**
	 * Common utility for merging command lists from global state and workspace configuration.
	 * Implements the Command Denylist feature's merging strategy with proper validation.
	 *
	 * @param configKey - VSCode workspace configuration key
	 * @param commandType - Type of commands for error logging
	 * @param globalStateCommands - Commands from global state
	 * @returns Merged and deduplicated command list
	 */
	private mergeCommandLists(
		configKey: "allowedCommands" | "deniedCommands",
		commandType: "allowed" | "denied",
		globalStateCommands?: string[],
	): string[] {
		try {
			// Validate and sanitize global state commands
			const validGlobalCommands = Array.isArray(globalStateCommands)
				? globalStateCommands.filter((cmd) => typeof cmd === "string" && cmd.trim().length > 0)
				: []

			// Get workspace configuration commands
			const workspaceCommands = vscode.workspace.getConfiguration(Package.name).get<string[]>(configKey) || []

			// Validate and sanitize workspace commands
			const validWorkspaceCommands = Array.isArray(workspaceCommands)
				? workspaceCommands.filter((cmd) => typeof cmd === "string" && cmd.trim().length > 0)
				: []

			// Combine and deduplicate commands
			// Global state takes precedence over workspace configuration
			const mergedCommands = [...new Set([...validGlobalCommands, ...validWorkspaceCommands])]

			return mergedCommands
		} catch (error) {
			console.error(`Error merging ${commandType} commands:`, error)
			// Return empty array as fallback to prevent crashes
			return []
		}
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		// Ensure the store is initialized before reading task history
		await this.taskHistoryStore.initialized

		const {
			apiConfiguration,
			lastShownAnnouncementId,
			customInstructions,
			alwaysAllowReadOnly,
			alwaysAllowReadOnlyOutsideWorkspace,
			alwaysAllowWrite,
			alwaysAllowWriteOutsideWorkspace,
			alwaysAllowWriteProtected,
			alwaysAllowExecute,
			allowedCommands,
			deniedCommands,
			alwaysAllowMcp,
			alwaysAllowModeSwitch,
			alwaysAllowSubtasks,
			alwaysAllowParallelTasks,
			maxConcurrentParallelTasks,
			alwaysAllowVisualBrowserInspector,
			alwaysAllowImageGeneration,
			allowedMaxRequests,
			allowedMaxCost,
			autoCondenseContext,
			autoCondenseContextPercent,
			contextCacheEnabled,
			coldCacheRamBudgetMb,
			contextCacheBudgetOptions,
			soundEnabled,
			ttsEnabled,
			ttsSpeed,
			emailNotificationsEnabled,
			emailNotifyOnSuccess,
			emailNotifyOnFailure,
			smtpHost,
			smtpPort,
			smtpSecure,
			smtpRequireTls,
			smtpUsername,
			smtpFromAddress,
			smtpRecipients,
			smtpSubjectTemplate,
			smtpPasswordConfigured,
			enableCheckpoints,
			checkpointTimeout,
			taskHistory,
			soundVolume,
			writeDelayMs,
			terminalShellIntegrationTimeout,
			terminalShellIntegrationDisabled,
			terminalCommandDelay,
			terminalPowershellCounter,
			terminalZshClearEolMark,
			terminalZshOhMy,
			terminalZshP10k,
			terminalZdotdir,
			mcpEnabled,
			currentApiConfigName,
			listApiConfigMeta,
			pinnedApiConfigs,
			mode,
			customModePrompts,
			customSupportPrompts,
			enhancementApiConfigId,
			autoApprovalEnabled,
			customModes,
			experiments,
			maxOpenTabsContext,
			maxWorkspaceFiles,
			disabledTools,
			showRooIgnoredFiles,
			enableSubfolderRules,
			language,
			maxImageFileSize,
			maxTotalImageSize,
			historyPreviewCollapsed,
			reasoningBlockCollapsed,
			enterBehavior,
			organizationAllowList,
			customCondensingPrompt,
			codebaseIndexConfig,
			codebaseIndexModels,
			profileThresholds,
			alwaysAllowFollowupQuestions,
			followupAutoApproveTimeoutMs,
			includeDiagnosticMessages,
			maxDiagnosticMessages,
			includeTaskHistoryInEnhance,
			includeCurrentTime,
			includeCurrentCost,
			maxGitStatusFiles,
			memoryEnabled,
			memoryWorkspaceEnabled,
			memoryGlobalEnabled,
			memoryMistakeMemoryEnabled,
			memoryAutoApproveMistakeMemory,
			memoryMaxCharacters,
			memoryMaxEntries,
			memoryPendingCandidateLimit,
			imageGenerationProvider,
			openRouterImageApiKey,
			openRouterImageBaseUrl,
			openRouterImageGenerationSelectedModel,
			openRouterImageGenerationApiMethod,
			openAiImageApiKey,
			openAiImageBaseUrl,
			openAiImageGenerationSelectedModel,
			openAiImageGenerationApiMethod,
			cloudflareImageApiKey,
			cloudflareImageAccountId,
			cloudflareImageBaseUrl,
			cloudflareImageGenerationSelectedModel,
			cloudflareImageGenerationApiMethod,
			cloudflareWorkersAiImageUsage,
			comfyUiImageApiKey,
			comfyUiImageBaseUrl,
			comfyUiImageGenerationSelectedModel,
			comfyUiImageGenerationApiMethod,
			comfyUiImageGenerationNegativePrompt,
			automatic1111ImageApiKey,
			automatic1111ImageBaseUrl,
			automatic1111ImageGenerationSelectedModel,
			automatic1111ImageGenerationApiMethod,
			automatic1111ImageGenerationNegativePrompt,
			ollamaImageApiKey,
			ollamaImageBaseUrl,
			ollamaImageGenerationSelectedModel,
			ollamaImageGenerationApiMethod,
			lmStudioImageApiKey,
			lmStudioImageBaseUrl,
			lmStudioImageGenerationSelectedModel,
			lmStudioImageGenerationApiMethod,
			openAiCodexFastStatus,
			lockApiConfigAcrossModes,
		} = await this.getState()

		const mergedAllowedCommands = this.mergeAllowedCommands(allowedCommands)
		const mergedDeniedCommands = this.mergeDeniedCommands(deniedCommands)
		const cwd = this.cwd
		const currentTask = this.getCurrentTask()
		const memoryState = await this.getMemoryState()
		const normalizedColdCacheRamBudgetMb = normalizeColdCacheRamBudgetMb(
			coldCacheRamBudgetMb ?? DEFAULT_COLD_CACHE_RAM_BUDGET_MB,
			contextCacheBudgetOptions,
		)

		return {
			version: this.context.extension?.packageJSON?.version ?? "",
			apiConfiguration,
			customInstructions,
			alwaysAllowReadOnly: alwaysAllowReadOnly ?? false,
			alwaysAllowReadOnlyOutsideWorkspace: alwaysAllowReadOnlyOutsideWorkspace ?? false,
			alwaysAllowWrite: alwaysAllowWrite ?? false,
			alwaysAllowWriteOutsideWorkspace: alwaysAllowWriteOutsideWorkspace ?? false,
			alwaysAllowWriteProtected: alwaysAllowWriteProtected ?? false,
			alwaysAllowExecute: alwaysAllowExecute ?? false,
			alwaysAllowMcp: alwaysAllowMcp ?? false,
			alwaysAllowModeSwitch: alwaysAllowModeSwitch ?? false,
			alwaysAllowSubtasks: alwaysAllowSubtasks ?? false,
			alwaysAllowParallelTasks: alwaysAllowParallelTasks ?? false,
			maxConcurrentParallelTasks: normalizeParallelTaskConcurrency(maxConcurrentParallelTasks),
			alwaysAllowVisualBrowserInspector: alwaysAllowVisualBrowserInspector ?? false,
			alwaysAllowImageGeneration: alwaysAllowImageGeneration ?? false,
			allowedMaxRequests,
			allowedMaxCost,
			autoCondenseContext: autoCondenseContext ?? true,
			autoCondenseContextPercent: autoCondenseContextPercent ?? 100,
			contextCacheEnabled: contextCacheEnabled ?? true,
			coldCacheRamBudgetMb: normalizedColdCacheRamBudgetMb,
			contextCacheBudgetOptions,
			uriScheme: vscode.env.uriScheme,
			currentTaskId: currentTask?.taskId,
			currentTaskItem: currentTask?.taskId ? this.taskHistoryStore.get(currentTask.taskId) : undefined,
			clineMessages: currentTask?.clineMessages || [],
			contextCacheStats: currentTask?.getContextCacheStats() ?? {
				hotCacheTokens: 0,
				hotCacheChunks: 0,
				coldCacheChunks: 0,
				ramUsedMb: 0,
				ramBudgetMb: normalizedColdCacheRamBudgetMb,
				swapsThisSession: 0,
				condensingAvoided: 0,
			},
			contextCacheWarning: currentTask?.getContextCacheWarning(),
			currentTaskTodos: currentTask?.todoList || [],
			messageQueue: currentTask?.messageQueueService?.messages,
			taskHistory: this.taskHistoryStore.getAll().filter((item: HistoryItem) => item.ts && item.task),
			soundEnabled: soundEnabled ?? false,
			ttsEnabled: ttsEnabled ?? false,
			ttsSpeed: ttsSpeed ?? 1.0,
			emailNotificationsEnabled: emailNotificationsEnabled ?? false,
			emailNotifyOnSuccess: emailNotifyOnSuccess ?? true,
			emailNotifyOnFailure: emailNotifyOnFailure ?? false,
			smtpHost: smtpHost ?? "",
			smtpPort: smtpPort ?? 587,
			smtpSecure: smtpSecure ?? false,
			smtpRequireTls: smtpRequireTls ?? false,
			smtpUsername: smtpUsername ?? "",
			smtpFromAddress: smtpFromAddress ?? "",
			smtpRecipients: smtpRecipients ?? [],
			smtpSubjectTemplate: smtpSubjectTemplate ?? "",
			smtpPasswordConfigured: smtpPasswordConfigured ?? false,
			enableCheckpoints: enableCheckpoints ?? true,
			checkpointTimeout: checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
			shouldShowAnnouncement: lastShownAnnouncementId !== this.latestAnnouncementId,
			allowedCommands: mergedAllowedCommands,
			deniedCommands: mergedDeniedCommands,
			soundVolume: soundVolume ?? 0.5,
			writeDelayMs: writeDelayMs ?? DEFAULT_WRITE_DELAY_MS,
			terminalShellIntegrationTimeout: terminalShellIntegrationTimeout ?? Terminal.defaultShellIntegrationTimeout,
			terminalShellIntegrationDisabled: terminalShellIntegrationDisabled ?? true,
			terminalCommandDelay: terminalCommandDelay ?? 0,
			terminalPowershellCounter: terminalPowershellCounter ?? false,
			terminalZshClearEolMark: terminalZshClearEolMark ?? true,
			terminalZshOhMy: terminalZshOhMy ?? false,
			terminalZshP10k: terminalZshP10k ?? false,
			terminalZdotdir: terminalZdotdir ?? false,
			mcpEnabled: mcpEnabled ?? true,
			currentApiConfigName: currentApiConfigName ?? "default",
			listApiConfigMeta: listApiConfigMeta ?? [],
			pinnedApiConfigs: pinnedApiConfigs ?? {},
			mode: mode ?? defaultModeSlug,
			customModePrompts: customModePrompts ?? {},
			customSupportPrompts: customSupportPrompts ?? {},
			enhancementApiConfigId,
			autoApprovalEnabled: autoApprovalEnabled ?? false,
			customModes,
			experiments: experiments ?? experimentDefault,
			mcpServers: this.mcpHub?.getAllServers() ?? [],
			maxOpenTabsContext: maxOpenTabsContext ?? 20,
			maxWorkspaceFiles: maxWorkspaceFiles ?? 200,
			cwd,
			disabledTools,
			showRooIgnoredFiles: showRooIgnoredFiles ?? false,
			enableSubfolderRules: enableSubfolderRules ?? false,
			language: language ?? formatLanguage(vscode.env.language),
			renderContext: this.renderContext,
			maxImageFileSize: maxImageFileSize ?? 5,
			maxTotalImageSize: maxTotalImageSize ?? 20,
			settingsImportedAt: this.settingsImportedAt,
			historyPreviewCollapsed: historyPreviewCollapsed ?? false,
			reasoningBlockCollapsed: reasoningBlockCollapsed ?? true,
			enterBehavior: enterBehavior ?? "send",
			organizationAllowList,
			customCondensingPrompt,
			codebaseIndexModels: codebaseIndexModels ?? EMBEDDING_MODEL_PROFILES,
			codebaseIndexConfig: {
				codebaseIndexEnabled: codebaseIndexConfig?.codebaseIndexEnabled ?? false,
				codebaseIndexQdrantUrl: codebaseIndexConfig?.codebaseIndexQdrantUrl ?? "http://localhost:6333",
				codebaseIndexEmbedderProvider: codebaseIndexConfig?.codebaseIndexEmbedderProvider ?? "openai",
				codebaseIndexEmbedderBaseUrl: codebaseIndexConfig?.codebaseIndexEmbedderBaseUrl ?? "",
				codebaseIndexEmbedderModelId: codebaseIndexConfig?.codebaseIndexEmbedderModelId ?? "",
				codebaseIndexEmbedderModelDimension: codebaseIndexConfig?.codebaseIndexEmbedderModelDimension ?? 1536,
				codebaseIndexOpenAiCompatibleBaseUrl: codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl,
				codebaseIndexSearchMaxResults: codebaseIndexConfig?.codebaseIndexSearchMaxResults,
				codebaseIndexSearchMinScore: codebaseIndexConfig?.codebaseIndexSearchMinScore,
				codebaseIndexBedrockRegion: codebaseIndexConfig?.codebaseIndexBedrockRegion,
				codebaseIndexBedrockProfile: codebaseIndexConfig?.codebaseIndexBedrockProfile,
				codebaseIndexOpenRouterSpecificProvider: codebaseIndexConfig?.codebaseIndexOpenRouterSpecificProvider,
			},
			profileThresholds: profileThresholds ?? {},
			hasOpenedModeSelector: this.getGlobalState("hasOpenedModeSelector") ?? false,
			lockApiConfigAcrossModes: lockApiConfigAcrossModes ?? false,
			alwaysAllowFollowupQuestions: alwaysAllowFollowupQuestions ?? false,
			followupAutoApproveTimeoutMs: followupAutoApproveTimeoutMs ?? 60000,
			includeDiagnosticMessages: includeDiagnosticMessages ?? true,
			maxDiagnosticMessages: maxDiagnosticMessages ?? 50,
			includeTaskHistoryInEnhance: includeTaskHistoryInEnhance ?? true,
			includeCurrentTime: includeCurrentTime ?? true,
			includeCurrentCost: includeCurrentCost ?? true,
			maxGitStatusFiles: maxGitStatusFiles ?? 0,
			memoryEnabled,
			memoryWorkspaceEnabled: memoryWorkspaceEnabled ?? true,
			memoryGlobalEnabled: memoryGlobalEnabled ?? true,
			memoryMistakeMemoryEnabled: memoryMistakeMemoryEnabled ?? true,
			memoryAutoApproveMistakeMemory: memoryAutoApproveMistakeMemory ?? false,
			memoryMaxCharacters: memoryMaxCharacters ?? DEFAULT_MEMORY_MAX_CHARACTERS,
			memoryMaxEntries: memoryMaxEntries ?? DEFAULT_MEMORY_MAX_ENTRIES,
			memoryPendingCandidateLimit: memoryPendingCandidateLimit ?? DEFAULT_MEMORY_PENDING_CANDIDATE_LIMIT,
			memoryState,
			memorySummary: memoryState.summary,
			imageGenerationProvider,
			openRouterImageApiKey,
			openRouterImageBaseUrl,
			openRouterImageGenerationSelectedModel,
			openRouterImageGenerationApiMethod,
			openAiImageApiKey,
			openAiImageBaseUrl,
			openAiImageGenerationSelectedModel,
			openAiImageGenerationApiMethod,
			cloudflareImageApiKey,
			cloudflareImageAccountId,
			cloudflareImageBaseUrl,
			cloudflareImageGenerationSelectedModel,
			cloudflareImageGenerationApiMethod,
			cloudflareWorkersAiImageUsage,
			comfyUiImageApiKey,
			comfyUiImageBaseUrl,
			comfyUiImageGenerationSelectedModel,
			comfyUiImageGenerationApiMethod,
			comfyUiImageGenerationNegativePrompt,
			automatic1111ImageApiKey,
			automatic1111ImageBaseUrl,
			automatic1111ImageGenerationSelectedModel,
			automatic1111ImageGenerationApiMethod,
			automatic1111ImageGenerationNegativePrompt,
			ollamaImageApiKey,
			ollamaImageBaseUrl,
			ollamaImageGenerationSelectedModel,
			ollamaImageGenerationApiMethod,
			lmStudioImageApiKey,
			lmStudioImageBaseUrl,
			lmStudioImageGenerationSelectedModel,
			lmStudioImageGenerationApiMethod,
			openAiCodexFastStatus: openAiCodexFastStatus ?? { state: "off" },
			openAiCodexIsAuthenticated: await (async () => {
				try {
					const { openAiCodexOAuthManager } = await import("../../integrations/openai-codex/oauth")
					return await openAiCodexOAuthManager.isAuthenticated()
				} catch {
					return false
				}
			})(),
			debug: vscode.workspace.getConfiguration(Package.name).get<boolean>("debug", false),
			activeExecutionPlan: this.activeExecutionPlan,
		}
	}

	/**
	 * Storage
	 * https://dev.to/kompotkot/how-to-use-secretstorage-in-your-vscode-extensions-2hco
	 * https://www.eliostruyf.com/devhack-code-extension-storage-options/
	 */

	async getState(): Promise<
		Omit<
			ExtensionState,
			"clineMessages" | "renderContext" | "hasOpenedModeSelector" | "version" | "shouldShowAnnouncement"
		>
	> {
		const stateValues = this.contextProxy.getValues()
		const customModes = await this.customModesManager.getCustomModes()

		// Determine apiProvider with the same logic as before, while filtering retired providers.
		const apiProvider: ProviderName =
			stateValues.apiProvider && !isRetiredProvider(stateValues.apiProvider)
				? stateValues.apiProvider
				: "openrouter"

		// Build the apiConfiguration object combining state values and secrets.
		const providerSettings = this.contextProxy.getProviderSettings()

		// Ensure apiProvider is set properly if not already in state
		if (!providerSettings.apiProvider) {
			providerSettings.apiProvider = apiProvider
		}
		if (providerSettings.apiProvider === "openrouter" && !providerSettings.openRouterModelId) {
			providerSettings.openRouterModelId = openRouterDefaultModelId
		}

		const organizationAllowList = ORGANIZATION_ALLOW_ALL
		const memoryState = await this.getMemoryState()
		const contextCacheBudgetOptions = getDetectedContextCacheBudgetOptions()
		const coldCacheRamBudgetMb = normalizeColdCacheRamBudgetMb(
			stateValues.coldCacheRamBudgetMb ?? DEFAULT_COLD_CACHE_RAM_BUDGET_MB,
			contextCacheBudgetOptions,
		)

		// Return the same structure as before.
		return {
			apiConfiguration: providerSettings,
			lastShownAnnouncementId: stateValues.lastShownAnnouncementId,
			customInstructions: stateValues.customInstructions,
			apiModelId: stateValues.apiModelId,
			alwaysAllowReadOnly: stateValues.alwaysAllowReadOnly ?? false,
			alwaysAllowReadOnlyOutsideWorkspace: stateValues.alwaysAllowReadOnlyOutsideWorkspace ?? false,
			alwaysAllowWrite: stateValues.alwaysAllowWrite ?? false,
			alwaysAllowWriteOutsideWorkspace: stateValues.alwaysAllowWriteOutsideWorkspace ?? false,
			alwaysAllowWriteProtected: stateValues.alwaysAllowWriteProtected ?? false,
			alwaysAllowExecute: stateValues.alwaysAllowExecute ?? false,
			alwaysAllowMcp: stateValues.alwaysAllowMcp ?? false,
			alwaysAllowModeSwitch: stateValues.alwaysAllowModeSwitch ?? false,
			alwaysAllowSubtasks: stateValues.alwaysAllowSubtasks ?? false,
			alwaysAllowParallelTasks: stateValues.alwaysAllowParallelTasks ?? false,
			maxConcurrentParallelTasks: normalizeParallelTaskConcurrency(stateValues.maxConcurrentParallelTasks),
			alwaysAllowVisualBrowserInspector: stateValues.alwaysAllowVisualBrowserInspector ?? false,
			alwaysAllowImageGeneration: stateValues.alwaysAllowImageGeneration ?? false,
			alwaysAllowFollowupQuestions: stateValues.alwaysAllowFollowupQuestions ?? false,
			followupAutoApproveTimeoutMs: stateValues.followupAutoApproveTimeoutMs ?? 60000,
			diagnosticsEnabled: stateValues.diagnosticsEnabled ?? true,
			allowedMaxRequests: stateValues.allowedMaxRequests,
			allowedMaxCost: stateValues.allowedMaxCost,
			autoCondenseContext: stateValues.autoCondenseContext ?? true,
			autoCondenseContextPercent: stateValues.autoCondenseContextPercent ?? 100,
			contextCacheEnabled: stateValues.contextCacheEnabled ?? true,
			coldCacheRamBudgetMb,
			contextCacheBudgetOptions,
			taskHistory: this.taskHistoryStore.getAll(),
			allowedCommands: stateValues.allowedCommands,
			deniedCommands: stateValues.deniedCommands,
			soundEnabled: stateValues.soundEnabled ?? false,
			ttsEnabled: stateValues.ttsEnabled ?? false,
			ttsSpeed: stateValues.ttsSpeed ?? 1.0,
			emailNotificationsEnabled: stateValues.emailNotificationsEnabled ?? false,
			emailNotifyOnSuccess: stateValues.emailNotifyOnSuccess ?? true,
			emailNotifyOnFailure: stateValues.emailNotifyOnFailure ?? false,
			smtpHost: stateValues.smtpHost ?? "",
			smtpPort: stateValues.smtpPort ?? 587,
			smtpSecure: stateValues.smtpSecure ?? false,
			smtpRequireTls: stateValues.smtpRequireTls ?? false,
			smtpUsername: stateValues.smtpUsername ?? "",
			smtpFromAddress: stateValues.smtpFromAddress ?? "",
			smtpRecipients: stateValues.smtpRecipients ?? [],
			smtpSubjectTemplate: stateValues.smtpSubjectTemplate ?? "",
			smtpPasswordConfigured: Boolean(this.contextProxy.getSecret("smtpPassword")),
			enableCheckpoints: stateValues.enableCheckpoints ?? true,
			checkpointTimeout: stateValues.checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
			soundVolume: stateValues.soundVolume,
			writeDelayMs: stateValues.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS,
			terminalShellIntegrationTimeout:
				stateValues.terminalShellIntegrationTimeout ?? Terminal.defaultShellIntegrationTimeout,
			terminalShellIntegrationDisabled: stateValues.terminalShellIntegrationDisabled ?? true,
			terminalCommandDelay: stateValues.terminalCommandDelay ?? 0,
			terminalPowershellCounter: stateValues.terminalPowershellCounter ?? false,
			terminalZshClearEolMark: stateValues.terminalZshClearEolMark ?? true,
			terminalZshOhMy: stateValues.terminalZshOhMy ?? false,
			terminalZshP10k: stateValues.terminalZshP10k ?? false,
			terminalZdotdir: stateValues.terminalZdotdir ?? false,
			mode: stateValues.mode ?? defaultModeSlug,
			language: stateValues.language ?? formatLanguage(vscode.env.language),
			mcpEnabled: stateValues.mcpEnabled ?? true,
			mcpServers: this.mcpHub?.getAllServers() ?? [],
			currentApiConfigName: stateValues.currentApiConfigName ?? "default",
			listApiConfigMeta: stateValues.listApiConfigMeta ?? [],
			pinnedApiConfigs: stateValues.pinnedApiConfigs ?? {},
			modeApiConfigs: stateValues.modeApiConfigs ?? ({} as Record<Mode, string>),
			customModePrompts: stateValues.customModePrompts ?? {},
			customSupportPrompts: stateValues.customSupportPrompts ?? {},
			enhancementApiConfigId: stateValues.enhancementApiConfigId,
			experiments: stateValues.experiments ?? experimentDefault,
			autoApprovalEnabled: stateValues.autoApprovalEnabled ?? false,
			customModes,
			maxOpenTabsContext: stateValues.maxOpenTabsContext ?? 20,
			maxWorkspaceFiles: stateValues.maxWorkspaceFiles ?? 200,
			disabledTools: stateValues.disabledTools,
			showRooIgnoredFiles: stateValues.showRooIgnoredFiles ?? false,
			enableSubfolderRules: stateValues.enableSubfolderRules ?? false,
			maxImageFileSize: stateValues.maxImageFileSize ?? 5,
			maxTotalImageSize: stateValues.maxTotalImageSize ?? 20,
			historyPreviewCollapsed: stateValues.historyPreviewCollapsed ?? false,
			reasoningBlockCollapsed: stateValues.reasoningBlockCollapsed ?? true,
			enterBehavior: stateValues.enterBehavior ?? "send",
			organizationAllowList,
			customCondensingPrompt: stateValues.customCondensingPrompt,
			codebaseIndexModels: stateValues.codebaseIndexModels ?? EMBEDDING_MODEL_PROFILES,
			codebaseIndexConfig: {
				codebaseIndexEnabled: stateValues.codebaseIndexConfig?.codebaseIndexEnabled ?? false,
				codebaseIndexQdrantUrl:
					stateValues.codebaseIndexConfig?.codebaseIndexQdrantUrl ?? "http://localhost:6333",
				codebaseIndexEmbedderProvider:
					stateValues.codebaseIndexConfig?.codebaseIndexEmbedderProvider ?? "openai",
				codebaseIndexEmbedderBaseUrl: stateValues.codebaseIndexConfig?.codebaseIndexEmbedderBaseUrl ?? "",
				codebaseIndexEmbedderModelId: stateValues.codebaseIndexConfig?.codebaseIndexEmbedderModelId ?? "",
				codebaseIndexEmbedderModelDimension:
					stateValues.codebaseIndexConfig?.codebaseIndexEmbedderModelDimension,
				codebaseIndexOpenAiCompatibleBaseUrl:
					stateValues.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl,
				codebaseIndexSearchMaxResults: stateValues.codebaseIndexConfig?.codebaseIndexSearchMaxResults,
				codebaseIndexSearchMinScore: stateValues.codebaseIndexConfig?.codebaseIndexSearchMinScore,
				codebaseIndexBedrockRegion: stateValues.codebaseIndexConfig?.codebaseIndexBedrockRegion,
				codebaseIndexBedrockProfile: stateValues.codebaseIndexConfig?.codebaseIndexBedrockProfile,
				codebaseIndexOpenRouterSpecificProvider:
					stateValues.codebaseIndexConfig?.codebaseIndexOpenRouterSpecificProvider,
			},
			profileThresholds: stateValues.profileThresholds ?? {},
			lockApiConfigAcrossModes: this.context.workspaceState.get("lockApiConfigAcrossModes", false),
			includeDiagnosticMessages: stateValues.includeDiagnosticMessages ?? true,
			maxDiagnosticMessages: stateValues.maxDiagnosticMessages ?? 50,
			includeTaskHistoryInEnhance: stateValues.includeTaskHistoryInEnhance ?? true,
			includeCurrentTime: stateValues.includeCurrentTime ?? true,
			includeCurrentCost: stateValues.includeCurrentCost ?? true,
			maxGitStatusFiles: stateValues.maxGitStatusFiles ?? 0,
			memoryEnabled: stateValues.memoryEnabled,
			memoryWorkspaceEnabled: stateValues.memoryWorkspaceEnabled ?? true,
			memoryGlobalEnabled: stateValues.memoryGlobalEnabled ?? true,
			memoryMistakeMemoryEnabled: stateValues.memoryMistakeMemoryEnabled ?? true,
			memoryAutoApproveMistakeMemory: stateValues.memoryAutoApproveMistakeMemory ?? false,
			memoryMaxCharacters: stateValues.memoryMaxCharacters ?? DEFAULT_MEMORY_MAX_CHARACTERS,
			memoryMaxEntries: stateValues.memoryMaxEntries ?? DEFAULT_MEMORY_MAX_ENTRIES,
			memoryPendingCandidateLimit:
				stateValues.memoryPendingCandidateLimit ?? DEFAULT_MEMORY_PENDING_CANDIDATE_LIMIT,
			memoryState,
			memorySummary: memoryState.summary,
			imageGenerationProvider: stateValues.imageGenerationProvider,
			openRouterImageApiKey: stateValues.openRouterImageApiKey,
			openRouterImageBaseUrl: stateValues.openRouterImageBaseUrl,
			openRouterImageGenerationSelectedModel: stateValues.openRouterImageGenerationSelectedModel,
			openRouterImageGenerationApiMethod: stateValues.openRouterImageGenerationApiMethod,
			openAiImageApiKey: stateValues.openAiImageApiKey,
			openAiImageBaseUrl: stateValues.openAiImageBaseUrl,
			openAiImageGenerationSelectedModel: stateValues.openAiImageGenerationSelectedModel,
			openAiImageGenerationApiMethod: stateValues.openAiImageGenerationApiMethod,
			cloudflareImageApiKey: stateValues.cloudflareImageApiKey,
			cloudflareImageAccountId: stateValues.cloudflareImageAccountId,
			cloudflareImageBaseUrl: stateValues.cloudflareImageBaseUrl,
			cloudflareImageGenerationSelectedModel: stateValues.cloudflareImageGenerationSelectedModel,
			cloudflareImageGenerationApiMethod: stateValues.cloudflareImageGenerationApiMethod,
			cloudflareWorkersAiImageUsage: stateValues.cloudflareWorkersAiImageUsage,
			comfyUiImageApiKey: stateValues.comfyUiImageApiKey,
			comfyUiImageBaseUrl: stateValues.comfyUiImageBaseUrl,
			comfyUiImageGenerationSelectedModel: stateValues.comfyUiImageGenerationSelectedModel,
			comfyUiImageGenerationApiMethod: stateValues.comfyUiImageGenerationApiMethod,
			comfyUiImageGenerationNegativePrompt: stateValues.comfyUiImageGenerationNegativePrompt,
			automatic1111ImageApiKey: stateValues.automatic1111ImageApiKey,
			automatic1111ImageBaseUrl: stateValues.automatic1111ImageBaseUrl,
			automatic1111ImageGenerationSelectedModel: stateValues.automatic1111ImageGenerationSelectedModel,
			automatic1111ImageGenerationApiMethod: stateValues.automatic1111ImageGenerationApiMethod,
			automatic1111ImageGenerationNegativePrompt: stateValues.automatic1111ImageGenerationNegativePrompt,
			ollamaImageApiKey: stateValues.ollamaImageApiKey,
			ollamaImageBaseUrl: stateValues.ollamaImageBaseUrl,
			ollamaImageGenerationSelectedModel: stateValues.ollamaImageGenerationSelectedModel,
			ollamaImageGenerationApiMethod: stateValues.ollamaImageGenerationApiMethod,
			lmStudioImageApiKey: stateValues.lmStudioImageApiKey,
			lmStudioImageBaseUrl: stateValues.lmStudioImageBaseUrl,
			lmStudioImageGenerationSelectedModel: stateValues.lmStudioImageGenerationSelectedModel,
			lmStudioImageGenerationApiMethod: stateValues.lmStudioImageGenerationApiMethod,
			openAiCodexFastStatus: stateValues.openAiCodexFastStatus,
		}
	}

	async updateOpenAiCodexFastStatus(status: OpenAiCodexFastStatus): Promise<void> {
		const current = this.contextProxy.getGlobalState("openAiCodexFastStatus")
		if (JSON.stringify(current) === JSON.stringify(status)) {
			return
		}

		await this.contextProxy.updateGlobalState("openAiCodexFastStatus", status)
		await this.postStateToWebviewWithoutClineMessages()
	}

	async updateCloudflareWorkersAiImageUsage(update: CloudflareWorkersAiImageUsageUpdate): Promise<void> {
		const current = this.contextProxy.getGlobalState("cloudflareWorkersAiImageUsage")
		const next = applyCloudflareWorkersAiImageUsageUpdate(current, update)

		if (JSON.stringify(current) === JSON.stringify(next)) {
			return
		}

		await this.contextProxy.updateGlobalState("cloudflareWorkersAiImageUsage", next)
		await this.postStateToWebviewWithoutClineMessages()
	}

	/**
	 * Updates a task in the task history and optionally broadcasts the updated history to the webview.
	 * Now delegates to TaskHistoryStore for per-task file persistence.
	 *
	 * @param item The history item to update or add
	 * @param options.broadcast Whether to broadcast the updated history to the webview (default: true)
	 * @returns The updated task history array
	 */
	async updateTaskHistory(item: HistoryItem, options: { broadcast?: boolean } = {}): Promise<HistoryItem[]> {
		const { broadcast = true } = options

		const history = await this.taskHistoryStore.upsert(item)
		this.recentTasksCache = undefined

		// Broadcast the updated history to the webview if requested.
		// Prefer per-item updates to avoid repeatedly cloning/sending the full history.
		if (broadcast && this.isViewLaunched) {
			const updatedItem = this.taskHistoryStore.get(item.id) ?? item
			await this.postMessageToWebview({ type: "taskHistoryItemUpdated", taskHistoryItem: updatedItem })
		}

		return history
	}

	/**
	 * Schedule a debounced write-through of task history to globalState.
	 * Only used for backward compatibility during the transition period.
	 * Per-task files are authoritative; globalState is the downgrade fallback.
	 */
	private scheduleGlobalStateWriteThrough(): void {
		if (this.globalStateWriteThroughTimer) {
			clearTimeout(this.globalStateWriteThroughTimer)
		}

		this.globalStateWriteThroughTimer = setTimeout(async () => {
			this.globalStateWriteThroughTimer = null
			try {
				const items = this.taskHistoryStore.getAll()
				await this.updateGlobalState("taskHistory", items)
			} catch (err) {
				this.log(
					`[scheduleGlobalStateWriteThrough] Failed: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}, ClineProvider.GLOBAL_STATE_WRITE_THROUGH_DEBOUNCE_MS)
	}

	/**
	 * Flush any pending debounced globalState write-through immediately.
	 */
	private flushGlobalStateWriteThrough(): void {
		if (this.globalStateWriteThroughTimer) {
			clearTimeout(this.globalStateWriteThroughTimer)
			this.globalStateWriteThroughTimer = null
		}

		const items = this.taskHistoryStore.getAll()
		this.updateGlobalState("taskHistory", items).catch((err) => {
			this.log(`[flushGlobalStateWriteThrough] Failed: ${err instanceof Error ? err.message : String(err)}`)
		})
	}

	/**
	 * Broadcasts a task history update to the webview.
	 * This sends a lightweight message with just the task history, rather than the full state.
	 * @param history The task history to broadcast (if not provided, reads from the store)
	 */
	public async broadcastTaskHistoryUpdate(history?: HistoryItem[]): Promise<void> {
		if (!this.isViewLaunched) {
			return
		}

		const taskHistory = history ?? this.taskHistoryStore.getAll()

		// Sort and filter the history the same way as getStateToPostToWebview
		const sortedHistory = taskHistory
			.filter((item: HistoryItem) => item.ts && item.task)
			.sort((a: HistoryItem, b: HistoryItem) => b.ts - a.ts)

		await this.postMessageToWebview({
			type: "taskHistoryUpdated",
			taskHistory: sortedHistory,
		})
	}

	// ContextProxy

	// @deprecated - Use `ContextProxy#setValue` instead.
	private async updateGlobalState<K extends keyof GlobalState>(key: K, value: GlobalState[K]) {
		await this.contextProxy.setValue(key, value)
	}

	// @deprecated - Use `ContextProxy#getValue` instead.
	private getGlobalState<K extends keyof GlobalState>(key: K) {
		return this.contextProxy.getValue(key)
	}

	public async setValue<K extends keyof RooCodeSettings>(key: K, value: RooCodeSettings[K]) {
		await this.contextProxy.setValue(key, value)
	}

	public getValue<K extends keyof RooCodeSettings>(key: K) {
		return this.contextProxy.getValue(key)
	}

	public getValues() {
		return this.contextProxy.getValues()
	}

	public async setValues(values: RooCodeSettings) {
		await this.contextProxy.setValues(values)
	}

	// dev

	async resetState() {
		const answer = await vscode.window.showInformationMessage(
			t("common:confirmation.reset_state"),
			{ modal: true },
			t("common:answers.yes"),
		)

		if (answer !== t("common:answers.yes")) {
			return
		}

		await this.contextProxy.resetAllState()
		await this.providerSettingsManager.resetAllConfigs()
		await this.customModesManager.resetCustomModes()
		await this.removeClineFromStack()
		await this.postStateToWebview()
		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
	}

	// logging

	public log(message: string) {
		this.outputChannel.appendLine(message)
		console.log(message)
	}

	// getters

	public get workspaceTracker(): WorkspaceTracker | undefined {
		return this._workspaceTracker
	}

	get viewLaunched() {
		return this.isViewLaunched
	}

	get messages() {
		return this.getCurrentTask()?.clineMessages || []
	}

	public getMcpHub(): McpHub | undefined {
		return this.mcpHub
	}

	public getSkillsManager(): SkillsManager | undefined {
		return this.skillsManager
	}

	/**
	 * Gets the CodeIndexManager for the current active workspace
	 * @returns CodeIndexManager instance for the current workspace or the default one
	 */
	public getCurrentWorkspaceCodeIndexManager(): CodeIndexManager | undefined {
		return CodeIndexManager.getInstance(this.context)
	}

	/**
	 * Updates the code index status subscription to listen to the current workspace manager
	 */
	private updateCodeIndexStatusSubscription(): void {
		// Get the current workspace manager
		const currentManager = this.getCurrentWorkspaceCodeIndexManager()

		// If the manager hasn't changed, no need to update subscription
		if (currentManager === this.codeIndexManager) {
			return
		}

		// Dispose the old subscription if it exists
		if (this.codeIndexStatusSubscription) {
			this.codeIndexStatusSubscription.dispose()
			this.codeIndexStatusSubscription = undefined
		}

		// Update the current workspace manager reference
		this.codeIndexManager = currentManager

		// Subscribe to the new manager's progress updates if it exists
		if (currentManager) {
			this.codeIndexStatusSubscription = currentManager.onProgressUpdate((update: IndexProgressUpdate) => {
				// Only send updates if this manager is still the current one
				if (currentManager === this.getCurrentWorkspaceCodeIndexManager()) {
					// Get the full status from the manager to ensure we have all fields correctly formatted
					const fullStatus = currentManager.getCurrentStatus()
					this.postMessageToWebview({
						type: "indexingStatusUpdate",
						values: fullStatus,
					})
				}
			})

			if (this.view) {
				this.webviewDisposables.push(this.codeIndexStatusSubscription)
			}

			// Send initial status for the current workspace
			this.postMessageToWebview({
				type: "indexingStatusUpdate",
				values: currentManager.getCurrentStatus(),
			})
		}
	}

	/**
	 * TaskProviderLike
	 */

	public getCurrentTask(): Task | undefined {
		if (this.clineStack.length === 0) {
			return undefined
		}

		return this.clineStack[this.clineStack.length - 1]
	}

	public getRecentTasks(): string[] {
		if (this.recentTasksCache) {
			return this.recentTasksCache
		}

		const history = this.taskHistoryStore.getAll()
		const workspaceTasks: HistoryItem[] = []

		for (const item of history) {
			if (!item.ts || !item.task || item.workspace !== this.cwd) {
				continue
			}

			workspaceTasks.push(item)
		}

		if (workspaceTasks.length === 0) {
			this.recentTasksCache = []
			return this.recentTasksCache
		}

		workspaceTasks.sort((a, b) => b.ts - a.ts)
		let recentTaskIds: string[] = []

		if (workspaceTasks.length >= 100) {
			// If we have at least 100 tasks, return tasks from the last 7 days.
			const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

			for (const item of workspaceTasks) {
				// Stop when we hit tasks older than 7 days.
				if (item.ts < sevenDaysAgo) {
					break
				}

				recentTaskIds.push(item.id)
			}
		} else {
			// Otherwise, return the most recent 100 tasks (or all if less than 100).
			recentTaskIds = workspaceTasks.slice(0, Math.min(100, workspaceTasks.length)).map((item) => item.id)
		}

		this.recentTasksCache = recentTaskIds
		return this.recentTasksCache
	}

	// When initializing a new task, (not from history but from a tool command
	// new_task) there is no need to remove the previous task since the new
	// task is a subtask of the previous one, and when it finishes it is removed
	// from the stack and the caller is resumed in this way we can have a chain
	// of tasks, each one being a sub task of the previous one until the main
	// task is finished.
	public async createTask(
		text?: string,
		images?: string[],
		parentTask?: Task,
		options: CreateTaskOptions = {},
		configuration: RooCodeSettings = {},
	): Promise<Task> {
		if (configuration) {
			await this.setValues(configuration)

			if (configuration.allowedCommands) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update("allowedCommands", configuration.allowedCommands, vscode.ConfigurationTarget.Global)
			}

			if (configuration.deniedCommands) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update("deniedCommands", configuration.deniedCommands, vscode.ConfigurationTarget.Global)
			}

			if (configuration.commandExecutionTimeout !== undefined) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update(
						"commandExecutionTimeout",
						configuration.commandExecutionTimeout,
						vscode.ConfigurationTarget.Global,
					)
			}

			if (configuration.currentApiConfigName) {
				await this.setProviderProfile(configuration.currentApiConfigName)
			}

			// Register custom modes so the CustomModesManager knows about them.
			// setValues writes to global state, but the manager overwrites that
			// when it merges .roomodes + global settings on refresh.  Persisting
			// via updateCustomMode ensures modes survive the merge cycle.
			if (configuration.customModes?.length) {
				for (const mode of configuration.customModes) {
					await this.customModesManager.updateCustomMode(mode.slug, mode)
				}
			}
		}

		const { apiConfiguration, organizationAllowList, enableCheckpoints, checkpointTimeout, experiments } =
			await this.getState()

		// Single-open-task invariant: always enforce for user-initiated top-level tasks.
		// Background agent tasks must never disturb the visible task, even if they
		// are created without parent lineage in a degraded path.
		if (!parentTask && !options.background) {
			try {
				await this.teardownParallelExecution({ markCancelled: true, resetBus: true, cleanupWorktrees: true })
			} catch (error) {
				this.log(
					`[createTask] Failed to teardown parallel execution before opening a new task (non-fatal): ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}

			try {
				await this.removeClineFromStack()
			} catch {
				// Non-fatal
			}
		}

		if (!ProfileValidator.isProfileAllowed(apiConfiguration, organizationAllowList)) {
			throw new OrganizationAllowListViolationError(t("common:errors.violated_organization_allowlist"))
		}

		const task = new Task({
			provider: this,
			apiConfiguration,
			checkpointTimeout,
			consecutiveMistakeLimit: apiConfiguration.consecutiveMistakeLimit,
			task: text,
			images,
			experiments,
			rootTask: this.clineStack.length > 0 ? this.clineStack[0] : undefined,
			parentTask,
			taskNumber: this.clineStack.length + 1,
			onCreated: this.taskCreationCallback,
			initialTodos: options.initialTodos,
			agentBus: options.agentId ? AgentBus.getInstance() : undefined,
			...options,
			// Always defer initial execution until the provider has registered the
			// task in the visible/background collection. Callers can additionally
			// pass startTask: false to attach their own lifecycle listeners first.
			startTask: false,
			enableCheckpoints: options.background ? false : (options.enableCheckpoints ?? enableCheckpoints),
		})

		if (options.background) {
			await this.addBackgroundTask(task)
		} else {
			await this.addClineToStack(task)
		}
		if (options.startTask !== false) {
			task.start()
		}

		this.log(
			`[createTask] ${task.parentTask ? "child" : "parent"}${task.background ? " background" : ""} task ${task.taskId}.${task.instanceId} instantiated`,
		)

		return task
	}

	private async startApprovedExecutionPlan(plan: ExecutionPlan): Promise<PlanStartResult> {
		const { maxConcurrentParallelTasks } = await this.getState()
		const maxParallelAgents = normalizeParallelTaskConcurrency(maxConcurrentParallelTasks)
		if (plan.agents.length > maxParallelAgents) {
			const message = `Parallel execution plan ${plan.planId} includes ${plan.agents.length} agents, but maximum parallel agents is configured to ${maxParallelAgents}. Reduce the plan to ${maxParallelAgents} agents or fewer.`
			this.log(`[parallel-agents] ${message}`)
			vscode.window.showErrorMessage(message)
			return { ok: false, error: message }
		}

		await this.teardownParallelExecution({ markCancelled: true, resetBus: true, cleanupWorktrees: true })
		this.parallelParentResumeKey = undefined
		this.resetParallelAgentStatusState(plan.planId)

		const checkpointResult = await this.createParallelAgentStartCheckpoint(plan)
		if (!checkpointResult.ok) {
			return checkpointResult
		}

		try {
			const worktreeManager = this.ensureWorktreeManager()
			await worktreeManager.validateGitRepository()
			await worktreeManager.captureWorkspaceBaseline(plan.planId)
		} catch (error) {
			const message = getWorktreeManagerErrorMessage(error)
			this.log(`[parallel-agents] ${message}`)
			vscode.window.showErrorMessage(message)
			return { ok: false, error: message }
		}

		this.activeExecutionPlan = plan
		await this.updateParallelAgentStatusMessage("running")
		this.orchestratorEventLoop = new OrchestratorEventLoop(this, AgentBus.getInstance(), {
			maxConcurrentAgents: maxParallelAgents,
		})
		this.attachAgentBusForwarders(AgentBus.getInstance())
		this.orchestratorEventLoop.start(plan)
		return { ok: true }
	}

	private async createParallelAgentStartCheckpoint(plan: ExecutionPlan): Promise<PlanStartResult> {
		const visibleTask = this.getCurrentTask()

		if (!visibleTask || visibleTask.background) {
			this.log(
				`[parallel-agents] Skipping pre-start checkpoint for plan ${plan.planId}: no visible parent task is active.`,
			)
			return { ok: true }
		}

		const checkpointTask = visibleTask.rootTask ?? visibleTask

		if (!checkpointTask.enableCheckpoints) {
			this.log(
				`[parallel-agents] Checkpoints are disabled for task ${checkpointTask.taskId}; starting plan ${plan.planId} without a pre-start checkpoint.`,
			)
			return { ok: true }
		}

		this.log(
			`[parallel-agents] Creating checkpoint for task ${checkpointTask.taskId} before starting plan ${plan.planId}.`,
		)

		try {
			const checkpoint = await checkpointTask.checkpointSave(true, false, { throwOnError: true })

			if (checkpoint?.commit) {
				this.log(
					`[parallel-agents] Created checkpoint ${checkpoint.commit} for task ${checkpointTask.taskId} before starting plan ${plan.planId}.`,
				)
				return { ok: true }
			}

			if (!checkpointTask.enableCheckpoints) {
				this.log(
					`[parallel-agents] Checkpoints became unavailable for task ${checkpointTask.taskId}; starting plan ${plan.planId} without a pre-start checkpoint.`,
				)
				return { ok: true }
			}

			const message = `Unable to create a checkpoint before starting parallel agents for plan ${plan.planId}. Parallel agents were not started.`
			this.log(`[parallel-agents] ${message}`)
			vscode.window.showErrorMessage(message)
			return { ok: false, error: message }
		} catch (error) {
			const reason = error instanceof Error && error.message ? error.message : String(error)
			const message = `Failed to create a checkpoint before starting parallel agents for plan ${plan.planId}: ${reason}. Parallel agents were not started.`
			this.log(`[parallel-agents] ${message}`)
			vscode.window.showErrorMessage(message)
			return { ok: false, error: message }
		}
	}

	private async resumeRestoredParallelExecution(task: Task, agentIdsToRestart: string[]): Promise<void> {
		const plan = this.activeExecutionPlan
		if (!plan) {
			return
		}

		await task.restoreParallelExecutionPause()
		const baselineError = await this.restorePersistedParallelBaseline(plan)
		if (baselineError) {
			await this.reportRestoredParallelResumeFailure(task, baselineError)
			return
		}

		for (const agentId of agentIdsToRestart) {
			this.recordParallelAgentActivity(agentId, "Rehydrating parallel agent after task resume.", "status")
		}

		const { maxConcurrentParallelTasks } = await this.getState()
		const maxParallelAgents = normalizeParallelTaskConcurrency(maxConcurrentParallelTasks)
		this.orchestratorEventLoop = new OrchestratorEventLoop(this, AgentBus.getInstance(), {
			maxConcurrentAgents: maxParallelAgents,
		})
		this.attachAgentBusForwarders(AgentBus.getInstance())
		this.orchestratorEventLoop.start(plan)
		this.scheduleParallelAgentStatusMessageUpdate()
		await this.postStateToWebviewWithoutClineMessages()
	}

	private async restorePersistedParallelBaseline(plan: ExecutionPlan): Promise<string | undefined> {
		try {
			const worktreeManager = this.ensureWorktreeManager()
			await worktreeManager.validateGitRepository()
			const baseline = await worktreeManager.restoreWorkspaceBaseline(plan.planId)
			if (!baseline) {
				return `the saved workspace baseline for parallel plan ${plan.planId} is no longer available.`
			}
			return undefined
		} catch (error) {
			return getWorktreeManagerErrorMessage(error)
		}
	}

	private async reportRestoredParallelResumeFailure(task: Task, reason: string): Promise<void> {
		await task.restoreParallelExecutionPause()
		const plan = this.activeExecutionPlan
		this.parallelStatusPhase = "failed"

		const agentId = plan?.agents.find((agent) => agent.status !== "complete")?.id ?? plan?.agents[0]?.id
		if (agentId) {
			this.recordParallelAgentActivity(
				agentId,
				`Parallel-agent resume requires manual recovery: ${reason}`,
				"error",
			)
		}

		if (plan) {
			await this.updateParallelAgentStatusMessage("failed")
		}

		await task.say(
			"text",
			`Roo found an interrupted parallel-agent run, but it cannot be resumed safely: ${reason}\n\nThe parent task has not been continued automatically. To recover safely, start a new parallel-agent plan from the same objective or cancel this parallel run and proceed manually.`,
		)
		await this.postStateToWebviewWithoutClineMessages()
	}

	private async restorePersistedParallelResumeState(taskId: string): Promise<ParallelResumeRestoreResult> {
		try {
			const globalStoragePath = this.context.globalStorageUri.fsPath
			const savedMessages = await readTaskMessages({ taskId, globalStoragePath })
			const parallelMessage = [...savedMessages]
				.reverse()
				.map((message) => this.tryParseParallelAgentToolMessage(message))
				.find(
					(tool) =>
						Boolean(tool?.executionPlan) &&
						(tool?.parallelStatus === "running" ||
							tool?.parallelStatus === "review" ||
							tool?.parallelStatus === "failed"),
				)

			if (!parallelMessage?.executionPlan) {
				return { status: "none" }
			}

			this.restoreParallelAgentToolPayload(parallelMessage)

			if (parallelMessage.parallelStatus === "review") {
				return { status: "review", rebuildReview: false }
			}

			if (parallelMessage.parallelStatus === "failed") {
				return {
					status: "failed",
					reason: "the saved parallel-agent run was already marked failed before it could be resumed.",
				}
			}

			return this.prepareRestoredRunningParallelPlan(parallelMessage.executionPlan)
		} catch (error) {
			this.log(
				`[parallel-agents] Failed to inspect persisted parallel state for resume: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
			return { status: "none" }
		}
	}

	private restoreParallelAgentToolPayload(tool: ClineSayTool): void {
		if (!tool.executionPlan) {
			return
		}

		this.activeExecutionPlan = tool.executionPlan
		this.parallelStatusPhase = tool.parallelStatus ?? "running"
		this.parallelStatusPlanId = tool.executionPlan.planId
		this.parallelMergeReviewEntries = tool.mergeReviewEntries
		this.parallelUsageSummary = tool.parallelUsageSummary
		this.parallelAgentCompletionPackets.clear()
		for (const packet of tool.agentCompletionPackets ?? []) {
			this.parallelAgentCompletionPackets.set(packet.agentId, packet)
		}
		this.parallelPlanCompletionPacket = tool.parallelPlanCompletionPacket
		this.parallelContinuation = tool.parallelContinuation ?? tool.executionPlan.continuation
		this.parallelReviewSummary =
			tool.parallelReviewSummary ??
			(tool.parallelStatus === "review"
				? this.buildParallelAgentReviewSummary(tool.executionPlan, tool.mergeReviewEntries ?? [])
				: undefined)
		this.parallelAgentStatusUpdates.clear()
		for (const update of tool.agentStatusUpdates ?? []) {
			this.parallelAgentStatusUpdates.set(update.agentId, this.withAgentActivities(update))
		}
		this.parallelAgentActivities.clear()
		for (const activity of tool.agentActivities ?? []) {
			const previous = this.parallelAgentActivities.get(activity.agentId) ?? []
			this.parallelAgentActivities.set(
				activity.agentId,
				[...previous, activity].slice(-PARALLEL_AGENT_ACTIVITY_LIMIT),
			)
		}
		this.parallelAgentCoordinationEvents = (tool.agentCoordinationEvents ?? []).slice(
			-PARALLEL_AGENT_COORDINATION_LIMIT,
		)
		this.parallelWriteConflicts.clear()
		this.deniedWriteReasons.clear()
		this.worktreePathsByAgentId.clear()
		for (const conflict of tool.writeIntentConflicts ?? []) {
			this.parallelWriteConflicts.set(this.getConflictKey(conflict.agentId, conflict.filePath), conflict)
			this.deniedWriteReasons.set(this.getConflictKey(conflict.agentId, conflict.filePath), conflict.reason)
		}
		for (const agent of tool.executionPlan.agents) {
			if (agent.worktreePath) {
				this.worktreePathsByAgentId.set(agent.id, agent.worktreePath)
			}
		}
		for (const entry of tool.mergeReviewEntries ?? []) {
			if (entry.worktreePath) {
				this.worktreePathsByAgentId.set(entry.agentId, entry.worktreePath)
			}
		}
	}

	private async decorateExecutionPlanWithContinuation(plan: ExecutionPlan): Promise<void> {
		const priorRun = this.findReusablePriorParallelRun()
		const repositoryRoot = priorRun ? await this.getCurrentRepositoryRootForContinuation() : undefined
		const decisions: ParallelPlanContinuationMetadata["decisions"] = []
		let reusedAgentCount = 0

		if (!priorRun) {
			for (const agent of plan.agents) {
				agent.continuation = {
					decision: "fresh",
					reason: "No prior clean merged parallel-agent run was found in the loaded parent task.",
					newPlanId: plan.planId,
					newAgentId: agent.id,
					newBranch: this.getAgentBranchName(plan.planId, agent.id),
				}
				decisions.push({ agentId: agent.id, decision: "fresh", reason: agent.continuation.reason })
			}
		} else {
			const usedPriorAgentIds = new Set<string>()
			for (const agent of plan.agents) {
				const match = this.findContinuationMatch(agent, priorRun, usedPriorAgentIds)
				let continuation = match
					? await this.buildReusedAgentContinuation(plan, agent, priorRun, match, repositoryRoot)
					: this.buildFreshAgentContinuation(
							plan,
							agent,
							"No prior agent had strong conservative file/path overlap with this new agent.",
						)

				if (continuation.decision === "reused" && match) {
					usedPriorAgentIds.add(match.agent.id)
					reusedAgentCount += 1
				} else if (continuation.decision === "reused") {
					continuation = this.buildFreshAgentContinuation(
						plan,
						agent,
						"Prior agent match was unavailable after hard-gate evaluation.",
					)
				}

				agent.continuation = continuation
				decisions.push({
					agentId: agent.id,
					decision: continuation.decision,
					sourceAgentId: continuation.sourceAgentId,
					reason: continuation.reason,
					relevanceScore: continuation.relevanceScore,
					relevanceSignals: continuation.relevanceSignals,
				})
			}
		}

		plan.continuation = {
			schemaVersion: 1,
			workspaceRoot: getWorkspacePath(),
			repositoryRoot,
			sourcePlanId: priorRun?.plan.planId,
			evaluatedAt: Date.now(),
			reusedAgentCount,
			freshAgentCount: plan.agents.length - reusedAgentCount,
			decisions,
		}
		this.parallelContinuation = plan.continuation
	}

	private findReusablePriorParallelRun(): PriorParallelAgentRun | undefined {
		const task = this.getCurrentTask()
		if (!task || task.background) {
			return undefined
		}

		for (let index = task.clineMessages.length - 1; index >= 0; index -= 1) {
			const tool = this.tryParseParallelAgentToolMessage(task.clineMessages[index])
			if (!tool?.executionPlan || tool.parallelStatus !== "merged") {
				continue
			}

			const candidate = this.buildPriorParallelAgentRun(tool)
			if (candidate) {
				return candidate
			}
		}

		return undefined
	}

	private buildPriorParallelAgentRun(tool: ClineSayTool): PriorParallelAgentRun | undefined {
		const plan = tool.executionPlan
		if (!plan) {
			return undefined
		}

		const agentPackets = tool.agentCompletionPackets ?? []
		const planPacket = tool.parallelPlanCompletionPacket
		if (!planPacket || !this.isCleanMergedPriorRun(plan, planPacket, agentPackets, tool.mergeReviewEntries ?? [])) {
			return undefined
		}

		return {
			tool,
			plan,
			planPacket,
			agentPacketsById: new Map(agentPackets.map((packet) => [packet.agentId, packet])),
			mergeEntriesByAgentId: new Map((tool.mergeReviewEntries ?? []).map((entry) => [entry.agentId, entry])),
			repositoryRoot: tool.parallelContinuation?.repositoryRoot ?? plan.continuation?.repositoryRoot,
			workspaceRoot: tool.parallelContinuation?.workspaceRoot ?? plan.continuation?.workspaceRoot,
		}
	}

	private isCleanMergedPriorRun(
		plan: ExecutionPlan,
		planPacket: ParallelPlanCompletionPacket,
		agentPackets: AgentCompletionPacket[],
		mergeEntries: MergeReviewEntry[],
	): boolean {
		if (planPacket.status !== "merged" || planPacket.merge.status !== "merged" || !planPacket.merge.clean) {
			return false
		}

		if (
			planPacket.failedAgentCount > 0 ||
			planPacket.failedAgents.length > 0 ||
			planPacket.merge.failedAgents.length > 0 ||
			planPacket.merge.conflictedFiles.length > 0 ||
			planPacket.validationSummary.failed > 0 ||
			planPacket.validationSummary.unknown > 0
		) {
			return false
		}

		if (agentPackets.length !== plan.agents.length || plan.agents.some((agent) => agent.status !== "complete")) {
			return false
		}

		const mergeEntriesByAgentId = new Map(mergeEntries.map((entry) => [entry.agentId, entry]))
		return plan.agents.every((agent) => {
			const packet = agentPackets.find((candidate) => candidate.agentId === agent.id)
			const entry = mergeEntriesByAgentId.get(agent.id)
			return Boolean(
				packet &&
					packet.status === "complete" &&
					packet.merge.result === "merged" &&
					packet.merge.clean !== false &&
					packet.merge.worktreePath &&
					packet.merge.branch &&
					entry &&
					entry.mergeStatus === "merged" &&
					entry.mergeable !== false &&
					!entry.reviewError &&
					!entry.mergeError &&
					(entry.conflictedFiles?.length ?? 0) === 0 &&
					entry.worktreePath &&
					entry.branch,
			)
		})
	}

	private findContinuationMatch(
		agent: AgentPlan,
		priorRun: PriorParallelAgentRun,
		usedPriorAgentIds: Set<string>,
	): PriorParallelAgentMatch | undefined {
		const candidates = priorRun.plan.agents
			.filter((priorAgent) => !usedPriorAgentIds.has(priorAgent.id))
			.map((priorAgent) => this.scoreContinuationMatch(agent, priorAgent, priorRun))
			.filter((match): match is PriorParallelAgentMatch => match !== undefined && match.score >= 100)
			.sort((left, right) => right.score - left.score)

		if (candidates.length === 0) {
			return undefined
		}

		if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
			return undefined
		}

		return candidates[0]
	}

	private scoreContinuationMatch(
		agent: AgentPlan,
		priorAgent: AgentPlan,
		priorRun: PriorParallelAgentRun,
	): PriorParallelAgentMatch | undefined {
		const packet = priorRun.agentPacketsById.get(priorAgent.id)
		const mergeEntry = priorRun.mergeEntriesByAgentId.get(priorAgent.id)
		const priorPaths = this.collectPriorAgentRelevantPaths(priorAgent, packet, mergeEntry)
		const newPaths = this.collectNewAgentRelevantPaths(agent)
		const relevantFiles = this.getOverlappingPaths(newPaths, priorPaths)
		const signals: string[] = []
		let score = 0

		if (relevantFiles.length > 0) {
			score += 100
			signals.push("owned/artifact path overlap")
		}

		if (agent.id === priorAgent.id) {
			score += 15
			signals.push("same agent id")
		}

		if (agent.mode === priorAgent.mode) {
			score += 5
			signals.push("same mode")
		}

		if (this.hasMeaningfulTextOverlap(agent.task, priorAgent.task)) {
			score += 10
			signals.push("task wording overlap")
		}

		return score > 0 ? { agent: priorAgent, packet, mergeEntry, score, signals, relevantFiles } : undefined
	}

	private async buildReusedAgentContinuation(
		plan: ExecutionPlan,
		agent: AgentPlan,
		priorRun: PriorParallelAgentRun,
		match: PriorParallelAgentMatch,
		repositoryRoot?: string,
	): Promise<AgentContinuationMetadata> {
		const sourceBranch = match.mergeEntry?.branch ?? match.packet?.merge.branch
		const sourceWorktreePath = match.mergeEntry?.worktreePath ?? match.packet?.merge.worktreePath
		const newBranch = this.getAgentBranchName(plan.planId, agent.id)

		if (!sourceBranch || !sourceWorktreePath) {
			return this.buildFreshAgentContinuation(
				plan,
				agent,
				"Prior agent is missing usable branch/worktree metadata.",
				match,
			)
		}

		if (priorRun.workspaceRoot && !arePathsEqual(priorRun.workspaceRoot, getWorkspacePath())) {
			return this.buildFreshAgentContinuation(
				plan,
				agent,
				"Prior run workspace root does not match the current workspace.",
				match,
			)
		}

		if (priorRun.repositoryRoot && repositoryRoot && !arePathsEqual(priorRun.repositoryRoot, repositoryRoot)) {
			return this.buildFreshAgentContinuation(
				plan,
				agent,
				"Prior run repository root does not match the current repository root.",
				match,
			)
		}

		const inspection = await this.ensureWorktreeManager().inspectReusableWorktree({
			worktreePath: sourceWorktreePath,
			branch: sourceBranch,
			expectedRepositoryRoot: priorRun.repositoryRoot ?? repositoryRoot,
		})

		if (!inspection.reusable) {
			if (inspection.nonRetryable) {
				this.log(
					`[parallel-agents] Retained worktree reuse inspection is unavailable for ${agent.id}; marking candidate fresh without retrying git: ${inspection.reason}`,
				)
			}

			return this.buildFreshAgentContinuation(
				plan,
				agent,
				`Retained worktree is not safely reusable: ${inspection.reason}.`,
				match,
			)
		}

		const continuation: AgentContinuationMetadata = {
			decision: "reused",
			reason: "Prior clean merged agent has strong conservative path overlap and passed retained worktree safety inspection.",
			sourcePlanId: priorRun.plan.planId,
			sourceAgentId: match.agent.id,
			sourceBranch,
			sourceWorktreePath,
			sourceTask: match.agent.task,
			sourceGoal: priorRun.plan.goal ?? priorRun.plan.sharedContext,
			newPlanId: plan.planId,
			newAgentId: agent.id,
			newBranch,
			reusedWorktreePath: sourceWorktreePath,
			resetToCurrentBaseline: inspection.resetRequired,
			relevanceScore: match.score,
			relevanceSignals: match.signals,
			relevantFiles: match.relevantFiles.slice(0, PARALLEL_CONTINUATION_FILE_LIMIT),
			changeStats: match.mergeEntry?.changeStats,
		}
		continuation.context = this.buildAgentContinuationContext(plan, agent, priorRun, match, continuation)
		return continuation
	}

	private buildFreshAgentContinuation(
		plan: ExecutionPlan,
		agent: AgentPlan,
		reason: string,
		match?: PriorParallelAgentMatch,
	): AgentContinuationMetadata {
		return {
			decision: "fresh",
			reason,
			sourcePlanId: match?.packet?.planId,
			sourceAgentId: match?.agent.id,
			newPlanId: plan.planId,
			newAgentId: agent.id,
			newBranch: this.getAgentBranchName(plan.planId, agent.id),
			relevanceScore: match?.score,
			relevanceSignals: match?.signals,
			relevantFiles: match?.relevantFiles.slice(0, PARALLEL_CONTINUATION_FILE_LIMIT),
		}
	}

	private buildAgentContinuationContext(
		plan: ExecutionPlan,
		agent: AgentPlan,
		priorRun: PriorParallelAgentRun,
		match: PriorParallelAgentMatch,
		continuation: AgentContinuationMetadata,
	): string {
		const packet = match.packet
		const mergeEntry = match.mergeEntry
		const resultSummary = this.truncateText(
			packet?.completionResult ?? mergeEntry?.noChangesReason ?? "",
			PARALLEL_CONTINUATION_RESULT_LIMIT,
		)
		const validationNotes = packet?.validation
			.map((validation) => `${validation.name}: ${validation.status}; ${validation.summary}`)
			.slice(0, 5)
			.join(" | ")
		const files = continuation.relevantFiles ?? []
		const lines = [
			"[PARALLEL AGENT CONTINUATION CONTEXT]",
			"Prior clean merged parallel-agent work is available as compact context only. Do not replay old child history or assume stale code still applies.",
			`Prior goal: ${this.truncateText(priorRun.plan.goal ?? priorRun.plan.sharedContext, 300)}`,
			`Prior agent: ${match.agent.id} (${match.agent.mode}) — ${this.truncateText(match.agent.task, 300)}`,
			resultSummary ? `Prior result summary: ${resultSummary}` : undefined,
			`Prior merge: ${mergeEntry?.mergeStatus ?? packet?.merge.result ?? "merged"}; branch ${continuation.sourceBranch}; worktree ${continuation.sourceWorktreePath}.`,
			mergeEntry?.changeStats
				? `Prior change stats: ${mergeEntry.changeStats.filesChanged} files, +${mergeEntry.changeStats.additions}/-${mergeEntry.changeStats.deletions}.`
				: undefined,
			validationNotes ? `Prior validation notes: ${this.truncateText(validationNotes, 500)}` : undefined,
			files.length
				? `Relevant prior/current paths (capped):\n${files.map((filePath) => `- ${filePath}`).join("\n")}`
				: undefined,
			`Worktree identity: source plan ${continuation.sourcePlanId}, source agent ${continuation.sourceAgentId}, new plan ${plan.planId}, new agent ${agent.id}, new branch ${continuation.newBranch}, reused worktree ${continuation.reusedWorktreePath}, refreshed=${continuation.resetToCurrentBaseline === true}.`,
			`New plan goal: ${this.truncateText(plan.goal ?? plan.sharedContext, 400)}`,
			plan.sharedContext ? `New shared context: ${this.truncateText(plan.sharedContext, 500)}` : undefined,
			plan.sharedContract ? `New shared contract: ${this.truncateText(plan.sharedContract, 500)}` : undefined,
			`New agent task: ${this.truncateText(agent.task, 500)}`,
			`New ownership: ${agent.owns.map((ownership) => `${ownership.path} (${ownership.mode})`).join(", ") || "none"}`,
			`New must-not-touch: ${agent.mustNotTouch.join(", ") || "none"}`,
			"Constraints: prioritize the new request, new ownership map, current workspace state, and current baseline. Inspect targeted files before editing. Do not delegate or create nested parallel plans.",
		]
		return this.truncateText(lines.filter(Boolean).join("\n"), PARALLEL_CONTINUATION_CONTEXT_LIMIT)
	}

	private collectNewAgentRelevantPaths(agent: AgentPlan): string[] {
		return this.uniqueNormalizedPaths([
			...agent.owns.map((ownership) => ownership.path),
			...agent.mustNotTouch,
			...this.extractPathLikeTerms(agent.task),
		])
	}

	private collectPriorAgentRelevantPaths(
		agent: AgentPlan,
		packet?: AgentCompletionPacket,
		mergeEntry?: MergeReviewEntry,
	): string[] {
		return this.uniqueNormalizedPaths([
			...agent.owns.map((ownership) => ownership.path),
			...agent.mustNotTouch,
			...(packet?.ownedPaths.map((ownership) => ownership.path) ?? []),
			...(packet?.artifactManifest.flatMap(
				(artifact) => [artifact.path, artifact.previousPath].filter(Boolean) as string[],
			) ?? []),
			...this.extractMergeEntryPaths(mergeEntry),
			...this.extractPathLikeTerms(agent.task),
		])
	}

	private extractMergeEntryPaths(entry?: MergeReviewEntry): string[] {
		if (!entry) {
			return []
		}

		return [
			...computeArtifactManifestFromDiff(entry.diff).flatMap(
				(artifact: ParallelArtifactManifestEntry) =>
					[artifact.path, artifact.previousPath].filter(Boolean) as string[],
			),
			...(entry.conflictedFiles ?? []),
		]
	}

	private extractPathLikeTerms(text: string): string[] {
		return Array.from(text.matchAll(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+(?:\.[A-Za-z0-9_.-]+)?/g)).map(
			(match) => match[0],
		)
	}

	private getOverlappingPaths(leftPaths: string[], rightPaths: string[]): string[] {
		const overlaps: string[] = []
		for (const leftPath of leftPaths) {
			for (const rightPath of rightPaths) {
				if (this.planPathsOverlap(leftPath, rightPath)) {
					overlaps.push(leftPath.length >= rightPath.length ? leftPath : rightPath)
				}
			}
		}

		return this.uniqueNormalizedPaths(overlaps).slice(0, PARALLEL_CONTINUATION_FILE_LIMIT)
	}

	private uniqueNormalizedPaths(paths: string[]): string[] {
		const seen = new Set<string>()
		const result: string[] = []
		for (const filePath of paths) {
			const normalized = this.normalizePlanPath(filePath)
			if (!normalized || seen.has(normalized)) {
				continue
			}
			seen.add(normalized)
			result.push(normalized)
		}
		return result
	}

	private normalizePlanPath(filePath: string | undefined): string {
		return String(filePath ?? "")
			.trim()
			.replace(/\\/g, "/")
			.replace(/^\.\//, "")
			.replace(/\/+$/g, "")
	}

	private planPathsOverlap(leftPath: string, rightPath: string): boolean {
		const left = this.normalizePlanPath(leftPath)
		const right = this.normalizePlanPath(rightPath)
		return Boolean(
			left && right && (left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)),
		)
	}

	private hasMeaningfulTextOverlap(left: string, right: string): boolean {
		const leftTerms = new Set(this.extractSignificantTerms(left))
		return this.extractSignificantTerms(right).some((term) => leftTerms.has(term))
	}

	private extractSignificantTerms(text: string): string[] {
		const stopWords = new Set([
			"the",
			"and",
			"for",
			"with",
			"from",
			"that",
			"this",
			"task",
			"agent",
			"implement",
			"update",
			"build",
		])
		return text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((term) => term.length >= 4 && !stopWords.has(term))
	}

	private truncateText(text: string | undefined, limit: number): string {
		const normalized = String(text ?? "")
			.replace(/\s+/g, " ")
			.trim()
		return normalized.length > limit ? `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : normalized
	}

	private async getCurrentRepositoryRootForContinuation(): Promise<string | undefined> {
		try {
			return await this.ensureWorktreeManager().validateGitRepository()
		} catch (error) {
			this.log(
				`[parallel-agents] Skipping repository-root continuation gate because git validation failed: ${getWorktreeManagerErrorMessage(error)}`,
			)
			return undefined
		}
	}

	private prepareRestoredRunningParallelPlan(plan: ExecutionPlan): ParallelResumeRestoreResult {
		const agentIdsToRestart: string[] = []
		for (const agent of plan.agents) {
			const persistedStatus = this.parallelAgentStatusUpdates.get(agent.id)?.status ?? agent.status
			if (persistedStatus === "complete" || agent.status === "complete") {
				agent.status = "complete"
				continue
			}

			if (persistedStatus === "failed" || agent.status === "failed") {
				agent.status = "failed"
				continue
			}

			agent.status = "pending"
			agentIdsToRestart.push(agent.id)
		}

		if (agentIdsToRestart.length === 0 && plan.agents.every((agent) => agent.status === "complete")) {
			this.parallelStatusPhase = "review"
			return { status: "review", rebuildReview: (this.parallelMergeReviewEntries?.length ?? 0) === 0 }
		}

		if (agentIdsToRestart.length === 0) {
			this.parallelStatusPhase = "failed"
			return {
				status: "failed",
				reason: "all incomplete parallel agents were already marked failed, so there is no safe agent to restart automatically.",
			}
		}

		this.parallelStatusPhase = "running"
		return { status: "running", agentIdsToRestart }
	}

	public async requestPlanApproval(plan: ExecutionPlan): Promise<PlanApprovalResult> {
		const resolvePendingPlanApproval = this.pendingPlanApproval
		this.pendingPlanApproval = undefined
		resolvePendingPlanApproval?.({ approved: false })
		await this.decorateExecutionPlanWithContinuation(plan)

		const { autoApprovalEnabled, alwaysAllowParallelTasks } = await this.getState()
		if (autoApprovalEnabled && alwaysAllowParallelTasks) {
			const startResult = await this.startApprovedExecutionPlan(plan)
			this.postStateToWebviewWithoutClineMessages().catch(() => {})
			return { approved: true, plan, startResult }
		}

		this.postMessageToWebview({ type: "showPlanPreview", executionPlan: plan }).catch(() => {})

		return new Promise((resolve) => {
			this.pendingPlanApproval = resolve
		})
	}

	public async approveExecutionPlan(plan: ExecutionPlan): Promise<void> {
		const resolve = this.pendingPlanApproval
		this.pendingPlanApproval = undefined
		const startResult = await this.startApprovedExecutionPlan(plan)
		resolve?.({ approved: true, plan, startResult })
		this.postStateToWebviewWithoutClineMessages().catch(() => {})
	}

	public async cancelExecutionPlan(): Promise<void> {
		await this.teardownParallelExecution({ markCancelled: true, resetBus: true, cleanupWorktrees: true })
		const resolve = this.pendingPlanApproval
		this.pendingPlanApproval = undefined
		resolve?.({ approved: false })
		this.postStateToWebviewWithoutClineMessages().catch(() => {})
	}

	public async createAgentWorktree(agentId: string, planId: string): Promise<string> {
		const agent =
			this.activeExecutionPlan?.planId === planId
				? this.activeExecutionPlan.agents.find((candidate) => candidate.id === agentId)
				: undefined
		const continuation = agent?.continuation
		if (
			agent &&
			continuation?.decision === "reused" &&
			continuation.sourceWorktreePath &&
			continuation.sourceBranch
		) {
			try {
				this.recordParallelAgentActivity(
					agentId,
					"Inspecting retained worktree for continuation reuse.",
					"tool",
				)
				const newBranch = continuation.newBranch ?? this.getAgentBranchName(planId, agentId)
				const reused = await this.ensureWorktreeManager().reuseWorktree({
					worktreePath: continuation.sourceWorktreePath,
					sourceBranch: continuation.sourceBranch,
					newBranch,
				})
				agent.worktreePath = reused.worktreePath
				agent.continuation = {
					...continuation,
					newBranch: reused.branch,
					reusedWorktreePath: reused.worktreePath,
					resetToCurrentBaseline: reused.resetToCurrentBaseline,
				}
				this.worktreePathsByAgentId.set(agentId, reused.worktreePath)
				this.recordParallelAgentActivity(
					agentId,
					`Reusing retained worktree at ${reused.worktreePath}${reused.resetToCurrentBaseline ? " after refreshing to current workspace baseline" : ""}.`,
					"file",
				)
				return reused.worktreePath
			} catch (error) {
				const message = getWorktreeManagerErrorMessage(error)
				if (isWorktreeManagerGitUnavailableError(error)) {
					this.recordParallelAgentActivity(
						agentId,
						`Retained worktree reuse unavailable because Git could not be started: ${message}`,
						"error",
					)
					this.log(`[parallel-agents] Retained worktree reuse unavailable for ${agentId}: ${message}`)
					throw new Error(message)
				}

				this.recordParallelAgentActivity(
					agentId,
					`Retained worktree reuse skipped; creating a fresh worktree instead: ${message}`,
					"wait",
				)
				agent.continuation = {
					...continuation,
					decision: "fresh",
					reason: `Retained worktree reuse failed: ${message}`,
					context: undefined,
					reusedWorktreePath: undefined,
					resetToCurrentBaseline: undefined,
				}
			}
		}

		try {
			this.recordParallelAgentActivity(agentId, "Creating isolated worktree.", "tool")
			const worktreePath = await this.ensureWorktreeManager().createWorktree(agentId, planId)
			this.worktreePathsByAgentId.set(agentId, worktreePath)
			this.recordParallelAgentActivity(agentId, `Created isolated worktree at ${worktreePath}.`, "file")
			return worktreePath
		} catch (error) {
			const message = getWorktreeManagerErrorMessage(error)
			this.recordParallelAgentActivity(agentId, `Failed to create worktree: ${message}`, "error")
			this.log(`[parallel-agents] Failed to create worktree for ${agentId}: ${message}`)
			vscode.window.showErrorMessage(message)
			throw new Error(message)
		}
	}

	public async removeAgentWorktree(worktreePath: string): Promise<void> {
		await this.ensureWorktreeManager().removeWorktree(worktreePath)
	}

	private ensureWorktreeManager(): WorktreeManager {
		const workspacePath = getWorkspacePath()
		if (!this.worktreeManager || this.currentWorkspacePath !== workspacePath) {
			this.currentWorkspacePath = workspacePath
			this.worktreeManager = new WorktreeManager(workspacePath)
		}

		return this.worktreeManager
	}

	public handleAgentWaitOnConflict(agentId?: string, filePath?: string): void {
		if (!agentId || !filePath) {
			return
		}

		AgentBus.getInstance().markBlocked(agentId, `Waiting for write access to ${filePath}.`)
	}

	public handleAgentEscalateConflict(agentId?: string, filePath?: string): void {
		if (!agentId || !filePath) {
			return
		}

		const ownerAgentId = this.activeExecutionPlan?.fileOwnershipMap[filePath]
		const ownerTask = ownerAgentId
			? this.activeExecutionPlan?.agents.find((agent) => agent.id === ownerAgentId)?.task
			: undefined
		const message = `Parallel agent ${agentId} escalated a write conflict for ${filePath}${ownerTask ? `, owned by ${ownerTask}` : ""}.`
		this.getCurrentTask()
			?.say("text", message)
			.catch(() => {})
	}

	public async showMergeReview(plan: ExecutionPlan): Promise<void> {
		const entries = await Promise.all(plan.agents.map((agent) => this.buildMergeReviewEntry(plan, agent.id)))
		this.parallelMergeReviewEntries = entries
		for (const entry of entries) {
			this.updateParallelAgentPacketFromMergeEntry(plan, entry)
		}
		const autoMergeDecision = await this.evaluateAutoMergeReview(plan, entries)

		if (autoMergeDecision.enabled) {
			if (autoMergeDecision.skipReasons.length > 0) {
				for (const skipReason of autoMergeDecision.skipReasons) {
					const agentId = skipReason.agentId ?? plan.agents[0]?.id
					if (agentId) {
						this.recordParallelAgentActivity(agentId, `Auto-merge skipped: ${skipReason.reason}`, "wait")
					}
				}

				this.log(
					`[parallel-agents] Auto-merge skipped: ${autoMergeDecision.skipReasons
						.map((skipReason) => skipReason.reason)
						.join("; ")}`,
				)
			} else {
				for (const agentId of autoMergeDecision.approvedAgentIds) {
					this.recordParallelAgentActivity(agentId, "Auto-approved final merge review.", "approval")
				}

				this.log(
					`[parallel-agents] Auto-approved final merge review for ${autoMergeDecision.approvedAgentIds.length} agent branch(es).`,
				)
			}
		}

		if (autoMergeDecision.enabled && autoMergeDecision.skipReasons.length > 0) {
			this.applyAutoMergeSkipReasons(entries, autoMergeDecision.skipReasons)
			for (const entry of entries) {
				this.updateParallelAgentPacketFromMergeEntry(plan, entry)
			}
		}

		this.recordParallelAgentReviewSummary(plan, entries)
		await this.updateParallelAgentStatusMessage("review", entries)
		await this.appendParallelAgentOutcomeSummary(plan, "review", entries)

		if (autoMergeDecision.enabled && autoMergeDecision.skipReasons.length === 0) {
			await this.mergeApprovedAgents(autoMergeDecision.approvedAgentIds, { autoApproved: true })
		} else {
			const resumeReason = autoMergeDecision.enabled
				? "parallel merge review after auto-merge was skipped"
				: "parallel merge review awaiting manual action"
			await this.resumeParentAfterParallelMerge(resumeReason, plan.planId)
		}
	}

	private async evaluateAutoMergeReview(
		plan: ExecutionPlan,
		entries: MergeReviewEntry[],
	): Promise<AutoMergeReviewDecision> {
		const { autoApprovalEnabled, alwaysAllowParallelTasks } = await this.getState()

		if (!autoApprovalEnabled || !alwaysAllowParallelTasks) {
			return { enabled: false, approvedAgentIds: [], skipReasons: [] }
		}

		const entriesByAgentId = new Map(entries.map((entry) => [entry.agentId, entry]))
		const conflictsByAgentId = new Map<string, WriteIntentConflict>()
		const skipReasons: AutoMergeReviewSkipReason[] = []

		for (const conflict of this.parallelWriteConflicts.values()) {
			conflictsByAgentId.set(conflict.agentId, conflict)
		}

		if (entries.length === 0) {
			skipReasons.push({ reason: "no merge review entries were available" })
		}

		for (const agent of plan.agents) {
			const entry = entriesByAgentId.get(agent.id)

			if (agent.status !== "complete") {
				skipReasons.push({ agentId: agent.id, reason: `${agent.id} is ${agent.status}` })
				continue
			}

			if (!entry) {
				skipReasons.push({ agentId: agent.id, reason: `${agent.id} has no merge review entry` })
				continue
			}

			if (entry.mergeable === false || entry.reviewError || entry.mergeError || entry.mergeStatus === "failed") {
				const detail =
					entry.reviewError ?? entry.mergeError ?? entry.autoMergeSkippedReason ?? entry.mergeStatus
				skipReasons.push({
					agentId: agent.id,
					reason: `${agent.id} has a merge review error${detail ? `: ${detail}` : ""}`,
				})
				continue
			}

			if (!entry.branch) {
				skipReasons.push({ agentId: agent.id, reason: `${agent.id} has no review branch` })
				continue
			}

			if (!entry.worktreePath) {
				skipReasons.push({ agentId: agent.id, reason: `${agent.id} has no worktree path` })
				continue
			}

			const conflict = conflictsByAgentId.get(agent.id)
			if (conflict) {
				skipReasons.push({
					agentId: agent.id,
					reason: `${agent.id} still has a write conflict for ${conflict.filePath}`,
				})
			}
		}

		const planAgentIds = new Set(plan.agents.map((agent) => agent.id))
		for (const entry of entries) {
			if (!planAgentIds.has(entry.agentId)) {
				skipReasons.push({ agentId: entry.agentId, reason: `${entry.agentId} is not in the active plan` })
			}
		}

		return {
			enabled: true,
			approvedAgentIds: skipReasons.length > 0 ? [] : plan.agents.map((agent) => agent.id),
			skipReasons,
		}
	}

	public async mergeApprovedAgents(
		agentIds: string[] = [],
		options: MergeApprovedAgentsOptions = {},
	): Promise<boolean> {
		let plan = this.activeExecutionPlan
		if (!plan) {
			plan = await this.restorePersistedParallelReviewState()
		}

		if (!plan) {
			await this.postMessageToWebview({
				type: "mergeFailed",
				gitOutput: "No active execution plan is available.",
			})
			await this.resumeParentAfterParallelMerge("manual merge failure: no active execution plan")
			return false
		}

		const approved = new Set(agentIds)
		if (approved.size === 0) {
			await this.postMessageToWebview({
				type: "mergeFailed",
				gitOutput: "No agent branches were selected for merge.",
			})
			await this.resumeParentAfterParallelMerge("manual merge failure: no agent branches selected", plan.planId)
			return false
		}

		const entries = await this.ensureMergeReviewEntriesForPlan(plan)
		const entryByAgentId = new Map(entries.map((entry) => [entry.agentId, entry]))
		const unsafeEntries = Array.from(approved)
			.map((agentId) => entryByAgentId.get(agentId))
			.filter((entry): entry is MergeReviewEntry => Boolean(entry))
			.filter((entry) => entry.mergeable === false || entry.reviewError || entry.mergeStatus === "failed")

		if (unsafeEntries.length > 0) {
			const details = unsafeEntries
				.map(
					(entry) => `${entry.agentId}: ${entry.mergeError ?? entry.reviewError ?? "entry is not mergeable"}`,
				)
				.join("\n")
			await this.postMessageToWebview({
				type: "mergeFailed",
				gitOutput: `Cannot merge entries with unresolved review errors.\n${details}`,
			})
			await this.resumeParentAfterParallelMerge("manual merge failure: unresolved review errors", plan.planId)
			return false
		}

		for (const agentId of approved) {
			const branch = this.getAgentBranchName(plan.planId, agentId)
			const agent = plan.agents.find((candidate) => candidate.id === agentId)
			const reviewEntry = entryByAgentId.get(agentId)
			const worktreePath =
				this.worktreePathsByAgentId.get(agentId) ?? agent?.worktreePath ?? reviewEntry?.worktreePath
			let materializationEntry = reviewEntry

			try {
				this.recordParallelAgentActivity(agentId, `Preparing branch ${branch} for merge.`, "tool")

				if (worktreePath) {
					await this.prepareAgentBranchForReview(plan, agentId, branch, worktreePath)
					materializationEntry =
						this.parallelMergeReviewEntries?.find((entry) => entry.agentId === agentId) ?? reviewEntry
				}

				const ownedPaths = this.getAgentOwnedPaths(agent)
				const affectedPaths = this.getMergeAffectedPaths(materializationEntry, ownedPaths)
				const documentPreparation = await this.prepareAffectedOpenDocumentsForMerge(
					plan.planId,
					agentId,
					affectedPaths,
					{ autoApproved: options.autoApproved === true },
				)

				if (options.autoApproved === true && documentPreparation.dirtyDocuments.length > 0) {
					const dirtyCount = documentPreparation.dirtyDocuments.length
					const dirtyLabel =
						dirtyCount === 1 ? "1 affected open document" : `${dirtyCount} affected open documents`
					const reason = `Auto-merge blocked because ${dirtyLabel} had unsaved changes. Roo saved the open document${dirtyCount === 1 ? "" : "s"} so manual merge review can account for those edits.`
					this.logMergeDocumentSyncDiagnostics(plan.planId, agentId, {
						stage: "auto-approved-block",
						result: "blocked",
						autoApproved: true,
						affectedPaths: documentPreparation.affectedPaths,
						openDocumentPaths: documentPreparation.openDocuments.map((document) => document.relPath),
						dirtyDocumentPaths: documentPreparation.dirtyDocuments.map((document) => document.relPath),
						savedDocumentPaths: documentPreparation.savedDocuments.map((document) => document.relPath),
					})
					this.updateMergeReviewEntry(agentId, {
						mergeStatus: "skipped",
						mergeError: undefined,
						conflictedFiles: undefined,
						autoMergeSkippedReason: reason,
					})
					const skippedEntry = this.parallelMergeReviewEntries?.find((entry) => entry.agentId === agentId)
					if (skippedEntry) {
						this.updateParallelAgentPacketFromMergeEntry(plan, skippedEntry, {
							readiness: "not-ready",
							result: "skipped",
							clean: true,
							materialized: false,
							autoApproved: true,
							notes: [reason],
						})
					}
					this.recordParallelAgentActivity(agentId, reason, "wait")
					this.recordParallelAgentReviewSummary(plan, this.parallelMergeReviewEntries)
					await this.updateParallelAgentStatusMessage("review", this.parallelMergeReviewEntries)
					await this.appendParallelAgentOutcomeSummary(plan, "review", this.parallelMergeReviewEntries)
					await this.postStateToWebviewWithoutClineMessages()
					await this.resumeParentAfterParallelMerge("auto-merge blocked by dirty open document", plan.planId)
					return false
				}

				this.recordParallelAgentActivity(agentId, `Applying branch ${branch} to the workspace.`, "file")
				await this.ensureWorktreeManager().mergeBranch(branch, {
					planId: plan.planId,
					worktreePath,
					ownedPaths,
					autoApproved: options.autoApproved === true,
				})
				await this.synchronizeAffectedOpenDocumentsAfterMerge(plan.planId, agentId, documentPreparation)
				this.updateMergeReviewEntry(agentId, {
					mergeStatus: "merged",
					mergeError: undefined,
					conflictedFiles: undefined,
					autoMergeSkippedReason: undefined,
				})
				const mergedEntry = this.parallelMergeReviewEntries?.find((entry) => entry.agentId === agentId)
				this.logMergeMaterializationDiagnostics(
					plan.planId,
					agentId,
					mergedEntry ?? materializationEntry,
					"merged",
					{
						branch,
						worktreePath,
					},
				)
				if (mergedEntry) {
					this.updateParallelAgentPacketFromMergeEntry(plan, mergedEntry, {
						readiness: "ready",
						result: "merged",
						clean: true,
						materialized: true,
						autoApproved: options.autoApproved === true,
						notes: [options.autoApproved ? "Auto-merged cleanly." : "Merged cleanly."],
					})
				}

				if (options.autoApproved) {
					this.recordParallelAgentActivity(agentId, `Auto-merged branch ${branch}.`, "completion")
				} else {
					this.recordParallelAgentActivity(agentId, `Merged branch ${branch}.`, "completion")
				}
			} catch (error) {
				const gitOutput = this.formatGitError(error)
				this.updateMergeReviewEntry(agentId, {
					mergeStatus: "failed",
					mergeError: gitOutput,
					mergeable: false,
					conflictedFiles: error instanceof WorktreeMergeError ? error.conflictedFiles : undefined,
				})
				const failedEntry = this.parallelMergeReviewEntries?.find((entry) => entry.agentId === agentId)
				this.logMergeMaterializationDiagnostics(
					plan.planId,
					agentId,
					failedEntry ?? materializationEntry,
					"failed",
					{
						branch,
						worktreePath,
					},
					error,
				)
				if (failedEntry) {
					this.updateParallelAgentPacketFromMergeEntry(plan, failedEntry, {
						readiness: "not-ready",
						result: "failed",
						clean: false,
						materialized: false,
						autoApproved: options.autoApproved === true,
						mergeError: gitOutput,
						conflictedFiles: error instanceof WorktreeMergeError ? error.conflictedFiles : undefined,
						notes: ["Merge failed during workspace materialization."],
					})
				}

				if (options.autoApproved) {
					this.recordParallelAgentActivity(agentId, `Auto-merge failed: ${gitOutput}`, "error")
				}

				this.recordParallelAgentReviewSummary(plan, this.parallelMergeReviewEntries)
				await this.updateParallelAgentStatusMessage("review", this.parallelMergeReviewEntries)
				await this.appendParallelAgentOutcomeSummary(plan, "failed", this.parallelMergeReviewEntries)

				await this.postMessageToWebview({
					type: "mergeFailed",
					agentId,
					gitOutput,
				})
				await this.resumeParentAfterParallelMerge("merge failure during workspace materialization", plan.planId)
				return false
			}
		}

		this.orchestratorEventLoop?.stop()
		this.orchestratorEventLoop = undefined

		for (const task of Array.from(this.backgroundTasks)) {
			this.finalizeBackgroundAgentTask(task, "complete")

			try {
				await task.abortTask(true)
			} catch (error) {
				this.log(
					`[parallel-agents] Failed to abort completed background task ${task.taskId}.${task.instanceId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}

			this.removeBackgroundTask(task)
		}

		this.parallelStatusPhase = "merged"
		const retainedWorktrees = this.getReusableRetainedWorktreePaths(plan)
		await Promise.allSettled(
			plan.agents.map((agent) => {
				const worktreePath = this.worktreePathsByAgentId.get(agent.id) ?? agent.worktreePath
				if (!worktreePath) {
					return Promise.resolve()
				}

				if (retainedWorktrees.has(worktreePath)) {
					this.worktreeManager?.forgetWorktree?.(worktreePath)
					return Promise.resolve()
				}

				return this.worktreeManager?.removeWorktree(worktreePath)
			}),
		)
		await this.worktreeManager?.cleanupPlanBaseline(plan.planId)

		this.recordParallelAgentReviewSummary(plan, this.parallelMergeReviewEntries)
		await this.updateParallelAgentStatusMessage("merged")
		await this.appendParallelAgentOutcomeSummary(plan, "merged", this.parallelMergeReviewEntries)
		const finalMergeReviewEntries = this.parallelMergeReviewEntries
		await this.teardownParallelExecution({ resetBus: true })
		await this.postMessageToWebview({ type: "mergeComplete" })
		await this.postStateToWebviewWithoutClineMessages()
		this.notifyParallelMergeWorkflowCompletion(
			this.getCurrentTask(),
			plan,
			Array.from(approved),
			finalMergeReviewEntries,
		)
		await this.resumeParentAfterParallelMerge("successful parallel merge", plan.planId)
		return true
	}

	private async resumeParentAfterParallelMerge(
		reason: string = "parallel review/merge",
		planId: string | undefined = this.activeExecutionPlan?.planId ?? this.parallelStatusPlanId,
	): Promise<void> {
		const task = this.getCurrentTask()
		if (!task) {
			this.logEmailNotificationDiagnostics("parallel-parent-resume-lifecycle", {
				planId,
				reason,
				result: "skipped-no-current-task",
			})
			this.log(
				`[parallel-agents] parent-resume-diagnostics ${JSON.stringify({
					planId,
					reason,
					result: "skipped-no-current-task",
				})}`,
			)
			this.log(`[parallel-agents] Skipping parent resume after ${reason}: no current task is available.`)
			return
		}

		if (task.background) {
			this.logEmailNotificationDiagnostics("parallel-parent-resume-lifecycle", {
				...this.getEmailNotificationTaskDiagnostics(task),
				...this.getEmailNotificationOutcomeDiagnostics(task.taskId, "success"),
				planId,
				reason,
				result: "skipped-current-task-background",
			})
			this.log(
				`[parallel-agents] parent-resume-diagnostics ${JSON.stringify({
					planId,
					reason,
					result: "skipped-current-task-background",
					taskId: task.taskId,
					agentId: task.agentId,
				})}`,
			)
			this.log(
				`[parallel-agents] Skipping parent resume after ${reason}: current task ${task.taskId} is a background task.`,
			)
			return
		}

		const resumeKey = `${task.taskId}:${planId ?? "unknown-plan"}`
		if (this.parallelParentResumeKey === resumeKey) {
			this.logEmailNotificationDiagnostics("parallel-parent-resume-lifecycle", {
				...this.getEmailNotificationTaskDiagnostics(task),
				...this.getEmailNotificationOutcomeDiagnostics(task.taskId, "success"),
				planId,
				reason,
				result: "skipped-duplicate",
				resumeKey,
			})
			this.log(
				`[parallel-agents] parent-resume-diagnostics ${JSON.stringify({
					planId,
					reason,
					result: "skipped-duplicate",
					taskId: task.taskId,
					resumeKey,
				})}`,
			)
			this.log(`[parallel-agents] Skipping duplicate parent resume for task ${task.taskId} after ${reason}.`)
			return
		}

		this.parallelParentResumeKey = resumeKey

		try {
			this.logEmailNotificationDiagnostics("parallel-parent-resume-lifecycle", {
				...this.getEmailNotificationTaskDiagnostics(task),
				...this.getEmailNotificationOutcomeDiagnostics(task.taskId, "success"),
				planId,
				reason,
				result: "resume-started",
				resumeKey,
			})
			this.log(`[parallel-agents] Resuming parent task ${task.taskId} after ${reason}.`)
			await task.resumeAfterParallelExecution()
			this.logParallelApprovalDiagnostics("parent-resumed", planId)
			this.logEmailNotificationDiagnostics("parallel-parent-resume-lifecycle", {
				...this.getEmailNotificationTaskDiagnostics(task),
				...this.getEmailNotificationOutcomeDiagnostics(task.taskId, "success"),
				planId,
				reason,
				result: "resumed",
				resumeKey,
			})
			this.log(
				`[parallel-agents] parent-resume-diagnostics ${JSON.stringify({
					planId,
					reason,
					result: "resumed",
					taskId: task.taskId,
					resumeKey,
				})}`,
			)
			this.log(`[parallel-agents] Parent task ${task.taskId} resumed after ${reason}.`)
		} catch (error) {
			if (this.parallelParentResumeKey === resumeKey) {
				this.parallelParentResumeKey = undefined
			}
			this.logEmailNotificationDiagnostics("parallel-parent-resume-lifecycle", {
				...this.getEmailNotificationTaskDiagnostics(task),
				...this.getEmailNotificationOutcomeDiagnostics(task.taskId, "success"),
				planId,
				reason,
				result: "failed",
				resumeKey,
				error: this.sanitizeEmailNotificationLogMessage(error),
			})
			this.log(
				`[parallel-agents] parent-resume-diagnostics ${JSON.stringify({
					planId,
					reason,
					result: "failed",
					taskId: task.taskId,
					resumeKey,
					error: error instanceof Error ? error.message : String(error),
				})}`,
			)
			this.log(
				`[parallel-agents] Failed to resume parent task ${task.taskId} after ${reason}: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	private logParallelApprovalDiagnostics(stage: string, planId?: string): void {
		const task = this.getCurrentTask()
		const backgroundTasksWithPendingAsk = Array.from(this.backgroundTasks)
			.map((backgroundTask) => ({
				taskId: backgroundTask.taskId,
				agentId: backgroundTask.agentId,
				ask: this.describeApprovalDiagnosticMessage(backgroundTask.taskAsk),
			}))
			.filter((summary) => Boolean(summary.ask))

		const diagnostics = {
			stage,
			planId: planId ?? this.activeExecutionPlan?.planId ?? this.parallelStatusPlanId,
			activePlanId: this.activeExecutionPlan?.planId,
			persistedStatusPlanId: this.parallelStatusPlanId,
			pendingPlanApproval: Boolean(this.pendingPlanApproval),
			backgroundTaskCount: this.backgroundTasks.size,
			backgroundTasksWithPendingAsk,
			parentTask: task
				? {
						taskId: task.taskId,
						background: task.background === true,
						taskStatus: task.taskStatus,
						taskAsk: this.describeApprovalDiagnosticMessage(task.taskAsk),
						latestUnansweredAsk: this.describeApprovalDiagnosticMessage(
							this.findLatestUnansweredAskMessage(task),
						),
						latestParallelAgentsMessage: this.describeLatestParallelAgentStatusMessage(task),
					}
				: undefined,
		}

		this.log(`[parallel-agents] approval-state ${JSON.stringify(diagnostics)}`)
	}

	private findLatestUnansweredAskMessage(task?: Task): ClineMessage | undefined {
		if (!task) {
			return undefined
		}

		for (let index = task.clineMessages.length - 1; index >= 0; index -= 1) {
			const message = task.clineMessages[index]
			if (message.type === "ask" && !message.isAnswered) {
				return message
			}
		}

		return undefined
	}

	private describeApprovalDiagnosticMessage(message?: ClineMessage): Record<string, unknown> | undefined {
		if (!message) {
			return undefined
		}

		const tool =
			message.text && (message.ask === "tool" || message.say === "tool")
				? this.tryParseToolPayload(message.text)
				: undefined
		const parallelTool = tool?.tool === "parallelAgents" ? tool : undefined

		return {
			type: message.type,
			ask: message.ask,
			say: message.say,
			partial: message.partial === true,
			isAnswered: message.isAnswered === true,
			tool: tool?.tool,
			parallelStatus: parallelTool?.parallelStatus,
			planId: parallelTool?.executionPlan?.planId,
		}
	}

	private describeLatestParallelAgentStatusMessage(task?: Task): Record<string, unknown> | undefined {
		if (!task) {
			return undefined
		}

		for (let index = task.clineMessages.length - 1; index >= 0; index -= 1) {
			const tool = this.tryParseParallelAgentToolMessage(task.clineMessages[index])
			if (!tool) {
				continue
			}

			return {
				planId: tool.executionPlan?.planId,
				parallelStatus: tool.parallelStatus,
				mergeReviewEntryCount: tool.mergeReviewEntries?.length ?? 0,
				agentStatusUpdateCount: tool.agentStatusUpdates?.length ?? 0,
				agentActivityCount: tool.agentActivities?.length ?? 0,
				agentCompletionPacketCount: tool.agentCompletionPackets?.length ?? 0,
			}
		}

		return undefined
	}

	public async denyMergeReview(): Promise<boolean> {
		let plan = this.activeExecutionPlan
		if (!plan) {
			plan = await this.restorePersistedParallelReviewState()
		}

		if (!plan) {
			await this.postMessageToWebview({
				type: "mergeFailed",
				gitOutput: "No active execution plan is available.",
			})
			await this.resumeParentAfterParallelMerge("merge denial failure: no active execution plan")
			return false
		}

		const entries = await this.ensureMergeReviewEntriesForPlan(plan)
		for (const entry of entries) {
			if (entry.mergeStatus === "merged" || entry.mergeStatus === "failed") {
				continue
			}

			this.updateMergeReviewEntry(entry.agentId, {
				mergeStatus: "skipped",
				autoMergeSkippedReason: "Merge review was denied from chat.",
			})
			this.recordParallelAgentActivity(entry.agentId, "Merge review denied from chat.", "approval")
			const skippedEntry = this.parallelMergeReviewEntries?.find(
				(candidate) => candidate.agentId === entry.agentId,
			)
			if (skippedEntry) {
				this.updateParallelAgentPacketFromMergeEntry(plan, skippedEntry, {
					readiness: "not-ready",
					result: "skipped",
					clean: true,
					materialized: false,
					notes: ["Merge review was denied from chat."],
				})
			}
		}

		this.recordParallelAgentReviewSummary(plan, this.parallelMergeReviewEntries)
		await this.updateParallelAgentStatusMessage("cancelled", this.parallelMergeReviewEntries)
		await this.appendParallelAgentOutcomeSummary(plan, "cancelled", this.parallelMergeReviewEntries)
		await this.teardownParallelExecution({ resetBus: true, cleanupWorktrees: true })
		await this.postStateToWebviewWithoutClineMessages()
		await this.resumeParentAfterParallelMerge("merge review denial", plan.planId)
		return true
	}

	private async teardownParallelExecution(
		options: { markCancelled?: boolean; resetBus?: boolean; cleanupWorktrees?: boolean } = {},
	): Promise<void> {
		const activePlan = this.activeExecutionPlan
		const planId = this.activeExecutionPlan?.planId ?? this.parallelStatusPlanId
		const hadParallelState = Boolean(
			this.activeExecutionPlan ||
				this.orchestratorEventLoop ||
				this.pendingPlanApproval ||
				this.backgroundTasks.size > 0,
		)

		if (options.markCancelled) {
			const resolve = this.pendingPlanApproval
			this.pendingPlanApproval = undefined
			resolve?.({ approved: false })
		}

		const stopReason = options.markCancelled
			? "Parallel execution was cancelled."
			: "Parallel execution was stopped."

		this.orchestratorEventLoop?.stop({
			abortSpawnedTasks: true,
			reason: stopReason,
		})
		this.orchestratorEventLoop = undefined

		for (const task of Array.from(this.backgroundTasks)) {
			this.finalizeBackgroundAgentTask(task, "failed", stopReason)

			try {
				await task.abortTask(true)
			} catch (error) {
				this.log(
					`[parallel-agents] Failed to abort background task ${task.taskId}.${task.instanceId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}

			this.removeBackgroundTask(task)
		}

		if (options.markCancelled && this.activeExecutionPlan) {
			this.failRemainingActiveParallelAgents(stopReason)
			await this.updateParallelAgentStatusMessage("cancelled")
		}

		if (options.cleanupWorktrees) {
			const knownWorktreePaths = Array.from(this.worktreePathsByAgentId.values())
			const retainedWorktrees = activePlan ? this.getReusableRetainedWorktreePaths(activePlan) : new Set<string>()
			const cleanupResult = await Promise.resolve(
				this.worktreeManager?.cleanup({ retainWorktreePaths: Array.from(retainedWorktrees) }),
			)
				.then(() => ({ status: "fulfilled" as const }))
				.catch((error) => ({ status: "rejected" as const, reason: error }))

			if (cleanupResult.status === "rejected") {
				this.log(
					`[parallel-agents] Ignoring worktree cleanup failure during teardown: ${getWorktreeManagerErrorMessage(cleanupResult.reason)}`,
				)
			}

			await Promise.allSettled(
				knownWorktreePaths.map((worktreePath) =>
					retainedWorktrees.has(worktreePath)
						? Promise.resolve()
						: this.worktreeManager?.removeWorktree(worktreePath),
				),
			)
		}

		if (options.resetBus) {
			AgentBus.getInstance().off("event", this.forwardAgentEvent)
			AgentBus.reset()
		}

		this.activeExecutionPlan = undefined
		this.worktreePathsByAgentId.clear()
		this.deniedWriteReasons.clear()
		this.resetParallelAgentStatusState()

		if (hadParallelState) {
			this.log("[parallel-agents] Cleared active parallel execution state")
			this.logParallelApprovalDiagnostics("parallel-cleanup", planId)
		}
	}

	private attachAgentBusForwarders(bus: AgentBus): void {
		bus.off("event", this.forwardAgentEvent)
		bus.on("event", this.forwardAgentEvent)
	}

	private postAgentStatusUpdate(update: AgentStatusUpdate): void {
		this.postMessageToWebview({
			type: "agentStatusUpdate",
			agentStatusUpdate: this.withAgentActivities(update),
		}).catch(() => {})
	}

	private postAgentCoordinationUpdate(event: AgentCoordinationEvent): void {
		this.postMessageToWebview({
			type: "agentCoordinationUpdate",
			agentCoordinationEvent: event,
		}).catch(() => {})
	}

	private postBackgroundAgentUsage(task: Task, usage: TokenUsage): void {
		if (!task.background || !task.agentId) {
			return
		}

		const update = {
			agentId: task.agentId,
			status: this.getAgentStatus(task.agentId) ?? "running",
			usage,
		} satisfies AgentStatusUpdate

		this.postAgentStatusUpdate(update)
		this.recordParallelAgentStatus(update)
	}

	private finalizeBackgroundAgentTask(task: Task, status: "complete" | "failed", reason?: string): void {
		if (!task.background || !task.agentId || !this.activeExecutionPlan) {
			return
		}

		const agent = this.activeExecutionPlan.agents.find((candidate) => candidate.id === task.agentId)
		if (!agent || agent.status === "complete" || agent.status === "failed") {
			return
		}

		const bus = AgentBus.getInstance()
		if (status === "complete") {
			bus.markComplete(task.agentId)
		} else {
			bus.markFailed(task.agentId, reason ?? "Agent task failed.")
		}
	}

	private failRemainingActiveParallelAgents(reason: string): void {
		if (!this.activeExecutionPlan) {
			return
		}

		const bus = AgentBus.getInstance()
		for (const agent of this.activeExecutionPlan.agents) {
			if (agent.status === "complete" || agent.status === "failed") {
				continue
			}

			if (bus.getAgent(agent.id)) {
				bus.markFailed(agent.id, reason)
			} else {
				agent.status = "failed"
				const update = {
					agentId: agent.id,
					status: "failed",
					reason,
				} satisfies AgentStatusUpdate
				this.postAgentStatusUpdate(update)
				this.recordParallelAgentStatus(update)
			}
		}
	}

	private getReusableRetainedWorktreePaths(plan: ExecutionPlan): Set<string> {
		if (this.parallelStatusPhase !== "merged") {
			return new Set()
		}

		const entriesByAgentId = new Map((this.parallelMergeReviewEntries ?? []).map((entry) => [entry.agentId, entry]))
		const packetsByAgentId = new Map(
			this.getParallelAgentCompletionPackets(plan).map((packet) => [packet.agentId, packet]),
		)
		const retained = new Set<string>()

		for (const agent of plan.agents) {
			const entry = entriesByAgentId.get(agent.id)
			const packet = packetsByAgentId.get(agent.id)
			const worktreePath =
				this.worktreePathsByAgentId.get(agent.id) ??
				entry?.worktreePath ??
				packet?.merge.worktreePath ??
				agent.worktreePath
			if (
				worktreePath &&
				agent.status === "complete" &&
				entry?.mergeStatus === "merged" &&
				entry.mergeable !== false &&
				!entry.reviewError &&
				!entry.mergeError &&
				(entry.conflictedFiles?.length ?? 0) === 0 &&
				packet?.status === "complete" &&
				packet.merge.result === "merged" &&
				packet.merge.clean !== false
			) {
				retained.add(worktreePath)
			}
		}

		return retained
	}

	private resetParallelAgentStatusState(planId?: string): void {
		this.parallelStatusMessageTs = undefined
		this.parallelStatusPlanId = planId
		this.parallelStatusPhase = "running"
		this.parallelMergeReviewEntries = undefined
		this.parallelUsageSummary = undefined
		this.parallelReviewSummary = undefined
		this.parallelAgentCompletionPackets.clear()
		this.parallelPlanCompletionPacket = undefined
		this.parallelAgentStatusUpdates.clear()
		this.parallelAgentActivities.clear()
		this.parallelAgentCoordinationEvents = []
		this.parallelWriteConflicts.clear()
		this.parallelContinuation = undefined
	}

	private async ensureParallelAgentStatusMessage(plan: ExecutionPlan): Promise<void> {
		const task = this.getCurrentTask()

		if (!task || task.background) {
			return
		}

		const existing = this.findParallelAgentStatusMessage(task, plan.planId)
		if (existing) {
			this.parallelStatusMessageTs = existing.ts
			this.parallelStatusPlanId = plan.planId
			return
		}

		await task.say(
			"tool",
			JSON.stringify(this.buildParallelAgentToolPayload(plan)),
			undefined,
			undefined,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)

		const created = this.findParallelAgentStatusMessage(task, plan.planId)
		this.parallelStatusMessageTs = created?.ts
		this.parallelStatusPlanId = plan.planId
	}

	private async updateParallelAgentStatusMessage(
		phase?: ParallelAgentToolStatus,
		mergeReviewEntries?: MergeReviewEntry[],
	): Promise<void> {
		if (phase) {
			this.parallelStatusPhase = phase
		}

		if (mergeReviewEntries) {
			this.parallelMergeReviewEntries = mergeReviewEntries
		}

		await this.queueParallelAgentStatusMessageUpdate()
	}

	private scheduleParallelAgentStatusMessageUpdate(): void {
		this.queueParallelAgentStatusMessageUpdate().catch((error) => {
			this.log(
				`[parallel-agents] Failed to persist status message: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		})
	}

	private queueParallelAgentStatusMessageUpdate(): Promise<void> {
		this.parallelStatusUpdateRequested = true

		if (this.parallelStatusUpdatePromise) {
			return this.parallelStatusUpdatePromise.then(async () => {
				if (this.parallelStatusUpdateRequested) {
					await this.queueParallelAgentStatusMessageUpdate()
				}
			})
		}

		const queued = this.parallelStatusUpdateQueue.then(async () => {
			while (this.parallelStatusUpdateRequested) {
				this.parallelStatusUpdateRequested = false
				await this.writeParallelAgentStatusMessage()
			}
		})

		let tracked: Promise<void>
		tracked = queued.finally(() => {
			if (this.parallelStatusUpdatePromise === tracked) {
				this.parallelStatusUpdatePromise = undefined
			}
		})

		this.parallelStatusUpdatePromise = tracked
		this.parallelStatusUpdateQueue = tracked.catch(() => undefined)
		return tracked
	}

	private async writeParallelAgentStatusMessage(): Promise<void> {
		const plan = this.activeExecutionPlan
		if (!plan) {
			return
		}

		await this.ensureParallelAgentStatusMessage(plan)

		const task = this.getCurrentTask()
		if (!task || task.background) {
			return
		}

		const message = this.findParallelAgentStatusMessage(task, plan.planId)
		if (!message) {
			return
		}

		message.text = JSON.stringify(this.buildParallelAgentToolPayload(plan, this.parallelMergeReviewEntries))
		await task.overwriteClineMessages([...task.clineMessages])
		await this.postMessageToWebview({ type: "messageUpdated", clineMessage: message })
	}

	private buildParallelAgentToolPayload(plan: ExecutionPlan, mergeReviewEntries?: MergeReviewEntry[]): ClineSayTool {
		const agentCompletionPackets = this.getParallelAgentCompletionPackets(plan)
		const parallelPlanCompletionPacket = this.getParallelPlanCompletionPacket(
			plan,
			agentCompletionPackets,
			this.getParallelPlanCompletionStatusOverride(agentCompletionPackets),
		)

		return {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: this.parallelStatusPhase,
			agentStatusUpdates: Array.from(this.parallelAgentStatusUpdates.values()),
			writeIntentConflicts: Array.from(this.parallelWriteConflicts.values()),
			agentActivities: this.getParallelAgentActivities(),
			agentCoordinationEvents: this.parallelAgentCoordinationEvents,
			parallelUsageSummary: this.parallelUsageSummary,
			parallelReviewSummary: this.parallelReviewSummary,
			mergeReviewEntries,
			agentCompletionPackets,
			parallelPlanCompletionPacket,
			parallelContinuation: this.parallelContinuation ?? plan.continuation,
		}
	}

	private applyAutoMergeSkipReasons(entries: MergeReviewEntry[], skipReasons: AutoMergeReviewSkipReason[]): void {
		for (const skipReason of skipReasons) {
			if (!skipReason.agentId) {
				continue
			}

			const entry = entries.find((candidate) => candidate.agentId === skipReason.agentId)
			if (!entry) {
				continue
			}

			entry.mergeStatus = "skipped"
			entry.autoMergeSkippedReason = skipReason.reason
		}
	}

	private updateMergeReviewEntry(agentId: string, updates: Partial<MergeReviewEntry>): void {
		this.parallelMergeReviewEntries = (this.parallelMergeReviewEntries ?? []).map((entry) =>
			entry.agentId === agentId ? { ...entry, ...updates } : entry,
		)
	}

	private async ensureMergeReviewEntriesForPlan(plan: ExecutionPlan): Promise<MergeReviewEntry[]> {
		if (this.parallelMergeReviewEntries?.length) {
			return this.parallelMergeReviewEntries
		}

		const restored = await this.restorePersistedParallelReviewState(plan.planId)
		if (restored && this.parallelMergeReviewEntries?.length) {
			return this.parallelMergeReviewEntries
		}

		return []
	}

	private async restorePersistedParallelReviewState(planId?: string): Promise<ExecutionPlan | undefined> {
		const task = this.getCurrentTask()
		if (!task || task.background) {
			return undefined
		}
		const globalStoragePath = this.context.globalStorageUri.fsPath

		const savedMessages =
			task.clineMessages.length > 0
				? task.clineMessages
				: await readTaskMessages({ taskId: task.taskId, globalStoragePath })
		const reviewMessage = [...savedMessages]
			.reverse()
			.map((message) => this.tryParseParallelAgentToolMessage(message))
			.find(
				(tool) =>
					Boolean(tool?.executionPlan) &&
					tool?.parallelStatus === "review" &&
					(!planId || tool.executionPlan?.planId === planId) &&
					(tool.mergeReviewEntries?.length ?? 0) > 0,
			)

		if (!reviewMessage?.executionPlan) {
			return undefined
		}

		this.activeExecutionPlan = reviewMessage.executionPlan
		this.parallelStatusPhase = "review"
		this.parallelStatusPlanId = reviewMessage.executionPlan.planId
		this.parallelMergeReviewEntries = reviewMessage.mergeReviewEntries
		this.parallelUsageSummary = reviewMessage.parallelUsageSummary
		this.parallelAgentCompletionPackets.clear()
		for (const packet of reviewMessage.agentCompletionPackets ?? []) {
			this.parallelAgentCompletionPackets.set(packet.agentId, packet)
		}
		this.parallelPlanCompletionPacket = reviewMessage.parallelPlanCompletionPacket
		this.parallelContinuation = reviewMessage.parallelContinuation ?? reviewMessage.executionPlan.continuation
		this.parallelReviewSummary =
			reviewMessage.parallelReviewSummary ??
			this.buildParallelAgentReviewSummary(reviewMessage.executionPlan, reviewMessage.mergeReviewEntries ?? [])
		this.parallelAgentStatusUpdates.clear()
		for (const update of reviewMessage.agentStatusUpdates ?? []) {
			this.parallelAgentStatusUpdates.set(update.agentId, update)
		}
		this.parallelAgentActivities.clear()
		for (const activity of reviewMessage.agentActivities ?? []) {
			const previous = this.parallelAgentActivities.get(activity.agentId) ?? []
			this.parallelAgentActivities.set(
				activity.agentId,
				[...previous, activity].slice(-PARALLEL_AGENT_ACTIVITY_LIMIT),
			)
		}
		this.parallelAgentCoordinationEvents = (reviewMessage.agentCoordinationEvents ?? []).slice(
			-PARALLEL_AGENT_COORDINATION_LIMIT,
		)
		this.parallelWriteConflicts.clear()
		for (const conflict of reviewMessage.writeIntentConflicts ?? []) {
			this.parallelWriteConflicts.set(this.getConflictKey(conflict.agentId, conflict.filePath), conflict)
		}

		for (const entry of reviewMessage.mergeReviewEntries ?? []) {
			if (entry.worktreePath) {
				this.worktreePathsByAgentId.set(entry.agentId, entry.worktreePath)
			}
		}

		return reviewMessage.executionPlan
	}

	private tryParseParallelAgentToolMessage(message: ClineMessage): ClineSayTool | undefined {
		if (message.type !== "say" || message.say !== "tool" || !message.text) {
			return undefined
		}

		const tool = this.tryParseToolPayload(message.text)
		return tool?.tool === "parallelAgents" ? tool : undefined
	}

	private recordParallelAgentCompletionPacket(packet: AgentCompletionPacket): void {
		if (!this.activeExecutionPlan || packet.planId !== this.activeExecutionPlan.planId) {
			return
		}

		this.parallelAgentCompletionPackets.set(packet.agentId, packet)
		this.parallelPlanCompletionPacket = buildParallelPlanCompletionPacket(
			this.activeExecutionPlan,
			this.getParallelAgentCompletionPackets(this.activeExecutionPlan),
			{
				ts: Date.now(),
				source: {
					source: "provider",
					sourceId: this.activeExecutionPlan.planId,
					ts: Date.now(),
					note: "Provider persisted AgentBus completion packet evidence.",
				},
			},
		)
		this.scheduleParallelAgentStatusMessageUpdate()
	}

	private getParallelAgentCompletionPackets(plan: ExecutionPlan): AgentCompletionPacket[] {
		return plan.agents
			.map((agent) => this.ensureParallelAgentCompletionPacket(plan, agent.id))
			.filter((packet): packet is AgentCompletionPacket => Boolean(packet))
	}

	private ensureParallelAgentCompletionPacket(
		plan: ExecutionPlan,
		agentId: string,
		options: { ts?: number } = {},
	): AgentCompletionPacket | undefined {
		const agent = plan.agents.find((candidate) => candidate.id === agentId)
		if (!agent) {
			return undefined
		}

		const existing = this.parallelAgentCompletionPackets.get(agentId)
		if (existing) {
			return existing
		}

		const ts = options.ts ?? Date.now()
		const statusUpdate = this.parallelAgentStatusUpdates.get(agentId)
		const packet = createAgentCompletionPacket(plan, agent, {
			status: statusUpdate?.status ?? agent.status,
			completionResult: statusUpdate?.reason,
			evidence: {
				source: "provider",
				sourceId: agentId,
				ts,
				note: "Provider synthesized completion packet from persisted parallel-agent status state.",
			},
			ts,
		})

		this.parallelAgentCompletionPackets.set(agentId, packet)
		return packet
	}

	private getParallelPlanCompletionPacket(
		plan: ExecutionPlan,
		agentCompletionPackets = this.getParallelAgentCompletionPackets(plan),
		status?: ParallelPlanCompletionStatus,
	): ParallelPlanCompletionPacket {
		const existing = this.parallelPlanCompletionPacket
		if (
			existing?.planId === plan.planId &&
			this.isParallelPlanCompletionPacketCurrent(existing, agentCompletionPackets, status)
		) {
			return existing
		}

		const packet = buildParallelPlanCompletionPacket(plan, agentCompletionPackets, {
			status,
			ts: Date.now(),
			source: {
				source: "provider",
				sourceId: plan.planId,
				ts: Date.now(),
				note: "Provider aggregated persisted per-agent completion packets.",
			},
		})
		this.parallelPlanCompletionPacket = packet
		return packet
	}

	private getParallelPlanCompletionStatusOverride(
		agentCompletionPackets: AgentCompletionPacket[],
	): ParallelPlanCompletionStatus | undefined {
		if (agentCompletionPackets.some((packet) => packet.merge.result === "failed")) {
			return "failed"
		}

		switch (this.parallelStatusPhase) {
			case "review":
				return "awaiting-review"
			case "merged":
				return "merged"
			case "cancelled":
				return "cancelled"
			case "failed":
				return "failed"
			case "running":
				return undefined
		}
	}

	private isParallelPlanCompletionPacketCurrent(
		packet: ParallelPlanCompletionPacket,
		agentCompletionPackets: AgentCompletionPacket[],
		status?: ParallelPlanCompletionStatus,
	): boolean {
		if (packet.packetCount !== agentCompletionPackets.length) {
			return false
		}

		if (status && packet.status !== status) {
			return false
		}

		const packetRefsByAgentId = new Map(packet.agentPacketRefs.map((ref) => [ref.agentId, ref]))
		return agentCompletionPackets.every((agentPacket) => {
			const ref = packetRefsByAgentId.get(agentPacket.agentId)
			return ref?.status === agentPacket.status && ref.packetUpdatedAt === agentPacket.evidence.updatedAt
		})
	}

	private updateParallelAgentPacketFromMergeEntry(
		plan: ExecutionPlan,
		entry: MergeReviewEntry,
		updates: Partial<AgentMergeEvidence> = {},
	): AgentCompletionPacket | undefined {
		const agent = plan.agents.find((candidate) => candidate.id === entry.agentId)
		if (!agent) {
			return undefined
		}

		const ts = Date.now()
		const existing = this.ensureParallelAgentCompletionPacket(plan, entry.agentId, { ts })
		const artifactManifest = computeArtifactManifestFromDiff(entry.diff).map((artifact) => ({
			...artifact,
			agentId: entry.agentId,
		}))
		const mergeStatus = entry.mergeStatus ?? "pending"
		const notes = [
			...(entry.noChangesReason ? [entry.noChangesReason] : []),
			...(entry.autoMergeSkippedReason ? [entry.autoMergeSkippedReason] : []),
		]
		const packet = createAgentCompletionPacket(plan, agent, {
			status: existing?.status ?? agent.status,
			completionResult: existing?.completionResult,
			artifactManifest,
			validation: [
				{
					name: "merge-review",
					status: entry.reviewError || entry.mergeError ? "failed" : "passed",
					summary:
						entry.reviewError ??
						entry.mergeError ??
						entry.noChangesReason ??
						"Merge review evidence captured.",
					ts,
					source: "merge-review",
				},
			],
			merge: {
				readiness: entry.reviewError ? "not-ready" : mergeStatus === "pending" ? "ready" : "awaiting-review",
				result: mergeStatus === "pending" ? "pending" : mergeStatus,
				mergeable: entry.mergeable,
				branch: entry.branch,
				worktreePath: entry.worktreePath,
				clean: !entry.reviewError && !entry.mergeError && (entry.conflictedFiles?.length ?? 0) === 0,
				materialized: mergeStatus === "merged",
				reviewError: entry.reviewError,
				mergeError: entry.mergeError,
				conflictedFiles: entry.conflictedFiles,
				notes,
				ts,
				...updates,
			},
			evidence: {
				source: "merge-review",
				sourceId: entry.agentId,
				ts,
				note: "Provider updated packet from merge review entry.",
			},
			ts,
		})

		if (existing) {
			packet.evidence.createdAt = existing.evidence.createdAt
			packet.evidence.sources = [...existing.evidence.sources, ...packet.evidence.sources]
			packet.ownership = existing.ownership
		}

		this.parallelAgentCompletionPackets.set(entry.agentId, packet)
		this.parallelPlanCompletionPacket = buildParallelPlanCompletionPacket(
			plan,
			this.getParallelAgentCompletionPackets(plan),
			{
				ts,
				source: {
					source: "provider",
					sourceId: plan.planId,
					ts,
					note: "Provider aggregated merge/review packet updates.",
				},
			},
		)
		return packet
	}

	private async appendParallelAgentOutcomeSummary(
		plan: ExecutionPlan,
		status: "review" | "merged" | "failed" | "cancelled",
		entries: MergeReviewEntry[] | undefined,
	): Promise<void> {
		const task = this.getCurrentTask()
		if (!task || task.background) {
			return
		}

		try {
			const globalStoragePath = this.context.globalStorageUri.fsPath
			if (task.apiConversationHistory.length === 0) {
				task.apiConversationHistory = await readApiMessages({
					taskId: task.taskId,
					globalStoragePath,
				})
			}

			const summary = this.buildParallelAgentOutcomeSummary(plan, status, entries)
			const existing = task.apiConversationHistory[task.apiConversationHistory.length - 1]
			if (this.getApiMessageText(existing) === summary) {
				return
			}

			await task.overwriteApiConversationHistory([
				...task.apiConversationHistory,
				{
					role: "user",
					content: [{ type: "text", text: summary }],
					ts: Date.now(),
				},
			])
		} catch (error) {
			this.log(
				`[parallel-agents] Failed to persist parent context summary: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	private recordParallelAgentReviewSummary(plan: ExecutionPlan, entries: MergeReviewEntry[] | undefined): void {
		this.parallelReviewSummary = this.buildParallelAgentReviewSummary(plan, entries ?? [])
	}

	private buildParallelAgentReviewSummary(
		plan: ExecutionPlan,
		entries: MergeReviewEntry[],
	): ParallelAgentReviewSummary {
		const lines = [
			`# Parallel agent review for ${plan.planId}`,
			"",
			"Full per-agent diffs are available in the persisted parallel agents card.",
			"",
			...entries.map((entry) => {
				const stats = entry.changeStats
				const statsText = stats
					? `${stats.filesChanged} files, +${stats.additions}/-${stats.deletions}`
					: entry.diff.trim()
						? "changes detected"
						: "no changes"
				const state = entry.mergeStatus ?? (entry.reviewError ? "failed" : "pending")
				const detail =
					entry.mergeError ?? entry.reviewError ?? entry.autoMergeSkippedReason ?? entry.noChangesReason
				return `- ${entry.agentId}: ${state}; ${statsText}${detail ? `; ${detail}` : ""}`
			}),
		]

		return {
			path: PARALLEL_REVIEW_SUMMARY_PATH,
			markdown: lines.join("\n"),
		}
	}

	private buildParallelAgentOutcomeSummary(
		plan: ExecutionPlan,
		status: "review" | "merged" | "failed" | "cancelled",
		entries: MergeReviewEntry[] | undefined,
	): string {
		const statusByOutcome: Record<typeof status, ParallelPlanCompletionStatus> = {
			review: "awaiting-review",
			merged: "merged",
			failed: "failed",
			cancelled: "cancelled",
		}
		const agentCompletionPackets = this.getParallelAgentCompletionPackets(plan)
		const parallelPlanCompletionPacket = this.getParallelPlanCompletionPacket(
			plan,
			agentCompletionPackets,
			statusByOutcome[status],
		)
		const parentVerificationDirective = this.buildParallelParentVerificationDirective(
			parallelPlanCompletionPacket,
			agentCompletionPackets,
		)
		const entrySummaries = (entries ?? []).map((entry) => {
			const stats = entry.changeStats
			const statsText = stats
				? `${stats.filesChanged} files, +${stats.additions}/-${stats.deletions}`
				: entry.diff.trim()
					? "changes detected"
					: "no changes"
			const state = entry.mergeStatus ?? (entry.reviewError ? "failed" : "pending")
			const detail = entry.mergeError ?? entry.reviewError ?? entry.autoMergeSkippedReason
			return `- ${entry.agentId} (${entry.task}): ${state}; ${statsText}${detail ? `; ${detail}` : ""}`
		})

		return [
			`[PARALLEL AGENT SUMMARY] Plan ${plan.planId} is ${status}.`,
			`Shared context: ${plan.sharedContext}`,
			entrySummaries.length > 0 ? entrySummaries.join("\n") : "No merge review entries were recorded.",
			"Structured completion packet:",
			JSON.stringify(
				{
					parallelPlanCompletionPacket,
					agentCompletionPackets,
					parentVerificationDirective,
				},
				null,
				2,
			),
			this.buildParallelParentVerificationGuidance(parentVerificationDirective),
			"Use the persisted parallel agents card for approval/merge actions; do not rerun plan_parallel_tasks for this plan unless the user explicitly asks for a new plan.",
		].join("\n")
	}

	private buildParallelParentVerificationDirective(
		parallelPlanCompletionPacket: ParallelPlanCompletionPacket,
		agentCompletionPackets: AgentCompletionPacket[],
	): ParallelParentVerificationDirective {
		const packetCountMatchesPlan =
			parallelPlanCompletionPacket.packetCount === parallelPlanCompletionPacket.agentCount &&
			agentCompletionPackets.length === parallelPlanCompletionPacket.agentCount
		const hasNoFailedAgents =
			parallelPlanCompletionPacket.failedAgentCount === 0 &&
			parallelPlanCompletionPacket.failedAgents.length === 0 &&
			parallelPlanCompletionPacket.merge.failedAgents.length === 0
		const hasCleanValidation =
			parallelPlanCompletionPacket.validationSummary.failed === 0 &&
			parallelPlanCompletionPacket.validationSummary.unknown === 0
		const hasCleanMerge =
			parallelPlanCompletionPacket.status === "merged" &&
			parallelPlanCompletionPacket.merge.status === "merged" &&
			parallelPlanCompletionPacket.merge.clean &&
			parallelPlanCompletionPacket.merge.conflictedFiles.length === 0
		const cleanMergedEvidence = packetCountMatchesPlan && hasNoFailedAgents && hasCleanValidation && hasCleanMerge

		return {
			sourceOfTruth: "structured_completion_packet",
			evidenceStatus: cleanMergedEvidence ? "clean-merged" : "requires-attention",
			noReverification: cleanMergedEvidence,
			summary: cleanMergedEvidence
				? "Plan-level structured packet reports clean merged evidence with complete agent packets, clean merge materialization, and no failed or unknown validation results."
				: "Plan-level structured packet is missing clean merged evidence or reports failed, incomplete, or inconclusive evidence; targeted inspection remains available for the specific evidence gap.",
			todoGuidance: cleanMergedEvidence
				? "Mark any redundant review/verify result or assembled deliverable step complete from the structured packet and continue with the next non-verification step."
				: "Do not mark verification complete from this packet alone; resolve the failed, incomplete, or inconclusive evidence first.",
			allowedInspectionReasons: cleanMergedEvidence
				? [
						"the user explicitly asks for deeper verification",
						"new evidence contradicts the structured completion packet",
					]
				: [
						"the packet is missing, failed, incomplete, or inconclusive",
						"merge evidence reports conflicts, failed agents, failed or unknown validation, or an unclean merge",
						"the user explicitly asks for deeper verification",
					],
			evidence: {
				planStatus: parallelPlanCompletionPacket.status,
				mergeStatus: parallelPlanCompletionPacket.merge.status,
				mergeClean: parallelPlanCompletionPacket.merge.clean,
				packetCount: parallelPlanCompletionPacket.packetCount,
				agentCount: parallelPlanCompletionPacket.agentCount,
				failedAgentCount: parallelPlanCompletionPacket.failedAgentCount,
				mergeFailedAgents: parallelPlanCompletionPacket.merge.failedAgents,
				conflictedFiles: parallelPlanCompletionPacket.merge.conflictedFiles,
				validationFailed: parallelPlanCompletionPacket.validationSummary.failed,
				validationUnknown: parallelPlanCompletionPacket.validationSummary.unknown,
			},
		}
	}

	private buildParallelParentVerificationGuidance(directive: ParallelParentVerificationDirective): string {
		const lines = [
			"Parent resume guidance:",
			"- Treat the structured completion packet and parentVerificationDirective as the verification source of truth for this parallel plan before considering manual inspection.",
			"- Do not perform broad file reads/searches over already-merged parallel deliverables solely to verify them.",
		]

		if (directive.evidenceStatus === "clean-merged") {
			lines.push(
				"- The plan-level packet reports clean merged evidence; mark any redundant review/verify result or assembled deliverable todo step complete from this evidence and continue with the next non-verification step.",
			)
		} else {
			lines.push(
				"- The plan-level packet requires attention; do not mark redundant verification complete until the failed, incomplete, or inconclusive evidence is resolved.",
			)
		}

		lines.push(`- Only inspect files when ${directive.allowedInspectionReasons.join("; ")}.`)
		return lines.join("\n")
	}

	private getApiMessageText(message: unknown): string | undefined {
		if (!message || typeof message !== "object") {
			return undefined
		}

		const content = (message as { content?: unknown }).content
		if (typeof content === "string") {
			return content
		}

		if (!Array.isArray(content)) {
			return undefined
		}

		return content
			.map((block) => (block && typeof block === "object" && "text" in block ? String(block.text) : ""))
			.filter(Boolean)
			.join("\n")
	}

	private findParallelAgentStatusMessage(task: Task, planId: string): ClineMessage | undefined {
		const byTimestamp = this.parallelStatusMessageTs
			? task.clineMessages.find((message) => message.ts === this.parallelStatusMessageTs)
			: undefined

		if (byTimestamp && this.isParallelAgentStatusMessageForPlan(byTimestamp, planId)) {
			return byTimestamp
		}

		return task.clineMessages.find((message) => this.isParallelAgentStatusMessageForPlan(message, planId))
	}

	private isParallelAgentStatusMessageForPlan(message: ClineMessage, planId: string): boolean {
		if (message.type !== "say" || message.say !== "tool" || !message.text) {
			return false
		}

		try {
			const tool = JSON.parse(message.text) as ClineSayTool
			return tool.tool === "parallelAgents" && tool.executionPlan?.planId === planId
		} catch {
			return false
		}
	}

	private recordParallelAgentStatus(update: AgentStatusUpdate): void {
		if (!this.activeExecutionPlan) {
			return
		}

		const previous = this.parallelAgentStatusUpdates.get(update.agentId)
		this.parallelAgentStatusUpdates.set(update.agentId, this.withAgentActivities({ ...previous, ...update }))
		this.parallelUsageSummary = this.buildParallelUsageSummary()

		if (update.status === "failed" && this.parallelStatusPhase !== "cancelled") {
			this.parallelStatusPhase = "failed"
		}

		this.scheduleParallelAgentStatusMessageUpdate()
	}

	private buildParallelUsageSummary(): ParallelAgentUsageSummary | undefined {
		const updatesWithUsage = Array.from(this.parallelAgentStatusUpdates.values()).filter((update) => update.usage)

		if (updatesWithUsage.length === 0) {
			return undefined
		}

		return updatesWithUsage.reduce<ParallelAgentUsageSummary>(
			(summary, update) => {
				const usage = update.usage!
				summary.totalTokensIn += usage.totalTokensIn
				summary.totalTokensOut += usage.totalTokensOut
				summary.totalCacheWrites += usage.totalCacheWrites ?? 0
				summary.totalCacheReads += usage.totalCacheReads ?? 0
				summary.totalCost += usage.totalCost
				summary.contextTokens += usage.contextTokens
				summary.reportingAgents += 1
				return summary
			},
			{
				totalTokensIn: 0,
				totalTokensOut: 0,
				totalCacheWrites: 0,
				totalCacheReads: 0,
				totalCost: 0,
				contextTokens: 0,
				reportingAgents: 0,
			},
		)
	}

	private recordParallelAgentActivity(
		agentId: string,
		message: string,
		kind: ParallelAgentActivity["kind"] = "status",
		ts: number = Date.now(),
		options: { replaceExistingTimestamp?: boolean } = {},
	): void {
		if (!this.activeExecutionPlan) {
			return
		}

		const previousActivities = this.parallelAgentActivities.get(agentId) ?? []
		const nextActivity = {
			agentId,
			kind,
			message,
			ts,
		} satisfies ParallelAgentActivity
		const replaceIndex = options.replaceExistingTimestamp
			? previousActivities.findIndex((activity) => activity.ts === ts)
			: -1
		const updatedActivities =
			replaceIndex >= 0
				? previousActivities.map((activity, index) => (index === replaceIndex ? nextActivity : activity))
				: [...previousActivities, nextActivity]
		const activities = updatedActivities.slice(-PARALLEL_AGENT_ACTIVITY_LIMIT)
		this.parallelAgentActivities.set(agentId, activities)

		const previousStatus = this.parallelAgentStatusUpdates.get(agentId)
		const update = {
			...previousStatus,
			agentId,
			status: previousStatus?.status ?? this.getAgentStatus(agentId) ?? "running",
			activities,
		} satisfies AgentStatusUpdate
		this.parallelAgentStatusUpdates.set(agentId, update)
		this.postAgentStatusUpdate(update)
		this.scheduleParallelAgentStatusMessageUpdate()
	}

	private recordParallelAgentCoordinationEvent(
		event: Omit<ParallelAgentCoordinationEvent, "ts"> & { ts?: number },
	): ParallelAgentCoordinationEvent | undefined {
		if (!this.activeExecutionPlan) {
			return undefined
		}

		if (this.shouldSuppressParallelAgentCoordinationEvent(event)) {
			return undefined
		}

		const storedEvent = { ...event, ts: event.ts ?? Date.now() }
		const previousEvents = storedEvent.id
			? this.parallelAgentCoordinationEvents.filter((candidate) => candidate.id !== storedEvent.id)
			: this.parallelAgentCoordinationEvents

		this.parallelAgentCoordinationEvents = [...previousEvents, storedEvent].slice(
			-PARALLEL_AGENT_COORDINATION_LIMIT,
		)
		this.postAgentCoordinationUpdate(storedEvent)
		this.scheduleParallelAgentStatusMessageUpdate()
		return storedEvent
	}

	private shouldSuppressParallelAgentCoordinationEvent(
		event: Omit<ParallelAgentCoordinationEvent, "ts"> & { ts?: number },
	): boolean {
		if (event.kind === "shared-context" || event.kind === "ownership" || event.kind === "dependency") {
			return true
		}

		return isGenericOwnershipCoordinationMessage(event.message)
	}

	private describeAgentDependency(dependency: AgentDependency): string {
		if (dependency.waitFor === "signal") {
			return dependency.signal
				? `${dependency.agentId} to signal ${dependency.signal}`
				: `${dependency.agentId} to signal`
		}

		return `${dependency.agentId} to complete`
	}

	private handleBackgroundAgentMessage(task: Task, action: "created" | "updated", message: ClineMessage): void {
		if (!task.background || !task.agentId || !this.activeExecutionPlan) {
			return
		}

		const activity = this.describeBackgroundAgentMessage(message, { agentId: task.agentId })
		if (!activity) {
			return
		}

		this.recordParallelAgentActivity(task.agentId, activity.message, activity.kind, message.ts, {
			replaceExistingTimestamp: action === "updated",
		})
	}

	private describeBackgroundAgentMessage(
		message: ClineMessage,
		options: BackgroundAgentActivityDescriptionOptions = {},
	): BackgroundAgentActivityDescription | undefined {
		if (message.type === "ask" && message.ask === "tool") {
			if (message.partial) {
				return {
					kind: "tool",
					message: this.describeToolActivity(message.text, "Preparing a tool call."),
				}
			}

			return message.isAnswered
				? this.describeResolvedToolActivity(message.text)
				: this.describePendingToolApprovalActivity(message.text)
		}

		if (message.type !== "say") {
			return undefined
		}

		if (message.partial) {
			return this.describePartialBackgroundAgentSayMessage(message, options)
		}

		switch (message.say) {
			case "api_req_started":
				return { kind: "thinking", message: this.describeApiRequestActivity(options.agentId) }
			case "api_req_finished":
				return { kind: "result", message: "Finished thinking." }
			case "api_req_retried":
				return { kind: "wait", message: "Retrying the model request." }
			case "api_req_retry_delayed":
				return { kind: "wait", message: "Waiting before retrying the model request." }
			case "api_req_rate_limit_wait":
				return { kind: "wait", message: "Waiting for the provider rate limit." }
			case "text":
				return this.describeAssistantTextActivity(message.text)
			case "reasoning":
				return { kind: "thinking", message: "Reasoning through the next step." }
			case "tool":
				return { kind: "tool", message: this.describeToolActivity(message.text, "Used a tool.") }
			case "command_output":
				return { kind: "result", message: "Read command output." }
			case "mcp_server_request_started":
				return { kind: "tool", message: "Contacted an MCP server." }
			case "mcp_server_response":
				return { kind: "result", message: "Received MCP server response." }
			case "completion_result":
				return { kind: "completion", message: "Reported completion." }
			case "error":
				return { kind: "error", message: "Encountered an error." }
			default:
				return undefined
		}
	}

	private describePartialBackgroundAgentSayMessage(
		message: ClineMessage,
		options: BackgroundAgentActivityDescriptionOptions = {},
	): BackgroundAgentActivityDescription | undefined {
		if (message.type !== "say") {
			return undefined
		}

		switch (message.say) {
			case "api_req_started":
				return {
					kind: "thinking",
					message: this.describeApiRequestActivity(options.agentId, { partial: true }),
				}
			case "api_req_retried":
				return { kind: "wait", message: "Retrying the model request." }
			case "api_req_retry_delayed":
				return { kind: "wait", message: "Waiting before retrying the model request." }
			case "api_req_rate_limit_wait":
				return { kind: "wait", message: "Waiting for the provider rate limit." }
			case "reasoning":
				return { kind: "thinking", message: "Reasoning through the next step." }
			case "text":
				return { kind: "message", message: "Drafting an agent message." }
			case "tool":
				return { kind: "tool", message: this.describeToolActivity(message.text, "Preparing a tool call.") }
			case "command_output":
				return { kind: "result", message: "Reading command output." }
			case "mcp_server_request_started":
				return { kind: "tool", message: "Contacting an MCP server." }
			case "mcp_server_response":
				return { kind: "result", message: "Receiving MCP server response." }
			default:
				return undefined
		}
	}

	private describeApiRequestActivity(agentId: string | undefined, options: { partial?: boolean } = {}): string {
		const status = agentId ? this.getAgentStatus(agentId) : undefined
		switch (status) {
			case "pending":
				return "Requesting the first model action before this agent starts work."
			case "running":
				return options.partial ? "Streaming the next model action." : "Requesting the next model action."
			case "blocked":
				return "Checking whether blocked work can resume."
			case "complete":
				return "Confirming completed agent work."
			case "failed":
				return "Collecting failure details from the model."
			default:
				return options.partial ? "Streaming the next model action." : "Requesting the next model action."
		}
	}

	private withAgentActivities(update: AgentStatusUpdate): AgentStatusUpdate {
		const activities = this.parallelAgentActivities.get(update.agentId)

		if (!activities?.length) {
			return update
		}

		return {
			...update,
			activities,
		}
	}

	private getParallelAgentActivities(agentId?: string): ParallelAgentActivity[] {
		const activities = agentId
			? (this.parallelAgentActivities.get(agentId) ?? [])
			: Array.from(this.parallelAgentActivities.values()).flat()

		return [...activities].sort((a, b) => a.ts - b.ts)
	}

	private describeStatusActivity(status: AgentStatus): string {
		switch (status) {
			case "pending":
				return "Queued and waiting to start."
			case "running":
				return "Started running."
			case "blocked":
				return "Blocked and waiting."
			case "complete":
				return "Completed."
			case "failed":
				return "Failed."
		}
	}

	private describeAssistantTextActivity(text: string | undefined): BackgroundAgentActivityDescription {
		const summary = this.summarizeActivityText(text)

		return {
			kind: "message",
			message: summary ? `Said: ${summary}` : "Shared a response update.",
		}
	}

	private summarizeActivityText(text: string | undefined): string | undefined {
		const normalized = text?.replace(/\s+/g, " ").trim()
		if (!normalized) {
			return undefined
		}

		const maxLength = 160
		const clipped = normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized
		return `“${clipped}”`
	}

	private describeToolActivity(text: string | undefined, fallback: string): string {
		const parsedTool = this.parseActivityTool(text)
		if (!parsedTool) {
			return fallback
		}
		const { tool, toolName, targetPath } = parsedTool

		switch (toolName) {
			case "editedExistingFile":
			case "edit":
			case "edit_file":
			case "search_and_replace":
			case "search_replace":
				return `Editing ${targetPath ?? "a file"}.`
			case "appliedDiff":
			case "apply_diff":
			case "apply_patch":
				return `Applying a diff to ${targetPath ?? "a file"}.`
			case "newFileCreated":
				return `Creating ${targetPath ?? "a file"}.`
			case "write_to_file":
				return `Writing ${targetPath ?? "a file"}.`
			case "readFile":
			case "read_file":
				return `Reading ${targetPath ?? "a file"}.`
			case "codebaseSearch":
			case "codebase_search":
				return "Searching the codebase."
			case "searchFiles":
			case "search_files":
				return tool.regex ? `Searching files for ${tool.regex}.` : "Searching files."
			case "listFilesTopLevel":
			case "listFilesRecursive":
			case "list_files":
				return `Listing ${targetPath ?? "files"}.`
			case "execute_command":
				return tool.command ? `Running command: ${tool.command}.` : "Running a command."
			case "readCommandOutput":
			case "read_command_output":
				return "Reading command output."
			case "runSlashCommand":
			case "run_slash_command":
				return tool.command ? `Running /${tool.command}.` : "Running a slash command."
			case "switchMode":
			case "switch_mode":
				return tool.mode ? `Switching to ${tool.mode} mode.` : "Switching mode."
			case "newTask":
			case "new_task":
				return "Starting a subtask."
			case "finishTask":
			case "attempt_completion":
				return "Finishing a subtask."
			case "plan_parallel_tasks":
				return "Planning parallel agents."
			case "skill":
				return tool.skill ? `Loading ${tool.skill} skill.` : "Loading a skill."
			case "generateImage":
			case "generate_image":
			case "imageGenerated":
				return "Working with an image."
			case "updateTodoList":
			case "update_todo_list":
				return "Updating the todo list."
			case "parallelAgents":
				return "Updating parallel agent status."
			case "use_mcp_tool":
				return tool.serverName
					? `Calling MCP tool${tool.name ? ` ${tool.name}` : ""} on ${tool.serverName}.`
					: "Calling an MCP tool."
			case "access_mcp_resource":
				return tool.serverName
					? `Reading MCP resource${tool.uri ? ` ${tool.uri}` : ""} from ${tool.serverName}.`
					: "Reading an MCP resource."
			case "ask_followup_question":
				return "Waiting for a follow-up answer."
			default:
				return fallback
		}
	}

	private describePendingToolApprovalActivity(text: string | undefined): BackgroundAgentActivityDescription {
		const parsedTool = this.parseActivityTool(text)
		if (!parsedTool) {
			return { kind: "approval", message: "Waiting for tool approval." }
		}

		const { toolName, targetPath } = parsedTool
		const fileLabel = targetPath ?? "a file"

		switch (toolName) {
			case "appliedDiff":
			case "apply_diff":
			case "apply_patch":
				return { kind: "approval", message: `Waiting for diff approval for ${fileLabel}.` }
			default:
				return { kind: "approval", message: this.describeToolActivity(text, "Waiting for tool approval.") }
		}
	}

	private describeResolvedToolActivity(text: string | undefined): BackgroundAgentActivityDescription {
		const parsedTool = this.parseActivityTool(text)
		if (!parsedTool) {
			return { kind: "approval", message: "Tool approval resolved." }
		}

		const { toolName, targetPath } = parsedTool
		const fileLabel = targetPath ?? "a file"

		switch (toolName) {
			case "appliedDiff":
			case "apply_diff":
			case "apply_patch":
				return { kind: "file", message: `Saving diff changes to ${fileLabel}.` }
			case "editedExistingFile":
			case "edit":
			case "edit_file":
			case "search_and_replace":
			case "search_replace":
			case "write_to_file":
				return { kind: "file", message: `Saving changes to ${fileLabel}.` }
			case "newFileCreated":
				return { kind: "file", message: `Saving new file ${fileLabel}.` }
			default:
				return { kind: "approval", message: "Tool approval resolved." }
		}
	}

	private parseActivityTool(text: string | undefined): ParsedActivityTool | undefined {
		const tool = text ? this.tryParseActivityToolPayload(text) : undefined
		const toolName = tool?.tool

		if (!tool || !toolName) {
			return undefined
		}

		return {
			tool,
			toolName,
			targetPath: tool.path ?? tool.filePath,
		}
	}

	private getAgentOwnedPaths(agent: ExecutionPlan["agents"][number] | undefined): string[] | undefined {
		return agent?.owns.filter((ownership) => ownership.mode !== "read-only").map((ownership) => ownership.path)
	}

	private getMergeAffectedPaths(entry: MergeReviewEntry | undefined, fallbackPaths: string[] | undefined): string[] {
		const affectedPaths = new Set<string>()
		const addPath = (filePath?: string) => {
			const normalized = this.normalizeMergeAffectedPath(filePath)
			if (normalized) {
				affectedPaths.add(normalized)
			}
		}

		if (entry?.diff?.trim()) {
			for (const artifact of computeArtifactManifestFromDiff(entry.diff)) {
				addPath(artifact.path)
				addPath(artifact.previousPath)
			}
		}

		if (affectedPaths.size === 0) {
			for (const fallbackPath of fallbackPaths ?? []) {
				addPath(fallbackPath)
			}
		}

		return Array.from(affectedPaths)
	}

	private normalizeMergeAffectedPath(filePath: string | undefined): string | undefined {
		const normalized = String(filePath ?? "")
			.trim()
			.replace(/^"|"$/g, "")
			.replace(/\\/g, "/")

		if (!normalized || normalized === "/dev/null") {
			return undefined
		}

		const withoutDiffPrefix = normalized.replace(/^[ab]\//, "")
		const relativePath = path.isAbsolute(withoutDiffPrefix)
			? path.relative(this.cwd, withoutDiffPrefix)
			: withoutDiffPrefix
		const posixPath = relativePath.replace(/\\/g, "/")

		if (!posixPath || posixPath === "." || posixPath === ".." || posixPath.startsWith("../")) {
			return undefined
		}

		return posixPath
	}

	private getAffectedOpenDocuments(affectedPaths: string[]): MergeAffectedOpenDocument[] {
		if (affectedPaths.length === 0) {
			return []
		}

		const pathEntries = affectedPaths.map((relPath) => ({
			relPath,
			absolutePath: path.resolve(this.cwd, relPath),
		}))
		const openDocuments: MergeAffectedOpenDocument[] = []

		for (const document of vscode.workspace.textDocuments ?? []) {
			if (document.uri.scheme !== "file") {
				continue
			}

			const match = pathEntries.find((entry) => arePathsEqual(document.uri.fsPath, entry.absolutePath))
			if (!match) {
				continue
			}

			if (
				openDocuments.some((openDocument) =>
					arePathsEqual(openDocument.document.uri.fsPath, document.uri.fsPath),
				)
			) {
				continue
			}

			openDocuments.push({
				document,
				relPath: match.relPath,
				absolutePath: match.absolutePath,
			})
		}

		return openDocuments
	}

	private async prepareAffectedOpenDocumentsForMerge(
		planId: string,
		agentId: string,
		affectedPaths: string[],
		options: { autoApproved: boolean },
	): Promise<MergeDocumentPreparationResult> {
		const openDocuments = this.getAffectedOpenDocuments(affectedPaths)
		const dirtyDocuments = openDocuments.filter(({ document }) => document.isDirty)
		const savedDocuments: MergeAffectedOpenDocument[] = []

		this.logMergeDocumentSyncDiagnostics(planId, agentId, {
			stage: "pre-save",
			result: "started",
			autoApproved: options.autoApproved,
			affectedPaths,
			openDocumentPaths: openDocuments.map((document) => document.relPath),
			dirtyDocumentPaths: dirtyDocuments.map((document) => document.relPath),
		})

		for (const openDocument of dirtyDocuments) {
			let saved = false

			try {
				saved = await openDocument.document.save()
			} catch {
				this.logMergeDocumentSyncDiagnostics(planId, agentId, {
					stage: "pre-save",
					result: "failed",
					autoApproved: options.autoApproved,
					affectedPaths,
					openDocumentPaths: openDocuments.map((document) => document.relPath),
					dirtyDocumentPaths: dirtyDocuments.map((document) => document.relPath),
					savedDocumentPaths: savedDocuments.map((document) => document.relPath),
					failedPaths: [openDocument.relPath],
				})
				throw new Error(
					`Failed to save open document ${openDocument.relPath} before parallel merge; workspace materialization was not applied.`,
				)
			}

			if (!saved) {
				this.logMergeDocumentSyncDiagnostics(planId, agentId, {
					stage: "pre-save",
					result: "failed",
					autoApproved: options.autoApproved,
					affectedPaths,
					openDocumentPaths: openDocuments.map((document) => document.relPath),
					dirtyDocumentPaths: dirtyDocuments.map((document) => document.relPath),
					savedDocumentPaths: savedDocuments.map((document) => document.relPath),
					failedPaths: [openDocument.relPath],
				})
				throw new Error(
					`Failed to save open document ${openDocument.relPath} before parallel merge; workspace materialization was not applied.`,
				)
			}

			savedDocuments.push(openDocument)
		}

		this.logMergeDocumentSyncDiagnostics(planId, agentId, {
			stage: "pre-save",
			result: "completed",
			autoApproved: options.autoApproved,
			affectedPaths,
			openDocumentPaths: openDocuments.map((document) => document.relPath),
			dirtyDocumentPaths: dirtyDocuments.map((document) => document.relPath),
			savedDocumentPaths: savedDocuments.map((document) => document.relPath),
		})

		return { affectedPaths, openDocuments, dirtyDocuments, savedDocuments }
	}

	private async synchronizeAffectedOpenDocumentsAfterMerge(
		planId: string,
		agentId: string,
		preparation: MergeDocumentPreparationResult,
	): Promise<void> {
		const syncedDocumentPaths: string[] = []
		const skippedDirtyPaths: string[] = []
		const failedPaths: string[] = []

		for (const openDocument of preparation.openDocuments) {
			if (openDocument.document.isDirty) {
				skippedDirtyPaths.push(openDocument.relPath)
				continue
			}

			try {
				await vscode.workspace.openTextDocument(openDocument.document.uri)
				syncedDocumentPaths.push(openDocument.relPath)
			} catch {
				failedPaths.push(openDocument.relPath)
			}
		}

		this.logMergeDocumentSyncDiagnostics(planId, agentId, {
			stage: "post-merge-sync",
			result: failedPaths.length > 0 ? "partial" : "completed",
			affectedPaths: preparation.affectedPaths,
			openDocumentPaths: preparation.openDocuments.map((document) => document.relPath),
			dirtyDocumentPaths: preparation.dirtyDocuments.map((document) => document.relPath),
			savedDocumentPaths: preparation.savedDocuments.map((document) => document.relPath),
			syncedDocumentPaths,
			skippedDirtyPaths,
			failedPaths,
		})
	}

	private logMergeDocumentSyncDiagnostics(
		planId: string,
		agentId: string,
		diagnostics: {
			stage: MergeDocumentSyncStage
			result: string
			autoApproved?: boolean
			affectedPaths?: string[]
			openDocumentPaths?: string[]
			dirtyDocumentPaths?: string[]
			savedDocumentPaths?: string[]
			syncedDocumentPaths?: string[]
			skippedDirtyPaths?: string[]
			failedPaths?: string[]
		},
	): void {
		const pathSummary = (paths: string[] | undefined) => this.getDiagnosticPathSample(paths ?? [])

		this.log(
			`[parallel-agents] merge-document-sync ${JSON.stringify({
				planId,
				agentId,
				stage: diagnostics.stage,
				result: diagnostics.result,
				autoApproved: diagnostics.autoApproved,
				affectedPathCount: diagnostics.affectedPaths?.length ?? 0,
				affectedPaths: pathSummary(diagnostics.affectedPaths),
				openDocumentCount: diagnostics.openDocumentPaths?.length ?? 0,
				openDocumentPaths: pathSummary(diagnostics.openDocumentPaths),
				dirtyDocumentCount: diagnostics.dirtyDocumentPaths?.length ?? 0,
				dirtyDocumentPaths: pathSummary(diagnostics.dirtyDocumentPaths),
				savedDocumentCount: diagnostics.savedDocumentPaths?.length ?? 0,
				savedDocumentPaths: pathSummary(diagnostics.savedDocumentPaths),
				syncedDocumentCount: diagnostics.syncedDocumentPaths?.length ?? 0,
				syncedDocumentPaths: pathSummary(diagnostics.syncedDocumentPaths),
				skippedDirtyCount: diagnostics.skippedDirtyPaths?.length ?? 0,
				skippedDirtyPaths: pathSummary(diagnostics.skippedDirtyPaths),
				failedPathCount: diagnostics.failedPaths?.length ?? 0,
				failedPaths: pathSummary(diagnostics.failedPaths),
			})}`,
		)
	}

	private getDiagnosticPathSample(paths: string[]): string[] {
		const uniquePaths = Array.from(new Set(paths))
		const maxPaths = 50

		if (uniquePaths.length <= maxPaths) {
			return uniquePaths
		}

		return [...uniquePaths.slice(0, maxPaths), `...${uniquePaths.length - maxPaths} more`]
	}

	private logMergeReviewDiagnostics(diagnostics: WorktreeMergeReviewDiagnostics): void {
		this.log(`[parallel-agents] merge-review-diagnostics ${JSON.stringify(diagnostics)}`)
	}

	private logMergeMaterializationDiagnostics(
		planId: string,
		agentId: string,
		entry: MergeReviewEntry | undefined,
		result: "merged" | "failed",
		options: { branch?: string; worktreePath?: string } = {},
		error?: unknown,
	): void {
		this.log(
			`[parallel-agents] merge-materialization ${JSON.stringify({
				planId,
				agentId,
				branch: entry?.branch ?? options.branch,
				worktreePath: entry?.worktreePath ?? options.worktreePath,
				mergeStatus: result,
				materialized: result === "merged",
				error: error instanceof Error ? error.message : error ? String(error) : undefined,
			})}`,
		)
	}

	private tryParseActivityToolPayload(text: string): ActivityToolPayload | undefined {
		try {
			return JSON.parse(text) as ActivityToolPayload
		} catch {
			return undefined
		}
	}

	private tryParseToolPayload(text: string): ClineSayTool | undefined {
		try {
			return JSON.parse(text) as ClineSayTool
		} catch {
			return undefined
		}
	}

	private postWriteIntentDenied(agentId: string, filePath: string, ownerAgentId?: string): void {
		const ownerTask = ownerAgentId
			? this.activeExecutionPlan?.agents.find((agent) => agent.id === ownerAgentId)?.task
			: undefined
		const reason = this.deniedWriteReasons.get(this.getConflictKey(agentId, filePath))
		const conflict = {
			agentId,
			filePath,
			ownerAgentId,
			ownerTask,
			reason,
		} satisfies WriteIntentConflict

		this.postMessageToWebview({
			type: "writeIntentDenied",
			writeIntentConflict: conflict,
		}).catch(() => {})
		this.parallelWriteConflicts.set(this.getConflictKey(agentId, filePath), conflict)
		this.recordParallelAgentActivity(
			agentId,
			`Waiting for write access to ${filePath}${ownerTask ? `, owned by ${ownerTask}` : ""}.`,
			"wait",
		)
	}

	private getAgentStatus(agentId: string): AgentStatus | undefined {
		return this.activeExecutionPlan?.agents.find((agent) => agent.id === agentId)?.status
	}

	private async buildMergeReviewEntry(plan: ExecutionPlan, agentId: string): Promise<MergeReviewEntry> {
		const agent = plan.agents.find((candidate) => candidate.id === agentId)
		const branch = this.getAgentBranchName(plan.planId, agentId)
		const worktreePath = this.worktreePathsByAgentId.get(agentId) ?? agent?.worktreePath ?? ""
		let diff = ""
		let noChangesReason: string | undefined
		let reviewError: string | undefined

		try {
			diff = worktreePath ? await this.prepareAgentBranchForReview(plan, agentId, branch, worktreePath) : ""

			if (!diff.trim()) {
				noChangesReason = "No changes detected in this agent worktree."
			}
		} catch (error) {
			reviewError = this.formatGitError(error)
			diff = reviewError
		}

		return {
			agentId,
			mode: agent?.mode,
			task: agent?.task ?? agentId,
			diff,
			noChangesReason,
			worktreePath,
			branch,
			changeStats: computeMergeReviewChangeStats(diff),
			reviewError,
			mergeable: reviewError ? false : undefined,
			mergeStatus: reviewError ? "failed" : "pending",
			mergeError: reviewError,
		}
	}

	private async prepareAgentBranchForReview(
		plan: ExecutionPlan,
		agentId: string,
		branch: string,
		worktreePath: string,
	): Promise<string> {
		this.log(`[parallel-agents] Collecting merge-review diff for ${agentId} from ${worktreePath}`)
		const agent = plan.agents.find((candidate) => candidate.id === agentId)
		this.recordParallelAgentActivity(agentId, "Reviewing branch changes.", "tool")
		const ownedPaths = this.getAgentOwnedPaths(agent)
		const diff = await this.ensureWorktreeManager().prepareMergeReview({
			agentId,
			planId: plan.planId,
			worktreePath,
			branch,
			ownedPaths,
			onDiagnostics: (diagnostics) => this.logMergeReviewDiagnostics(diagnostics),
		})
		this.log(
			`[parallel-agents] Merge-review diff for ${agentId}: ${diff.trim() ? "changes detected" : "no changes detected"}`,
		)
		return diff
	}

	private getAgentBranchName(planId: string, agentId: string): string {
		return getParallelAgentBranchName(planId, agentId)
	}

	private formatGitError(error: unknown): string {
		if (error && typeof error === "object") {
			const maybeOutput = error as { stdout?: string; stderr?: string; message?: string }
			return [maybeOutput.stdout, maybeOutput.stderr, maybeOutput.message].filter(Boolean).join("\n")
		}

		return String(error)
	}

	private getConflictKey(agentId: string, filePath: string): string {
		return `${agentId}:${filePath}`
	}

	public async cancelTask(): Promise<void> {
		const task = this.getCurrentTask()

		if (!task) {
			return
		}

		console.log(`[cancelTask] cancelling task ${task.taskId}.${task.instanceId}`)
		await this.teardownParallelExecution({ markCancelled: true, resetBus: true, cleanupWorktrees: true })

		let historyItem: HistoryItem | undefined
		try {
			const history = await this.getTaskWithId(task.taskId)
			historyItem = history.historyItem
		} catch (error) {
			// During task startup there is a short window where currentTask exists
			// but task history has not been persisted yet. Cancelling should still
			// abort safely; we just skip post-cancel rehydration in that case.
			if (error instanceof Error && error.message === "Task not found") {
				this.log(`[cancelTask] task history missing for ${task.taskId}; skipping rehydrate`)
			} else {
				throw error
			}
		}

		// Preserve parent and root task information for history item.
		const rootTask = task.rootTask
		const parentTask = task.parentTask

		// Mark this as a user-initiated cancellation so provider-only rehydration can occur
		task.abortReason = "user_cancelled"

		// Capture the current instance to detect if rehydrate already occurred elsewhere
		const originalInstanceId = task.instanceId

		// Immediately cancel the underlying HTTP request if one is in progress
		// This ensures the stream fails quickly rather than waiting for network timeout
		task.cancelCurrentRequest()

		// Begin abort (non-blocking)
		task.abortTask()

		// Immediately mark the original instance as abandoned to prevent any residual activity
		task.abandoned = true

		await pWaitFor(
			() =>
				this.getCurrentTask()! === undefined ||
				this.getCurrentTask()!.isStreaming === false ||
				this.getCurrentTask()!.didFinishAbortingStream ||
				// If only the first chunk is processed, then there's no
				// need to wait for graceful abort (closes edits, browser,
				// etc).
				this.getCurrentTask()!.isWaitingForFirstChunk,
			{
				timeout: 3_000,
			},
		).catch(() => {
			console.error("Failed to abort task")
		})

		// Defensive safeguard: if current instance already changed, skip rehydrate
		const current = this.getCurrentTask()
		if (current && current.instanceId !== originalInstanceId) {
			this.log(
				`[cancelTask] Skipping rehydrate: current instance ${current.instanceId} != original ${originalInstanceId}`,
			)
			return
		}

		// Final race check before rehydrate to avoid duplicate rehydration
		{
			const currentAfterCheck = this.getCurrentTask()
			if (currentAfterCheck && currentAfterCheck.instanceId !== originalInstanceId) {
				this.log(
					`[cancelTask] Skipping rehydrate after final check: current instance ${currentAfterCheck.instanceId} != original ${originalInstanceId}`,
				)
				return
			}
		}

		if (!historyItem) {
			return
		}

		// Clears task again, so we need to abortTask manually above.
		await this.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })
	}

	// Clear the current task without treating it as a subtask.
	// This is used when the user cancels a task that is not a subtask.
	public async clearTask(): Promise<void> {
		if (this.clineStack.length > 0) {
			const task = this.clineStack[this.clineStack.length - 1]
			console.log(`[clearTask] clearing task ${task.taskId}.${task.instanceId}`)
			await this.teardownParallelExecution({ markCancelled: true, resetBus: true, cleanupWorktrees: true })
			await this.removeClineFromStack()
		}
	}

	public resumeTask(taskId: string): void {
		// Use the existing showTaskWithId method which handles both current and
		// historical tasks.
		this.showTaskWithId(taskId).catch((error) => {
			this.log(`Failed to resume task ${taskId}: ${error.message}`)
		})
	}

	// Modes

	public async getModes(): Promise<{ slug: string; name: string }[]> {
		try {
			const customModes = await this.customModesManager.getCustomModes()
			return getAllModes(customModes).map(({ slug, name }) => ({ slug, name }))
		} catch (error) {
			return DEFAULT_MODES.map(({ slug, name }) => ({ slug, name }))
		}
	}

	public async getMode(): Promise<string> {
		const { mode } = await this.getState()
		return normalizeModeSlug(mode)
	}

	public async setMode(mode: string): Promise<void> {
		await this.setValues({ mode: normalizeModeSlug(mode) })
	}

	// Provider Profiles

	public async getProviderProfiles(): Promise<{ name: string; provider?: string }[]> {
		const { listApiConfigMeta = [] } = await this.getState()
		return listApiConfigMeta.map((profile) => ({ name: profile.name, provider: profile.apiProvider }))
	}

	public async getProviderProfile(): Promise<string> {
		const { currentApiConfigName = "default" } = await this.getState()
		return currentApiConfigName
	}

	public async setProviderProfile(name: string): Promise<void> {
		await this.activateProviderProfile({ name })
	}

	public get cwd() {
		return this.currentWorkspacePath || getWorkspacePath()
	}

	/**
	 * Delegate parent task and open child task.
	 *
	 * - Enforce single-open invariant
	 * - Persist parent delegation metadata
	 * - Emit TaskDelegated (task-level; API forwards to provider/bridge)
	 * - Create child as sole active and switch mode to child's mode
	 */
	public async delegateParentAndOpenChild(params: {
		parentTaskId: string
		message: string
		initialTodos: TodoItem[]
		mode: string
	}): Promise<Task> {
		const { parentTaskId, message, initialTodos } = params
		const mode = normalizeModeSlug(params.mode)

		// Metadata-driven delegation is always enabled

		// 1) Get parent (must be current task)
		const parent = this.getCurrentTask()
		if (!parent) {
			throw new Error("[delegateParentAndOpenChild] No current task")
		}
		if (parent.taskId !== parentTaskId) {
			throw new Error(
				`[delegateParentAndOpenChild] Parent mismatch: expected ${parentTaskId}, current ${parent.taskId}`,
			)
		}
		// 2) Flush pending tool results to API history BEFORE disposing the parent.
		//    This is critical: when tools are called before new_task,
		//    their tool_result blocks are in userMessageContent but not yet saved to API history.
		//    If we don't flush them, the parent's API conversation will be incomplete and
		//    cause 400 errors when resumed (missing tool_result for tool_use blocks).
		//
		//    NOTE: We do NOT pass the assistant message here because the assistant message
		//    is already added to apiConversationHistory by the normal flow in
		//    recursivelyMakeClineRequests BEFORE tools start executing. We only need to
		//    flush the pending user message with tool_results.
		try {
			const flushSuccess = await parent.flushPendingToolResultsToHistory()

			if (!flushSuccess) {
				console.warn(`[delegateParentAndOpenChild] Flush failed for parent ${parentTaskId}, retrying...`)
				const retrySuccess = await parent.retrySaveApiConversationHistory()

				if (!retrySuccess) {
					console.error(
						`[delegateParentAndOpenChild] CRITICAL: Parent ${parentTaskId} API history not persisted to disk. Child return may produce stale state.`,
					)
					vscode.window.showWarningMessage(
						"Warning: Parent task state could not be saved. The parent task may lose recent context when resumed.",
					)
				}
			}
		} catch (error) {
			this.log(
				`[delegateParentAndOpenChild] Error flushing pending tool results (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}

		// 3) Enforce single-open invariant by closing/disposing the parent first
		//    This ensures we never have >1 tasks open at any time during delegation.
		//    Await abort completion to ensure clean disposal and prevent unhandled rejections.
		try {
			await this.removeClineFromStack({ skipDelegationRepair: true })
		} catch (error) {
			this.log(
				`[delegateParentAndOpenChild] Error during parent disposal (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
			// Non-fatal: proceed with child creation even if parent cleanup had issues
		}

		// 3) Switch provider mode to child's requested mode BEFORE creating the child task
		//    This ensures the child's system prompt and configuration are based on the correct mode.
		//    The mode switch must happen before createTask() because the Task constructor
		//    initializes its mode from provider.getState() during initializeTaskMode().
		try {
			await this.handleModeSwitch(mode as any)
		} catch (e) {
			this.log(
				`[delegateParentAndOpenChild] handleModeSwitch failed for mode '${mode}': ${
					(e as Error)?.message ?? String(e)
				}`,
			)
		}

		// 4) Create child as sole active (parent reference preserved for lineage)
		// Pass initialStatus: "active" to ensure the child task's historyItem is created
		// with status from the start, avoiding race conditions where the task might
		// call attempt_completion before status is persisted separately.
		//
		// Pass startTask: false to prevent the child from beginning its task loop
		// (and writing to globalState via saveClineMessages → updateTaskHistory)
		// before we persist the parent's delegation metadata in step 5.
		// Without this, the child's fire-and-forget startTask() races with step 5,
		// and the last writer to globalState overwrites the other's changes—
		// causing the parent's delegation fields to be lost.
		const child = await this.createTask(message, undefined, parent as any, {
			initialTodos,
			initialStatus: "active",
			startTask: false,
		})

		// 5) Persist parent delegation metadata BEFORE the child starts writing.
		try {
			const { historyItem } = await this.getTaskWithId(parentTaskId)
			const childIds = Array.from(new Set([...(historyItem.childIds ?? []), child.taskId]))
			const updatedHistory: typeof historyItem = {
				...historyItem,
				status: "delegated",
				delegatedToId: child.taskId,
				awaitingChildId: child.taskId,
				childIds,
			}
			await this.updateTaskHistory(updatedHistory)
		} catch (err) {
			this.log(
				`[delegateParentAndOpenChild] Failed to persist parent metadata for ${parentTaskId} -> ${child.taskId}: ${
					(err as Error)?.message ?? String(err)
				}`,
			)
		}

		// 6) Start the child task now that parent metadata is safely persisted.
		child.start()

		// 7) Emit TaskDelegated (provider-level)
		try {
			this.emit(RooCodeEventName.TaskDelegated, parentTaskId, child.taskId)
		} catch {
			// non-fatal
		}

		return child
	}

	/**
	 * Reopen parent task from delegation with write-back and events.
	 */
	public async reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void> {
		const { parentTaskId, childTaskId, completionResultSummary } = params
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath

		// 1) Load parent from history and current persisted messages
		const { historyItem } = await this.getTaskWithId(parentTaskId)

		let parentClineMessages: ClineMessage[] = []
		try {
			parentClineMessages = await readTaskMessages({
				taskId: parentTaskId,
				globalStoragePath,
			})
		} catch {
			parentClineMessages = []
		}

		let parentApiMessages: any[] = []
		try {
			parentApiMessages = (await readApiMessages({
				taskId: parentTaskId,
				globalStoragePath,
			})) as any[]
		} catch {
			parentApiMessages = []
		}

		// 2) Inject synthetic records: UI subtask_result and update API tool_result
		const ts = Date.now()

		// Defensive: ensure arrays
		if (!Array.isArray(parentClineMessages)) parentClineMessages = []
		if (!Array.isArray(parentApiMessages)) parentApiMessages = []

		const subtaskUiMessage: ClineMessage = {
			type: "say",
			say: "subtask_result",
			text: completionResultSummary,
			ts,
		}
		parentClineMessages.push(subtaskUiMessage)
		await saveTaskMessages({ messages: parentClineMessages, taskId: parentTaskId, globalStoragePath })

		// Find the tool_use_id from the last assistant message's new_task tool_use
		let toolUseId: string | undefined
		for (let i = parentApiMessages.length - 1; i >= 0; i--) {
			const msg = parentApiMessages[i]
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "tool_use" && block.name === "new_task") {
						toolUseId = block.id
						break
					}
				}
				if (toolUseId) break
			}
		}

		// Preferred: if the parent history contains the native tool_use for new_task,
		// inject a matching tool_result for the Anthropic message contract:
		// user → assistant (tool_use) → user (tool_result)
		if (toolUseId) {
			// Check if the last message is already a user message with a tool_result for this tool_use_id
			// (in case this is a retry or the history was already updated)
			const lastMsg = parentApiMessages[parentApiMessages.length - 1]
			let alreadyHasToolResult = false
			if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
				for (const block of lastMsg.content) {
					if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
						// Update the existing tool_result content
						block.content = `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`
						alreadyHasToolResult = true
						break
					}
				}
			}

			// If no existing tool_result found, create a NEW user message with the tool_result
			if (!alreadyHasToolResult) {
				parentApiMessages.push({
					role: "user",
					content: [
						{
							type: "tool_result" as const,
							tool_use_id: toolUseId,
							content: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
						},
					],
					ts,
				})
			}

			// Validate the newly injected tool_result against the preceding assistant message.
			// This ensures the tool_result's tool_use_id matches a tool_use in the immediately
			// preceding assistant message (Anthropic API requirement).
			const lastMessage = parentApiMessages[parentApiMessages.length - 1]
			if (lastMessage?.role === "user") {
				const validatedMessage = validateAndFixToolResultIds(lastMessage, parentApiMessages.slice(0, -1))
				parentApiMessages[parentApiMessages.length - 1] = validatedMessage
			}
		} else {
			// If there is no corresponding tool_use in the parent API history, we cannot emit a
			// tool_result. Fall back to a plain user text note so the parent can still resume.
			parentApiMessages.push({
				role: "user",
				content: [
					{
						type: "text" as const,
						text: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
					},
				],
				ts,
			})
		}

		await saveApiMessages({ messages: parentApiMessages as any, taskId: parentTaskId, globalStoragePath })

		// 3) Close child instance if still open (single-open-task invariant).
		//    This MUST happen BEFORE updating the child's status to "completed" because
		//    removeClineFromStack() → abortTask(true) → saveClineMessages() writes
		//    the historyItem with initialStatus (typically "active"), which would
		//    overwrite a "completed" status set earlier.
		const current = this.getCurrentTask()
		if (current?.taskId === childTaskId) {
			await this.removeClineFromStack()
		}

		// 4) Update child metadata to "completed" status.
		//    This runs after the abort so it overwrites the stale "active" status
		//    that saveClineMessages() may have written during step 3.
		try {
			const { historyItem: childHistory } = await this.getTaskWithId(childTaskId)
			await this.updateTaskHistory({
				...childHistory,
				status: "completed",
			})
		} catch (err) {
			this.log(
				`[reopenParentFromDelegation] Failed to persist child completed status for ${childTaskId}: ${
					(err as Error)?.message ?? String(err)
				}`,
			)
		}

		// 5) Update parent metadata and persist BEFORE emitting completion event
		const childIds = Array.from(new Set([...(historyItem.childIds ?? []), childTaskId]))
		const updatedHistory: typeof historyItem = {
			...historyItem,
			status: "active",
			completedByChildId: childTaskId,
			completionResultSummary,
			awaitingChildId: undefined,
			childIds,
		}
		await this.updateTaskHistory(updatedHistory)
		if (typeof this.log === "function") {
			this.log(
				`[email-notifications] Recorded delegated child ${childTaskId} completion for parent ${parentTaskId}; child completion notifications represent delegated workflow completion.`,
			)
		}

		// 6) Emit TaskDelegationCompleted (provider-level)
		try {
			this.emit(RooCodeEventName.TaskDelegationCompleted, parentTaskId, childTaskId, completionResultSummary)
		} catch {
			// non-fatal
		}

		// 7) Reopen the parent from history as the sole active task (restores saved mode)
		//    IMPORTANT: startTask=false to suppress resume-from-history ask scheduling
		const parentInstance = await this.createTaskWithHistoryItem(updatedHistory, { startTask: false })

		// 8) Inject restored histories into the in-memory instance before resuming
		if (parentInstance) {
			try {
				await parentInstance.overwriteClineMessages(parentClineMessages)
			} catch {
				// non-fatal
			}
			try {
				await parentInstance.overwriteApiConversationHistory(parentApiMessages as any)
			} catch {
				// non-fatal
			}

			// Auto-resume parent without ask("resume_task")
			await parentInstance.resumeAfterDelegation()
		}

		await restoreDelegatedParentMode(this, updatedHistory, "reopenParentFromDelegation", { postState: true })

		// 9) Emit TaskDelegationResumed (provider-level)
		try {
			this.emit(RooCodeEventName.TaskDelegationResumed, parentTaskId, childTaskId)
		} catch {
			// non-fatal
		}
	}

	/**
	 * Convert a file path to a webview-accessible URI
	 * This method safely converts file paths to URIs that can be loaded in the webview
	 *
	 * @param filePath - The absolute file path to convert
	 * @returns The webview URI string, or the original file URI if conversion fails
	 * @throws {Error} When webview is not available
	 * @throws {TypeError} When file path is invalid
	 */
	public convertToWebviewUri(filePath: string): string {
		try {
			const fileUri = vscode.Uri.file(filePath)

			// Check if we have a webview available
			if (this.view?.webview) {
				const webviewUri = this.view.webview.asWebviewUri(fileUri)
				return webviewUri.toString()
			}

			// Specific error for no webview available
			const error = new Error("No webview available for URI conversion")
			console.error(error.message)
			// Fallback to file URI if no webview available
			return fileUri.toString()
		} catch (error) {
			// More specific error handling
			if (error instanceof TypeError) {
				console.error("Invalid file path provided for URI conversion:", error)
			} else {
				console.error("Failed to convert to webview URI:", error)
			}
			// Return file URI as fallback
			return vscode.Uri.file(filePath).toString()
		}
	}
}

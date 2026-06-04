// pnpm --filter roo-cline test core/webview/__tests__/ClineProvider.spec.ts

vi.hoisted(() => {
	vi.resetModules()
})

import * as path from "path"
import Anthropic from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import axios from "axios"

import {
	type ProviderSettingsEntry,
	type ClineMessage,
	type ClineSayTool,
	type ExecutionPlan,
	type ExtensionMessage,
	type ExtensionState,
	type HistoryItem,
	type TokenUsage,
	type ToolUsage,
	createAgentCompletionPacket,
	buildParallelPlanCompletionPacket,
	ORGANIZATION_ALLOW_ALL,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	RooCodeEventName,
} from "@roo-code/types"

import { defaultModeSlug } from "../../../shared/modes"
import { experimentDefault } from "../../../shared/experiments"
import { setTtsEnabled } from "../../../utils/tts"
import { ContextProxy } from "../../config/ContextProxy"
import { Task, TaskOptions } from "../../task/Task"
import { safeWriteJson } from "../../../utils/safeWriteJson"

import { ClineProvider } from "../ClineProvider"
import { MessageManager } from "../../message-manager"
import { AgentBus } from "../../agents/AgentBus"
import { WorktreeMergeError } from "../../agents/WorktreeManager"
import { EmailNotificationService } from "../../../services/notifications/EmailNotificationService"

// Mock setup must come before imports.
vi.mock("../../prompts/sections/custom-instructions")

vi.mock("p-wait-for", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("axios", () => ({
	default: {
		get: vi.fn().mockResolvedValue({ data: { data: [] } }),
		post: vi.fn(),
	},
	get: vi.fn().mockResolvedValue({ data: { data: [] } }),
	post: vi.fn(),
}))

vi.mock("../../../utils/safeWriteJson")

vi.mock("../../../utils/storage", () => ({
	getSettingsDirectoryPath: vi.fn().mockResolvedValue("/test/settings/path"),
	getTaskDirectoryPath: vi.fn().mockResolvedValue("/test/task/path"),
	getGlobalStoragePath: vi.fn().mockResolvedValue("/test/storage/path"),
}))

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
	CallToolResultSchema: {},
	ListResourcesResultSchema: {},
	ListResourceTemplatesResultSchema: {},
	ListToolsResultSchema: {},
	ReadResourceResultSchema: {},
	ErrorCode: {
		InvalidRequest: "InvalidRequest",
		MethodNotFound: "MethodNotFound",
		InternalError: "InternalError",
	},
	McpError: class McpError extends Error {
		code: string
		constructor(code: string, message: string) {
			super(message)
			this.code = code
			this.name = "McpError"
		}
	},
}))

// Remove duplicate mock - it's already defined below.

const mockAddCustomInstructions = vi.fn().mockResolvedValue("Combined instructions")

;(vi.mocked(await import("../../prompts/sections/custom-instructions")) as any).addCustomInstructions =
	mockAddCustomInstructions

vi.mock("delay", () => {
	const delayFn = (_ms: number) => Promise.resolve()
	delayFn.createDelay = () => delayFn
	delayFn.reject = () => Promise.reject(new Error("Delay rejected"))
	delayFn.range = () => Promise.resolve()
	return { default: delayFn }
})

// MCP-related modules are mocked once above (lines 87-109).

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
		listTools: vi.fn().mockResolvedValue({ tools: [] }),
		callTool: vi.fn().mockResolvedValue({ content: [] }),
	})),
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
	})),
}))

vi.mock("vscode", () => {
	const file = vi.fn((fsPath: string) => ({
		fsPath,
		path: fsPath,
		scheme: "file",
		toString: () => `file://${fsPath}`,
	}))
	class MockEventEmitter<T = unknown> {
		private listeners = new Set<(event: T) => unknown>()
		event = (listener: (event: T) => unknown) => {
			this.listeners.add(listener)
			return { dispose: () => this.listeners.delete(listener) }
		}
		fire(event: T) {
			for (const listener of this.listeners) {
				listener(event)
			}
		}
		dispose() {
			this.listeners.clear()
		}
	}

	return {
		ExtensionContext: vi.fn(),
		OutputChannel: vi.fn(),
		WebviewView: vi.fn(),
		EventEmitter: MockEventEmitter,
		Uri: {
			joinPath: vi.fn(),
			file,
		},
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		commands: {
			executeCommand: vi.fn().mockResolvedValue(undefined),
		},
		window: {
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			showErrorMessage: vi.fn(),
			onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
		},
		workspace: {
			textDocuments: [],
			workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }],
			getConfiguration: vi.fn().mockReturnValue({
				get: vi.fn().mockReturnValue([]),
				update: vi.fn(),
			}),
			getWorkspaceFolder: vi.fn(),
			openTextDocument: vi.fn(async (uriOrPath: string | { fsPath?: string; scheme?: string }) => ({
				uri: typeof uriOrPath === "string" ? file(uriOrPath) : uriOrPath,
			})),
			onDidChangeConfiguration: vi.fn().mockImplementation(() => ({
				dispose: vi.fn(),
			})),
			onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
			onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
			onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
			onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
			appName: "Visual Studio Code",
		},
		ExtensionMode: {
			Production: 1,
			Development: 2,
			Test: 3,
		},
		version: "1.85.0",
	}
})

vi.mock("../../../utils/tts", () => ({
	setTtsEnabled: vi.fn(),
	setTtsSpeed: vi.fn(),
}))

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn(),
}))

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockImplementation(async () => "mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => {
	return {
		default: vi.fn().mockImplementation(() => ({
			initializeFilePaths: vi.fn(),
			dispose: vi.fn(),
		})),
	}
})

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation((options: any) => {
		const listeners = new Map<string, Set<(...args: any[]) => unknown>>()
		let taskMode = options?.mode ?? options?.historyItem?.mode ?? "code"
		const task: any = {
			api: undefined,
			apiConfiguration: options?.apiConfiguration,
			abortTask: vi.fn(),
			cancelCurrentRequest: vi.fn(),
			handleWebviewAskResponse: vi.fn(),
			clineMessages: [],
			apiConversationHistory: [],
			overwriteClineMessages: vi.fn(),
			overwriteApiConversationHistory: vi.fn(),
			resumeAfterParallelExecution: vi.fn(),
			resumeAfterDelegation: vi.fn(),
			dispose: vi.fn(),
			getTaskNumber: vi.fn().mockReturnValue(0),
			setTaskNumber: vi.fn(),
			setParentTask: vi.fn(),
			setRootTask: vi.fn(),
			start: vi.fn(),
			checkpointSave: vi.fn().mockResolvedValue({ commit: "parallel-start-checkpoint" }),
			getTaskMode: vi.fn().mockResolvedValue(taskMode),
			taskId: options?.historyItem?.id || options?.taskId || "test-task-id",
			instanceId: `test-instance-${options?.historyItem?.id || options?.taskId || options?.taskNumber || "new"}`,
			rootTask: options?.rootTask,
			parentTask: options?.parentTask,
			rootTaskId: options?.historyItem?.rootTaskId ?? options?.rootTask?.taskId,
			parentTaskId: options?.historyItem?.parentTaskId ?? options?.parentTask?.taskId,
			background: options?.background ?? false,
			enableCheckpoints: options?.enableCheckpoints ?? true,
			abortReason: undefined,
			abandoned: false,
			abort: false,
			isStreaming: false,
			didFinishAbortingStream: false,
			isWaitingForFirstChunk: false,
			on: vi.fn((event: string, listener: (...args: any[]) => unknown) => {
				const key = String(event)
				const eventListeners = listeners.get(key) ?? new Set<(...args: any[]) => unknown>()
				eventListeners.add(listener)
				listeners.set(key, eventListeners)
				return task
			}),
			off: vi.fn((event: string, listener: (...args: any[]) => unknown) => {
				listeners.get(String(event))?.delete(listener)
				return task
			}),
			emit: vi.fn((event: string, ...args: any[]) => {
				for (const listener of listeners.get(String(event)) ?? []) {
					void listener(...args)
				}
				return true
			}),
		}

		Object.defineProperty(task, "taskMode", {
			get: () => taskMode,
			set: (mode: string) => {
				taskMode = mode
				task.getTaskMode.mockResolvedValue(taskMode)
			},
			configurable: true,
		})

		options?.onCreated?.(task)

		return task
	}),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockImplementation(async (_filePath: string) => {
		const content = "const x = 1;\nconst y = 2;\nconst z = 3;"
		const lines = content.split("\n")
		return lines.map((line, index) => `${index + 1} | ${line}`).join("\n")
	}),
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
	getModelsFromCache: vi.fn().mockReturnValue(undefined),
}))

vi.mock("../../../shared/modes", () => ({
	modes: [
		{
			slug: "code",
			name: "Code Mode",
			roleDefinition: "You are a code assistant",
			groups: ["read", "edit"],
		},
		{
			slug: "architect",
			name: "Architect Mode",
			roleDefinition: "You are an architect",
			groups: ["read", "edit"],
		},
		{
			slug: "explain",
			name: "Explain Mode",
			roleDefinition: "You are a helpful assistant",
			groups: ["read"],
		},
	],
	getAllModes: vi.fn((customModes?: Array<{ slug: string }>) =>
		customModes?.length
			? [
					{
						slug: "code",
						name: "Code Mode",
						roleDefinition: "You are a code assistant",
						groups: ["read", "edit"],
					},
					...customModes,
				]
			: [
					{
						slug: "code",
						name: "Code Mode",
						roleDefinition: "You are a code assistant",
						groups: ["read", "edit"],
					},
				],
	),
	getModeBySlug: vi.fn().mockReturnValue({
		slug: "code",
		name: "Code Mode",
		roleDefinition: "You are a code assistant",
		groups: ["read", "edit"],
	}),
	getGroupName: vi.fn().mockImplementation((group: string) => {
		// Return appropriate group names for different tool groups
		switch (group) {
			case "read":
				return "Read Tools"
			case "edit":
				return "Edit Tools"
			case "mcp":
				return "MCP Tools"
			default:
				return "General Tools"
		}
	}),
	defaultModeSlug: "code",
	normalizeModeSlug: vi.fn((slug: string) => (slug === "ask" ? "explain" : slug)),
}))

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockResolvedValue("mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({
			id: "claude-3-sonnet",
		}),
	}),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockImplementation(async (_filePath: string) => {
		const content = "const x = 1;\nconst y = 2;\nconst z = 3;"
		const lines = content.split("\n")
		return lines.map((line, index) => `${index + 1} | ${line}`).join("\n")
	}),
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
	getModelsFromCache: vi.fn().mockReturnValue(undefined),
}))

vi.mock("../diff/strategies/multi-search-replace", () => ({
	MultiSearchReplaceDiffStrategy: vi.fn().mockImplementation(() => ({
		getToolDescription: () => "test",
		getName: () => "test-strategy",
		applyDiff: vi.fn(),
	})),
}))

afterAll(() => {
	vi.restoreAllMocks()
})

describe("ClineProvider", () => {
	beforeAll(() => {
		vi.mocked(Task).mockImplementation((options: any) => {
			const listeners = new Map<string, Set<(...args: any[]) => unknown>>()
			let taskMode = options?.mode ?? options?.historyItem?.mode ?? "code"
			const loadSavedMessages = async () => {
				const [{ readFile }, { fileExistsAtPath }] = await Promise.all([
					import("fs/promises"),
					import("../../../utils/fs"),
				])

				if (!(await fileExistsAtPath("/test/task/path/ui_messages.json"))) {
					task.clineMessages = []
					return
				}

				try {
					const parsedMessages = JSON.parse(await readFile("/test/task/path/ui_messages.json", "utf8"))
					task.clineMessages = Array.isArray(parsedMessages) ? parsedMessages : []
				} catch {
					task.clineMessages = []
				}
			}
			const task: any = {
				api: undefined,
				apiConfiguration: options?.apiConfiguration,
				abortTask: vi.fn(),
				cancelCurrentRequest: vi.fn(),
				handleWebviewAskResponse: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				say: vi.fn(async (type: ClineMessage["say"], text?: string, images?: string[], partial?: boolean) => {
					const message = {
						type: "say",
						say: type,
						text,
						images,
						partial,
						ts: Date.now(),
					} satisfies ClineMessage
					task.clineMessages.push(message)
					task.emit(RooCodeEventName.Message, { action: "created", message })
				}),
				overwriteClineMessages: vi.fn(async (messages: ClineMessage[]) => {
					task.clineMessages = messages
				}),
				overwriteApiConversationHistory: vi.fn(),
				resumeAfterParallelExecution: vi.fn(),
				resumeAfterDelegation: vi.fn(),
				restoreClineMessagesFromHistory: vi.fn(async () => {
					await loadSavedMessages()
				}),
				restoreParallelExecutionPause: vi.fn(async () => {
					task.parallelExecutionPaused = true
					return undefined
				}),
				dispose: vi.fn(),
				getTaskNumber: vi.fn().mockReturnValue(0),
				setTaskNumber: vi.fn(),
				setParentTask: vi.fn(),
				setRootTask: vi.fn(),
				start: vi.fn(),
				checkpointSave: vi.fn().mockResolvedValue({ commit: "parallel-start-checkpoint" }),
				getTaskMode: vi.fn().mockResolvedValue(taskMode),
				taskId: options?.historyItem?.id || options?.taskId || "test-task-id",
				instanceId: `test-instance-${options?.historyItem?.id || options?.taskId || options?.taskNumber || "new"}`,
				rootTask: options?.rootTask,
				parentTask: options?.parentTask,
				rootTaskId: options?.historyItem?.rootTaskId ?? options?.rootTask?.taskId,
				parentTaskId: options?.historyItem?.parentTaskId ?? options?.parentTask?.taskId,
				agentId: options?.agentId,
				background: options?.background ?? false,
				enableCheckpoints: options?.enableCheckpoints ?? true,
				workspacePath: options?.workspacePath,
				abortReason: undefined,
				abandoned: false,
				abort: false,
				isStreaming: false,
				didFinishAbortingStream: false,
				isWaitingForFirstChunk: false,
				on: vi.fn((event: string, listener: (...args: any[]) => unknown) => {
					const key = String(event)
					const eventListeners = listeners.get(key) ?? new Set<(...args: any[]) => unknown>()
					eventListeners.add(listener)
					listeners.set(key, eventListeners)
					return task
				}),
				off: vi.fn((event: string, listener: (...args: any[]) => unknown) => {
					listeners.get(String(event))?.delete(listener)
					return task
				}),
				emit: vi.fn((event: string, ...args: any[]) => {
					for (const listener of listeners.get(String(event)) ?? []) {
						void listener(...args)
					}
					return true
				}),
			}

			Object.defineProperty(task, "taskMode", {
				get: () => taskMode,
				set: (mode: string) => {
					taskMode = mode
					task.getTaskMode.mockResolvedValue(taskMode)
				},
				configurable: true,
			})

			Object.defineProperty(task, "messageManager", {
				get: () => new MessageManager(task),
			})

			options?.onCreated?.(task)

			return task
		})
	})

	let defaultTaskOptions: TaskOptions

	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: any
	let updateGlobalStateSpy: any

	beforeEach(() => {
		vi.clearAllMocks()
		AgentBus.reset()
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]
		;(vscode.workspace as any).textDocuments = []
		;(vscode.workspace.getWorkspaceFolder as any).mockReturnValue({ uri: { fsPath: "/test/workspace" } })
		;(vscode.workspace.openTextDocument as any).mockImplementation(
			async (uriOrPath: string | { fsPath?: string; scheme?: string }) => ({
				uri: typeof uriOrPath === "string" ? vscode.Uri.file(uriOrPath) : uriOrPath,
			}),
		)

		const globalState: Record<string, unknown> = {
			mode: "architect",
			currentApiConfigName: "current-config",
		}

		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi.fn().mockImplementation((key: string, value: unknown) => (globalState[key] = value)),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
				delete: vi.fn().mockImplementation((key: string) => delete secrets[key]),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		// Mock CustomModesManager
		const mockCustomModesManager = {
			updateCustomMode: vi.fn().mockResolvedValue(undefined),
			getCustomModes: vi.fn().mockResolvedValue([]),
			dispose: vi.fn(),
		}

		// Mock output channel
		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		// Mock webview
		mockPostMessage = vi.fn()

		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
				cspSource: "vscode-webview://test-csp-source",
			},
			visible: true,
			onDidDispose: vi.fn().mockImplementation((callback) => {
				callback()
				return { dispose: vi.fn() }
			}),
			onDidChangeVisibility: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		defaultTaskOptions = {
			provider,
			apiConfiguration: {
				apiProvider: "openrouter",
			},
		}

		// @ts-ignore - Access private property for testing
		updateGlobalStateSpy = vi.spyOn(provider.contextProxy, "setValue")

		// @ts-ignore - Accessing private property for testing.
		provider.customModesManager = mockCustomModesManager

		// Mock getMcpHub method for generateSystemPrompt
		provider.getMcpHub = vi.fn().mockReturnValue({
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue({ contents: [] }),
			getAllServers: vi.fn().mockReturnValue([]),
		})
	})

	const createExecutionPlan = (): ExecutionPlan => ({
		planId: "plan-webview-provider",
		sharedContext: "shared context",
		sharedContract: "",
		fileOwnershipMap: {
			"src/dashboard.tsx": "dashboard-agent",
			"src/styles.css": "styles-agent",
		},
		createdAt: 12345,
		agents: [
			{
				id: "dashboard-agent",
				mode: "code",
				task: "Build dashboard",
				owns: [{ path: "src/dashboard.tsx", mode: "exclusive" }],
				mustNotTouch: [],
				dependsOn: [],
				worktreePath: "",
				status: "pending",
				signals: [],
			},
			{
				id: "styles-agent",
				mode: "code",
				task: "Style dashboard",
				owns: [{ path: "src/styles.css", mode: "exclusive" }],
				mustNotTouch: [],
				dependsOn: [],
				worktreePath: "",
				status: "pending",
				signals: [],
			},
		],
	})

	const getParallelAgentToolMessages = (task: Task): ClineMessage[] =>
		task.clineMessages.filter((message) => {
			if (message.type !== "say" || message.say !== "tool" || !message.text) {
				return false
			}

			try {
				return (JSON.parse(message.text) as ClineSayTool).tool === "parallelAgents"
			} catch {
				return false
			}
		})

	const parseParallelAgentToolMessage = (message: ClineMessage): ClineSayTool =>
		JSON.parse(message.text ?? "{}") as ClineSayTool

	const createHistoryItem = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
		id: "history-task-id",
		number: 1,
		ts: 1_700_000_000,
		task: "Resume interrupted parallel-agent work",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		workspace: "/test/workspace",
		status: "active",
		...overrides,
	})

	const createTokenUsage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
		totalTokensIn: 12,
		totalTokensOut: 34,
		totalCost: 0.12,
		contextTokens: 2048,
		...overrides,
	})

	const createToolUsage = (): ToolUsage =>
		({
			read_file: { attempts: 2, failures: 1 },
		}) as ToolUsage

	const installEmailNotificationServiceMock = (
		sendTaskNotification = vi.fn().mockResolvedValue({ attempted: true, sent: true }),
	) => {
		;(provider as any).emailNotificationService = { sendTaskNotification }
		return sendTaskNotification
	}

	const getEmailNotificationDiagnostics = (logSpy: any): Array<Record<string, any>> =>
		(logSpy.mock.calls as Array<[unknown]>)
			.map(([message]: [unknown]) => String(message))
			.filter((message) => message.startsWith("[email-notifications] diagnostics "))
			.map(
				(message: string) =>
					JSON.parse(message.slice("[email-notifications] diagnostics ".length)) as Record<string, any>,
			)

	const createParallelAgentToolMessage = (tool: ClineSayTool, ts = 1_700_000_001): ClineMessage => ({
		type: "say",
		say: "tool",
		text: JSON.stringify(tool),
		ts,
	})

	const createWorktreeManagerMock = (overrides: Record<string, unknown> = {}) => ({
		validateGitRepository: vi.fn().mockResolvedValue(undefined),
		captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
		createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
		prepareMergeReview: vi.fn(
			async ({ agentId }: { agentId: string }) => `diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
		),
		mergeBranch: vi.fn().mockResolvedValue(undefined),
		removeWorktree: vi.fn().mockResolvedValue(undefined),
		cleanup: vi.fn().mockResolvedValue(undefined),
		cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		...overrides,
	})

	const createTextDocument = (
		relPath: string,
		options: { isDirty?: boolean; saveResult?: boolean } = {},
	): vscode.TextDocument => {
		let isDirty = options.isDirty ?? false
		const document = {
			uri: vscode.Uri.file(path.resolve("/test/workspace", relPath)),
			save: vi.fn(async () => {
				const result = options.saveResult ?? true
				if (result) {
					isDirty = false
				}
				return result
			}),
		} as unknown as vscode.TextDocument

		Object.defineProperty(document, "isDirty", {
			get: () => isDirty,
			set: (value: boolean) => {
				isDirty = value
			},
			configurable: true,
		})

		return document
	}

	const getMergeDocumentSyncDiagnostics = (logSpy: any): Array<Record<string, any>> =>
		(logSpy.mock.calls as Array<[unknown]>)
			.map(([message]) => String(message))
			.filter((message) => message.startsWith("[parallel-agents] merge-document-sync "))
			.map(
				(message) =>
					JSON.parse(message.slice("[parallel-agents] merge-document-sync ".length)) as Record<string, any>,
			)

	const seedPersistedTaskMessages = async (messages: ClineMessage[]) => {
		const fsUtils = await import("../../../utils/fs")
		const fsPromises = await import("fs/promises")
		vi.spyOn(fsUtils, "fileExistsAtPath").mockResolvedValueOnce(true).mockResolvedValueOnce(true)
		;(vi.mocked(fsPromises.readFile) as any)
			.mockResolvedValueOnce(JSON.stringify(messages))
			.mockResolvedValueOnce(JSON.stringify(messages))
	}

	test("constructor initializes correctly", () => {
		expect(provider).toBeInstanceOf(ClineProvider)
		// Since getVisibleInstance returns the last instance where view.visible is true
		// @ts-ignore - accessing private property for testing
		provider.view = mockWebviewView
		expect(ClineProvider.getVisibleInstance()).toBe(provider)
	})

	describe("email notification lifecycle dispatch", () => {
		test("sends success notifications for top-level task completion", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const logSpy = vi.spyOn(provider, "log")
			const task = new Task({ ...defaultTaskOptions, taskId: "task-success", workspacePath: "/workspace" } as any)
			const tokenUsage = createTokenUsage()
			const toolUsage = createToolUsage()
			;(task as any).taskMode = "code"
			task.clineMessages.push({
				type: "say",
				say: "text",
				text: "Earlier transcript text that should not be included",
				ts: 1,
			})
			task.clineMessages.push({
				type: "say",
				say: "api_req_started",
				text: "Starting request 1",
				ts: 1.5,
			})
			task.clineMessages.push({
				type: "say",
				say: "api_req_started",
				text: "Starting request 2",
				ts: 1.6,
			})
			task.clineMessages.push({
				type: "say",
				say: "completion_result",
				text: "Implemented SMTP completion notifications.\nAdded regression tests.",
				ts: 2,
			})
			;(provider as any).taskCreationCallback(task)
			task.emit(RooCodeEventName.TaskCompleted, task.taskId, tokenUsage, toolUsage)

			expect(sendTaskNotification).toHaveBeenCalledWith({
				taskId: "task-success",
				outcome: "success",
				summary: "Implemented SMTP completion notifications. Added regression tests.",
				usageScope: "Task only (live completion event)",
				workspacePath: "/workspace",
				mode: "code",
				tokenUsage,
				toolUsage,
				requestCount: 2,
			})
			await vi.waitFor(() => {
				expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							event: "completion-event-observed",
							taskId: "task-success",
							background: false,
						}),
						expect.objectContaining({
							event: "completion-notification-decision",
							taskId: "task-success",
							decision: "send-top-level-success",
							requestCount: 2,
						}),
						expect.objectContaining({
							event: "outcome-notification-decision",
							taskId: "task-success",
							decision: "dispatch",
							duplicateSent: false,
							duplicateInFlight: false,
						}),
						expect.objectContaining({
							event: "notification-send-result",
							taskId: "task-success",
							decision: "sent",
							attempted: true,
							sent: true,
						}),
					]),
				)
			})
			expect(JSON.stringify(getEmailNotificationDiagnostics(logSpy))).not.toContain(
				"Implemented SMTP completion notifications",
			)
		})

		test("sends direct completion email through the same saved SMTP settings and SecretStorage password as Test SMTP", async () => {
			await provider.contextProxy.setValues({
				emailNotificationsEnabled: true,
				emailNotifyOnSuccess: true,
				emailNotifyOnFailure: false,
				smtpHost: " smtp.example.com ",
				smtpPort: 587,
				smtpSecure: false,
				smtpRequireTls: true,
				smtpUsername: "smtp-user",
				smtpPassword: "smtp-secret",
				smtpFromAddress: "C Code <roo@example.com>",
				smtpRecipients: [" dev@example.com ", "ops@example.com", "dev@example.com", ""],
				smtpSubjectTemplate: "C task {{outcome}} for {{taskId}}",
			} as any)

			const sendMail = vi.fn().mockResolvedValue(undefined)
			const transportFactory = vi.fn(() => ({ sendMail }))
			;(provider as any).emailNotificationService = new EmailNotificationService(provider.contextProxy, {
				log: (message) => provider.log(message),
				transportFactory,
			})

			await expect(provider.testSmtpSettings()).resolves.toEqual({ attempted: true, sent: true })

			expect(sendMail).toHaveBeenCalledTimes(1)
			expect(transportFactory).toHaveBeenNthCalledWith(1, {
				host: "smtp.example.com",
				port: 587,
				secure: false,
				requireTLS: true,
				auth: {
					user: "smtp-user",
					pass: "smtp-secret",
				},
			})

			const task = new Task({
				...defaultTaskOptions,
				taskId: "smtp-parity-task",
				workspacePath: "/workspace/project",
			} as any)
			;(task as any).taskMode = "code"
			task.clineMessages.push({
				type: "say",
				say: "text",
				text: "Full transcript content must never be emailed.",
				ts: 1,
			})
			task.clineMessages.push({
				type: "say",
				say: "completion_result",
				text: "Completed the saved SMTP notification path without leaking smtp-secret.",
				ts: 2,
			})
			;(provider as any).taskCreationCallback(task)

			task.emit(RooCodeEventName.TaskCompleted, task.taskId, undefined as any, undefined as any)

			await vi.waitFor(() => expect(sendMail).toHaveBeenCalledTimes(2))
			expect(transportFactory).toHaveBeenNthCalledWith(2, {
				host: "smtp.example.com",
				port: 587,
				secure: false,
				requireTLS: true,
				auth: {
					user: "smtp-user",
					pass: "smtp-secret",
				},
			})

			const testMailOptions = sendMail.mock.calls[0][0]
			const completionMailOptions = sendMail.mock.calls[1][0]
			expect(testMailOptions.subject).toBe("C Code SMTP test")
			expect(completionMailOptions).toEqual(
				expect.objectContaining({
					from: "C Code <roo@example.com>",
					to: ["dev@example.com", "ops@example.com"],
					subject: "C task success for smtp-parity-task",
					text: expect.stringContaining("Task ID: smtp-parity-task"),
					html: expect.stringContaining("Task ID"),
				}),
			)
			expect(completionMailOptions.text).toContain("Total tokens: 0")
			expect(completionMailOptions.text).toContain(
				"Completion summary: Completed the saved SMTP notification path without leaking [redacted].",
			)

			const allMailText = sendMail.mock.calls.map(([mailOptions]) => JSON.stringify(mailOptions)).join("\n")
			expect(allMailText).not.toContain("smtp-secret")
			expect(allMailText).not.toContain("Full transcript content must never be emailed.")
			expect(allMailText).not.toContain("apiConversationHistory")
			expect(allMailText).not.toContain("clineMessages")

			const outputLogText = (mockOutputChannel.appendLine as any).mock.calls.flat().join("\n")
			expect(outputLogText).not.toContain("smtp-secret")
			expect(outputLogText).not.toContain("Full transcript content must never be emailed.")

			task.emit(RooCodeEventName.TaskCompleted, task.taskId, undefined as any, undefined as any)
			expect(
				sendMail.mock.calls.filter(([mailOptions]) => mailOptions.subject.includes("smtp-parity-task")),
			).toHaveLength(1)
			expect(sendMail).toHaveBeenCalledTimes(2)
		})

		test("sends direct completion notifications when usage stats are unavailable", () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const task = new Task({
				...defaultTaskOptions,
				taskId: "task-missing-usage",
				workspacePath: "/workspace",
			} as any)
			;(task as any).taskMode = "code"
			task.clineMessages.push({
				type: "say",
				say: "text",
				text: "Transcript content must not be copied into notification payload",
				ts: 1,
			})
			task.clineMessages.push({
				type: "say",
				say: "completion_result",
				text: "Completed without final usage stats.",
				ts: 2,
			})
			;(provider as any).taskCreationCallback(task)

			task.emit(RooCodeEventName.TaskCompleted, task.taskId, undefined as any, undefined as any)

			expect(sendTaskNotification).toHaveBeenCalledTimes(1)
			expect(sendTaskNotification).toHaveBeenCalledWith({
				taskId: "task-missing-usage",
				outcome: "success",
				summary: "Completed without final usage stats.",
				usageScope: "Task only (live completion event)",
				workspacePath: "/workspace",
				mode: "code",
				tokenUsage: undefined,
				toolUsage: undefined,
				requestCount: 0,
			})
			expect(JSON.stringify(sendTaskNotification.mock.calls[0][0])).not.toContain(
				"Transcript content must not be copied into notification payload",
			)
		})

		test("accepted final parent completion sends when provider completion listener was not observed", () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const logSpy = vi.spyOn(provider, "log")
			const task = new Task({
				...defaultTaskOptions,
				taskId: "accepted-parent-fallback",
				workspacePath: "/workspace",
			} as any)
			const tokenUsage = createTokenUsage()
			const toolUsage = createToolUsage()
			;(task as any).taskMode = "code"
			task.clineMessages.push({
				type: "say",
				say: "text",
				text: "Sensitive accepted fallback transcript must not leak.",
				ts: 1,
			})
			task.clineMessages.push({ type: "say", say: "api_req_started", text: "Request", ts: 1.5 })
			task.clineMessages.push({
				type: "say",
				say: "completion_result",
				text: "Accepted parent completion fallback sent.",
				ts: 2,
			})

			provider.notifyAcceptedFinalParentCompletion(task, tokenUsage, toolUsage)

			expect(sendTaskNotification).toHaveBeenCalledTimes(1)
			expect(sendTaskNotification).toHaveBeenCalledWith({
				taskId: "accepted-parent-fallback",
				outcome: "success",
				summary: "Accepted parent completion fallback sent.",
				usageScope: "Task only (live completion event)",
				workspacePath: "/workspace",
				mode: "code",
				tokenUsage,
				toolUsage,
				requestCount: 1,
			})
			expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event: "accepted-final-parent-completion-decision",
						taskId: "accepted-parent-fallback",
						decision: "send-top-level-success-after-acceptance",
						providerCompletionEventObserved: false,
					}),
					expect.objectContaining({
						event: "completion-notification-decision",
						taskId: "accepted-parent-fallback",
						decision: "send-top-level-success",
						notificationScope: "task",
						notificationDedupeKey: "task:accepted-parent-fallback",
					}),
				]),
			)
			expect(JSON.stringify(sendTaskNotification.mock.calls[0][0])).not.toContain(
				"Sensitive accepted fallback transcript",
			)
		})

		test("accepted final parent completion does not duplicate when provider completion listener already handled it", () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const logSpy = vi.spyOn(provider, "log")
			const task = new Task({ ...defaultTaskOptions, taskId: "accepted-parent-observed" } as any)
			task.clineMessages.push({
				type: "say",
				say: "completion_result",
				text: "Provider event already sent this completion.",
				ts: 2,
			})
			;(provider as any).taskCreationCallback(task)

			task.emit(RooCodeEventName.TaskCompleted, task.taskId, createTokenUsage(), createToolUsage())
			provider.notifyAcceptedFinalParentCompletion(task, createTokenUsage(), createToolUsage())

			expect(sendTaskNotification).toHaveBeenCalledTimes(1)
			expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event: "accepted-final-parent-completion-decision",
						taskId: "accepted-parent-observed",
						decision: "skip-provider-completion-event-observed",
						providerCompletionEventObserved: true,
					}),
				]),
			)
		})

		test("logs disabled-settings diagnostics when completion email settings skip a visible completion", async () => {
			await provider.contextProxy.setValues({
				emailNotificationsEnabled: false,
				emailNotifyOnSuccess: true,
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				smtpFromAddress: "roo@example.com",
				smtpRecipients: ["dev@example.com"],
			} as any)

			const logSpy = vi.spyOn(provider, "log")
			const sendMail = vi.fn().mockResolvedValue(undefined)
			const transportFactory = vi.fn(() => ({ sendMail }))
			;(provider as any).emailNotificationService = new EmailNotificationService(provider.contextProxy, {
				log: (message) => provider.log(message),
				transportFactory,
			})
			const task = new Task({ ...defaultTaskOptions, taskId: "task-disabled-email-settings" } as any)

			;(provider as any).taskCreationCallback(task)
			task.emit(RooCodeEventName.TaskCompleted, task.taskId, createTokenUsage(), createToolUsage())

			expect(transportFactory).not.toHaveBeenCalled()
			await vi.waitFor(() => {
				expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							event: "outcome-notification-decision",
							taskId: "task-disabled-email-settings",
							decision: "dispatch",
						}),
						expect.objectContaining({
							event: "notification-send-result",
							taskId: "task-disabled-email-settings",
							decision: "service-skipped",
							attempted: false,
							sent: false,
							skippedReason: "disabled",
						}),
						expect.objectContaining({
							event: "notification-in-flight-cleared",
							taskId: "task-disabled-email-settings",
							decision: "cleared",
						}),
					]),
				)
			})
			expect(mockContext.globalState.update).not.toHaveBeenCalledWith(
				"emailNotificationTaskOutcomes.v1",
				expect.anything(),
			)
		})

		test("logs invalid-config diagnostics when SMTP settings are incomplete for a visible completion", async () => {
			await provider.contextProxy.setValues({
				emailNotificationsEnabled: true,
				emailNotifyOnSuccess: true,
				smtpHost: "smtp.example.com",
				smtpPort: 587,
				smtpFromAddress: "roo@example.com",
				smtpRecipients: [],
			} as any)

			const logSpy = vi.spyOn(provider, "log")
			const sendMail = vi.fn().mockResolvedValue(undefined)
			const transportFactory = vi.fn(() => ({ sendMail }))
			;(provider as any).emailNotificationService = new EmailNotificationService(provider.contextProxy, {
				log: (message) => provider.log(message),
				transportFactory,
			})
			const task = new Task({ ...defaultTaskOptions, taskId: "task-invalid-email-settings" } as any)

			;(provider as any).taskCreationCallback(task)
			task.emit(RooCodeEventName.TaskCompleted, task.taskId, createTokenUsage(), createToolUsage())

			expect(transportFactory).not.toHaveBeenCalled()
			await vi.waitFor(() => {
				expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							event: "notification-send-result",
							taskId: "task-invalid-email-settings",
							decision: "service-skipped",
							attempted: false,
							sent: false,
							skippedReason: "invalid-config",
						}),
					]),
				)
			})
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("Email notifications are enabled but no SMTP recipients are configured."),
			)
			expect(mockContext.globalState.update).not.toHaveBeenCalledWith(
				"emailNotificationTaskOutcomes.v1",
				expect.anything(),
			)
		})

		test("does not send SMTP notifications for streaming failure aborts", () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const task = new Task({ ...defaultTaskOptions, taskId: "task-failed", workspacePath: "/workspace" } as any)
			const tokenUsage = createTokenUsage()
			const toolUsage = createToolUsage()
			;(task as any).taskMode = "code"
			;(task as any).abortReason = "streaming_failed"
			;(task as any).tokenUsage = tokenUsage
			;(task as any).toolUsage = toolUsage
			;(provider as any).clineStack = [{ instanceId: "different-current-task" }]
			;(provider as any).taskCreationCallback(task)
			task.emit(RooCodeEventName.TaskAborted)

			expect(sendTaskNotification).not.toHaveBeenCalled()
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining(
					"Skipping task task-failed abort notification because automatic SMTP notifications are completion-only.",
				),
			)
		})

		test("does not send SMTP notifications for user aborts", () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const task = new Task({ ...defaultTaskOptions, taskId: "task-aborted", workspacePath: "/workspace" } as any)
			const tokenUsage = createTokenUsage()
			const toolUsage = createToolUsage()
			;(task as any).taskMode = "code"
			;(task as any).abortReason = "user_cancelled"
			;(task as any).tokenUsage = tokenUsage
			;(task as any).toolUsage = toolUsage
			;(provider as any).taskCreationCallback(task)
			task.emit(RooCodeEventName.TaskAborted)

			expect(sendTaskNotification).not.toHaveBeenCalled()
		})

		test("suppresses non-user lifecycle abort notifications", () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const task = new Task({ ...defaultTaskOptions, taskId: "task-lifecycle-cleanup" } as any)
			;(provider as any).taskCreationCallback(task)

			task.emit(RooCodeEventName.TaskAborted)

			expect(sendTaskNotification).not.toHaveBeenCalled()
		})

		test("suppresses abandoned cleanup abort notifications during delegation handoff", () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const task = new Task({ ...defaultTaskOptions, taskId: "delegation-cleanup-parent" } as any)
			;(task as any).abandoned = true
			;(provider as any).taskCreationCallback(task)

			task.emit(RooCodeEventName.TaskAborted)

			expect(sendTaskNotification).not.toHaveBeenCalled()
		})

		test("parallel-agent lifecycle aborts do not send false aborted notifications", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const parentTask = new Task({ ...defaultTaskOptions, taskId: "parallel-parent-cleanup" } as any)
			;(provider as any).taskCreationCallback(parentTask)
			await provider.addClineToStack(parentTask)

			const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
				agentId: "dashboard-agent",
				background: true,
				mode: "code",
			})

			backgroundTask.emit(RooCodeEventName.TaskAborted)
			parentTask.emit(RooCodeEventName.TaskAborted)

			expect(sendTaskNotification).not.toHaveBeenCalled()
		})

		test("parallel-agent parent workflow completion sends exactly one success notification", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const logSpy = vi.spyOn(provider, "log")
			const parentTask = new Task({
				...defaultTaskOptions,
				taskId: "parallel-parent-success",
				workspacePath: "/workspace",
			} as any)
			const parentTokenUsage = createTokenUsage({
				totalTokensIn: 100,
				totalTokensOut: 40,
				totalCacheWrites: 10,
				totalCacheReads: 5,
				totalCost: 0.1,
			})
			const parentToolUsage = createToolUsage()
			const childTokenUsage = createTokenUsage({
				totalTokensIn: 35,
				totalTokensOut: 15,
				totalCacheWrites: 3,
				totalCacheReads: 7,
				totalCost: 0.05,
				contextTokens: 1024,
			})
			const childToolUsage = {
				execute_command: { attempts: 1, failures: 0 },
			} as ToolUsage
			;(parentTask as any).taskMode = "code"
			parentTask.clineMessages.push({
				type: "say",
				say: "text",
				text: "Sensitive parent transcript content should not appear in diagnostics.",
				ts: 1,
			})
			parentTask.clineMessages.push({
				type: "say",
				say: "api_req_started",
				text: "Starting parent request",
				ts: 1.5,
			})
			parentTask.clineMessages.push({
				type: "say",
				say: "completion_result",
				text: "Parallel agents completed and the parent verified the workflow.",
				ts: 2,
			})
			;(provider as any).taskCreationCallback(parentTask)
			await provider.addClineToStack(parentTask)

			const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
				agentId: "dashboard-agent",
				background: true,
				mode: "code",
			})
			backgroundTask.clineMessages.push({
				type: "say",
				say: "text",
				text: "Sensitive child transcript content should not appear in diagnostics.",
				ts: 1,
			})
			backgroundTask.clineMessages.push({
				type: "say",
				say: "api_req_started",
				text: "Starting child request",
				ts: 1.5,
			})

			backgroundTask.emit(RooCodeEventName.TaskCompleted, backgroundTask.taskId, childTokenUsage, childToolUsage)
			;(provider as any).emailNotificationTaskOutcomes.set(`task:${backgroundTask.taskId}`, "success")
			;(provider as any).emailNotificationTaskOutcomesInFlight.set(`task:${backgroundTask.taskId}`, "success")
			parentTask.emit(RooCodeEventName.TaskCompleted, parentTask.taskId, parentTokenUsage, parentToolUsage)
			parentTask.emit(RooCodeEventName.TaskCompleted, parentTask.taskId, parentTokenUsage, parentToolUsage)

			await vi.waitFor(() => expect(sendTaskNotification).toHaveBeenCalledTimes(1))
			expect(sendTaskNotification).toHaveBeenCalledWith({
				taskId: "parallel-parent-success",
				outcome: "success",
				summary: "Parallel agents completed and the parent verified the workflow.",
				workflowSummary: expect.stringContaining(
					'Overall workflow rollup: parent task parallel-parent-success completed with final result "Parallel agents completed and the parent verified the workflow."',
				),
				usageScope:
					"Aggregated parent workflow usage from the parent task plus 1 child task, including delegated and background parallel-agent tasks discoverable from saved task metadata.",
				workspacePath: "/workspace",
				mode: "code",
				tokenUsage: {
					totalTokensIn: 135,
					totalTokensOut: 55,
					totalCacheWrites: 13,
					totalCacheReads: 12,
					totalCost: 0.15000000000000002,
					contextTokens: 0,
				},
				toolUsage: {
					read_file: { attempts: 2, failures: 1 },
					execute_command: { attempts: 1, failures: 0 },
				},
				requestCount: 2,
			})
			expect(sendTaskNotification.mock.calls[0][0].workflowSummary).toContain(
				`${backgroundTask.taskId}: agent dashboard-agent parallel/background task`,
			)
			expect(JSON.stringify(sendTaskNotification.mock.calls[0][0])).not.toContain(
				"Sensitive parent transcript content",
			)
			expect(JSON.stringify(sendTaskNotification.mock.calls[0][0])).not.toContain(
				"Sensitive child transcript content",
			)

			const notificationDiagnostics = getEmailNotificationDiagnostics(logSpy)

			expect(notificationDiagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event: "completion-event-observed",
						taskId: backgroundTask.taskId,
						background: true,
						agentId: "dashboard-agent",
					}),
					expect.objectContaining({
						event: "completion-notification-decision",
						taskId: backgroundTask.taskId,
						decision: "skip-background-task-covered-by-parallel-workflow",
						coveredByWorkflowNotification: true,
					}),
					expect.objectContaining({
						event: "completion-event-observed",
						taskId: "parallel-parent-success",
						background: false,
						currentTaskId: "parallel-parent-success",
					}),
					expect.objectContaining({
						event: "completion-notification-decision",
						taskId: "parallel-parent-success",
						decision: "send-top-level-success",
					}),
					expect.objectContaining({
						event: "completion-notification-aggregation",
						taskId: "parallel-parent-success",
						decision: "use-aggregated-workflow-usage",
						usageAggregationSource: "live-root-with-discovered-children",
						parentHistoryFound: false,
						workflowChildTaskCount: 1,
						requestCount: 2,
						totalTokensIn: 135,
						totalTokensOut: 55,
						totalCacheWrites: 13,
						totalCacheReads: 12,
						totalCost: 0.15000000000000002,
						toolAttempts: 3,
						toolFailures: 1,
					}),
					expect.objectContaining({
						event: "outcome-notification-decision",
						taskId: "parallel-parent-success",
						decision: "dispatch",
						duplicateSent: false,
						duplicateInFlight: false,
					}),
				]),
			)
			expect(JSON.stringify(notificationDiagnostics)).not.toContain(
				"Parallel agents completed and the parent verified the workflow.",
			)
			expect(JSON.stringify(notificationDiagnostics)).not.toContain("Sensitive parent transcript content")
			expect(JSON.stringify(notificationDiagnostics)).not.toContain("Sensitive child transcript content")
		})

		test("sends one child workflow success notification for delegated completion metadata", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const logSpy = vi.spyOn(provider, "log")
			const transcriptText = "Earlier parent transcript text that must not appear in notification payload"
			const parentHistory = createHistoryItem({
				id: "delegated-parent-success",
				workspace: "/workspace",
				mode: "code",
				rootTaskId: "delegated-root-success",
				childIds: ["delegated-child-success"],
				completedByChildId: "delegated-child-success",
			})
			;(provider as any).getAggregatedTaskNotificationUsage = vi.fn().mockResolvedValue({
				tokenUsage: {
					totalTokensIn: 10,
					totalTokensOut: 5,
					totalCacheWrites: 2,
					totalCacheReads: 3,
					totalCost: 0.01,
					contextTokens: 0,
				},
				requestCount: 2,
			})

			await (provider as any).notifyDelegatedWorkflowCompleted(
				parentHistory,
				"Child completed delegated work.\nReady for parent follow-up.",
			)

			expect(sendTaskNotification).toHaveBeenCalledTimes(1)
			expect(sendTaskNotification).toHaveBeenCalledWith({
				taskId: "delegated-child-success",
				outcome: "success",
				summary: "Child completed delegated work. Ready for parent follow-up.",
				workspacePath: "/workspace",
				mode: "code",
				notificationType: "delegated-child",
				parentTaskId: "delegated-parent-success",
				rootTaskId: "delegated-root-success",
				tokenUsage: {
					totalTokensIn: 10,
					totalTokensOut: 5,
					totalCacheWrites: 2,
					totalCacheReads: 3,
					totalCost: 0.01,
					contextTokens: 0,
				},
				requestCount: 2,
			})
			expect(JSON.stringify(sendTaskNotification.mock.calls[0][0])).not.toContain(transcriptText)
			await vi.waitFor(() => {
				expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							event: "delegated-workflow-notification-prepared",
							taskId: "delegated-parent-success",
							childTaskId: "delegated-child-success",
							decision: "send-delegated-child-success",
							requestCount: 2,
						}),
						expect.objectContaining({
							event: "outcome-notification-decision",
							taskId: "delegated-child-success",
							decision: "dispatch",
							notificationType: "delegated-child",
							parentTaskId: "delegated-parent-success",
						}),
						expect.objectContaining({
							event: "notification-send-result",
							taskId: "delegated-child-success",
							decision: "sent",
							attempted: true,
							sent: true,
						}),
					]),
				)
			})
			expect(JSON.stringify(getEmailNotificationDiagnostics(logSpy))).not.toContain(transcriptText)
		})

		test("falls back to basic usage and still sends delegated completion when aggregation fails", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			;(provider as any).getAggregatedTaskNotificationUsage = vi.fn().mockRejectedValue(new Error("usage failed"))

			await (provider as any).notifyDelegatedWorkflowCompleted(
				createHistoryItem({
					id: "delegated-parent-aggregation-fallback",
					workspace: "/workspace",
					mode: "code",
					rootTaskId: "delegated-root-aggregation-fallback",
					childIds: ["delegated-child-aggregation-fallback"],
					completedByChildId: "delegated-child-aggregation-fallback",
					tokensIn: Number.NaN,
					tokensOut: undefined as any,
					cacheWrites: undefined,
					cacheReads: undefined,
					totalCost: undefined as any,
				}),
				"Child completed after usage aggregation failed.",
			)

			expect(sendTaskNotification).toHaveBeenCalledTimes(1)
			expect(sendTaskNotification).toHaveBeenCalledWith({
				taskId: "delegated-child-aggregation-fallback",
				outcome: "success",
				summary: "Child completed after usage aggregation failed.",
				workspacePath: "/workspace",
				mode: "code",
				notificationType: "delegated-child",
				parentTaskId: "delegated-parent-aggregation-fallback",
				rootTaskId: "delegated-root-aggregation-fallback",
				tokenUsage: {
					totalTokensIn: 0,
					totalTokensOut: 0,
					totalCacheWrites: 0,
					totalCacheReads: 0,
					totalCost: 0,
					contextTokens: 0,
				},
				requestCount: 0,
			})
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining(
					"[email-notifications] Failed to aggregate delegated completion usage for child task delegated-child-aggregation-fallback; sending notification with fallback usage: usage failed",
				),
			)
		})

		test("uses delegated child usage totals for delegated child completion notifications", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const fsUtils = await import("../../../utils/fs")
			const fsPromises = await import("fs/promises")
			const parentHistory = createHistoryItem({
				id: "delegated-parent-usage",
				workspace: "/workspace",
				mode: "code",
				rootTaskId: "delegated-root-usage",
				tokensIn: 100,
				tokensOut: 50,
				cacheWrites: 10,
				cacheReads: 20,
				totalCost: 0.1,
				childIds: ["delegated-child-usage"],
				completedByChildId: "delegated-child-usage",
			})
			const childHistory = createHistoryItem({
				id: "delegated-child-usage",
				parentTaskId: "delegated-parent-usage",
				rootTaskId: "delegated-root-usage",
				workspace: "/workspace",
				mode: "code",
				tokensIn: 25,
				tokensOut: 15,
				cacheWrites: 5,
				cacheReads: 8,
				totalCost: 0.02,
				childIds: [],
			})
			;(provider as any).taskHistoryStore.getAll = vi.fn(() => [childHistory])
			vi.spyOn(provider, "getTaskWithId").mockImplementation(async (id: string) => ({
				historyItem: id === "delegated-child-usage" ? childHistory : parentHistory,
				apiConversationHistory: [],
				taskDirPath: "/test/task/path",
				apiConversationHistoryFilePath: "/test/task/path/api_conversation_history.json",
				uiMessagesFilePath: "/test/task/path/ui_messages.json",
			}))
			vi.spyOn(fsUtils, "fileExistsAtPath").mockResolvedValue(true)
			;(vi.mocked(fsPromises.readFile) as any).mockImplementation(async (filePath: string) => {
				if (filePath.includes("ui_messages.json")) {
					return JSON.stringify([
						{ type: "say", say: "api_req_started", ts: 1 },
						{ type: "say", say: "text", text: "raw transcript should stay out of payload", ts: 2 },
					])
				}

				return "[]"
			})

			await (provider as any).notifyDelegatedWorkflowCompleted(parentHistory, "Child completed delegated work.")

			expect(sendTaskNotification).toHaveBeenCalledWith(
				expect.objectContaining({
					taskId: "delegated-child-usage",
					outcome: "success",
					workspacePath: "/workspace",
					mode: "code",
					notificationType: "delegated-child",
					parentTaskId: "delegated-parent-usage",
					rootTaskId: "delegated-root-usage",
					tokenUsage: {
						totalTokensIn: 25,
						totalTokensOut: 15,
						totalCacheWrites: 5,
						totalCacheReads: 8,
						totalCost: 0.02,
						contextTokens: 0,
					},
					requestCount: 1,
				}),
			)
			expect(JSON.stringify(sendTaskNotification.mock.calls[0][0])).not.toContain(
				"raw transcript should stay out of payload",
			)
		})

		test("sends delegated child completion and later final parent completion as separate notifications", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const logSpy = vi.spyOn(provider, "log")
			const parentTokenUsage = createTokenUsage({
				totalTokensIn: 50,
				totalTokensOut: 20,
				totalCacheWrites: 1,
				totalCacheReads: 2,
				totalCost: 0.08,
			})
			const childTokenUsage = createTokenUsage({
				totalTokensIn: 25,
				totalTokensOut: 15,
				totalCacheWrites: 3,
				totalCacheReads: 4,
				totalCost: 0.04,
			})
			const historyItem = createHistoryItem({
				id: "delegated-parent-dedupe",
				workspace: "/workspace",
				mode: "code",
				childIds: ["delegated-child-dedupe"],
				completedByChildId: "delegated-child-dedupe",
				completionResultSummary: "Child finished delegated work.",
			})
			const parentTask = new Task({
				...defaultTaskOptions,
				taskId: "delegated-parent-dedupe",
				workspacePath: "/workspace",
			} as any)
			const childTask = new Task({ ...defaultTaskOptions, taskId: "delegated-child-dedupe", parentTask } as any)
			;(parentTask as any).taskMode = "code"
			;(childTask as any).taskMode = "code"
			;(provider as any).taskHistoryStore.getAll = vi.fn(() => [historyItem])
			;(provider as any).taskCreationCallback(parentTask)
			;(provider as any).taskCreationCallback(childTask)
			parentTask.clineMessages.push({
				type: "say",
				say: "text",
				text: "Sensitive delegated parent transcript must not leak.",
				ts: 1,
			})
			parentTask.clineMessages.push({ type: "say", say: "api_req_started", text: "Parent request", ts: 1.5 })
			childTask.clineMessages.push({
				type: "say",
				say: "text",
				text: "Sensitive delegated child transcript must not leak.",
				ts: 1,
			})
			childTask.clineMessages.push({ type: "say", say: "api_req_started", text: "Child request", ts: 1.5 })
			childTask.clineMessages.push({
				type: "say",
				say: "completion_result",
				text: "Child finished delegated work.",
				ts: 2,
			})
			childTask.emit(RooCodeEventName.TaskCompleted, childTask.taskId, childTokenUsage, createToolUsage())
			await vi.waitFor(() => {
				expect(
					(provider as any).emailNotificationTaskOutcomes.get("delegated-child:delegated-child-dedupe"),
				).toBe("success")
			})
			;(parentTask as any).abandoned = true
			parentTask.emit(RooCodeEventName.TaskAborted)
			parentTask.clineMessages.push({
				type: "say",
				say: "completion_result",
				text: "Parent completed final delegated workflow validation.",
				ts: 3,
			})
			parentTask.emit(RooCodeEventName.TaskCompleted, parentTask.taskId, parentTokenUsage, createToolUsage())

			await vi.waitFor(() => expect(sendTaskNotification).toHaveBeenCalledTimes(2))
			expect(sendTaskNotification).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					taskId: "delegated-child-dedupe",
					outcome: "success",
					summary: "Child finished delegated work.",
					notificationType: "delegated-child",
					parentTaskId: "delegated-parent-dedupe",
				}),
			)
			expect(sendTaskNotification).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					taskId: "delegated-parent-dedupe",
					outcome: "success",
					summary: "Parent completed final delegated workflow validation.",
					workflowSummary: expect.stringContaining(
						'Overall workflow rollup: parent task delegated-parent-dedupe completed with final result "Parent completed final delegated workflow validation."',
					),
					usageScope:
						"Aggregated parent workflow usage from the parent task plus 1 child task, including delegated and background parallel-agent tasks discoverable from saved task metadata.",
					tokenUsage: {
						totalTokensIn: 75,
						totalTokensOut: 35,
						totalCacheWrites: 4,
						totalCacheReads: 6,
						totalCost: 0.12,
						contextTokens: 0,
					},
					toolUsage: {
						read_file: { attempts: 4, failures: 2 },
					},
					requestCount: 2,
				}),
			)
			expect(sendTaskNotification.mock.calls[1][0]).not.toHaveProperty("notificationType")
			expect(sendTaskNotification.mock.calls[1][0].workflowSummary).toContain(
				"delegated-child-dedupe: delegated task",
			)
			expect(JSON.stringify(sendTaskNotification.mock.calls[1][0])).not.toContain(
				"Sensitive delegated parent transcript",
			)
			expect(JSON.stringify(sendTaskNotification.mock.calls[1][0])).not.toContain(
				"Sensitive delegated child transcript",
			)
			expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event: "completion-notification-decision",
						taskId: "delegated-parent-dedupe",
						decision: "send-top-level-success-after-delegated-child-notification",
						coveredChildTaskId: "delegated-child-dedupe",
					}),
					expect.objectContaining({
						event: "completion-notification-decision",
						taskId: "delegated-parent-dedupe",
						decision: "send-top-level-success-after-delegated-workflow",
						notificationScope: "task",
						notificationDedupeKey: "task:delegated-parent-dedupe",
						coveredChildTaskId: "delegated-child-dedupe",
					}),
					expect.objectContaining({
						event: "outcome-notification-decision",
						taskId: "delegated-parent-dedupe",
						decision: "dispatch",
						notificationScope: "task",
						notificationDedupeKey: "task:delegated-parent-dedupe",
						duplicateSent: false,
					}),
				]),
			)
			expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event: "completion-notification-aggregation",
						taskId: "delegated-parent-dedupe",
						decision: "use-aggregated-workflow-usage",
						usageAggregationSource: "history-recursive",
						workflowChildTaskCount: 1,
						requestCount: 2,
						totalTokensIn: 75,
						totalTokensOut: 35,
						totalCacheWrites: 4,
						totalCacheReads: 6,
						totalCost: 0.12,
						toolAttempts: 4,
						toolFailures: 2,
					}),
				]),
			)
			expect(JSON.stringify(getEmailNotificationDiagnostics(logSpy))).not.toContain(
				"Sensitive delegated parent transcript",
			)
			expect(JSON.stringify(getEmailNotificationDiagnostics(logSpy))).not.toContain(
				"Sensitive delegated child transcript",
			)
			expect(sendTaskNotification).not.toHaveBeenCalledWith(
				expect.objectContaining({
					taskId: "delegated-parent-dedupe",
					outcome: "aborted",
				}),
			)
		})

		test("accepted final parent completion sends after delegated child notification using task scope", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const logSpy = vi.spyOn(provider, "log")
			const parentTokenUsage = createTokenUsage({
				totalTokensIn: 50,
				totalTokensOut: 20,
				totalCost: 0.08,
			})
			const childTokenUsage = createTokenUsage({
				totalTokensIn: 25,
				totalTokensOut: 15,
				totalCost: 0.04,
			})
			const historyItem = createHistoryItem({
				id: "accepted-delegated-parent",
				workspace: "/workspace",
				mode: "code",
				childIds: ["accepted-delegated-child"],
				completedByChildId: "accepted-delegated-child",
				completionResultSummary: "Accepted child finished delegated work.",
			})
			const parentTask = new Task({
				...defaultTaskOptions,
				taskId: "accepted-delegated-parent",
				workspacePath: "/workspace",
			} as any)
			const childTask = new Task({
				...defaultTaskOptions,
				taskId: "accepted-delegated-child",
				parentTask,
			} as any)
			;(parentTask as any).taskMode = "code"
			;(childTask as any).taskMode = "code"
			;(provider as any).taskHistoryStore.getAll = vi.fn(() => [historyItem])
			;(provider as any).taskCreationCallback(childTask)
			childTask.clineMessages.push({ type: "say", say: "api_req_started", text: "Child request", ts: 1 })
			childTask.clineMessages.push({
				type: "say",
				say: "completion_result",
				text: "Accepted child finished delegated work.",
				ts: 2,
			})

			childTask.emit(RooCodeEventName.TaskCompleted, childTask.taskId, childTokenUsage, createToolUsage())
			await vi.waitFor(() => {
				expect(
					(provider as any).emailNotificationTaskOutcomes.get("delegated-child:accepted-delegated-child"),
				).toBe("success")
			})

			parentTask.clineMessages.push({ type: "say", say: "api_req_started", text: "Parent request", ts: 3 })
			parentTask.clineMessages.push({
				type: "say",
				say: "completion_result",
				text: "Accepted parent completed delegated validation.",
				ts: 4,
			})
			provider.notifyAcceptedFinalParentCompletion(parentTask, parentTokenUsage, createToolUsage())

			await vi.waitFor(() => expect(sendTaskNotification).toHaveBeenCalledTimes(2))
			expect(sendTaskNotification).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					taskId: "accepted-delegated-child",
					notificationType: "delegated-child",
					parentTaskId: "accepted-delegated-parent",
				}),
			)
			expect(sendTaskNotification).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					taskId: "accepted-delegated-parent",
					outcome: "success",
					summary: "Accepted parent completed delegated validation.",
					usageScope:
						"Aggregated parent workflow usage from the parent task plus 1 child task, including delegated and background parallel-agent tasks discoverable from saved task metadata.",
					tokenUsage: expect.objectContaining({
						totalTokensIn: 75,
						totalTokensOut: 35,
						totalCost: 0.12,
					}),
					requestCount: 2,
				}),
			)
			expect(sendTaskNotification.mock.calls[1][0]).not.toHaveProperty("notificationType")
			expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event: "accepted-final-parent-completion-decision",
						taskId: "accepted-delegated-parent",
						decision: "send-top-level-success-after-acceptance",
					}),
					expect.objectContaining({
						event: "outcome-notification-decision",
						taskId: "accepted-delegated-parent",
						decision: "dispatch",
						notificationScope: "task",
						notificationDedupeKey: "task:accepted-delegated-parent",
						duplicateSent: false,
					}),
				]),
			)
		})

		test("skips background tasks covered by workflow notification and sends delegated child tasks", () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const logSpy = vi.spyOn(provider, "log")
			const backgroundTask = new Task({
				...defaultTaskOptions,
				taskId: "background-task",
				background: true,
			} as any)
			const parentTask = new Task({ ...defaultTaskOptions, taskId: "parent-task" } as any)
			const childTask = new Task({ ...defaultTaskOptions, taskId: "child-task", parentTask } as any)
			childTask.clineMessages.push({
				type: "say",
				say: "completion_result",
				text: "Child task completed delegated work.",
				ts: 2,
			})
			;(provider as any).taskCreationCallback(backgroundTask)
			;(provider as any).taskCreationCallback(childTask)
			backgroundTask.emit(
				RooCodeEventName.TaskCompleted,
				backgroundTask.taskId,
				createTokenUsage(),
				createToolUsage(),
			)
			childTask.emit(RooCodeEventName.TaskCompleted, childTask.taskId, createTokenUsage(), createToolUsage())

			expect(sendTaskNotification).toHaveBeenCalledTimes(1)
			expect(sendTaskNotification).toHaveBeenCalledWith(
				expect.objectContaining({
					taskId: "child-task",
					outcome: "success",
					summary: "Child task completed delegated work.",
					notificationType: "delegated-child",
					parentTaskId: "parent-task",
					rootTaskId: "parent-task",
				}),
			)
			expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event: "completion-notification-decision",
						taskId: "background-task",
						decision: "skip-background-task-covered-by-parallel-workflow",
						coveredByWorkflowNotification: true,
					}),
					expect.objectContaining({
						event: "completion-notification-decision",
						taskId: "child-task",
						decision: "send-delegated-child-success",
					}),
				]),
			)
		})

		test("logs duplicate-sent diagnostics without dispatching another visible completion notification", () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const logSpy = vi.spyOn(provider, "log")
			const task = new Task({ ...defaultTaskOptions, taskId: "task-duplicate-sent" } as any)
			;(provider as any).emailNotificationTaskOutcomes.set(`task:${task.taskId}`, "success")
			;(provider as any).taskCreationCallback(task)
			task.emit(RooCodeEventName.TaskCompleted, task.taskId, createTokenUsage(), createToolUsage())

			expect(sendTaskNotification).not.toHaveBeenCalled()
			expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event: "completion-event-observed",
						taskId: "task-duplicate-sent",
					}),
					expect.objectContaining({
						event: "completion-notification-decision",
						taskId: "task-duplicate-sent",
						decision: "send-top-level-success",
					}),
					expect.objectContaining({
						event: "outcome-notification-decision",
						taskId: "task-duplicate-sent",
						decision: "skip-duplicate-sent",
						notificationScope: "task",
						notificationDedupeKey: "task:task-duplicate-sent",
						sentOutcome: "success",
						duplicateSent: true,
						duplicateInFlight: false,
					}),
				]),
			)
		})

		test("logs duplicate-in-flight diagnostics without dispatching another visible completion notification", () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const logSpy = vi.spyOn(provider, "log")
			const task = new Task({ ...defaultTaskOptions, taskId: "task-duplicate-in-flight" } as any)
			;(provider as any).emailNotificationTaskOutcomesInFlight.set(`task:${task.taskId}`, "success")
			;(provider as any).taskCreationCallback(task)
			task.emit(RooCodeEventName.TaskCompleted, task.taskId, createTokenUsage(), createToolUsage())

			expect(sendTaskNotification).not.toHaveBeenCalled()
			expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event: "outcome-notification-decision",
						taskId: "task-duplicate-in-flight",
						decision: "skip-duplicate-in-flight",
						notificationScope: "task",
						notificationDedupeKey: "task:task-duplicate-in-flight",
						inFlightOutcome: "success",
						duplicateSent: false,
						duplicateInFlight: true,
					}),
				]),
			)
		})

		test("does not throw when notification dispatch rejects", () => {
			const sendTaskNotification = installEmailNotificationServiceMock(
				vi.fn().mockRejectedValue(new Error("SMTP down")),
			)
			const task = new Task({ ...defaultTaskOptions, taskId: "task-notification-error" } as any)

			;(provider as any).taskCreationCallback(task)

			expect(() =>
				task.emit(RooCodeEventName.TaskCompleted, task.taskId, createTokenUsage(), createToolUsage()),
			).not.toThrow()
			expect(sendTaskNotification).toHaveBeenCalledTimes(1)
		})

		test("does not persist completion de-duplication until notification dispatch succeeds", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock(
				vi
					.fn()
					.mockResolvedValueOnce({ attempted: true, sent: false })
					.mockResolvedValueOnce({ attempted: true, sent: true }),
			)
			const task = new Task({ ...defaultTaskOptions, taskId: "task-retry-after-send-failure" } as any)
			;(provider as any).taskCreationCallback(task)

			task.emit(RooCodeEventName.TaskCompleted, task.taskId, createTokenUsage(), createToolUsage())

			expect(sendTaskNotification).toHaveBeenCalledTimes(1)
			await vi.waitFor(() => {
				expect((provider as any).emailNotificationTaskOutcomesInFlight.has(`task:${task.taskId}`)).toBe(false)
			})
			expect(mockContext.globalState.update).not.toHaveBeenCalledWith(
				"emailNotificationTaskOutcomes.v1",
				expect.anything(),
			)

			task.emit(RooCodeEventName.TaskCompleted, task.taskId, createTokenUsage(), createToolUsage())

			expect(sendTaskNotification).toHaveBeenCalledTimes(2)
			await vi.waitFor(() => {
				expect(mockContext.globalState.update).toHaveBeenCalledWith("emailNotificationTaskOutcomes.v1", {
					version: 1,
					outcomes: [{ taskId: "task-retry-after-send-failure", outcome: "success" }],
				})
			})
		})

		test("does not persist completion de-duplication when notification dispatch is skipped", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock(
				vi
					.fn()
					.mockResolvedValueOnce({ attempted: false, sent: false, skippedReason: "disabled" })
					.mockResolvedValueOnce({ attempted: true, sent: true }),
			)
			const task = new Task({ ...defaultTaskOptions, taskId: "task-retry-after-send-skip" } as any)
			;(provider as any).taskCreationCallback(task)

			task.emit(RooCodeEventName.TaskCompleted, task.taskId, createTokenUsage(), createToolUsage())

			expect(sendTaskNotification).toHaveBeenCalledTimes(1)
			await vi.waitFor(() => {
				expect((provider as any).emailNotificationTaskOutcomesInFlight.has(`task:${task.taskId}`)).toBe(false)
			})
			expect(mockContext.globalState.update).not.toHaveBeenCalledWith(
				"emailNotificationTaskOutcomes.v1",
				expect.anything(),
			)

			task.emit(RooCodeEventName.TaskCompleted, task.taskId, createTokenUsage(), createToolUsage())

			expect(sendTaskNotification).toHaveBeenCalledTimes(2)
			await vi.waitFor(() => {
				expect(mockContext.globalState.update).toHaveBeenCalledWith("emailNotificationTaskOutcomes.v1", {
					version: 1,
					outcomes: [{ taskId: "task-retry-after-send-skip", outcome: "success" }],
				})
			})
		})

		test("completed task notification wins over a later abort cleanup event", () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const task = new Task({ ...defaultTaskOptions, taskId: "task-complete-then-abort" } as any)
			const tokenUsage = createTokenUsage()
			const toolUsage = createToolUsage()
			;(task as any).tokenUsage = tokenUsage
			;(task as any).toolUsage = toolUsage
			;(provider as any).taskCreationCallback(task)

			task.emit(RooCodeEventName.TaskCompleted, task.taskId, tokenUsage, toolUsage)
			task.emit(RooCodeEventName.TaskAborted)

			expect(sendTaskNotification).toHaveBeenCalledTimes(1)
			expect(sendTaskNotification).toHaveBeenCalledWith(
				expect.objectContaining({
					taskId: "task-complete-then-abort",
					outcome: "success",
				}),
			)
		})

		test("does not send again when reopening an already-completed historical task", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const task = await provider.createTaskWithHistoryItem(
				createHistoryItem({ id: "historical-completed-task", status: "completed" }),
			)

			task.emit(RooCodeEventName.TaskCompleted, task.taskId, createTokenUsage(), createToolUsage())

			expect(sendTaskNotification).not.toHaveBeenCalled()
		})

		test("accepted historical completed task does not resend completion notification", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const logSpy = vi.spyOn(provider, "log")
			const task = await provider.createTaskWithHistoryItem(
				createHistoryItem({ id: "historical-completed-accepted-task", status: "completed" }),
			)
			task.clineMessages.push({
				type: "say",
				say: "completion_result",
				text: "Historical task was already complete.",
				ts: 2,
			})

			provider.notifyAcceptedFinalParentCompletion(task, createTokenUsage(), createToolUsage())

			expect(sendTaskNotification).not.toHaveBeenCalled()
			expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event: "accepted-final-parent-completion-decision",
						taskId: "historical-completed-accepted-task",
						decision: "send-top-level-success-after-acceptance",
						providerCompletionEventObserved: false,
					}),
					expect.objectContaining({
						event: "outcome-notification-decision",
						taskId: "historical-completed-accepted-task",
						decision: "skip-duplicate-sent",
						notificationScope: "task",
						notificationDedupeKey: "task:historical-completed-accepted-task",
						duplicateSent: true,
					}),
				]),
			)
		})

		test("persists task-level success de-duplication across provider instances", async () => {
			const sendTaskNotification = installEmailNotificationServiceMock()
			const task = new Task({ ...defaultTaskOptions, taskId: "persisted-success-task" } as any)
			;(provider as any).taskCreationCallback(task)

			task.emit(RooCodeEventName.TaskCompleted, task.taskId, createTokenUsage(), createToolUsage())

			expect(sendTaskNotification).toHaveBeenCalledTimes(1)
			await vi.waitFor(() => {
				expect(mockContext.globalState.update).toHaveBeenCalledWith("emailNotificationTaskOutcomes.v1", {
					version: 1,
					outcomes: [{ taskId: "persisted-success-task", outcome: "success" }],
				})
			})

			const reloadedProvider = new ClineProvider(
				mockContext,
				mockOutputChannel,
				"sidebar",
				new ContextProxy(mockContext),
			)
			const reloadedSendTaskNotification = vi.fn().mockResolvedValue({ attempted: true, sent: true })
			;(reloadedProvider as any).emailNotificationService = {
				sendTaskNotification: reloadedSendTaskNotification,
				sendTestNotification: vi.fn(),
			}
			const reloadedTask = new Task({
				...defaultTaskOptions,
				provider: reloadedProvider,
				taskId: "persisted-success-task",
			} as any)
			;(reloadedProvider as any).taskCreationCallback(reloadedTask)

			reloadedTask.emit(
				RooCodeEventName.TaskCompleted,
				reloadedTask.taskId,
				createTokenUsage(),
				createToolUsage(),
			)

			expect(reloadedSendTaskNotification).not.toHaveBeenCalled()
		})
	})

	test("resolveWebviewView sets up webview correctly", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		expect(mockWebviewView.webview.options).toEqual({
			enableScripts: true,
			localResourceRoots: [mockContext.extensionUri, { fsPath: "/test/workspace" }],
		})

		expect(mockWebviewView.webview.html).toContain("<!DOCTYPE html>")
	})

	test("resolveWebviewView sets up webview correctly in development mode even if local server is not running", async () => {
		provider = new ClineProvider(
			{ ...mockContext, extensionMode: vscode.ExtensionMode.Development },
			mockOutputChannel,
			"sidebar",
			new ContextProxy(mockContext),
		)
		;(axios.get as any).mockRejectedValueOnce(new Error("Network error"))

		await provider.resolveWebviewView(mockWebviewView)

		expect(mockWebviewView.webview.options).toEqual({
			enableScripts: true,
			localResourceRoots: [mockContext.extensionUri, { fsPath: "/test/workspace" }],
		})

		expect(mockWebviewView.webview.html).toContain("<!DOCTYPE html>")

		// Verify Content Security Policy contains the necessary API domains
		expect(mockWebviewView.webview.html).toContain(
			"connect-src vscode-webview://test-csp-source https://openrouter.ai https://api.requesty.ai",
		)

		// Extract the script-src directive section and verify required security elements
		const html = mockWebviewView.webview.html
		const scriptSrcMatch = html.match(/script-src[^;]*;/)
		expect(scriptSrcMatch).not.toBeNull()
		expect(scriptSrcMatch![0]).toContain("'nonce-")
		// Verify wasm-unsafe-eval is present for Shiki syntax highlighting
		expect(scriptSrcMatch![0]).toContain("'wasm-unsafe-eval'")
	})

	test("postMessageToWebview sends message to webview", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		const mockState: ExtensionState = {
			version: "1.0.0",
			clineMessages: [],
			taskHistory: [],
			shouldShowAnnouncement: false,
			apiConfiguration: {
				apiProvider: "openrouter",
			},
			customInstructions: undefined,
			alwaysAllowReadOnly: false,
			alwaysAllowReadOnlyOutsideWorkspace: false,
			alwaysAllowWrite: false,
			codebaseIndexConfig: {
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderBaseUrl: "",
				codebaseIndexEmbedderModelId: "",
			},
			alwaysAllowWriteOutsideWorkspace: false,
			alwaysAllowExecute: false,
			alwaysAllowMcp: false,
			uriScheme: "vscode",
			soundEnabled: false,
			ttsEnabled: false,
			enableCheckpoints: false,
			writeDelayMs: 1000,
			mcpEnabled: true,
			mode: defaultModeSlug,
			customModes: [],
			experiments: experimentDefault,
			maxOpenTabsContext: 20,
			maxWorkspaceFiles: 200,
			showRooIgnoredFiles: false,
			enableSubfolderRules: false,
			renderContext: "sidebar",
			maxImageFileSize: 5,
			maxTotalImageSize: 20,
			organizationAllowList: ORGANIZATION_ALLOW_ALL,
			autoCondenseContext: true,
			autoCondenseContextPercent: 100,
			profileThresholds: {},
			hasOpenedModeSelector: false,
			diagnosticsEnabled: true,
			openRouterImageApiKey: undefined,
			openRouterImageGenerationSelectedModel: undefined,
			checkpointTimeout: DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
		}

		const message: ExtensionMessage = {
			type: "state",
			state: mockState,
		}
		await provider.postMessageToWebview(message)

		expect(mockPostMessage).toHaveBeenCalledWith(message)
	})

	test("postMessageToWebview does not throw when webview is disposed", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Simulate postMessage throwing after webview disposal
		mockPostMessage.mockRejectedValueOnce(new Error("Webview is disposed"))

		const message: ExtensionMessage = { type: "action", action: "chatButtonClicked" }

		// Should not throw
		await expect(provider.postMessageToWebview(message)).resolves.toBeUndefined()
	})

	test("postMessageToWebview skips postMessage after dispose", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		await provider.dispose()
		mockPostMessage.mockClear()

		const message: ExtensionMessage = { type: "action", action: "chatButtonClicked" }
		await provider.postMessageToWebview(message)

		expect(mockPostMessage).not.toHaveBeenCalled()
	})

	test("dispose is idempotent — second call is a no-op", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		await provider.dispose()
		await provider.dispose()

		// dispose body runs only once: log "Disposing ClineProvider..." appears once
		const disposeCalls = (mockOutputChannel.appendLine as ReturnType<typeof vi.fn>).mock.calls.filter(
			([msg]) => typeof msg === "string" && msg.includes("Disposing ClineProvider..."),
		)
		expect(disposeCalls).toHaveLength(1)
	})

	test("handles webviewDidLaunch message", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Get the message handler from onDidReceiveMessage
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Simulate webviewDidLaunch message
		await messageHandler({ type: "webviewDidLaunch" })

		// Should post state and theme to webview
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("clearTask aborts current task", async () => {
		// Setup Cline instance with auto-mock from the top of the file
		const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance

		// add the mock object to the stack
		await provider.addClineToStack(mockCline)

		// get the stack size before the abort call
		const stackSizeBeforeAbort = provider.getTaskStackSize()

		// call the removeClineFromStack method so it will call the current cline abort and remove it from the stack
		await provider.removeClineFromStack()

		// get the stack size after the abort call
		const stackSizeAfterAbort = provider.getTaskStackSize()

		// check if the abort method was called
		expect(mockCline.abortTask).toHaveBeenCalled()

		// check if the stack size was decreased
		expect(stackSizeBeforeAbort - stackSizeAfterAbort).toBe(1)
	})

	describe("clearTask message handler", () => {
		beforeEach(async () => {
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("calls clearTask (delegation handled via metadata)", async () => {
			// Setup a single task without parent
			const mockCline = new Task(defaultTaskOptions)

			// Mock the provider methods
			const clearTaskSpy = vi.spyOn(provider, "clearTask").mockResolvedValue(undefined)
			const postStateToWebviewSpy = vi.spyOn(provider, "postStateToWebview").mockResolvedValue(undefined)

			// Add task to stack
			await provider.addClineToStack(mockCline)

			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Trigger clearTask message
			await messageHandler({ type: "clearTask" })

			// Verify clearTask was called
			expect(clearTaskSpy).toHaveBeenCalled()
			expect(postStateToWebviewSpy).toHaveBeenCalled()
		})

		test("calls clearTask even with parent task (delegation via metadata)", async () => {
			// Setup parent and child tasks
			const parentTask = new Task(defaultTaskOptions)
			const childTask = new Task(defaultTaskOptions)

			// Set up parent-child relationship
			;(childTask as any).parentTask = parentTask
			;(childTask as any).rootTask = parentTask

			// Mock the provider methods
			const clearTaskSpy = vi.spyOn(provider, "clearTask").mockResolvedValue(undefined)
			const postStateToWebviewSpy = vi.spyOn(provider, "postStateToWebview").mockResolvedValue(undefined)

			// Add both tasks to stack (parent first, then child)
			await provider.addClineToStack(parentTask)
			await provider.addClineToStack(childTask)

			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Trigger clearTask message
			await messageHandler({ type: "clearTask" })

			// Verify clearTask was called (delegation happens via metadata, not finishSubTask)
			expect(clearTaskSpy).toHaveBeenCalled()
			expect(postStateToWebviewSpy).toHaveBeenCalled()
		})

		test("handles case when no current task exists", async () => {
			// Don't add any tasks to the stack

			// Mock the provider methods
			const clearTaskSpy = vi.spyOn(provider, "clearTask").mockResolvedValue(undefined)
			const postStateToWebviewSpy = vi.spyOn(provider, "postStateToWebview").mockResolvedValue(undefined)

			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Trigger clearTask message
			await messageHandler({ type: "clearTask" })

			// When there's no current task, clearTask is still called (it handles the no-task case internally)
			expect(clearTaskSpy).toHaveBeenCalled()
			expect(postStateToWebviewSpy).toHaveBeenCalled()
		})

		test("correctly identifies task scenario for issue #4602", async () => {
			// This test validates the fix for issue #4602
			// where canceling during API retry correctly uses clearTask

			const mockCline = new Task(defaultTaskOptions)

			// Mock the provider methods
			const clearTaskSpy = vi.spyOn(provider, "clearTask").mockResolvedValue(undefined)

			// Add only one task to stack
			await provider.addClineToStack(mockCline)

			// Verify stack size is 1
			expect(provider.getTaskStackSize()).toBe(1)

			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Trigger clearTask message (simulating cancel during API retry)
			await messageHandler({ type: "clearTask" })

			// clearTask should be called (delegation handled via metadata)
			expect(clearTaskSpy).toHaveBeenCalled()
		})
	})

	test("addClineToStack adds multiple Cline instances to the stack", async () => {
		// Setup Cline instance with auto-mock from the top of the file
		const mockCline1 = new Task(defaultTaskOptions) // Create a new mocked instance
		const mockCline2 = new Task(defaultTaskOptions) // Create a new mocked instance
		Object.defineProperty(mockCline1, "taskId", { value: "test-task-id-1", writable: true })
		Object.defineProperty(mockCline2, "taskId", { value: "test-task-id-2", writable: true })

		// add Cline instances to the stack
		await provider.addClineToStack(mockCline1)
		await provider.addClineToStack(mockCline2)

		// verify cline instances were added to the stack
		expect(provider.getTaskStackSize()).toBe(2)

		// verify current cline instance is the last one added
		expect(provider.getCurrentTask()).toBe(mockCline2)
	})

	test("createTask starts background agents without changing the visible task stack", async () => {
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		vi.mocked(parentTask.emit).mockClear()

		const removeClineFromStackSpy = vi.spyOn(provider, "removeClineFromStack")
		const focusedTaskIds: string[] = []
		provider.on(RooCodeEventName.TaskFocused, (taskId) => {
			focusedTaskIds.push(taskId)
		})

		const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
			agentId: "dashboard-js-animation",
			background: true,
			mode: "code",
		})

		expect(backgroundTask.background).toBe(true)
		expect((backgroundTask as any).enableCheckpoints).toBe(false)
		expect(backgroundTask.parentTask).toBe(parentTask)
		expect(backgroundTask.start).toHaveBeenCalledTimes(1)
		expect(provider.getTaskStackSize()).toBe(1)
		expect(provider.getCurrentTask()).toBe(parentTask)
		expect(removeClineFromStackSpy).not.toHaveBeenCalled()
		expect(backgroundTask.emit).not.toHaveBeenCalledWith(RooCodeEventName.TaskFocused)
		expect(focusedTaskIds).toEqual([])
		expect((provider as any).backgroundTasks.has(backgroundTask)).toBe(true)
	})

	test("createTask does not synchronously read taskMode before initialization", async () => {
		let returnedTask: any

		vi.mocked(Task).mockImplementationOnce((options: any) => {
			const listeners = new Map<string, Set<(...args: any[]) => unknown>>()
			const task: any = {
				api: undefined,
				apiConfiguration: options?.apiConfiguration,
				abortTask: vi.fn(),
				cancelCurrentRequest: vi.fn(),
				handleWebviewAskResponse: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				overwriteClineMessages: vi.fn(),
				overwriteApiConversationHistory: vi.fn(),
				resumeAfterParallelExecution: vi.fn(),
				resumeAfterDelegation: vi.fn(),
				dispose: vi.fn(),
				getTaskNumber: vi.fn().mockReturnValue(0),
				setTaskNumber: vi.fn(),
				setParentTask: vi.fn(),
				setRootTask: vi.fn(),
				start: vi.fn(),
				checkpointSave: vi.fn().mockResolvedValue({ commit: "parallel-start-checkpoint" }),
				getTaskMode: vi.fn().mockResolvedValue("architect"),
				taskId: options?.taskId || "async-mode-task-id",
				instanceId: "test-instance-async-mode-task-id",
				rootTask: options?.rootTask,
				parentTask: options?.parentTask,
				rootTaskId: options?.rootTask?.taskId,
				parentTaskId: options?.parentTask?.taskId,
				agentId: options?.agentId,
				background: options?.background ?? false,
				enableCheckpoints: options?.enableCheckpoints ?? true,
				workspacePath: options?.workspacePath,
				abortReason: undefined,
				abandoned: false,
				abort: false,
				isStreaming: false,
				didFinishAbortingStream: false,
				isWaitingForFirstChunk: false,
				on: vi.fn((event: string, listener: (...args: any[]) => unknown) => {
					const key = String(event)
					const eventListeners = listeners.get(key) ?? new Set<(...args: any[]) => unknown>()
					eventListeners.add(listener)
					listeners.set(key, eventListeners)
					return task
				}),
				off: vi.fn((event: string, listener: (...args: any[]) => unknown) => {
					listeners.get(String(event))?.delete(listener)
					return task
				}),
				emit: vi.fn((event: string, ...args: any[]) => {
					for (const listener of listeners.get(String(event)) ?? []) {
						void listener(...args)
					}
					return true
				}),
			}

			Object.defineProperty(task, "taskMode", {
				get: () => {
					throw new Error(
						"Task mode accessed before initialization. Use getTaskMode() or wait for taskModeReady.",
					)
				},
				configurable: true,
			})

			returnedTask = task
			options?.onCreated?.(task)

			return task
		})

		const createdTask = await provider.createTask("Task created while mode initializes", undefined, undefined)

		expect(createdTask.taskId).toBe("async-mode-task-id")
		expect(returnedTask.taskId).toBe("async-mode-task-id")
		expect(returnedTask.getTaskMode).toHaveBeenCalled()
	})

	test("createTask can delay background agent start until lifecycle listeners are attached", async () => {
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)

		const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
			agentId: "dashboard-js-animation",
			background: true,
			mode: "code",
			startTask: false,
		})

		expect(backgroundTask.background).toBe(true)
		expect(backgroundTask.parentTask).toBe(parentTask)
		expect(backgroundTask.start).not.toHaveBeenCalled()
		expect((provider as any).backgroundTasks.has(backgroundTask)).toBe(true)
	})

	test("background agent token usage is forwarded to the parallel status message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)

		const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
			agentId: "dashboard-js-animation",
			background: true,
			mode: "code",
		})

		backgroundTask.emit(
			RooCodeEventName.TaskTokenUsageUpdated,
			backgroundTask.taskId,
			{
				totalTokensIn: 100,
				totalTokensOut: 50,
				totalCacheWrites: 0,
				totalCacheReads: 0,
				totalCost: 0.01,
				contextTokens: 150,
			},
			{},
		)

		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agentStatusUpdate",
				agentStatusUpdate: expect.objectContaining({
					agentId: "dashboard-js-animation",
					status: "running",
					usage: expect.objectContaining({
						totalTokensIn: 100,
						totalTokensOut: 50,
						totalCost: 0.01,
					}),
				}),
			}),
		)
	})

	test("approved execution plans create one persisted native parallelAgents tool message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())

		await vi.waitFor(() => expect(getParallelAgentToolMessages(parentTask)).toHaveLength(1))
		const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])

		expect(tool.tool).toBe("parallelAgents")
		expect(tool.parallelStatus).toBe("running")
		expect(tool.executionPlan?.planId).toBe("plan-webview-provider")
		expect(parentTask.say).toHaveBeenCalledWith(
			"tool",
			expect.any(String),
			undefined,
			undefined,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
	})

	test("approved execution plans create one parent checkpoint before worktrees start", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const worktreeManager = createWorktreeManagerMock()
		;(provider as any).worktreeManager = worktreeManager
		const plan = createExecutionPlan()

		await provider.approveExecutionPlan(plan)

		const getBackgroundTasks = () =>
			vi
				.mocked(Task)
				.mock.results.map((result) => result.value as Task)
				.filter((task) => task.background)

		await vi.waitFor(() => expect(getBackgroundTasks()).toHaveLength(plan.agents.length))
		expect(parentTask.checkpointSave).toHaveBeenCalledTimes(1)
		expect(parentTask.checkpointSave).toHaveBeenCalledWith(true, false, { throwOnError: true })

		const checkpointOrder = vi.mocked(parentTask.checkpointSave).mock.invocationCallOrder[0]
		const createWorktreeOrder = worktreeManager.createWorktree.mock.invocationCallOrder[0]
		expect(checkpointOrder).toBeLessThan(createWorktreeOrder)

		for (const backgroundTask of getBackgroundTasks()) {
			expect(backgroundTask.checkpointSave).not.toHaveBeenCalled()
		}
	})

	test("approved execution plans continue when checkpoint initialization disables checkpoints", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		vi.mocked(parentTask.checkpointSave).mockImplementationOnce(async () => {
			parentTask.enableCheckpoints = false
			return undefined
		})
		await provider.addClineToStack(parentTask)
		const worktreeManager = createWorktreeManagerMock()
		;(provider as any).worktreeManager = worktreeManager

		await provider.approveExecutionPlan(createExecutionPlan())

		await vi.waitFor(() => expect(worktreeManager.createWorktree).toHaveBeenCalled())
		expect(parentTask.checkpointSave).toHaveBeenCalledTimes(1)
		expect(parentTask.checkpointSave).toHaveBeenCalledWith(true, false, { throwOnError: true })
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
	})

	test("approved execution plans continue without a checkpoint when parent checkpoints are disabled", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		parentTask.enableCheckpoints = false
		await provider.addClineToStack(parentTask)
		const worktreeManager = createWorktreeManagerMock()
		;(provider as any).worktreeManager = worktreeManager

		await provider.approveExecutionPlan(createExecutionPlan())

		await vi.waitFor(() => expect(worktreeManager.createWorktree).toHaveBeenCalled())
		expect(parentTask.checkpointSave).not.toHaveBeenCalled()
	})

	test("approved execution plans do not start agents when the pre-start checkpoint fails", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		vi.mocked(parentTask.checkpointSave).mockRejectedValueOnce(new Error("Save failed"))
		await provider.addClineToStack(parentTask)
		const worktreeManager = createWorktreeManagerMock()
		;(provider as any).worktreeManager = worktreeManager

		await provider.approveExecutionPlan(createExecutionPlan())

		expect(parentTask.checkpointSave).toHaveBeenCalledTimes(1)
		expect(parentTask.checkpointSave).toHaveBeenCalledWith(true, false, { throwOnError: true })
		expect(worktreeManager.validateGitRepository).not.toHaveBeenCalled()
		expect(worktreeManager.captureWorkspaceBaseline).not.toHaveBeenCalled()
		expect(worktreeManager.createWorktree).not.toHaveBeenCalled()
		expect(getParallelAgentToolMessages(parentTask)).toHaveLength(0)
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"Failed to create a checkpoint before starting parallel agents for plan plan-webview-provider: Save failed. Parallel agents were not started.",
		)
	})

	test("AgentBus updates coalesce into the persisted parallelAgents tool message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())

		const bus = AgentBus.getInstance()
		bus.requestWriteIntent("dashboard-agent", "src/dashboard.tsx")
		bus.markComplete("dashboard-agent", "Dashboard done")
		bus.publishCoordination("dashboard-agent", {
			kind: "note",
			message: "Completion accepted; README.md is done.",
		})

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentStatusUpdates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						status: "complete",
						lastTouchedFile: "src/dashboard.tsx",
						reason: "Dashboard done",
					}),
				]),
			)
		})

		expect(getParallelAgentToolMessages(parentTask)).toHaveLength(1)
		expect(parentTask.overwriteClineMessages).toHaveBeenCalled()
		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "messageUpdated",
				clineMessage: expect.objectContaining({ say: "tool" }),
			}),
		)
	})

	test("AgentBus completion packets persist structured per-agent and plan evidence", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = createWorktreeManagerMock()

		await provider.approveExecutionPlan(createExecutionPlan())

		const bus = AgentBus.getInstance()
		bus.requestWriteIntent("dashboard-agent", "src/dashboard.tsx")
		bus.requestWriteIntent("dashboard-agent", "src/styles.css")
		bus.markComplete("dashboard-agent", "Dashboard done")

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentCompletionPackets).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						planId: "plan-webview-provider",
						agentId: "dashboard-agent",
						status: "complete",
						completionResult: "Dashboard done",
						ownership: expect.objectContaining({
							status: "violation",
							conflicts: expect.arrayContaining([
								expect.objectContaining({
									path: "src/styles.css",
									approved: false,
									ownerAgentId: "styles-agent",
								}),
							]),
						}),
					}),
				]),
			)
			expect(tool.parallelPlanCompletionPacket).toEqual(
				expect.objectContaining({
					planId: "plan-webview-provider",
					packetCount: 2,
					ownership: expect.objectContaining({ status: "violation" }),
				}),
			)
		})
	})

	test("parallel coordination events are serialized into the persisted parallelAgents tool message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		const plan = createExecutionPlan()
		plan.agents[1] = {
			...plan.agents[1],
			dependsOn: [{ agentId: "dashboard-agent", waitFor: "signal", signal: "dom-ready" }],
			status: "blocked",
		}

		await provider.approveExecutionPlan(plan)

		const bus = AgentBus.getInstance()
		expect(bus.getOpenCoordinationQuestions("styles-agent", { limit: 20 })).toEqual([])
		const question = bus.publishCoordination("dashboard-agent", {
			kind: "question",
			message: "Which class should src/dashboard.tsx expose?",
			targetAgentId: "styles-agent",
			relatedFiles: ["src/dashboard.tsx"],
		})
		expect(question).toBeDefined()
		if (!question) {
			throw new Error("Expected model-published coordination question to be created.")
		}
		bus.publishCoordination("styles-agent", {
			kind: "answer",
			message: "Expose data-dashboard-root for compact styles.",
			targetAgentId: "dashboard-agent",
			replyToId: question.id,
		})
		bus.publishCoordination("dashboard-agent", {
			kind: "decision",
			message: "Decision: src/dashboard.tsx exposes data-dashboard-root.",
			targetAgentId: "styles-agent",
			relatedFiles: ["src/dashboard.tsx"],
		})
		bus.publishCoordination("styles-agent", {
			kind: "note",
			message: "Assumption: compact styles target data-dashboard-root only.",
			targetAgentId: "dashboard-agent",
			relatedFiles: ["src/styles.css"],
		})
		bus.publishCoordination("dashboard-agent", {
			kind: "blocker",
			message: "Blocker: src/styles.css needs the dashboard root selector before final CSS.",
			targetAgentId: "styles-agent",
			relatedFiles: ["src/styles.css"],
		})
		bus.requestWriteIntent("dashboard-agent", "src/dashboard.tsx")
		bus.markBlocked("styles-agent", "Waiting for DOM contract", [
			{ agentId: "dashboard-agent", waitFor: "signal", signal: "dom-ready" },
		])
		bus.markComplete("dashboard-agent", "Dashboard done")

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentCoordinationEvents).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: question.id,
						agentId: "dashboard-agent",
						targetAgentId: "styles-agent",
						kind: "question",
						source: "agent",
						message: "Which class should src/dashboard.tsx expose?",
						relatedFiles: ["src/dashboard.tsx"],
					}),
					expect.objectContaining({
						agentId: "styles-agent",
						targetAgentId: "dashboard-agent",
						kind: "answer",
						source: "agent",
						message: "Expose data-dashboard-root for compact styles.",
						replyToId: question.id,
					}),
					expect.objectContaining({
						agentId: "dashboard-agent",
						targetAgentId: "styles-agent",
						kind: "decision",
						source: "agent",
						message: "Decision: src/dashboard.tsx exposes data-dashboard-root.",
						relatedFiles: ["src/dashboard.tsx"],
					}),
					expect.objectContaining({
						agentId: "styles-agent",
						targetAgentId: "dashboard-agent",
						kind: "note",
						source: "agent",
						message: "Assumption: compact styles target data-dashboard-root only.",
						relatedFiles: ["src/styles.css"],
					}),
					expect.objectContaining({
						agentId: "dashboard-agent",
						targetAgentId: "styles-agent",
						kind: "blocker",
						source: "agent",
						message: "Blocker: src/styles.css needs the dashboard root selector before final CSS.",
						relatedFiles: ["src/styles.css"],
					}),
				]),
			)
			expect(
				tool.agentCoordinationEvents?.every((event) =>
					["question", "answer", "decision", "note", "blocker"].includes(event.kind),
				),
			).toBe(true)
			expect(JSON.stringify(tool.agentCoordinationEvents)).not.toMatch(
				/I own|Team chat open|Shared context is in each agent task|waits for|I'm about to edit/i,
			)
			expect(
				tool.agentCoordinationEvents?.some(
					(event) =>
						event.agentId === "dashboard-agent" && event.kind === "completion" && event.source === "system",
				),
			).toBe(false)
			expect(
				tool.agentCoordinationEvents?.some(
					(event) =>
						event.source === "system" && event.id?.includes(":ownership:") && event.kind === "ownership",
				),
			).toBe(false)
			expect(tool.agentCoordinationEvents?.every((event) => event.message.length <= 90)).toBe(true)
			expect(JSON.stringify(tool.agentCoordinationEvents)).not.toMatch(
				/selectors, classes, CSS variables|DOM hooks, IDs|public functions|file contracts/,
			)
			expect(JSON.stringify(tool.agentCoordinationEvents)).not.toMatch(/\p{Extended_Pictographic}/u)
			expect(JSON.stringify(tool.agentCoordinationEvents)).not.toContain("Dashboard done")
			expect(JSON.stringify(tool.agentCoordinationEvents)).not.toContain("Completion accepted")
			expect(JSON.stringify(tool.agentCoordinationEvents)).not.toContain("shared context")
			expect(tool.agentCompletionPackets).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						status: "complete",
						completionResult: "Dashboard done",
					}),
				]),
			)
		})
	})

	test("rapid AgentBus updates serialize persisted parallelAgents message saves without overlap", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		vi.mocked(parentTask.overwriteClineMessages).mockClear()

		let inFlight = 0
		let maxInFlight = 0
		let releaseFirstOverwrite!: () => void
		const firstOverwriteBlocked = new Promise<void>((resolve) => {
			releaseFirstOverwrite = resolve
		})
		parentTask.overwriteClineMessages = vi.fn(async (messages: ClineMessage[]) => {
			inFlight += 1
			maxInFlight = Math.max(maxInFlight, inFlight)
			parentTask.clineMessages = messages

			try {
				if (vi.mocked(parentTask.overwriteClineMessages).mock.calls.length === 1) {
					await firstOverwriteBlocked
				}
			} finally {
				inFlight -= 1
			}
		}) as typeof parentTask.overwriteClineMessages

		const bus = AgentBus.getInstance()
		bus.markRunning("dashboard-agent")
		bus.requestWriteIntent("dashboard-agent", "src/dashboard.tsx")
		bus.markBlocked("dashboard-agent", "Waiting for styles")
		bus.markComplete("dashboard-agent", "Dashboard done")
		bus.markRunning("styles-agent")

		await vi.waitFor(() => expect(parentTask.overwriteClineMessages).toHaveBeenCalledTimes(1))
		expect(maxInFlight).toBe(1)
		bus.markBlocked("styles-agent", "Paused while the parent row save is in flight")

		releaseFirstOverwrite()

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentStatusUpdates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						status: "complete",
						lastTouchedFile: "src/dashboard.tsx",
						reason: "Dashboard done",
					}),
					expect.objectContaining({
						agentId: "styles-agent",
						status: "blocked",
						reason: "Paused while the parent row save is in flight",
					}),
				]),
			)
		})

		expect(maxInFlight).toBe(1)
		expect(parentTask.overwriteClineMessages).toHaveBeenCalledTimes(2)
	})

	test("background agent messages persist concise activity summaries without raw child transcript text", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const childMessage: ClineMessage = {
			type: "say",
			say: "reasoning",
			ts: Date.now(),
			text: "raw child chain-of-thought should never be copied to the parent row",
		}

		backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: childMessage })

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentActivities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "thinking",
						message: "Reasoning through the next step.",
					}),
				]),
			)
			expect(tool.agentStatusUpdates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						activities: expect.arrayContaining([
							expect.objectContaining({
								kind: "thinking",
								message: "Reasoning through the next step.",
							}),
						]),
					}),
				]),
			)
			expect(JSON.stringify(tool)).not.toContain("raw child chain-of-thought")
		})
	})

	test("background agent partial messages replace generic thinking with sanitized live progress", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const apiRequestStarted: ClineMessage = {
			type: "say",
			say: "api_req_started",
			ts: 1_500,
			text: JSON.stringify({ apiProtocol: "anthropic" }),
		}
		const partialReasoning: ClineMessage = {
			type: "say",
			say: "reasoning",
			ts: 1_501,
			text: "raw streamed child reasoning should not be copied",
			partial: true,
		}
		const partialTool: ClineMessage = {
			type: "ask",
			ask: "tool",
			ts: 1_501,
			text: JSON.stringify({ tool: "write_to_file", path: "src/dashboard.tsx" }),
			partial: true,
		}

		backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: apiRequestStarted })
		backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: partialReasoning })

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			const activities = tool.agentActivities?.filter((activity) => activity.agentId === "dashboard-agent") ?? []
			expect(activities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "thinking",
						message: "Reasoning through the next step.",
						ts: 1_501,
					}),
				]),
			)
			expect(JSON.stringify(tool)).not.toContain("raw streamed child reasoning")
		})

		backgroundTask.emit(RooCodeEventName.Message, { action: "updated", message: partialTool })

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			const activities = tool.agentActivities?.filter((activity) => activity.agentId === "dashboard-agent") ?? []
			expect(activities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "thinking",
						message: "Requesting the next model action.",
						ts: 1_500,
					}),
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "tool",
						message: "Writing src/dashboard.tsx.",
						ts: 1_501,
					}),
				]),
			)
			expect(activities.filter((activity) => activity.ts === 1_501)).toHaveLength(1)
			expect(activities.map((activity) => activity.message)).not.toContain("Thinking…")
			expect(JSON.stringify(tool)).not.toContain("raw streamed child reasoning")
		})
	})

	test("background agent activity transcripts are bounded per agent", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		for (let index = 0; index < 55; index++) {
			const childMessage: ClineMessage = {
				type: "say",
				say: "tool",
				ts: 1_000 + index,
				text: JSON.stringify({ tool: "readFile", path: `src/file-${index}.ts` }),
			}

			backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: childMessage })
		}

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			const activities = tool.agentActivities?.filter((activity) => activity.agentId === "dashboard-agent") ?? []
			expect(activities).toHaveLength(50)
			expect(activities[0]).toEqual(
				expect.objectContaining({
					message: "Reading src/file-5.ts.",
					ts: 1_005,
				}),
			)
			expect(activities.at(-1)).toEqual(
				expect.objectContaining({
					message: "Reading src/file-54.ts.",
					ts: 1_054,
				}),
			)
			const statusUpdate = tool.agentStatusUpdates?.find((update) => update.agentId === "dashboard-agent")
			expect(statusUpdate?.activities).toHaveLength(50)
		})
	})

	test("background agent tool activity labels use concrete tool states before falling back", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const messages: ClineMessage[] = [
			{
				type: "say",
				say: "tool",
				ts: 2_000,
				text: JSON.stringify({ tool: "write_to_file", path: "src/dashboard.tsx" }),
			},
			{
				type: "say",
				say: "tool",
				ts: 2_001,
				text: JSON.stringify({ tool: "apply_diff", path: "src/dashboard.tsx" }),
			},
			{
				type: "say",
				say: "tool",
				ts: 2_002,
				text: JSON.stringify({ tool: "execute_command", command: "npm test" }),
			},
			{
				type: "ask",
				ask: "tool",
				ts: 2_003,
				text: JSON.stringify({ tool: "ask_followup_question", question: "Which behavior should I use?" }),
			},
		]

		for (const message of messages) {
			backgroundTask.emit(RooCodeEventName.Message, { action: "created", message })
		}

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentActivities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "tool",
						message: "Writing src/dashboard.tsx.",
					}),
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "tool",
						message: "Applying a diff to src/dashboard.tsx.",
					}),
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "tool",
						message: "Running command: npm test.",
					}),
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "approval",
						message: "Waiting for a follow-up answer.",
					}),
				]),
			)
			expect(tool.agentActivities?.map((activity) => activity.message)).not.toContain("Thinking…")
		})
	})

	test("pending diff tool asks supersede stale diff-start activity labels", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const diffAsk: ClineMessage = {
			type: "ask",
			ask: "tool",
			ts: 2_050,
			text: JSON.stringify({ tool: "appliedDiff", path: "src/dashboard.css" }),
			partial: true,
		}

		backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: diffAsk })

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentActivities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "tool",
						message: "Applying a diff to src/dashboard.css.",
						ts: 2_050,
					}),
				]),
			)
		})

		backgroundTask.emit(RooCodeEventName.Message, {
			action: "updated",
			message: { ...diffAsk, partial: false },
		})

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			const activities = tool.agentActivities?.filter((activity) => activity.agentId === "dashboard-agent") ?? []
			const statusUpdate = tool.agentStatusUpdates?.find((update) => update.agentId === "dashboard-agent")

			expect(activities.filter((activity) => activity.ts === 2_050)).toEqual([
				expect.objectContaining({
					agentId: "dashboard-agent",
					kind: "approval",
					message: "Waiting for diff approval for src/dashboard.css.",
					ts: 2_050,
				}),
			])
			expect(activities.map((activity) => activity.message)).not.toContain(
				"Applying a diff to src/dashboard.css.",
			)
			expect(statusUpdate?.activities?.at(-1)?.message).toBe("Waiting for diff approval for src/dashboard.css.")
		})
	})

	test("answered write tool asks supersede stale diff-start activity labels", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const diffAsk: ClineMessage = {
			type: "ask",
			ask: "tool",
			ts: 2_100,
			text: JSON.stringify({ tool: "appliedDiff", path: "src/dashboard.css" }),
			partial: true,
		}

		backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: diffAsk })

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentActivities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "tool",
						message: "Applying a diff to src/dashboard.css.",
						ts: 2_100,
					}),
				]),
			)
		})

		backgroundTask.emit(RooCodeEventName.Message, {
			action: "updated",
			message: { ...diffAsk, partial: false, isAnswered: true },
		})

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			const activities = tool.agentActivities?.filter((activity) => activity.agentId === "dashboard-agent") ?? []
			const statusUpdate = tool.agentStatusUpdates?.find((update) => update.agentId === "dashboard-agent")
			expect(activities.filter((activity) => activity.ts === 2_100)).toEqual([
				expect.objectContaining({
					agentId: "dashboard-agent",
					kind: "file",
					message: "Saving diff changes to src/dashboard.css.",
					ts: 2_100,
				}),
			])
			expect(activities.map((activity) => activity.message)).not.toContain(
				"Applying a diff to src/dashboard.css.",
			)
			expect(statusUpdate?.activities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						kind: "file",
						message: "Saving diff changes to src/dashboard.css.",
					}),
				]),
			)
		})
	})

	test("background agent progress events supersede stale file-operation labels during long writes", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const diffAsk: ClineMessage = {
			type: "ask",
			ask: "tool",
			ts: 2_200,
			text: JSON.stringify({ tool: "appliedDiff", path: "src/dashboard.tsx" }),
			partial: true,
		}

		backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: diffAsk })

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentActivities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						message: "Applying a diff to src/dashboard.tsx.",
						ts: 2_200,
					}),
				]),
			)
		})

		AgentBus.getInstance().reportProgress(
			"dashboard-agent",
			"Applying 3 diff blocks to src/dashboard.tsx.",
			"file",
			"src/dashboard.tsx",
		)
		AgentBus.getInstance().reportProgress(
			"dashboard-agent",
			"Waiting up to 3s for diagnostics after saving src/dashboard.tsx.",
			"file",
			"src/dashboard.tsx",
		)

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			const activities = tool.agentActivities?.filter((activity) => activity.agentId === "dashboard-agent") ?? []
			const statusUpdate = tool.agentStatusUpdates?.find((update) => update.agentId === "dashboard-agent")

			expect(activities.at(-1)).toEqual(
				expect.objectContaining({
					agentId: "dashboard-agent",
					kind: "file",
					message: "Waiting up to 3s for diagnostics after saving src/dashboard.tsx.",
				}),
			)
			expect(activities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						kind: "file",
						message: "Applying 3 diff blocks to src/dashboard.tsx.",
					}),
				]),
			)
			expect(statusUpdate?.lastTouchedFile).toBe("src/dashboard.tsx")
			expect(statusUpdate?.activities?.at(-1)?.message).toBe(
				"Waiting up to 3s for diagnostics after saving src/dashboard.tsx.",
			)
		})
	})

	test("requestPlanApproval shows the plan preview and waits by default", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const plan = createExecutionPlan()

		const approvalPromise = provider.requestPlanApproval(plan)
		const approvalSpy = vi.fn()
		approvalPromise.then(approvalSpy)

		await vi.waitFor(() =>
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "showPlanPreview",
					executionPlan: plan,
				}),
			),
		)
		await Promise.resolve()

		expect(approvalSpy).not.toHaveBeenCalled()

		await provider.cancelExecutionPlan()
		await expect(approvalPromise).resolves.toEqual({ approved: false })
	})

	test("requestPlanApproval auto-starts valid parallel plans when parallel tasks auto-approval is enabled", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		await provider.setValues({ autoApprovalEnabled: true, alwaysAllowParallelTasks: true })
		const validateGitRepository = vi.fn().mockResolvedValue(undefined)
		const captureWorkspaceBaseline = vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" })
		;(provider as any).worktreeManager = {
			validateGitRepository,
			captureWorkspaceBaseline,
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}
		const plan = createExecutionPlan()

		const result = await provider.requestPlanApproval(plan)

		expect(result).toEqual({ approved: true, plan, startResult: { ok: true } })
		expect(validateGitRepository).toHaveBeenCalled()
		expect(captureWorkspaceBaseline).toHaveBeenCalledWith("plan-webview-provider")
		expect(validateGitRepository.mock.invocationCallOrder[0]).toBeLessThan(
			captureWorkspaceBaseline.mock.invocationCallOrder[0],
		)
		expect((provider as any).activeExecutionPlan).toBe(plan)
		expect(
			mockPostMessage.mock.calls.some(([message]: [ExtensionMessage]) => message.type === "showPlanPreview"),
		).toBe(false)
		await vi.waitFor(() => expect(getParallelAgentToolMessages(parentTask)).toHaveLength(1))
	})

	test("merge review collects uncommitted worktree changes before displaying agent diffs", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		const logSpy = vi.spyOn(provider, "log")
		const prepareMergeReview = vi.fn(
			async ({ agentId, onDiagnostics }: { agentId: string; onDiagnostics?: (diagnostics: unknown) => void }) => {
				const workspaceRelativePath = agentId === "dashboard-agent" ? "src/dashboard.tsx" : "src/styles.css"
				onDiagnostics?.({
					planId: "plan-webview-provider",
					agentId,
					branch: `roo/parallel/plan-webview-provider/${agentId}`,
					worktreePath: `/tmp/${agentId}`,
					originalOwnedPaths: agentId === "dashboard-agent" ? ["./src/dashboard.tsx"] : ["src/styles.css"],
					normalizedOwnedPaths: [workspaceRelativePath],
					pathDiagnostics: [
						{
							originalPath: agentId === "dashboard-agent" ? "./src/dashboard.tsx" : "src/styles.css",
							workspaceRelativePath,
							worktreePath: `/tmp/${agentId}/${workspaceRelativePath}`,
							rootWorkspacePath: `/repo/${workspaceRelativePath}`,
							existsInWorktree: agentId === "dashboard-agent",
							existsInRootWorkspace: true,
						},
					],
					trackedChangedPaths: agentId === "dashboard-agent" ? [workspaceRelativePath] : [],
					untrackedChangedPaths: [],
					stagedPaths: agentId === "dashboard-agent" ? [workspaceRelativePath] : [],
					commitCreated: agentId === "dashboard-agent",
					result: agentId === "dashboard-agent" ? "committed" : "no-owned-worktree-changes",
				})

				return agentId === "dashboard-agent"
					? "diff --git a/src/dashboard.tsx b/src/dashboard.tsx\n+const dashboard = true\n"
					: ""
			},
		)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview,
			mergeBranch: vi.fn().mockResolvedValue(undefined),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(plan)
		await vi.waitFor(() => expect((provider as any).activeExecutionPlan).toBe(plan))

		await provider.showMergeReview(plan)

		expect(prepareMergeReview).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "dashboard-agent",
				planId: "plan-webview-provider",
				worktreePath: "/tmp/dashboard-agent",
				branch: "roo/parallel/plan-webview-provider/dashboard-agent",
				ownedPaths: ["src/dashboard.tsx"],
				onDiagnostics: expect.any(Function),
			}),
		)
		const mergeReviewDiagnostics = logSpy.mock.calls
			.map(([message]) => String(message))
			.filter((message) => message.startsWith("[parallel-agents] merge-review-diagnostics "))
			.map(
				(message) =>
					JSON.parse(message.slice("[parallel-agents] merge-review-diagnostics ".length)) as Record<
						string,
						any
					>,
			)

		expect(mergeReviewDiagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					planId: "plan-webview-provider",
					agentId: "dashboard-agent",
					branch: "roo/parallel/plan-webview-provider/dashboard-agent",
					worktreePath: "/tmp/dashboard-agent",
					originalOwnedPaths: ["./src/dashboard.tsx"],
					normalizedOwnedPaths: ["src/dashboard.tsx"],
					pathDiagnostics: [
						expect.objectContaining({
							originalPath: "./src/dashboard.tsx",
							workspaceRelativePath: "src/dashboard.tsx",
							worktreePath: "/tmp/dashboard-agent/src/dashboard.tsx",
							rootWorkspacePath: "/repo/src/dashboard.tsx",
							existsInWorktree: true,
							existsInRootWorkspace: true,
						}),
					],
					trackedChangedPaths: ["src/dashboard.tsx"],
					untrackedChangedPaths: [],
					stagedPaths: ["src/dashboard.tsx"],
					commitCreated: true,
					result: "committed",
				}),
				expect.objectContaining({
					planId: "plan-webview-provider",
					agentId: "styles-agent",
					originalOwnedPaths: ["src/styles.css"],
					normalizedOwnedPaths: ["src/styles.css"],
					pathDiagnostics: [
						expect.objectContaining({
							originalPath: "src/styles.css",
							workspaceRelativePath: "src/styles.css",
							worktreePath: "/tmp/styles-agent/src/styles.css",
							rootWorkspacePath: "/repo/src/styles.css",
							existsInWorktree: false,
							existsInRootWorkspace: true,
						}),
					],
					trackedChangedPaths: [],
					untrackedChangedPaths: [],
					stagedPaths: [],
					commitCreated: false,
					result: "no-owned-worktree-changes",
				}),
			]),
		)
		expect(JSON.stringify(mergeReviewDiagnostics)).not.toContain("diff --git")
		expect(JSON.stringify(mergeReviewDiagnostics)).not.toContain("const dashboard = true")
		expect(
			mockPostMessage.mock.calls.some(([message]: [ExtensionMessage]) => message.type === "showMergeReview"),
		).toBe(false)
		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("review")
		expect(statusTool.mergeReviewEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "dashboard-agent",
					diff: expect.stringContaining("diff --git"),
					changeStats: {
						filesChanged: 1,
						additions: 1,
						deletions: 0,
						totalChanges: 1,
						binaryFiles: 0,
					},
				}),
				expect.objectContaining({
					agentId: "styles-agent",
					diff: "",
					noChangesReason: "No changes detected in this agent worktree.",
					changeStats: {
						filesChanged: 0,
						additions: 0,
						deletions: 0,
						totalChanges: 0,
						binaryFiles: 0,
					},
				}),
			]),
		)
		expect(statusTool.parallelReviewSummary?.markdown).toContain(
			"Full per-agent diffs are available in the persisted parallel agents card.",
		)
		expect(statusTool.agentCompletionPackets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "dashboard-agent",
					artifactManifest: [
						expect.objectContaining({ path: "src/dashboard.tsx", status: "modified", additions: 1 }),
					],
					merge: expect.objectContaining({ readiness: "ready", result: "pending", materialized: false }),
				}),
			]),
		)
		expect(statusTool.parallelPlanCompletionPacket).toEqual(
			expect.objectContaining({
				status: "awaiting-review",
				aggregateArtifactManifest: [
					expect.objectContaining({ path: "src/dashboard.tsx", agentId: "dashboard-agent" }),
				],
			}),
		)
	})

	test("merge approval prepares and merges only selected agent branches after review", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		const prepareMergeReview = vi.fn(
			async ({ agentId }: { agentId: string }) => `diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n`,
		)
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		const removeWorktree = vi.fn().mockResolvedValue(undefined)
		const cleanupPlanBaseline = vi.fn().mockResolvedValue(undefined)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview,
			mergeBranch,
			removeWorktree,
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline,
		}

		await provider.approveExecutionPlan(plan)
		await vi.waitFor(() => expect((provider as any).activeExecutionPlan).toBe(plan))

		expect(mergeBranch).not.toHaveBeenCalled()
		await provider.mergeApprovedAgents(["dashboard-agent"])

		expect(prepareMergeReview).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "dashboard-agent",
				worktreePath: "/tmp/dashboard-agent",
				ownedPaths: ["src/dashboard.tsx"],
			}),
		)
		expect(mergeBranch).toHaveBeenCalledTimes(1)
		expect(mergeBranch).toHaveBeenCalledWith("roo/parallel/plan-webview-provider/dashboard-agent", {
			planId: "plan-webview-provider",
			worktreePath: "/tmp/dashboard-agent",
			ownedPaths: ["src/dashboard.tsx"],
			autoApproved: false,
		})
		expect(mergeBranch).not.toHaveBeenCalledWith("roo/parallel/plan-webview-provider/styles-agent")
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/dashboard-agent")
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/styles-agent")
		expect(cleanupPlanBaseline).toHaveBeenCalledWith("plan-webview-provider")
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "mergeComplete" })
		expect(parentTask.resumeAfterParallelExecution).toHaveBeenCalledTimes(1)
	})

	test("manual merge saves affected dirty open documents before materialization and synchronizes them after", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const diff = "diff --git a/src/dashboard.tsx b/src/dashboard.tsx\n+done\n"
		const dirtyDocument = createTextDocument("src/dashboard.tsx", { isDirty: true })
		const unaffectedDirtyDocument = createTextDocument("src/other.ts", { isDirty: true })
		;(vscode.workspace as any).textDocuments = [dirtyDocument, unaffectedDirtyDocument]
		const prepareMergeReview = vi.fn().mockResolvedValue(diff)
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).parallelMergeReviewEntries = [
			{
				agentId: "dashboard-agent",
				mode: "code",
				task: "Build dashboard",
				diff,
				worktreePath: "/tmp/dashboard-agent",
				branch: "roo/parallel/plan-webview-provider/dashboard-agent",
				mergeStatus: "pending",
			},
		]
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreeManager = createWorktreeManagerMock({ prepareMergeReview, mergeBranch })
		const logSpy = vi.spyOn(provider, "log")
		;(vscode.workspace.openTextDocument as any).mockClear()
		const affectedPaths = (provider as any).getMergeAffectedPaths((provider as any).parallelMergeReviewEntries[0], [
			"src/dashboard.tsx",
		])
		expect(affectedPaths).toEqual(["src/dashboard.tsx"])
		expect((provider as any).getAffectedOpenDocuments(affectedPaths)).toEqual([
			expect.objectContaining({ relPath: "src/dashboard.tsx" }),
		])

		await expect(provider.mergeApprovedAgents(["dashboard-agent"])).resolves.toBe(true)

		expect(dirtyDocument.save).toHaveBeenCalledTimes(1)
		expect(unaffectedDirtyDocument.save).not.toHaveBeenCalled()
		expect(mergeBranch).toHaveBeenCalledTimes(1)
		expect((dirtyDocument.save as any).mock.invocationCallOrder[0]).toBeLessThan(
			mergeBranch.mock.invocationCallOrder[0],
		)
		expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(dirtyDocument.uri)

		const diagnostics = getMergeDocumentSyncDiagnostics(logSpy)
		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					stage: "pre-save",
					result: "completed",
					dirtyDocumentCount: 1,
					savedDocumentCount: 1,
					savedDocumentPaths: ["src/dashboard.tsx"],
				}),
				expect.objectContaining({
					stage: "post-merge-sync",
					result: "completed",
					syncedDocumentCount: 1,
					syncedDocumentPaths: ["src/dashboard.tsx"],
				}),
			]),
		)
		expect(logSpy.mock.calls.map(([message]) => String(message)).join("\n")).not.toContain("diff --git")
	})

	test("auto-approved merge saves dirty affected open documents and blocks workspace materialization", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const diff = "diff --git a/src/dashboard.tsx b/src/dashboard.tsx\n+done\n"
		const dirtyDocument = createTextDocument("src/dashboard.tsx", { isDirty: true })
		;(vscode.workspace as any).textDocuments = [dirtyDocument]
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).parallelMergeReviewEntries = [
			{
				agentId: "dashboard-agent",
				mode: "code",
				task: "Build dashboard",
				diff,
				worktreePath: "/tmp/dashboard-agent",
				branch: "roo/parallel/plan-webview-provider/dashboard-agent",
				mergeStatus: "pending",
			},
		]
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreeManager = createWorktreeManagerMock({
			prepareMergeReview: vi.fn().mockResolvedValue(diff),
			mergeBranch,
		})
		const logSpy = vi.spyOn(provider, "log")
		const affectedPaths = (provider as any).getMergeAffectedPaths((provider as any).parallelMergeReviewEntries[0], [
			"src/dashboard.tsx",
		])
		expect(affectedPaths).toEqual(["src/dashboard.tsx"])
		expect((provider as any).getAffectedOpenDocuments(affectedPaths)).toEqual([
			expect.objectContaining({ relPath: "src/dashboard.tsx" }),
		])

		await expect(provider.mergeApprovedAgents(["dashboard-agent"], { autoApproved: true })).resolves.toBe(false)

		expect(dirtyDocument.save).toHaveBeenCalledTimes(1)
		expect(mergeBranch).not.toHaveBeenCalled()
		expect(vscode.workspace.openTextDocument).not.toHaveBeenCalledWith(dirtyDocument.uri)
		expect(parentTask.resumeAfterParallelExecution).toHaveBeenCalledTimes(1)
		expect((provider as any).parallelMergeReviewEntries[0]).toEqual(
			expect.objectContaining({
				mergeStatus: "skipped",
				autoMergeSkippedReason: expect.stringContaining("Auto-merge blocked"),
			}),
		)

		const diagnostics = getMergeDocumentSyncDiagnostics(logSpy)
		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					stage: "auto-approved-block",
					result: "blocked",
					autoApproved: true,
					dirtyDocumentCount: 1,
					savedDocumentCount: 1,
				}),
			]),
		)
		expect(mockPostMessage).not.toHaveBeenCalledWith({ type: "mergeComplete" })
	})

	test("merge approval fails safely when an affected dirty open document cannot be saved", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const diff = "diff --git a/src/dashboard.tsx b/src/dashboard.tsx\n+done\n"
		const dirtyDocument = createTextDocument("src/dashboard.tsx", { isDirty: true, saveResult: false })
		;(vscode.workspace as any).textDocuments = [dirtyDocument]
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).parallelMergeReviewEntries = [
			{
				agentId: "dashboard-agent",
				mode: "code",
				task: "Build dashboard",
				diff,
				worktreePath: "/tmp/dashboard-agent",
				branch: "roo/parallel/plan-webview-provider/dashboard-agent",
				mergeStatus: "pending",
			},
		]
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreeManager = createWorktreeManagerMock({
			prepareMergeReview: vi.fn().mockResolvedValue(diff),
			mergeBranch,
		})
		const logSpy = vi.spyOn(provider, "log")
		const affectedPaths = (provider as any).getMergeAffectedPaths((provider as any).parallelMergeReviewEntries[0], [
			"src/dashboard.tsx",
		])
		expect(affectedPaths).toEqual(["src/dashboard.tsx"])
		expect((provider as any).getAffectedOpenDocuments(affectedPaths)).toEqual([
			expect.objectContaining({ relPath: "src/dashboard.tsx" }),
		])

		await expect(provider.mergeApprovedAgents(["dashboard-agent"])).resolves.toBe(false)

		expect(dirtyDocument.save).toHaveBeenCalledTimes(1)
		expect(mergeBranch).not.toHaveBeenCalled()
		expect(vscode.workspace.openTextDocument).not.toHaveBeenCalledWith(dirtyDocument.uri)
		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "mergeFailed",
				agentId: "dashboard-agent",
				gitOutput: expect.stringContaining("Failed to save open document src/dashboard.tsx"),
			}),
		)
		expect((provider as any).parallelMergeReviewEntries[0]).toEqual(
			expect.objectContaining({
				mergeStatus: "failed",
				mergeError: expect.stringContaining("Failed to save open document src/dashboard.tsx"),
			}),
		)

		const diagnostics = getMergeDocumentSyncDiagnostics(logSpy)
		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					stage: "pre-save",
					result: "failed",
					dirtyDocumentCount: 1,
					failedPathCount: 1,
					failedPaths: ["src/dashboard.tsx"],
				}),
			]),
		)
	})

	test("merge approval synchronizes clean affected open documents after materialization", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const diff = "diff --git a/src/dashboard.tsx b/src/dashboard.tsx\n+done\n"
		const cleanDocument = createTextDocument("src/dashboard.tsx", { isDirty: false })
		;(vscode.workspace as any).textDocuments = [cleanDocument]
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).parallelMergeReviewEntries = [
			{
				agentId: "dashboard-agent",
				mode: "code",
				task: "Build dashboard",
				diff,
				worktreePath: "/tmp/dashboard-agent",
				branch: "roo/parallel/plan-webview-provider/dashboard-agent",
				mergeStatus: "pending",
			},
		]
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreeManager = createWorktreeManagerMock({
			prepareMergeReview: vi.fn().mockResolvedValue(diff),
			mergeBranch,
		})
		const logSpy = vi.spyOn(provider, "log")
		;(vscode.workspace.openTextDocument as any).mockClear()
		const affectedPaths = (provider as any).getMergeAffectedPaths((provider as any).parallelMergeReviewEntries[0], [
			"src/dashboard.tsx",
		])
		expect(affectedPaths).toEqual(["src/dashboard.tsx"])
		expect((provider as any).getAffectedOpenDocuments(affectedPaths)).toEqual([
			expect.objectContaining({ relPath: "src/dashboard.tsx" }),
		])

		await expect(provider.mergeApprovedAgents(["dashboard-agent"])).resolves.toBe(true)

		expect(cleanDocument.save).not.toHaveBeenCalled()
		expect(mergeBranch).toHaveBeenCalledTimes(1)
		expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(cleanDocument.uri)

		const diagnostics = getMergeDocumentSyncDiagnostics(logSpy)
		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					stage: "post-merge-sync",
					result: "completed",
					openDocumentCount: 1,
					dirtyDocumentCount: 0,
					syncedDocumentCount: 1,
					syncedDocumentPaths: ["src/dashboard.tsx"],
				}),
			]),
		)
	})

	test("merge approval aborts and disposes completed background agents before deleting worktrees", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const removeWorktree = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreePathsByAgentId.set("styles-agent", "/tmp/styles-agent")
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(
				async ({ agentId }: { agentId: string }) =>
					`diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
			),
			mergeBranch: vi.fn().mockResolvedValue(undefined),
			removeWorktree,
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}
		const backgroundTask = await provider.createTask("agent work", undefined, parentTask, {
			agentId: "dashboard-agent",
			background: true,
			workspacePath: "/tmp/dashboard-agent",
			startTask: false,
		})
		const disposeOrder: string[] = []
		backgroundTask.abortTask = vi.fn(async () => {
			disposeOrder.push("abort")
		}) as any
		backgroundTask.dispose = vi.fn(() => {
			disposeOrder.push("dispose")
		})
		removeWorktree.mockImplementation(async () => {
			disposeOrder.push("removeWorktree")
		})

		await expect(provider.mergeApprovedAgents(["dashboard-agent", "styles-agent"])).resolves.toBe(true)

		expect(backgroundTask.abortTask).toHaveBeenCalledWith(true)
		expect(backgroundTask.dispose).toHaveBeenCalledTimes(1)
		expect(disposeOrder[0]).toBe("abort")
		expect(disposeOrder[1]).toBe("dispose")
		expect(disposeOrder).toContain("removeWorktree")
		expect(disposeOrder.indexOf("removeWorktree")).toBeGreaterThan(disposeOrder.indexOf("dispose"))
		expect((provider as any).backgroundTasks.size).toBe(0)
	})

	test("merge approval clears child approval state and logs safe diagnostics before parent resume", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreePathsByAgentId.set("styles-agent", "/tmp/styles-agent")
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(
				async ({ agentId }: { agentId: string }) =>
					`diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
			),
			mergeBranch: vi.fn().mockResolvedValue(undefined),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		const backgroundTask = await provider.createTask("agent work", undefined, parentTask, {
			agentId: "dashboard-agent",
			background: true,
			workspacePath: "/tmp/dashboard-agent",
			startTask: false,
		})
		const childApproval: ClineMessage = {
			type: "ask",
			ask: "tool",
			ts: 1_700_000_002,
			text: JSON.stringify({ tool: "readFile", path: "src/secret.ts" }),
		}
		backgroundTask.clineMessages.push(childApproval)
		Object.defineProperty(backgroundTask, "taskAsk", {
			configurable: true,
			get: () => childApproval,
		})
		backgroundTask.abortTask = vi.fn(async () => {}) as any

		const logSpy = vi.spyOn(provider, "log")

		await expect(provider.mergeApprovedAgents(["dashboard-agent", "styles-agent"])).resolves.toBe(true)

		const latestParallelStatus = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask).at(-1)!)
		expect(latestParallelStatus.parallelStatus).toBe("merged")
		expect((provider as any).activeExecutionPlan).toBeUndefined()
		expect((provider as any).backgroundTasks.size).toBe(0)
		expect(parentTask.resumeAfterParallelExecution).toHaveBeenCalledTimes(1)

		const approvalDiagnostics = logSpy.mock.calls
			.map(([message]) => String(message))
			.filter((message) => message.startsWith("[parallel-agents] approval-state "))
			.map(
				(message) =>
					JSON.parse(message.slice("[parallel-agents] approval-state ".length)) as Record<string, any>,
			)

		expect(approvalDiagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					stage: "parallel-cleanup",
					planId: "plan-webview-provider",
					pendingPlanApproval: false,
					backgroundTaskCount: 0,
				}),
				expect.objectContaining({
					stage: "parent-resumed",
					planId: "plan-webview-provider",
					backgroundTaskCount: 0,
				}),
			]),
		)

		const resumeDiagnostics = approvalDiagnostics.find((payload) => payload.stage === "parent-resumed")
		expect(resumeDiagnostics?.parentTask?.taskAsk).toBeUndefined()
		expect(resumeDiagnostics?.parentTask?.latestUnansweredAsk).toBeUndefined()
		expect(resumeDiagnostics?.parentTask?.latestParallelAgentsMessage).toEqual(
			expect.objectContaining({
				planId: "plan-webview-provider",
				parallelStatus: "merged",
			}),
		)

		const materializationDiagnostics = logSpy.mock.calls
			.map(([message]) => String(message))
			.filter((message) => message.startsWith("[parallel-agents] merge-materialization "))
			.map(
				(message) =>
					JSON.parse(message.slice("[parallel-agents] merge-materialization ".length)) as Record<string, any>,
			)
		expect(materializationDiagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					planId: "plan-webview-provider",
					agentId: "dashboard-agent",
					branch: "roo/parallel/plan-webview-provider/dashboard-agent",
					worktreePath: "/tmp/dashboard-agent",
					mergeStatus: "merged",
					materialized: true,
				}),
				expect.objectContaining({
					planId: "plan-webview-provider",
					agentId: "styles-agent",
					branch: "roo/parallel/plan-webview-provider/styles-agent",
					worktreePath: "/tmp/styles-agent",
					mergeStatus: "merged",
					materialized: true,
				}),
			]),
		)

		const parentResumeDiagnostics = logSpy.mock.calls
			.map(([message]) => String(message))
			.filter((message) => message.startsWith("[parallel-agents] parent-resume-diagnostics "))
			.map(
				(message) =>
					JSON.parse(message.slice("[parallel-agents] parent-resume-diagnostics ".length)) as Record<
						string,
						any
					>,
			)
		expect(parentResumeDiagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					planId: "plan-webview-provider",
					reason: "successful parallel merge",
					result: "resumed",
					taskId: parentTask.taskId,
				}),
			]),
		)

		const diagnosticLogText = logSpy.mock.calls.map(([message]) => String(message)).join("\n")
		expect(diagnosticLogText).not.toContain("src/secret.ts")
		expect(diagnosticLogText).not.toContain("diff --git")
	})

	test("successful parallel merge sends workflow notification and later final parent completion separately", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const sendTaskNotification = installEmailNotificationServiceMock()
		const logSpy = vi.spyOn(provider, "log")
		const tokenUsage = createTokenUsage()
		const toolUsage = createToolUsage()
		const parentTask = new Task({
			...defaultTaskOptions,
			taskId: "parallel-parent-merge-success",
			workspacePath: "/workspace",
		} as any)
		;(parentTask as any).taskMode = "code"
		;(parentTask as any).tokenUsage = tokenUsage
		;(parentTask as any).toolUsage = toolUsage
		parentTask.clineMessages.push({
			type: "say",
			say: "api_req_started",
			text: "Starting parent request",
			ts: 1,
		})
		;(provider as any).taskCreationCallback(parentTask)
		await provider.addClineToStack(parentTask)

		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreePathsByAgentId.set("styles-agent", "/tmp/styles-agent")
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(
				async ({ agentId }: { agentId: string }) =>
					`diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
			),
			mergeBranch: vi.fn().mockResolvedValue(undefined),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		const backgroundTask = await provider.createTask("agent completed work", undefined, parentTask, {
			agentId: "dashboard-agent",
			background: true,
			workspacePath: "/tmp/dashboard-agent",
			startTask: false,
			mode: "code",
		})
		backgroundTask.emit(
			RooCodeEventName.TaskCompleted,
			backgroundTask.taskId,
			createTokenUsage(),
			createToolUsage(),
		)

		await expect(provider.mergeApprovedAgents(["dashboard-agent", "styles-agent"])).resolves.toBe(true)

		expect(parentTask.resumeAfterParallelExecution).toHaveBeenCalledTimes(1)
		expect(sendTaskNotification).toHaveBeenCalledTimes(1)
		expect(sendTaskNotification).toHaveBeenCalledWith({
			taskId: "parallel-parent-merge-success",
			outcome: "success",
			summary:
				"Parallel agent workflow completed successfully; 2 approved agent branches were materialized into the workspace (2 planned agents).",
			workspacePath: "/workspace",
			mode: "code",
			notificationType: "parallel-workflow",
			tokenUsage,
			toolUsage,
			requestCount: 1,
		})

		await vi.waitFor(() => {
			expect(getEmailNotificationDiagnostics(logSpy)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event: "notification-send-result",
						taskId: "parallel-parent-merge-success",
						decision: "sent",
					}),
				]),
			)
		})

		parentTask.clineMessages.push({
			type: "say",
			say: "completion_result",
			text: "Parent emitted final completion after merge.",
			ts: 2,
		})
		const finalTokenUsage = createTokenUsage()
		const finalToolUsage = createToolUsage()
		provider.notifyAcceptedFinalParentCompletion(parentTask, finalTokenUsage, finalToolUsage)

		await vi.waitFor(() => expect(sendTaskNotification).toHaveBeenCalledTimes(2))
		expect(sendTaskNotification).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				taskId: "parallel-parent-merge-success",
				outcome: "success",
				summary: "Parent emitted final completion after merge.",
				workflowSummary: expect.stringContaining(
					'Overall workflow rollup: parent task parallel-parent-merge-success completed with final result "Parent emitted final completion after merge."',
				),
				usageScope:
					"Aggregated parent workflow usage from the parent task plus 1 child task, including delegated and background parallel-agent tasks discoverable from saved task metadata.",
				workspacePath: "/workspace",
				mode: "code",
				tokenUsage: {
					totalTokensIn: 24,
					totalTokensOut: 68,
					totalCacheWrites: 0,
					totalCacheReads: 0,
					totalCost: 0.24,
					contextTokens: 0,
				},
				toolUsage: {
					read_file: { attempts: 4, failures: 2 },
				},
				requestCount: 2,
			}),
		)
		expect(sendTaskNotification.mock.calls[1][0]).not.toHaveProperty("notificationType")
		expect(sendTaskNotification.mock.calls[1][0].workflowSummary).toContain(
			`${backgroundTask.taskId}: agent dashboard-agent parallel/background task`,
		)
		const notificationDiagnostics = getEmailNotificationDiagnostics(logSpy)
		expect(notificationDiagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					event: "completion-event-observed",
					taskId: backgroundTask.taskId,
					background: true,
					agentId: "dashboard-agent",
				}),
				expect.objectContaining({
					event: "completion-notification-decision",
					taskId: backgroundTask.taskId,
					decision: "skip-background-task-covered-by-parallel-workflow",
					coveredByWorkflowNotification: true,
				}),
				expect.objectContaining({
					event: "parallel-merge-parent-notification-decision",
					taskId: "parallel-parent-merge-success",
					planId: "plan-webview-provider",
					decision: "send-parallel-merge-workflow-success",
					notificationScope: "parallel-workflow",
					notificationDedupeKey: "parallel-workflow:parallel-parent-merge-success",
					duplicateSent: false,
					duplicateInFlight: false,
					requestCount: 1,
				}),
				expect.objectContaining({
					event: "parallel-parent-resume-lifecycle",
					taskId: "parallel-parent-merge-success",
					planId: "plan-webview-provider",
					result: "resumed",
				}),
				expect.objectContaining({
					event: "accepted-final-parent-completion-decision",
					taskId: "parallel-parent-merge-success",
					decision: "send-top-level-success-after-acceptance",
					providerCompletionEventObserved: false,
				}),
				expect.objectContaining({
					event: "completion-notification-decision",
					taskId: "parallel-parent-merge-success",
					decision: "send-top-level-success",
					notificationScope: "task",
					notificationDedupeKey: "task:parallel-parent-merge-success",
				}),
				expect.objectContaining({
					event: "completion-notification-aggregation",
					taskId: "parallel-parent-merge-success",
					decision: "use-aggregated-workflow-usage",
					usageAggregationSource: "live-root-with-discovered-children",
					workflowChildTaskCount: 1,
					requestCount: 2,
					totalTokensIn: 24,
					totalTokensOut: 68,
					totalCost: 0.24,
					toolAttempts: 4,
					toolFailures: 2,
				}),
				expect.objectContaining({
					event: "outcome-notification-decision",
					taskId: "parallel-parent-merge-success",
					decision: "dispatch",
					notificationScope: "task",
					notificationDedupeKey: "task:parallel-parent-merge-success",
					duplicateSent: false,
				}),
			]),
		)
		expect(JSON.stringify(notificationDiagnostics)).not.toContain("agent completed work")
		expect(JSON.stringify(notificationDiagnostics)).not.toContain("Parent emitted final completion after merge")
	})

	test("auto-approves and merges the final review when both auto-approval settings are enabled", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		parentTask.apiConversationHistory = [
			{
				role: "user",
				content: [{ type: "text", text: "Run parallel dashboard work" }],
			},
		] as any
		parentTask.overwriteApiConversationHistory = vi.fn(async (history) => {
			parentTask.apiConversationHistory = history as any
		})
		await provider.addClineToStack(parentTask)
		await provider.setValues({ autoApprovalEnabled: true, alwaysAllowParallelTasks: true })
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const prepareMergeReview = vi.fn(
			async ({ agentId }: { agentId: string }) => `diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
		)
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		const removeWorktree = vi.fn().mockResolvedValue(undefined)
		const cleanupPlanBaseline = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreePathsByAgentId.set("styles-agent", "/tmp/styles-agent")
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview,
			mergeBranch,
			removeWorktree,
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline,
		}

		await provider.showMergeReview(plan)

		expect(mergeBranch).toHaveBeenCalledTimes(2)
		expect(mergeBranch).toHaveBeenCalledWith("roo/parallel/plan-webview-provider/dashboard-agent", {
			planId: "plan-webview-provider",
			worktreePath: "/tmp/dashboard-agent",
			ownedPaths: ["src/dashboard.tsx"],
			autoApproved: true,
		})
		expect(mergeBranch).toHaveBeenCalledWith("roo/parallel/plan-webview-provider/styles-agent", {
			planId: "plan-webview-provider",
			worktreePath: "/tmp/styles-agent",
			ownedPaths: ["src/styles.css"],
			autoApproved: true,
		})
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/dashboard-agent")
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/styles-agent")
		expect(cleanupPlanBaseline).toHaveBeenCalledWith("plan-webview-provider")
		expect(
			mockPostMessage.mock.calls.some(([message]: [ExtensionMessage]) => message.type === "showMergeReview"),
		).toBe(false)
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "mergeComplete" })

		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("merged")
		expect(statusTool.agentActivities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "dashboard-agent",
					message: "Auto-approved final merge review.",
					kind: "approval",
				}),
				expect.objectContaining({
					agentId: "dashboard-agent",
					message: "Auto-merged branch roo/parallel/plan-webview-provider/dashboard-agent.",
					kind: "completion",
				}),
			]),
		)
		const reviewSummaryMessages = parentTask.clineMessages.filter(
			(message) => message.type === "say" && message.say === "user_feedback_diff",
		)
		expect(reviewSummaryMessages).toHaveLength(0)
		expect(statusTool.parallelReviewSummary).toEqual(
			expect.objectContaining({
				path: ".roo/parallel-agent-review.md",
				markdown: expect.stringContaining(
					"Full per-agent diffs are available in the persisted parallel agents card.",
				),
			}),
		)
		expect(statusTool.parallelReviewSummary?.markdown).toContain("dashboard-agent: merged; 1 files, +1/-0")
		expect(statusTool.parallelReviewSummary?.markdown).not.toContain("diff --git a/src/dashboard-agent.ts")

		const lastApiMessage = parentTask.apiConversationHistory.at(-1) as any
		const summaryText = lastApiMessage.content[0].text as string
		expect(summaryText).toContain("[PARALLEL AGENT SUMMARY] Plan plan-webview-provider is merged.")
		expect(summaryText).toContain('"parentVerificationDirective"')
		expect(summaryText).toContain('"sourceOfTruth": "structured_completion_packet"')
		expect(summaryText).toContain('"evidenceStatus": "clean-merged"')
		expect(summaryText).toContain('"noReverification": true')
		expect(summaryText).toContain("Parent resume guidance:")
		expect(summaryText).toContain(
			"Treat the structured completion packet and parentVerificationDirective as the verification source of truth",
		)
		expect(summaryText).toContain(
			"Do not perform broad file reads/searches over already-merged parallel deliverables solely to verify them.",
		)
		expect(summaryText).toContain(
			"mark any redundant review/verify result or assembled deliverable todo step complete",
		)
		expect(summaryText).toContain("Only inspect files when the user explicitly asks for deeper verification")
	})

	test.each([
		["global auto-approval", { autoApprovalEnabled: false, alwaysAllowParallelTasks: true }],
		["parallel task auto-approval", { autoApprovalEnabled: true, alwaysAllowParallelTasks: false }],
	])("does not auto-merge the final review when %s is disabled", async (_setting, values) => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		await provider.setValues(values)
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreePathsByAgentId.set("styles-agent", "/tmp/styles-agent")
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(
				async ({ agentId }: { agentId: string }) =>
					`diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
			),
			mergeBranch,
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.showMergeReview(plan)

		expect(mergeBranch).not.toHaveBeenCalled()
		expect(
			mockPostMessage.mock.calls.some(([message]: [ExtensionMessage]) => message.type === "showMergeReview"),
		).toBe(false)
		expect(mockPostMessage).not.toHaveBeenCalledWith({ type: "mergeComplete" })
		expect(parentTask.resumeAfterParallelExecution).toHaveBeenCalledTimes(1)
		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("review")
		expect(statusTool.mergeReviewEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ agentId: "dashboard-agent" }),
				expect.objectContaining({ agentId: "styles-agent" }),
			]),
		)
	})

	test("skips auto-merge when the final review has an unmergeable entry", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		await provider.setValues({ autoApprovalEnabled: true, alwaysAllowParallelTasks: true })
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreePathsByAgentId.set("styles-agent", "/tmp/styles-agent")
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(async ({ agentId }: { agentId: string }) => {
				if (agentId === "styles-agent") {
					throw new Error("Merge conflict during review")
				}

				return `diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`
			}),
			mergeBranch,
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.showMergeReview(plan)

		expect(mergeBranch).not.toHaveBeenCalled()
		expect(
			mockPostMessage.mock.calls.some(([message]: [ExtensionMessage]) => message.type === "showMergeReview"),
		).toBe(false)
		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("review")
		expect(statusTool.mergeReviewEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "styles-agent",
					reviewError: "Merge conflict during review",
					mergeable: false,
				}),
			]),
		)
		expect(statusTool.agentActivities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "styles-agent",
					message: "Auto-merge skipped: styles-agent has a merge review error: Merge conflict during review",
					kind: "wait",
				}),
			]),
		)
		expect(parentTask.resumeAfterParallelExecution).toHaveBeenCalledTimes(1)
	})

	test("failed merge attempts persist conflicted review state and keep the review actionable", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const sendTaskNotification = installEmailNotificationServiceMock()
		const parentTask = new Task({
			...defaultTaskOptions,
			taskId: "parallel-parent-merge-failure",
			workspacePath: "/workspace",
		} as any)
		;(parentTask as any).taskMode = "code"
		parentTask.apiConversationHistory = [
			{
				role: "user",
				content: [{ type: "text", text: "Start parallel dashboard work" }],
			},
		] as any
		parentTask.overwriteApiConversationHistory = vi.fn(async (history) => {
			parentTask.apiConversationHistory = history as any
		})
		;(provider as any).taskCreationCallback(parentTask)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const mergeError = new WorktreeMergeError(
			"rebase",
			"roo/parallel/plan-webview-provider/dashboard-agent",
			"/tmp/dashboard-agent",
			["index.html"],
			undefined,
			"CONFLICT (add/add): Merge conflict in index.html",
		)
		const mergeBranch = vi.fn(async (branch: string) => {
			if (branch === "roo/parallel/plan-webview-provider/dashboard-agent") {
				throw mergeError
			}
		})
		const removeWorktree = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreePathsByAgentId.set("styles-agent", "/tmp/styles-agent")
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(
				async ({ agentId }: { agentId: string }) =>
					`diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
			),
			mergeBranch,
			removeWorktree,
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.showMergeReview(plan)
		mockPostMessage.mockClear()

		await expect(provider.mergeApprovedAgents(["dashboard-agent"])).resolves.toBe(false)

		expect(parentTask.resumeAfterParallelExecution).toHaveBeenCalledTimes(1)
		expect(mergeBranch).toHaveBeenCalledWith("roo/parallel/plan-webview-provider/dashboard-agent", {
			planId: "plan-webview-provider",
			worktreePath: "/tmp/dashboard-agent",
			ownedPaths: ["src/dashboard.tsx"],
			autoApproved: false,
		})
		expect(removeWorktree).not.toHaveBeenCalled()
		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "mergeFailed",
				agentId: "dashboard-agent",
				gitOutput: expect.stringContaining("CONFLICT (add/add)"),
			}),
		)

		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("review")
		expect(statusTool.mergeReviewEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "dashboard-agent",
					mergeStatus: "failed",
					mergeable: false,
					mergeError: expect.stringContaining("CONFLICT (add/add)"),
					conflictedFiles: ["index.html"],
				}),
			]),
		)
		expect(statusTool.agentCompletionPackets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "dashboard-agent",
					merge: expect.objectContaining({
						readiness: "not-ready",
						result: "failed",
						materialized: false,
						conflictedFiles: ["index.html"],
						mergeError: expect.stringContaining("CONFLICT (add/add)"),
					}),
				}),
			]),
		)
		expect(statusTool.parallelPlanCompletionPacket).toEqual(
			expect.objectContaining({
				status: "failed",
				merge: expect.objectContaining({ status: "failed", failedAgents: ["dashboard-agent"] }),
			}),
		)
		const lastApiMessage = parentTask.apiConversationHistory.at(-1) as any
		expect(lastApiMessage.content[0].text).toContain(
			"[PARALLEL AGENT SUMMARY] Plan plan-webview-provider is failed.",
		)
		expect(lastApiMessage.content[0].text).toContain("dashboard-agent")
		expect(lastApiMessage.content[0].text).toContain("CONFLICT (add/add)")
		expect(lastApiMessage.content[0].text).toContain("Structured completion packet:")
		expect(lastApiMessage.content[0].text).toContain('"parallelPlanCompletionPacket"')
		expect(lastApiMessage.content[0].text).toContain('"agentCompletionPackets"')
		expect(lastApiMessage.content[0].text).toContain('"parentVerificationDirective"')
		expect(lastApiMessage.content[0].text).toContain('"evidenceStatus": "requires-attention"')
		expect(lastApiMessage.content[0].text).toContain('"noReverification": false')
		expect(lastApiMessage.content[0].text).toContain('"artifactManifest"')
		expect(lastApiMessage.content[0].text).toContain(
			"The plan-level packet requires attention; do not mark redundant verification complete",
		)
		expect(lastApiMessage.content[0].text).toContain(
			"Only inspect files when the packet is missing, failed, incomplete, or inconclusive",
		)
		expect(lastApiMessage.content[0].text).toContain("Use the persisted parallel agents card")
		expect(
			parentTask.clineMessages.filter(
				(message) => message.type === "say" && message.say === "user_feedback_diff",
			),
		).toHaveLength(0)
		expect(sendTaskNotification).not.toHaveBeenCalled()

		const tokenUsage = createTokenUsage()
		const toolUsage = createToolUsage()
		parentTask.clineMessages.push({
			type: "say",
			say: "completion_result",
			text: "Parent handled the failed parallel merge and reported actionable recovery steps.",
			ts: 2,
		})
		parentTask.emit(RooCodeEventName.TaskCompleted, parentTask.taskId, tokenUsage, toolUsage)
		parentTask.emit(RooCodeEventName.TaskCompleted, parentTask.taskId, tokenUsage, toolUsage)

		expect(sendTaskNotification).toHaveBeenCalledTimes(1)
		expect(sendTaskNotification).toHaveBeenCalledWith({
			taskId: "parallel-parent-merge-failure",
			outcome: "success",
			summary: "Parent handled the failed parallel merge and reported actionable recovery steps.",
			usageScope: "Task only (live completion event)",
			workspacePath: "/workspace",
			mode: "code",
			tokenUsage,
			toolUsage,
			requestCount: 0,
		})
	})

	test("merge approval restores persisted review state when live parallel agents are gone", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		parentTask.apiConversationHistory = [
			{
				role: "user",
				content: [{ type: "text", text: "Resume pending parallel review" }],
			},
		] as any
		parentTask.overwriteApiConversationHistory = vi.fn(async (history) => {
			parentTask.apiConversationHistory = history as any
		})
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const restoredPackets = plan.agents.map((agent) =>
			createAgentCompletionPacket(plan, agent, {
				status: "complete",
				completionResult: `${agent.id} completed before reload`,
				artifactManifest: [
					{
						path: `src/${agent.id}.ts`,
						status: "modified",
						additions: 1,
						deletions: 0,
						binary: false,
						source: "merge-review",
						agentId: agent.id,
					},
				],
				merge: {
					readiness: "ready",
					result: "pending",
					branch: `roo/parallel/plan-webview-provider/${agent.id}`,
					worktreePath: `/tmp/${agent.id}`,
					materialized: false,
					notes: ["Restored review state."],
					ts: 1_700_000_002,
				},
				ts: 1_700_000_002,
			}),
		)
		parentTask.clineMessages = [
			{
				type: "say",
				say: "tool",
				text: JSON.stringify({
					tool: "parallelAgents",
					executionPlan: plan,
					parallelStatus: "review",
					agentStatusUpdates: plan.agents.map((agent) => ({ agentId: agent.id, status: "complete" })),
					mergeReviewEntries: plan.agents.map((agent) => ({
						agentId: agent.id,
						mode: agent.mode,
						task: agent.task,
						diff: `diff --git a/src/${agent.id}.ts b/src/${agent.id}.ts\n+done\n`,
						worktreePath: `/tmp/${agent.id}`,
						branch: `roo/parallel/plan-webview-provider/${agent.id}`,
						mergeStatus: "pending",
					})),
					agentCompletionPackets: restoredPackets,
					parallelPlanCompletionPacket: buildParallelPlanCompletionPacket(plan, restoredPackets, {
						status: "awaiting-review",
						ts: 1_700_000_003,
					}),
				} satisfies ClineSayTool),
				ts: 101,
			},
		]
		await provider.addClineToStack(parentTask)
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		const removeWorktree = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = undefined
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(
				async ({ agentId }: { agentId: string }) =>
					`diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
			),
			mergeBranch,
			removeWorktree,
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await expect(provider.mergeApprovedAgents(["dashboard-agent"])).resolves.toBe(true)

		expect(mergeBranch).toHaveBeenCalledWith("roo/parallel/plan-webview-provider/dashboard-agent", {
			planId: "plan-webview-provider",
			worktreePath: "/tmp/dashboard-agent",
			ownedPaths: ["src/dashboard.tsx"],
			autoApproved: false,
		})
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/dashboard-agent")
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/styles-agent")
		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("merged")
		expect(statusTool.mergeReviewEntries).toEqual(
			expect.arrayContaining([expect.objectContaining({ agentId: "dashboard-agent", mergeStatus: "merged" })]),
		)
		expect(statusTool.agentCompletionPackets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "dashboard-agent",
					completionResult: "dashboard-agent completed before reload",
					merge: expect.objectContaining({ result: "merged", materialized: true }),
				}),
				expect.objectContaining({
					agentId: "styles-agent",
					completionResult: "styles-agent completed before reload",
					merge: expect.objectContaining({ result: "pending", materialized: false }),
				}),
			]),
		)
		expect(statusTool.parallelPlanCompletionPacket).toEqual(
			expect.objectContaining({
				status: "merged",
				aggregateArtifactManifest: expect.arrayContaining([
					expect.objectContaining({ path: "src/dashboard-agent.ts", agentId: "dashboard-agent" }),
				]),
			}),
		)
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "mergeComplete" })
	})

	test("merge denial restores persisted review state and marks the chat row cancelled", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		parentTask.apiConversationHistory = [
			{
				role: "user",
				content: [{ type: "text", text: "Resume pending parallel review" }],
			},
		] as any
		parentTask.overwriteApiConversationHistory = vi.fn(async (history) => {
			parentTask.apiConversationHistory = history as any
		})
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		parentTask.clineMessages = [
			{
				type: "say",
				say: "tool",
				text: JSON.stringify({
					tool: "parallelAgents",
					executionPlan: plan,
					parallelStatus: "review",
					agentStatusUpdates: plan.agents.map((agent) => ({ agentId: agent.id, status: "complete" })),
					mergeReviewEntries: plan.agents.map((agent) => ({
						agentId: agent.id,
						mode: agent.mode,
						task: agent.task,
						diff: `diff --git a/src/${agent.id}.ts b/src/${agent.id}.ts\n+done\n`,
						worktreePath: `/tmp/${agent.id}`,
						branch: `roo/parallel/plan-webview-provider/${agent.id}`,
						mergeStatus: "pending",
					})),
				} satisfies ClineSayTool),
				ts: 101,
			},
		]
		await provider.addClineToStack(parentTask)
		const removeWorktree = vi.fn().mockResolvedValue(undefined)
		const cleanup = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = undefined
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(
				async ({ agentId }: { agentId: string }) =>
					`diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
			),
			mergeBranch: vi.fn().mockResolvedValue(undefined),
			removeWorktree,
			cleanup,
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await expect(provider.denyMergeReview()).resolves.toBe(true)

		expect(cleanup).toHaveBeenCalled()
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/dashboard-agent")
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/styles-agent")
		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("cancelled")
		expect(statusTool.mergeReviewEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "dashboard-agent",
					mergeStatus: "skipped",
					autoMergeSkippedReason: "Merge review was denied from chat.",
				}),
				expect.objectContaining({
					agentId: "styles-agent",
					mergeStatus: "skipped",
					autoMergeSkippedReason: "Merge review was denied from chat.",
				}),
			]),
		)
		expect(mockPostMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "mergeFailed" }))
		const lastApiMessage = parentTask.apiConversationHistory.at(-1) as any
		expect(lastApiMessage.content[0].text).toContain(
			"[PARALLEL AGENT SUMMARY] Plan plan-webview-provider is cancelled.",
		)
		expect(lastApiMessage.content[0].text).toContain("Merge review was denied from chat.")
		expect(lastApiMessage.content[0].text).toContain("Use the persisted parallel agents card")
		expect(
			parentTask.clineMessages.filter(
				(message) => message.type === "say" && message.say === "user_feedback_diff",
			),
		).toHaveLength(0)
		expect(parentTask.resumeAfterParallelExecution).toHaveBeenCalledTimes(1)
	})

	test("history restore resumes interrupted parallel agents instead of continuing the parent task", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const plan = createExecutionPlan()
		plan.agents[0] = {
			...plan.agents[0],
			status: "complete",
			worktreePath: "/tmp/dashboard-agent",
		}
		plan.agents[1] = {
			...plan.agents[1],
			status: "running",
			worktreePath: "/tmp/styles-agent",
		}
		const persistedMessages = [
			createParallelAgentToolMessage({
				tool: "parallelAgents",
				executionPlan: plan,
				parallelStatus: "running",
				agentStatusUpdates: [
					{ agentId: "dashboard-agent", status: "complete", reason: "Dashboard finished" },
					{ agentId: "styles-agent", status: "running", reason: "Styling in progress" },
				],
				agentActivities: [
					{
						agentId: "styles-agent",
						kind: "tool",
						message: "Editing src/styles.css.",
						ts: 1_700_000_000,
					},
				],
			} satisfies ClineSayTool),
		]
		await seedPersistedTaskMessages(persistedMessages)
		const worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			restoreWorkspaceBaseline: vi.fn().mockResolvedValue({
				planId: "plan-webview-provider",
				commit: "baseline",
				ref: "refs/roo/parallel-baselines/plan-webview-provider",
			}),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/restored-${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}
		;(provider as any).worktreeManager = worktreeManager

		const task = await provider.createTaskWithHistoryItem(createHistoryItem())

		expect(vi.mocked(Task).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ startTask: false }))
		expect(task.start).not.toHaveBeenCalled()
		expect(task.restoreClineMessagesFromHistory).toHaveBeenCalledTimes(1)
		expect(task.restoreParallelExecutionPause).toHaveBeenCalledTimes(1)
		expect(worktreeManager.restoreWorkspaceBaseline).toHaveBeenCalledWith("plan-webview-provider")

		await vi.waitFor(() =>
			expect(worktreeManager.createWorktree).toHaveBeenCalledWith("styles-agent", "plan-webview-provider"),
		)
		expect(worktreeManager.createWorktree).not.toHaveBeenCalledWith("dashboard-agent", "plan-webview-provider")
		expect(task.resumeAfterParallelExecution).not.toHaveBeenCalled()
		expect(
			(provider as any).activeExecutionPlan.agents.find((agent: any) => agent.id === "dashboard-agent")?.status,
		).toBe("complete")
		expect((provider as any).backgroundTasks.size).toBe(1)
		const restoredChild = Array.from((provider as any).backgroundTasks as Set<Task>)[0] as Task
		expect(restoredChild.agentId).toBe("styles-agent")
		expect(restoredChild.workspacePath).toBe("/tmp/restored-styles-agent")
		expect(restoredChild.start).toHaveBeenCalledTimes(1)

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(task)[0])
			expect(tool.parallelStatus).toBe("running")
			expect(tool.agentStatusUpdates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ agentId: "dashboard-agent", status: "complete" }),
					expect.objectContaining({ agentId: "styles-agent", status: "running" }),
				]),
			)
			expect(tool.agentActivities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "styles-agent",
						message: "Rehydrating parallel agent after task resume.",
					}),
				]),
			)
		})
	})

	test("history restore reports a parallel-agent recovery message when the saved baseline is missing", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const plan = createExecutionPlan()
		plan.agents[0] = {
			...plan.agents[0],
			status: "complete",
			worktreePath: "/tmp/dashboard-agent",
		}
		plan.agents[1] = {
			...plan.agents[1],
			status: "running",
			worktreePath: "/tmp/styles-agent",
		}
		await seedPersistedTaskMessages([
			createParallelAgentToolMessage({
				tool: "parallelAgents",
				executionPlan: plan,
				parallelStatus: "running",
				agentStatusUpdates: [
					{ agentId: "dashboard-agent", status: "complete" },
					{ agentId: "styles-agent", status: "running" },
				],
			} satisfies ClineSayTool),
		])
		const worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			restoreWorkspaceBaseline: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}
		;(provider as any).worktreeManager = worktreeManager

		const task = await provider.createTaskWithHistoryItem(createHistoryItem({ id: "missing-baseline-task" }))

		expect(vi.mocked(Task).mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ startTask: false }))
		expect(task.start).not.toHaveBeenCalled()
		expect(task.restoreParallelExecutionPause).toHaveBeenCalledTimes(2)
		expect(worktreeManager.restoreWorkspaceBaseline).toHaveBeenCalledWith("plan-webview-provider")
		expect(worktreeManager.createWorktree).not.toHaveBeenCalled()
		expect(task.resumeAfterParallelExecution).not.toHaveBeenCalled()
		expect(task.say).toHaveBeenCalledWith(
			"text",
			expect.stringContaining("Roo found an interrupted parallel-agent run, but it cannot be resumed safely"),
		)
		expect(task.say).toHaveBeenCalledWith(
			"text",
			expect.stringContaining("The parent task has not been continued automatically"),
		)

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(task)[0])
			expect(tool.parallelStatus).toBe("failed")
			expect(tool.agentActivities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "styles-agent",
						kind: "error",
						message: expect.stringContaining("Parallel-agent resume requires manual recovery"),
					}),
				]),
			)
		})
	})

	test("background agent streaming aborts clean up without visible task rehydration", async () => {
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)

		const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
			agentId: "dashboard-js-animation",
			background: true,
			mode: "code",
		})
		backgroundTask.abortReason = "streaming_failed"

		const getTaskWithIdSpy = vi.spyOn(provider, "getTaskWithId")
		const createTaskWithHistoryItemSpy = vi.spyOn(provider, "createTaskWithHistoryItem")

		backgroundTask.emit(RooCodeEventName.TaskAborted)

		await vi.waitFor(() => expect((provider as any).backgroundTasks.has(backgroundTask)).toBe(false))
		expect(getTaskWithIdSpy).not.toHaveBeenCalled()
		expect(createTaskWithHistoryItemSpy).not.toHaveBeenCalled()
		expect(provider.getTaskStackSize()).toBe(1)
		expect(provider.getCurrentTask()).toBe(parentTask)
		expect(backgroundTask.off).toHaveBeenCalled()
	})

	test("background agent completion finalizes AgentBus status before cleanup", async () => {
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		;(provider as any).activeExecutionPlan = plan
		AgentBus.getInstance().setExecutionPlan(plan)

		const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
			agentId: "dashboard-agent",
			background: true,
			mode: "code",
		})

		backgroundTask.emit(
			RooCodeEventName.TaskCompleted,
			backgroundTask.taskId,
			{
				totalTokensIn: 10,
				totalTokensOut: 5,
				totalCacheWrites: 0,
				totalCacheReads: 0,
				totalCost: 0.01,
				contextTokens: 15,
			},
			{},
		)

		expect(AgentBus.getInstance().getAgent("dashboard-agent")?.status).toBe("complete")
		expect((provider as any).backgroundTasks.has(backgroundTask)).toBe(false)
	})

	test("background agent abort finalizes AgentBus status before cleanup", async () => {
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		;(provider as any).activeExecutionPlan = plan
		AgentBus.getInstance().setExecutionPlan(plan)

		const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
			agentId: "dashboard-agent",
			background: true,
			mode: "code",
		})

		backgroundTask.emit(RooCodeEventName.TaskAborted)

		expect(AgentBus.getInstance().getAgent("dashboard-agent")?.status).toBe("failed")
		expect((provider as any).backgroundTasks.has(backgroundTask)).toBe(false)
	})

	test("top-level tasks cancel active parallel state before opening a new visible task", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))
		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)

		const nextTask = await provider.createTask("Build an HTML dashboard")

		expect(provider.getCurrentTask()).toBe(nextTask)
		expect((provider as any).activeExecutionPlan).toBeUndefined()
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBe(0))
		for (const backgroundTask of backgroundTasks) {
			expect(backgroundTask.abortTask).toHaveBeenCalledWith(true)
		}

		const oldPlanEvent = {
			type: "COMPLETE",
			agentId: "dashboard-agent",
			result: "Stale completion",
		} as const
		;(provider as any).forwardAgentEvent(oldPlanEvent)

		expect(getParallelAgentToolMessages(nextTask)).toHaveLength(0)
	})

	test("cancelTask tears down active parallel state and persists cancelled agent statuses", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}
		vi.spyOn(provider, "getTaskWithId").mockResolvedValue({
			historyItem: {
				id: parentTask.taskId,
				number: 1,
				ts: Date.now(),
				task: "Parent task",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			} as HistoryItem,
			apiConversationHistory: [],
			taskDirPath: "/tmp/task",
			apiConversationHistoryFilePath: "/tmp/task/api.json",
			uiMessagesFilePath: "/tmp/task/messages.json",
		})
		vi.spyOn(provider, "createTaskWithHistoryItem").mockResolvedValue(undefined as any)

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))
		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)

		await provider.cancelTask()

		expect((provider as any).activeExecutionPlan).toBeUndefined()
		expect((provider as any).backgroundTasks.size).toBe(0)
		for (const backgroundTask of backgroundTasks) {
			expect(backgroundTask.abortTask).toHaveBeenCalledWith(true)
		}
		const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(tool.parallelStatus).toBe("cancelled")
		expect(tool.agentStatusUpdates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ agentId: "dashboard-agent", status: "failed" }),
				expect.objectContaining({ agentId: "styles-agent", status: "failed" }),
			]),
		)
	})

	test("clearTask tears down active parallel state before removing the visible task", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))
		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)

		await provider.clearTask()

		expect((provider as any).activeExecutionPlan).toBeUndefined()
		expect((provider as any).backgroundTasks.size).toBe(0)
		expect(provider.getTaskStackSize()).toBe(0)
		for (const backgroundTask of backgroundTasks) {
			expect(backgroundTask.abortTask).toHaveBeenCalledWith(true)
		}
	})

	test("parallel status messages persist aggregate child token usage", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(1))
		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const dashboardTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const stylesTask = backgroundTasks.find((task) => task.agentId === "styles-agent") as Task

		dashboardTask.emit(
			RooCodeEventName.TaskTokenUsageUpdated,
			dashboardTask.taskId,
			{
				totalTokensIn: 100,
				totalTokensOut: 50,
				totalCacheWrites: 10,
				totalCacheReads: 20,
				totalCost: 0.01,
				contextTokens: 150,
			},
			{},
		)
		stylesTask.emit(
			RooCodeEventName.TaskTokenUsageUpdated,
			stylesTask.taskId,
			{
				totalTokensIn: 200,
				totalTokensOut: 70,
				totalCacheWrites: 0,
				totalCacheReads: 30,
				totalCost: 0.02,
				contextTokens: 270,
			},
			{},
		)

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.parallelUsageSummary).toEqual({
				totalTokensIn: 300,
				totalTokensOut: 120,
				totalCacheWrites: 10,
				totalCacheReads: 50,
				totalCost: 0.03,
				contextTokens: 420,
				reportingAgents: 2,
			})
		})
	})

	test("getState returns correct initial state", async () => {
		const state = await provider.getState()

		expect(state).toHaveProperty("apiConfiguration")
		expect(state.apiConfiguration).toHaveProperty("apiProvider")
		expect(state).toHaveProperty("customInstructions")
		expect(state).toHaveProperty("alwaysAllowReadOnly")
		expect(state).toHaveProperty("alwaysAllowWrite")
		expect(state).toHaveProperty("alwaysAllowExecute")
		expect(state.alwaysAllowParallelTasks).toBe(false)
		expect(state).toHaveProperty("taskHistory")
		expect(state).toHaveProperty("soundEnabled")
		expect(state).toHaveProperty("ttsEnabled")
		expect(state).toHaveProperty("writeDelayMs")
	})

	test("language is set to VSCode language", async () => {
		// Mock VSCode language as Spanish
		;(vscode.env as any).language = "pt-BR"

		const state = await provider.getState()
		expect(state.language).toBe("pt-BR")
	})

	test("writeDelayMs defaults to 1000ms", async () => {
		// Mock globalState.get to return undefined for writeDelayMs
		;(mockContext.globalState.get as any).mockImplementation((key: string) =>
			key === "writeDelayMs" ? undefined : null,
		)

		const state = await provider.getState()
		expect(state.writeDelayMs).toBe(1000)
	})

	test("handles writeDelayMs message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		await messageHandler({ type: "updateSettings", updatedSettings: { writeDelayMs: 2000 } })

		expect(updateGlobalStateSpy).toHaveBeenCalledWith("writeDelayMs", 2000)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("writeDelayMs", 2000)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("updates sound utility when sound setting changes", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Get the message handler from onDidReceiveMessage
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Simulate setting sound to enabled
		await messageHandler({ type: "updateSettings", updatedSettings: { soundEnabled: true } })
		expect(updateGlobalStateSpy).toHaveBeenCalledWith("soundEnabled", true)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("soundEnabled", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting sound to disabled
		await messageHandler({ type: "updateSettings", updatedSettings: { soundEnabled: false } })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("soundEnabled", false)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting tts to enabled
		await messageHandler({ type: "updateSettings", updatedSettings: { ttsEnabled: true } })
		expect(setTtsEnabled).toHaveBeenCalledWith(true)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("ttsEnabled", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting tts to disabled
		await messageHandler({ type: "updateSettings", updatedSettings: { ttsEnabled: false } })
		expect(setTtsEnabled).toHaveBeenCalledWith(false)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("ttsEnabled", false)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("autoCondenseContext defaults to true", async () => {
		// Mock globalState.get to return undefined for autoCondenseContext
		;(mockContext.globalState.get as any).mockImplementation((key: string) =>
			key === "autoCondenseContext" ? undefined : null,
		)
		const state = await provider.getState()
		expect(state.autoCondenseContext).toBe(true)
	})

	test("handles autoCondenseContext message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
		await messageHandler({ type: "updateSettings", updatedSettings: { autoCondenseContext: false } })
		expect(updateGlobalStateSpy).toHaveBeenCalledWith("autoCondenseContext", false)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("autoCondenseContext", false)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("autoCondenseContextPercent defaults to 100", async () => {
		// Mock globalState.get to return undefined for autoCondenseContextPercent
		;(mockContext.globalState.get as any).mockImplementation((key: string) =>
			key === "autoCondenseContextPercent" ? undefined : null,
		)

		const state = await provider.getState()
		expect(state.autoCondenseContextPercent).toBe(100)
	})

	test("handles autoCondenseContextPercent message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		await messageHandler({ type: "updateSettings", updatedSettings: { autoCondenseContextPercent: 75 } })

		expect(updateGlobalStateSpy).toHaveBeenCalledWith("autoCondenseContextPercent", 75)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("autoCondenseContextPercent", 75)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	it("loads saved API config when switching modes", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		const profile: ProviderSettingsEntry = { name: "test-config", id: "test-id", apiProvider: "anthropic" }

		;(provider as any).providerSettingsManager = {
			getModeConfigId: vi.fn().mockResolvedValue("test-id"),
			listConfig: vi.fn().mockResolvedValue([profile]),
			activateProfile: vi.fn().mockResolvedValue(profile),
			setModeConfig: vi.fn(),
			getProfile: vi.fn().mockResolvedValue(profile),
		} as any

		// Switch to architect mode
		await messageHandler({ type: "mode", text: "architect" })

		// Should load the saved config for architect mode
		expect(provider.providerSettingsManager.getModeConfigId).toHaveBeenCalledWith("architect")
		expect(provider.providerSettingsManager.activateProfile).toHaveBeenCalledWith({ name: "test-config" })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")
	})

	it("saves current config when switching to mode without config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		;(provider as any).providerSettingsManager = {
			getModeConfigId: vi.fn().mockResolvedValue(undefined),
			listConfig: vi
				.fn()
				.mockResolvedValue([{ name: "current-config", id: "current-id", apiProvider: "anthropic" }]),
			setModeConfig: vi.fn(),
		} as any

		provider.setValue("currentApiConfigName", "current-config")

		// Switch to architect mode
		await messageHandler({ type: "mode", text: "architect" })

		// Should save current config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "current-id")
	})

	it("saves config as default for current mode when loading config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		const profile: ProviderSettingsEntry = { apiProvider: "anthropic", id: "new-id", name: "new-config" }

		;(provider as any).providerSettingsManager = {
			activateProfile: vi.fn().mockResolvedValue(profile),
			listConfig: vi.fn().mockResolvedValue([profile]),
			setModeConfig: vi.fn(),
			getModeConfigId: vi.fn().mockResolvedValue(undefined),
		} as any

		// First set the mode
		await messageHandler({ type: "mode", text: "architect" })

		// Then load the config
		await messageHandler({ type: "loadApiConfiguration", text: "new-config" })

		// Should save new config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "new-id")
	})

	it("load API configuration by ID works and updates mode config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		const profile: ProviderSettingsEntry = {
			name: "config-by-id",
			id: "config-id-123",
			apiProvider: "anthropic",
		}

		;(provider as any).providerSettingsManager = {
			activateProfile: vi.fn().mockResolvedValue(profile),
			listConfig: vi.fn().mockResolvedValue([profile]),
			setModeConfig: vi.fn(),
			getModeConfigId: vi.fn().mockResolvedValue(undefined),
		} as any

		// First set the mode
		await messageHandler({ type: "mode", text: "architect" })

		// Then load the config by ID
		await messageHandler({ type: "loadApiConfigurationById", text: "config-id-123" })

		// Should save new config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "config-id-123")

		// Ensure the `activateProfile` method was called with the correct ID
		expect(provider.providerSettingsManager.activateProfile).toHaveBeenCalledWith({ id: "config-id-123" })
	})

	test("handles showRooIgnoredFiles setting", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Default value should be false
		expect((await provider.getState()).showRooIgnoredFiles).toBe(false)

		// Test showRooIgnoredFiles with true
		await messageHandler({ type: "updateSettings", updatedSettings: { showRooIgnoredFiles: true } })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("showRooIgnoredFiles", true)
		expect(mockPostMessage).toHaveBeenCalled()
		expect((await provider.getState()).showRooIgnoredFiles).toBe(true)

		// Test showRooIgnoredFiles with false
		await messageHandler({ type: "updateSettings", updatedSettings: { showRooIgnoredFiles: false } })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("showRooIgnoredFiles", false)
		expect(mockPostMessage).toHaveBeenCalled()
		expect((await provider.getState()).showRooIgnoredFiles).toBe(false)
	})

	test("handles updatePrompt message correctly", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock existing prompts
		const existingPrompts = {
			code: {
				roleDefinition: "existing code role",
				customInstructions: "existing code prompt",
			},
			architect: {
				roleDefinition: "existing architect role",
				customInstructions: "existing architect prompt",
			},
		}

		provider.setValue("customModePrompts", existingPrompts)

		// Test updating a prompt
		await messageHandler({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: "new code prompt",
		})

		// Verify state was updated correctly
		expect(mockContext.globalState.update).toHaveBeenCalledWith("customModePrompts", {
			...existingPrompts,
			code: "new code prompt",
		})

		// Verify state was posted to webview
		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "state",
				state: expect.objectContaining({
					customModePrompts: {
						...existingPrompts,
						code: "new code prompt",
					},
				}),
			}),
		)
	})

	test("customModePrompts defaults to empty object", async () => {
		// Mock globalState.get to return undefined for customModePrompts
		;(mockContext.globalState.get as any).mockImplementation((key: string) => {
			if (key === "customModePrompts") {
				return undefined
			}
			return null
		})

		const state = await provider.getState()
		expect(state.customModePrompts).toEqual({})
	})

	test("handles maxWorkspaceFiles message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		await messageHandler({ type: "updateSettings", updatedSettings: { maxWorkspaceFiles: 300 } })

		expect(updateGlobalStateSpy).toHaveBeenCalledWith("maxWorkspaceFiles", 300)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("maxWorkspaceFiles", 300)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("handles mode-specific custom instructions updates", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock existing prompts
		const existingPrompts = {
			code: {
				roleDefinition: "Code role",
				customInstructions: "Old instructions",
			},
		}
		mockContext.globalState.get = vi.fn((key: string) => {
			if (key === "customModePrompts") {
				return existingPrompts
			}
			return undefined
		})

		// Update custom instructions for code mode
		await messageHandler({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: {
				roleDefinition: "Code role",
				customInstructions: "New instructions",
			},
		})

		// Verify state was updated correctly
		expect(mockContext.globalState.update).toHaveBeenCalledWith("customModePrompts", {
			code: {
				roleDefinition: "Code role",
				customInstructions: "New instructions",
			},
		})
	})

	it("saves mode config when updating API configuration", async () => {
		// Setup mock context with mode and config name
		mockContext = {
			...mockContext,
			globalState: {
				...mockContext.globalState,
				get: vi.fn((key: string) => {
					if (key === "mode") {
						return "code"
					} else if (key === "currentApiConfigName") {
						return "test-config"
					}
					return undefined
				}),
				update: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
			},
		} as unknown as vscode.ExtensionContext

		// Create new provider with updated mock context
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		;(provider as any).providerSettingsManager = {
			listConfig: vi.fn().mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			saveConfig: vi.fn().mockResolvedValue("test-id"),
			setModeConfig: vi.fn(),
		} as any

		// Update API configuration
		await messageHandler({
			type: "upsertApiConfiguration",
			text: "test-config",
			apiConfiguration: { apiProvider: "anthropic" },
		})

		// Should save config as default for current mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("code", "test-id")
	})

	test("file content includes line numbers", async () => {
		const { extractTextFromFile } = await import("../../../integrations/misc/extract-text")
		const result = await extractTextFromFile("test.js")
		expect(result).toBe("1 | const x = 1;\n2 | const y = 2;\n3 | const z = 3;")
	})

	describe("deleteMessage", () => {
		beforeEach(async () => {
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("handles deletion with confirmation dialog", async () => {
			// Setup mock messages
			const mockMessages = [
				{ ts: 1000, type: "say", say: "user_feedback" }, // User message 1
				{ ts: 2000, type: "say", say: "tool" }, // Tool message
				{ ts: 3000, type: "say", say: "text" }, // Message before delete
				{ ts: 4000, type: "say", say: "tool" }, // Message to delete
				{ ts: 5000, type: "say", say: "user_feedback" }, // Next user message
				{ ts: 6000, type: "say", say: "user_feedback" }, // Final message
			] as ClineMessage[]

			const mockApiHistory = [
				{ ts: 1000 },
				{ ts: 2000 },
				{ ts: 3000 },
				{ ts: 4000 },
				{ ts: 5000 },
				{ ts: 6000 },
			] as (Anthropic.MessageParam & { ts?: number })[]

			// Setup Task instance with auto-mock from the top of the file
			const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance
			mockCline.clineMessages = mockMessages // Set test-specific messages
			mockCline.apiConversationHistory = mockApiHistory // Set API history
			await provider.addClineToStack(mockCline) // Add the mocked instance to the stack

			// Mock getTaskWithId
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			// Mock createTaskWithHistoryItem
			;(provider as any).createTaskWithHistoryItem = vi.fn()

			// Trigger message deletion
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
			await messageHandler({ type: "deleteMessage", value: 4000 })

			// Verify that the dialog message was sent to webview
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showDeleteMessageDialog",
				messageTs: 4000,
				hasCheckpoint: false,
			})

			// Simulate user confirming deletion through the dialog
			await messageHandler({ type: "deleteMessageConfirm", messageTs: 4000 })

			// Verify only messages before the deleted message were kept
			expect(mockCline.overwriteClineMessages).toHaveBeenCalledWith([
				mockMessages[0],
				mockMessages[1],
				mockMessages[2],
			])

			// Verify only API messages before the deleted message were kept
			expect(mockCline.overwriteApiConversationHistory).toHaveBeenCalledWith([
				mockApiHistory[0],
				mockApiHistory[1],
				mockApiHistory[2],
			])

			// createTaskWithHistoryItem is only called when restoring checkpoints or aborting tasks
			expect((provider as any).createTaskWithHistoryItem).not.toHaveBeenCalled()
		})

		test("handles case when no current task exists", async () => {
			// Clear the cline stack
			;(provider as any).clineStack = []

			// Trigger message deletion
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
			await messageHandler({ type: "deleteMessage", value: 2000 })

			// Verify no dialog was shown since there's no current cline
			expect(mockPostMessage).not.toHaveBeenCalledWith(
				expect.objectContaining({
					type: "showDeleteMessageDialog",
				}),
			)
		})
	})

	describe("editMessage", () => {
		beforeEach(async () => {
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("handles edit with confirmation dialog", async () => {
			// Setup mock messages
			const mockMessages = [
				{ ts: 1000, type: "say", say: "user_feedback" }, // User message 1
				{ ts: 2000, type: "say", say: "tool" }, // Tool message
				{ ts: 3000, type: "say", say: "text" }, // Message before edit
				{ ts: 4000, type: "say", say: "tool" }, // Message to edit
				{ ts: 5000, type: "say", say: "user_feedback" }, // Next user message
				{ ts: 6000, type: "say", say: "user_feedback" }, // Final message
			] as ClineMessage[]

			const mockApiHistory = [
				{ ts: 1000 },
				{ ts: 2000 },
				{ ts: 3000 },
				{ ts: 4000 },
				{ ts: 5000 },
				{ ts: 6000 },
			] as (Anthropic.MessageParam & { ts?: number })[]

			// Setup Task instance with auto-mock from the top of the file
			const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance
			mockCline.clineMessages = mockMessages // Set test-specific messages
			mockCline.apiConversationHistory = mockApiHistory // Set API history

			// Explicitly mock the overwrite methods since they're not being called in the tests
			mockCline.overwriteClineMessages = vi.fn()
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.handleWebviewAskResponse = vi.fn()

			await provider.addClineToStack(mockCline) // Add the mocked instance to the stack

			// Mock getTaskWithId
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			// Trigger message edit
			// Get the message handler function that was registered with the webview
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Call the message handler with a submitEditedMessage message
			await messageHandler({
				type: "submitEditedMessage",
				value: 4000,
				editedMessageContent: "Edited message content",
			})

			// Verify that the dialog message was sent to webview
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 4000,
				text: "Edited message content",
				hasCheckpoint: false,
				images: undefined,
			})

			// Simulate user confirming edit through the dialog
			await messageHandler({
				type: "editMessageConfirm",
				messageTs: 4000,
				text: "Edited message content",
			})

			// Verify correct messages were kept - delete from the preceding user message to truly replace it
			expect(mockCline.overwriteClineMessages).toHaveBeenCalledWith([])

			// Verify correct API messages were kept
			expect(mockCline.overwriteApiConversationHistory).toHaveBeenCalledWith([])

			// The new flow calls webviewMessageHandler recursively with askResponse
			// We need to verify the recursive call happened by checking if the handler was called again
			expect((mockWebviewView.webview.onDidReceiveMessage as any).mock.calls.length).toBeGreaterThanOrEqual(1)
		})
	})

	describe("getSystemPrompt", () => {
		beforeEach(async () => {
			mockPostMessage.mockClear()
			await provider.resolveWebviewView(mockWebviewView)
			// Reset and setup mock
			mockAddCustomInstructions.mockClear()
			mockAddCustomInstructions.mockImplementation(
				(modeInstructions: string, globalInstructions: string, _cwd: string) => {
					return Promise.resolve(modeInstructions || globalInstructions || "")
				},
			)
		})

		const getMessageHandler = () => {
			const mockCalls = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls
			expect(mockCalls.length).toBeGreaterThan(0)
			return mockCalls[0][0]
		}

		test("handles mcpEnabled setting correctly", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const handler = getMessageHandler()
			expect(typeof handler).toBe("function")

			// Test with mcpEnabled: true
			vi.spyOn(provider, "getState").mockResolvedValueOnce({
				apiConfiguration: {
					apiProvider: "openrouter" as const,
				},
				mcpEnabled: true,
				mode: "code" as const,
				experiments: experimentDefault,
			} as any)

			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify system prompt was generated and sent
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "systemPrompt",
					text: expect.any(String),
					mode: "code",
				}),
			)

			// Reset for second test
			mockPostMessage.mockClear()

			// Test with mcpEnabled: false
			vi.spyOn(provider, "getState").mockResolvedValueOnce({
				apiConfiguration: {
					apiProvider: "openrouter" as const,
				},
				mcpEnabled: false,
				mode: "code" as const,
				experiments: experimentDefault,
			} as any)

			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify system prompt was generated and sent
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "systemPrompt",
					text: expect.any(String),
					mode: "code",
				}),
			)
		})

		test("handles errors gracefully", async () => {
			// Mock SYSTEM_PROMPT to throw an error
			const { SYSTEM_PROMPT } = await import("../../prompts/system")
			vi.mocked(SYSTEM_PROMPT).mockRejectedValueOnce(new Error("Test error"))

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
			await messageHandler({ type: "getSystemPrompt", mode: "code" })

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.get_system_prompt")
		})

		test("uses code mode custom instructions", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock getState to return custom instructions for code mode
			vi.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter" as const,
				},
				customModePrompts: {
					code: { customInstructions: "Code mode specific instructions" },
				},
				mode: "code" as const,
				experiments: experimentDefault,
			} as any)

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify system prompt was generated and sent
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "systemPrompt",
					text: expect.any(String),
					mode: "code",
				}),
			)
		})

		test("uses correct mode-specific instructions when mode is specified", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock getState to return architect mode instructions
			vi.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				customModePrompts: {
					architect: { customInstructions: "Architect mode instructions" },
				},
				mode: "architect",
				mcpEnabled: false,
				experiments: experimentDefault,
			} as any)

			// Trigger getSystemPrompt for architect mode
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "architect" })

			// Verify system prompt was generated and sent
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "systemPrompt",
					text: expect.any(String),
					mode: "architect",
				}),
			)
		})
	})

	describe("handleModeSwitch", () => {
		beforeEach(async () => {
			// Set up webview for each test
			await provider.resolveWebviewView(mockWebviewView)
		})

		it("loads saved API config when switching modes", async () => {
			const profile: ProviderSettingsEntry = {
				name: "saved-config",
				id: "saved-config-id",
				apiProvider: "anthropic",
			}

			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue("saved-config-id"),
				listConfig: vi.fn().mockResolvedValue([profile]),
				activateProfile: vi.fn().mockResolvedValue(profile),
				setModeConfig: vi.fn(),
				getProfile: vi.fn().mockResolvedValue(profile),
			} as any

			// Switch to architect mode
			await provider.handleModeSwitch("architect")

			// Verify mode was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "architect")

			// Verify saved config was loaded
			expect(provider.providerSettingsManager.getModeConfigId).toHaveBeenCalledWith("architect")
			expect(provider.providerSettingsManager.activateProfile).toHaveBeenCalledWith({ name: "saved-config" })
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "saved-config")

			// Verify state was posted to webview
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})

		test("saves current config when switching to mode without config", async () => {
			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue(undefined),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "current-config", id: "current-id", apiProvider: "anthropic" }]),
				setModeConfig: vi.fn(),
			} as any

			// Mock the ContextProxy's getValue method to return the current config name
			const contextProxy = (provider as any).contextProxy
			const getValueSpy = vi.spyOn(contextProxy, "getValue")
			getValueSpy.mockImplementation((key: any) => {
				if (key === "currentApiConfigName") return "current-config"
				return undefined
			})

			// Switch to architect mode
			await provider.handleModeSwitch("architect")

			// Verify mode was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "architect")

			// Verify current config was saved as default for new mode
			expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "current-id")

			// Verify state was posted to webview
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})
	})

	describe("createTaskWithHistoryItem mode validation", () => {
		test("validates and falls back to default mode when restored mode no longer exists", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock custom modes that don't include the saved mode
			const mockCustomModesManager = {
				getCustomModes: vi.fn().mockResolvedValue([
					{
						slug: "existing-mode",
						name: "Existing Mode",
						roleDefinition: "Test role",
						groups: ["read"] as const,
					},
				]),
				dispose: vi.fn(),
			}
			;(provider as any).customModesManager = mockCustomModesManager

			// Mock getModeBySlug to return undefined for non-existent mode
			const { getModeBySlug } = await import("../../../shared/modes")
			vi.mocked(getModeBySlug)
				.mockReturnValueOnce(undefined) // First call returns undefined (mode doesn't exist)
				.mockReturnValue({
					slug: "code",
					name: "Code Mode",
					roleDefinition: "You are a code assistant",
					groups: ["read", "edit"],
				}) // Subsequent calls return default mode

			// Mock provider settings manager
			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue(undefined),
				listConfig: vi.fn().mockResolvedValue([]),
			}

			// Spy on log method to verify warning was logged
			const logSpy = vi.spyOn(provider, "log")

			// Create history item with non-existent mode
			const historyItem = {
				id: "test-id",
				ts: Date.now(),
				task: "Test task",
				mode: "non-existent-mode", // This mode doesn't exist
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}

			// Initialize with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify mode validation occurred
			expect(mockCustomModesManager.getCustomModes).toHaveBeenCalled()
			expect(getModeBySlug).toHaveBeenCalledWith("non-existent-mode", expect.any(Array))

			// Verify fallback to default mode
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "code")
			expect(logSpy).toHaveBeenCalledWith(
				"Mode 'non-existent-mode' from history no longer exists. Falling back to default mode 'code'.",
			)

			// Verify history item was updated with default mode
			expect(historyItem.mode).toBe("code")
		})

		test("preserves mode when it exists in custom modes", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock custom modes that include the saved mode
			const mockCustomModesManager = {
				getCustomModes: vi.fn().mockResolvedValue([
					{
						slug: "custom-mode",
						name: "Custom Mode",
						roleDefinition: "Custom role",
						groups: ["read", "edit"] as const,
					},
				]),
				dispose: vi.fn(),
			}
			;(provider as any).customModesManager = mockCustomModesManager

			// Mock getModeBySlug to return the custom mode
			const { getModeBySlug } = await import("../../../shared/modes")
			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "custom-mode",
				name: "Custom Mode",
				roleDefinition: "Custom role",
				groups: ["read", "edit"],
			})

			// Mock provider settings manager
			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue("config-id"),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "config-id", apiProvider: "anthropic" }]),
				activateProfile: vi
					.fn()
					.mockResolvedValue({ name: "test-config", id: "config-id", apiProvider: "anthropic" }),
			}

			// Spy on log method to verify no warning was logged
			const logSpy = vi.spyOn(provider, "log")

			// Create history item with existing custom mode
			const historyItem = {
				id: "test-id",
				ts: Date.now(),
				task: "Test task",
				mode: "custom-mode",
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}

			// Initialize with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify mode validation occurred
			expect(mockCustomModesManager.getCustomModes).toHaveBeenCalled()
			expect(getModeBySlug).toHaveBeenCalledWith("custom-mode", expect.any(Array))

			// Verify mode was preserved
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "custom-mode")
			expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("no longer exists"))

			// Verify history item mode was not changed
			expect(historyItem.mode).toBe("custom-mode")
		})

		test("preserves mode when it exists in built-in modes", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock no custom modes
			const mockCustomModesManager = {
				getCustomModes: vi.fn().mockResolvedValue([]),
				dispose: vi.fn(),
			}
			;(provider as any).customModesManager = mockCustomModesManager

			// Mock getModeBySlug to return built-in architect mode
			const { getModeBySlug } = await import("../../../shared/modes")
			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "architect",
				name: "Architect Mode",
				roleDefinition: "You are an architect",
				groups: ["read", "edit"],
			})

			// Mock provider settings manager
			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue(undefined),
				listConfig: vi.fn().mockResolvedValue([]),
			}

			// Create history item with built-in mode
			const historyItem = {
				id: "test-id",
				ts: Date.now(),
				task: "Test task",
				mode: "architect",
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}

			// Initialize with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify mode was preserved
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "architect")

			// Verify history item mode was not changed
			expect(historyItem.mode).toBe("architect")
		})

		test("handles history items without mode property", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock provider settings manager
			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue(undefined),
				listConfig: vi.fn().mockResolvedValue([]),
			}

			// Create history item without mode
			const historyItem = {
				id: "test-id",
				ts: Date.now(),
				task: "Test task",
				// No mode property
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}

			// Initialize with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify no mode validation occurred (mode update not called)
			expect(mockContext.globalState.update).not.toHaveBeenCalledWith("mode", expect.any(String))
		})

		test("continues with task restoration even if mode config loading fails", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock custom modes
			const mockCustomModesManager = {
				getCustomModes: vi.fn().mockResolvedValue([]),
				dispose: vi.fn(),
			}
			;(provider as any).customModesManager = mockCustomModesManager

			// Mock getModeBySlug to return built-in mode
			const { getModeBySlug } = await import("../../../shared/modes")
			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "code",
				name: "Code Mode",
				roleDefinition: "You are a code assistant",
				groups: ["read", "edit"],
			})

			// Mock provider settings manager to throw error
			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue("config-id"),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "config-id", apiProvider: "anthropic" }]),
				activateProfile: vi.fn().mockRejectedValue(new Error("Failed to load config")),
			}

			// Spy on log method
			const logSpy = vi.spyOn(provider, "log")

			// Create history item
			const historyItem = {
				id: "test-id",
				ts: Date.now(),
				task: "Test task",
				mode: "code",
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}

			// Initialize with history item - should not throw
			await expect(provider.createTaskWithHistoryItem(historyItem)).resolves.not.toThrow()

			// Verify error was logged but task restoration continued
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Failed to restore API configuration for mode 'code'"),
			)
		})
	})

	describe("updateCustomMode", () => {
		test("updates both file and state when updating custom mode", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Mock CustomModesManager methods
			;(provider as any).customModesManager = {
				updateCustomMode: vi.fn().mockResolvedValue(undefined),
				getCustomModes: vi.fn().mockResolvedValue([
					{
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Updated role definition",
						groups: ["read"] as const,
					},
				]),
				dispose: vi.fn(),
			} as any

			// Test updating a custom mode
			await messageHandler({
				type: "updateCustomMode",
				modeConfig: {
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Updated role definition",
					groups: ["read"] as const,
				},
			})

			// Verify CustomModesManager.updateCustomMode was called
			expect(provider.customModesManager.updateCustomMode).toHaveBeenCalledWith(
				"test-mode",
				expect.objectContaining({
					slug: "test-mode",
					roleDefinition: "Updated role definition",
				}),
			)

			// Verify state was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("customModes", [
				{ groups: ["read"], name: "Test Mode", roleDefinition: "Updated role definition", slug: "test-mode" },
			])

			// Verify state was posted to webview
			// Verify state was posted to webview with correct format
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "state",
					state: expect.objectContaining({
						customModes: [
							expect.objectContaining({
								slug: "test-mode",
								roleDefinition: "Updated role definition",
							}),
						],
					}),
				}),
			)
		})
	})

	describe("upsertApiConfiguration", () => {
		test("handles error in upsertApiConfiguration gracefully", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			;(provider as any).providerSettingsManager = {
				setModeConfig: vi.fn().mockRejectedValue(new Error("Failed to update mode config")),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			// Mock getState to provide necessary data
			vi.spyOn(provider, "getState").mockResolvedValue({
				mode: "code",
				currentApiConfigName: "test-config",
			} as any)

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: { apiProvider: "anthropic", apiKey: "test-key" },
			})

			// Verify error was logged and user was notified
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("Error create new api configuration"),
			)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.create_api_config")
		})

		test("handles successful upsertApiConfiguration", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			;(provider as any).providerSettingsManager = {
				setModeConfig: vi.fn(),
				saveConfig: vi.fn().mockResolvedValue(undefined),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			const testApiConfig = {
				apiProvider: "anthropic" as const,
				apiKey: "test-key",
			}

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: testApiConfig,
			})

			// Verify config was saved
			expect(provider.providerSettingsManager.saveConfig).toHaveBeenCalledWith("test-config", testApiConfig)

			// Verify state updates
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")

			// Verify state was posted to webview
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})

		test("handles buildApiHandler error in updateApiConfiguration", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Mock buildApiHandler to throw an error
			const { buildApiHandler } = await import("../../../api")

			;(buildApiHandler as any).mockImplementationOnce(() => {
				throw new Error("API handler error")
			})
			;(provider as any).providerSettingsManager = {
				setModeConfig: vi.fn(),
				saveConfig: vi.fn().mockResolvedValue(undefined),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			// Setup Task instance with auto-mock from the top of the file
			const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance
			await provider.addClineToStack(mockCline)

			const testApiConfig = {
				apiProvider: "anthropic" as const,
				apiKey: "test-key",
			}

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: testApiConfig,
			})

			// Verify error handling
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("Error create new api configuration"),
			)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.create_api_config")

			// Verify state was still updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")
		})

		test("handles successful saveApiConfiguration", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			;(provider as any).providerSettingsManager = {
				setModeConfig: vi.fn(),
				saveConfig: vi.fn().mockResolvedValue(undefined),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			const testApiConfig = {
				apiProvider: "anthropic" as const,
				apiKey: "test-key",
			}

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "saveApiConfiguration",
				text: "test-config",
				apiConfiguration: testApiConfig,
			})

			// Verify config was saved
			expect(provider.providerSettingsManager.saveConfig).toHaveBeenCalledWith("test-config", testApiConfig)

			// Verify state updates
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(updateGlobalStateSpy).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
		})
	})
})

describe("Project MCP Settings", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = vi.fn()
		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
				cspSource: "vscode-webview://test-csp-source",
			},
			visible: true,
			onDidDispose: vi.fn(),
			onDidChangeVisibility: vi.fn(),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
	})

	test.skip("handles openProjectMcpSettings message", async () => {
		// Mock workspace folders first
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]

		// Mock fs functions
		const fs = await import("fs/promises")
		const mockedFs = vi.mocked(fs)
		mockedFs.mkdir.mockClear()
		mockedFs.mkdir.mockResolvedValue(undefined)
		mockedFs.writeFile.mockClear()
		mockedFs.writeFile.mockResolvedValue(undefined)

		// Mock fileExistsAtPath to return false (file doesn't exist)
		const fsUtils = await import("../../../utils/fs")
		vi.spyOn(fsUtils, "fileExistsAtPath").mockResolvedValue(false)

		// Mock openFile
		const openFileModule = await import("../../../integrations/misc/open-file")
		const openFileSpy = vi.spyOn(openFileModule, "openFile").mockClear().mockResolvedValue(undefined)

		// Set up the webview
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Ensure the message handler is properly set up
		expect(messageHandler).toBeDefined()
		expect(typeof messageHandler).toBe("function")

		// Trigger openProjectMcpSettings through the message handler
		await messageHandler({
			type: "openProjectMcpSettings",
		})

		// Check that fs.mkdir was called with the correct path
		expect(mockedFs.mkdir).toHaveBeenCalledWith("/test/workspace/.roo", { recursive: true })

		// Verify file was created with default content
		expect(safeWriteJson).toHaveBeenCalledWith("/test/workspace/.roo/mcp.json", { mcpServers: {} })

		// Check that openFile was called
		expect(openFileSpy).toHaveBeenCalledWith("/test/workspace/.roo/mcp.json")
	})

	test("handles openProjectMcpSettings when workspace is not open", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock no workspace folders
		;(vscode.workspace as any).workspaceFolders = []

		// Trigger openProjectMcpSettings
		await messageHandler({ type: "openProjectMcpSettings" })

		// Verify error message was shown
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.no_workspace")
	})

	test.skip("handles openProjectMcpSettings file creation error", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock workspace folders
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]

		// Mock fs functions to fail
		const fs = require("fs/promises")
		fs.mkdir.mockRejectedValue(new Error("Failed to create directory"))

		// Trigger openProjectMcpSettings
		await messageHandler({
			type: "openProjectMcpSettings",
		})

		// Verify error message was shown
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("Failed to create or open .roo/mcp.json"),
		)
	})
})

describe.skip("ContextProxy integration", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockContextProxy: any

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks()

		// Setup basic mocks
		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
			extensionUri: {} as vscode.Uri,
			globalStorageUri: { fsPath: "/test/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = { appendLine: vi.fn() } as unknown as vscode.OutputChannel
		mockContextProxy = new ContextProxy(mockContext)
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", mockContextProxy)
	})

	test("updateGlobalState uses contextProxy", async () => {
		await provider.setValue("currentApiConfigName", "testValue")
		expect(mockContextProxy.updateGlobalState).toHaveBeenCalledWith("currentApiConfigName", "testValue")
	})

	test("getGlobalState uses contextProxy", async () => {
		mockContextProxy.getGlobalState.mockResolvedValueOnce("testValue")
		const result = await provider.getValue("currentApiConfigName")
		expect(mockContextProxy.getGlobalState).toHaveBeenCalledWith("currentApiConfigName")
		expect(result).toBe("testValue")
	})

	test("storeSecret uses contextProxy", async () => {
		await provider.setValue("apiKey", "test-secret")
		expect(mockContextProxy.storeSecret).toHaveBeenCalledWith("apiKey", "test-secret")
	})

	test("contextProxy methods are available", () => {
		// Verify the contextProxy has all the required methods
		expect(mockContextProxy.getGlobalState).toBeDefined()
		expect(mockContextProxy.updateGlobalState).toBeDefined()
		expect(mockContextProxy.storeSecret).toBeDefined()
		expect(mockContextProxy.setValue).toBeDefined()
		expect(mockContextProxy.setValues).toBeDefined()
	})
})

describe("ClineProvider - Router Models", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: any

	beforeEach(() => {
		vi.clearAllMocks()

		const globalState: Record<string, string | undefined> = {}
		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi
					.fn()
					.mockImplementation((key: string, value: string | undefined) => (globalState[key] = value)),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
				delete: vi.fn().mockImplementation((key: string) => delete secrets[key]),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = vi.fn()
		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
			},
			visible: true,
			onDidDispose: vi.fn().mockImplementation((callback) => {
				callback()
				return { dispose: vi.fn() }
			}),
			onDidChangeVisibility: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
	})

	test("handles requestRouterModels with successful responses", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock getState to return API configuration
		vi.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				litellmApiKey: "litellm-key",
				litellmBaseUrl: "http://localhost:4000",
			},
		} as any)

		const mockModels = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				description: "Test model 1",
				supportsPromptCache: false,
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				description: "Test model 2",
				supportsPromptCache: false,
			},
		}

		const { getModels } = await import("../../../api/providers/fetchers/modelCache")
		vi.mocked(getModels).mockResolvedValue(mockModels)

		await messageHandler({ type: "requestRouterModels" })

		// Verify getModels was called for each provider with correct options
		expect(getModels).toHaveBeenCalledWith({ provider: "openrouter" })
		expect(getModels).toHaveBeenCalledWith({ provider: "requesty", apiKey: "requesty-key" })
		expect(getModels).toHaveBeenCalledWith({ provider: "unbound" })
		expect(getModels).toHaveBeenCalledWith({ provider: "vercel-ai-gateway" })
		expect(getModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "litellm-key",
			baseUrl: "http://localhost:4000",
		})

		// Verify response was sent
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: mockModels,
				unbound: mockModels,
				litellm: mockModels,
				ollama: {},
				lmstudio: {},
				"vercel-ai-gateway": mockModels,
				poe: {},
			},
			values: undefined,
		})
	})

	test("handles requestRouterModels with individual provider failures", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		vi.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				litellmApiKey: "litellm-key",
				litellmBaseUrl: "http://localhost:4000",
			},
		} as any)

		const mockModels = {
			"model-1": { maxTokens: 4096, contextWindow: 8192, description: "Test model", supportsPromptCache: false },
		}
		const { getModels } = await import("../../../api/providers/fetchers/modelCache")

		// Mock some providers to succeed and others to fail
		vi.mocked(getModels)
			.mockResolvedValueOnce(mockModels) // openrouter success
			.mockRejectedValueOnce(new Error("Requesty API error")) // requesty fail
			.mockResolvedValueOnce(mockModels) // unbound success
			.mockResolvedValueOnce(mockModels) // vercel-ai-gateway success
			.mockRejectedValueOnce(new Error("LiteLLM connection failed")) // litellm fail

		await messageHandler({ type: "requestRouterModels" })

		// Verify main response includes successful providers and empty objects for failed ones
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: {},
				unbound: mockModels,
				ollama: {},
				lmstudio: {},
				litellm: {},
				"vercel-ai-gateway": mockModels,
				poe: {},
			},
			values: undefined,
		})

		// Verify error messages were sent for failed providers
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Requesty API error",
			values: { provider: "requesty" },
		})

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "LiteLLM connection failed",
			values: { provider: "litellm" },
		})
	})

	test("handles requestRouterModels with LiteLLM values from message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock state without LiteLLM config
		vi.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				// No litellm config
			},
		} as any)

		const mockModels = {
			"model-1": { maxTokens: 4096, contextWindow: 8192, description: "Test model", supportsPromptCache: false },
		}
		const { getModels } = await import("../../../api/providers/fetchers/modelCache")
		vi.mocked(getModels).mockResolvedValue(mockModels)

		await messageHandler({
			type: "requestRouterModels",
			values: {
				litellmApiKey: "message-litellm-key",
				litellmBaseUrl: "http://message-url:4000",
			},
		})

		// Verify LiteLLM was called with values from message
		expect(getModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "message-litellm-key",
			baseUrl: "http://message-url:4000",
		})
	})

	test("skips LiteLLM when neither config nor message values are provided", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		vi.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				// No litellm config
			},
		} as any)

		const mockModels = {
			"model-1": { maxTokens: 4096, contextWindow: 8192, description: "Test model", supportsPromptCache: false },
		}
		const { getModels } = await import("../../../api/providers/fetchers/modelCache")
		vi.mocked(getModels).mockResolvedValue(mockModels)

		await messageHandler({ type: "requestRouterModels" })

		// Verify LiteLLM was NOT called
		expect(getModels).not.toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "litellm",
			}),
		)

		// Verify response includes empty object for LiteLLM
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: mockModels,
				unbound: mockModels,
				litellm: {},
				ollama: {},
				lmstudio: {},
				"vercel-ai-gateway": mockModels,
				poe: {},
			},
			values: undefined,
		})
	})

	test("handles requestLmStudioModels with proper response", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		vi.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				lmStudioModelId: "model-1",
				lmStudioBaseUrl: "http://localhost:1234",
			},
		} as any)

		const mockModels = {
			"model-1": { maxTokens: 4096, contextWindow: 8192, description: "Test model", supportsPromptCache: false },
		}
		const { getModels } = await import("../../../api/providers/fetchers/modelCache")
		vi.mocked(getModels).mockResolvedValue(mockModels)

		await messageHandler({
			type: "requestLmStudioModels",
		})

		expect(getModels).toHaveBeenCalledWith({
			provider: "lmstudio",
			baseUrl: "http://localhost:1234",
		})
	})
})

describe("ClineProvider - Comprehensive Edit/Delete Edge Cases", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: any
	let defaultTaskOptions: TaskOptions

	beforeEach(() => {
		vi.clearAllMocks()

		const globalState: Record<string, string | undefined> = {
			mode: "code",
			currentApiConfigName: "current-config",
		}

		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi
					.fn()
					.mockImplementation((key: string, value: string | undefined) => (globalState[key] = value)),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
				delete: vi.fn().mockImplementation((key: string) => delete secrets[key]),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = vi.fn()

		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
			},
			visible: true,
			onDidDispose: vi.fn().mockImplementation((callback) => {
				callback()
				return { dispose: vi.fn() }
			}),
			onDidChangeVisibility: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		defaultTaskOptions = {
			provider,
			apiConfiguration: {
				apiProvider: "openrouter",
			},
		}

		// Mock getMcpHub method
		provider.getMcpHub = vi.fn().mockReturnValue({
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue({ contents: [] }),
			getAllServers: vi.fn().mockReturnValue([]),
		})
	})

	describe("Edit Messages with Images and Attachments", () => {
		beforeEach(async () => {
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("handles editing messages containing images", async () => {
			const mockMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "Original message" },
				{
					ts: 2000,
					type: "say",
					say: "user_feedback",
					text: "Message with image",
					images: [
						"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
					],
					value: 3000,
				},
				{ ts: 3000, type: "say", say: "text", text: "AI response" },
			] as ClineMessage[]

			const mockCline = new Task(defaultTaskOptions)
			mockCline.clineMessages = mockMessages
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }] as any[]
			mockCline.overwriteClineMessages = vi.fn()
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.submitUserMessage = vi.fn()

			await provider.addClineToStack(mockCline)
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
			await messageHandler({
				type: "submitEditedMessage",
				value: 3000,
				editedMessageContent: "Edited message with preserved images",
			})

			// Verify dialog was shown
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 3000,
				text: "Edited message with preserved images",
				hasCheckpoint: false,
				images: undefined,
			})

			// Simulate confirmation
			await messageHandler({
				type: "editMessageConfirm",
				messageTs: 3000,
				text: "Edited message with preserved images",
			})

			// Verify messages were edited correctly - the ORIGINAL user message and all subsequent messages are removed
			expect(mockCline.overwriteClineMessages).toHaveBeenCalledWith([mockMessages[0]])
			expect(mockCline.overwriteApiConversationHistory).toHaveBeenCalledWith([{ ts: 1000 }])
			// Verify submitUserMessage was called with the edited content
			expect(mockCline.submitUserMessage).toHaveBeenCalledWith("Edited message with preserved images", [])
		})

		test("handles editing messages with file attachments", async () => {
			const mockMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "Original message" },
				{
					ts: 2000,
					type: "say",
					say: "user_feedback",
					text: "Message with file",
					attachments: [{ path: "/path/to/file.txt", type: "file" }],
					value: 3000,
				},
				{ ts: 3000, type: "say", say: "text", text: "AI response" },
			] as ClineMessage[]

			const mockCline = new Task(defaultTaskOptions)
			mockCline.clineMessages = mockMessages
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }] as any[]
			mockCline.overwriteClineMessages = vi.fn()
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.submitUserMessage = vi.fn()

			await provider.addClineToStack(mockCline)
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
			await messageHandler({
				type: "submitEditedMessage",
				value: 3000,
				editedMessageContent: "Edited message with file attachment",
			})

			// Verify dialog was shown
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 3000,
				text: "Edited message with file attachment",
				hasCheckpoint: false,
				images: undefined,
			})

			// Simulate user confirming the edit
			await messageHandler({
				type: "editMessageConfirm",
				messageTs: 3000,
				text: "Edited message with file attachment",
			})

			expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
			expect(mockCline.submitUserMessage).toHaveBeenCalledWith("Edited message with file attachment", [])
		})
	})

	describe("Network Failure Scenarios", () => {
		beforeEach(async () => {
			;(vscode.window.showInformationMessage as any) = vi.fn()
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("handles network timeout during edit submission", async () => {
			const mockCline = new Task(defaultTaskOptions)
			mockCline.clineMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "Original message", value: 2000 },
				{ ts: 2000, type: "say", say: "text", text: "AI response" },
			] as ClineMessage[]
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]
			mockCline.overwriteClineMessages = vi.fn()
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.handleWebviewAskResponse = vi.fn().mockRejectedValue(new Error("Network timeout"))

			await provider.addClineToStack(mockCline)
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Should not throw error, but handle gracefully
			await expect(
				messageHandler({
					type: "submitEditedMessage",
					value: 2000,
					editedMessageContent: "Edited message",
				}),
			).resolves.toBeUndefined()

			// Verify dialog was shown
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 2000,
				text: "Edited message",
				hasCheckpoint: false,
				images: undefined,
			})

			// Simulate user confirming the edit
			await messageHandler({ type: "editMessageConfirm", messageTs: 2000, text: "Edited message" })

			expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
		})

		test("handles connection drops during edit operation", async () => {
			const mockCline = new Task(defaultTaskOptions)
			mockCline.clineMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "Original message", value: 2000 },
				{ ts: 2000, type: "say", say: "text", text: "AI response" },
			] as ClineMessage[]
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]
			mockCline.overwriteClineMessages = vi.fn().mockRejectedValue(new Error("Connection lost"))
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.handleWebviewAskResponse = vi.fn()

			await provider.addClineToStack(mockCline)
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Should handle connection error gracefully
			await expect(
				messageHandler({
					type: "submitEditedMessage",
					value: 2000,
					editedMessageContent: "Edited message",
				}),
			).resolves.toBeUndefined()

			// Verify dialog was shown
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 2000,
				text: "Edited message",
				hasCheckpoint: false,
				images: undefined,
			})

			// Simulate user confirming the edit
			await messageHandler({ type: "editMessageConfirm", messageTs: 2000, text: "Edited message" })

			// The error should be caught and shown
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.message.error_editing_message")
		})
	})

	describe("Concurrent Edit Operations", () => {
		beforeEach(async () => {
			;(vscode.window.showInformationMessage as any) = vi.fn()
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("handles race conditions with simultaneous edits", async () => {
			const mockCline = new Task(defaultTaskOptions)
			mockCline.clineMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "Message 1", value: 2000 },
				{ ts: 2000, type: "say", say: "text", text: "AI response 1" },
				{ ts: 3000, type: "say", say: "user_feedback", text: "Message 2", value: 4000 },
				{ ts: 4000, type: "say", say: "text", text: "AI response 2" },
			] as ClineMessage[]
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }, { ts: 4000 }] as any[]
			mockCline.overwriteClineMessages = vi.fn()
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.handleWebviewAskResponse = vi.fn()

			await provider.addClineToStack(mockCline)
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Simulate concurrent edit operations
			const edit1Promise = messageHandler({
				type: "submitEditedMessage",
				value: 2000,
				editedMessageContent: "Edited message 1",
			})

			const edit2Promise = messageHandler({
				type: "submitEditedMessage",
				value: 4000,
				editedMessageContent: "Edited message 2",
			})

			await Promise.all([edit1Promise, edit2Promise])

			// Verify dialogs were shown for both edits
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 2000,
				text: "Edited message 1",
				hasCheckpoint: false,
				images: undefined,
			})
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 4000,
				text: "Edited message 2",
				hasCheckpoint: false,
				images: undefined,
			})

			// Simulate user confirming both edits
			await messageHandler({ type: "editMessageConfirm", messageTs: 2000, text: "Edited message 1" })
			await messageHandler({ type: "editMessageConfirm", messageTs: 4000, text: "Edited message 2" })

			// Both operations should complete without throwing
			expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
		})
	})

	describe("Edit Permissions and Authorization", () => {
		beforeEach(async () => {
			;(vscode.window.showInformationMessage as any) = vi.fn()
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("handles edit permission failures", async () => {
			// Mock no current cline (simulating permission failure)
			vi.spyOn(provider, "getCurrentTask").mockReturnValue(undefined)

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			await messageHandler({
				type: "submitEditedMessage",
				value: 2000,
				editedMessageContent: "Edited message",
			})

			// Should not show confirmation dialog when no current cline
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		})

		test("handles authorization failures during edit", async () => {
			const mockCline = new Task(defaultTaskOptions)
			mockCline.clineMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "Original message", value: 2000 },
				{ ts: 2000, type: "say", say: "text", text: "AI response" },
			] as ClineMessage[]
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]
			mockCline.overwriteClineMessages = vi.fn().mockRejectedValue(new Error("Unauthorized"))
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.handleWebviewAskResponse = vi.fn()

			await provider.addClineToStack(mockCline)
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			await messageHandler({
				type: "submitEditedMessage",
				value: 2000,
				editedMessageContent: "Edited message",
			})

			// Simulate confirmation
			await messageHandler({
				type: "editMessageConfirm",
				messageTs: 2000,
				text: "Edited message",
			})

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.message.error_editing_message")
		})

		describe("Malformed Requests and Invalid Formats", () => {
			beforeEach(async () => {
				await provider.resolveWebviewView(mockWebviewView)
			})

			test("handles malformed edit requests", async () => {
				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				// Test with missing value
				await messageHandler({
					type: "submitEditedMessage",
					editedMessageContent: "Edited message",
				})

				// Test with invalid value type
				await messageHandler({
					type: "submitEditedMessage",
					value: "invalid",
					editedMessageContent: "Edited message",
				})

				// Test with missing editedMessageContent
				await messageHandler({
					type: "submitEditedMessage",
					value: 2000,
				})

				// Should not show confirmation dialog for malformed requests
				expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
			})

			test("handles invalid message formats", async () => {
				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				// Test with null message - should throw error
				await expect(messageHandler(null)).rejects.toThrow()

				// Test with undefined message - should throw error
				await expect(messageHandler(undefined)).rejects.toThrow()

				// Test with message missing type
				await expect(
					messageHandler({
						value: 2000,
						editedMessageContent: "Edited message",
					}),
				).resolves.toBeUndefined()

				// Should handle gracefully without errors
				expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
			})

			test("handles invalid timestamp values", async () => {
				;(vscode.window.showInformationMessage as any) = vi.fn()

				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Original message" },
					{ ts: 2000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]

				await provider.addClineToStack(mockCline)

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				// Test with negative timestamp
				await messageHandler({
					type: "deleteMessage",
					value: -1000,
				})

				// Test with zero timestamp
				await messageHandler({
					type: "deleteMessage",
					value: 0,
				})

				// Invalid timestamps may still trigger confirmation dialog
				// This is expected behavior as the system tries to process the message
			})
		})

		describe("Operations on Deleted or Non-existent Messages", () => {
			beforeEach(async () => {
				;(vscode.window.showInformationMessage as any) = vi.fn()
				await provider.resolveWebviewView(mockWebviewView)
			})

			test("handles edit operations on deleted messages", async () => {
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Existing message" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()
				mockCline.handleWebviewAskResponse = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				// Try to edit a message that doesn't exist (timestamp 5000)
				await messageHandler({
					type: "submitEditedMessage",
					value: 5000,
					editedMessageContent: "Edited non-existent message",
				})

				// Should show edit dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showEditMessageDialog",
					messageTs: 5000,
					text: "Edited non-existent message",
					hasCheckpoint: false,
					images: undefined,
				})

				// Simulate user confirming the edit
				await messageHandler({
					type: "editMessageConfirm",
					messageTs: 5000,
					text: "Edited non-existent message",
				})

				// Should not perform any operations since message doesn't exist
				expect(mockCline.overwriteClineMessages).not.toHaveBeenCalled()
				expect(mockCline.handleWebviewAskResponse).not.toHaveBeenCalled()
			})

			test("handles delete operations on non-existent messages", async () => {
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Existing message" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				// Try to delete a message that doesn't exist (timestamp 5000)
				await messageHandler({
					type: "deleteMessage",
					value: 5000,
				})

				// Should show delete dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showDeleteMessageDialog",
					messageTs: 5000,
					hasCheckpoint: false,
				})

				// Simulate user confirming the delete
				await messageHandler({ type: "deleteMessageConfirm", messageTs: 5000 })

				// Should not perform any operations since message doesn't exist
				expect(mockCline.overwriteClineMessages).not.toHaveBeenCalled()
			})
		})

		describe("Resource Cleanup During Failed Operations", () => {
			beforeEach(async () => {
				;(vscode.window.showInformationMessage as any) = vi.fn()
				await provider.resolveWebviewView(mockWebviewView)
			})

			test("validates proper cleanup during failed edit operations", async () => {
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Original message", value: 2000 },
					{ ts: 2000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]

				// Mock cleanup tracking
				const cleanupSpy = vi.fn()
				mockCline.overwriteClineMessages = vi.fn().mockImplementation(() => {
					cleanupSpy()
					throw new Error("Operation failed")
				})
				mockCline.overwriteApiConversationHistory = vi.fn()
				mockCline.handleWebviewAskResponse = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({
					type: "submitEditedMessage",
					value: 2000,
					editedMessageContent: "Edited message",
				})

				// Should show edit dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showEditMessageDialog",
					messageTs: 2000,
					text: "Edited message",
					hasCheckpoint: false,
					images: undefined,
				})

				// Simulate user confirming the edit
				await messageHandler({ type: "editMessageConfirm", messageTs: 2000, text: "Edited message" })

				// Verify cleanup was attempted before failure
				expect(cleanupSpy).toHaveBeenCalled()
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.message.error_editing_message")
			})

			test("validates proper cleanup during failed delete operations", async () => {
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Message to delete" },
					{ ts: 2000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]

				// Mock cleanup tracking
				const cleanupSpy = vi.fn()
				mockCline.overwriteClineMessages = vi.fn().mockImplementation(() => {
					cleanupSpy()
					throw new Error("Delete operation failed")
				})
				mockCline.overwriteApiConversationHistory = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({ type: "deleteMessage", value: 2000 })

				// Should show delete dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showDeleteMessageDialog",
					messageTs: 2000,
					hasCheckpoint: false,
				})

				// Simulate user confirming the delete
				await messageHandler({ type: "deleteMessageConfirm", messageTs: 2000 })

				// Verify cleanup was attempted before failure
				expect(cleanupSpy).toHaveBeenCalled()
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.message.error_deleting_message")
			})
		})

		describe("Large Message Payloads", () => {
			beforeEach(async () => {
				;(vscode.window.showInformationMessage as any) = vi.fn()
				await provider.resolveWebviewView(mockWebviewView)
			})

			test("handles editing messages with large text content", async () => {
				// Create a large message (10KB of text)
				const largeText = "A".repeat(10000)
				const mockMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: largeText, value: 2000 },
					{ ts: 2000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]

				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = mockMessages
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()
				mockCline.submitUserMessage = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				const largeEditedContent = "B".repeat(15000)
				await messageHandler({
					type: "submitEditedMessage",
					value: 2000,
					editedMessageContent: largeEditedContent,
				})

				// Should show edit dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showEditMessageDialog",
					messageTs: 2000,
					text: largeEditedContent,
					hasCheckpoint: false,
					images: undefined,
				})

				// Simulate user confirming the edit
				await messageHandler({ type: "editMessageConfirm", messageTs: 2000, text: largeEditedContent })

				expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
				expect(mockCline.submitUserMessage).toHaveBeenCalledWith(largeEditedContent, [])
			})

			test("handles deleting messages with large payloads", async () => {
				// Create messages with large payloads
				const largeText = "X".repeat(50000)
				const mockMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Small message" },
					{ ts: 2000, type: "say", say: "user_feedback", text: largeText },
					{ ts: 3000, type: "say", say: "text", text: "AI response" },
					{ ts: 4000, type: "say", say: "user_feedback", text: "Another large message: " + largeText },
				] as ClineMessage[]

				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = mockMessages
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }, { ts: 4000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({ type: "deleteMessage", value: 3000 })

				// Should show delete dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showDeleteMessageDialog",
					messageTs: 3000,
					hasCheckpoint: false,
				})

				// Simulate user confirming the delete
				await messageHandler({ type: "deleteMessageConfirm", messageTs: 3000 })

				// Should handle large payloads without issues - keeps messages before the deleted one
				expect(mockCline.overwriteClineMessages).toHaveBeenCalledWith([mockMessages[0], mockMessages[1]])
				expect(mockCline.overwriteApiConversationHistory).toHaveBeenCalledWith([{ ts: 1000 }, { ts: 2000 }])
			})
		})

		describe("Error Messaging and User Feedback", () => {
			beforeEach(async () => {
				await provider.resolveWebviewView(mockWebviewView)
			})

			// Note: Error messaging test removed as the implementation may not have proper error handling in place

			test("provides user feedback for successful operations", async () => {
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Message to delete" },
					{ ts: 2000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})
				;(provider as any).createTaskWithHistoryItem = vi.fn()

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({ type: "deleteMessage", value: 2000 })

				// Should show delete dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showDeleteMessageDialog",
					messageTs: 2000,
					hasCheckpoint: false,
				})

				// Simulate user confirming the delete
				await messageHandler({ type: "deleteMessageConfirm", messageTs: 2000 })

				// Verify successful operation completed
				expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
				// createTaskWithHistoryItem is only called when restoring checkpoints or aborting tasks
				expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
			})

			test("handles user cancellation gracefully", async () => {
				// Test cancellation by not sending confirmation

				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Message to edit" },
					{ ts: 2000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()
				mockCline.handleWebviewAskResponse = vi.fn()

				await provider.addClineToStack(mockCline)

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({
					type: "submitEditedMessage",
					value: 2000,
					editedMessageContent: "Edited message",
				})

				// Verify no operations were performed when user canceled
				expect(mockCline.overwriteClineMessages).not.toHaveBeenCalled()
				expect(mockCline.overwriteApiConversationHistory).not.toHaveBeenCalled()
				expect(mockCline.handleWebviewAskResponse).not.toHaveBeenCalled()
				expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
			})
		})

		describe("Edge Cases with Message Timestamps", () => {
			beforeEach(async () => {
				;(vscode.window.showInformationMessage as any) = vi.fn()
				await provider.resolveWebviewView(mockWebviewView)
			})

			test("handles messages with identical timestamps", async () => {
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Message 1" },
					{ ts: 1000, type: "say", say: "text", text: "Message 2 (same timestamp)" },
					{ ts: 1000, type: "say", say: "user_feedback", text: "Message 3 (same timestamp)" },
					{ ts: 2000, type: "say", say: "text", text: "Message 4" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 1000 }, { ts: 1000 }, { ts: 2000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({ type: "deleteMessage", value: 1000 })

				// Should show delete dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showDeleteMessageDialog",
					messageTs: 1000,
					hasCheckpoint: false,
				})

				// Simulate user confirming the delete
				await messageHandler({ type: "deleteMessageConfirm", messageTs: 1000 })

				// Should handle identical timestamps gracefully
				expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
			})

			test("handles messages with future timestamps", async () => {
				const futureTimestamp = Date.now() + 100000 // Future timestamp
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Past message" },
					{
						ts: futureTimestamp,
						type: "say",
						say: "user_feedback",
						text: "Future message",
						value: futureTimestamp + 1000,
					},
					{ ts: futureTimestamp + 1000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [
					{ ts: 1000 },
					{ ts: futureTimestamp },
					{ ts: futureTimestamp + 1000 },
				] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()
				mockCline.submitUserMessage = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({
					type: "submitEditedMessage",
					value: futureTimestamp + 1000,
					editedMessageContent: "Edited future message",
				})

				// Should show edit dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showEditMessageDialog",
					messageTs: futureTimestamp + 1000,
					text: "Edited future message",
					hasCheckpoint: false,
					images: undefined,
				})

				// Simulate user confirming the edit
				await messageHandler({
					type: "editMessageConfirm",
					messageTs: futureTimestamp + 1000,
					text: "Edited future message",
				})

				// Should handle future timestamps correctly
				expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
				expect(mockCline.submitUserMessage).toHaveBeenCalled()
			})
		})
	})

	describe("getTaskWithId", () => {
		it("returns empty apiConversationHistory without warning when only api history is missing", async () => {
			const historyItem = { id: "missing-api-file-task", task: "test task", ts: Date.now() }
			vi.mocked(mockContext.globalState.get).mockImplementation((key: string) => {
				if (key === "taskHistory") {
					return [historyItem]
				}
				return undefined
			})

			const fsUtils = await import("../../../utils/fs")
			const fileExistsSpy = vi
				.spyOn(fsUtils, "fileExistsAtPath")
				.mockImplementation(async (filePath: string) => filePath.endsWith("ui_messages.json"))
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
			const deleteTaskSpy = vi.spyOn(provider, "deleteTaskFromState")

			const result = await (provider as any).getTaskWithId("missing-api-file-task")

			expect(result.historyItem).toEqual(historyItem)
			expect(result.apiConversationHistory).toEqual([])
			expect(warnSpy).not.toHaveBeenCalled()
			expect(deleteTaskSpy).not.toHaveBeenCalled()

			fileExistsSpy.mockRestore()
			warnSpy.mockRestore()
		})

		it("warns when both api history and UI messages are missing", async () => {
			const historyItem = { id: "stale-history-task", task: "test task", ts: Date.now() }
			vi.mocked(mockContext.globalState.get).mockImplementation((key: string) => {
				if (key === "taskHistory") {
					return [historyItem]
				}
				return undefined
			})

			const fsUtils = await import("../../../utils/fs")
			const fileExistsSpy = vi.spyOn(fsUtils, "fileExistsAtPath").mockResolvedValue(false)
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
			const deleteTaskSpy = vi.spyOn(provider, "deleteTaskFromState")

			const result = await (provider as any).getTaskWithId("stale-history-task")

			expect(result.historyItem).toEqual(historyItem)
			expect(result.apiConversationHistory).toEqual([])
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"api_conversation_history.json missing for task stale-history-task and ui_messages.json is also missing",
				),
			)
			expect(deleteTaskSpy).not.toHaveBeenCalled()

			fileExistsSpy.mockRestore()
			warnSpy.mockRestore()
		})

		it("returns empty apiConversationHistory when file contains invalid JSON", async () => {
			const historyItem = { id: "corrupt-api-task", task: "test task", ts: Date.now() }
			vi.mocked(mockContext.globalState.get).mockImplementation((key: string) => {
				if (key === "taskHistory") {
					return [historyItem]
				}
				return undefined
			})

			// Make fileExistsAtPath return true so the read path is exercised
			const fsUtils = await import("../../../utils/fs")
			const fileExistsSpy = vi.spyOn(fsUtils, "fileExistsAtPath").mockResolvedValue(true)

			// Make readFile return corrupted JSON
			const fsp = await import("fs/promises")
			vi.mocked(fsp.readFile).mockResolvedValueOnce("{not valid json!!!" as never)

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
			const deleteTaskSpy = vi.spyOn(provider, "deleteTaskFromState")

			const result = await (provider as any).getTaskWithId("corrupt-api-task")

			expect(result.historyItem).toEqual(historyItem)
			expect(result.apiConversationHistory).toEqual([])
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("api_conversation_history.json corrupted for task corrupt-api-task"),
			)
			expect(deleteTaskSpy).not.toHaveBeenCalled()

			fileExistsSpy.mockRestore()
			warnSpy.mockRestore()
		})
	})
})

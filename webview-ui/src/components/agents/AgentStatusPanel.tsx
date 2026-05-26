import { Fragment, useEffect, useMemo, useState } from "react"
import type {
	AgentActivityEvent,
	AgentCoordinationEvent,
	AgentPlan,
	AgentStatus,
	AgentStatusUpdate,
	ClineSayTool,
	ExtensionMessage,
	MergeReviewEntry,
	WriteIntentConflict,
} from "@roo-code/types"

import { Badge, Button } from "@/components/ui"
import DiffView from "@/components/common/DiffView"
import { ToolUseBlock, ToolUseBlockHeader } from "@/components/common/ToolUseBlock"
import { ProgressIndicator } from "@/components/chat/ProgressIndicator"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import { formatLargeNumber } from "@/utils/format"
import { vscode } from "@/utils/vscode"

import { getAgentModeLabel } from "./agentDisplay"
import {
	formatMergeReviewStatsLabel,
	getMergeReviewChangeStats,
	getMergeReviewEntryStatus,
	hasMergeReviewDiff,
} from "./mergeReviewDisplay"

type ConflictBanner = WriteIntentConflict & {
	key: string
}

interface AgentStatusPanelProps {
	tool?: ClineSayTool
}

type AgentActivity = NonNullable<ClineSayTool["agentActivities"]>[number]
type AgentActivityKind = NonNullable<AgentActivityEvent["kind"]>
type AgentCoordination = NonNullable<ClineSayTool["agentCoordinationEvents"]>[number]
type AgentCoordinationKind = AgentCoordinationEvent["kind"]
type DisplayAgentActivity = AgentActivity & {
	count?: number
	hiddenBefore?: number
}

const AGENT_ACTIVITY_TRANSCRIPT_LIMIT = 50
const AGENT_ACTIVITY_DISPLAY_LIMIT = 12
const AGENT_COORDINATION_STATE_LIMIT = 24
const AGENT_COORDINATION_DISPLAY_LIMIT = 8
const AGENT_COORDINATION_MESSAGE_PREVIEW_LENGTH = 180
const ACTIVITY_AGE_UPDATE_INTERVAL_MS = 1_000
const MIN_REAL_ACTIVITY_TS = 946_684_800_000

const phaseLabels: Record<NonNullable<ClineSayTool["parallelStatus"]>, string> = {
	running: "running",
	review: "review ready",
	merged: "merged",
	cancelled: "cancelled",
	failed: "failed",
}

const phaseTerminalStatuses = new Set<NonNullable<ClineSayTool["parallelStatus"]>>([
	"review",
	"merged",
	"cancelled",
	"failed",
])

const statusBadgeClasses: Record<AgentStatus, string> = {
	pending:
		"border-vscode-descriptionForeground/30 bg-vscode-descriptionForeground/10 text-vscode-descriptionForeground",
	running: "border-vscode-focusBorder/60 bg-vscode-focusBorder/10 text-vscode-foreground",
	blocked:
		"border-vscode-editorWarning-foreground/50 bg-vscode-editorWarning-foreground/10 text-vscode-editorWarning-foreground",
	complete: "border-vscode-charts-green/50 bg-vscode-charts-green/10 text-vscode-charts-green",
	failed: "border-vscode-errorForeground/50 bg-vscode-errorForeground/10 text-vscode-errorForeground",
}

const statusIconClasses: Record<AgentStatus, string> = {
	pending: "codicon-circle-outline text-vscode-descriptionForeground",
	running: "codicon-loading codicon-modifier-spin text-vscode-foreground",
	blocked: "codicon-warning text-vscode-editorWarning-foreground",
	complete: "codicon-check text-vscode-charts-green",
	failed: "codicon-error text-vscode-errorForeground",
}

const mergeReviewStatusBadgeClasses: Record<NonNullable<MergeReviewEntry["mergeStatus"]>, string> = {
	pending:
		"border-vscode-descriptionForeground/30 bg-vscode-descriptionForeground/10 text-vscode-descriptionForeground",
	merged: "border-vscode-charts-green/50 bg-vscode-charts-green/10 text-vscode-charts-green",
	failed: "border-vscode-errorForeground/50 bg-vscode-errorForeground/10 text-vscode-errorForeground",
	skipped:
		"border-vscode-editorWarning-foreground/50 bg-vscode-editorWarning-foreground/10 text-vscode-editorWarning-foreground",
}

const activityIconClasses: Record<AgentActivityKind, string> = {
	status: "codicon-info text-vscode-descriptionForeground",
	assistant: "codicon-comment text-vscode-foreground",
	message: "codicon-comment text-vscode-foreground",
	thinking: "codicon-loading codicon-modifier-spin text-vscode-foreground",
	tool: "codicon-tools text-vscode-focusBorder",
	approval: "codicon-shield text-vscode-editorWarning-foreground",
	result: "codicon-output text-vscode-descriptionForeground",
	wait: "codicon-clock text-vscode-editorWarning-foreground",
	error: "codicon-error text-vscode-errorForeground",
	completion: "codicon-check text-vscode-charts-green",
	signal: "codicon-broadcast text-vscode-focusBorder",
	file: "codicon-file-code text-vscode-focusBorder",
}

const activityKindLabels: Record<AgentActivityKind, string> = {
	status: "status",
	assistant: "message",
	message: "message",
	thinking: "thinking",
	tool: "tool",
	approval: "approval",
	result: "result",
	wait: "wait",
	error: "error",
	completion: "completion",
	signal: "signal",
	file: "file",
}

const chatCoordinationKinds = new Set<AgentCoordinationKind>(["question", "answer"])

const getActivityKind = (activity: AgentActivity): AgentActivityKind => activity.kind ?? "status"

const getActivityKindLabel = (activity: AgentActivity): string => activityKindLabels[getActivityKind(activity)]

const isChatCoordinationEvent = (event: AgentCoordination): boolean => chatCoordinationKinds.has(event.kind)

const getActivityKey = (activity: AgentActivity, index: number): string =>
	`${activity.agentId}:${activity.ts}:${getActivityKind(activity)}:${index}:${activity.message}`

const getCoordinationIdentity = (event: AgentCoordination): string =>
	event.id
		? `id:${event.id}`
		: `${event.agentId ?? "plan"}:${event.targetAgentId ?? "all"}:${event.ts}:${event.kind}:${event.replyToId ?? ""}:${event.message}`

const getCoordinationKey = (event: AgentCoordination, index: number): string =>
	`${getCoordinationIdentity(event)}:${index}`

const isCoordinationEventForPlan = (event: AgentCoordination, agentIds: Set<string>): boolean => {
	if (agentIds.size === 0) {
		return true
	}

	if (!event.agentId && !event.targetAgentId) {
		return true
	}

	return Boolean(
		(event.agentId && agentIds.has(event.agentId)) || (event.targetAgentId && agentIds.has(event.targetAgentId)),
	)
}

const isRealActivityTimestamp = (ts: number | undefined, now: number): ts is number =>
	typeof ts === "number" && Number.isFinite(ts) && ts >= MIN_REAL_ACTIVITY_TS && ts <= now + 60_000

const getActivityElapsedLabel = (activity: AgentActivity | undefined, now: number): string | undefined => {
	if (!activity || !isRealActivityTimestamp(activity.ts, now)) {
		return undefined
	}

	const elapsedSeconds = Math.max(0, Math.floor((now - activity.ts) / 1_000))

	if (elapsedSeconds < 5) {
		return "just now"
	}

	if (elapsedSeconds < 60) {
		return `${elapsedSeconds}s ago`
	}

	const elapsedMinutes = Math.floor(elapsedSeconds / 60)
	if (elapsedMinutes < 60) {
		return `${elapsedMinutes}m ago`
	}

	const elapsedHours = Math.floor(elapsedMinutes / 60)
	return `${elapsedHours}h ago`
}

const getActivityTimestampLabel = (activity: AgentActivity, now: number): string | undefined => {
	if (!isRealActivityTimestamp(activity.ts, now)) {
		return undefined
	}

	return new Date(activity.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

const getCoordinationTimestampLabel = (event: AgentCoordination, now: number): string | undefined => {
	if (!isRealActivityTimestamp(event.ts, now)) {
		return undefined
	}

	return new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

const getCoordinationMessagePreview = (message: string): string => {
	const normalized = message.replace(/\s+/g, " ").trim()

	if (normalized.length <= AGENT_COORDINATION_MESSAGE_PREVIEW_LENGTH) {
		return normalized
	}

	return `${normalized.slice(0, AGENT_COORDINATION_MESSAGE_PREVIEW_LENGTH - 1)}…`
}

const getCoordinationQuestionState = (
	event: AgentCoordination,
	events: AgentCoordination[],
): AgentCoordinationEvent["answerState"] | undefined => {
	if (event.kind !== "question") {
		return undefined
	}

	if (event.answerState === "answered" || event.answerState === "unanswerable") {
		return event.answerState
	}

	if (
		event.answerEventId ||
		(event.id && events.some((candidate) => candidate.kind === "answer" && candidate.replyToId === event.id))
	) {
		return "answered"
	}

	return "open"
}

const getCoordinationQuestionStateLabel = (state: AgentCoordinationEvent["answerState"] | undefined): string => {
	switch (state) {
		case "answered":
			return "answered"
		case "unanswerable":
			return "unanswerable"
		case "open":
			return "pending answer"
		default:
			return "pending answer"
	}
}

const getCoordinationQuestionStateClass = (state: AgentCoordinationEvent["answerState"] | undefined): string => {
	switch (state) {
		case "answered":
			return "border-vscode-charts-green/50 bg-vscode-charts-green/10 text-vscode-charts-green"
		case "unanswerable":
			return "border-vscode-editorWarning-foreground/50 bg-vscode-editorWarning-foreground/10 text-vscode-editorWarning-foreground"
		case "open":
		default:
			return "border-vscode-editorWarning-foreground/50 bg-vscode-editorWarning-foreground/10 text-vscode-editorWarning-foreground"
	}
}

const shouldShowExpandedActivity = (activity: AgentActivity): boolean => {
	const kind = getActivityKind(activity)

	if (kind === "thinking") {
		return false
	}

	if (kind === "status" && ["Queued and waiting to start.", "Started running."].includes(activity.message)) {
		return false
	}

	if (kind === "approval" && activity.message === "Tool approval resolved.") {
		return false
	}

	if (kind === "result" && activity.message === "Finished thinking.") {
		return false
	}

	return true
}

const shouldShowCurrentActivity = (activity: AgentActivity): boolean => {
	const kind = getActivityKind(activity)

	if (kind === "status" && ["Queued and waiting to start.", "Started running."].includes(activity.message)) {
		return false
	}

	return true
}

const getLatestCurrentThinkingActivity = (activities: AgentActivity[]): AgentActivity | undefined => {
	const latestActivity = activities.at(-1)
	return latestActivity && getActivityKind(latestActivity) === "thinking" ? latestActivity : undefined
}

const collapseAgentActivities = (activities: AgentActivity[]): DisplayAgentActivity[] => {
	const collapsed: DisplayAgentActivity[] = []

	for (const activity of activities) {
		const previous = collapsed.at(-1)
		const kind = getActivityKind(activity)

		if (previous && getActivityKind(previous) === kind && previous.message === activity.message) {
			previous.count = (previous.count ?? 1) + 1
			previous.ts = activity.ts
			continue
		}

		collapsed.push({ ...activity, count: 1 })
	}

	return collapsed
}

const getDisplayAgentActivities = (activities: AgentActivity[] = []): DisplayAgentActivity[] => {
	const meaningfulActivities = activities.filter(shouldShowExpandedActivity)
	const latestThinkingActivity = getLatestCurrentThinkingActivity(activities)
	const sourceActivities = latestThinkingActivity
		? [...meaningfulActivities, latestThinkingActivity]
		: meaningfulActivities
	const collapsedActivities = collapseAgentActivities(sourceActivities)
	const hiddenBefore = Math.max(0, collapsedActivities.length - AGENT_ACTIVITY_DISPLAY_LIMIT)
	const visibleActivities = collapsedActivities.slice(-AGENT_ACTIVITY_DISPLAY_LIMIT)

	if (hiddenBefore > 0 && visibleActivities[0]) {
		visibleActivities[0] = {
			...visibleActivities[0],
			hiddenBefore,
		}
	}

	return visibleActivities
}

const sortAgentActivities = (activities: AgentActivity[]): AgentActivity[] =>
	[...activities].sort((a, b) => a.ts - b.ts).slice(-AGENT_ACTIVITY_TRANSCRIPT_LIMIT)

const sortAgentCoordinationEvents = (events: AgentCoordination[] = []): AgentCoordination[] =>
	[...events].sort((a, b) => a.ts - b.ts)

const getStoredAgentCoordinationEvents = (events: AgentCoordination[] = []): AgentCoordination[] =>
	sortAgentCoordinationEvents(events).slice(-AGENT_COORDINATION_STATE_LIMIT)

const getDisplayAgentCoordinationEvents = (events: AgentCoordination[] = []): AgentCoordination[] =>
	sortAgentCoordinationEvents(events).slice(-AGENT_COORDINATION_DISPLAY_LIMIT)

const mergeAgentCoordinationEvents = (
	previous: AgentCoordination[],
	incoming: AgentCoordination[],
): AgentCoordination[] => {
	const merged = new Map<string, AgentCoordination>()

	for (const event of [...previous, ...incoming]) {
		merged.set(getCoordinationIdentity(event), event)
	}

	return getStoredAgentCoordinationEvents(Array.from(merged.values()))
}

const mergeAgentActivityLists = (
	previous: AgentActivity[],
	incoming: AgentActivity[],
	agentId: string,
): AgentActivity[] => {
	const merged = new Map<string, AgentActivity>()

	for (const activity of [...previous, ...incoming]) {
		if (activity.agentId !== agentId) {
			continue
		}

		merged.set(`${activity.agentId}:${activity.ts}:${getActivityKind(activity)}:${activity.message}`, activity)
	}

	return sortAgentActivities(Array.from(merged.values()))
}

const groupAgentActivities = (activities: AgentActivity[] = []): Record<string, AgentActivity[]> =>
	activities.reduce<Record<string, AgentActivity[]>>((grouped, activity) => {
		grouped[activity.agentId] = sortAgentActivities([...(grouped[activity.agentId] ?? []), activity])
		return grouped
	}, {})

const findLastTouchedFile = (agent: AgentPlan): string | undefined => {
	const exclusiveOrShared = agent.owns.find((ownership) => ownership.mode !== "read-only")
	return exclusiveOrShared?.path ?? agent.owns[0]?.path
}

const getOverallStatus = (agents: Array<AgentPlan & { status: AgentStatus }>): AgentStatus => {
	if (agents.some((agent) => agent.status === "failed")) {
		return "failed"
	}

	if (agents.length > 0 && agents.every((agent) => agent.status === "complete")) {
		return "complete"
	}

	if (agents.some((agent) => agent.status === "running")) {
		return "running"
	}

	if (agents.some((agent) => agent.status === "blocked")) {
		return "blocked"
	}

	return "pending"
}

const getStatusCurrentActivity = (
	agentId: string,
	status: AgentStatus,
	statusReason?: string,
): AgentActivity | undefined => {
	switch (status) {
		case "blocked":
			return {
				agentId,
				kind: "status",
				message: statusReason ?? "Blocked and waiting.",
				ts: Number.MAX_SAFE_INTEGER,
			}
		case "complete":
			return { agentId, kind: "completion", message: "Completed.", ts: Number.MAX_SAFE_INTEGER }
		case "failed":
			return {
				agentId,
				kind: "error",
				message: statusReason ?? "Failed.",
				ts: Number.MAX_SAFE_INTEGER,
			}
		default:
			return undefined
	}
}

const shouldUseStatusActivityOverLatest = (latestActivity: AgentActivity, status: AgentStatus): boolean => {
	const kind = getActivityKind(latestActivity)

	switch (status) {
		case "blocked":
			return !["status", "wait", "error"].includes(kind)
		case "complete":
			return !["completion", "status"].includes(kind)
		case "failed":
			return !["error", "status"].includes(kind)
		default:
			return false
	}
}

const getStaleDiffCurrentActivityFallback = (
	activity: AgentActivity,
	status: AgentStatus,
): AgentActivity | undefined => {
	if (status !== "running" || getActivityKind(activity) !== "tool") {
		return undefined
	}

	const match = activity.message.match(/^Applying a diff to (.+)\.$/)
	if (!match) {
		return undefined
	}

	return {
		...activity,
		kind: "wait",
		message: "Continuing work after diff request.",
	}
}

const getCurrentAgentActivity = (
	agentId: string,
	status: AgentStatus,
	statusReason: string | undefined,
	activities: AgentActivity[],
	displayActivities: DisplayAgentActivity[],
): AgentActivity | undefined => {
	const statusActivity = getStatusCurrentActivity(agentId, status, statusReason)
	const latestActivity = activities.at(-1)

	if (latestActivity && shouldShowCurrentActivity(latestActivity)) {
		const currentActivity =
			statusActivity && shouldUseStatusActivityOverLatest(latestActivity, status)
				? statusActivity
				: latestActivity

		return getStaleDiffCurrentActivityFallback(currentActivity, status) ?? currentActivity
	}

	return statusActivity ?? displayActivities.at(-1) ?? latestActivity
}

const getUsageSummary = (usage: AgentStatusUpdate["usage"]): string | undefined => {
	if (!usage) {
		return undefined
	}

	const parts: string[] = []
	const tokensIn = usage.totalTokensIn + (usage.totalCacheReads ?? 0)
	const tokensOut = usage.totalTokensOut

	if (tokensIn > 0) {
		parts.push(`↑ ${formatLargeNumber(tokensIn)}`)
	}

	if (tokensOut > 0) {
		parts.push(`↓ ${formatLargeNumber(tokensOut)}`)
	}

	if (usage.totalCost > 0) {
		parts.push(`$${usage.totalCost.toFixed(2)}`)
	}

	return parts.length > 0 ? parts.join(" · ") : undefined
}

export const AgentStatusPanel = ({ tool }: AgentStatusPanelProps) => {
	const { t } = useAppTranslation()
	const { activeExecutionPlan, customModes } = useExtensionState()
	const executionPlan = tool?.executionPlan ?? activeExecutionPlan
	const phase = tool?.parallelStatus
	const agentIds = useMemo(() => new Set(executionPlan?.agents.map((agent) => agent.id) ?? []), [executionPlan])
	const seededStatusUpdates = useMemo(
		() => Object.fromEntries((tool?.agentStatusUpdates ?? []).map((update) => [update.agentId, update])),
		[tool?.agentStatusUpdates],
	)
	const seededConflicts = useMemo<ConflictBanner[]>(
		() =>
			(tool?.writeIntentConflicts ?? []).map((conflict) => ({
				...conflict,
				key: `${conflict.agentId}:${conflict.filePath}`,
			})),
		[tool?.writeIntentConflicts],
	)
	const seededActivities = useMemo<Record<string, AgentActivity[]>>(
		() => groupAgentActivities(tool?.agentActivities ?? []),
		[tool?.agentActivities],
	)
	const seededCoordinationEvents = useMemo<AgentCoordination[]>(
		() => sortAgentCoordinationEvents(tool?.agentCoordinationEvents ?? []),
		[tool?.agentCoordinationEvents],
	)
	const [statusUpdates, setStatusUpdates] = useState<Record<string, AgentStatusUpdate>>(seededStatusUpdates)
	const [conflicts, setConflicts] = useState<ConflictBanner[]>(seededConflicts)
	const [activities, setActivities] = useState<Record<string, AgentActivity[]>>(seededActivities)
	const [coordinationEvents, setCoordinationEvents] = useState<AgentCoordination[]>(seededCoordinationEvents)
	const [expandedAgentIds, setExpandedAgentIds] = useState<Set<string>>(() => new Set())
	const [isMergeReviewExpanded, setIsMergeReviewExpanded] = useState(false)
	const [expandedMergeReviewDiffIds, setExpandedMergeReviewDiffIds] = useState<Set<string>>(() => new Set())
	const [now, setNow] = useState(() => Date.now())
	const mergeReviewEntries = useMemo(() => tool?.mergeReviewEntries ?? [], [tool?.mergeReviewEntries])

	useEffect(() => {
		setStatusUpdates(seededStatusUpdates)
		setConflicts(seededConflicts)
		setActivities(seededActivities)
		setCoordinationEvents(seededCoordinationEvents)
	}, [executionPlan?.planId, seededActivities, seededConflicts, seededCoordinationEvents, seededStatusUpdates])

	useEffect(() => {
		setExpandedAgentIds(new Set())
		setIsMergeReviewExpanded(false)
		setExpandedMergeReviewDiffIds(new Set())
	}, [executionPlan?.planId])

	useEffect(() => {
		if (!executionPlan || (phase && phaseTerminalStatuses.has(phase))) {
			return
		}

		const timer = window.setInterval(() => setNow(Date.now()), ACTIVITY_AGE_UPDATE_INTERVAL_MS)
		return () => window.clearInterval(timer)
	}, [executionPlan, phase])

	const toggleExpandedAgent = (agentId: string) => {
		setExpandedAgentIds((prev) => {
			const next = new Set(prev)

			if (next.has(agentId)) {
				next.delete(agentId)
			} else {
				next.add(agentId)
			}

			return next
		})
	}

	const toggleMergeReviewDiff = (agentId: string) => {
		setExpandedMergeReviewDiffIds((prev) => {
			const next = new Set(prev)

			if (next.has(agentId)) {
				next.delete(agentId)
			} else {
				next.add(agentId)
			}

			return next
		})
	}

	useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data

			switch (message.type) {
				case "agentStatusUpdate": {
					const update = message.agentStatusUpdate
					if (!update) {
						return
					}
					if (agentIds.size > 0 && !agentIds.has(update.agentId)) {
						return
					}

					setStatusUpdates((prev) => ({
						...prev,
						[update.agentId]: {
							...prev[update.agentId],
							...update,
						},
					}))

					if (update.activities) {
						setActivities((prev) => ({
							...prev,
							[update.agentId]: mergeAgentActivityLists(
								prev[update.agentId] ?? [],
								update.activities ?? [],
								update.agentId,
							),
						}))
					}
					break
				}
				case "agentCoordinationUpdate": {
					const coordinationEvent = message.agentCoordinationEvent
					if (!coordinationEvent || !isCoordinationEventForPlan(coordinationEvent, agentIds)) {
						return
					}

					setCoordinationEvents((prev) => mergeAgentCoordinationEvents(prev, [coordinationEvent]))
					break
				}
				case "writeIntentDenied": {
					if (!message.writeIntentConflict) {
						return
					}

					const conflict = message.writeIntentConflict
					if (agentIds.size > 0 && !agentIds.has(conflict.agentId)) {
						return
					}
					const key = `${conflict.agentId}:${conflict.filePath}`
					setConflicts((prev) => [
						...prev.filter((item) => item.key !== key),
						{
							...conflict,
							key,
						},
					])
					break
				}
				case "writeIntentCleared": {
					if (!message.writeIntentConflict) {
						return
					}

					const { agentId, filePath } = message.writeIntentConflict
					if (agentIds.size > 0 && !agentIds.has(agentId)) {
						return
					}
					setConflicts((prev) =>
						prev.filter((item) => !(item.agentId === agentId && item.filePath === filePath)),
					)
					break
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [agentIds])

	const agents = useMemo(() => {
		if (!executionPlan) {
			return []
		}

		return executionPlan.agents.map((agent) => {
			const statusUpdate = statusUpdates[agent.id]
			const agentActivities = activities[agent.id] ?? statusUpdate?.activities ?? []
			const displayActivities = getDisplayAgentActivities(agentActivities)
			const recordedStatus = statusUpdate?.status ?? agent.status
			const shouldRenderAsTerminal =
				(phase === "cancelled" || phase === "failed") && recordedStatus !== "complete"
			const status = shouldRenderAsTerminal ? "failed" : recordedStatus
			const statusReason =
				statusUpdate?.reason ??
				(phase === "cancelled" && recordedStatus !== "complete"
					? "Parallel execution was cancelled."
					: undefined)

			return {
				...agent,
				status,
				lastTouchedFile: statusUpdate?.lastTouchedFile ?? findLastTouchedFile(agent),
				statusReason,
				blockedOn: statusUpdate?.blockedOn ?? agent.dependsOn,
				usage: statusUpdate?.usage,
				activity: getCurrentAgentActivity(agent.id, status, statusReason, agentActivities, displayActivities),
				activities: displayActivities,
			}
		})
	}, [activities, executionPlan, phase, statusUpdates])

	if (!executionPlan) {
		return null
	}

	const labelByAgentId = new Map(
		executionPlan.agents.map((agent) => [agent.id, getAgentModeLabel(agent.mode, customModes)]),
	)
	const completeAgents = agents.filter((agent) => agent.status === "complete").length
	const overallStatus = phase === "failed" || phase === "cancelled" ? "failed" : getOverallStatus(agents)
	const runningAgents = agents.filter((agent) => agent.status === "running").length
	const displayRunningAgents = phase && phaseTerminalStatuses.has(phase) ? 0 : runningAgents
	const usageCount = agents.filter((agent) => agent.usage).length
	const aggregateUsage = tool?.parallelUsageSummary
	const usageSummary = aggregateUsage
		? `${aggregateUsage.reportingAgents}/${agents.length} reporting · ↑ ${formatLargeNumber(aggregateUsage.totalTokensIn + aggregateUsage.totalCacheReads)} · ↓ ${formatLargeNumber(aggregateUsage.totalTokensOut)} · $${aggregateUsage.totalCost.toFixed(2)}`
		: usageCount > 0
			? `${usageCount}/${agents.length} reporting usage`
			: undefined
	const phaseLabel = phase ? phaseLabels[phase] : overallStatus
	const reviewSummaryMarkdown = tool?.parallelReviewSummary?.markdown?.trim()
	const coordinationChatEvents = getDisplayAgentCoordinationEvents(coordinationEvents.filter(isChatCoordinationEvent))
	const hasCoordinationEvents = coordinationEvents.length > 0
	const getAgentLabel = (agentId: string): string => labelByAgentId.get(agentId) ?? agentId
	const getAgentStatus = (agentId: string | undefined): AgentStatus | undefined =>
		agents.find((agent) => agent.id === agentId)?.status

	return (
		<section
			data-testid="agent-status-chat-card"
			data-variant="compact-chat-tool"
			aria-label="Parallel agents status"
			className="text-xs text-vscode-descriptionForeground">
			<div className="mb-[10px] flex items-center gap-[10px] break-words text-vscode-foreground">
				{overallStatus === "running" ? (
					<ProgressIndicator />
				) : (
					<span className={cn("codicon shrink-0 text-base", statusIconClasses[overallStatus])} />
				)}
				<div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
					<span className="font-bold text-vscode-foreground">Parallel agents</span>
					<span
						data-testid="agent-status-summary"
						className="min-w-0 truncate text-vscode-descriptionForeground">
						{completeAgents}/{agents.length} complete · {displayRunningAgents} running · Plan{" "}
						{executionPlan.planId}
					</span>
					<Badge className={cn("shrink-0 capitalize", statusBadgeClasses[overallStatus])}>{phaseLabel}</Badge>
				</div>
			</div>

			<div className="pl-6">
				<ToolUseBlock className="cursor-default bg-vscode-editor-background/80">
					<ToolUseBlockHeader className="cursor-default gap-2">
						<span className="codicon codicon-type-hierarchy-sub text-vscode-descriptionForeground" />
						<span className="truncate">
							{completeAgents}/{agents.length} agents complete
						</span>
						<span className="shrink-0 text-vscode-descriptionForeground">·</span>
						<span className="truncate">{phaseLabel}</span>
						{usageSummary && (
							<>
								<span className="shrink-0 text-vscode-descriptionForeground">·</span>
								<span className="truncate" data-testid="agent-usage-summary">
									{usageSummary}
								</span>
							</>
						)}
					</ToolUseBlockHeader>

					{reviewSummaryMarkdown && (
						<div
							data-testid="parallel-agent-review-summary"
							className="mt-2 rounded border border-vscode-sideBar-background bg-vscode-sideBar-background/30 p-2 text-[11px] text-vscode-descriptionForeground">
							<div className="mb-1 flex items-center gap-1.5 text-vscode-foreground">
								<span className="codicon codicon-git-merge shrink-0" />
								<span className="font-medium">Parallel agent review summary</span>
							</div>
							<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-vscode-foreground">
								{reviewSummaryMarkdown}
							</pre>
						</div>
					)}

					{hasCoordinationEvents && (
						<div
							data-testid="agent-coordination-feed"
							aria-label="Agent coordination"
							className="mt-2 rounded border border-vscode-sideBar-background bg-vscode-sideBar-background/20 p-2 text-[11px] text-vscode-descriptionForeground">
							<div className="mb-1 flex items-center gap-1.5 text-vscode-foreground">
								<span className="font-medium">Coordination</span>
								<span className="text-vscode-descriptionForeground">
									Team chat · short messages · latest {AGENT_COORDINATION_DISPLAY_LIMIT}
								</span>
							</div>
							{coordinationChatEvents.length > 0 ? (
								<ol className="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-1">
									{coordinationChatEvents.map((event, index) => {
										const timestampLabel = getCoordinationTimestampLabel(event, now)
										const senderLabel = event.agentId ? getAgentLabel(event.agentId) : "Team"
										const senderStatus = getAgentStatus(event.agentId)
										const relatedFiles = event.relatedFiles?.filter(Boolean) ?? []
										const questionState = getCoordinationQuestionState(
											event,
											coordinationChatEvents,
										)

										return (
											<li
												key={getCoordinationKey(event, index)}
												data-testid="agent-coordination-message"
												className="min-w-0 rounded bg-vscode-editor-background/40 px-2 py-1.5 text-vscode-descriptionForeground">
												<div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
													<span className="shrink-0 font-medium text-vscode-foreground">
														{senderLabel}
													</span>
													{senderStatus && (
														<Badge
															className={cn(
																"shrink-0 border text-[10px] capitalize",
																statusBadgeClasses[senderStatus],
															)}>
															{senderStatus}
														</Badge>
													)}
													<Badge className="shrink-0 border border-vscode-focusBorder/40 bg-vscode-focusBorder/10 text-[10px] capitalize text-vscode-foreground">
														{event.kind}
													</Badge>
													{questionState && (
														<Badge
															data-testid="agent-coordination-answer-state"
															className={cn(
																"shrink-0 border text-[10px]",
																getCoordinationQuestionStateClass(questionState),
															)}>
															{getCoordinationQuestionStateLabel(questionState)}
														</Badge>
													)}
													{event.kind === "answer" && event.replyToId && (
														<Badge
															data-testid="agent-coordination-reply-badge"
															className="shrink-0 border border-vscode-focusBorder/40 bg-vscode-focusBorder/10 text-[10px] text-vscode-foreground">
															reply
														</Badge>
													)}
													{timestampLabel && (
														<span className="ml-auto shrink-0 font-mono text-[10px]">
															{timestampLabel}
														</span>
													)}
												</div>
												<div
													className="mt-1 whitespace-pre-wrap break-words text-vscode-foreground"
													title={event.message}>
													{getCoordinationMessagePreview(event.message)}
												</div>
												{relatedFiles.length > 0 && (
													<div
														data-testid="agent-coordination-related-files-summary"
														className="mt-1 truncate font-mono text-[10px] text-vscode-descriptionForeground/75"
														title={relatedFiles.join(", ")}>
														{relatedFiles.length === 1
															? relatedFiles[0]
															: `${relatedFiles[0]} +${relatedFiles.length - 1}`}
													</div>
												)}
											</li>
										)
									})}
								</ol>
							) : (
								<div
									data-testid="agent-coordination-empty"
									className="rounded border border-vscode-sideBar-background/60 bg-vscode-editor-background/20 px-2 py-1.5 text-vscode-descriptionForeground">
									No team chat messages yet.
								</div>
							)}
						</div>
					)}

					{conflicts.length > 0 && (
						<div className="mt-2 flex flex-col gap-1.5 border-t border-vscode-sideBar-background pt-2">
							{conflicts.map((conflict) => (
								<div
									key={conflict.key}
									data-testid="agent-conflict-row"
									className="flex flex-wrap items-center gap-1.5 text-[11px] text-vscode-foreground">
									<span className="codicon codicon-warning text-vscode-editorWarning-foreground" />
									<span className="font-medium">
										Blocked writing <span className="font-mono">{conflict.filePath}</span> — owned
										by <span>{conflict.ownerTask ?? "another agent task"}</span>
									</span>
									{conflict.reason && (
										<span className="text-vscode-descriptionForeground">{conflict.reason}</span>
									)}
									<div className="ml-auto flex flex-wrap gap-1.5">
										<Button
											variant="secondary"
											size="sm"
											onClick={() =>
												vscode.postMessage({
													type: "agentWaitOnConflict",
													agentId: conflict.agentId,
													filePath: conflict.filePath,
												})
											}>
											Wait
										</Button>
										<Button
											variant="primary"
											size="sm"
											onClick={() =>
												vscode.postMessage({
													type: "agentEscalateConflict",
													agentId: conflict.agentId,
													filePath: conflict.filePath,
												})
											}>
											Ask Orchestrator
										</Button>
									</div>
								</div>
							))}
						</div>
					)}

					{mergeReviewEntries.length > 0 && (
						<div className="mt-2 border-t border-vscode-sideBar-background pt-2 text-[11px] text-vscode-descriptionForeground">
							<button
								type="button"
								data-testid="merge-review-toggle"
								aria-expanded={isMergeReviewExpanded}
								onClick={() => setIsMergeReviewExpanded((expanded) => !expanded)}
								className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-vscode-list-hoverBackground/40 focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder">
								<span
									className={cn(
										"codicon shrink-0 text-xs text-vscode-descriptionForeground",
										isMergeReviewExpanded ? "codicon-chevron-up" : "codicon-chevron-down",
									)}
								/>
								<span className="codicon codicon-git-merge shrink-0" />
								<span className="truncate text-vscode-foreground">
									Merge review saved · {mergeReviewEntries.length} agent
									{mergeReviewEntries.length === 1 ? "" : "s"}
								</span>
							</button>
							{isMergeReviewExpanded && (
								<div data-testid="merge-review-inline" className="mt-2 flex flex-col gap-2">
									{mergeReviewEntries.map((entry) => {
										const stats = getMergeReviewChangeStats(entry)
										const statsLabel = formatMergeReviewStatsLabel(stats, t)
										const hasDiff = hasMergeReviewDiff(entry)
										const isDiffExpanded = expandedMergeReviewDiffIds.has(entry.agentId)
										const mergeStatus = getMergeReviewEntryStatus(entry)

										return (
											<div
												key={entry.agentId}
												className="rounded border border-vscode-sideBar-background bg-vscode-editor-background/80 p-2">
												<div className="mb-1 flex min-w-0 flex-wrap items-baseline gap-1.5 text-vscode-foreground">
													<span className="font-medium">
														{labelByAgentId.get(entry.agentId) ??
															entry.mode ??
															entry.agentId}
													</span>
													<Badge
														data-testid={`merge-review-inline-status-${entry.agentId}`}
														className={cn(
															"shrink-0 capitalize",
															mergeReviewStatusBadgeClasses[mergeStatus],
														)}>
														{mergeStatus}
													</Badge>
													<span className="min-w-0 truncate text-vscode-descriptionForeground">
														{entry.task}
													</span>
													<span className="min-w-0 truncate font-mono text-vscode-descriptionForeground">
														{entry.branch}
													</span>
												</div>
												<div
													data-testid={`merge-review-inline-stats-${entry.agentId}`}
													className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-vscode-descriptionForeground"
													aria-label={statsLabel}>
													<span>
														{t("chat:parallelAgents.mergeReview.stats.files", {
															count: stats.filesChanged,
														})}
													</span>
													<span>
														{t("chat:parallelAgents.mergeReview.stats.lines", {
															count: stats.totalChanges,
														})}
													</span>
													<span className="font-mono text-vscode-charts-green">
														+{stats.additions}
													</span>
													<span className="font-mono text-vscode-charts-red">
														-{stats.deletions}
													</span>
													{stats.binaryFiles > 0 && (
														<span>
															{t("chat:parallelAgents.mergeReview.stats.binaryFiles", {
																count: stats.binaryFiles,
															})}
														</span>
													)}
												</div>
												{entry.autoMergeSkippedReason && (
													<div
														data-testid={`merge-review-inline-auto-skip-${entry.agentId}`}
														className="mb-2 flex items-start gap-1.5 rounded bg-vscode-editorWarning-foreground/10 p-2 text-[10px] text-vscode-editorWarning-foreground">
														<span className="codicon codicon-warning mt-0.5 shrink-0" />
														<span className="whitespace-pre-wrap break-words">
															{entry.autoMergeSkippedReason}
														</span>
													</div>
												)}
												{Boolean(entry.conflictedFiles?.length) && (
													<div
														data-testid={`merge-review-inline-conflicts-${entry.agentId}`}
														className="mb-2 flex flex-wrap items-center gap-1.5 rounded bg-vscode-errorForeground/10 p-2 text-[10px] text-vscode-errorForeground">
														<span className="codicon codicon-warning shrink-0" />
														{entry.conflictedFiles?.map((file) => (
															<span key={file} className="font-mono">
																{file}
															</span>
														))}
													</div>
												)}
												{entry.mergeError && (
													<pre
														data-testid={`merge-review-inline-merge-error-${entry.agentId}`}
														className="mb-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-vscode-errorForeground/10 p-2 font-mono text-[10px] text-vscode-errorForeground">
														{entry.mergeError}
													</pre>
												)}
												{entry.reviewError ? (
													<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-vscode-errorForeground/10 p-2 font-mono text-[10px] text-vscode-errorForeground">
														{entry.reviewError}
													</pre>
												) : hasDiff ? (
													<div className="rounded border border-vscode-sideBar-background bg-vscode-sideBar-background/30">
														<button
															type="button"
															data-testid={`merge-review-inline-diff-toggle-${entry.agentId}`}
															aria-expanded={isDiffExpanded}
															onClick={() => toggleMergeReviewDiff(entry.agentId)}
															className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-[10px] text-vscode-foreground hover:bg-vscode-list-hoverBackground/40 focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder">
															<span
																className={cn(
																	"codicon shrink-0 text-xs text-vscode-descriptionForeground",
																	isDiffExpanded
																		? "codicon-chevron-up"
																		: "codicon-chevron-down",
																)}
															/>
															<span>
																{isDiffExpanded
																	? t("chat:parallelAgents.mergeReview.hideDiff")
																	: t("chat:parallelAgents.mergeReview.showDiff")}
															</span>
														</button>
														{isDiffExpanded && (
															<div
																data-testid={`merge-review-inline-diff-${entry.agentId}`}
																className="max-h-80 overflow-auto border-t border-vscode-sideBar-background">
																<DiffView source={entry.diff} />
															</div>
														)}
													</div>
												) : (
													<pre className="whitespace-pre-wrap break-words rounded bg-vscode-sideBar-background/40 p-2 font-mono text-[10px] text-vscode-foreground">
														{entry.noChangesReason ||
															t("chat:parallelAgents.mergeReview.noChangesReported")}
													</pre>
												)}
											</div>
										)
									})}
								</div>
							)}
						</div>
					)}

					<ul className="mt-2 flex flex-col gap-1.5 border-t border-vscode-sideBar-background pt-2">
						{agents.map((agent) => {
							const waitingOn = agent.blockedOn
								.map((dependency) => labelByAgentId.get(dependency.agentId) ?? dependency.agentId)
								.join(", ")
							const agentLabel = getAgentModeLabel(agent.mode, customModes)
							const usage = getUsageSummary(agent.usage)
							const activity = agent.activity?.message
							const activityElapsed = getActivityElapsedLabel(agent.activity, now)
							const activityEvents = agent.activities
							const isExpanded = expandedAgentIds.has(agent.id)
							const detailsId = `agent-details-${agent.id}`
							const agentConflicts = conflicts.filter((conflict) => conflict.agentId === agent.id)

							return (
								<li key={agent.id} data-testid="agent-status-row" className="min-w-0 rounded-sm">
									<button
										type="button"
										data-testid="agent-status-toggle"
										aria-expanded={isExpanded}
										aria-controls={detailsId}
										onClick={() => toggleExpandedAgent(agent.id)}
										className="group flex w-full min-w-0 items-start gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-vscode-list-hoverBackground/40 focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder">
										<span
											className={cn(
												"codicon mt-0.5 shrink-0 text-sm",
												statusIconClasses[agent.status],
											)}
										/>
										<div className="min-w-0 flex-1">
											<div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
												<span className="shrink-0 font-medium text-vscode-foreground">
													{agentLabel}
												</span>
												<Badge
													className={cn(
														"shrink-0 capitalize",
														statusBadgeClasses[agent.status],
													)}>
													{agent.status}
												</Badge>
												<span className="min-w-0 truncate text-vscode-descriptionForeground">
													{agent.task}
												</span>
											</div>
											<div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-vscode-descriptionForeground">
												<span className="min-w-0 truncate font-mono">
													{agent.lastTouchedFile ??
														t("chat:parallelAgents.details.noFileWrites")}
												</span>
												<span>
													{waitingOn
														? t("chat:parallelAgents.details.waitingOn", {
																agents: waitingOn,
															})
														: t("chat:parallelAgents.details.ready")}
												</span>
												{usage && (
													<span data-testid="agent-usage" className="font-mono">
														{usage}
													</span>
												)}
												{agent.statusReason && (
													<span className="text-vscode-editorWarning-foreground">
														{agent.statusReason}
													</span>
												)}
											</div>
											{activity && (
												<div
													data-testid="agent-activity"
													className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-vscode-descriptionForeground">
													<span className="codicon codicon-comment-discussion mr-1" />
													<span className="min-w-0 truncate">{activity}</span>
													{activityElapsed && (
														<span
															data-testid="agent-activity-elapsed"
															className="shrink-0 text-vscode-descriptionForeground/75">
															{activityElapsed}
														</span>
													)}
												</div>
											)}
										</div>
										<span
											className={cn(
												"codicon mt-0.5 shrink-0 text-xs text-vscode-descriptionForeground opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100",
												isExpanded ? "codicon-chevron-up" : "codicon-chevron-down",
											)}
										/>
									</button>

									{isExpanded && (
										<div
											id={detailsId}
											data-testid="agent-details"
											className="ml-6 mt-1 rounded border border-vscode-sideBar-background bg-vscode-editor-background/60 p-2 text-[11px] text-vscode-descriptionForeground">
											<div className="mb-3">
												<div className="mb-1 font-medium text-vscode-foreground">
													{t("chat:parallelAgents.details.activity")}
												</div>
												<div
													data-testid="agent-details-activity"
													className="rounded border border-vscode-sideBar-background bg-vscode-editor-background/80 p-2">
													{activityEvents.length > 0 ? (
														<ol
															data-testid="agent-activity-timeline"
															className="flex min-w-0 flex-col gap-2">
															{activityEvents.map((activityEvent, index) => {
																const kind = getActivityKind(activityEvent)
																const repeatCount = activityEvent.count ?? 1
																const activityKey = getActivityKey(activityEvent, index)
																const timestampLabel = getActivityTimestampLabel(
																	activityEvent,
																	now,
																)
																const elapsedLabel = getActivityElapsedLabel(
																	activityEvent,
																	now,
																)

																return (
																	<Fragment key={activityKey}>
																		{activityEvent.hiddenBefore && (
																			<li
																				data-testid="agent-activity-hidden-count"
																				className="ml-5 text-vscode-descriptionForeground/80">
																				{activityEvent.hiddenBefore} older
																				activity events hidden
																			</li>
																		)}
																		<li
																			data-testid="agent-activity-event"
																			className="flex min-w-0 items-start gap-2">
																			<span
																				className={cn(
																					"codicon mt-0.5 shrink-0 text-xs",
																					activityIconClasses[kind],
																				)}
																			/>
																			<div className="min-w-0 flex-1 rounded-sm bg-vscode-sideBar-background/40 px-2 py-1">
																				<div className="mb-0.5 flex min-w-0 flex-wrap items-center gap-1.5 capitalize text-vscode-descriptionForeground/80">
																					<span data-testid="agent-activity-kind">
																						{getActivityKindLabel(
																							activityEvent,
																						)}
																					</span>
																					{repeatCount > 1 && (
																						<span data-testid="agent-activity-repeat-count">
																							×{repeatCount}
																						</span>
																					)}
																					{timestampLabel && elapsedLabel && (
																						<span
																							data-testid="agent-activity-timestamp"
																							className="normal-case text-vscode-descriptionForeground/70">
																							{timestampLabel} ·{" "}
																							{elapsedLabel}
																						</span>
																					)}
																				</div>
																				<div className="min-w-0 whitespace-pre-wrap text-vscode-foreground">
																					{activityEvent.message}
																				</div>
																			</div>
																		</li>
																	</Fragment>
																)
															})}
														</ol>
													) : (
														<span>{t("chat:parallelAgents.details.noActivity")}</span>
													)}
												</div>
											</div>
											<dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2">
												<dt className="font-medium text-vscode-foreground">
													{t("chat:parallelAgents.details.task")}
												</dt>
												<dd
													data-testid="agent-details-task"
													className="min-w-0 whitespace-pre-wrap">
													{agent.task}
												</dd>

												<dt className="font-medium text-vscode-foreground">
													{t("chat:parallelAgents.details.ownedFiles")}
												</dt>
												<dd data-testid="agent-owned-files" className="min-w-0">
													<ul className="flex min-w-0 flex-col gap-0.5">
														{agent.owns.map((ownership) => (
															<li
																key={`${ownership.path}:${ownership.mode}`}
																className="min-w-0 truncate">
																<span className="font-mono">{ownership.path}</span>{" "}
																<span className="text-vscode-descriptionForeground/80">
																	({ownership.mode})
																</span>
															</li>
														))}
													</ul>
												</dd>

												<dt className="font-medium text-vscode-foreground">
													{t("chat:parallelAgents.details.mustNotTouch")}
												</dt>
												<dd data-testid="agent-must-not-touch" className="min-w-0 font-mono">
													{agent.mustNotTouch.length > 0
														? agent.mustNotTouch.join(", ")
														: t("chat:parallelAgents.details.none")}
												</dd>

												<dt className="font-medium text-vscode-foreground">
													{t("chat:parallelAgents.details.status")}
												</dt>
												<dd className="min-w-0">
													<div className="flex min-w-0 flex-wrap items-center gap-1.5">
														<Badge
															className={cn(
																"capitalize",
																statusBadgeClasses[agent.status],
															)}>
															{agent.status}
														</Badge>
														{agent.statusReason && (
															<span className="text-vscode-editorWarning-foreground">
																{agent.statusReason}
															</span>
														)}
													</div>
												</dd>

												<dt className="font-medium text-vscode-foreground">
													{t("chat:parallelAgents.details.waiting")}
												</dt>
												<dd data-testid="agent-waiting" className="min-w-0">
													{waitingOn
														? t("chat:parallelAgents.details.waitingOn", {
																agents: waitingOn,
															})
														: t("chat:parallelAgents.details.ready")}
												</dd>

												<dt className="font-medium text-vscode-foreground">
													{t("chat:parallelAgents.details.lastTouched")}
												</dt>
												<dd
													data-testid="agent-last-touched"
													className="min-w-0 truncate font-mono">
													{agent.lastTouchedFile ??
														t("chat:parallelAgents.details.noFileWrites")}
												</dd>

												<dt className="font-medium text-vscode-foreground">
													{t("chat:parallelAgents.details.usage")}
												</dt>
												<dd data-testid="agent-details-usage" className="min-w-0 font-mono">
													{usage ?? t("chat:parallelAgents.details.noUsage")}
												</dd>

												<dt className="font-medium text-vscode-foreground">
													{t("chat:parallelAgents.details.worktree")}
												</dt>
												<dd data-testid="agent-worktree" className="min-w-0 truncate font-mono">
													{agent.worktreePath}
												</dd>

												<dt className="font-medium text-vscode-foreground">
													{t("chat:parallelAgents.details.conflicts")}
												</dt>
												<dd data-testid="agent-details-conflicts" className="min-w-0">
													{agentConflicts.length > 0 ? (
														<ul className="flex min-w-0 flex-col gap-1">
															{agentConflicts.map((conflict) => (
																<li
																	key={conflict.key}
																	className="min-w-0 text-vscode-editorWarning-foreground">
																	<span className="font-mono">
																		{conflict.filePath}
																	</span>
																	{conflict.ownerTask && (
																		<span> — {conflict.ownerTask}</span>
																	)}
																	{conflict.reason && (
																		<span>: {conflict.reason}</span>
																	)}
																</li>
															))}
														</ul>
													) : (
														t("chat:parallelAgents.details.noConflicts")
													)}
												</dd>
											</dl>
										</div>
									)}
								</li>
							)
						})}
					</ul>
				</ToolUseBlock>
			</div>
		</section>
	)
}

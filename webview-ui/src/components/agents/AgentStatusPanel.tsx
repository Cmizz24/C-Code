import { useEffect, useMemo, useState } from "react"
import type {
	AgentPlan,
	AgentStatus,
	AgentStatusUpdate,
	ClineSayTool,
	ExtensionMessage,
	WriteIntentConflict,
} from "@roo-code/types"

import { Badge, Button } from "@/components/ui"
import { ToolUseBlock, ToolUseBlockHeader } from "@/components/common/ToolUseBlock"
import { ProgressIndicator } from "@/components/chat/ProgressIndicator"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { formatLargeNumber } from "@/utils/format"
import { vscode } from "@/utils/vscode"

import { getAgentModeLabel } from "./agentDisplay"

type ConflictBanner = WriteIntentConflict & {
	key: string
}

interface AgentStatusPanelProps {
	tool?: ClineSayTool
}

type AgentActivity = NonNullable<ClineSayTool["agentActivities"]>[number]

const phaseLabels: Record<NonNullable<ClineSayTool["parallelStatus"]>, string> = {
	running: "running",
	review: "review ready",
	merged: "merged",
	cancelled: "cancelled",
	failed: "failed",
}

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
	const { activeExecutionPlan, customModes } = useExtensionState()
	const executionPlan = tool?.executionPlan ?? activeExecutionPlan
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
	const seededActivities = useMemo<Record<string, AgentActivity>>(
		() => Object.fromEntries((tool?.agentActivities ?? []).map((activity) => [activity.agentId, activity])),
		[tool?.agentActivities],
	)
	const [statusUpdates, setStatusUpdates] = useState<Record<string, AgentStatusUpdate>>(seededStatusUpdates)
	const [conflicts, setConflicts] = useState<ConflictBanner[]>(seededConflicts)
	const [activities, setActivities] = useState<Record<string, AgentActivity>>(seededActivities)

	useEffect(() => {
		setStatusUpdates(seededStatusUpdates)
		setConflicts(seededConflicts)
		setActivities(seededActivities)
	}, [executionPlan?.planId, seededActivities, seededConflicts, seededStatusUpdates])

	useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data

			switch (message.type) {
				case "agentStatusUpdate": {
					if (!message.agentStatusUpdate) {
						return
					}
					if (agentIds.size > 0 && !agentIds.has(message.agentStatusUpdate.agentId)) {
						return
					}

					setStatusUpdates((prev) => ({
						...prev,
						[message.agentStatusUpdate!.agentId]: {
							...prev[message.agentStatusUpdate!.agentId],
							...message.agentStatusUpdate!,
						},
					}))
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

		return executionPlan.agents.map((agent) => ({
			...agent,
			status: statusUpdates[agent.id]?.status ?? agent.status,
			lastTouchedFile: statusUpdates[agent.id]?.lastTouchedFile ?? findLastTouchedFile(agent),
			statusReason: statusUpdates[agent.id]?.reason,
			blockedOn: statusUpdates[agent.id]?.blockedOn ?? agent.dependsOn,
			usage: statusUpdates[agent.id]?.usage,
			activity: activities[agent.id],
		}))
	}, [activities, executionPlan, statusUpdates])

	if (!executionPlan) {
		return null
	}

	const labelByAgentId = new Map(
		executionPlan.agents.map((agent) => [agent.id, getAgentModeLabel(agent.mode, customModes)]),
	)
	const completeAgents = agents.filter((agent) => agent.status === "complete").length
	const phase = tool?.parallelStatus
	const overallStatus = phase === "failed" ? "failed" : getOverallStatus(agents)
	const runningAgents = agents.filter((agent) => agent.status === "running").length
	const usageCount = agents.filter((agent) => agent.usage).length
	const aggregateUsage = tool?.parallelUsageSummary
	const usageSummary = aggregateUsage
		? `${aggregateUsage.reportingAgents}/${agents.length} reporting · ↑ ${formatLargeNumber(aggregateUsage.totalTokensIn + aggregateUsage.totalCacheReads)} · ↓ ${formatLargeNumber(aggregateUsage.totalTokensOut)} · $${aggregateUsage.totalCost.toFixed(2)}`
		: usageCount > 0
			? `${usageCount}/${agents.length} reporting usage`
			: undefined
	const phaseLabel = phase ? phaseLabels[phase] : overallStatus

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
						{completeAgents}/{agents.length} complete · {runningAgents} running · Plan{" "}
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

					<ul className="mt-2 flex flex-col gap-1.5 border-t border-vscode-sideBar-background pt-2">
						{agents.map((agent) => {
							const waitingOn = agent.blockedOn
								.map((dependency) => labelByAgentId.get(dependency.agentId) ?? dependency.agentId)
								.join(", ")
							const agentLabel = getAgentModeLabel(agent.mode, customModes)
							const usage = getUsageSummary(agent.usage)
							const activity = agent.activity?.message

							return (
								<li
									key={agent.id}
									data-testid="agent-status-row"
									className="flex min-w-0 items-start gap-2">
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
												className={cn("shrink-0 capitalize", statusBadgeClasses[agent.status])}>
												{agent.status}
											</Badge>
											<span className="min-w-0 truncate text-vscode-descriptionForeground">
												{agent.task}
											</span>
										</div>
										<div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-vscode-descriptionForeground">
											<span className="min-w-0 truncate font-mono">
												{agent.lastTouchedFile ?? "No file writes yet"}
											</span>
											<span>{waitingOn ? `Waiting on ${waitingOn}` : "Ready"}</span>
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
												className="mt-0.5 truncate text-[11px] text-vscode-descriptionForeground">
												<span className="codicon codicon-comment-discussion mr-1" />
												{activity}
											</div>
										)}
									</div>
								</li>
							)
						})}
					</ul>
				</ToolUseBlock>
			</div>
		</section>
	)
}

import { useEffect, useMemo, useState } from "react"
import type { AgentPlan, AgentStatus, AgentStatusUpdate, ExtensionMessage, WriteIntentConflict } from "@roo-code/types"

import { Badge, Button } from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"

import { getAgentModeLabel } from "./agentDisplay"

type ConflictBanner = WriteIntentConflict & {
	key: string
}

const statusBadgeClasses: Record<AgentStatus, string> = {
	pending:
		"border-vscode-descriptionForeground/40 bg-vscode-descriptionForeground/10 text-vscode-descriptionForeground",
	running: "border-blue-400/50 bg-blue-500/15 text-blue-300 animate-pulse",
	blocked:
		"border-vscode-editorWarning-foreground/60 bg-vscode-editorWarning-foreground/15 text-vscode-editorWarning-foreground",
	complete: "border-vscode-charts-green/60 bg-vscode-charts-green/15 text-vscode-charts-green",
	failed: "border-vscode-errorForeground/60 bg-vscode-errorForeground/15 text-vscode-errorForeground",
}

const findLastTouchedFile = (agent: AgentPlan): string | undefined => {
	const exclusiveOrShared = agent.owns.find((ownership) => ownership.mode !== "read-only")
	return exclusiveOrShared?.path ?? agent.owns[0]?.path
}

export const AgentStatusPanel = () => {
	const { activeExecutionPlan, customModes } = useExtensionState()
	const [statusUpdates, setStatusUpdates] = useState<Record<string, AgentStatusUpdate>>({})
	const [conflicts, setConflicts] = useState<ConflictBanner[]>([])

	useEffect(() => {
		setStatusUpdates({})
		setConflicts([])
	}, [activeExecutionPlan?.planId])

	useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data

			switch (message.type) {
				case "agentStatusUpdate": {
					if (!message.agentStatusUpdate) {
						return
					}

					setStatusUpdates((prev) => ({
						...prev,
						[message.agentStatusUpdate!.agentId]: message.agentStatusUpdate!,
					}))
					break
				}
				case "writeIntentDenied": {
					if (!message.writeIntentConflict) {
						return
					}

					const conflict = message.writeIntentConflict
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
					setConflicts((prev) =>
						prev.filter((item) => !(item.agentId === agentId && item.filePath === filePath)),
					)
					break
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const agents = useMemo(() => {
		if (!activeExecutionPlan) {
			return []
		}

		return activeExecutionPlan.agents.map((agent) => ({
			...agent,
			status: statusUpdates[agent.id]?.status ?? agent.status,
			lastTouchedFile: statusUpdates[agent.id]?.lastTouchedFile ?? findLastTouchedFile(agent),
			statusReason: statusUpdates[agent.id]?.reason,
			blockedOn: statusUpdates[agent.id]?.blockedOn ?? agent.dependsOn,
		}))
	}, [activeExecutionPlan, statusUpdates])

	if (!activeExecutionPlan) {
		return null
	}

	const labelByAgentId = new Map(
		activeExecutionPlan.agents.map((agent) => [agent.id, getAgentModeLabel(agent.mode, customModes)]),
	)
	const completeAgents = agents.filter((agent) => agent.status === "complete").length

	return (
		<section
			data-testid="agent-status-chat-card"
			data-variant="compact-chat-tool"
			aria-label="Parallel agents status"
			className="rounded-md border border-vscode-panel-border/70 bg-vscode-editor-background/60 px-2.5 py-2 text-xs">
			<div className="mb-2 flex min-w-0 items-center gap-2 text-vscode-descriptionForeground">
				<span className="font-medium text-vscode-foreground">Parallel agents</span>
				<span className="truncate">
					{completeAgents}/{agents.length} complete · Plan {activeExecutionPlan.planId}
				</span>
			</div>

			{conflicts.length > 0 && (
				<div className="mb-2 flex flex-col gap-1.5">
					{conflicts.map((conflict) => (
						<div
							key={conflict.key}
							className="flex flex-wrap items-center gap-1.5 rounded border border-vscode-editorWarning-foreground/40 bg-vscode-editorWarning-foreground/10 px-2 py-1 text-[11px] text-vscode-foreground">
							<span className="font-medium">
								Blocked writing <span className="font-mono">{conflict.filePath}</span> — owned by{" "}
								<span>{conflict.ownerTask ?? "another agent task"}</span>
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

			<ul className="flex flex-col gap-1">
				{agents.map((agent) => {
					const waitingOn = agent.dependsOn
						.map((dependency) => labelByAgentId.get(dependency.agentId) ?? dependency.agentId)
						.join(", ")
					const agentLabel = getAgentModeLabel(agent.mode, customModes)

					return (
						<li
							key={agent.id}
							data-testid="agent-status-row"
							className="flex min-w-0 items-center gap-2 rounded border border-vscode-panel-border/60 bg-vscode-sideBar-background/50 px-2 py-1.5">
							<Badge className={cn("shrink-0 capitalize", statusBadgeClasses[agent.status])}>
								{agent.status}
							</Badge>
							<div className="min-w-0 flex-1">
								<div className="flex min-w-0 items-center gap-1.5">
									<span className="shrink-0 font-medium text-vscode-foreground">{agentLabel}</span>
									<span className="truncate text-vscode-descriptionForeground">{agent.task}</span>
								</div>
								<div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-vscode-descriptionForeground">
									<span className="min-w-0 truncate font-mono">
										{agent.lastTouchedFile ?? "No file writes yet"}
									</span>
									<span>{waitingOn ? `Waiting on ${waitingOn}` : "Ready"}</span>
									{agent.statusReason && (
										<span className="text-vscode-editorWarning-foreground">
											{agent.statusReason}
										</span>
									)}
								</div>
							</div>
						</li>
					)
				})}
			</ul>
		</section>
	)
}

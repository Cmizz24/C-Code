import { useEffect, useMemo, useState } from "react"
import type { AgentPlan, AgentStatus, AgentStatusUpdate, ExtensionMessage, WriteIntentConflict } from "@roo-code/types"

import { Badge, Button } from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"

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
	const { activeExecutionPlan } = useExtensionState()
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

	const taskByAgentId = new Map(activeExecutionPlan.agents.map((agent) => [agent.id, agent.task]))

	return (
		<section className="border-t border-vscode-panel-border bg-vscode-sideBar-background px-[15px] py-3">
			<div className="mb-3 flex items-center justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold text-vscode-foreground">Parallel agents</h2>
					<p className="text-xs text-vscode-descriptionForeground">
						Plan {activeExecutionPlan.planId} · {agents.length} agent{agents.length === 1 ? "" : "s"}
					</p>
				</div>
			</div>

			{conflicts.length > 0 && (
				<div className="mb-3 flex flex-col gap-2">
					{conflicts.map((conflict) => (
						<div
							key={conflict.key}
							className="rounded-md border border-vscode-editorWarning-foreground/50 bg-vscode-editorWarning-foreground/10 p-3 text-xs text-vscode-foreground">
							<div className="mb-2 font-medium">
								Blocked writing <span className="font-mono">{conflict.filePath}</span> — owned by{" "}
								<span>{conflict.ownerTask ?? "another agent task"}</span>
							</div>
							{conflict.reason && (
								<div className="mb-2 text-vscode-descriptionForeground">{conflict.reason}</div>
							)}
							<div className="flex flex-wrap gap-2">
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

			<div className="grid gap-2">
				{agents.map((agent) => {
					const waitingOn = agent.dependsOn
						.map((dependency) => taskByAgentId.get(dependency.agentId) ?? dependency.agentId)
						.join(", ")

					return (
						<article
							key={agent.id}
							className="rounded-md border border-vscode-panel-border bg-vscode-editor-background p-3 shadow-sm">
							<div className="mb-2 flex items-start justify-between gap-3">
								<div className="min-w-0">
									<div className="mb-1 text-sm font-medium text-vscode-foreground">{agent.task}</div>
									<div className="font-mono text-[11px] text-vscode-descriptionForeground">
										{agent.id}
									</div>
								</div>
								<Badge className={cn("shrink-0 capitalize", statusBadgeClasses[agent.status])}>
									{agent.status}
								</Badge>
							</div>

							<div className="grid gap-1 text-xs text-vscode-descriptionForeground">
								<div>
									<span className="text-vscode-foreground">Last touched:</span>{" "}
									<span className="font-mono">{agent.lastTouchedFile ?? "No file writes yet"}</span>
								</div>
								<div>
									<span className="text-vscode-foreground">Dependency:</span>{" "}
									{waitingOn ? `Waiting on ${waitingOn}` : "Ready"}
								</div>
								{agent.statusReason && (
									<div className="text-vscode-editorWarning-foreground">{agent.statusReason}</div>
								)}
							</div>
						</article>
					)
				})}
			</div>
		</section>
	)
}

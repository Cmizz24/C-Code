import { useEffect, useState } from "react"
import type { AgentPlan, ExecutionPlan } from "@roo-code/types"

import { Button, Textarea } from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"

import { getAgentModeLabel } from "./agentDisplay"

interface PlanPreviewModalProps {
	plan: ExecutionPlan
	onClose: () => void
}

const clonePlan = (plan: ExecutionPlan): ExecutionPlan => ({
	...plan,
	agents: plan.agents.map((agent) => ({
		...agent,
		owns: agent.owns.map((ownership) => ({ ...ownership })),
		mustNotTouch: [...agent.mustNotTouch],
		dependsOn: agent.dependsOn.map((dependency) => ({ ...dependency })),
		signals: [...agent.signals],
	})),
	fileOwnershipMap: { ...plan.fileOwnershipMap },
})

export const PlanPreviewModal = ({ plan, onClose }: PlanPreviewModalProps) => {
	const { customModes } = useExtensionState()
	const [editedPlan, setEditedPlan] = useState<ExecutionPlan>(() => clonePlan(plan))
	const [isCollapsed, setIsCollapsed] = useState(false)

	useEffect(() => {
		setEditedPlan(clonePlan(plan))
	}, [plan])

	const updateAgent = (agentId: string, updater: (agent: AgentPlan) => AgentPlan) => {
		setEditedPlan((current) => ({
			...current,
			agents: current.agents.map((agent) => (agent.id === agentId ? updater(agent) : agent)),
		}))
	}

	const approvePlan = () => {
		vscode.postMessage({ type: "approvePlan", executionPlan: editedPlan })
		onClose()
	}

	const cancelPlan = () => {
		vscode.postMessage({ type: "cancelPlan" })
		onClose()
	}

	const labelByAgentId = new Map(
		editedPlan.agents.map((agent) => [agent.id, getAgentModeLabel(agent.mode, customModes)]),
	)

	return (
		<aside
			data-testid="plan-preview-panel"
			className="fixed bottom-4 right-4 z-30 flex max-h-[min(76vh,720px)] w-[min(860px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-vscode-panel-border bg-vscode-editor-background shadow-lg">
			<header className="flex items-start justify-between gap-3 border-b border-vscode-panel-border p-4">
				<div>
					<h2 className="text-base font-semibold text-vscode-foreground">Review parallel execution plan</h2>
					<p className="mt-1 text-xs text-vscode-descriptionForeground">
						Approve this plan before Roo creates agent worktrees and starts parallel tasks.
					</p>
				</div>
				<Button variant="secondary" size="sm" onClick={() => setIsCollapsed((collapsed) => !collapsed)}>
					{isCollapsed ? "Expand" : "Collapse"}
				</Button>
			</header>

			{!isCollapsed && (
				<div className="space-y-4 overflow-y-auto p-4">
					<section className="rounded-md border border-vscode-panel-border bg-vscode-editor-background p-3">
						<div className="mb-2 text-xs font-semibold uppercase tracking-wide text-vscode-descriptionForeground">
							Shared context
						</div>
						<p className="whitespace-pre-wrap text-sm text-vscode-foreground">{editedPlan.sharedContext}</p>
					</section>

					<div className="space-y-3">
						{editedPlan.agents.map((agent) => (
							<section
								key={agent.id}
								className="rounded-md border border-vscode-panel-border bg-vscode-sideBar-background p-3">
								<div className="mb-3 flex items-center justify-between gap-2">
									<div>
										<h3 className="text-sm font-semibold text-vscode-foreground">
											{getAgentModeLabel(agent.mode, customModes)}
										</h3>
										<div
											className="font-mono text-[11px] text-vscode-descriptionForeground"
											title="Agent ID">
											{agent.id}
										</div>
									</div>
									<div className="text-xs capitalize text-vscode-descriptionForeground">
										{agent.status}
									</div>
								</div>

								<label className="mb-3 block text-xs font-medium text-vscode-descriptionForeground">
									Task description
									<Textarea
										className="mt-1 min-h-20"
										value={agent.task}
										onChange={(event) =>
											updateAgent(agent.id, (current) => ({
												...current,
												task: event.target.value,
											}))
										}
									/>
								</label>

								<div className="mb-3">
									<div className="mb-2 text-xs font-medium text-vscode-descriptionForeground">
										Owned files
									</div>
									<div className="flex flex-wrap gap-2">
										{agent.owns.length === 0 ? (
											<span className="text-xs text-vscode-descriptionForeground">
												No owned files
											</span>
										) : (
											agent.owns.map((ownership) => (
												<span
													key={`${agent.id}:${ownership.path}`}
													className="inline-flex items-center gap-2 rounded-full border border-vscode-panel-border bg-vscode-editor-background px-2 py-1 text-xs text-vscode-foreground">
													<span className="font-mono">{ownership.path}</span>
													<span className="text-vscode-descriptionForeground">
														{ownership.mode}
													</span>
													<button
														type="button"
														className="codicon codicon-close cursor-pointer text-vscode-descriptionForeground hover:text-vscode-foreground"
														aria-label={`Remove ${ownership.path}`}
														onClick={() =>
															updateAgent(agent.id, (current) => ({
																...current,
																owns: current.owns.filter(
																	(candidate) => candidate.path !== ownership.path,
																),
															}))
														}
													/>
												</span>
											))
										)}
									</div>
								</div>

								<div>
									<div className="mb-2 text-xs font-medium text-vscode-descriptionForeground">
										Dependencies
									</div>
									<div className="flex flex-wrap gap-2">
										{agent.dependsOn.length === 0 ? (
											<span className="rounded-full border border-vscode-panel-border px-2 py-1 text-xs text-vscode-descriptionForeground">
												No dependencies
											</span>
										) : (
											agent.dependsOn.map((dependency) => (
												<span
													key={`${agent.id}:${dependency.agentId}:${dependency.waitFor}:${dependency.signal ?? ""}`}
													className="rounded-full border border-vscode-panel-border bg-vscode-editor-background px-2 py-1 text-xs text-vscode-descriptionForeground">
													{labelByAgentId.get(dependency.agentId) ?? dependency.agentId} ·{" "}
													{dependency.waitFor}
													{dependency.signal ? ` · ${dependency.signal}` : ""}
												</span>
											))
										)}
									</div>
								</div>
							</section>
						))}
					</div>
				</div>
			)}

			<footer className="flex flex-wrap items-center justify-between gap-3 border-t border-vscode-panel-border bg-vscode-sideBar-background p-4">
				<p className="text-xs text-vscode-descriptionForeground">
					Chat remains visible while this plan waits for your approval.
				</p>
				<div className="flex gap-2">
					<Button variant="secondary" onClick={cancelPlan}>
						Cancel
					</Button>
					<Button variant="primary" onClick={approvePlan}>
						Approve plan
					</Button>
				</div>
			</footer>
		</aside>
	)
}

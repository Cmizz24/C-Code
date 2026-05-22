import { RooCodeEventName, type AgentPlan, type ExecutionPlan, type TaskProviderLike } from "@roo-code/types"

import { AgentBus } from "../agents/AgentBus"

type SpawnedTask = Awaited<ReturnType<TaskProviderLike["createTask"]>>

type AgentTaskProvider = TaskProviderLike & {
	createAgentWorktree?: (agentId: string, planId: string) => Promise<string>
	requestPlanApproval?: (plan: ExecutionPlan) => Promise<ExecutionPlan | undefined>
	showMergeReview?: (plan: ExecutionPlan) => Promise<void>
}

export class OrchestratorEventLoop {
	private readonly spawnedAgents = new Map<string, SpawnedTask>()
	private running = false

	constructor(
		private readonly provider: AgentTaskProvider,
		private readonly bus: AgentBus = AgentBus.getInstance(),
	) {}

	public start(plan: ExecutionPlan): void {
		if (this.running) {
			return
		}

		this.running = true
		void this.startAfterApproval(plan).catch((error) => {
			this.stop()
			Promise.resolve(this.provider.postStateToWebview()).catch(() => {})
		})
	}

	public stop(): void {
		if (!this.running) {
			return
		}

		this.running = false
		this.bus.off("agentUnblocked", this.spawnAgent)
		this.bus.off("allComplete", this.synthesizeCompletion)
	}

	private async startAfterApproval(plan: ExecutionPlan): Promise<void> {
		const approvedPlan = this.provider.requestPlanApproval ? await this.provider.requestPlanApproval(plan) : plan
		if (!approvedPlan || !this.running) {
			this.stop()
			return
		}

		this.bus.setExecutionPlan(approvedPlan)
		this.bus.on("agentUnblocked", this.spawnAgent)
		this.bus.on("allComplete", this.synthesizeCompletion)

		for (const agent of approvedPlan.agents.filter((candidate) => candidate.status === "pending")) {
			void this.spawnAgent(agent)
		}
	}

	private readonly spawnAgent = async (agent: AgentPlan): Promise<void> => {
		if (this.spawnedAgents.has(agent.id)) {
			return
		}

		try {
			const plan = this.bus.getExecutionPlan()
			if (plan && this.provider.createAgentWorktree) {
				agent.worktreePath = await this.provider.createAgentWorktree(agent.id, plan.planId)
			}

			this.bus.markRunning(agent.id)
			const task = await this.provider.createTask(
				this.buildAgentMessage(agent, plan),
				undefined,
				this.provider.getCurrentTask(),
				{
					mode: agent.mode,
					agentId: agent.id,
					workspacePath: agent.worktreePath,
					systemPromptSuffix: this.buildSystemPromptSuffix(agent, plan),
				},
			)
			this.spawnedAgents.set(agent.id, task)

			task.on(RooCodeEventName.TaskCompleted, () => this.bus.markComplete(agent.id))
			task.on(RooCodeEventName.TaskAborted, () => this.bus.markFailed(agent.id, "Agent task aborted."))
		} catch (error) {
			const message = error instanceof Error && error.message ? error.message : String(error)
			this.bus.markFailed(agent.id, message)
			Promise.resolve(this.provider.postStateToWebview()).catch(() => {})
		}
	}

	private readonly synthesizeCompletion = (plan: ExecutionPlan): void => {
		this.stop()
		this.provider.showMergeReview?.(plan).catch(() => {})
		this.provider.postStateToWebview().catch(() => {})
	}

	private buildAgentMessage(agent: AgentPlan, plan?: ExecutionPlan): string {
		return [
			`You are parallel agent ${agent.id} running in ${agent.mode} mode.`,
			plan?.sharedContext ? `Shared context:\n${plan.sharedContext}` : undefined,
			`Task:\n${agent.task}`,
			`Owned paths:\n${agent.owns.map((ownership) => `- ${ownership.path} (${ownership.mode})`).join("\n") || "- none"}`,
			`Must not touch:\n${agent.mustNotTouch.map((filePath) => `- ${filePath}`).join("\n") || "- none"}`,
			"Only edit files allowed by your ownership. Use attempt_completion when finished.",
		]
			.filter(Boolean)
			.join("\n\n")
	}

	private buildSystemPromptSuffix(agent: AgentPlan, plan?: ExecutionPlan): string {
		return [
			"Parallel agent coordination rules:",
			`- Agent id: ${agent.id}`,
			`- Execution plan: ${plan?.planId ?? "unknown"}`,
			"- Write access is coordinated automatically; denied writes mean another agent owns or is editing that path.",
			"- Do not edit mustNotTouch paths or paths owned exclusively by another agent.",
		].join("\n")
	}
}

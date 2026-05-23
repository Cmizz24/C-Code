import {
	RooCodeEventName,
	type AgentPlan,
	type ExecutionPlan,
	type TaskLike,
	type TaskProviderLike,
} from "@roo-code/types"

import { AgentBus } from "../agents/AgentBus"

type SpawnedTask = Awaited<ReturnType<TaskProviderLike["createTask"]>>
type SpawnedTaskRecord = {
	task: SpawnedTask
	onCompleted: () => void
	onAborted: () => void
}

type AgentTaskProvider = TaskProviderLike & {
	createAgentWorktree?: (agentId: string, planId: string) => Promise<string>
	removeAgentWorktree?: (worktreePath: string) => Promise<void>
	showMergeReview?: (plan: ExecutionPlan) => Promise<void>
}

export class OrchestratorEventLoop {
	private readonly spawnedAgents = new Map<string, SpawnedTaskRecord>()
	private orchestratorTask?: TaskLike
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
		void this.startAgents(plan).catch((error) => {
			const message = error instanceof Error && error.message ? error.message : String(error)
			for (const agent of plan.agents) {
				this.bus.markFailed(agent.id, message)
			}
			this.stop()
			Promise.resolve(this.provider.postStateToWebview()).catch(() => {})
		})
	}

	public stop(options: { abortSpawnedTasks?: boolean; reason?: string } = {}): void {
		if (!this.running) {
			if (options.abortSpawnedTasks) {
				this.cleanupSpawnedTasks(options)
			}
			return
		}

		this.running = false
		this.bus.off("agentUnblocked", this.spawnAgent)
		this.bus.off("allComplete", this.synthesizeCompletion)
		this.bus.off("allTerminal", this.synthesizeFailure)
		this.cleanupSpawnedTasks(options)
		this.orchestratorTask = undefined
	}

	private cleanupSpawnedTasks(options: { abortSpawnedTasks?: boolean; reason?: string } = {}): void {
		for (const [agentId, record] of this.spawnedAgents.entries()) {
			record.task.off(RooCodeEventName.TaskCompleted, record.onCompleted)
			record.task.off(RooCodeEventName.TaskAborted, record.onAborted)

			if (options.abortSpawnedTasks) {
				this.bus.markFailed(agentId, options.reason ?? "Parallel execution was cancelled.")
				Promise.resolve(record.task.abortTask()).catch(() => {})
			}
		}

		this.spawnedAgents.clear()
	}

	private async startAgents(plan: ExecutionPlan): Promise<void> {
		if (!this.running) {
			this.stop()
			return
		}

		this.bus.setExecutionPlan(plan)
		this.orchestratorTask = this.provider.getCurrentTask()
		this.bus.on("agentUnblocked", this.spawnAgent)
		this.bus.on("allComplete", this.synthesizeCompletion)
		this.bus.on("allTerminal", this.synthesizeFailure)

		for (const agent of plan.agents.filter((candidate) => candidate.status === "pending")) {
			void this.spawnAgent(agent)
		}
	}

	private readonly spawnAgent = async (agent: AgentPlan): Promise<void> => {
		if (this.spawnedAgents.has(agent.id)) {
			return
		}

		try {
			if (!this.running) {
				return
			}

			const plan = this.bus.getExecutionPlan()
			const agentMessage = this.buildAgentMessage(agent, plan)
			const systemPromptSuffix = this.buildSystemPromptSuffix(agent, plan)
			if (plan && this.provider.createAgentWorktree) {
				agent.worktreePath = await this.provider.createAgentWorktree(agent.id, plan.planId)
			}

			if (!this.running) {
				if (agent.worktreePath) {
					await this.provider.removeAgentWorktree?.(agent.worktreePath)
				}
				return
			}

			this.bus.markRunning(agent.id)
			const task = await this.provider.createTask(agentMessage, undefined, this.orchestratorTask, {
				mode: agent.mode,
				agentId: agent.id,
				background: true,
				workspacePath: agent.worktreePath,
				systemPromptSuffix,
			})

			if (!this.running) {
				Promise.resolve(task.abortTask()).catch(() => {})
				return
			}

			const onCompleted = () => this.bus.markComplete(agent.id)
			const onAborted = () => this.bus.markFailed(agent.id, "Agent task aborted.")
			this.spawnedAgents.set(agent.id, { task, onCompleted, onAborted })

			task.on(RooCodeEventName.TaskCompleted, onCompleted)
			task.on(RooCodeEventName.TaskAborted, onAborted)
		} catch (error) {
			const message = error instanceof Error && error.message ? error.message : String(error)
			this.bus.markFailed(agent.id, message)
			Promise.resolve(this.provider.postStateToWebview()).catch(() => {})
		}
	}

	private readonly synthesizeCompletion = (plan: ExecutionPlan): void => {
		const orchestratorTask = this.orchestratorTask as (TaskLike & { parallelExecutionPaused?: boolean }) | undefined
		if (orchestratorTask) {
			orchestratorTask.parallelExecutionPaused = false
		}
		this.stop()
		this.provider.showMergeReview?.(plan).catch(() => {})
		this.provider.postStateToWebview().catch(() => {})
	}

	private readonly synthesizeFailure = (_plan: ExecutionPlan): void => {
		const orchestratorTask = this.orchestratorTask as (TaskLike & { parallelExecutionPaused?: boolean }) | undefined
		if (orchestratorTask) {
			orchestratorTask.parallelExecutionPaused = false
		}
		this.stop()
		this.provider.postStateToWebview().catch(() => {})
	}

	private buildAgentMessage(agent: AgentPlan, plan?: ExecutionPlan): string {
		return [
			`You are agent ${agent.id}, running a normal single ${agent.mode} specialist task.`,
			plan?.sharedContext ? `Shared context:\n${plan.sharedContext}` : undefined,
			`Task:\n${agent.task}`,
			`Your single ownership scope (the only files or directories you may edit):\n${agent.owns.map((ownership) => `- ${ownership.path} (${ownership.mode})`).join("\n") || "- none"}`,
			`Must not touch:\n${agent.mustNotTouch.map((filePath) => `- ${filePath}`).join("\n") || "- none"}`,
			"Use normal sequential tool calls: call one tool, wait for its result, then decide the next step. Never combine multiple tool argument JSON objects into one tool call.",
			"Only edit files allowed by your ownership scope. Use attempt_completion when finished.",
		]
			.filter(Boolean)
			.join("\n\n")
	}

	private buildSystemPromptSuffix(agent: AgentPlan, plan?: ExecutionPlan): string {
		return [
			"Single-agent task guidance:",
			`- Agent id: ${agent.id}`,
			`- Execution plan: ${plan?.planId ?? "unknown"}`,
			"- Treat this as one normal specialist task with one ownership scope, not as a complex orchestration task.",
			"- Use normal sequential tool calls: call one tool, wait for its result, then decide the next step.",
			"- If another prompt mentions batching or parallelizing tools, this child task overrides it: use one tool call at a time unless the platform emits separate native tool calls.",
			"- Never concatenate multiple tool argument JSON objects into one tool call; each native tool call must have exactly one JSON argument object.",
			"- Write access is coordinated automatically; denied writes mean the path is outside your ownership scope or currently unavailable.",
			"- Do not edit mustNotTouch paths or paths owned exclusively by another agent.",
		].join("\n")
	}
}

import {
	RooCodeEventName,
	normalizeParallelTaskConcurrency,
	type AgentEvent,
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
	onInteractive: () => void
	onResumable: () => void
	onIdle: () => void
}

type AgentTaskProvider = TaskProviderLike & {
	createAgentWorktree?: (agentId: string, planId: string) => Promise<string>
	removeAgentWorktree?: (worktreePath: string) => Promise<void>
	showMergeReview?: (plan: ExecutionPlan) => Promise<void>
}

export class OrchestratorEventLoop {
	private readonly spawnedAgents = new Map<string, SpawnedTaskRecord>()
	private readonly spawningAgents = new Set<string>()
	private readonly maxConcurrentAgents: number
	private orchestratorTask?: TaskLike
	private running = false

	constructor(
		private readonly provider: AgentTaskProvider,
		private readonly bus: AgentBus = AgentBus.getInstance(),
		options: { maxConcurrentAgents?: number } = {},
	) {
		this.maxConcurrentAgents = normalizeParallelTaskConcurrency(options.maxConcurrentAgents)
	}

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
		this.bus.off("agentUnblocked", this.scheduleAgents)
		this.bus.off("event", this.onAgentEvent)
		this.bus.off("allComplete", this.synthesizeCompletion)
		this.bus.off("allTerminal", this.synthesizeFailure)
		this.spawningAgents.clear()
		this.cleanupSpawnedTasks(options)
		this.orchestratorTask = undefined
	}

	private cleanupSpawnedTask(agentId: string): SpawnedTaskRecord | undefined {
		const record = this.spawnedAgents.get(agentId)
		if (!record) {
			return undefined
		}

		record.task.off(RooCodeEventName.TaskCompleted, record.onCompleted)
		record.task.off(RooCodeEventName.TaskAborted, record.onAborted)
		record.task.off(RooCodeEventName.TaskInteractive, record.onInteractive)
		record.task.off(RooCodeEventName.TaskResumable, record.onResumable)
		record.task.off(RooCodeEventName.TaskIdle, record.onIdle)
		this.spawnedAgents.delete(agentId)
		return record
	}

	private cleanupSpawnedTasks(options: { abortSpawnedTasks?: boolean; reason?: string } = {}): void {
		for (const agentId of Array.from(this.spawnedAgents.keys())) {
			const record = this.cleanupSpawnedTask(agentId)
			if (!record) {
				continue
			}

			if (options.abortSpawnedTasks) {
				this.bus.markFailed(agentId, options.reason ?? "Parallel execution was cancelled.")
				Promise.resolve(record.task.abortTask()).catch(() => {})
			}
		}
	}

	private async startAgents(plan: ExecutionPlan): Promise<void> {
		if (!this.running) {
			this.stop()
			return
		}

		this.bus.setExecutionPlan(plan)
		this.orchestratorTask = this.provider.getCurrentTask()
		this.bus.on("agentUnblocked", this.scheduleAgents)
		this.bus.on("event", this.onAgentEvent)
		this.bus.on("allComplete", this.synthesizeCompletion)
		this.bus.on("allTerminal", this.synthesizeFailure)

		this.scheduleAgents()
	}

	private readonly onAgentEvent = (event: AgentEvent): void => {
		if (event.type === "COMPLETE" || event.type === "FAILED") {
			this.scheduleAgents()
		}
	}

	private readonly scheduleAgents = (): void => {
		if (!this.running) {
			return
		}

		const plan = this.bus.getExecutionPlan()
		if (!plan) {
			return
		}

		const availableSlots = this.maxConcurrentAgents - this.getActiveAgentCount(plan)
		if (availableSlots <= 0) {
			return
		}

		const runnableAgents = plan.agents.filter(
			(agent) =>
				agent.status === "pending" && !this.spawnedAgents.has(agent.id) && !this.spawningAgents.has(agent.id),
		)

		for (const agent of runnableAgents.slice(0, availableSlots)) {
			void this.spawnAgent(agent)
		}
	}

	private getActiveAgentCount(plan: ExecutionPlan): number {
		const runningAgentIds = new Set(
			plan.agents.filter((agent) => agent.status === "running").map((agent) => agent.id),
		)
		const spawningAgentCount = Array.from(this.spawningAgents).filter((agentId) => {
			if (runningAgentIds.has(agentId)) {
				return false
			}

			const agent = plan.agents.find((candidate) => candidate.id === agentId)
			return agent && agent.status !== "complete" && agent.status !== "failed"
		}).length

		return runningAgentIds.size + spawningAgentCount
	}

	private readonly spawnAgent = async (agent: AgentPlan): Promise<void> => {
		if (this.spawnedAgents.has(agent.id) || this.spawningAgents.has(agent.id)) {
			return
		}
		this.spawningAgents.add(agent.id)

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

			const onCompleted = () => {
				this.cleanupSpawnedTask(agent.id)
				this.bus.markComplete(agent.id)
			}
			const onAborted = () => {
				this.cleanupSpawnedTask(agent.id)
				this.bus.markFailed(agent.id, "Agent task aborted.")
			}
			const onInteractive = () =>
				this.handleWaitingBackgroundTask(agent.id, task, RooCodeEventName.TaskInteractive)
			const onResumable = () => this.handleWaitingBackgroundTask(agent.id, task, RooCodeEventName.TaskResumable)
			const onIdle = () => this.handleWaitingBackgroundTask(agent.id, task, RooCodeEventName.TaskIdle)
			this.spawnedAgents.set(agent.id, { task, onCompleted, onAborted, onInteractive, onResumable, onIdle })

			task.on(RooCodeEventName.TaskCompleted, onCompleted)
			task.on(RooCodeEventName.TaskAborted, onAborted)
			task.on(RooCodeEventName.TaskInteractive, onInteractive)
			task.on(RooCodeEventName.TaskResumable, onResumable)
			task.on(RooCodeEventName.TaskIdle, onIdle)
		} catch (error) {
			const message = error instanceof Error && error.message ? error.message : String(error)
			this.bus.markFailed(agent.id, message)
			Promise.resolve(this.provider.postStateToWebview()).catch(() => {})
		} finally {
			this.spawningAgents.delete(agent.id)
			this.scheduleAgents()
		}
	}

	private handleWaitingBackgroundTask(agentId: string, task: SpawnedTask, eventName: RooCodeEventName): void {
		if (!this.running) {
			return
		}

		const askType = task.taskAsk?.ask
		if (askType === "completion_result") {
			this.cleanupSpawnedTask(agentId)
			this.bus.markComplete(agentId)
			task.approveAsk()
			Promise.resolve(this.provider.postStateToWebview()).catch(() => {})
			return
		}

		const reason = this.describeWaitingBackgroundTask(task, eventName)
		this.cleanupSpawnedTask(agentId)
		this.bus.markFailed(agentId, reason)
		try {
			task.denyAsk({ text: reason })
		} catch {
			// Non-fatal: the ask may already have been cleared by the task.
		}
		Promise.resolve(task.abortTask()).catch(() => {})
		Promise.resolve(this.provider.postStateToWebview()).catch(() => {})
	}

	private describeWaitingBackgroundTask(task: SpawnedTask, eventName: RooCodeEventName): string {
		const askType = task.taskAsk?.ask
		if (askType) {
			return `Agent task requires ${askType} approval that cannot be surfaced from a background agent.`
		}

		if (eventName === RooCodeEventName.TaskIdle) {
			return "Agent task is idle and cannot continue without parent approval."
		}

		return "Agent task is waiting for an unsupported background interaction."
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
			"Complete your assigned scope directly; do not delegate, spawn, or orchestrate additional tasks.",
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
			"- Complete your assigned scope directly; do not delegate, spawn, or orchestrate additional tasks.",
			"- Write access is coordinated automatically; denied writes mean the path is outside your ownership scope or currently unavailable.",
			"- Do not edit mustNotTouch paths or paths owned exclusively by another agent.",
		].join("\n")
	}
}

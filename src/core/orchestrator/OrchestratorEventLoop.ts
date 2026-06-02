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

const BACKGROUND_AGENT_FILE_WRITE_GUIDANCE =
	"When creating or editing file contents, prefer the normal write/edit tools available in this mode (write_to_file, apply_patch, apply_diff, edit, edit_file, search_replace) instead of execute_command shell here-strings, heredocs, or echo chains. Use execute_command for commands, tests, builds, package managers, scripts, or shell operations, not for embedding large file contents."

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
				Promise.resolve(record.task.abortTask(true)).catch(() => {})
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

			const task = await this.provider.createTask(agentMessage, undefined, this.orchestratorTask, {
				mode: agent.mode,
				agentId: agent.id,
				background: true,
				workspacePath: agent.worktreePath,
				systemPromptSuffix,
				startTask: false,
			})

			if (!this.running) {
				Promise.resolve(task.abortTask(true)).catch(() => {})
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

			if (!this.running) {
				this.cleanupSpawnedTask(agent.id)
				Promise.resolve(task.abortTask(true)).catch(() => {})
				return
			}

			try {
				this.bus.markRunning(agent.id)
				task.start()
			} catch (error) {
				this.cleanupSpawnedTask(agent.id)
				throw error
			}
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
		if (askType === "mistake_limit_reached") {
			this.bus.reportProgress(
				agentId,
				"Automatically continued after the agent reached the internal mistake limit; background agents cannot request hidden guidance.",
				"wait",
			)
			task.approveAsk()
			Promise.resolve(this.provider.postStateToWebview()).catch(() => {})
			return
		}

		if (askType === "completion_result") {
			this.cleanupSpawnedTask(agentId)
			this.bus.markComplete(agentId)
			task.approveAsk()
			Promise.resolve(task.abortTask(true)).catch(() => {})
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
		Promise.resolve(task.abortTask(true)).catch(() => {})
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
		const dependencyContext = this.buildDependencyContext(agent)

		return [
			`You are agent ${agent.id}, running a normal single ${agent.mode} specialist task.`,
			plan?.sharedContext ? `Shared context:\n${plan.sharedContext}` : undefined,
			plan?.sharedContract
				? `Shared contract (must follow and acknowledge before completion):\n${plan.sharedContract}`
				: undefined,
			dependencyContext ? `Non-blocking dependency context:\n${dependencyContext}` : undefined,
			`Task:\n${agent.task}`,
			`Your primary ownership scope (advisory — you may edit files outside this scope when needed, but prefer files in scope):\n${agent.owns.map((ownership) => `- ${ownership.path} (${ownership.mode})`).join("\n") || "- none"}`,
			`Must not touch:\n${agent.mustNotTouch.map((filePath) => `- ${filePath}`).join("\n") || "- none"}`,
			"Use normal sequential tool calls: call one tool, wait for its result, then decide the next step. Never combine multiple tool argument JSON objects into one tool call.",
			BACKGROUND_AGENT_FILE_WRITE_GUIDANCE,
			"Prefer editing files in your ownership scope. You may edit files outside your scope when necessary for your task, but never edit mustNotTouch paths. Use attempt_completion when finished.",
			"Complete your assigned scope directly; do not delegate, spawn, or orchestrate additional tasks.",
			"IMPORTANT — Before editing any shared file (styles, layouts, shared components, shared configs, shared constants, or any file another agent may also edit), you MUST first use coordinate_agents to read team chat and check for existing contracts. If no contract exists for the shared resource, publish a coordinate_agents question to the relevant sibling agent proposing specific class names, selectors, variable names, file paths, or API shapes. Wait for an answer when a sibling owns the contract. This prevents mismatched styles, layouts, and interfaces between agents.",
			"Use coordinate_agents for genuine live coordination: read team chat before shared edits, before attempt_completion, when you need current coordination state, need to answer an open targeted question, or need to check whether an answer to your own question arrived.",
			"Publish coordinate_agents question/answer messages for targeted contract gaps. Publish kind='decision' when you choose or confirm a shared interface, kind='note' for a concrete integration assumption or discovery peers need, and kind='blocker' when a cross-agent integration issue blocks safe progress.",
			"Publish a coordinate_agents question proactively when a shared integration contract is missing, ambiguous, or likely to affect another agent's work; do not guess UI/CSS/component interfaces, DOM structure, class names, selectors, IDs, data attributes, API shapes, file paths, user-facing names, or timing. Answer targeted open questions concisely with replyToId when available, even if your assigned edits are complete.",
			"If you read an answer, decision, note, or blocker that affects your scope, adapt your files or final result around the answered hook, selector, variable, data attribute, public function, file contract, or user-facing name before finishing.",
			"Before attempt_completion, read team chat again and resolve targeted open questions, newly published decisions/notes, or blockers relevant to your files. If the plan includes a Shared contract, apply it and call coordinate_agents with action='acknowledge_contract' before finishing. If you made a shared assumption or changed a shared contract, publish a short decision or note before finishing.",
			"Do not post ownership or introduction messages such as 'I own <file>' or 'Agent <id> owns <file>'. coordinate_agents publish is for real questions, answers, decisions, assumption notes, and blockers only.",
			"Do not post pre-planned, basic, or filler questions just to populate team chat. Ask one relevant agent one short shared-contract question at a time with targetAgentId where possible; answer with only the key hook, selector, variable, file, or decision needed.",
			"After you call attempt_completion or receive a terminal completion result, do not publish more team-chat messages; final evidence belongs in structured completion status.",
			"Avoid manifest-style messages listing many selectors, classes, variables, hooks, files, or implementation details. Keep messages operational. Never include emojis, private reasoning, chain-of-thought, credentials, profile details, or user secrets.",
		]
			.filter(Boolean)
			.join("\n\n")
	}

	private buildSystemPromptSuffix(agent: AgentPlan, plan?: ExecutionPlan): string {
		const dependencyContext = this.buildDependencyContext(agent)

		return [
			"Single-agent task guidance:",
			`- Agent id: ${agent.id}`,
			`- Execution plan: ${plan?.planId ?? "unknown"}`,
			plan?.sharedContract
				? `- Shared contract (must follow and acknowledge before completion):\n${plan.sharedContract}`
				: undefined,
			dependencyContext ? `- Non-blocking dependency context:\n${dependencyContext}` : undefined,
			"- Treat this as one normal specialist task with one ownership scope, not as a complex orchestration task.",
			"- Use normal sequential tool calls: call one tool, wait for its result, then decide the next step.",
			"- If another prompt mentions batching or parallelizing tools, this child task overrides it: use one tool call at a time unless the platform emits separate native tool calls.",
			"- Never concatenate multiple tool argument JSON objects into one tool call; each native tool call must have exactly one JSON argument object.",
			`- ${BACKGROUND_AGENT_FILE_WRITE_GUIDANCE}`,
			"- Complete your assigned scope directly; do not delegate, spawn, or orchestrate additional tasks.",
			"- Ownership is advisory: you may write outside your primary scope when needed, but never edit mustNotTouch paths. Prefer files in your ownership scope.",
			"- IMPORTANT: Before editing any shared file (styles, layouts, shared components, shared configs, constants, or files another agent may also edit), first read team chat with coordinate_agents and check for existing contracts. If no contract exists, publish a question proposing specific class names, selectors, variables, file paths, or API shapes and wait for an answer when a sibling owns the contract.",
			"- Use coordinate_agents for genuine live coordination: read before shared edits, before attempt_completion, when you need current coordination state, need to answer an open targeted question, or need to check whether an answer to your own question arrived.",
			"- Publish coordinate_agents question/answer messages for targeted contract gaps. Publish kind='decision' when you choose or confirm a shared interface, kind='note' for a concrete integration assumption or discovery peers need, and kind='blocker' when a cross-agent integration issue blocks safe progress.",
			"- Publish a coordinate_agents question proactively when a shared integration contract is missing, ambiguous, or likely to affect another agent's work; do not guess UI/CSS/component interfaces, DOM structure, class names, selectors, IDs, data attributes, API shapes, file paths, user-facing names, or timing. Answer targeted open questions concisely with replyToId when available, even if your assigned edits are complete.",
			"- If you read an answer, decision, note, or blocker that affects your scope, adapt your files or final result around the answered hook, selector, variable, data attribute, public function, file contract, or user-facing name before finishing.",
			"- Before attempt_completion, read team chat again and resolve targeted open questions, newly published decisions/notes, or blockers relevant to your files. If the plan includes a Shared contract, apply it and call coordinate_agents with action='acknowledge_contract' before finishing. If you made a shared assumption or changed a shared contract, publish a short decision or note before finishing.",
			"- Do not post ownership or introduction messages such as 'I own <file>' or 'Agent <id> owns <file>'. coordinate_agents publish is for real questions, answers, decisions, assumption notes, and blockers only.",
			"- Do not post pre-planned, basic, or filler questions just to populate team chat. Ask one relevant agent one short shared-contract question at a time with targetAgentId where possible, and answer with only the key hook, selector, variable, file, or decision needed.",
			"- After attempt_completion or terminal completion, stop publishing team-chat messages; final evidence belongs in structured completion status.",
			"- If many details are truly needed, split them into multiple short messages. Avoid manifest-style dumps listing many selectors, classes, variables, hooks, files, or implementation details.",
			"- Coordinate only when needed for shared filenames, selectors, classes, CSS variables, DOM hooks, IDs, data attributes, public functions, responsibilities, or file contracts; do not invent fake conversation.",
			"- Never put emojis, private reasoning, chain-of-thought, credentials, profile details, or user secrets in coordinate_agents messages.",
		]
			.filter(Boolean)
			.join("\n")
	}

	private buildDependencyContext(agent: AgentPlan): string {
		return agent.dependsOn
			.map((dependency) => {
				const coordinationPoint =
					dependency.waitFor === "signal"
						? `signal${dependency.signal ? ` ${dependency.signal}` : ""}`
						: "completion context"
				return `- Coordinate with ${dependency.agentId} (${coordinationPoint}, non-blocking)${dependency.context ? `: ${dependency.context}` : ""}`
			})
			.join("\n")
	}
}

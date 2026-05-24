import type OpenAI from "openai"

const PLAN_PARALLEL_TASKS_DESCRIPTION = `Create an execution plan for independent agents only when the user explicitly asks for parallel agents or the work can be split across multiple agents that own non-conflicting files. Do not use this tool for simple single-file edits or ordinary sequential implementation. After the user approves the plan, Roo starts the agents programmatically as normal single-scope specialist tasks; do not call new_task for these parallel agents. The tool validates file ownership conflicts and dependency cycles, then registers the plan for write coordination.`

export interface PlanParallelTasksToolOptions {
	/** Maximum total agents allowed in a single plan. */
	maxAgents?: number
}

export function createPlanParallelTasksTool(
	options: PlanParallelTasksToolOptions = {},
): OpenAI.Chat.ChatCompletionTool {
	const maxAgents =
		typeof options.maxAgents === "number" && Number.isFinite(options.maxAgents)
			? Math.trunc(options.maxAgents)
			: undefined
	const maxAgentsDescription =
		maxAgents && maxAgents > 0
			? ` The plan must include at most ${maxAgents} total agents; the backend will reject plans with more agents.`
			: ""

	return {
		type: "function",
		function: {
			name: "plan_parallel_tasks",
			description: `${PLAN_PARALLEL_TASKS_DESCRIPTION}${maxAgentsDescription}`,
			strict: true,
			parameters: {
				type: "object",
				properties: {
					goal: {
						type: "string",
						description: "Overall user goal that the parallel agents should accomplish.",
					},
					sharedContext: {
						type: "string",
						description: "Context shared with every agent, including constraints and relevant discoveries.",
					},
					expectedFiles: {
						type: "array",
						description: "Files expected to be modified or coordinated by the plan.",
						items: { type: "string" },
					},
					agents: {
						type: "array",
						description:
							maxAgents && maxAgents > 0
								? `Parallel agent definitions with ownership and dependencies. Include at most ${maxAgents} agents total.`
								: "Parallel agent definitions with ownership and dependencies.",
						...(maxAgents && maxAgents > 0 ? { maxItems: maxAgents } : {}),
						items: {
							type: "object",
							properties: {
								id: { type: "string", description: "Stable unique agent id." },
								mode: {
									type: "string",
									description: "Mode slug for the specialist agent assigned to this task.",
								},
								task: { type: "string", description: "Precise task instructions for this agent." },
								owns: {
									type: "array",
									description: "Files or directories this agent owns.",
									items: {
										type: "object",
										properties: {
											path: { type: "string" },
											mode: { type: "string", enum: ["exclusive", "read-only", "shared"] },
										},
										required: ["path", "mode"],
										additionalProperties: false,
									},
								},
								mustNotTouch: {
									type: "array",
									description: "Files or directories this agent must not edit.",
									items: { type: "string" },
								},
								dependsOn: {
									type: "array",
									description: "Dependencies that must complete or signal before this agent runs.",
									items: {
										type: "object",
										properties: {
											agentId: { type: "string" },
											waitFor: { type: "string", enum: ["complete", "signal"] },
											signal: { type: "string" },
											context: { type: "string" },
										},
										required: ["agentId", "waitFor"],
										additionalProperties: false,
									},
								},
								worktreePath: {
									type: "string",
									description: "Optional precomputed worktree path. Usually omit this.",
								},
								signals: {
									type: "array",
									description: "Signals this agent is expected to emit.",
									items: { type: "string" },
								},
							},
							required: ["id", "mode", "task", "owns", "mustNotTouch", "dependsOn", "signals"],
							additionalProperties: false,
						},
					},
				},
				required: ["goal", "sharedContext", "expectedFiles", "agents"],
				additionalProperties: false,
			},
		},
	} satisfies OpenAI.Chat.ChatCompletionTool
}

export default createPlanParallelTasksTool()

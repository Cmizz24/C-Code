import type OpenAI from "openai"

const PLAN_PARALLEL_TASKS_DESCRIPTION = `Create an execution plan for independent agents only when the user explicitly asks for parallel agents or the work can be split across multiple agents that own non-conflicting files. Do not use this tool for simple single-file edits or ordinary sequential implementation. Use sharedContext and each agent task to document planned interface contracts, UI/CSS/component contracts, DOM structure, class names, selectors, IDs, data attributes, API shapes, file paths, timing, README, onboarding, and documentation contracts so agents with non-conflicting ownership can start together. When a contract is known, put it in sharedContext and the relevant agent task instead of leaving agents to infer it. Tell agents to use coordinate_agents for genuine targeted Q/A when a shared contract becomes missing, ambiguous, or likely to affect another agent's work instead of guessing. Use dependsOn only as non-blocking coordination metadata for useful context about another agent's completion or a narrow signal; dependencies do not prevent an agent from starting. Do not make independent implementation agents depend on README, onboarding, or documentation agents; if that context is truly required, generate or verify it before creating the parallel plan. Do not create or preserve a separate manual "Review and verify the result" todo solely for this parallel plan: after clean structured plan-level completion/merge/validation evidence, that evidence satisfies redundant review/verification todos. Perform manual verification only when evidence is missing, failed, inconclusive, contradicted, or explicitly requested by the user. After the user approves the plan, Roo starts the agents programmatically as normal single-scope specialist tasks; do not call new_task for these parallel agents. The tool validates file ownership conflicts and dependency cycles, then registers the plan for write coordination.`

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
						description:
							"Context shared with every agent, including constraints, planned interface contracts, UI/CSS/component contracts, DOM structure, class names, selectors, IDs, data attributes, API shapes, file paths, timing, and relevant discoveries that let independent agents run without blocking on each other.",
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
								task: {
									type: "string",
									description:
										"Precise task instructions for this agent. Include known shared contracts and tell the agent to ask genuine coordinate_agents Q/A instead of guessing when UI/CSS/component, DOM, class, selector, ID, data attribute, API shape, file path, user-facing name, or timing details become missing or ambiguous.",
								},
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
									description:
										"Non-blocking coordination context about another agent's completion or a narrow signal. These dependencies are included in child prompts but do not prevent this agent from starting; use sharedContext/task-level contracts for known interface details. Do not add README/onboarding/documentation agents as dependencies for independent implementation agents.",
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

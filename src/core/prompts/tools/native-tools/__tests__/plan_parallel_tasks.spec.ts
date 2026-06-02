import { createPlanParallelTasksTool } from "../plan_parallel_tasks"

describe("createPlanParallelTasksTool", () => {
	it("adds configured max-agent guidance and schema cap", () => {
		const tool = createPlanParallelTasksTool({ maxAgents: 5 }) as any
		const parameters = tool.function.parameters as any

		expect(tool.function.description).toContain("at most 5 total agents")
		expect(parameters.properties.agents.description).toContain("at most 5 agents total")
		expect(parameters.properties.agents.maxItems).toBe(5)
	})

	it("omits maxItems when no positive max-agent cap is configured", () => {
		const tool = createPlanParallelTasksTool() as any
		const parameters = tool.function.parameters as any

		expect(parameters.properties.agents.maxItems).toBeUndefined()
	})

	it("guides plans toward shared contracts instead of unnecessary completion blockers", () => {
		const tool = createPlanParallelTasksTool() as any
		const parameters = tool.function.parameters as any
		const agentProperties = parameters.properties.agents.items.properties

		expect(tool.function.description).toContain("sharedContext")
		expect(tool.function.description).toContain("sharedContract")
		expect(tool.function.description).toContain("UI/CSS/component contracts")
		expect(tool.function.description).toContain(
			"DOM structure, class names, selectors, IDs, data attributes, API shapes",
		)
		expect(tool.function.description).toContain("must acknowledge it through coordinate_agents before completion")
		expect(tool.function.description).toContain("coordinate_agents for genuine targeted Q/A")
		expect(tool.function.description).toContain("instead of guessing")
		expect(tool.function.description).toContain("Use dependsOn only as non-blocking coordination metadata")
		expect(tool.function.description).toContain("dependencies do not prevent an agent from starting")
		expect(parameters.properties.sharedContext.description).toContain("General context shared with every agent")
		expect(parameters.properties.sharedContext.description).toContain("Put enforceable selectors")
		expect(parameters.properties.sharedContract.description).toContain("Explicit enforceable shared contract")
		expect(parameters.properties.sharedContract.description).toContain("acknowledge before completion")
		expect(parameters.properties.sharedContract.description).toContain(
			"selectors, class names, IDs, data attributes",
		)
		expect(parameters.required).toContain("sharedContract")
		expect(agentProperties.task.description).toContain("relevant sharedContract details")
		expect(agentProperties.task.description).toContain("coordinate_agents Q/A instead of guessing")
		expect(agentProperties.dependsOn.description).toContain("Non-blocking coordination context")
		expect(agentProperties.dependsOn.description).toContain("do not prevent this agent from starting")
		expect(agentProperties.dependsOn.description).toContain("sharedContract/task-level contracts")
	})

	it("treats clean structured parallel evidence as sufficient verification", () => {
		const tool = createPlanParallelTasksTool() as any

		expect(tool.function.description).toContain(
			'Do not create or preserve a separate manual "Review and verify the result" todo',
		)
		expect(tool.function.description).toContain("clean structured plan-level completion/merge/validation evidence")
		expect(tool.function.description).toContain("Perform manual verification only when evidence is missing")
	})
})

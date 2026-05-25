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
		expect(tool.function.description).toContain("planned interface contracts")
		expect(tool.function.description).toContain("Add dependsOn only for true runtime blockers")
		expect(tool.function.description).toContain("avoid waitFor=complete")
		expect(parameters.properties.sharedContext.description).toContain("planned interface contracts")
		expect(agentProperties.dependsOn.description).toContain("True blockers")
		expect(agentProperties.dependsOn.description).toContain("planned contract")
	})
})

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
})

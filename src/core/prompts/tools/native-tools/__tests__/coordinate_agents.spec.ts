import coordinateAgentsTool from "../coordinate_agents"

describe("coordinate_agents native tool", () => {
	it("guides background agents to use bounded plain-language team chat without private reasoning", () => {
		const tool = (coordinateAgentsTool as any).function
		const description = `${tool.description ?? ""} ${tool.parameters ? JSON.stringify(tool.parameters) : ""}`

		expect(description).toContain("team chat")
		expect(description).toContain("ask direct questions")
		expect(description).toContain("answer another agent")
		expect(description).toContain("selectors/classes/hooks/filenames/variables")
		expect(description).toContain("Do not include emojis")
		expect(description).toContain("chain-of-thought")
		expect(description).not.toContain("contract")
		expect(description).not.toMatch(/\p{Extended_Pictographic}/u)
	})
})

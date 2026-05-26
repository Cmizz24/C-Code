import coordinateAgentsTool from "../coordinate_agents"

describe("coordinate_agents native tool", () => {
	it("guides background agents to use bounded plain-language team chat without private reasoning", () => {
		const tool = (coordinateAgentsTool as any).function
		const description = `${tool.description ?? ""} ${tool.parameters ? JSON.stringify(tool.parameters) : ""}`

		expect(description).toContain("team chat")
		expect(description).toContain('{"action":"read","limit":8}')
		expect(description).toContain('{"action":"publish","kind":"question","message":"..."}')
		expect(description).toContain('{"action":"publish","kind":"answer","message":"..."}')
		expect(description).toContain("one short question or one short answer")
		expect(description).toContain("Ask the specific relevant agent")
		expect(description).toContain("only the key hook, selector, variable, file, or decision")
		expect(description).toContain("Avoid manifest-style dumps")
		expect(description).toContain("split them into multiple short messages")
		expect(description).toContain("complete or otherwise terminal")
		expect(description).toContain("structured completion status, not team chat")
		expect(description).toContain("prefer under 140")
		expect(description).toContain("Do not include emojis")
		expect(description).toContain("chain-of-thought")
		expect(description).not.toMatch(/\p{Extended_Pictographic}/u)
	})

	it("keeps schema bounds strict while documenting clean read and publish shapes", () => {
		const parameters = (coordinateAgentsTool as any).function.parameters

		expect(parameters.properties.kind.enum).toEqual(["note", "question", "answer", "decision", "blocker"])
		expect(parameters.properties.message.maxLength).toBe(240)
		expect(parameters.properties.relatedFiles.maxItems).toBe(8)
		expect(parameters.properties.relatedFiles.items.maxLength).toBe(200)
		expect(parameters.properties.limit.minimum).toBe(1)
		expect(parameters.properties.limit.maximum).toBe(20)
		expect(parameters.additionalProperties).toBe(false)
	})
})

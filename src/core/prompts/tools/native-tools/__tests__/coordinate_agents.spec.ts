import coordinateAgentsTool from "../coordinate_agents"

describe("coordinate_agents native tool", () => {
	it("guides background agents to use bounded plain-language team chat without private reasoning", () => {
		const tool = (coordinateAgentsTool as any).function
		const description = `${tool.description ?? ""} ${tool.parameters ? JSON.stringify(tool.parameters) : ""}`

		expect(description).toContain("team chat")
		expect(description).toContain('{"action":"read","limit":8}')
		expect(description).toContain('{"action":"publish","kind":"note","message":"..."}')
		expect(description).toContain("Before your first write")
		expect(description).toContain("ask direct questions")
		expect(description).toContain("answer another agent")
		expect(description).toContain(
			"selectors/classes/hooks/filenames/CSS variables/DOM hooks/IDs/data attributes/public functions",
		)
		expect(description).toContain("file contracts")
		expect(description).toContain("Do not include emojis")
		expect(description).toContain("chain-of-thought")
		expect(description).not.toMatch(/\p{Extended_Pictographic}/u)
	})

	it("keeps schema bounds strict while documenting clean read and publish shapes", () => {
		const parameters = (coordinateAgentsTool as any).function.parameters

		expect(parameters.properties.kind.enum).toEqual(["note", "question", "answer", "decision", "blocker"])
		expect(parameters.properties.message.maxLength).toBe(500)
		expect(parameters.properties.relatedFiles.maxItems).toBe(8)
		expect(parameters.properties.relatedFiles.items.maxLength).toBe(200)
		expect(parameters.properties.limit.minimum).toBe(1)
		expect(parameters.properties.limit.maximum).toBe(20)
		expect(parameters.additionalProperties).toBe(false)
	})
})

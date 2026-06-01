import coordinateAgentsTool from "../coordinate_agents"

describe("coordinate_agents native tool", () => {
	it("guides background agents to use bounded team chat without ownership intros", () => {
		const tool = (coordinateAgentsTool as any).function
		const description = `${tool.description ?? ""} ${tool.parameters ? JSON.stringify(tool.parameters) : ""}`

		expect(description).toContain("team chat")
		expect(description).toContain("real model-published coordination")
		expect(description).toContain("Use action=read before editing shared files")
		expect(description).toContain("before completing")
		expect(description).toContain("missing, ambiguous, or likely to affect another agent's work")
		expect(description).toContain('{"action":"read","limit":8}')
		expect(description).toContain(
			'{"action":"publish","kind":"question","message":"...","targetAgentId":"agent-id"}',
		)
		expect(description).toContain(
			'{"action":"publish","kind":"answer","message":"...","replyToId":"...","targetAgentId":"agent-id"}',
		)
		expect(description).toContain("decision")
		expect(description).toContain("assumption")
		expect(description).toContain("blocker")
		expect(description).toContain("replyToId")
		expect(description).toContain("Answers must reply to a question")
		expect(description).toContain("adapt your files")
		expect(description).toContain("Do not publish ownership introductions")
		expect(description).toContain("I own <file>")
		expect(description).toContain("Agent <id> owns <file>")
		expect(description).toContain("For publishing")
		expect(description).toContain("targeted integration question")
		expect(description).toContain("answer to reply to an open question")
		expect(description).toContain("decision to publish a shared contract")
		expect(description).toContain("note to publish a concrete integration assumption/discovery")
		expect(description).toContain("blocker to surface a blocking integration issue")
		expect(description).toContain("pre-planned/basic questions")
		expect(description).toContain("Ask the specific relevant agent")
		expect(description).toContain(
			"one missing UI/CSS/component interface, DOM structure, class name, selector, ID, data attribute, API shape",
		)
		expect(description).toContain("Do not guess shared contracts that another agent can answer")
		expect(description).toContain("hooks, selectors, or identifiers")
		expect(description).toContain("Split long details into multiple short messages")
		expect(description).toContain("Terminal agents may only answer targeted open questions")
		expect(description).toContain("use attempt_completion for final evidence")
		expect(description).toContain("prefer under 140")
		expect(description).toContain("Do not include emojis")
		expect(description).toContain("chain-of-thought")
		expect(description).not.toMatch(/\p{Extended_Pictographic}/u)
	})

	it("keeps schema bounds strict while documenting clean read and publish shapes", () => {
		const parameters = (coordinateAgentsTool as any).function.parameters

		expect(parameters.properties.kind.enum).toEqual(["question", "answer", "decision", "note", "blocker"])
		expect(parameters.properties.kind.description).toContain("Ownership/status notes are not allowed")
		expect(parameters.properties.message.maxLength).toBe(240)
		expect(parameters.properties.relatedFiles.maxItems).toBe(8)
		expect(parameters.properties.relatedFiles.items.maxLength).toBe(200)
		expect(parameters.properties.limit.minimum).toBe(1)
		expect(parameters.properties.limit.maximum).toBe(20)
		expect(parameters.additionalProperties).toBe(false)
	})
})

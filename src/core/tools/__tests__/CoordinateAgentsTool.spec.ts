import type { ToolUse } from "../../../shared/tools"
import { CoordinateAgentsTool } from "../CoordinateAgentsTool"

describe("CoordinateAgentsTool", () => {
	function createCallbacks() {
		return {
			task: {
				consecutiveMistakeCount: 0,
				canCoordinateWithAgents: vi.fn(() => true),
				getAgentStatus: vi.fn(() => "running"),
				isAgentTerminal: vi.fn(() => false),
				publishAgentCoordination: vi.fn(() => ({
					id: "coord-1",
					agentId: "agent-a",
					kind: "question" as const,
					source: "agent" as const,
					message: "Do you need a class in src/a.ts for the save button?",
					targetAgentId: "agent-b",
					relatedFiles: ["src/a.ts"],
					ts: 1,
				})),
				getAgentCoordinationEvents: vi.fn(() => [
					{
						id: "coord-2",
						agentId: "agent-b",
						kind: "answer" as const,
						source: "agent" as const,
						message: "Use data-testid=save-button.",
						targetAgentId: "agent-a",
						relatedFiles: ["src/b.ts"],
						ts: 2,
					},
				]),
				getOpenAgentCoordinationQuestions: vi.fn(() => [
					{
						id: "coord-open",
						agentId: "agent-b",
						kind: "question" as const,
						source: "agent" as const,
						message: "Which data-testid should the save button expose?",
						targetAgentId: "agent-a",
						ts: 3,
					},
				]),
				recordToolError: vi.fn(),
			},
			callbacks: {
				askApproval: vi.fn(),
				handleError: vi.fn(),
				pushToolResult: vi.fn(),
			},
		}
	}

	it("publishes a coordination message and returns recent relevant messages", async () => {
		const tool = new CoordinateAgentsTool()
		const { task, callbacks } = createCallbacks()

		await tool.handle(
			task as any,
			{
				type: "tool_use",
				name: "coordinate_agents",
				params: {},
				nativeArgs: {
					action: "publish",
					kind: "question",
					message: "Do you need a class in src/a.ts for the save button?",
					targetAgentId: "agent-b",
					relatedFiles: ["src/a.ts"],
				},
			} as ToolUse<"coordinate_agents">,
			callbacks as any,
		)

		expect(task.publishAgentCoordination).toHaveBeenCalledWith({
			kind: "question",
			message: "Do you need a class in src/a.ts for the save button?",
			targetAgentId: "agent-b",
			relatedFiles: ["src/a.ts"],
			replyToId: undefined,
		})
		expect(task.getAgentCoordinationEvents).toHaveBeenCalledWith({ limit: undefined })
		expect(task.getOpenAgentCoordinationQuestions).toHaveBeenCalledWith({ limit: undefined })
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Published team chat message coord-1."),
		)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("answer agent-b to agent-a [coord-2]: Use data-testid=save-button. (src/b.ts)"),
		)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Reply with kind='answer' and replyToId='coord-open'"),
		)
		expect(callbacks.pushToolResult).not.toHaveBeenCalledWith(expect.stringContaining("answer -> agent-a"))
		expect(task.consecutiveMistakeCount).toBe(0)
	})

	it("returns a non-fatal result when terminal agents try to publish", async () => {
		const tool = new CoordinateAgentsTool()
		const { task, callbacks } = createCallbacks()
		;(task.publishAgentCoordination as any).mockImplementation(() => undefined)
		task.getAgentStatus.mockReturnValue("complete")
		task.isAgentTerminal.mockReturnValue(true)
		task.consecutiveMistakeCount = 2

		await tool.handle(
			task as any,
			{
				type: "tool_use",
				name: "coordinate_agents",
				params: {},
				nativeArgs: {
					action: "publish",
					kind: "note",
					message: "Completion accepted; README.md is done.",
					limit: 4,
				},
			} as ToolUse<"coordinate_agents">,
			callbacks as any,
		)

		expect(task.recordToolError).not.toHaveBeenCalled()
		expect(task.publishAgentCoordination).not.toHaveBeenCalled()
		expect(task.consecutiveMistakeCount).toBe(0)
		expect(task.getAgentCoordinationEvents).toHaveBeenCalledWith({ limit: 4 })
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("No team chat was posted because this agent is already terminal (complete)."),
		)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Use attempt_completion or structured completion status"),
		)
		expect(callbacks.pushToolResult).not.toHaveBeenCalledWith(
			expect.stringContaining("Unable to publish coordination message."),
		)
	})

	it("reads recent relevant messages without publishing", async () => {
		const tool = new CoordinateAgentsTool()
		const { task, callbacks } = createCallbacks()

		await tool.handle(
			task as any,
			{
				type: "tool_use",
				name: "coordinate_agents",
				params: {},
				nativeArgs: { action: "read", limit: 3 },
			} as ToolUse<"coordinate_agents">,
			callbacks as any,
		)

		expect(task.publishAgentCoordination).not.toHaveBeenCalled()
		expect(task.getAgentCoordinationEvents).toHaveBeenCalledWith({ limit: 3 })
		expect(task.getOpenAgentCoordinationQuestions).toHaveBeenCalledWith({ limit: 3 })
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Open questions for you:"))
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Recent team chat:"))
	})

	it("ignores harmless publish-style fields on read calls", async () => {
		const tool = new CoordinateAgentsTool()
		const { task, callbacks } = createCallbacks()

		await tool.handle(
			task as any,
			{
				type: "tool_use",
				name: "coordinate_agents",
				params: {},
				nativeArgs: {
					action: "read",
					kind: "note",
					message: "Reading recent coordination messages before creating index.html structure.",
					targetAgentId: "",
					relatedFiles: ["index.html"],
					replyToId: "",
					limit: 8,
				},
			} as ToolUse<"coordinate_agents">,
			callbacks as any,
		)

		expect(task.publishAgentCoordination).not.toHaveBeenCalled()
		expect(task.getAgentCoordinationEvents).toHaveBeenCalledWith({ limit: 8 })
		expect(task.getOpenAgentCoordinationQuestions).toHaveBeenCalledWith({ limit: 8 })
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Recent team chat:"))
	})

	it("normalizes broadcast and no-reply sentinels before publishing", async () => {
		const tool = new CoordinateAgentsTool()
		const { task, callbacks } = createCallbacks()

		await tool.handle(
			task as any,
			{
				type: "tool_use",
				name: "coordinate_agents",
				params: {},
				nativeArgs: {
					action: "publish",
					kind: "question",
					message: "Do you need styles.css for the shared layout classes?",
					targetAgentId: "all",
					relatedFiles: ["styles.css"],
					replyToId: "none",
					limit: 8,
				},
			} as ToolUse<"coordinate_agents">,
			callbacks as any,
		)

		expect(task.publishAgentCoordination).toHaveBeenCalledWith({
			kind: "question",
			message: "Do you need styles.css for the shared layout classes?",
			targetAgentId: undefined,
			relatedFiles: ["styles.css"],
			replyToId: undefined,
		})
		expect(task.getAgentCoordinationEvents).toHaveBeenCalledWith({ limit: 8 })
	})

	it("rejects ownership/status-only publish kinds before posting", async () => {
		const tool = new CoordinateAgentsTool()
		const { task, callbacks } = createCallbacks()

		await tool.handle(
			task as any,
			{
				type: "tool_use",
				name: "coordinate_agents",
				params: {},
				nativeArgs: {
					action: "publish",
					kind: "note",
					message: "I own src/a.ts.",
				},
			} as ToolUse<"coordinate_agents">,
			callbacks as any,
		)

		expect(task.publishAgentCoordination).not.toHaveBeenCalled()
		expect(task.recordToolError).toHaveBeenCalledWith(
			"coordinate_agents",
			"Publish requires kind='question' or kind='answer' for active team coordination.",
		)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Publish a real integration question or answer"),
		)
		expect(task.consecutiveMistakeCount).toBe(1)
	})

	it("denies foreground tasks", async () => {
		const tool = new CoordinateAgentsTool()
		const { task, callbacks } = createCallbacks()
		task.canCoordinateWithAgents.mockReturnValue(false)

		await tool.handle(
			task as any,
			{
				type: "tool_use",
				name: "coordinate_agents",
				params: {},
				nativeArgs: { action: "read" },
			} as ToolUse<"coordinate_agents">,
			callbacks as any,
		)

		expect(task.recordToolError).toHaveBeenCalledWith(
			"coordinate_agents",
			"Tool is only available to background parallel agents.",
		)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("coordinate_agents is only available to background parallel agents."),
		)
		expect(task.consecutiveMistakeCount).toBe(1)
	})
})

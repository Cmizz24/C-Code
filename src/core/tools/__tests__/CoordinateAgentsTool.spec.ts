import type { ToolUse } from "../../../shared/tools"
import { CoordinateAgentsTool } from "../CoordinateAgentsTool"

describe("CoordinateAgentsTool", () => {
	function createCallbacks() {
		return {
			task: {
				consecutiveMistakeCount: 0,
				canCoordinateWithAgents: vi.fn(() => true),
				publishAgentCoordination: vi.fn(() => ({
					id: "coord-1",
					agentId: "agent-a",
					kind: "question" as const,
					message: "Need selector contract.",
					targetAgentId: "agent-b",
					relatedFiles: ["src/a.ts"],
					ts: 1,
				})),
				getAgentCoordinationEvents: vi.fn(() => [
					{
						id: "coord-2",
						agentId: "agent-b",
						kind: "answer" as const,
						message: "Use data-testid=save-button.",
						targetAgentId: "agent-a",
						relatedFiles: ["src/b.ts"],
						ts: 2,
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
					message: "Need selector contract.",
					targetAgentId: "agent-b",
					relatedFiles: ["src/a.ts"],
				},
			} as ToolUse<"coordinate_agents">,
			callbacks as any,
		)

		expect(task.publishAgentCoordination).toHaveBeenCalledWith({
			kind: "question",
			message: "Need selector contract.",
			targetAgentId: "agent-b",
			relatedFiles: ["src/a.ts"],
			replyToId: undefined,
		})
		expect(task.getAgentCoordinationEvents).toHaveBeenCalledWith({ limit: undefined })
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Published coordination message coord-1 (question)."),
		)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("coord-2 answer -> agent-a: Use data-testid=save-button."),
		)
		expect(task.consecutiveMistakeCount).toBe(0)
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
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Recent relevant coordination:"))
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

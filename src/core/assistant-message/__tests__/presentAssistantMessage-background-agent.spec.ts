import { presentAssistantMessage } from "../presentAssistantMessage"

function createBackgroundAgentTask(toolName: "new_task" | "plan_parallel_tasks") {
	const task: any = {
		taskId: "background-agent-task",
		instanceId: "instance-id",
		abort: false,
		background: true,
		agentId: "ui-agent",
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		parallelPlanPaused: false,
		parallelExecutionPaused: false,
		currentStreamingContentIndex: 0,
		assistantMessageContent: [
			{
				type: "tool_use",
				id: `tool-${toolName}`,
				name: toolName,
				params:
					toolName === "new_task"
						? { mode: "code", message: "Delegate this work" }
						: { goal: "Split this work" },
				nativeArgs:
					toolName === "new_task"
						? { mode: "code", message: "Delegate this work" }
						: { goal: "Split this work", sharedContext: "", expectedFiles: [], agents: [] },
				partial: false,
			},
		],
		userMessageContent: [],
		didCompleteReadingStream: true,
		didRejectTool: false,
		didAlreadyUseTool: false,
		consecutiveMistakeCount: 0,
		api: { getModel: () => ({ id: "test-model", info: {} }) },
		recordToolUsage: vi.fn(),
		recordToolError: vi.fn(),
		toolRepetitionDetector: { check: vi.fn().mockReturnValue({ allowExecution: true }) },
		providerRef: {
			deref: () => ({
				getState: vi.fn().mockResolvedValue({ mode: "code", customModes: [], disabledTools: [] }),
			}),
		},
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		pushToolResultToUserContent: vi.fn((toolResult) => {
			task.userMessageContent.push(toolResult)
			return true
		}),
	}

	return task
}

describe("presentAssistantMessage - background agents", () => {
	it.each(["new_task", "plan_parallel_tasks"] as const)(
		"blocks %s before a background agent can enter visible orchestration flows",
		async (toolName) => {
			const task = createBackgroundAgentTask(toolName)

			await presentAssistantMessage(task)

			expect(task.ask).not.toHaveBeenCalled()
			expect(task.pushToolResultToUserContent).toHaveBeenCalledWith(
				expect.objectContaining({
					tool_use_id: `tool-${toolName}`,
					is_error: true,
					content: expect.stringContaining(toolName),
				}),
			)
			expect(task.userMessageContent[0].content).toContain("not allowed")
			expect(task.userMessageContent).toHaveLength(1)
			expect(task.consecutiveMistakeCount).toBe(1)
			expect(task.didAlreadyUseTool).toBe(false)
		},
	)
})

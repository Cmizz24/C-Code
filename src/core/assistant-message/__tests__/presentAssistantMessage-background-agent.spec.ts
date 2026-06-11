import { presentAssistantMessage } from "../presentAssistantMessage"

const { writeToFileHandle } = vi.hoisted(() => ({
	writeToFileHandle: vi.fn(async (_task: any, _block: any, callbacks: any) => {
		callbacks.pushToolResult("wrote README")
	}),
}))

vi.mock("../../tools/WriteToFileTool", () => ({
	writeToFileTool: {
		handle: writeToFileHandle,
	},
}))

vi.mock("../../../../integrations/checkpoints/CheckpointTracker", () => ({
	CheckpointTracker: {
		markCheckpointSave: vi.fn(),
	},
}))

function createBackgroundAgentTask(
	toolName: "new_task" | "plan_parallel_tasks" | "write_to_file" | "attempt_completion",
	options: { taskMode?: string; providerMode?: string; assistantMessageContent?: any[] } = {},
) {
	const taskMode = options.taskMode ?? "code"
	const providerMode = options.providerMode ?? "code"
	const assistantMessageContent = options.assistantMessageContent ?? [
		{
			type: "tool_use",
			id: `tool-${toolName}`,
			name: toolName,
			params:
				toolName === "new_task"
					? { mode: "code", message: "Delegate this work" }
					: toolName === "write_to_file"
						? { path: "README.md", content: "# Project\n" }
						: toolName === "attempt_completion"
							? { result: "Agent finished" }
							: { goal: "Split this work" },
			nativeArgs:
				toolName === "new_task"
					? { mode: "code", message: "Delegate this work" }
					: toolName === "write_to_file"
						? { path: "README.md", content: "# Project\n" }
						: toolName === "attempt_completion"
							? { result: "Agent finished" }
							: { goal: "Split this work", sharedContext: "", expectedFiles: [], agents: [] },
			partial: false,
		},
	]
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
		assistantMessageContent,
		userMessageContent: [],
		didCompleteReadingStream: true,
		didRejectTool: false,
		didAlreadyUseTool: false,
		consecutiveMistakeCount: 0,
		api: { getModel: () => ({ id: "test-model", info: {} }) },
		getTaskMode: vi.fn().mockResolvedValue(taskMode),
		checkpointSave: vi.fn().mockResolvedValue(undefined),
		currentStreamingDidCheckpoint: false,
		recordToolUsage: vi.fn(),
		recordToolError: vi.fn(),
		drainQueuedMistakeMemories: vi.fn().mockResolvedValue(undefined),
		markAgentTerminal: vi.fn(),
		cancelCurrentRequest: vi.fn(),
		emitFinalTokenUsageUpdate: vi.fn(),
		emit: vi.fn(),
		getTokenUsage: vi.fn().mockReturnValue({}),
		toolUsage: {},
		getAgentCompletionCoordinationGate: vi.fn(() => ({
			approved: true,
			blockers: [],
			unanswerableQuestions: [],
		})),
		isAgentTerminal: vi.fn(() => false),
		toolRepetitionDetector: { check: vi.fn().mockReturnValue({ allowExecution: true }) },
		providerRef: {
			deref: () => ({
				getState: vi.fn().mockResolvedValue({ mode: providerMode, customModes: [], disabledTools: [] }),
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
	beforeEach(() => {
		writeToFileHandle.mockClear()
	})

	it("validates a background onboarding child with its task-local mode before writing README", async () => {
		const task = createBackgroundAgentTask("write_to_file", { taskMode: "onboarding", providerMode: "explain" })

		await presentAssistantMessage(task)

		expect(writeToFileHandle).toHaveBeenCalledWith(
			task,
			expect.objectContaining({ name: "write_to_file", params: { path: "README.md", content: "# Project\n" } }),
			expect.any(Object),
		)
		expect(task.pushToolResultToUserContent).toHaveBeenCalledWith(
			expect.objectContaining({
				tool_use_id: "tool-write_to_file",
				content: "wrote README",
			}),
		)
		expect(task.userMessageContent[0]).toEqual(
			expect.objectContaining({ tool_use_id: "tool-write_to_file", content: "wrote README" }),
		)
		expect(task.consecutiveMistakeCount).toBe(0)
		expect(task.userMessageContentReady).toBe(true)
	})

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

	it("does not execute later file tools after a background agent reports terminal completion", async () => {
		let terminal = false
		const task = createBackgroundAgentTask("attempt_completion", {
			assistantMessageContent: [
				{
					type: "tool_use",
					id: "tool-complete",
					name: "attempt_completion",
					params: { result: "Agent finished" },
					nativeArgs: { result: "Agent finished" },
					partial: false,
				},
				{
					type: "tool_use",
					id: "tool-write-after-complete",
					name: "write_to_file",
					params: { path: "README.md", content: "# Late write\n" },
					nativeArgs: { path: "README.md", content: "# Late write\n" },
					partial: false,
				},
			],
		})
		task.markAgentTerminal = vi.fn(() => {
			terminal = true
		})
		task.isAgentTerminal = vi.fn(() => terminal)

		await presentAssistantMessage(task)

		expect(task.markAgentTerminal).toHaveBeenCalledTimes(1)
		expect(task.cancelCurrentRequest).toHaveBeenCalledTimes(1)
		expect(writeToFileHandle).not.toHaveBeenCalled()
		expect(task.userMessageContentReady).toBe(true)
	})
})

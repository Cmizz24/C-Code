import type { ExecutionPlan } from "@roo-code/types"

import { presentAssistantMessage } from "../presentAssistantMessage"

type PlanApprovalResult =
	| { approved: false }
	| { approved: true; plan: ExecutionPlan; startResult: { ok: true } | { ok: false; error: string } }

vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))

function createPlanAgent(id: string, filePath: string) {
	return {
		id,
		mode: "code",
		task: `Implement ${filePath}`,
		owns: [{ path: filePath, mode: "exclusive" as const }],
	}
}

function createPlanPresentationTask({
	provider,
	agents,
	todoList,
}: {
	provider: any
	agents: any[]
	todoList?: any[]
}) {
	const task: any = {
		taskId: "task-id",
		instanceId: "instance-id",
		abort: false,
		cwd: "C:/repo",
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		parallelPlanPaused: false,
		parallelExecutionPaused: false,
		currentStreamingContentIndex: 0,
		assistantMessageContent: [
			{
				type: "tool_use",
				id: "tool-plan",
				name: "plan_parallel_tasks",
				params: { goal: "Build dashboard" },
				nativeArgs: {
					goal: "Build dashboard",
					sharedContext: "Build the dashboard",
					expectedFiles: agents.flatMap((agent) => agent.owns.map((ownership: any) => ownership.path)),
					agents,
				},
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
		providerRef: { deref: () => provider },
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		todoList,
	}
	task.pushToolResultToUserContent = vi.fn((toolResult) => {
		task.userMessageContent.push(toolResult)
		return true
	})
	return task
}

describe("presentAssistantMessage - plan_parallel_tasks", () => {
	it("waits for explicit plan approval before returning a tool result", async () => {
		let approvePlan: (value: PlanApprovalResult) => void = () => {}
		const approval: Promise<PlanApprovalResult> = new Promise((resolve) => {
			approvePlan = resolve
		})
		const requestPlanApproval = vi.fn((_plan: ExecutionPlan): Promise<PlanApprovalResult> => approval)
		const provider = {
			getState: vi.fn().mockResolvedValue({ mode: "code", customModes: [] }),
			requestPlanApproval,
		}
		const task: any = {
			taskId: "task-id",
			instanceId: "instance-id",
			abort: false,
			cwd: "C:/repo",
			presentAssistantMessageLocked: false,
			presentAssistantMessageHasPendingUpdates: false,
			parallelPlanPaused: false,
			parallelExecutionPaused: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [
				{
					type: "tool_use",
					id: "tool-plan",
					name: "plan_parallel_tasks",
					params: { goal: "Build dashboard" },
					nativeArgs: {
						goal: "Build dashboard",
						agents: [
							{
								id: "ui",
								mode: "code",
								task: "Build dashboard UI",
								owns: [{ path: "src/Dashboard.tsx", mode: "exclusive" }],
							},
						],
					},
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
			providerRef: { deref: () => provider },
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			pushToolResultToUserContent: vi.fn((toolResult) => {
				task.userMessageContent.push(toolResult)
				return true
			}),
		}

		const presentation = presentAssistantMessage(task)

		await vi.waitFor(() => expect(provider.requestPlanApproval).toHaveBeenCalledTimes(1))
		expect(task.pushToolResultToUserContent).not.toHaveBeenCalled()

		const approvedPlan = requestPlanApproval.mock.calls[0][0]
		approvePlan({ approved: true, plan: approvedPlan, startResult: { ok: true } })
		await presentation

		expect(task.pushToolResultToUserContent).toHaveBeenCalledWith(
			expect.objectContaining({ content: expect.stringContaining("programmatically") }),
		)
		expect(task.didAlreadyUseTool).toBe(true)
		expect(task.parallelPlanPaused).toBe(false)
		expect(task.parallelExecutionPaused).toBe(true)
	})

	it("pauses presentation while plan approval is pending and ignores concurrently streamed new_task blocks", async () => {
		let approvePlan: (value: PlanApprovalResult) => void = () => {}
		const approval: Promise<PlanApprovalResult> = new Promise((resolve) => {
			approvePlan = resolve
		})
		const provider = {
			getState: vi.fn().mockResolvedValue({ mode: "code", customModes: [] }),
			requestPlanApproval: vi.fn((_plan: ExecutionPlan): Promise<PlanApprovalResult> => approval),
		}
		const task: any = {
			taskId: "task-id",
			instanceId: "instance-id",
			abort: false,
			cwd: "C:/repo",
			presentAssistantMessageLocked: false,
			presentAssistantMessageHasPendingUpdates: false,
			parallelPlanPaused: false,
			parallelExecutionPaused: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [
				{
					type: "tool_use",
					id: "tool-plan",
					name: "plan_parallel_tasks",
					params: { goal: "Build dashboard" },
					nativeArgs: {
						goal: "Build dashboard",
						agents: [
							{
								id: "ui",
								mode: "code",
								task: "Build dashboard UI",
								owns: [{ path: "src/Dashboard.tsx", mode: "exclusive" }],
							},
						],
					},
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
			providerRef: { deref: () => provider },
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			pushToolResultToUserContent: vi.fn((toolResult) => {
				task.userMessageContent.push(toolResult)
				return true
			}),
		}

		const presentation = presentAssistantMessage(task)
		await vi.waitFor(() => expect(provider.requestPlanApproval).toHaveBeenCalledTimes(1))

		task.assistantMessageContent.push({
			type: "tool_use",
			id: "tool-new-task",
			name: "new_task",
			params: { mode: "code", message: "Do not run" },
			nativeArgs: { mode: "code", message: "Do not run" },
			partial: false,
		})

		await presentAssistantMessage(task)
		expect(task.currentStreamingContentIndex).toBe(0)
		expect(task.pushToolResultToUserContent).not.toHaveBeenCalled()

		const approvedPlan = provider.requestPlanApproval.mock.calls[0][0]
		approvePlan({ approved: true, plan: approvedPlan, startResult: { ok: true } })
		await presentation

		expect(task.pushToolResultToUserContent).toHaveBeenCalledTimes(1)
		expect(task.assistantMessageContent).toHaveLength(1)
		expect(task.currentStreamingContentIndex).toBe(1)
		expect(task.didAlreadyUseTool).toBe(true)
		expect(task.parallelExecutionPaused).toBe(true)
	})

	it("rejects oversized native plans before requesting approval", async () => {
		const provider = {
			getState: vi.fn().mockResolvedValue({ mode: "code", customModes: [], maxConcurrentParallelTasks: 1 }),
			requestPlanApproval: vi.fn(),
		}
		const task = createPlanPresentationTask({
			provider,
			agents: [createPlanAgent("ui", "src/Dashboard.tsx"), createPlanAgent("api", "src/api.ts")],
		})

		await presentAssistantMessage(task)

		expect(provider.requestPlanApproval).not.toHaveBeenCalled()
		expect(task.pushToolResultToUserContent).toHaveBeenCalledWith(
			expect.objectContaining({
				content: expect.stringContaining("maximum parallel agents is configured to 1"),
			}),
		)
		expect(task.parallelExecutionPaused).toBe(false)
	})

	it("completes the active parallel planning todo without adding a visible user edit row", async () => {
		const requestPlanApproval = vi.fn(async (plan: ExecutionPlan): Promise<PlanApprovalResult> => {
			return { approved: true, plan, startResult: { ok: true } }
		})
		const provider = {
			getState: vi.fn().mockResolvedValue({ mode: "code", customModes: [], maxConcurrentParallelTasks: 5 }),
			requestPlanApproval,
			postStateToWebviewWithoutTaskHistory: vi.fn().mockResolvedValue(undefined),
		}
		const task = createPlanPresentationTask({
			provider,
			agents: [createPlanAgent("ui", "src/Dashboard.tsx")],
			todoList: [{ id: "todo-plan", content: "Plan parallel agent execution", status: "in_progress" }],
		})

		await presentAssistantMessage(task)

		expect(task.todoList[0].status).toBe("completed")
		expect(task.say).not.toHaveBeenCalledWith(
			"user_edit_todos",
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
			expect.anything(),
		)
		expect(provider.postStateToWebviewWithoutTaskHistory.mock.invocationCallOrder[0]).toBeLessThan(
			requestPlanApproval.mock.invocationCallOrder[0],
		)
		expect(provider.postStateToWebviewWithoutTaskHistory).toHaveBeenCalled()
		expect(task.parallelExecutionPaused).toBe(true)
	})
})

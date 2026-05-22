import type { ExecutionPlan } from "@roo-code/types"

import { presentAssistantMessage } from "../presentAssistantMessage"

type PlanApprovalResult =
	| { approved: false }
	| { approved: true; plan: ExecutionPlan; startResult: { ok: true } | { ok: false; error: string } }

vi.mock("../../tools/validateToolUse", () => ({
	validateToolUse: vi.fn(),
	isValidToolName: vi.fn(() => true),
}))

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
	})
})

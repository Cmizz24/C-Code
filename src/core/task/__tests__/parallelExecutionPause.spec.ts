vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue("<environment_details>mock details</environment_details>"),
}))

import { Task } from "../Task"

describe("Task parallel execution pause", () => {
	it("flushes pending plan tool results and ends the loop before another parent request", async () => {
		const task = {
			abort: false,
			taskId: "parent-task",
			instanceId: "instance-id",
			parallelExecutionPaused: true,
			consecutiveMistakeLimit: 0,
			flushPendingToolResultsToHistory: vi.fn().mockResolvedValue(true),
			say: vi.fn(),
		}

		const didEndLoop = await Task.prototype.recursivelyMakeClineRequests.call(task as any, [], false)

		expect(didEndLoop).toBe(true)
		expect(task.flushPendingToolResultsToHistory).toHaveBeenCalledTimes(1)
		expect(task.say).not.toHaveBeenCalledWith("api_req_started", expect.anything())
	})

	it("ends a terminal background agent loop before another model request", async () => {
		const task = {
			abort: false,
			taskId: "agent-task",
			instanceId: "instance-id",
			parallelExecutionPaused: false,
			consecutiveMistakeLimit: 0,
			isAgentTerminal: vi.fn(() => true),
			flushPendingToolResultsToHistory: vi.fn(),
			say: vi.fn(),
		}

		const didEndLoop = await Task.prototype.recursivelyMakeClineRequests.call(task as any, [], false)

		expect(didEndLoop).toBe(true)
		expect(task.say).not.toHaveBeenCalledWith("api_req_started", expect.anything())
		expect(task.flushPendingToolResultsToHistory).not.toHaveBeenCalled()
	})

	it("resumes the parent loop after merged parallel execution", async () => {
		const task = Object.create(Task.prototype) as any
		task.parallelExecutionPaused = true
		task.idleAsk = { type: "ask" }
		task.resumableAsk = { type: "ask" }
		task.interactiveAsk = { type: "ask" }
		task.abort = true
		task.abandoned = true
		task.abortReason = "user_cancelled"
		task.didFinishAbortingStream = true
		task.isStreaming = true
		task.isWaitingForFirstChunk = true
		task.skipPrevResponseIdOnce = false
		task.isInitialized = false
		task.taskId = "parent-task"
		task.apiConversationHistory = [
			{
				role: "user",
				content: [{ type: "text", text: "[PARALLEL AGENT SUMMARY] Plan plan-1 is merged." }],
			},
		]
		task.emit = vi.fn()
		task.getSavedApiConversationHistory = vi.fn()
		task.saveApiConversationHistory = vi.fn().mockResolvedValue(true)
		task.initiateTaskLoop = vi.fn().mockResolvedValue(undefined)

		await task.resumeAfterParallelExecution()

		expect(task.parallelExecutionPaused).toBe(false)
		expect(task.idleAsk).toBeUndefined()
		expect(task.resumableAsk).toBeUndefined()
		expect(task.interactiveAsk).toBeUndefined()
		expect(task.abort).toBe(false)
		expect(task.abandoned).toBe(false)
		expect(task.abortReason).toBeUndefined()
		expect(task.didFinishAbortingStream).toBe(false)
		expect(task.isStreaming).toBe(false)
		expect(task.isWaitingForFirstChunk).toBe(false)
		expect(task.skipPrevResponseIdOnce).toBe(true)
		expect(task.isInitialized).toBe(true)
		expect(task.initiateTaskLoop).toHaveBeenCalledWith([])
	})
})

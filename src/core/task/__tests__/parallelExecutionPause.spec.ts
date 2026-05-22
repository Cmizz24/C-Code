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
})

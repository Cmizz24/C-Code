import { describe, expect, it, beforeEach, vi } from "vitest"

import { askForContextTool } from "../AskForContextTool"
import type { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"

describe("askForContextTool", () => {
	let mockTask: any
	let mockCallbacks: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockTask = {
			consecutiveMistakeCount: 0,
			didToolFailInCurrentTurn: false,
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing query parameter"),
			say: vi.fn().mockResolvedValue(undefined),
			askForColdContext: vi.fn().mockResolvedValue([]),
		}

		mockCallbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
	})

	it("handles missing query parameter", async () => {
		const block: ToolUse<"ask_for_context"> = {
			type: "tool_use",
			name: "ask_for_context",
			params: {},
			partial: false,
			nativeArgs: {
				query: "",
			},
		}

		await askForContextTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.didToolFailInCurrentTurn).toBe(true)
		expect(mockTask.recordToolError).toHaveBeenCalledWith("ask_for_context")
		expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("ask_for_context", "query")
		expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith("Missing query parameter")
	})

	it("returns top cold-cache matches from the context manager", async () => {
		const contextResults = [
			{
				id: "chunk-1",
				type: "file_content",
				content: "export function cachedHelper() { return true }",
				filePath: "src/helpers.ts",
				tokens: 10,
				score: 3.5,
				breakdown: {
					queryMatches: 1,
					filePathMatch: true,
					typeBoost: 0.15,
					recencyBoost: 0.05,
				},
			},
		]
		mockTask.askForColdContext.mockResolvedValue(contextResults)
		mockTask.consecutiveMistakeCount = 2
		const block: ToolUse<"ask_for_context"> = {
			type: "tool_use",
			name: "ask_for_context",
			params: {},
			partial: false,
			nativeArgs: {
				query: " cached helper ",
				filePath: " src/helpers.ts ",
			},
		}

		await askForContextTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockTask.askForColdContext).toHaveBeenCalledWith("cached helper", {
			filePath: "src/helpers.ts",
			limit: 3,
		})
		expect(mockTask.consecutiveMistakeCount).toBe(0)
		expect(mockTask.say).toHaveBeenCalledWith("tool", expect.any(String), undefined, false, undefined, undefined, {
			isNonInteractive: true,
		})
		const sayPayload = JSON.parse(mockTask.say.mock.calls[0][1])
		expect(sayPayload).toMatchObject({
			tool: "askForContext",
			query: "cached helper",
			filePath: "src/helpers.ts",
			message: "Found 1 matching context chunk.",
			contextResults,
		})
		const toolResult = JSON.parse(mockCallbacks.pushToolResult.mock.calls[0][0])
		expect(toolResult).toEqual({
			query: "cached helper",
			filePath: "src/helpers.ts",
			results: contextResults,
		})
	})

	it("returns an empty result set when no context manager is active", async () => {
		const block: ToolUse<"ask_for_context"> = {
			type: "tool_use",
			name: "ask_for_context",
			params: {},
			partial: false,
			nativeArgs: {
				query: "missing cache entry",
			},
		}

		await askForContextTool.handle(mockTask as Task, block, mockCallbacks)

		const toolResult = JSON.parse(mockCallbacks.pushToolResult.mock.calls[0][0])
		expect(toolResult).toEqual({
			query: "missing cache entry",
			results: [],
		})
	})

	it("delegates context manager errors to handleError", async () => {
		const error = new Error("cold cache failed")
		mockTask.askForColdContext.mockRejectedValue(error)
		const block: ToolUse<"ask_for_context"> = {
			type: "tool_use",
			name: "ask_for_context",
			params: {},
			partial: false,
			nativeArgs: {
				query: "anything",
			},
		}

		await askForContextTool.handle(mockTask as Task, block, mockCallbacks)

		expect(mockCallbacks.handleError).toHaveBeenCalledWith("asking context cache", error)
		expect(mockCallbacks.pushToolResult).not.toHaveBeenCalled()
	})
})

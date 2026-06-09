import * as fs from "fs/promises"
import * as os from "os"
import path from "path"

import type { ToolUse } from "../../../shared/tools"
import type { Task } from "../../task/Task"
import { MemoryStorage } from "../../memory"
import { memorySearchTool } from "../MemorySearchTool"
import { mistakeMemoryTool } from "../MistakeMemoryTool"

function createTask(globalStoragePath: string, state: Record<string, unknown> = {}): Task {
	return {
		cwd: path.join(globalStoragePath, "workspace"),
		taskId: "task-1",
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		providerRef: {
			deref: () => ({
				context: { globalStorageUri: { fsPath: globalStoragePath } },
				getState: vi.fn().mockResolvedValue(state),
			}),
		},
		getTaskMode: vi.fn().mockResolvedValue("code"),
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("missing parameter"),
		recordToolError: vi.fn(),
		rooIgnoreController: {
			filterPaths: vi.fn((paths: string[]) => paths.filter((entry) => entry !== ".env")),
		},
	} as unknown as Task
}

describe("memory_search tool", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-memory-tool-"))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("returns read-only ranked memory search results", async () => {
		const task = createTask(tempDir)
		const storage = new MemoryStorage({ globalStoragePath: tempDir, workspacePath: task.cwd })
		await storage.createMemory({
			scope: "workspace",
			kind: "lesson",
			status: "active",
			source: "manual",
			lesson: "When editing MemorySettings.tsx, bind inputs to cached state.",
			pathTags: ["webview-ui/src/components/settings/MemorySettings.tsx"],
			mode: "code",
			workspacePath: task.cwd,
		})
		const before = await storage.readStore("workspace", task.cwd)
		const callbacks = { askApproval: vi.fn(), handleError: vi.fn(), pushToolResult: vi.fn() }
		const block: ToolUse<"memory_search"> = {
			type: "tool_use",
			name: "memory_search",
			params: {},
			partial: false,
			nativeArgs: {
				query: "MemorySettings.tsx cached state",
				scope: "workspace",
				limit: 5,
			},
		}

		await memorySearchTool.handle(task, block, callbacks)

		expect(callbacks.handleError).not.toHaveBeenCalled()
		const output = JSON.parse(callbacks.pushToolResult.mock.calls[0][0])
		expect(output.results).toHaveLength(1)
		expect(output.results[0]).toEqual(
			expect.objectContaining({
				scope: "workspace",
				lesson: "When editing MemorySettings.tsx, bind inputs to cached state.",
				pathTags: ["webview-ui/src/components/settings/MemorySettings.tsx"],
			}),
		)
		expect(await storage.readStore("workspace", task.cwd)).toEqual(before)
	})

	it("records a tool error when the query parameter is missing", async () => {
		const task = createTask(tempDir)
		const callbacks = { askApproval: vi.fn(), handleError: vi.fn(), pushToolResult: vi.fn() }
		const block: ToolUse<"memory_search"> = {
			type: "tool_use",
			name: "memory_search",
			params: {},
			partial: false,
			nativeArgs: { query: "" },
		}

		await memorySearchTool.handle(task, block, callbacks)

		expect(task.recordToolError).toHaveBeenCalledWith("memory_search")
		expect(task.didToolFailInCurrentTurn).toBe(true)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith("missing parameter")
	})
})

describe("mistake_memory tool", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-mistake-tool-"))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("saves pending mistake memories by default and filters ignored path tags", async () => {
		const task = createTask(tempDir, { memoryPendingCandidateLimit: 5 })
		const callbacks = { askApproval: vi.fn(), handleError: vi.fn(), pushToolResult: vi.fn() }
		const block: ToolUse<"mistake_memory"> = {
			type: "tool_use",
			name: "mistake_memory",
			params: {},
			partial: false,
			nativeArgs: {
				lesson: "Do not retry commands without reading validation feedback.",
				error: "Validation failed",
				tool_name: "execute_command",
				file_paths: ["src/core/task/Task.ts", ".env"],
				tags: ["validation"],
			},
		}

		await mistakeMemoryTool.handle(task, block, callbacks)

		expect(callbacks.askApproval).not.toHaveBeenCalled()
		expect(callbacks.handleError).not.toHaveBeenCalled()
		const output = JSON.parse(callbacks.pushToolResult.mock.calls[0][0])
		expect(output.status).toBe("pending")
		expect(output.candidateId).toMatch(/^cand_/)

		const store = await new MemoryStorage({ globalStoragePath: tempDir, workspacePath: task.cwd }).readStore(
			"workspace",
			task.cwd,
		)
		expect(store.memories[0]).toEqual(
			expect.objectContaining({
				status: "pending",
				source: "mistake_tool",
				pathTags: ["src/core/task/Task.ts"],
			}),
		)
		expect(store.candidates[0].status).toBe("pending")
	})

	it("requires approval before saving an explicitly active mistake memory", async () => {
		const task = createTask(tempDir)
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
		const block: ToolUse<"mistake_memory"> = {
			type: "tool_use",
			name: "mistake_memory",
			params: {},
			partial: false,
			nativeArgs: {
				lesson: "Use a stable test fixture before committing.",
				approve: true,
				scope: "global",
			},
		}

		await mistakeMemoryTool.handle(task, block, callbacks)

		expect(callbacks.askApproval).toHaveBeenCalledWith(
			"tool",
			expect.stringContaining("mistakeMemory"),
			undefined,
			true,
		)
		const output = JSON.parse(callbacks.pushToolResult.mock.calls[0][0])
		expect(output.status).toBe("active")
		expect(output.candidateId).toBeUndefined()
		const store = await new MemoryStorage({ globalStoragePath: tempDir, workspacePath: task.cwd }).readStore(
			"global",
		)
		expect(store.memories[0].status).toBe("active")
		expect(store.candidates).toHaveLength(0)
	})

	it("does not save when mistake memory or selected scope is disabled", async () => {
		for (const state of [
			{ memoryMistakeMemoryEnabled: false },
			{ memoryWorkspaceEnabled: false },
			{ memoryGlobalEnabled: false, scope: "global" },
		]) {
			const task = createTask(tempDir, state)
			const callbacks = { askApproval: vi.fn(), handleError: vi.fn(), pushToolResult: vi.fn() }
			const block: ToolUse<"mistake_memory"> = {
				type: "tool_use",
				name: "mistake_memory",
				params: {},
				partial: false,
				nativeArgs: {
					lesson: "Disabled memory should not persist.",
					scope: (state as any).scope,
				},
			}

			await mistakeMemoryTool.handle(task, block, callbacks)

			expect(callbacks.pushToolResult.mock.calls[0][0]).toContain("disabled")
		}

		const storage = new MemoryStorage({
			globalStoragePath: tempDir,
			workspacePath: path.join(tempDir, "workspace"),
		})
		expect((await storage.readStore("global")).memories).toHaveLength(0)
		expect((await storage.readStore("workspace", path.join(tempDir, "workspace"))).memories).toHaveLength(0)
	})
})

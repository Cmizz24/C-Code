import * as fs from "fs/promises"
import * as os from "os"
import path from "path"

import type { ToolUse } from "../../../shared/tools"
import type { Task } from "../../task/Task"
import { MemoryStorage } from "../../memory"
import { memorySearchTool } from "../MemorySearchTool"
import { mistakeMemoryTool } from "../MistakeMemoryTool"

function createTask(globalStoragePath: string, state: Record<string, unknown> = {}): Task {
	const provider = {
		context: { globalStorageUri: { fsPath: globalStoragePath } },
		getState: vi.fn().mockResolvedValue(state),
		postMemoryStateToWebview: vi.fn().mockResolvedValue(undefined),
	}

	return {
		cwd: path.join(globalStoragePath, "workspace"),
		taskId: "task-1",
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		providerRef: {
			deref: () => provider,
		},
		getTaskMode: vi.fn().mockResolvedValue("code"),
		say: vi.fn().mockResolvedValue(undefined),
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
			title: "Settings cached-state lesson",
			lesson: "When editing MemorySettings.tsx, bind inputs to cached state.",
			tags: ["settings", "cached-state"],
			pathTags: ["webview-ui/src/components/settings/MemorySettings.tsx"],
			mode: "code",
			toolName: "apply_patch",
			confidence: 0.8,
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
				kind: "lesson",
				status: "active",
				title: "Settings cached-state lesson",
				lesson: "When editing MemorySettings.tsx, bind inputs to cached state.",
				tags: ["settings", "cached-state"],
				pathTags: ["webview-ui/src/components/settings/MemorySettings.tsx"],
				mode: "code",
				toolName: "apply_patch",
				confidence: 0.8,
				score: expect.any(Number),
				breakdown: expect.objectContaining({ lexicalSimilarity: expect.any(Number) }),
			}),
		)
		expect(task.say).toHaveBeenCalledWith(
			"tool",
			expect.stringContaining("memorySearch"),
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
		const sayPayload = JSON.parse((task.say as any).mock.calls[0][1])
		expect(sayPayload).toEqual(
			expect.objectContaining({
				tool: "memorySearch",
				query: "MemorySettings.tsx cached state",
				scope: "workspace",
				status: "active",
				memoryResults: [
					expect.objectContaining({
						title: "Settings cached-state lesson",
						lesson: "When editing MemorySettings.tsx, bind inputs to cached state.",
						pathTags: ["webview-ui/src/components/settings/MemorySettings.tsx"],
						score: expect.any(Number),
					}),
				],
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
		expect((task.providerRef.deref() as any).postMemoryStateToWebview).toHaveBeenCalledTimes(1)
		expect(task.say).toHaveBeenCalledWith(
			"tool",
			expect.stringContaining("mistakeMemory"),
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
		const sayPayload = JSON.parse((task.say as any).mock.calls[0][1])
		expect(sayPayload).toEqual(
			expect.objectContaining({
				tool: "mistakeMemory",
				memoryId: output.id,
				candidateId: output.candidateId,
				scope: "workspace",
				status: "pending",
				title: "Mistake lesson for execute_command",
				tags: ["validation", "mistake"],
				pathTags: ["src/core/task/Task.ts"],
				mode: "code",
				toolName: "execute_command",
				mistakeSignature: expect.stringMatching(/^mistake:/),
				autoApproved: false,
				message: "Saved pending mistake-memory candidate for user review.",
			}),
		)

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

	it("auto-approves mistake memories when global auto-approval and the setting are enabled", async () => {
		const task = createTask(tempDir, { autoApprovalEnabled: true, memoryAutoApproveMistakeMemory: true })
		const callbacks = {
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
		const block: ToolUse<"mistake_memory"> = {
			type: "tool_use",
			name: "mistake_memory",
			params: {},
			partial: false,
			nativeArgs: {
				lesson: "Read the latest terminal output before retrying a failing command.",
			},
		}

		await mistakeMemoryTool.handle(task, block, callbacks)

		expect(callbacks.askApproval).not.toHaveBeenCalled()
		const output = JSON.parse(callbacks.pushToolResult.mock.calls[0][0])
		expect(output.status).toBe("active")
		expect(output.autoApproved).toBe(true)
		expect(output.candidateId).toBeUndefined()
		const sayPayload = JSON.parse((task.say as any).mock.calls[0][1])
		expect(sayPayload).toEqual(
			expect.objectContaining({
				tool: "mistakeMemory",
				memoryId: output.id,
				status: "active",
				autoApproved: true,
				message: "Saved auto-approved active mistake memory.",
			}),
		)
		expect(sayPayload).not.toHaveProperty("candidateId")

		const store = await new MemoryStorage({ globalStoragePath: tempDir, workspacePath: task.cwd }).readStore(
			"workspace",
			task.cwd,
		)
		expect(store.memories[0].status).toBe("active")
		expect(store.candidates).toHaveLength(0)
	})

	it("keeps mistake memories pending when only the memory auto-approve setting is enabled", async () => {
		const task = createTask(tempDir, { memoryAutoApproveMistakeMemory: true })
		const callbacks = {
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
		const block: ToolUse<"mistake_memory"> = {
			type: "tool_use",
			name: "mistake_memory",
			params: {},
			partial: false,
			nativeArgs: {
				lesson: "Only auto-approve mistake memory when common auto-approval is also enabled.",
			},
		}

		await mistakeMemoryTool.handle(task, block, callbacks)

		expect(callbacks.askApproval).not.toHaveBeenCalled()
		const output = JSON.parse(callbacks.pushToolResult.mock.calls[0][0])
		expect(output.status).toBe("pending")
		expect(output.autoApproved).toBe(false)
		expect(output.candidateId).toMatch(/^cand_/)
		const sayPayload = JSON.parse((task.say as any).mock.calls[0][1])
		expect(sayPayload).toEqual(
			expect.objectContaining({
				tool: "mistakeMemory",
				memoryId: output.id,
				status: "pending",
				autoApproved: false,
				candidateId: output.candidateId,
			}),
		)

		const store = await new MemoryStorage({ globalStoragePath: tempDir, workspacePath: task.cwd }).readStore(
			"workspace",
			task.cwd,
		)
		expect(store.memories[0].status).toBe("pending")
		expect(store.candidates[0].status).toBe("pending")
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

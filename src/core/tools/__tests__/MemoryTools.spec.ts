import * as fs from "fs/promises"
import * as os from "os"
import path from "path"

import type { MemoryScope, MemoryStatus } from "@roo-code/types"

import type { ToolUse } from "../../../shared/tools"
import { Task } from "../../task/Task"
import { MemoryStorage } from "../../memory"
import { memorySearchTool } from "../MemorySearchTool"
import { mistakeMemoryTool } from "../MistakeMemoryTool"
import { memoryWipeTool } from "../MemoryWipeTool"

const ALL_MEMORY_STATUSES: MemoryStatus[] = ["active", "pending", "stale", "superseded", "archived"]

async function getMemoryState(globalStoragePath: string, workspacePath: string) {
	const storage = new MemoryStorage({ globalStoragePath, workspacePath })
	const [summary, workspace, global] = await Promise.all([
		storage.getSummary(workspacePath),
		storage.listMemories({ scopes: ["workspace"], statuses: ALL_MEMORY_STATUSES, workspacePath }),
		storage.listMemories({ scopes: ["global"], statuses: ALL_MEMORY_STATUSES }),
	])

	return { summary, workspace, global }
}

function createTask(
	globalStoragePath: string,
	state: Record<string, unknown> = {},
	options: { askResponse?: string } = {},
): Task {
	const workspacePath = path.join(globalStoragePath, "workspace")
	let provider: any
	provider = {
		context: { globalStorageUri: { fsPath: globalStoragePath } },
		getState: vi.fn().mockResolvedValue(state),
		postMemoryStateToWebview: vi.fn().mockImplementation(() => getMemoryState(globalStoragePath, workspacePath)),
		handleMemoryAction: vi.fn().mockImplementation(async (action: string, payload: any = {}) => {
			const storage = new MemoryStorage({ globalStoragePath, workspacePath })
			const memoryScope = payload.memoryScope as MemoryScope | undefined
			const updateOptions = {
				scope: memoryScope,
				workspacePath: memoryScope === "workspace" ? workspacePath : undefined,
			}

			if (action === "approveMemory") {
				await storage.updateMemoryStatus(payload.memoryId, "active", updateOptions)
			} else if (action === "archiveMemory") {
				await storage.updateMemoryStatus(payload.memoryId, "archived", updateOptions)
			}

			return provider.postMemoryStateToWebview()
		}),
	}

	return {
		cwd: workspacePath,
		taskId: "task-1",
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		providerRef: {
			deref: () => provider,
		},
		getTaskMode: vi.fn().mockResolvedValue("code"),
		ask: vi.fn().mockResolvedValue({ response: options.askResponse ?? "yesButtonClicked" }),
		say: vi.fn().mockResolvedValue(undefined),
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("missing parameter"),
		recordToolError: vi.fn(),
		rooIgnoreController: {
			filterPaths: vi.fn((paths: string[]) => paths.filter((entry) => entry !== ".env")),
		},
	} as unknown as Task
}

function createTaskWithRealMemoryQueue(
	globalStoragePath: string,
	state: Record<string, unknown> = {},
	options: { askResponse?: string } = {},
): Task {
	const task = createTask(globalStoragePath, state, options) as any
	Object.setPrototypeOf(task, Task.prototype)

	delete task.recordToolError
	task.toolUsage = {}
	task.queuedMistakeMemoryApprovals = []
	task.drainingMistakeMemoryApprovals = undefined
	task.globalStoragePath = globalStoragePath
	task.emit = vi.fn()

	return task as unknown as Task
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

	it("blocks on chat approval by default and filters ignored path tags", async () => {
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
		expect(output.status).toBe("active")
		expect(output.candidateId).toMatch(/^cand_/)
		expect(output.approved).toBe(true)
		expect((task.providerRef.deref() as any).postMemoryStateToWebview).toHaveBeenCalledTimes(3)
		expect(task.ask).toHaveBeenCalledWith("tool", expect.stringContaining("mistakeMemory"), false, undefined, true)
		expect(task.say).not.toHaveBeenCalled()
		const askPayload = JSON.parse((task.ask as any).mock.calls[0][1])
		expect(askPayload).toEqual(
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
				message: "Pending mistake memory requires your approval before Roo continues.",
			}),
		)

		const store = await new MemoryStorage({ globalStoragePath: tempDir, workspacePath: task.cwd }).readStore(
			"workspace",
			task.cwd,
		)
		expect(store.memories[0]).toEqual(
			expect.objectContaining({
				status: "active",
				source: "mistake_tool",
				pathTags: ["src/core/task/Task.ts"],
			}),
		)
		expect(store.candidates[0].status).toBe("approved")
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

		expect(callbacks.askApproval).not.toHaveBeenCalled()
		expect(task.ask).toHaveBeenCalledWith("tool", expect.stringContaining("mistakeMemory"), false, undefined, true)
		const output = JSON.parse(callbacks.pushToolResult.mock.calls[0][0])
		expect(output.status).toBe("active")
		expect(output.candidateId).toMatch(/^cand_/)
		const store = await new MemoryStorage({ globalStoragePath: tempDir, workspacePath: task.cwd }).readStore(
			"global",
		)
		expect(store.memories[0].status).toBe("active")
		expect(store.candidates[0].status).toBe("approved")
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

	it("requires chat approval when only the memory auto-approve setting is enabled", async () => {
		const task = createTask(tempDir, { memoryAutoApproveMistakeMemory: true }, { askResponse: "noButtonClicked" })
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
		expect(task.ask).toHaveBeenCalledWith("tool", expect.stringContaining("mistakeMemory"), false, undefined, true)
		const output = JSON.parse(callbacks.pushToolResult.mock.calls[0][0])
		expect(output.status).toBe("archived")
		expect(output.autoApproved).toBe(false)
		expect(output.approved).toBe(false)
		expect(output.candidateId).toMatch(/^cand_/)
		expect(task.say).not.toHaveBeenCalled()
		const askPayload = JSON.parse((task.ask as any).mock.calls[0][1])
		expect(askPayload).toEqual(
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
		expect(store.memories[0].status).toBe("archived")
		expect(store.candidates[0].status).toBe("rejected")
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

describe("memory_wipe tool", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-memory-wipe-tool-"))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	async function seedMemoryStores(task: Task) {
		const storage = new MemoryStorage({ globalStoragePath: tempDir, workspacePath: task.cwd })
		await storage.createMemory({
			scope: "workspace",
			kind: "lesson",
			status: "active",
			source: "manual",
			lesson: "Workspace memory to remove.",
			workspacePath: task.cwd,
		})
		await storage.createMemory({
			scope: "global",
			kind: "lesson",
			status: "active",
			source: "manual",
			lesson: "Global memory to remove.",
		})

		return storage
	}

	it("records a tool error when the scope parameter is missing", async () => {
		const task = createTask(tempDir)
		const callbacks = { askApproval: vi.fn(), handleError: vi.fn(), pushToolResult: vi.fn() }
		const block: ToolUse<"memory_wipe"> = {
			type: "tool_use",
			name: "memory_wipe",
			params: {},
			partial: false,
			nativeArgs: { scope: undefined as any, confirmation: undefined },
		}

		await memoryWipeTool.handle(task, block, callbacks)

		expect(task.recordToolError).toHaveBeenCalledWith("memory_wipe")
		expect(task.didToolFailInCurrentTurn).toBe(true)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith("missing parameter")
		expect(task.ask).not.toHaveBeenCalled()
	})

	it("requires the explicit all-memory confirmation phrase before asking for approval", async () => {
		const task = createTask(tempDir)
		const callbacks = { askApproval: vi.fn(), handleError: vi.fn(), pushToolResult: vi.fn() }
		const block: ToolUse<"memory_wipe"> = {
			type: "tool_use",
			name: "memory_wipe",
			params: {},
			partial: false,
			nativeArgs: { scope: "all", confirmation: undefined },
		}

		await memoryWipeTool.handle(task, block, callbacks)

		expect(task.ask).not.toHaveBeenCalled()
		expect(callbacks.handleError).toHaveBeenCalledWith(
			"wiping memory",
			expect.objectContaining({ message: "All-memory wipe requires confirmation: WIPE ALL MEMORY" }),
		)
	})

	it("clears only workspace memory after final approval", async () => {
		const task = createTask(tempDir, {}, { askResponse: "yesButtonClicked" })
		const storage = await seedMemoryStores(task)
		const callbacks = { askApproval: vi.fn(), handleError: vi.fn(), pushToolResult: vi.fn() }
		const block: ToolUse<"memory_wipe"> = {
			type: "tool_use",
			name: "memory_wipe",
			params: {},
			partial: false,
			nativeArgs: { scope: "workspace", confirmation: undefined },
		}

		await memoryWipeTool.handle(task, block, callbacks)

		expect(task.ask).toHaveBeenCalledWith("tool", expect.stringContaining("memoryWipe"), false, undefined, true)
		expect(callbacks.handleError).not.toHaveBeenCalled()
		expect((await storage.readStore("workspace", task.cwd)).memories).toHaveLength(0)
		expect((await storage.readStore("global")).memories).toHaveLength(1)
		expect((task.providerRef.deref() as any).postMemoryStateToWebview).toHaveBeenCalledTimes(1)

		const sayPayload = JSON.parse((task.say as any).mock.calls[0][1])
		expect(sayPayload).toEqual(
			expect.objectContaining({
				tool: "memoryWipe",
				scope: "workspace",
				memoryWipeStatus: "completed",
				deletedScopes: ["workspace"],
				message: "Wiped workspace memory.",
			}),
		)

		const output = JSON.parse(callbacks.pushToolResult.mock.calls[0][0])
		expect(output).toEqual(
			expect.objectContaining({
				scope: "workspace",
				deletedScopes: ["workspace"],
				message: "Wiped workspace memory.",
				summary: expect.objectContaining({
					workspace: expect.objectContaining({ total: 0 }),
					global: expect.objectContaining({ total: 1 }),
				}),
			}),
		)
	})

	it("clears workspace and global memory after all-memory confirmation and final approval", async () => {
		const task = createTask(tempDir, {}, { askResponse: "yesButtonClicked" })
		const storage = await seedMemoryStores(task)
		const callbacks = { askApproval: vi.fn(), handleError: vi.fn(), pushToolResult: vi.fn() }
		const block: ToolUse<"memory_wipe"> = {
			type: "tool_use",
			name: "memory_wipe",
			params: {},
			partial: false,
			nativeArgs: { scope: "all", confirmation: "WIPE ALL MEMORY" },
		}

		await memoryWipeTool.handle(task, block, callbacks)

		expect(callbacks.handleError).not.toHaveBeenCalled()
		expect((await storage.readStore("workspace", task.cwd)).memories).toHaveLength(0)
		expect((await storage.readStore("global")).memories).toHaveLength(0)

		const approvalPayload = JSON.parse((task.ask as any).mock.calls[0][1])
		expect(approvalPayload).toEqual(
			expect.objectContaining({
				tool: "memoryWipe",
				scope: "all",
				memoryWipeStatus: "pending",
				message: "Roo wants to wipe workspace and global memory. This cannot be undone.",
			}),
		)
		const completionPayload = JSON.parse((task.say as any).mock.calls[0][1])
		expect(completionPayload).toEqual(
			expect.objectContaining({
				tool: "memoryWipe",
				scope: "all",
				memoryWipeStatus: "completed",
				deletedScopes: ["workspace", "global"],
			}),
		)
	})

	it("does not delete memory and emits a cancelled card when final approval is denied", async () => {
		const task = createTask(tempDir, {}, { askResponse: "noButtonClicked" })
		const storage = await seedMemoryStores(task)
		const callbacks = { askApproval: vi.fn(), handleError: vi.fn(), pushToolResult: vi.fn() }
		const block: ToolUse<"memory_wipe"> = {
			type: "tool_use",
			name: "memory_wipe",
			params: {},
			partial: false,
			nativeArgs: { scope: "global", confirmation: undefined },
		}

		await memoryWipeTool.handle(task, block, callbacks)

		expect(callbacks.handleError).not.toHaveBeenCalled()
		expect((await storage.readStore("workspace", task.cwd)).memories).toHaveLength(1)
		expect((await storage.readStore("global")).memories).toHaveLength(1)
		expect((task.providerRef.deref() as any).postMemoryStateToWebview).not.toHaveBeenCalled()

		const cancellationPayload = JSON.parse((task.say as any).mock.calls[0][1])
		expect(cancellationPayload).toEqual(
			expect.objectContaining({
				tool: "memoryWipe",
				scope: "global",
				memoryWipeStatus: "cancelled",
				message: "Memory wipe cancelled. No memories were deleted.",
			}),
		)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith("Memory wipe canceled. No memories were deleted.")
	})
})

describe("tool-error mistake memory queue", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-tool-error-memory-"))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("blocks on chat approval and activates pending mistake memories before continuing", async () => {
		const task = createTaskWithRealMemoryQueue(tempDir, {}, { askResponse: "yesButtonClicked" })

		task.recordToolError("execute_command", "Command failed with exit code 1")
		await task.drainQueuedMistakeMemories()

		expect(task.ask).toHaveBeenCalledWith("tool", expect.stringContaining("mistakeMemory"), false, undefined, true)
		expect((task.providerRef.deref() as any).handleMemoryAction).toHaveBeenCalledWith("approveMemory", {
			memoryId: expect.stringMatching(/^mem_/),
			memoryScope: "workspace",
		})
		expect((task.providerRef.deref() as any).postMemoryStateToWebview).toHaveBeenCalledTimes(3)

		const store = await new MemoryStorage({ globalStoragePath: tempDir, workspacePath: task.cwd }).readStore(
			"workspace",
			task.cwd,
		)
		expect(store.memories[0]).toEqual(
			expect.objectContaining({
				status: "active",
				source: "tool_error",
				toolName: "execute_command",
				tags: ["tool-error", "mistake"],
			}),
		)
		expect(store.candidates[0].status).toBe("approved")

		const finalPayload = JSON.parse((task.say as any).mock.calls[0][1])
		expect(finalPayload).toEqual(
			expect.objectContaining({
				tool: "mistakeMemory",
				status: "active",
				autoApproved: false,
				message: "Saved approved active mistake memory from a tool error.",
			}),
		)
	})

	it("archives pending tool-error mistake memories when chat approval is rejected", async () => {
		const task = createTaskWithRealMemoryQueue(tempDir, {}, { askResponse: "noButtonClicked" })

		task.recordToolError("apply_diff", "Patch context not found")
		await task.drainQueuedMistakeMemories()

		expect((task.providerRef.deref() as any).handleMemoryAction).toHaveBeenCalledWith("archiveMemory", {
			memoryId: expect.stringMatching(/^mem_/),
			memoryScope: "workspace",
		})

		const store = await new MemoryStorage({ globalStoragePath: tempDir, workspacePath: task.cwd }).readStore(
			"workspace",
			task.cwd,
		)
		expect(store.memories[0].status).toBe("archived")
		expect(store.candidates[0].status).toBe("rejected")

		const finalPayload = JSON.parse((task.say as any).mock.calls[0][1])
		expect(finalPayload).toEqual(
			expect.objectContaining({
				tool: "mistakeMemory",
				status: "archived",
				message: "Rejected pending mistake memory from a tool error and archived it.",
			}),
		)
	})

	it("auto-approves tool-error mistake memories without blocking when enabled", async () => {
		const task = createTaskWithRealMemoryQueue(tempDir, {
			autoApprovalEnabled: true,
			memoryAutoApproveMistakeMemory: true,
		})

		task.recordToolError("read_file", "File does not exist")
		await task.drainQueuedMistakeMemories()

		expect(task.ask).not.toHaveBeenCalled()
		expect((task.providerRef.deref() as any).handleMemoryAction).not.toHaveBeenCalled()
		expect((task.providerRef.deref() as any).postMemoryStateToWebview).toHaveBeenCalledTimes(1)

		const store = await new MemoryStorage({ globalStoragePath: tempDir, workspacePath: task.cwd }).readStore(
			"workspace",
			task.cwd,
		)
		expect(store.memories[0]).toEqual(
			expect.objectContaining({
				status: "active",
				source: "tool_error",
				toolName: "read_file",
			}),
		)
		expect(store.candidates).toHaveLength(0)

		const sayPayload = JSON.parse((task.say as any).mock.calls[0][1])
		expect(sayPayload).toEqual(
			expect.objectContaining({
				tool: "mistakeMemory",
				status: "active",
				autoApproved: true,
				message: "Saved auto-approved active mistake memory from a tool error.",
			}),
		)
	})
})

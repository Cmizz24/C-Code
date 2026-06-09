import type { MemorySearchToolParams, MemoryStatus } from "@roo-code/types"

import { DEFAULT_MEMORY_MAX_ENTRIES } from "@roo-code/types"
import { extractPathHintsFromText, MemoryStorage, retrieveMemories } from "../memory"
import { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"

function normalizeLimit(limit: number | undefined): number {
	if (!Number.isFinite(limit ?? NaN)) {
		return DEFAULT_MEMORY_MAX_ENTRIES
	}
	return Math.max(1, Math.min(25, Math.floor(limit ?? DEFAULT_MEMORY_MAX_ENTRIES)))
}

function getScopes(scope: MemorySearchToolParams["scope"]): { includeWorkspace: boolean; includeGlobal: boolean } {
	return {
		includeWorkspace: scope !== "global",
		includeGlobal: scope !== "workspace",
	}
}

function getStatuses(params: MemorySearchToolParams): MemoryStatus[] {
	if (params.status && params.status !== "all") {
		return [params.status]
	}

	if (params.status === "all") {
		return ["active", "pending", "stale", "superseded", "archived"]
	}

	return params.includePending ? ["active", "pending"] : ["active"]
}

export class MemorySearchTool extends BaseTool<"memory_search"> {
	readonly name = "memory_search" as const

	async execute(params: MemorySearchToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks
		const query = params.query?.trim()

		if (!query) {
			task.consecutiveMistakeCount++
			task.recordToolError("memory_search")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("memory_search", "query"))
			return
		}

		try {
			const provider = task.providerRef.deref()
			const globalStoragePath = provider?.context.globalStorageUri.fsPath
			if (!globalStoragePath) {
				throw new Error("Extension storage is not available.")
			}

			const mode = await task.getTaskMode()
			const storage = new MemoryStorage({ globalStoragePath, workspacePath: task.cwd })
			const { includeWorkspace, includeGlobal } = getScopes(params.scope)
			const results = await retrieveMemories({
				storage,
				query,
				workspacePath: task.cwd,
				includeWorkspace,
				includeGlobal,
				statuses: getStatuses(params),
				pathHints: extractPathHintsFromText(query),
				mode,
				maxEntries: normalizeLimit(params.limit),
				rooIgnoreController: task.rooIgnoreController,
			})

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						query,
						results: results.map((result) => ({
							id: result.memory.id,
							scope: result.memory.scope,
							kind: result.memory.kind,
							status: result.memory.status,
							title: result.memory.title,
							lesson: result.memory.lesson,
							tags: result.memory.tags,
							pathTags: result.memory.pathTags,
							mode: result.memory.mode,
							confidence: result.memory.confidence,
							score: Number(result.score.toFixed(4)),
							breakdown: result.breakdown,
						})),
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("searching memory", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"memory_search">): Promise<void> {
		await task
			.ask(
				"tool",
				JSON.stringify({
					tool: "memorySearch",
					query: block.params.query ?? "",
					scope: block.params.scope ?? "all",
				}),
				block.partial,
			)
			.catch(() => {})
	}
}

export const memorySearchTool = new MemorySearchTool()

import type { MemoryScope, MistakeMemoryToolParams } from "@roo-code/types"

import { createMistakeMemoryCandidate, MemoryStorage } from "../memory"
import { formatResponse } from "../prompts/responses"
import { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"

function normalizeScope(scope: MistakeMemoryToolParams["scope"]): MemoryScope {
	return scope === "global" ? "global" : "workspace"
}

function filterAllowedPathTags(task: Task, filePaths: string[] | undefined): string[] | undefined {
	if (!filePaths?.length) {
		return undefined
	}

	const normalized = filePaths.map((filePath) => filePath.trim()).filter(Boolean)
	return task.rooIgnoreController?.filterPaths(normalized) ?? normalized
}

export class MistakeMemoryTool extends BaseTool<"mistake_memory"> {
	readonly name = "mistake_memory" as const

	async execute(params: MistakeMemoryToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const lesson = params.lesson?.trim()

		if (!lesson) {
			task.consecutiveMistakeCount++
			task.recordToolError("mistake_memory")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("mistake_memory", "lesson"))
			return
		}

		try {
			const provider = task.providerRef.deref()
			const globalStoragePath = provider?.context.globalStorageUri.fsPath
			if (!globalStoragePath) {
				throw new Error("Extension storage is not available.")
			}

			const state = await provider?.getState()
			if (state?.memoryMistakeMemoryEnabled === false) {
				pushToolResult("Mistake memory is disabled in settings; no memory was saved.")
				return
			}

			const requestedActive = params.approve === true
			const scope = normalizeScope(params.scope)
			if (scope === "workspace" && state?.memoryWorkspaceEnabled === false) {
				pushToolResult("Workspace memory is disabled in settings; no memory was saved.")
				return
			}
			if (scope === "global" && state?.memoryGlobalEnabled === false) {
				pushToolResult("Global memory is disabled in settings; no memory was saved.")
				return
			}

			let approved = false

			if (requestedActive) {
				approved = await askApproval(
					"tool",
					JSON.stringify({
						tool: "mistakeMemory",
						scope,
						content: lesson,
						status: "active",
					}),
					undefined,
					true,
				)

				if (!approved) {
					pushToolResult(formatResponse.toolDenied())
					return
				}
			}

			const storage = new MemoryStorage({ globalStoragePath, workspacePath: task.cwd })
			const mode = await task.getTaskMode()
			const result = await createMistakeMemoryCandidate({
				storage,
				lesson,
				correction: params.correction,
				error: params.error,
				toolName: params.tool_name,
				filePaths: filterAllowedPathTags(task, params.file_paths),
				tags: params.tags,
				scope,
				source: "mistake_tool",
				approved,
				pendingCandidateLimit: state?.memoryPendingCandidateLimit,
				workspacePath: task.cwd,
				mode,
				originTaskId: task.taskId,
			})

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						id: result.memory.id,
						scope: result.memory.scope,
						status: result.memory.status,
						kind: result.memory.kind,
						reusedExisting: result.reusedExisting,
						candidateId: result.candidate?.id,
						message:
							result.memory.status === "active"
								? "Saved approved active mistake memory."
								: "Saved pending mistake-memory candidate for user review.",
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("saving mistake memory", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"mistake_memory">): Promise<void> {
		await task
			.ask(
				"tool",
				JSON.stringify({
					tool: "mistakeMemory",
					content: block.params.lesson ?? "",
					scope: block.params.scope ?? "workspace",
				}),
				block.partial,
			)
			.catch(() => {})
	}
}

export const mistakeMemoryTool = new MistakeMemoryTool()

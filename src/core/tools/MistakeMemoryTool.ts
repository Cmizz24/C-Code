import type { MemoryScope, MistakeMemoryToolParams } from "@roo-code/types"

import { createMistakeMemoryCandidate, MemoryStorage } from "../memory"
import { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"

function toMemoryScope(scope: unknown): MemoryScope | undefined {
	return scope === "workspace" || scope === "global" ? scope : undefined
}

function normalizeScope(scope: unknown, filePaths?: readonly string[]): MemoryScope {
	const normalizedScope = toMemoryScope(scope)
	if (normalizedScope) {
		return normalizedScope
	}

	return filePaths?.length ? "workspace" : "global"
}

function normalizePartialFilePaths(filePaths: unknown): string[] | undefined {
	if (Array.isArray(filePaths)) {
		const normalized = filePaths.filter((filePath): filePath is string => typeof filePath === "string")
		return normalized.length ? normalized : undefined
	}

	if (typeof filePaths !== "string") {
		return undefined
	}

	const trimmed = filePaths.trim()
	if (!trimmed) {
		return undefined
	}

	try {
		const parsed = JSON.parse(trimmed)
		if (Array.isArray(parsed)) {
			const normalized = parsed.filter((filePath): filePath is string => typeof filePath === "string")
			return normalized.length ? normalized : undefined
		}
	} catch {
		// Partial legacy params may contain a single in-progress path string instead of JSON.
	}

	return [trimmed]
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
		const { handleError, pushToolResult } = callbacks
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
			const autoApproved = state?.autoApprovalEnabled === true && state?.memoryAutoApproveMistakeMemory === true
			const filePaths = filterAllowedPathTags(task, params.file_paths)
			const scope = normalizeScope(params.scope, filePaths)
			if (scope === "workspace" && state?.memoryWorkspaceEnabled === false) {
				pushToolResult("Workspace memory is disabled in settings; no memory was saved.")
				return
			}
			if (scope === "global" && state?.memoryGlobalEnabled === false) {
				pushToolResult("Global memory is disabled in settings; no memory was saved.")
				return
			}

			const storage = new MemoryStorage({ globalStoragePath, workspacePath: task.cwd })
			const mode = await task.getTaskMode()
			const result = await createMistakeMemoryCandidate({
				storage,
				lesson,
				correction: params.correction,
				error: params.error,
				toolName: params.tool_name,
				filePaths,
				tags: params.tags,
				scope,
				source: "mistake_tool",
				approved: autoApproved,
				pendingCandidateLimit: state?.memoryPendingCandidateLimit,
				workspacePath: task.cwd,
				mode,
				originTaskId: task.taskId,
			})

			await provider.postMemoryStateToWebview().catch(() => {})

			const getMessage = (status: typeof result.memory.status, approvedByUser = false) => {
				if (status === "active") {
					if (autoApproved) {
						return "Saved auto-approved active mistake memory."
					}

					return approvedByUser || requestedActive
						? "Saved approved active mistake memory."
						: "Reused existing active mistake memory."
				}

				if (status === "archived") {
					return "Rejected pending mistake memory and archived it."
				}

				return "Pending mistake memory requires your approval before Roo continues."
			}

			const message = getMessage(result.memory.status)
			const toolPayload = {
				tool: "mistakeMemory",
				content: result.memory.lesson,
				memoryId: result.memory.id,
				scope: result.memory.scope,
				status: result.memory.status,
				candidateId: result.candidate?.id,
				title: result.memory.title,
				tags: result.memory.tags,
				pathTags: result.memory.pathTags,
				mode: result.memory.mode,
				toolName: result.memory.toolName,
				mistakeSignature: result.memory.mistakeSignature,
				autoApproved,
				reusedExisting: result.reusedExisting,
				message,
			} as const

			let finalMemory = result.memory
			let approvedByUser = false

			if (result.memory.status === "pending" && !autoApproved) {
				const { response } = await task.ask("tool", JSON.stringify(toolPayload), false, undefined, true)
				approvedByUser = response === "yesButtonClicked"
				const memoryState = await provider.handleMemoryAction(
					approvedByUser ? "approveMemory" : "archiveMemory",
					{
						memoryId: result.memory.id,
						memoryScope: result.memory.scope,
					},
				)
				finalMemory =
					[...memoryState.workspace, ...memoryState.global].find(
						(memory) => memory.id === result.memory.id,
					) ?? result.memory
				await provider.postMemoryStateToWebview().catch(() => {})
			} else {
				await task
					.say("tool", JSON.stringify(toolPayload), undefined, false, undefined, undefined, {
						isNonInteractive: true,
					})
					.catch(() => {})
			}

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						id: finalMemory.id,
						scope: finalMemory.scope,
						status: finalMemory.status,
						kind: finalMemory.kind,
						autoApproved,
						approved: approvedByUser || autoApproved,
						reusedExisting: result.reusedExisting,
						candidateId: result.candidate?.id,
						message: getMessage(finalMemory.status, approvedByUser),
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
		const partialArgs = block.nativeArgs as Partial<MistakeMemoryToolParams> | undefined
		const partialFilePaths = normalizePartialFilePaths(partialArgs?.file_paths ?? block.params.file_paths)

		await task
			.say(
				"tool",
				JSON.stringify({
					tool: "mistakeMemory",
					content: partialArgs?.lesson ?? block.params.lesson ?? "",
					scope: normalizeScope(partialArgs?.scope ?? block.params.scope, partialFilePaths),
				}),
				undefined,
				block.partial,
				undefined,
				undefined,
				{ isNonInteractive: true },
			)
			.catch(() => {})
	}
}

export const mistakeMemoryTool = new MistakeMemoryTool()

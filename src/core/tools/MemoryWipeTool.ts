import type { ClineSayTool, MemoryScope, MemoryWipeToolParams } from "@roo-code/types"

import { MemoryStorage } from "../memory"
import { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"

const ALL_MEMORY_CONFIRMATION = "WIPE ALL MEMORY"

function normalizeScope(scope: MemoryWipeToolParams["scope"]): MemoryScope | "all" | undefined {
	return scope === "workspace" || scope === "global" || scope === "all" ? scope : undefined
}

function getScopesToWipe(scope: MemoryScope | "all"): MemoryScope[] {
	return scope === "all" ? ["workspace", "global"] : [scope]
}

function getWipeMessage(scope: MemoryScope | "all", completed = false): string {
	const target = scope === "all" ? "workspace and global memory" : `${scope} memory`
	return completed ? `Wiped ${target}.` : `Roo wants to wipe ${target}. This cannot be undone.`
}

export class MemoryWipeTool extends BaseTool<"memory_wipe"> {
	readonly name = "memory_wipe" as const

	async execute(params: MemoryWipeToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks
		const scope = normalizeScope(params.scope)

		if (!scope) {
			task.consecutiveMistakeCount++
			task.recordToolError("memory_wipe")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("memory_wipe", "scope"))
			return
		}

		try {
			if (scope === "all" && params.confirmation !== ALL_MEMORY_CONFIRMATION) {
				throw new Error(`All-memory wipe requires confirmation: ${ALL_MEMORY_CONFIRMATION}`)
			}

			const provider = task.providerRef.deref()
			const globalStoragePath = provider?.context.globalStorageUri.fsPath
			if (!provider || !globalStoragePath) {
				throw new Error("Extension storage is not available.")
			}

			const requestedScopes = getScopesToWipe(scope)
			const approvalPayload: ClineSayTool = {
				tool: "memoryWipe",
				scope,
				message: getWipeMessage(scope),
				memoryWipeStatus: "pending",
			}

			const { response } = await task.ask("tool", JSON.stringify(approvalPayload), false, undefined, true)
			if (response !== "yesButtonClicked") {
				const cancellationPayload: ClineSayTool = {
					...approvalPayload,
					message: "Memory wipe cancelled. No memories were deleted.",
					memoryWipeStatus: "cancelled",
				}
				await task
					.say("tool", JSON.stringify(cancellationPayload), undefined, false, undefined, undefined, {
						isNonInteractive: true,
					})
					.catch(() => {})
				pushToolResult("Memory wipe canceled. No memories were deleted.")
				return
			}

			const storage = new MemoryStorage({ globalStoragePath, workspacePath: task.cwd })
			if (requestedScopes.includes("workspace")) {
				await storage.clearWorkspaceMemory(task.cwd)
			}
			if (requestedScopes.includes("global")) {
				await storage.clearGlobalMemory()
			}

			const memoryState = await provider.postMemoryStateToWebview()
			const completionPayload: ClineSayTool = {
				...approvalPayload,
				message: getWipeMessage(scope, true),
				memoryWipeStatus: "completed",
				deletedScopes: requestedScopes,
			}
			await task
				.say("tool", JSON.stringify(completionPayload), undefined, false, undefined, undefined, {
					isNonInteractive: true,
				})
				.catch(() => {})

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						scope,
						deletedScopes: requestedScopes,
						message: getWipeMessage(scope, true),
						summary: memoryState.summary,
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("wiping memory", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"memory_wipe">): Promise<void> {
		await task
			.say(
				"tool",
				JSON.stringify({
					tool: "memoryWipe",
					scope: block.params.scope ?? "workspace",
					memoryWipeStatus: "pending",
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

export const memoryWipeTool = new MemoryWipeTool()

import type { AskForContextToolParams, ClineSayTool } from "@roo-code/types"

import { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"

export class AskForContextTool extends BaseTool<"ask_for_context"> {
	readonly name = "ask_for_context" as const

	async execute(params: AskForContextToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks
		const query = params.query?.trim()
		const filePath = params.filePath?.trim() || undefined

		if (!query) {
			task.consecutiveMistakeCount++
			task.recordToolError("ask_for_context")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("ask_for_context", "query"))
			return
		}

		try {
			const contextResults = await task.askForColdContext(query, { filePath, limit: 3 })

			task.consecutiveMistakeCount = 0
			await task
				.say(
					"tool",
					JSON.stringify({
						tool: "askForContext",
						query,
						filePath,
						message:
							contextResults.length > 0
								? `Found ${contextResults.length} matching context ${contextResults.length === 1 ? "chunk" : "chunks"}.`
								: "No matching cold context chunks found.",
						contextResults,
					} satisfies ClineSayTool),
					undefined,
					false,
					undefined,
					undefined,
					{ isNonInteractive: true },
				)
				.catch(() => {})
			await task.emitContextCacheEvents?.()

			pushToolResult(
				JSON.stringify(
					{
						query,
						filePath,
						results: contextResults,
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("asking context cache", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"ask_for_context">): Promise<void> {
		await task
			.say(
				"tool",
				JSON.stringify({
					tool: "askForContext",
					query: block.params.query ?? "",
					filePath: block.params.filePath,
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

export const askForContextTool = new AskForContextTool()

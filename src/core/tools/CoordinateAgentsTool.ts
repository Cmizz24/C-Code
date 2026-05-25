import type { NativeToolArgs } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { Task } from "../task/Task"

import { BaseTool, ToolCallbacks } from "./BaseTool"

type CoordinateAgentsParams = NativeToolArgs["coordinate_agents"]

function formatCoordinationEvent(event: NonNullable<ReturnType<Task["publishAgentCoordination"]>>): string {
	const target = event.targetAgentId ? ` -> ${event.targetAgentId}` : ""
	const files = event.relatedFiles?.length ? ` [${event.relatedFiles.join(", ")}]` : ""
	return `- ${event.id ?? event.ts} ${event.kind}${target}: ${event.message}${files}`
}

export class CoordinateAgentsTool extends BaseTool<"coordinate_agents"> {
	readonly name = "coordinate_agents" as const

	async execute(params: CoordinateAgentsParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks

		if (!task.canCoordinateWithAgents()) {
			task.consecutiveMistakeCount++
			task.recordToolError("coordinate_agents", "Tool is only available to background parallel agents.")
			pushToolResult(
				formatResponse.toolError("coordinate_agents is only available to background parallel agents."),
			)
			return
		}

		if (params.action === "publish") {
			if (!params.message?.trim()) {
				task.consecutiveMistakeCount++
				task.recordToolError("coordinate_agents", "Missing required message for publish action.")
				pushToolResult(
					formatResponse.toolError("Missing required message for coordinate_agents publish action."),
				)
				return
			}

			const event = task.publishAgentCoordination({
				kind: params.kind,
				message: params.message,
				targetAgentId: params.targetAgentId,
				relatedFiles: params.relatedFiles,
				replyToId: params.replyToId,
			})

			if (!event) {
				pushToolResult(formatResponse.toolError("Unable to publish coordination message."))
				return
			}

			task.consecutiveMistakeCount = 0
			const recent = task.getAgentCoordinationEvents({ limit: params.limit })
			pushToolResult(
				[
					`Published coordination message ${event.id ?? event.ts} (${event.kind}).`,
					recent.length ? "Recent relevant coordination:" : "No other recent coordination messages.",
					...recent.map(formatCoordinationEvent),
				].join("\n"),
			)
			return
		}

		if (params.action === "read") {
			task.consecutiveMistakeCount = 0
			const recent = task.getAgentCoordinationEvents({ limit: params.limit })
			pushToolResult(
				recent.length
					? ["Recent relevant coordination:", ...recent.map(formatCoordinationEvent)].join("\n")
					: "No recent relevant coordination messages.",
			)
			return
		}

		task.consecutiveMistakeCount++
		task.recordToolError("coordinate_agents", `Unsupported action: ${String(params.action)}`)
		pushToolResult(formatResponse.toolError("coordinate_agents action must be 'publish' or 'read'."))
	}
}

export const coordinateAgentsTool = new CoordinateAgentsTool()

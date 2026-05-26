import type { NativeToolArgs } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { Task } from "../task/Task"

import { BaseTool, ToolCallbacks } from "./BaseTool"

type CoordinateAgentsParams = NativeToolArgs["coordinate_agents"]

const BROADCAST_TARGET_SENTINELS = new Set(["all", "none"])
const NO_REPLY_SENTINELS = new Set(["none"])

function normalizeOptionalCoordinationString(
	value: string | undefined,
	sentinels: ReadonlySet<string>,
): string | undefined {
	const normalized = value?.trim()

	if (!normalized || sentinels.has(normalized.toLowerCase())) {
		return undefined
	}

	return normalized
}

function formatCoordinationEvent(event: NonNullable<ReturnType<Task["publishAgentCoordination"]>>): string {
	const speaker = event.agentId ?? "team"
	const target = event.targetAgentId ? ` to ${event.targetAgentId}` : ""
	const id = event.id ? ` [${event.id}]` : ""
	const files = event.relatedFiles?.length ? ` (${event.relatedFiles.join(", ")})` : ""
	return `- ${event.kind} ${speaker}${target}${id}: ${event.message}${files}`
}

function formatOpenQuestions(openQuestions: ReturnType<Task["getAgentCoordinationEvents"]>): string[] {
	if (openQuestions.length === 0) {
		return []
	}

	return [
		"Open questions for you:",
		...openQuestions.map(
			(event) => `- Reply with kind='answer' and replyToId='${event.id ?? ""}': ${event.message}`,
		),
	]
}

function formatCoordinationReadResult(
	recent: ReturnType<Task["getAgentCoordinationEvents"]>,
	openQuestions: ReturnType<Task["getAgentCoordinationEvents"]>,
): string {
	return [
		...formatOpenQuestions(openQuestions),
		recent.length ? "Recent team chat:" : "No recent team chat messages.",
		...recent.map(formatCoordinationEvent),
	]
		.filter(Boolean)
		.join("\n")
}

function formatTerminalPublishSuppression(
	status: string | undefined,
	recent: ReturnType<Task["getAgentCoordinationEvents"]>,
): string {
	const statusText = status ? ` (${status})` : ""
	return [
		`No team chat was posted because this agent is already terminal${statusText}.`,
		"Use attempt_completion or structured completion status for final evidence instead of team chat.",
		recent.length ? "Recent team chat:" : "No recent team chat messages.",
		...recent.map(formatCoordinationEvent),
	].join("\n")
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

			if (task.isAgentTerminal()) {
				task.consecutiveMistakeCount = 0
				const recent = task.getAgentCoordinationEvents({ limit: params.limit })
				pushToolResult(formatTerminalPublishSuppression(task.getAgentStatus(), recent))
				return
			}

			if (params.kind !== "question" && params.kind !== "answer") {
				task.consecutiveMistakeCount++
				task.recordToolError(
					"coordinate_agents",
					"Publish requires kind='question' or kind='answer' for active team coordination.",
				)
				pushToolResult(
					formatResponse.toolError(
						"Publish a real integration question or answer. Do not post ownership/status-only team chat.",
					),
				)
				return
			}

			const event = task.publishAgentCoordination({
				kind: params.kind,
				message: params.message,
				targetAgentId: normalizeOptionalCoordinationString(params.targetAgentId, BROADCAST_TARGET_SENTINELS),
				relatedFiles: params.relatedFiles,
				replyToId: normalizeOptionalCoordinationString(params.replyToId, NO_REPLY_SENTINELS),
			})

			if (!event) {
				pushToolResult(formatResponse.toolError("Unable to publish coordination message."))
				return
			}

			task.consecutiveMistakeCount = 0
			const recent = task.getAgentCoordinationEvents({ limit: params.limit })
			const openQuestions = task.getOpenAgentCoordinationQuestions({ limit: params.limit })
			pushToolResult(
				[
					`Published team chat message ${event.id ?? event.ts}.`,
					...formatOpenQuestions(openQuestions),
					recent.length ? "Recent team chat:" : "No other recent team chat messages.",
					...recent.map(formatCoordinationEvent),
				].join("\n"),
			)
			return
		}

		if (params.action === "read") {
			task.consecutiveMistakeCount = 0
			const recent = task.getAgentCoordinationEvents({ limit: params.limit })
			const openQuestions = task.getOpenAgentCoordinationQuestions({ limit: params.limit })
			pushToolResult(formatCoordinationReadResult(recent, openQuestions))
			return
		}

		task.consecutiveMistakeCount++
		task.recordToolError("coordinate_agents", `Unsupported action: ${String(params.action)}`)
		pushToolResult(formatResponse.toolError("coordinate_agents action must be 'publish' or 'read'."))
	}
}

export const coordinateAgentsTool = new CoordinateAgentsTool()

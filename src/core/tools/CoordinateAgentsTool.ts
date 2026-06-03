import type { NativeToolArgs } from "../../shared/tools"
import { isGenericOwnershipCoordinationMessage } from "../agents/AgentBus"
import { formatResponse } from "../prompts/responses"
import { Task } from "../task/Task"

import { BaseTool, ToolCallbacks } from "./BaseTool"

type CoordinateAgentsParams = NativeToolArgs["coordinate_agents"]

const BROADCAST_TARGET_SENTINELS = new Set(["all", "none"])
const NO_REPLY_SENTINELS = new Set(["none"])
const PUBLISHABLE_COORDINATION_KINDS = new Set(["question", "answer", "decision", "note", "blocker"])

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
	const reply = event.replyToId ? ` replyTo ${event.replyToId}` : ""
	const state = event.kind === "question" && event.answerState ? ` ${event.answerState}` : ""
	return `- ${event.kind}${state} ${speaker}${target}${id}${reply}: ${event.message}${files}`
}

function formatOpenQuestions(openQuestions: ReturnType<Task["getAgentCoordinationEvents"]>): string[] {
	if (openQuestions.length === 0) {
		return []
	}

	return [
		"Open questions for you:",
		...openQuestions.map(
			(event) =>
				`- Reply with kind='answer' and replyToId='${event.id ?? ""}'${event.agentId ? ` to ${event.agentId}` : ""}: ${event.message}`,
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

function formatContractAcknowledgementResult(
	event: NonNullable<ReturnType<Task["acknowledgeAgentSharedContract"]>> | undefined,
	recent: ReturnType<Task["getAgentCoordinationEvents"]>,
	openQuestions: ReturnType<Task["getAgentCoordinationEvents"]>,
): string {
	return [
		event
			? `Acknowledged shared contract for this agent (${event.id ?? event.ts}).`
			: "No shared contract requires acknowledgement for this agent.",
		...formatOpenQuestions(openQuestions),
		recent.length ? "Recent team chat:" : "No recent team chat messages.",
		...recent.map(formatCoordinationEvent),
	]
		.filter(Boolean)
		.join("\n")
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

		if (params.action === "acknowledge_contract") {
			task.consecutiveMistakeCount = 0
			const event = task.acknowledgeAgentSharedContract()
			const recent = task.getAgentCoordinationEvents({ limit: params.limit })
			const openQuestions = task.getOpenAgentCoordinationQuestions({ limit: params.limit })
			pushToolResult(formatContractAcknowledgementResult(event, recent, openQuestions))
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

			const normalizedReplyToId = normalizeOptionalCoordinationString(params.replyToId, NO_REPLY_SENTINELS)
			const normalizedTargetAgentId = normalizeOptionalCoordinationString(
				params.targetAgentId,
				BROADCAST_TARGET_SENTINELS,
			)
			const isPotentialTargetedAnswer = Boolean(
				params.kind === "answer" &&
					(normalizedReplyToId || normalizedTargetAgentId || params.relatedFiles?.length),
			)

			if (task.isAgentTerminal() && !isPotentialTargetedAnswer) {
				task.consecutiveMistakeCount = 0
				const recent = task.getAgentCoordinationEvents({ limit: params.limit })
				pushToolResult(formatTerminalPublishSuppression(task.getAgentStatus(), recent))
				return
			}

			if (!PUBLISHABLE_COORDINATION_KINDS.has(params.kind ?? "")) {
				task.consecutiveMistakeCount++
				task.recordToolError(
					"coordinate_agents",
					"Publish requires kind='question', kind='answer', kind='decision', kind='note', or kind='blocker' for active team coordination.",
				)
				pushToolResult(
					formatResponse.toolError(
						"Publish a real integration question, answer, decision, assumption note, or blocker. Do not post ownership/status-only team chat.",
					),
				)
				return
			}

			if (isGenericOwnershipCoordinationMessage(params.message)) {
				task.consecutiveMistakeCount++
				task.recordToolError(
					"coordinate_agents",
					"Publish requires a concrete integration question, answer, decision, assumption note, or blocker; ownership/status-only team chat is not allowed.",
				)
				pushToolResult(
					formatResponse.toolError(
						"Publish concrete integration coordination only. Do not post ownership introductions, status-only updates, or generic team-chat setup messages.",
					),
				)
				return
			}

			if (
				params.kind === "answer" &&
				!normalizedReplyToId &&
				!normalizedTargetAgentId &&
				!params.relatedFiles?.length
			) {
				task.consecutiveMistakeCount++
				task.recordToolError(
					"coordinate_agents",
					"Answers must reply to an open question with replyToId, or include targetAgentId/relatedFiles for matching.",
				)
				pushToolResult(
					formatResponse.toolError(
						"Answer an open question by including replyToId from coordinate_agents read. If replyToId is unavailable, include targetAgentId and relatedFiles so the answer can be matched.",
					),
				)
				return
			}

			const event = task.publishAgentCoordination({
				kind: params.kind,
				message: params.message,
				targetAgentId: normalizedTargetAgentId,
				relatedFiles: params.relatedFiles,
				replyToId: normalizedReplyToId,
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
		pushToolResult(
			formatResponse.toolError("coordinate_agents action must be 'publish', 'read', or 'acknowledge_contract'."),
		)
	}
}

export const coordinateAgentsTool = new CoordinateAgentsTool()

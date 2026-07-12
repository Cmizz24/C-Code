import * as vscode from "vscode"

import { RooCodeEventName, type AgentCoordinationEvent, type HistoryItem } from "@roo-code/types"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { Package } from "../../shared/package"
import type { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface AttemptCompletionParams {
	result: string
	command?: string
}

export interface AttemptCompletionCallbacks extends ToolCallbacks {
	askFinishSubTaskApproval: () => Promise<boolean>
	toolDescription: () => string
	onAccepted?: () => void
}

/**
 * Interface for provider methods needed by AttemptCompletionTool for delegation handling.
 */
interface DelegationProvider {
	getTaskWithId(id: string): Promise<{ historyItem: HistoryItem }>
	reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void>
}

function isAbortedTaskSayError(task: Task, error: unknown): boolean {
	return (
		task.abort === true &&
		error instanceof Error &&
		error.message.includes("aborted") &&
		error.message.includes(`${task.taskId}.${task.instanceId}`)
	)
}

/**
 * Common English stop words to filter out when extracting significant words.
 */
const STOP_WORDS = new Set([
	"the",
	"a",
	"an",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"will",
	"would",
	"could",
	"should",
	"may",
	"might",
	"shall",
	"can",
	"need",
	"dare",
	"ought",
	"used",
	"to",
	"of",
	"in",
	"for",
	"on",
	"with",
	"at",
	"by",
	"from",
	"as",
	"into",
	"through",
	"during",
	"before",
	"after",
	"above",
	"below",
	"between",
	"out",
	"off",
	"over",
	"under",
	"again",
	"further",
	"then",
	"once",
	"and",
	"but",
	"or",
	"nor",
	"not",
	"so",
	"yet",
	"both",
	"either",
	"neither",
	"each",
	"every",
	"all",
	"any",
	"few",
	"more",
	"most",
	"other",
	"some",
	"such",
	"no",
	"only",
	"own",
	"same",
	"than",
	"too",
	"very",
	"just",
	"that",
	"this",
	"these",
	"those",
	"i",
	"me",
	"my",
	"we",
	"our",
	"you",
	"your",
	"he",
	"him",
	"his",
	"she",
	"her",
	"it",
	"its",
	"they",
	"them",
	"their",
	"what",
	"which",
	"who",
	"whom",
	"when",
	"where",
	"why",
	"how",
	"if",
	"then",
	"else",
	"about",
	"up",
	"down",
	"there",
	"here",
])

/**
 * Extract significant words from text, filtering out stop words and short words.
 */
export function extractSignificantWords(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.split(/\s+/)
			.filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
	)
}

/**
 * Represents a single requirement extracted from the original task.
 */
export interface ExtractedRequirement {
	/** The raw text of the requirement */
	text: string
	/** Significant words from this requirement */
	keywords: Set<string>
}

/**
 * Extract structured requirements from the original task text.
 * Looks for numbered lists, bullet points, and conjunction-based splits.
 * Returns an array of requirements; treats the whole task as one if no structure is found.
 */
export function extractRequirements(task: string): ExtractedRequirement[] {
	const requirements: ExtractedRequirement[] = []
	const trimmedTask = task.trim()

	if (trimmedTask.length < 10) {
		return []
	}

	// Strategy 1: Split on numbered list patterns ("1.", "2.", "1)", "2)") or bullet points ("-", "*", "•")
	const numberedPattern = /\n\s*(?:\d+[.)]\s+|[-*•]\s+)/
	const segments = trimmedTask
		.split(numberedPattern)
		.map((s) => s.trim())
		.filter((s) => s.length > 5)

	if (segments.length > 1) {
		for (let i = 0; i < segments.length; i++) {
			// Clean up leading list markers that may remain
			const cleaned = segments[i].replace(/^\d+[.)]\s*/, "").trim()
			// Skip header/preamble text that ends with ":" or ";" (e.g., "Please complete these tasks:")
			if (i === 0 && /[:;]\s*$/.test(cleaned)) {
				continue
			}
			if (cleaned.length > 5) {
				requirements.push({
					text: cleaned,
					keywords: extractSignificantWords(cleaned),
				})
			}
		}
	}

	// Strategy 2: If no list found, try splitting on conjunctions / transition phrases
	if (requirements.length === 0) {
		const conjunctionPattern = /\s+(?:and|also|additionally|furthermore|moreover|plus|as well as)\s+/i
		const conjSegments = trimmedTask
			.split(conjunctionPattern)
			.map((s) => s.trim())
			.filter((s) => s.length > 10)

		if (conjSegments.length > 1) {
			for (const segment of conjSegments) {
				requirements.push({
					text: segment,
					keywords: extractSignificantWords(segment),
				})
			}
		}
	}

	// Strategy 3: Fallback — treat entire task as a single requirement
	if (requirements.length === 0) {
		requirements.push({
			text: trimmedTask,
			keywords: extractSignificantWords(trimmedTask),
		})
	}

	return requirements
}

/**
 * Check if a single requirement is addressed by the result.
 * Uses keyword overlap — a requirement is met if at least one significant keyword
 * appears in the result, or if the overall overlap ratio is reasonable.
 */
function isRequirementMet(requirement: ExtractedRequirement, resultWords: Set<string>): boolean {
	if (requirement.keywords.size === 0) {
		// No keywords to check — assume met (can't disprove).
		return true
	}

	const overlap = [...requirement.keywords].filter((w) => resultWords.has(w))
	const overlapRatio = overlap.length / requirement.keywords.size

	// Require at least 1 keyword match, OR a 30% overlap ratio for short keyword sets.
	return overlap.length >= 1 || overlapRatio >= 0.3
}

/**
 * Result of structured completion verification, including per-requirement status.
 */
export interface VerificationResult {
	/** Error message if verification failed, undefined if passed */
	error: string | undefined
	/** Requirements extracted from the original task */
	requirements: ExtractedRequirement[]
	/** Indexes of requirements that were verified as met */
	requirementsCompleted: number[]
}

/**
 * Verify that a completion result addresses the original task.
 * Uses structured requirement extraction and per-requirement checking.
 * Returns a VerificationResult with per-requirement completion status.
 */
export function verifyCompletion(originalTask: string, result: string): VerificationResult {
	const emptyResult = (requirements: ExtractedRequirement[], completed: number[]): VerificationResult => ({
		error: undefined,
		requirements,
		requirementsCompleted: completed,
	})

	// Skip verification if the original task is empty or very short.
	if (!originalTask || originalTask.trim().length < 10) {
		return emptyResult([], [])
	}

	// Extract structured requirements from the original task.
	const requirements = extractRequirements(originalTask)

	if (requirements.length === 0) {
		return emptyResult([], [])
	}

	// Skip verification if the result is substantial (likely a real answer).
	if (result.trim().length < 20) {
		return {
			error:
				"Your completion result is too brief. Before calling attempt_completion, you MUST verify that " +
				"your result directly addresses the user's original request. Review the original task, check that " +
				"all requirements are met, and ensure you haven't missed any aspects of what was asked. " +
				"Provide a more detailed completion result that clearly demonstrates the task is complete.",
			requirements,
			requirementsCompleted: [],
		}
	}

	// If only one requirement (entire task as single block), fall back to overall keyword overlap check.
	if (requirements.length === 1) {
		const taskWords = requirements[0].keywords
		const resultWords = extractSignificantWords(result)

		if (taskWords.size === 0) {
			return emptyResult(requirements, [0])
		}

		const overlap = [...taskWords].filter((word) => resultWords.has(word))
		const overlapRatio = overlap.length / taskWords.size

		if (taskWords.size >= 3 && overlap.length < 2 && overlapRatio < 0.1) {
			return {
				error:
					"Your completion result does not appear to address the user's original request. " +
					"Before calling attempt_completion, you MUST verify that your result directly addresses " +
					"the user's original request. Review the original task, check that all requirements are met, " +
					"and ensure you haven't missed any aspects of what was asked.",
				requirements,
				requirementsCompleted: [],
			}
		}

		return emptyResult(requirements, [0])
	}

	// Multiple requirements: check each one against the result.
	const resultWords = extractSignificantWords(result)
	const unmetRequirements: string[] = []
	const completedIndexes: number[] = []

	for (let i = 0; i < requirements.length; i++) {
		if (isRequirementMet(requirements[i], resultWords)) {
			completedIndexes.push(i)
		} else {
			// Truncate long requirements for the feedback message.
			const displayText =
				requirements[i].text.length > 80 ? requirements[i].text.substring(0, 77) + "..." : requirements[i].text
			unmetRequirements.push(displayText)
		}
	}

	if (unmetRequirements.length === 0) {
		return emptyResult(requirements, completedIndexes)
	}

	// Build a specific feedback message listing unmet requirements.
	const requirementList = unmetRequirements.map((r, i) => `  ${i + 1}. ${r}`).join("\n")

	return {
		error:
			"Your completion result does not appear to address all requirements from the original task. " +
			"The following requirements were not clearly addressed:\n" +
			requirementList +
			"\nBefore calling attempt_completion, review the original task and ensure each requirement is " +
			"explicitly addressed in your result. If you have addressed these requirements using different " +
			"terminology, make sure the connection is clear in your completion message.",
		requirements,
		requirementsCompleted: completedIndexes,
	}
}

/**
 * Backward-compatible wrapper around verifyCompletion that returns just the error string.
 * Used by existing tests and callers that only need the error message.
 */
export function verifyCompletionAgainstTask(originalTask: string, result: string): string | undefined {
	return verifyCompletion(originalTask, result).error
}

function isParallelAgentTask(task: Task): boolean {
	return Boolean(task.agentId || task.agentBus)
}

function formatQuestionReference(question: AgentCoordinationEvent): string {
	const parties = [
		question.agentId ? `from ${question.agentId}` : undefined,
		question.targetAgentId ? `to ${question.targetAgentId}` : undefined,
	]
		.filter(Boolean)
		.join(", ")
	const files = question.relatedFiles?.length ? ` [${question.relatedFiles.join(", ")}]` : ""
	return `${question.id ?? "unknown"}${parties ? ` (${parties})` : ""}${files}: ${question.message}`
}

function formatCompletionCoordinationGate(task: Task): string | undefined {
	const gate = task.getAgentCompletionCoordinationGate({ recordAttempt: true })
	if (gate.approved) {
		return undefined
	}

	const incoming = gate.blockers.filter((blocker) => blocker.type === "incoming-question")
	const outgoing = gate.blockers.filter((blocker) => blocker.type === "outgoing-question")
	const unreadAnswers = gate.blockers.filter((blocker) => blocker.type === "unread-answer")
	const sharedContractBlockers = gate.blockers.filter((blocker) => blocker.type === "shared-contract-unacknowledged")
	const lines = [
		"Cannot complete: unresolved parallel-agent coordination.",
		sharedContractBlockers.length ? "Acknowledge shared contract before retrying:" : undefined,
		...sharedContractBlockers.map(
			(blocker) => `- coordinate_agents action='acknowledge_contract': ${blocker.sharedContract}`,
		),
		incoming.length ? "Answer incoming questions:" : undefined,
		...incoming.map(
			(blocker) =>
				`- coordinate_agents action='publish' kind='answer' replyToId='${blocker.question.id ?? ""}': ${formatQuestionReference(blocker.question)}`,
		),
		outgoing.length ? "Wait or escalate targeted questions:" : undefined,
		...outgoing.map((blocker) => `- waiting for answer to ${formatQuestionReference(blocker.question)}`),
		unreadAnswers.length ? "Read new answers:" : undefined,
		...unreadAnswers.map(
			(blocker) =>
				`- ${blocker.answer?.id ?? "unknown"} for ${blocker.question.id ?? "unknown"}: ${blocker.answer?.message ?? ""}`,
		),
		"Next: coordinate_agents action='read'; answer incoming; acknowledge contracts; wait for targeted replies or escalate; then retry attempt_completion.",
	]

	return lines.filter(Boolean).join("\n")
}

export class AttemptCompletionTool extends BaseTool<"attempt_completion"> {
	readonly name = "attempt_completion" as const

	// Track per-task completion verification failure counts for bypass logic.
	private readonly completionVerificationFailureCount: Map<string, number> = new Map()

	// Track per-task requirements completion status for observability.
	private readonly requirementsCompletedMap: Map<string, number[]> = new Map()

	async execute(params: AttemptCompletionParams, task: Task, callbacks: AttemptCompletionCallbacks): Promise<void> {
		const { result } = params
		const { handleError, pushToolResult, askFinishSubTaskApproval } = callbacks

		// Prevent attempt_completion if any tool failed in the current turn
		if (task.didToolFailInCurrentTurn) {
			const errorMsg = t("common:errors.attempt_completion_tool_failed")

			try {
				await task.say("error", errorMsg)
			} catch (error) {
				if (!isAbortedTaskSayError(task, error)) {
					throw error
				}

				console.warn(
					`[AttemptCompletionTool] Skipping failed-tool error say for aborted task ${task.taskId}.${task.instanceId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		const preventCompletionWithOpenTodos = vscode.workspace
			.getConfiguration(Package.name)
			.get<boolean>("preventCompletionWithOpenTodos", false)

		const hasIncompleteTodos = task.todoList && task.todoList.some((todo) => todo.status !== "completed")

		if (preventCompletionWithOpenTodos && hasIncompleteTodos) {
			task.consecutiveMistakeCount++
			task.recordToolError("attempt_completion")

			pushToolResult(
				formatResponse.toolError(
					"Cannot complete task while there are incomplete todos. Please finish all todos before attempting completion.",
				),
			)

			return
		}

		try {
			if (!result) {
				task.consecutiveMistakeCount++
				task.recordToolError("attempt_completion")
				pushToolResult(await task.sayAndCreateMissingParamError("attempt_completion", "result"))
				return
			}

			// Completion verification: check that the result addresses the original task.
			const enableCompletionVerification = vscode.workspace
				.getConfiguration(Package.name)
				.get<boolean>("enableCompletionVerification", true)

			if (enableCompletionVerification) {
				const originalTask = task.metadata?.task ?? ""
				const verificationFailures = this.completionVerificationFailureCount.get(task.taskId) ?? 0

				// Bypass verification after 3 consecutive failures (user keeps accepting).
				if (verificationFailures < 3) {
					const verificationResult = verifyCompletion(originalTask, result)

					// Track which requirements have been verified as completed.
					this.requirementsCompletedMap.set(task.taskId, verificationResult.requirementsCompleted)

					if (verificationResult.error) {
						this.completionVerificationFailureCount.set(task.taskId, verificationFailures + 1)
						task.consecutiveMistakeCount++
						task.recordToolError("attempt_completion", "Completion verification failed.")
						pushToolResult(formatResponse.toolError(verificationResult.error))
						return
					}
				}

				// Clear failure count on successful verification.
				this.completionVerificationFailureCount.delete(task.taskId)
			}

			if (isParallelAgentTask(task)) {
				const coordinationGateMessage = formatCompletionCoordinationGate(task)
				if (coordinationGateMessage) {
					task.consecutiveMistakeCount++
					task.recordToolError(
						"attempt_completion",
						"Open parallel-agent coordination questions are unresolved.",
					)
					pushToolResult(formatResponse.toolError(coordinationGateMessage))
					return
				}
			}

			task.consecutiveMistakeCount = 0

			await task.say("completion_result", result, undefined, false)

			if (isParallelAgentTask(task)) {
				await this.completeParallelAgentTask(task)
				callbacks.onAccepted?.()
				return
			}

			// Check for subtask using parentTaskId (metadata-driven delegation).
			if (task.parentTaskId) {
				// Check if this subtask has already completed and returned to parent
				// to prevent duplicate tool_results when user revisits from history
				const provider = task.providerRef.deref() as DelegationProvider | undefined
				if (provider) {
					try {
						const { historyItem } = await provider.getTaskWithId(task.taskId)
						const status = historyItem?.status

						if (status === "completed") {
							// Subtask already completed - skip delegation flow entirely
							// Fall through to normal completion ask flow below (outside this if block)
							// This shows the user the completion result and waits for acceptance
							// without injecting another tool_result to the parent
						} else if (status === "active") {
							// Normal subtask completion - do delegation
							const delegation = await this.delegateToParent(
								task,
								result,
								provider,
								askFinishSubTaskApproval,
								pushToolResult,
							)
							if (delegation === "delegated") {
								await this.emitTaskCompleted(task)
								callbacks.onAccepted?.()
							}
							if (delegation !== "continue") return
						} else {
							// Unexpected status (undefined or "delegated") - log error and skip delegation
							// undefined indicates a bug in status persistence during child creation
							// "delegated" would mean this child has its own grandchild pending (shouldn't reach attempt_completion)
							console.error(
								`[AttemptCompletionTool] Unexpected child task status "${status}" for task ${task.taskId}. ` +
									`Expected "active" or "completed". Skipping delegation to prevent data corruption.`,
							)
							// Fall through to normal completion ask flow
						}
					} catch (err) {
						// If we can't get the history, log error and skip delegation
						console.error(
							`[AttemptCompletionTool] Failed to get history for task ${task.taskId}: ${(err as Error)?.message ?? String(err)}. ` +
								`Skipping delegation.`,
						)
						// Fall through to normal completion ask flow
					}
				}
			}

			const { response, text, images } = await task.ask("completion_result", "", false)

			if (response === "yesButtonClicked") {
				await this.emitTaskCompleted(task)
				callbacks.onAccepted?.()
				return
			}

			// User provided feedback - push tool result to continue the conversation
			await task.say("user_feedback", text ?? "", images)

			const feedbackText = `<user_message>\n${text}\n</user_message>`
			pushToolResult(formatResponse.toolResult(feedbackText, images))
		} catch (error) {
			if (isAbortedTaskSayError(task, error)) {
				console.warn(
					`[AttemptCompletionTool] Skipping handleError after aborted task ${task.taskId}.${task.instanceId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
				return
			}

			await handleError("inspecting site", error as Error)
		}
	}

	/**
	 * Handles the common delegation flow when a subtask completes.
	 * Returns:
	 * - "delegated" when completion was approved and parent resumed
	 * - "denied" when user denied finishing the subtask
	 * - "continue" when caller should fall through to normal completion ask flow
	 */
	private async delegateToParent(
		task: Task,
		result: string,
		provider: DelegationProvider,
		askFinishSubTaskApproval: () => Promise<boolean>,
		pushToolResult: (result: string) => void,
	): Promise<"delegated" | "denied" | "continue"> {
		const didApprove = await askFinishSubTaskApproval()

		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return "denied"
		}

		pushToolResult("")

		await provider.reopenParentFromDelegation({
			parentTaskId: task.parentTaskId!,
			childTaskId: task.taskId,
			completionResultSummary: result,
		})

		return "delegated"
	}

	override async handlePartial(task: Task, block: ToolUse<"attempt_completion">): Promise<void> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		const lastMessage = task.clineMessages.at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask === "command") {
				await task.ask("command", command ?? "", block.partial).catch(() => {})
			} else {
				await task.say("completion_result", result ?? "", undefined, false)
				await task.ask("command", command ?? "", block.partial).catch(() => {})
			}
		} else {
			await task.say("completion_result", result ?? "", undefined, block.partial)
		}
	}

	private async completeParallelAgentTask(task: Task): Promise<void> {
		task.markAgentTerminal()
		task.cancelCurrentRequest()
		await this.emitTaskCompleted(task)
	}

	private async emitTaskCompleted(task: Task): Promise<void> {
		await task.cleanupControlledBrowserSessions("task completion")
		// Force final token usage update before emitting TaskCompleted.
		// This ensures the latest stats are captured regardless of throttle timer.
		task.emitFinalTokenUsageUpdate()
		task.emit(RooCodeEventName.TaskCompleted, task.taskId, task.getTokenUsage(), task.toolUsage)
	}
}

export const attemptCompletionTool = new AttemptCompletionTool()

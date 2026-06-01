import EventEmitter from "events"

import type {
	AgentActivityKind,
	AgentCompletionPacket,
	AgentCoordinationEvent,
	AgentCoordinationKind,
	AgentDependency,
	AgentEvent,
	AgentPlan,
	AgentStatus,
	AgentWriteIntentEvidence,
	ExecutionPlan,
	ParallelPlanCompletionPacket,
	WritePermission,
} from "@roo-code/types"
import { buildParallelPlanCompletionPacket, createAgentCompletionPacket } from "@roo-code/types"

export const AGENT_COORDINATION_EVENT_LIMIT = 50
export const AGENT_COORDINATION_MESSAGE_MAX_LENGTH = 240
export const AGENT_COORDINATION_RELATED_FILES_LIMIT = 8
export const AGENT_COORDINATION_PATH_MAX_LENGTH = 200
export const AGENT_COORDINATION_READ_LIMIT = 8
export const AGENT_COORDINATION_READ_LIMIT_MAX = 20
export const AGENT_COORDINATION_COMPLETION_RETRY_LIMIT = 2

export type PublishAgentCoordinationInput = {
	kind?: AgentCoordinationKind
	message: string
	targetAgentId?: string
	relatedFiles?: string[]
	replyToId?: string
}

export type GetAgentCoordinationOptions = {
	limit?: number
	includeSelf?: boolean
}

type CoordinationQuestionState = {
	question: AgentCoordinationEvent
	answerEventId?: string
	answeredAt?: number
	unanswerableReason?: string
}

export type AgentCompletionCoordinationBlocker = {
	type: "incoming-question" | "outgoing-question" | "unread-answer"
	question: AgentCoordinationEvent
	answer?: AgentCoordinationEvent
	retryCount?: number
}

export type AgentCompletionCoordinationGate = {
	approved: boolean
	blockers: AgentCompletionCoordinationBlocker[]
	unanswerableQuestions: AgentCoordinationEvent[]
}

const genericOwnershipCoordinationPatterns = [
	/^\s*(?:agent\s+[\w.-]+:\s*)?i\s+(?:own|can read|am assigned to|will handle|will work on|am working on)\b/i,
	/^\s*agent\s+[\w.-]+\s+(?:owns|can read|is assigned to|will handle|is working on|is writing|released write access|requested|waits for|is blocked|signaled)\b/i,
	/^\s*team chat open for plan\b/i,
	/^\s*shared context is in each agent task\b/i,
	/^\s*[\w.-]+\s+waits for\s+[\w.-]+\s+to\s+(?:complete|signal)\b/i,
]

export function isGenericOwnershipCoordinationMessage(message: string): boolean {
	const normalized = String(message ?? "")
		.replace(/\s+/g, " ")
		.trim()

	if (!normalized) {
		return false
	}

	return genericOwnershipCoordinationPatterns.some((pattern) => pattern.test(normalized))
}

type AppendCoordinationEventInput = Omit<AgentCoordinationEvent, "id" | "ts"> & {
	id?: string
	ts?: number
}

type AgentBusEvents = {
	event: [AgentEvent]
	plan: [ExecutionPlan]
	agentUnblocked: [AgentPlan]
	allComplete: [ExecutionPlan]
	allTerminal: [ExecutionPlan]
}

function normalizePath(filePath: string): string {
	return filePath.replace(/\\/g, "/").replace(/^\.\//, "")
}

function clampInteger(value: number | undefined, fallback: number, max: number): number {
	if (!Number.isFinite(value)) {
		return fallback
	}

	return Math.min(Math.max(Math.floor(value as number), 1), max)
}

function pathMatches(ownedPath: string, requestedPath: string): boolean {
	const normalizedOwned = normalizePath(ownedPath)
	const normalizedRequested = normalizePath(requestedPath)
	return (
		normalizedOwned === normalizedRequested ||
		normalizedRequested.startsWith(`${normalizedOwned.replace(/\/$/, "")}/`)
	)
}

function trimTrailingPathSeparator(filePath: string): string {
	return normalizePath(filePath).replace(/\/+$/, "")
}

function pathsOverlap(leftPath: string, rightPath: string): boolean {
	const normalizedLeft = trimTrailingPathSeparator(leftPath)
	const normalizedRight = trimTrailingPathSeparator(rightPath)

	return (
		Boolean(normalizedLeft && normalizedRight) &&
		(normalizedLeft === normalizedRight ||
			normalizedLeft.startsWith(`${normalizedRight}/`) ||
			normalizedRight.startsWith(`${normalizedLeft}/`))
	)
}

export class AgentBus extends EventEmitter<AgentBusEvents> {
	private static instance: AgentBus | undefined

	private executionPlan?: ExecutionPlan
	private readonly activeWrites = new Map<string, string>()
	private readonly completedAgents = new Set<string>()
	private readonly signalsByAgent = new Map<string, Set<string>>()
	private readonly blockedAgents = new Set<string>()
	private readonly coordinationReadAgents = new Set<string>()
	private readonly coordinationPublishedAgents = new Set<string>()
	private readonly writeIntentEvidenceByAgent = new Map<string, AgentWriteIntentEvidence[]>()
	private readonly completionPackets = new Map<string, AgentCompletionPacket>()
	private readonly coordinationQuestions = new Map<string, CoordinationQuestionState>()
	private readonly coordinationEventSequenceById = new Map<string, number>()
	private readonly coordinationLastReadSequenceByAgent = new Map<string, number>()
	private readonly completionGateRetriesByAgent = new Map<string, Map<string, number>>()
	private planCompletionPacket?: ParallelPlanCompletionPacket
	private coordinationEvents: AgentCoordinationEvent[] = []
	private coordinationSequence = 0

	public static getInstance(): AgentBus {
		AgentBus.instance ??= new AgentBus()
		return AgentBus.instance
	}

	public static reset(): void {
		AgentBus.instance?.removeAllListeners()
		AgentBus.instance = undefined
	}

	public setExecutionPlan(plan: ExecutionPlan): void {
		this.executionPlan = plan
		this.activeWrites.clear()
		this.completedAgents.clear()
		this.signalsByAgent.clear()
		this.blockedAgents.clear()
		this.coordinationReadAgents.clear()
		this.coordinationPublishedAgents.clear()
		this.writeIntentEvidenceByAgent.clear()
		this.completionPackets.clear()
		this.coordinationQuestions.clear()
		this.coordinationEventSequenceById.clear()
		this.coordinationLastReadSequenceByAgent.clear()
		this.completionGateRetriesByAgent.clear()
		this.planCompletionPacket = undefined
		this.coordinationEvents = []
		this.coordinationSequence = 0

		for (const agent of plan.agents) {
			if (agent.status === "complete") {
				this.completedAgents.add(agent.id)
			}
		}

		for (const agent of plan.agents) {
			if (this.isTerminalStatus(agent.status)) {
				continue
			}

			agent.status = "pending"
		}

		this.emit("plan", plan)
		this.emitTerminalEvents()
	}

	public getExecutionPlan(): ExecutionPlan | undefined {
		return this.executionPlan
	}

	public getAgent(agentId: string): AgentPlan | undefined {
		return this.executionPlan?.agents.find((agent) => agent.id === agentId)
	}

	public getAgentStatus(agentId: string): AgentStatus | undefined {
		return this.getAgent(agentId)?.status
	}

	public isAgentTerminal(agentId: string): boolean {
		return this.isTerminalStatus(this.getAgentStatus(agentId))
	}

	public getAgentCompletionPackets(): AgentCompletionPacket[] {
		return Array.from(this.completionPackets.values())
	}

	public getAgentCompletionPacket(agentId: string): AgentCompletionPacket | undefined {
		return this.completionPackets.get(agentId)
	}

	public getPlanCompletionPacket(): ParallelPlanCompletionPacket | undefined {
		return this.planCompletionPacket
	}

	public requestWriteIntent(agentId: string, filePath: string): WritePermission {
		const normalizedPath = normalizePath(filePath)
		const agent = this.getAgent(agentId)
		const ownerAgentId = this.findOwnerAgentId(normalizedPath)
		const activeWriter = this.findActiveWriter(normalizedPath)
		const incomingQuestionBlockers = this.getBlockingIncomingQuestions(agentId).filter((question) =>
			this.isQuestionRelevantToPath(question, normalizedPath),
		)
		let permission: WritePermission

		if (!this.executionPlan || !agent) {
			permission = { approved: true, unownedWarning: "No active execution plan is available for this agent." }
		} else if (agent.mustNotTouch.some((blockedPath) => pathMatches(blockedPath, normalizedPath))) {
			permission = { approved: false, reason: `${normalizedPath} is listed in mustNotTouch for ${agentId}.` }
		} else if (activeWriter && activeWriter.agentId !== agentId) {
			permission = {
				approved: false,
				reason: `${normalizedPath} is currently locked by ${activeWriter.agentId}${
					activeWriter.path === normalizedPath ? "" : ` through overlapping write ${activeWriter.path}`
				}.`,
				suggestWait: true,
			}
		} else if (ownerAgentId && ownerAgentId !== agentId) {
			permission = {
				approved: false,
				reason: `${normalizedPath} is owned by ${ownerAgentId}. Coordinate with the owning agent or update the execution plan before writing.`,
				suggestWait: true,
			}
		} else if (
			agent.owns.some(
				(ownership) => ownership.mode === "read-only" && pathMatches(ownership.path, normalizedPath),
			)
		) {
			permission = { approved: false, reason: `${normalizedPath} is read-only for ${agentId}.` }
		} else if (incomingQuestionBlockers.length > 0) {
			permission = {
				approved: false,
				reason: this.buildIncomingQuestionWriteBlockReason(incomingQuestionBlockers),
				suggestWait: true,
			}
		} else if (!ownerAgentId) {
			permission = { approved: true, unownedWarning: `${normalizedPath} is not declared in the execution plan.` }
		} else {
			permission = { approved: true }
		}

		if (permission.approved) {
			this.activeWrites.set(normalizedPath, agentId)
		}

		this.recordWriteIntentEvidence(agentId, normalizedPath, permission, ownerAgentId)
		this.emitEvent({ type: "INTENT_WRITE", agentId, path: normalizedPath, permission })
		if (!permission.approved && incomingQuestionBlockers.length === 0) {
			this.emitEvent({ type: "CONFLICT_QUERY", agentId, path: normalizedPath, ownerAgentId })
		}

		return permission
	}

	public releaseWriteIntent(agentId: string, filePath: string): void {
		const normalizedPath = normalizePath(filePath)
		if (this.activeWrites.get(normalizedPath) === agentId) {
			this.activeWrites.delete(normalizedPath)
			this.emitEvent({ type: "INTENT_CLEARED", agentId, path: normalizedPath })
		}
	}

	public reportProgress(
		agentId: string,
		message: string,
		kind: AgentActivityKind = "status",
		filePath?: string,
	): void {
		const normalizedPath = filePath ? normalizePath(filePath) : undefined
		this.emitEvent({ type: "PROGRESS", agentId, message, kind, path: normalizedPath })
	}

	public publishCoordination(
		agentId: string,
		input: PublishAgentCoordinationInput,
	): AgentCoordinationEvent | undefined {
		const kind = this.sanitizeCoordinationKind(input.kind)
		const targetAgentId = this.sanitizeAgentId(input.targetAgentId)
		const relatedFiles = this.sanitizeRelatedFiles(input.relatedFiles)
		const explicitReplyToId = this.sanitizeReplyToId(input.replyToId)
		const replyToId =
			kind === "answer"
				? (explicitReplyToId ?? this.findImplicitAnswerQuestionId(agentId, targetAgentId, relatedFiles))
				: explicitReplyToId

		if (
			this.isAgentTerminal(agentId) &&
			!this.canTerminalAgentPublishCoordinationAnswer(agentId, { kind, targetAgentId, relatedFiles, replyToId })
		) {
			return undefined
		}

		const event = this.appendCoordinationEvent({
			agentId,
			message: input.message,
			kind,
			source: "agent",
			...(targetAgentId ? { targetAgentId } : {}),
			...(relatedFiles.length > 0 ? { relatedFiles } : {}),
			...(replyToId ? { replyToId } : {}),
		})

		this.coordinationPublishedAgents.add(agentId)

		return event
	}

	public getCoordinationEvents(agentId: string, options: GetAgentCoordinationOptions = {}): AgentCoordinationEvent[] {
		this.coordinationReadAgents.add(agentId)
		this.coordinationLastReadSequenceByAgent.set(agentId, this.coordinationSequence)

		const limit = clampInteger(options.limit, AGENT_COORDINATION_READ_LIMIT, AGENT_COORDINATION_READ_LIMIT_MAX)
		const includeSelf = options.includeSelf ?? false

		return this.coordinationEvents
			.filter((event) => {
				if (!includeSelf && event.source !== "system" && event.agentId === agentId) {
					return false
				}

				return !event.targetAgentId || event.targetAgentId === agentId || event.agentId === agentId
			})
			.slice(-limit)
	}

	public getOpenCoordinationQuestions(
		agentId: string,
		options: GetAgentCoordinationOptions = {},
	): AgentCoordinationEvent[] {
		const limit = clampInteger(options.limit, AGENT_COORDINATION_READ_LIMIT, AGENT_COORDINATION_READ_LIMIT_MAX)
		return this.getOpenQuestionsForAgent(agentId).slice(-limit)
	}

	public getAgentCompletionCoordinationGate(
		agentId: string,
		options: { recordAttempt?: boolean } = {},
	): AgentCompletionCoordinationGate {
		this.refreshUnanswerableQuestions()

		if (options.recordAttempt) {
			this.recordCompletionGateAttempt(agentId)
			this.refreshUnanswerableQuestions()
		}

		const incoming = this.getBlockingIncomingQuestions(agentId).map((question) => ({
			type: "incoming-question" as const,
			question,
		}))
		const outgoing = this.getBlockingOutgoingQuestions(agentId).map((question) => ({
			type: "outgoing-question" as const,
			question,
			retryCount: this.getCompletionGateRetryCount(agentId, question.id),
		}))
		const unreadAnswers = this.getUnreadAnswersForAgent(agentId).map(({ question, answer }) => ({
			type: "unread-answer" as const,
			question,
			answer,
		}))
		const unanswerableQuestions = this.getUnanswerableQuestionsForAgent(agentId)

		const blockers = [...incoming, ...outgoing, ...unreadAnswers]
		return { approved: blockers.length === 0, blockers, unanswerableQuestions }
	}

	public hasAgentReadCoordination(agentId: string): boolean {
		return this.coordinationReadAgents.has(agentId)
	}

	public hasAgentPublishedCoordination(agentId: string): boolean {
		return this.coordinationPublishedAgents.has(agentId)
	}

	public hasAgentCoordinated(agentId: string): boolean {
		return this.hasAgentReadCoordination(agentId) && this.hasAgentPublishedCoordination(agentId)
	}

	public emitSignal(agentId: string, signal: string, payload?: string): void {
		const signals = this.signalsByAgent.get(agentId) ?? new Set<string>()
		signals.add(signal)
		this.signalsByAgent.set(agentId, signals)

		const agent = this.getAgent(agentId)
		if (agent && !agent.signals.includes(signal)) {
			agent.signals.push(signal)
		}

		this.emitEvent({ type: "SIGNAL", agentId, signal, payload })
		this.unblockReadyAgents()
	}

	public markBlocked(agentId: string, reason: string, blockedOn?: AgentDependency[]): void {
		const agent = this.getAgent(agentId)
		if (this.isTerminalStatus(agent?.status)) {
			return
		}

		if (blockedOn?.length && this.areDependenciesSatisfied(blockedOn)) {
			if (agent) {
				const nextStatus = agent.status === "running" ? "running" : "pending"
				agent.status = nextStatus
				this.blockedAgents.delete(agentId)
				this.emitEvent({ type: "STATUS", agentId, status: nextStatus })

				if (nextStatus === "pending") {
					this.emit("agentUnblocked", agent)
				}
			}
			return
		}

		if (agent) {
			if (blockedOn?.length) {
				agent.dependsOn = blockedOn
			}
			agent.status = "blocked"
		}
		this.blockedAgents.add(agentId)
		this.emitEvent({ type: "BLOCKED", agentId, reason, blockedOn })
	}

	public markRunning(agentId: string): void {
		const agent = this.getAgent(agentId)
		if (this.isTerminalStatus(agent?.status)) {
			return
		}

		if (agent) {
			agent.status = "running"
		}
		this.emitEvent({ type: "STATUS", agentId, status: "running" })
	}

	public markComplete(agentId: string, result?: string): void {
		const agent = this.getAgent(agentId)
		if (this.isTerminalStatus(agent?.status)) {
			return
		}

		if (agent) {
			agent.status = "complete"
		}
		this.completedAgents.add(agentId)
		for (const [filePath, writer] of this.activeWrites.entries()) {
			if (writer === agentId) {
				this.activeWrites.delete(filePath)
			}
		}
		this.emitEvent({ type: "COMPLETE", agentId, result })
		this.upsertCompletionPacket(agentId, { status: "complete", completionResult: result, note: "Agent completed." })
		this.refreshUnanswerableQuestions()
		this.unblockReadyAgents()
		this.emitTerminalEvents()
	}

	public markFailed(agentId: string, reason: string): void {
		const agent = this.getAgent(agentId)
		if (this.isTerminalStatus(agent?.status)) {
			return
		}

		if (agent) {
			agent.status = "failed"
		}
		this.blockedAgents.delete(agentId)
		for (const [filePath, writer] of this.activeWrites.entries()) {
			if (writer === agentId) {
				this.activeWrites.delete(filePath)
				this.emitEvent({ type: "INTENT_CLEARED", agentId, path: filePath })
			}
		}
		this.emitEvent({ type: "FAILED", agentId, reason })
		this.upsertCompletionPacket(agentId, { status: "failed", completionResult: reason, note: "Agent failed." })
		this.refreshUnanswerableQuestions()
		this.failBlockedDependents(agentId, reason)
		this.emitTerminalEvents()
	}

	private isTerminalStatus(status: AgentStatus | string | undefined): boolean {
		return status === "complete" || status === "failed" || status === "cancelled" || status === "merged"
	}

	private emitTerminalEvents(): void {
		const plan = this.executionPlan
		if (!plan || plan.agents.length === 0) {
			return
		}

		if (plan.agents.every((agentPlan) => agentPlan.status === "complete")) {
			this.emit("allComplete", plan)
			return
		}

		if (plan.agents.every((agentPlan) => this.isTerminalStatus(agentPlan.status))) {
			this.emit("allTerminal", plan)
		}
	}

	private failBlockedDependents(failedAgentId: string, reason: string): void {
		for (const agent of this.executionPlan?.agents ?? []) {
			if (agent.status !== "blocked") {
				continue
			}

			if (!agent.dependsOn.some((dependency) => dependency.agentId === failedAgentId)) {
				continue
			}

			agent.status = "failed"
			this.blockedAgents.delete(agent.id)
			this.emitEvent({
				type: "FAILED",
				agentId: agent.id,
				reason: `Dependency ${failedAgentId} failed: ${reason}`,
			})
			this.upsertCompletionPacket(agent.id, {
				status: "failed",
				completionResult: `Dependency ${failedAgentId} failed: ${reason}`,
				note: "Blocked dependency failed.",
			})
			this.failBlockedDependents(agent.id, reason)
		}
	}

	private recordWriteIntentEvidence(
		agentId: string,
		filePath: string,
		permission: WritePermission,
		ownerAgentId?: string,
	): void {
		const previous = this.writeIntentEvidenceByAgent.get(agentId) ?? []
		const evidence: AgentWriteIntentEvidence = {
			path: filePath,
			approved: permission.approved,
			reason: permission.reason,
			unownedWarning: permission.unownedWarning,
			ownerAgentId,
			ts: Date.now(),
		}

		this.writeIntentEvidenceByAgent.set(agentId, [...previous, evidence].slice(-100))
	}

	private upsertCompletionPacket(
		agentId: string,
		input: { status: AgentStatus; completionResult?: string; note: string },
	): AgentCompletionPacket | undefined {
		const plan = this.executionPlan
		const agent = this.getAgent(agentId)
		if (!plan || !agent) {
			return undefined
		}

		const ts = Date.now()
		const previous = this.completionPackets.get(agentId)
		const packet = createAgentCompletionPacket(plan, agent, {
			status: input.status,
			completionResult: input.completionResult,
			attemptedWrites: this.writeIntentEvidenceByAgent.get(agentId) ?? [],
			artifactManifest: previous?.artifactManifest,
			validation: previous?.validation.filter((validation) => validation.source !== "agent-bus"),
			merge: previous?.merge,
			evidence: {
				source: "agent-bus",
				sourceId: agentId,
				ts,
				note: input.note,
			},
			ts,
		})

		if (previous) {
			packet.evidence.createdAt = previous.evidence.createdAt
			packet.evidence.sources = [...previous.evidence.sources, ...packet.evidence.sources]
		}

		this.completionPackets.set(agentId, packet)
		this.emitEvent({ type: "COMPLETION_PACKET", agentId, packet })
		this.updatePlanCompletionPacket()
		return packet
	}

	private updatePlanCompletionPacket(): void {
		const plan = this.executionPlan
		if (!plan) {
			return
		}

		const packet = buildParallelPlanCompletionPacket(plan, this.getAgentCompletionPackets(), {
			ts: Date.now(),
			source: {
				source: "agent-bus",
				sourceId: plan.planId,
				ts: Date.now(),
				note: "AgentBus aggregated current agent completion packet evidence.",
			},
		})
		this.planCompletionPacket = packet
		this.emitEvent({ type: "PLAN_COMPLETION_PACKET", packet })
	}

	private emitEvent(event: AgentEvent): void {
		this.emit("event", event)
	}

	private appendCoordinationEvent(input: AppendCoordinationEventInput): AgentCoordinationEvent {
		const relatedFiles = this.sanitizeRelatedFiles(input.relatedFiles)
		const sequence = ++this.coordinationSequence
		const event: AgentCoordinationEvent = {
			id: input.id ?? `${Date.now()}-${sequence}`,
			message: this.sanitizeCoordinationMessage(input.message),
			ts: input.ts ?? Date.now(),
			kind: input.kind,
			source: input.source,
			...(input.agentId ? { agentId: input.agentId } : {}),
			...(input.targetAgentId ? { targetAgentId: input.targetAgentId } : {}),
			...(relatedFiles.length > 0 ? { relatedFiles } : {}),
			...(input.replyToId ? { replyToId: input.replyToId } : {}),
		}

		const existingEvents = event.id
			? this.coordinationEvents.filter((candidate) => candidate.id !== event.id)
			: this.coordinationEvents
		this.coordinationEvents = [...existingEvents, event].slice(-AGENT_COORDINATION_EVENT_LIMIT)
		if (event.id) {
			this.coordinationEventSequenceById.set(event.id, sequence)
		}
		this.trackCoordinationQuestionOrAnswer(event)
		this.emitEvent({ type: "COORDINATION", event })

		return event
	}

	private trackCoordinationQuestionOrAnswer(event: AgentCoordinationEvent): void {
		if (!event.id) {
			return
		}

		if (event.kind === "question") {
			const question = event.answerState ? event : { ...event, answerState: "open" as const }
			this.updateStoredCoordinationEvent(event.id, question)
			this.coordinationQuestions.set(event.id, { question })
			this.refreshUnanswerableQuestions()
			return
		}

		if (event.kind === "answer") {
			const question = this.findQuestionAnsweredBy(event)
			if (question?.id) {
				this.markQuestionAnswered(question.id, event)
			}
		}
	}

	private updateStoredCoordinationEvent(eventId: string, updatedEvent: AgentCoordinationEvent): void {
		this.coordinationEvents = this.coordinationEvents.map((event) => (event.id === eventId ? updatedEvent : event))
	}

	private updateQuestionState(
		questionId: string,
		patch: Partial<AgentCoordinationEvent>,
		options: { emit?: boolean } = {},
	): AgentCoordinationEvent | undefined {
		const state = this.coordinationQuestions.get(questionId)
		if (!state) {
			return undefined
		}

		const updatedQuestion = { ...state.question, ...patch }
		state.question = updatedQuestion
		if (updatedQuestion.answerEventId) {
			state.answerEventId = updatedQuestion.answerEventId
		}
		if (updatedQuestion.answeredAt) {
			state.answeredAt = updatedQuestion.answeredAt
		}
		if (updatedQuestion.unanswerableReason) {
			state.unanswerableReason = updatedQuestion.unanswerableReason
		}
		this.updateStoredCoordinationEvent(questionId, updatedQuestion)
		if (options.emit) {
			this.emitEvent({ type: "COORDINATION", event: updatedQuestion })
		}
		return updatedQuestion
	}

	private markQuestionAnswered(questionId: string, answer: AgentCoordinationEvent): void {
		this.updateQuestionState(
			questionId,
			{
				answerState: "answered",
				answerEventId: answer.id,
				answeredAt: answer.ts,
				unanswerableReason: undefined,
			},
			{ emit: true },
		)
	}

	private markQuestionUnanswerable(questionId: string, reason: string): void {
		const state = this.coordinationQuestions.get(questionId)
		if (!state || state.question.answerState === "answered" || state.question.answerState === "unanswerable") {
			return
		}

		this.updateQuestionState(
			questionId,
			{
				answerState: "unanswerable",
				unanswerableReason: reason,
			},
			{ emit: true },
		)
	}

	private getOpenQuestionsForAgent(agentId: string): AgentCoordinationEvent[] {
		this.refreshUnanswerableQuestions()
		return this.getQuestionStates()
			.map((state) => state.question)
			.filter(
				(question) =>
					this.isQuestionOpen(question) &&
					question.agentId !== agentId &&
					this.isQuestionRelevantToAgent(question, agentId),
			)
	}

	private getQuestionStates(): CoordinationQuestionState[] {
		return Array.from(this.coordinationQuestions.values()).sort((a, b) => a.question.ts - b.question.ts)
	}

	private isQuestionOpen(question: AgentCoordinationEvent): boolean {
		return question.kind === "question" && (question.answerState ?? "open") === "open"
	}

	private findQuestionAnsweredBy(answer: AgentCoordinationEvent): AgentCoordinationEvent | undefined {
		if (answer.replyToId) {
			const question = this.coordinationQuestions.get(answer.replyToId)?.question
			if (question && this.canAnswerQuestion(answer, question)) {
				return question
			}
		}

		return this.findImplicitAnswerQuestion(answer.agentId, answer.targetAgentId, answer.relatedFiles)
	}

	private findImplicitAnswerQuestionId(
		answerAgentId: string,
		answerTargetAgentId: string | undefined,
		relatedFiles: string[],
	): string | undefined {
		return this.findImplicitAnswerQuestion(answerAgentId, answerTargetAgentId, relatedFiles)?.id
	}

	private findImplicitAnswerQuestion(
		answerAgentId: string | undefined,
		answerTargetAgentId: string | undefined,
		relatedFiles: string[] | undefined,
	): AgentCoordinationEvent | undefined {
		if (!answerAgentId) {
			return undefined
		}

		const answerCandidate = {
			agentId: answerAgentId,
			targetAgentId: answerTargetAgentId,
			relatedFiles,
			kind: "answer" as const,
			message: "",
			ts: 0,
		}
		const candidates = this.getQuestionStates()
			.map((state) => state.question)
			.filter((question) => this.canAnswerQuestion(answerCandidate, question))
			.map((question) => ({
				question,
				score: this.scoreImplicitAnswerQuestion(question, answerAgentId, answerTargetAgentId, relatedFiles),
			}))
			.filter(({ score }) => score > 0)
			.sort((a, b) => b.score - a.score || b.question.ts - a.question.ts)

		return candidates[0]?.question
	}

	private canAnswerQuestion(
		answer: Pick<AgentCoordinationEvent, "agentId" | "targetAgentId" | "relatedFiles" | "kind" | "message" | "ts">,
		question: AgentCoordinationEvent,
	): boolean {
		if (!answer.agentId || !question.id || !this.isQuestionOpen(question) || answer.agentId === question.agentId) {
			return false
		}

		if (question.targetAgentId && answer.agentId !== question.targetAgentId) {
			return false
		}

		if (answer.targetAgentId && question.agentId && answer.targetAgentId !== question.agentId) {
			return false
		}

		return true
	}

	private canTerminalAgentPublishCoordinationAnswer(
		agentId: string,
		input: Pick<AgentCoordinationEvent, "kind" | "targetAgentId" | "relatedFiles" | "replyToId">,
	): boolean {
		if (this.getAgentStatus(agentId) !== "complete" || input.kind !== "answer") {
			return false
		}

		const question = input.replyToId
			? this.coordinationQuestions.get(input.replyToId)?.question
			: this.findImplicitAnswerQuestion(agentId, input.targetAgentId, input.relatedFiles)

		if (!question || (question.agentId && this.isAgentTerminal(question.agentId))) {
			return false
		}

		return this.canAnswerQuestion(
			{
				agentId,
				targetAgentId: input.targetAgentId,
				relatedFiles: input.relatedFiles,
				kind: "answer",
				message: "",
				ts: 0,
			},
			question,
		)
	}

	private scoreImplicitAnswerQuestion(
		question: AgentCoordinationEvent,
		answerAgentId: string,
		answerTargetAgentId: string | undefined,
		relatedFiles: string[] | undefined,
	): number {
		let score = 0
		if (question.targetAgentId === answerAgentId) {
			score += 5
		}
		if (answerTargetAgentId && question.agentId === answerTargetAgentId) {
			score += 4
		}
		if (this.relatedFilesOverlap(question.relatedFiles, relatedFiles)) {
			score += 3
		}
		return score
	}

	private relatedFilesOverlap(left: string[] | undefined, right: string[] | undefined): boolean {
		const leftFiles = (left ?? []).map(normalizePath)
		const rightFiles = (right ?? []).map(normalizePath)
		return leftFiles.some((leftPath) =>
			rightFiles.some((rightPath) => pathMatches(leftPath, rightPath) || pathMatches(rightPath, leftPath)),
		)
	}

	private refreshUnanswerableQuestions(): void {
		for (const state of this.getQuestionStates()) {
			const question = state.question
			if (!question.id || !this.isQuestionOpen(question)) {
				continue
			}

			const reason = this.getUnanswerableQuestionReason(question)
			if (reason) {
				this.markQuestionUnanswerable(question.id, reason)
			}
		}
	}

	private getUnanswerableQuestionReason(question: AgentCoordinationEvent): string | undefined {
		if (question.agentId && this.isAgentTerminal(question.agentId)) {
			return `Asker ${question.agentId} is already ${this.getAgentStatus(question.agentId) ?? "terminal"}.`
		}

		if (!question.targetAgentId) {
			return undefined
		}

		const target = this.getAgent(question.targetAgentId)
		if (!target) {
			return `Target ${question.targetAgentId} is unavailable.`
		}

		const retryCount = question.agentId ? this.getCompletionGateRetryCount(question.agentId, question.id) : 0
		if (target.status === "complete") {
			return retryCount >= AGENT_COORDINATION_COMPLETION_RETRY_LIMIT
				? `Target ${question.targetAgentId} is already complete and did not answer after bounded completion retries.`
				: undefined
		}

		if (this.isTerminalStatus(target.status)) {
			return `Target ${question.targetAgentId} is already ${target.status}.`
		}

		if (retryCount >= AGENT_COORDINATION_COMPLETION_RETRY_LIMIT && target.status !== "running") {
			return `Target ${question.targetAgentId} is not currently running after bounded completion retries.`
		}

		if (retryCount >= AGENT_COORDINATION_COMPLETION_RETRY_LIMIT && target.status === "running") {
			return `Target ${question.targetAgentId} did not answer after bounded completion retries.`
		}

		return undefined
	}

	private getBlockingIncomingQuestions(agentId: string): AgentCoordinationEvent[] {
		this.refreshUnanswerableQuestions()
		return this.getQuestionStates()
			.map((state) => state.question)
			.filter(
				(question) =>
					this.isQuestionOpen(question) &&
					question.agentId !== agentId &&
					question.targetAgentId === agentId &&
					(!question.agentId || !this.isAgentTerminal(question.agentId)),
			)
	}

	private getBlockingOutgoingQuestions(agentId: string): AgentCoordinationEvent[] {
		this.refreshUnanswerableQuestions()
		return this.getQuestionStates()
			.map((state) => state.question)
			.filter((question) => {
				if (
					!this.isQuestionOpen(question) ||
					question.agentId !== agentId ||
					!question.targetAgentId ||
					question.targetAgentId === agentId
				) {
					return false
				}

				const targetStatus = this.getAgentStatus(question.targetAgentId)
				return targetStatus === "complete" || !this.isTerminalStatus(targetStatus)
			})
	}

	private getUnreadAnswersForAgent(
		agentId: string,
	): Array<{ question: AgentCoordinationEvent; answer: AgentCoordinationEvent }> {
		const lastReadSequence = this.coordinationLastReadSequenceByAgent.get(agentId) ?? 0
		return this.getQuestionStates()
			.map((state) => state.question)
			.filter(
				(question) =>
					question.agentId === agentId && question.answerState === "answered" && question.answerEventId,
			)
			.map((question) => {
				const answer = this.coordinationEvents.find((event) => event.id === question.answerEventId)
				return answer ? { question, answer } : undefined
			})
			.filter((entry): entry is { question: AgentCoordinationEvent; answer: AgentCoordinationEvent } => {
				if (!entry?.answer.id) {
					return false
				}
				return (this.coordinationEventSequenceById.get(entry.answer.id) ?? 0) > lastReadSequence
			})
	}

	private getUnanswerableQuestionsForAgent(agentId: string): AgentCoordinationEvent[] {
		return this.getQuestionStates()
			.map((state) => state.question)
			.filter(
				(question) =>
					question.answerState === "unanswerable" &&
					(question.agentId === agentId || question.targetAgentId === agentId),
			)
	}

	private recordCompletionGateAttempt(agentId: string): void {
		const retryCounts = this.completionGateRetriesByAgent.get(agentId) ?? new Map<string, number>()
		for (const question of this.getBlockingOutgoingQuestions(agentId)) {
			if (!question.id) {
				continue
			}
			retryCounts.set(question.id, (retryCounts.get(question.id) ?? 0) + 1)
		}
		this.completionGateRetriesByAgent.set(agentId, retryCounts)
	}

	private getCompletionGateRetryCount(agentId: string, questionId: string | undefined): number {
		if (!questionId) {
			return 0
		}
		return this.completionGateRetriesByAgent.get(agentId)?.get(questionId) ?? 0
	}

	private isQuestionRelevantToAgent(question: AgentCoordinationEvent, agentId: string): boolean {
		if (question.targetAgentId) {
			return question.targetAgentId === agentId
		}

		const relatedFiles = question.relatedFiles ?? []
		if (relatedFiles.length === 0) {
			return true
		}

		const agent = this.getAgent(agentId)
		return Boolean(
			agent?.owns.some((ownership) =>
				relatedFiles.some(
					(filePath) => pathMatches(ownership.path, filePath) || pathMatches(filePath, ownership.path),
				),
			),
		)
	}

	private isQuestionRelevantToPath(question: AgentCoordinationEvent, filePath: string): boolean {
		const relatedFiles = question.relatedFiles ?? []
		if (relatedFiles.length === 0) {
			return true
		}

		return relatedFiles.some(
			(relatedFile) => pathMatches(relatedFile, filePath) || pathMatches(filePath, relatedFile),
		)
	}

	private buildIncomingQuestionWriteBlockReason(questions: AgentCoordinationEvent[]): string {
		const question = questions[0]
		const suffix = questions.length > 1 ? ` and ${questions.length - 1} more` : ""
		return `Open coordination question${questions.length > 1 ? "s" : ""} must be answered before writing: ${question?.id ?? "unknown"}${suffix}.`
	}

	private sanitizeCoordinationKind(kind: AgentCoordinationKind | undefined): AgentCoordinationKind {
		switch (kind) {
			case "question":
			case "answer":
			case "decision":
			case "blocker":
			case "note":
				return kind
			default:
				return "note"
		}
	}

	private sanitizeCoordinationMessage(message: string): string {
		const withoutReasoningBlocks = String(message ?? "")
			.replace(
				/<\s*(thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
				"[redacted private reasoning]",
			)
			.replace(/\b(chain[-\s]?of[-\s]?thought|private reasoning|internal reasoning)\b/gi, "private reasoning")
			.replace(/\p{Extended_Pictographic}/gu, "")
		const normalized = withoutReasoningBlocks
			.split("")
			.map((char) => (this.isControlCharacter(char) ? " " : char))
			.join("")
			.replace(/\s+/g, " ")
			.trim()

		if (!normalized) {
			return "Coordination update."
		}

		return normalized.slice(0, AGENT_COORDINATION_MESSAGE_MAX_LENGTH)
	}

	private sanitizeAgentId(agentId: string | undefined): string | undefined {
		const normalized = this.sanitizeIdentifier(agentId)

		if (
			!normalized ||
			this.isBroadcastTargetSentinel(normalized) ||
			!this.executionPlan?.agents.some((agent) => agent.id === normalized)
		) {
			return undefined
		}

		return normalized
	}

	private sanitizeReplyToId(replyToId: string | undefined): string | undefined {
		const normalized = this.sanitizeIdentifier(replyToId)

		if (!normalized || normalized.toLowerCase() === "none") {
			return undefined
		}

		return normalized
	}

	private isBroadcastTargetSentinel(value: string): boolean {
		const normalized = value.toLowerCase()

		return normalized === "all" || normalized === "none"
	}

	private sanitizeIdentifier(value: string | undefined): string | undefined {
		const normalized = String(value ?? "")
			.split("")
			.filter((char) => !this.isControlCharacter(char))
			.join("")
			.trim()
			.slice(0, 120)

		return normalized || undefined
	}

	private isControlCharacter(char: string): boolean {
		const code = char.charCodeAt(0)

		return code <= 31 || code === 127
	}

	private sanitizeRelatedFiles(files: string[] | undefined): string[] {
		const uniqueFiles = new Set<string>()

		for (const filePath of files ?? []) {
			const normalizedPath = normalizePath(String(filePath ?? "").trim()).slice(
				0,
				AGENT_COORDINATION_PATH_MAX_LENGTH,
			)
			if (normalizedPath) {
				uniqueFiles.add(normalizedPath)
			}
			if (uniqueFiles.size >= AGENT_COORDINATION_RELATED_FILES_LIMIT) {
				break
			}
		}

		return Array.from(uniqueFiles)
	}

	private findOwnerAgentId(filePath: string): string | undefined {
		const normalizedPath = normalizePath(filePath)

		for (const agent of this.executionPlan?.agents ?? []) {
			const ownership = agent.owns.find(
				(candidate) => candidate.mode !== "shared" && pathMatches(candidate.path, normalizedPath),
			)
			if (ownership) {
				return agent.id
			}
		}

		for (const [ownedPath, agentId] of Object.entries(this.executionPlan?.fileOwnershipMap ?? {})) {
			if (pathMatches(ownedPath, normalizedPath)) {
				return agentId
			}
		}

		return undefined
	}

	private findActiveWriter(filePath: string): { path: string; agentId: string } | undefined {
		const normalizedPath = normalizePath(filePath)

		for (const [activePath, activeAgentId] of this.activeWrites.entries()) {
			if (pathsOverlap(activePath, normalizedPath)) {
				return { path: activePath, agentId: activeAgentId }
			}
		}

		return undefined
	}

	private areDependenciesSatisfied(dependsOn: AgentDependency[]): boolean {
		return dependsOn.every((dependency) => {
			if (dependency.waitFor === "complete") {
				return this.completedAgents.has(dependency.agentId)
			}

			return this.signalsByAgent.get(dependency.agentId)?.has(dependency.signal ?? "") ?? false
		})
	}

	private unblockReadyAgents(): void {
		for (const agent of this.executionPlan?.agents ?? []) {
			if (agent.status === "blocked" && this.areDependenciesSatisfied(agent.dependsOn)) {
				agent.status = "pending"
				this.blockedAgents.delete(agent.id)
				this.emitEvent({ type: "STATUS", agentId: agent.id, status: "pending" })
				this.emit("agentUnblocked", agent)
			}
		}
	}
}

export function getAgentBus(): AgentBus {
	return AgentBus.getInstance()
}

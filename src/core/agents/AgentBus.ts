import EventEmitter from "events"

import type {
	AgentActivityKind,
	AgentCoordinationEvent,
	AgentCoordinationKind,
	AgentDependency,
	AgentEvent,
	AgentPlan,
	AgentStatus,
	ExecutionPlan,
	WritePermission,
} from "@roo-code/types"

export const AGENT_COORDINATION_EVENT_LIMIT = 50
export const AGENT_COORDINATION_MESSAGE_MAX_LENGTH = 500
const AGENT_COORDINATION_RELATED_FILES_LIMIT = 8
const AGENT_COORDINATION_PATH_MAX_LENGTH = 200
const AGENT_COORDINATION_READ_LIMIT = 8
const AGENT_COORDINATION_READ_LIMIT_MAX = 20

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

export class AgentBus extends EventEmitter<AgentBusEvents> {
	private static instance: AgentBus | undefined

	private executionPlan?: ExecutionPlan
	private readonly activeWrites = new Map<string, string>()
	private readonly completedAgents = new Set<string>()
	private readonly signalsByAgent = new Map<string, Set<string>>()
	private readonly blockedAgents = new Set<string>()
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

			agent.status = this.areDependenciesSatisfied(agent.dependsOn) ? "pending" : "blocked"
			if (agent.status === "blocked") {
				this.blockedAgents.add(agent.id)
			}
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

	public requestWriteIntent(agentId: string, filePath: string): WritePermission {
		const normalizedPath = normalizePath(filePath)
		const agent = this.getAgent(agentId)
		const ownerAgentId = this.findOwnerAgentId(normalizedPath)
		const activeWriter = this.activeWrites.get(normalizedPath)
		let permission: WritePermission

		if (!this.executionPlan || !agent) {
			permission = { approved: true, unownedWarning: "No active execution plan is available for this agent." }
		} else if (agent.mustNotTouch.some((blockedPath) => pathMatches(blockedPath, normalizedPath))) {
			permission = { approved: false, reason: `${normalizedPath} is listed in mustNotTouch for ${agentId}.` }
		} else if (activeWriter && activeWriter !== agentId) {
			permission = {
				approved: false,
				reason: `${normalizedPath} is currently locked by ${activeWriter}.`,
				suggestWait: true,
			}
		} else if (ownerAgentId && ownerAgentId !== agentId) {
			permission = {
				approved: false,
				reason: `${normalizedPath} is owned by ${ownerAgentId}.`,
				suggestWait: true,
			}
		} else if (
			agent.owns.some(
				(ownership) => ownership.mode === "read-only" && pathMatches(ownership.path, normalizedPath),
			)
		) {
			permission = { approved: false, reason: `${normalizedPath} is read-only for ${agentId}.` }
		} else if (!ownerAgentId) {
			permission = { approved: true, unownedWarning: `${normalizedPath} is not declared in the execution plan.` }
		} else {
			permission = { approved: true }
		}

		if (permission.approved) {
			this.activeWrites.set(normalizedPath, agentId)
		}

		this.emitEvent({ type: "INTENT_WRITE", agentId, path: normalizedPath, permission })
		if (!permission.approved) {
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

	public publishCoordination(agentId: string, input: PublishAgentCoordinationInput): AgentCoordinationEvent {
		const message = this.sanitizeCoordinationMessage(input.message)
		const kind = this.sanitizeCoordinationKind(input.kind)
		const targetAgentId = this.sanitizeAgentId(input.targetAgentId)
		const relatedFiles = this.sanitizeRelatedFiles(input.relatedFiles)
		const replyToId = this.sanitizeIdentifier(input.replyToId)
		const event: AgentCoordinationEvent = {
			id: `${Date.now()}-${++this.coordinationSequence}`,
			agentId,
			message,
			ts: Date.now(),
			kind,
			...(targetAgentId ? { targetAgentId } : {}),
			...(relatedFiles.length > 0 ? { relatedFiles } : {}),
			...(replyToId ? { replyToId } : {}),
		}

		this.coordinationEvents = [...this.coordinationEvents, event].slice(-AGENT_COORDINATION_EVENT_LIMIT)
		this.emitEvent({ type: "COORDINATION", event })

		return event
	}

	public getCoordinationEvents(agentId: string, options: GetAgentCoordinationOptions = {}): AgentCoordinationEvent[] {
		const limit = clampInteger(options.limit, AGENT_COORDINATION_READ_LIMIT, AGENT_COORDINATION_READ_LIMIT_MAX)
		const includeSelf = options.includeSelf ?? false

		return this.coordinationEvents
			.filter((event) => {
				if (!includeSelf && event.agentId === agentId) {
					return false
				}

				return !event.targetAgentId || event.targetAgentId === agentId || event.agentId === agentId
			})
			.slice(-limit)
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
		this.failBlockedDependents(agentId, reason)
		this.emitTerminalEvents()
	}

	private isTerminalStatus(status: AgentStatus | undefined): boolean {
		return status === "complete" || status === "failed"
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
			this.failBlockedDependents(agent.id, reason)
		}
	}

	private emitEvent(event: AgentEvent): void {
		this.emit("event", event)
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

		if (!normalized || !this.executionPlan?.agents.some((agent) => agent.id === normalized)) {
			return undefined
		}

		return normalized
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
		for (const agent of this.executionPlan?.agents ?? []) {
			const ownership = agent.owns.find(
				(candidate) => candidate.mode !== "shared" && pathMatches(candidate.path, filePath),
			)
			if (ownership) {
				return agent.id
			}
		}

		return this.executionPlan?.fileOwnershipMap[normalizePath(filePath)]
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

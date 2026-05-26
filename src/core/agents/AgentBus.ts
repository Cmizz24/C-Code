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
export const AGENT_COORDINATION_RELATED_FILES_LIMIT = 8
export const AGENT_COORDINATION_PATH_MAX_LENGTH = 200
export const AGENT_COORDINATION_READ_LIMIT = 8
export const AGENT_COORDINATION_READ_LIMIT_MAX = 20

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

export class AgentBus extends EventEmitter<AgentBusEvents> {
	private static instance: AgentBus | undefined

	private executionPlan?: ExecutionPlan
	private readonly activeWrites = new Map<string, string>()
	private readonly completedAgents = new Set<string>()
	private readonly signalsByAgent = new Map<string, Set<string>>()
	private readonly blockedAgents = new Set<string>()
	private readonly coordinationReadAgents = new Set<string>()
	private readonly coordinationPublishedAgents = new Set<string>()
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

		this.seedPlanCoordination(plan)
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
			if (this.executionPlan && agent) {
				this.ensureCoordinationPreflight(agentId, normalizedPath)
			}
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
		const kind = this.sanitizeCoordinationKind(input.kind)
		const targetAgentId = this.sanitizeAgentId(input.targetAgentId)
		const relatedFiles = this.sanitizeRelatedFiles(input.relatedFiles)
		const replyToId = this.sanitizeReplyToId(input.replyToId)
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

	public hasAgentReadCoordination(agentId: string): boolean {
		return this.coordinationReadAgents.has(agentId)
	}

	public hasAgentPublishedCoordination(agentId: string): boolean {
		return this.coordinationPublishedAgents.has(agentId)
	}

	public hasAgentCoordinated(agentId: string): boolean {
		return this.hasAgentReadCoordination(agentId) && this.hasAgentPublishedCoordination(agentId)
	}

	public ensureCoordinationPreflight(agentId: string, filePath: string): AgentCoordinationEvent | undefined {
		const normalizedPath = normalizePath(filePath)
		const agent = this.getAgent(agentId)

		if (!this.executionPlan || !agent || this.hasAgentCoordinated(agentId)) {
			return undefined
		}

		this.coordinationReadAgents.add(agentId)

		if (this.coordinationPublishedAgents.has(agentId)) {
			return undefined
		}

		const event = this.publishSystemCoordination({
			id: `${this.executionPlan.planId}:preflight:${agentId}`,
			agentId,
			kind: "note",
			message: this.buildCoordinationPreflightMessage(agent, normalizedPath),
			relatedFiles: [normalizedPath],
		})

		this.coordinationPublishedAgents.add(agentId)
		return event
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

	private appendCoordinationEvent(input: AppendCoordinationEventInput): AgentCoordinationEvent {
		const relatedFiles = this.sanitizeRelatedFiles(input.relatedFiles)
		const event: AgentCoordinationEvent = {
			id: input.id ?? `${Date.now()}-${++this.coordinationSequence}`,
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
		this.emitEvent({ type: "COORDINATION", event })

		return event
	}

	private publishSystemCoordination(input: Omit<AppendCoordinationEventInput, "source">): AgentCoordinationEvent {
		return this.appendCoordinationEvent({ ...input, source: "system" })
	}

	private seedPlanCoordination(plan: ExecutionPlan): void {
		const ts = Date.now()

		if (plan.sharedContext.trim()) {
			this.publishSystemCoordination({
				id: `${plan.planId}:shared-context`,
				kind: "shared-context",
				message: "Shared plan context was provided to all agents.",
				ts,
			})
		}

		this.publishSystemCoordination({
			id: `${plan.planId}:team-kickoff`,
			kind: "note",
			message: `Team coordination started for plan ${plan.planId}: align filenames, selectors, classes, CSS variables, DOM hooks, IDs, data attributes, public functions, and responsibilities before writing shared integration points.`,
			ts,
		})

		for (const agent of plan.agents) {
			const writableOwnerships = agent.owns
				.filter((ownership) => ownership.mode !== "read-only")
				.map((ownership) => ownership.path)
			const readableOwnerships = agent.owns.map((ownership) => ownership.path)

			if (writableOwnerships.length > 0) {
				this.publishSystemCoordination({
					id: `${plan.planId}:ownership:${agent.id}`,
					agentId: agent.id,
					kind: "ownership",
					message: `Agent ${agent.id} owns ${this.formatCoordinationPathList(writableOwnerships)}.`,
					relatedFiles: writableOwnerships,
					ts,
				})
			}

			this.publishSystemCoordination({
				id: `${plan.planId}:intro:${agent.id}`,
				agentId: agent.id,
				kind: "note",
				message: `Agent ${agent.id} starts ${agent.mode} scope: ${this.summarizeCoordinationText(agent.task)} Scope paths: ${this.formatCoordinationPathList(writableOwnerships.length > 0 ? writableOwnerships : readableOwnerships)}.`,
				relatedFiles: writableOwnerships.length > 0 ? writableOwnerships : readableOwnerships,
				ts,
			})

			for (const dependency of agent.dependsOn) {
				this.publishSystemCoordination({
					id: `${plan.planId}:dependency:${agent.id}:${dependency.agentId}:${dependency.waitFor}:${dependency.signal ?? "complete"}`,
					agentId: agent.id,
					kind: "dependency",
					message: `Agent ${agent.id} waits for ${this.describeAgentDependency(dependency)}.`,
					ts,
				})
			}
		}
	}

	private buildCoordinationPreflightMessage(agent: AgentPlan, filePath: string): string {
		const writableOwnerships = agent.owns
			.filter((ownership) => ownership.mode !== "read-only")
			.map((ownership) => ownership.path)
		const ownershipSummary = writableOwnerships.length
			? this.formatCoordinationPathList(writableOwnerships)
			: "no writable files declared"

		return `Coordination preflight for ${agent.id}: read recent team chat before writing ${filePath}; owned scope ${ownershipSummary}. Share any selectors, classes, CSS variables, DOM hooks, IDs, data attributes, public functions, or file contracts that affect other agents.`
	}

	private describeAgentDependency(dependency: AgentDependency): string {
		if (dependency.waitFor === "signal") {
			return dependency.signal
				? `${dependency.agentId} to signal ${dependency.signal}`
				: `${dependency.agentId} to signal`
		}

		return `${dependency.agentId} to complete`
	}

	private formatCoordinationPathList(paths: string[]): string {
		if (paths.length === 0) {
			return "none"
		}

		const visiblePaths = paths.slice(0, 3).join(", ")
		const remainingCount = paths.length - 3

		return remainingCount > 0 ? `${visiblePaths}, and ${remainingCount} more` : visiblePaths
	}

	private summarizeCoordinationText(text: string): string {
		const normalized = this.sanitizeCoordinationMessage(text)
		return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized
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

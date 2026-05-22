import EventEmitter from "events"

import type { AgentDependency, AgentEvent, AgentPlan, ExecutionPlan, WritePermission } from "@roo-code/types"

type AgentBusEvents = {
	event: [AgentEvent]
	plan: [ExecutionPlan]
	agentUnblocked: [AgentPlan]
	allComplete: [ExecutionPlan]
}

function normalizePath(filePath: string): string {
	return filePath.replace(/\\/g, "/").replace(/^\.\//, "")
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
		for (const agent of plan.agents) {
			agent.status = this.areDependenciesSatisfied(agent.dependsOn) ? "pending" : "blocked"
			if (agent.status === "blocked") {
				this.blockedAgents.add(agent.id)
			}
		}
		this.emit("plan", plan)
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
		if (agent) {
			agent.status = "blocked"
		}
		this.blockedAgents.add(agentId)
		this.emitEvent({ type: "BLOCKED", agentId, reason, blockedOn })
	}

	public markRunning(agentId: string): void {
		const agent = this.getAgent(agentId)
		if (agent) {
			agent.status = "running"
		}
		this.emitEvent({ type: "STATUS", agentId, status: "running" })
	}

	public markComplete(agentId: string, result?: string): void {
		const agent = this.getAgent(agentId)
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
		if (this.executionPlan?.agents.every((agentPlan) => agentPlan.status === "complete")) {
			this.emit("allComplete", this.executionPlan)
		}
	}

	public markFailed(agentId: string, reason: string): void {
		const agent = this.getAgent(agentId)
		if (agent) {
			agent.status = "failed"
		}
		this.emitEvent({ type: "FAILED", agentId, reason })
	}

	private emitEvent(event: AgentEvent): void {
		this.emit("event", event)
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

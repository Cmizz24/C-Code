import path from "path"

import type { AgentDependency, AgentPlan, ExecutionPlan, FileOwnership } from "@roo-code/types"
import { normalizeModeSlug } from "../../shared/modes"

type PlanParallelTasksInputAgent = {
	id: string
	mode: string
	task: string
	owns?: FileOwnership[]
	mustNotTouch?: string[]
	dependsOn?: AgentDependency[]
	worktreePath?: string
	signals?: string[]
}

export type PlanParallelTasksInput = {
	goal: string
	agents: PlanParallelTasksInputAgent[]
	expectedFiles?: string[]
	sharedContext?: string
}

export type PlanParallelTasksResult =
	| { ok: true; plan: ExecutionPlan; warnings: string[] }
	| { ok: false; errors: string[]; warnings: string[] }

export interface PlanParallelTasksOptions {
	/** Maximum total agents allowed in the proposed execution plan. */
	maxAgents?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeStringArray(
	value: unknown,
	fieldName: string,
	errors: string[],
	owner?: string,
): string[] | undefined {
	if (value === undefined) {
		return undefined
	}

	const fieldLabel = owner ? `${owner} ${fieldName}` : fieldName
	if (!Array.isArray(value)) {
		errors.push(`${fieldLabel} must be an array.`)
		return undefined
	}

	const result: string[] = []
	for (const [index, entry] of value.entries()) {
		if (typeof entry === "string") {
			result.push(entry)
		} else {
			errors.push(`${fieldLabel} entry at index ${index} must be a string.`)
		}
	}

	return result
}

function normalizePlanPath(filePath: string): string {
	return filePath.replace(/\\/g, "/").replace(/^\.\//, "")
}

function ownershipsConflict(left: FileOwnership, right: FileOwnership): boolean {
	if (left.mode === "shared" || right.mode === "shared") {
		return false
	}

	if (left.mode === "read-only" && right.mode === "read-only") {
		return false
	}

	return normalizePlanPath(left.path) === normalizePlanPath(right.path)
}

function findDependencyCycle(agents: PlanParallelTasksInputAgent[]): string[] | undefined {
	const graph = new Map(
		agents.map((agent) => [agent.id, agent.dependsOn?.map((dependency) => dependency.agentId) ?? []]),
	)
	const visiting = new Set<string>()
	const visited = new Set<string>()
	const stack: string[] = []

	const visit = (agentId: string): string[] | undefined => {
		if (visiting.has(agentId)) {
			return stack.slice(stack.indexOf(agentId)).concat(agentId)
		}
		if (visited.has(agentId)) {
			return undefined
		}

		visiting.add(agentId)
		stack.push(agentId)

		for (const dependencyId of graph.get(agentId) ?? []) {
			const cycle = visit(dependencyId)
			if (cycle) {
				return cycle
			}
		}

		stack.pop()
		visiting.delete(agentId)
		visited.add(agentId)
		return undefined
	}

	for (const agent of agents) {
		const cycle = visit(agent.id)
		if (cycle) {
			return cycle
		}
	}

	return undefined
}

export function handlePlanParallelTasks(
	input: unknown,
	repoRoot: string,
	options: PlanParallelTasksOptions = {},
): PlanParallelTasksResult {
	const errors: string[] = []
	const warnings: string[] = []

	if (!isRecord(input)) {
		return { ok: false, errors: ["A plan payload object is required."], warnings }
	}

	const goal = typeof input.goal === "string" ? input.goal : ""
	const sharedContext = typeof input.sharedContext === "string" ? input.sharedContext : undefined
	if (input.sharedContext !== undefined && typeof input.sharedContext !== "string") {
		errors.push("sharedContext must be a string when provided.")
	}

	let expectedFiles: string[] = []
	const normalizedExpectedFiles = normalizeStringArray(input.expectedFiles, "expectedFiles", errors)
	if (normalizedExpectedFiles) {
		expectedFiles = normalizedExpectedFiles
	}

	if (!goal.trim()) {
		errors.push("A non-empty goal is required.")
	}

	const rawAgents = input.agents
	if (!Array.isArray(rawAgents) || rawAgents.length === 0) {
		errors.push("At least one agent must be provided.")
	}

	const maxAgents =
		typeof options.maxAgents === "number" && Number.isFinite(options.maxAgents)
			? Math.trunc(options.maxAgents)
			: undefined
	if (Array.isArray(rawAgents) && maxAgents !== undefined && maxAgents > 0 && rawAgents.length > maxAgents) {
		errors.push(
			`Parallel task plan includes ${rawAgents.length} agents, but maximum parallel agents is configured to ${maxAgents}. Reduce the plan to ${maxAgents} agents or fewer.`,
		)
	}

	const agents: PlanParallelTasksInputAgent[] = []
	const agentIds = new Set<string>()
	for (const [index, rawAgent] of (Array.isArray(rawAgents) ? rawAgents : []).entries()) {
		if (!isRecord(rawAgent)) {
			errors.push(`Agent at index ${index} must be an object.`)
			continue
		}

		const id = typeof rawAgent.id === "string" ? rawAgent.id : ""
		const mode = typeof rawAgent.mode === "string" ? normalizeModeSlug(rawAgent.mode) : ""
		const task = typeof rawAgent.task === "string" ? rawAgent.task : ""
		const agentLabel = id.trim() || `at index ${index}`

		if (!id.trim()) {
			errors.push("Every agent requires a non-empty id.")
		} else if (agentIds.has(id)) {
			errors.push(`Duplicate agent id: ${id}`)
		} else {
			agentIds.add(id)
		}

		if (!task.trim()) {
			errors.push(
				id.trim()
					? `Agent ${id} requires a non-empty task.`
					: `Agent at index ${index} requires a non-empty task.`,
			)
		}

		if (!mode.trim()) {
			errors.push(
				id.trim()
					? `Agent ${id} requires a non-empty mode.`
					: `Agent at index ${index} requires a non-empty mode.`,
			)
		}

		let owns: FileOwnership[] | undefined
		if (rawAgent.owns !== undefined) {
			if (!Array.isArray(rawAgent.owns)) {
				errors.push(`Agent ${agentLabel} owns must be an array.`)
			} else {
				owns = []
				for (const [ownershipIndex, rawOwnership] of rawAgent.owns.entries()) {
					if (!isRecord(rawOwnership)) {
						errors.push(`Ownership at index ${ownershipIndex} for agent ${agentLabel} must be an object.`)
						continue
					}
					if (typeof rawOwnership.path !== "string" || !rawOwnership.path.trim()) {
						errors.push(
							`Ownership at index ${ownershipIndex} for agent ${agentLabel} requires a non-empty path.`,
						)
						continue
					}
					if (!["exclusive", "read-only", "shared"].includes(String(rawOwnership.mode))) {
						errors.push(
							`Ownership ${normalizePlanPath(rawOwnership.path)} for agent ${agentLabel} requires a valid mode.`,
						)
						continue
					}
					owns.push({ path: rawOwnership.path, mode: rawOwnership.mode as FileOwnership["mode"] })
				}
			}
		}

		let dependsOn: AgentDependency[] | undefined
		if (rawAgent.dependsOn !== undefined) {
			if (!Array.isArray(rawAgent.dependsOn)) {
				errors.push(`Agent ${agentLabel} dependsOn must be an array.`)
			} else {
				dependsOn = []
				for (const [dependencyIndex, rawDependency] of rawAgent.dependsOn.entries()) {
					if (!isRecord(rawDependency)) {
						errors.push(`Dependency at index ${dependencyIndex} for agent ${agentLabel} must be an object.`)
						continue
					}
					const waitFor = rawDependency.waitFor
					if (typeof rawDependency.agentId !== "string" || !rawDependency.agentId.trim()) {
						errors.push(
							`Dependency at index ${dependencyIndex} for agent ${agentLabel} requires a non-empty agentId.`,
						)
						continue
					}
					if (waitFor !== "complete" && waitFor !== "signal") {
						errors.push(
							`Dependency on ${rawDependency.agentId} for agent ${agentLabel} requires a valid waitFor.`,
						)
						continue
					}
					dependsOn.push({
						agentId: rawDependency.agentId,
						waitFor,
						signal: typeof rawDependency.signal === "string" ? rawDependency.signal : undefined,
						context: typeof rawDependency.context === "string" ? rawDependency.context : undefined,
					})
				}
			}
		}

		const mustNotTouch = normalizeStringArray(rawAgent.mustNotTouch, "mustNotTouch", errors, `Agent ${agentLabel}`)
		const signals = normalizeStringArray(rawAgent.signals, "signals", errors, `Agent ${agentLabel}`)

		let worktreePath: string | undefined
		if (rawAgent.worktreePath !== undefined) {
			if (typeof rawAgent.worktreePath === "string") {
				worktreePath = rawAgent.worktreePath
			} else {
				errors.push(`Agent ${agentLabel} worktreePath must be a string when provided.`)
			}
		}

		agents.push({ id, mode, task, owns, mustNotTouch, dependsOn, worktreePath, signals })
	}

	for (const agent of agents) {
		for (const dependency of agent.dependsOn ?? []) {
			if (!agentIds.has(dependency.agentId)) {
				errors.push(`Agent ${agent.id} depends on unknown agent ${dependency.agentId}.`)
			}
			if (dependency.waitFor === "signal" && !dependency.signal) {
				errors.push(`Agent ${agent.id} has a signal dependency on ${dependency.agentId} without a signal.`)
			}
		}
	}

	for (let index = 0; index < agents.length; index++) {
		for (let nextIndex = index + 1; nextIndex < agents.length; nextIndex++) {
			const left = agents[index]
			const right = agents[nextIndex]
			for (const leftOwnership of left.owns ?? []) {
				for (const rightOwnership of right.owns ?? []) {
					if (ownershipsConflict(leftOwnership, rightOwnership)) {
						errors.push(
							`Ownership conflict for ${normalizePlanPath(leftOwnership.path)} between ${left.id} and ${right.id}.`,
						)
					}
				}
			}
		}
	}

	const cycle = findDependencyCycle(agents)
	if (cycle) {
		errors.push(`Dependency cycle detected: ${cycle.join(" -> ")}.`)
	}

	const normalizedExpectedFilesSet = new Set(expectedFiles.map(normalizePlanPath))
	const ownedFiles = new Set(
		agents.flatMap((agent) => (agent.owns ?? []).map((ownership) => normalizePlanPath(ownership.path))),
	)
	for (const expectedFile of normalizedExpectedFilesSet) {
		if (!ownedFiles.has(expectedFile)) {
			warnings.push(`Expected file ${expectedFile} is not owned by any agent.`)
		}
	}

	if (errors.length > 0) {
		return { ok: false, errors, warnings }
	}

	const planId = `plan-${Date.now().toString(36)}`
	const agentPlans: AgentPlan[] = agents.map((agent) => ({
		id: agent.id,
		mode: agent.mode,
		task: agent.task,
		owns: (agent.owns ?? []).map((ownership) => ({ ...ownership, path: normalizePlanPath(ownership.path) })),
		mustNotTouch: (agent.mustNotTouch ?? []).map(normalizePlanPath),
		dependsOn: agent.dependsOn ?? [],
		worktreePath: agent.worktreePath ?? path.join(repoRoot, ".roo", "parallel-worktrees", planId, agent.id),
		status: (agent.dependsOn?.length ?? 0) > 0 ? "blocked" : "pending",
		signals: agent.signals ?? [],
	}))

	const fileOwnershipMap: Record<string, string> = {}
	for (const agent of agentPlans) {
		for (const ownership of agent.owns) {
			if (ownership.mode !== "shared") {
				fileOwnershipMap[ownership.path] = agent.id
			}
		}
	}

	const plan: ExecutionPlan = {
		planId,
		sharedContext: sharedContext ?? goal,
		fileOwnershipMap,
		agents: agentPlans,
		createdAt: Date.now(),
	}

	return { ok: true, plan, warnings }
}

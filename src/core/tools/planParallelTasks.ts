import path from "path"

import type { AgentDependency, AgentPlan, ExecutionPlan, FileOwnership } from "@roo-code/types"

type PlanParallelTasksInputAgent = {
	id: string
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

export function handlePlanParallelTasks(input: PlanParallelTasksInput, repoRoot: string): PlanParallelTasksResult {
	const errors: string[] = []
	const warnings: string[] = []

	if (!input.goal?.trim()) {
		errors.push("A non-empty goal is required.")
	}

	if (!Array.isArray(input.agents) || input.agents.length === 0) {
		errors.push("At least one agent must be provided.")
	}

	const agentIds = new Set<string>()
	for (const agent of input.agents ?? []) {
		if (!agent.id?.trim()) {
			errors.push("Every agent requires a non-empty id.")
			continue
		}

		if (agentIds.has(agent.id)) {
			errors.push(`Duplicate agent id: ${agent.id}`)
		}
		agentIds.add(agent.id)

		if (!agent.task?.trim()) {
			errors.push(`Agent ${agent.id} requires a non-empty task.`)
		}
	}

	for (const agent of input.agents ?? []) {
		for (const dependency of agent.dependsOn ?? []) {
			if (!agentIds.has(dependency.agentId)) {
				errors.push(`Agent ${agent.id} depends on unknown agent ${dependency.agentId}.`)
			}
			if (dependency.waitFor === "signal" && !dependency.signal) {
				errors.push(`Agent ${agent.id} has a signal dependency on ${dependency.agentId} without a signal.`)
			}
		}
	}

	for (let index = 0; index < input.agents.length; index++) {
		for (let nextIndex = index + 1; nextIndex < input.agents.length; nextIndex++) {
			const left = input.agents[index]
			const right = input.agents[nextIndex]
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

	const cycle = findDependencyCycle(input.agents ?? [])
	if (cycle) {
		errors.push(`Dependency cycle detected: ${cycle.join(" -> ")}.`)
	}

	const expectedFiles = new Set((input.expectedFiles ?? []).map(normalizePlanPath))
	const ownedFiles = new Set(
		(input.agents ?? []).flatMap((agent) =>
			(agent.owns ?? []).map((ownership) => normalizePlanPath(ownership.path)),
		),
	)
	for (const expectedFile of expectedFiles) {
		if (!ownedFiles.has(expectedFile)) {
			warnings.push(`Expected file ${expectedFile} is not owned by any agent.`)
		}
	}

	if (errors.length > 0) {
		return { ok: false, errors, warnings }
	}

	const planId = `plan-${Date.now().toString(36)}`
	const agents: AgentPlan[] = input.agents.map((agent) => ({
		id: agent.id,
		task: agent.task,
		owns: (agent.owns ?? []).map((ownership) => ({ ...ownership, path: normalizePlanPath(ownership.path) })),
		mustNotTouch: (agent.mustNotTouch ?? []).map(normalizePlanPath),
		dependsOn: agent.dependsOn ?? [],
		worktreePath: agent.worktreePath ?? path.join(repoRoot, ".roo", "parallel-worktrees", planId, agent.id),
		status: (agent.dependsOn?.length ?? 0) > 0 ? "blocked" : "pending",
		signals: agent.signals ?? [],
	}))

	const fileOwnershipMap: Record<string, string> = {}
	for (const agent of agents) {
		for (const ownership of agent.owns) {
			if (ownership.mode !== "shared") {
				fileOwnershipMap[ownership.path] = agent.id
			}
		}
	}

	const plan: ExecutionPlan = {
		planId,
		sharedContext: input.sharedContext ?? input.goal,
		fileOwnershipMap,
		agents,
		createdAt: Date.now(),
	}

	return { ok: true, plan, warnings }
}

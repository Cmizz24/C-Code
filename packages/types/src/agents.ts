import type { TokenUsage } from "./message.js"

export interface FileOwnership {
	path: string
	mode: "exclusive" | "read-only" | "shared"
}

export interface AgentDependency {
	agentId: string
	waitFor: "complete" | "signal"
	signal?: string
	context?: string
}

export type AgentStatus = "pending" | "running" | "blocked" | "complete" | "failed"

export type AgentActivityKind =
	| "status"
	| "assistant"
	| "message"
	| "thinking"
	| "tool"
	| "approval"
	| "result"
	| "wait"
	| "error"
	| "completion"
	| "signal"
	| "file"

export interface AgentActivityEvent {
	agentId: string
	message: string
	ts: number
	kind?: AgentActivityKind
}

export type AgentCoordinationKind =
	| "shared-context"
	| "shared-contract"
	| "ownership"
	| "dependency"
	| "signal"
	| "completion"
	| "note"
	| "question"
	| "answer"
	| "decision"
	| "blocker"

export type AgentCoordinationSource = "agent" | "system"

export interface AgentCoordinationEvent {
	id?: string
	agentId?: string
	targetAgentId?: string
	message: string
	ts: number
	kind: AgentCoordinationKind
	source?: AgentCoordinationSource
	relatedFiles?: string[]
	replyToId?: string
	answerState?: "open" | "answered" | "unanswerable"
	answerEventId?: string
	answeredAt?: number
	unanswerableReason?: string
}

export interface AgentPlan {
	id: string
	mode: string
	task: string
	owns: FileOwnership[]
	mustNotTouch: string[]
	dependsOn: AgentDependency[]
	worktreePath: string
	status: AgentStatus
	signals: string[]
	continuation?: AgentContinuationMetadata
}

export interface ExecutionPlan {
	planId: string
	goal?: string
	sharedContext: string
	sharedContract: string
	fileOwnershipMap: Record<string, string>
	agents: AgentPlan[]
	createdAt: number
	continuation?: ParallelPlanContinuationMetadata
}

export type AgentContinuationDecision = "reused" | "fresh"

export interface AgentContinuationMetadata {
	decision: AgentContinuationDecision
	reason: string
	sourcePlanId?: string
	sourceAgentId?: string
	sourceBranch?: string
	sourceWorktreePath?: string
	sourceTask?: string
	sourceGoal?: string
	newPlanId?: string
	newAgentId?: string
	newBranch?: string
	reusedWorktreePath?: string
	resetToCurrentBaseline?: boolean
	relevanceScore?: number
	relevanceSignals?: string[]
	relevantFiles?: string[]
	changeStats?: MergeReviewChangeStats
	context?: string
}

export interface ParallelPlanContinuationMetadata {
	schemaVersion: 1
	workspaceRoot?: string
	repositoryRoot?: string
	sourcePlanId?: string
	evaluatedAt: number
	reusedAgentCount: number
	freshAgentCount: number
	decisions: Array<{
		agentId: string
		decision: AgentContinuationDecision
		sourceAgentId?: string
		reason: string
		relevanceScore?: number
		relevanceSignals?: string[]
	}>
}

export interface WritePermission {
	approved: boolean
	reason?: string
	suggestWait?: boolean
	unownedWarning?: string
}

export type AgentEvidenceSource =
	| "agent-bus"
	| "orchestrator"
	| "provider"
	| "merge-review"
	| "worktree-manager"
	| "plan-aggregation"

export interface AgentCompletionEvidenceMetadata {
	source: AgentEvidenceSource
	sourceId?: string
	ts: number
	note?: string
}

export interface AgentWriteIntentEvidence {
	path: string
	approved: boolean
	reason?: string
	unownedWarning?: string
	ownerAgentId?: string
	ts: number
}

export type AgentOwnershipComplianceStatus = "compliant" | "warning" | "violation"

export interface AgentOwnershipCompliance {
	status: AgentOwnershipComplianceStatus
	ownedPaths: FileOwnership[]
	attemptedWrites: AgentWriteIntentEvidence[]
	attemptedOutOfScopeWrites: AgentWriteIntentEvidence[]
	conflicts: AgentWriteIntentEvidence[]
	notes: string[]
}

export type ParallelArtifactChangeStatus = "created" | "modified" | "deleted" | "renamed" | "unknown"

export interface ParallelArtifactManifestEntry {
	path: string
	status: ParallelArtifactChangeStatus
	previousPath?: string
	additions: number
	deletions: number
	binary: boolean
	source: "diff" | "write-intent" | "merge-review" | "unknown"
	agentId?: string
}

export type AgentDeliverableStatus = "satisfied" | "pending" | "failed" | "unknown" | "not-applicable"

export interface AgentDeliverableChecklistItem {
	id: string
	label: string
	status: AgentDeliverableStatus
	source: "assigned-task" | "shared-context" | "shared-contract" | "plan" | "agent" | "provider"
	note?: string
}

export type AgentValidationStatus = "passed" | "warning" | "failed" | "skipped" | "unknown"

export interface AgentValidationResult {
	name: string
	status: AgentValidationStatus
	summary: string
	ts: number
	source: AgentEvidenceSource
}

export type AgentMergeReadinessStatus = "not-reviewed" | "ready" | "not-ready" | "awaiting-review"
export type AgentMergeResultStatus = "not-merged" | "pending" | "merged" | "failed" | "skipped"

export interface AgentMergeEvidence {
	readiness: AgentMergeReadinessStatus
	result: AgentMergeResultStatus
	mergeable?: boolean
	branch?: string
	worktreePath?: string
	clean?: boolean
	materialized?: boolean
	autoApproved?: boolean
	reviewError?: string
	mergeError?: string
	conflictedFiles?: string[]
	notes: string[]
	ts: number
}

export interface AgentCompletionPacket {
	schemaVersion: 1
	planId: string
	agentId: string
	agentName: string
	mode: string
	task: string
	status: AgentStatus
	ownedPaths: FileOwnership[]
	artifactManifest: ParallelArtifactManifestEntry[]
	ownership: AgentOwnershipCompliance
	deliverables: AgentDeliverableChecklistItem[]
	validation: AgentValidationResult[]
	merge: AgentMergeEvidence
	completionResult?: string
	evidence: {
		createdAt: number
		updatedAt: number
		sources: AgentCompletionEvidenceMetadata[]
	}
}

export type ParallelPlanCompletionStatus =
	| "running"
	| "complete"
	| "partially-complete"
	| "failed"
	| "awaiting-review"
	| "merged"
	| "cancelled"

export interface ParallelPlanCompletionPacket {
	schemaVersion: 1
	planId: string
	status: ParallelPlanCompletionStatus
	sharedContext: string
	sharedContract: string
	agentCount: number
	completedAgentCount: number
	failedAgentCount: number
	packetCount: number
	agentPacketRefs: Array<{ agentId: string; status: AgentStatus; packetUpdatedAt: number }>
	aggregateArtifactManifest: ParallelArtifactManifestEntry[]
	ownership: {
		status: AgentOwnershipComplianceStatus
		attemptedOutOfScopeWrites: AgentWriteIntentEvidence[]
		conflicts: AgentWriteIntentEvidence[]
		notes: string[]
	}
	merge: {
		status: AgentMergeResultStatus | "mixed" | "awaiting-review"
		clean: boolean
		mergedAgents: string[]
		pendingAgents: string[]
		failedAgents: string[]
		skippedAgents: string[]
		conflictedFiles: string[]
		notes: string[]
	}
	failedAgents: Array<{ agentId: string; status: AgentStatus; reason?: string }>
	skippedAgents: Array<{ agentId: string; reason?: string }>
	validationSummary: {
		passed: number
		warnings: number
		failed: number
		skipped: number
		unknown: number
		notes: string[]
	}
	evidence: {
		createdAt: number
		updatedAt: number
		sources: AgentCompletionEvidenceMetadata[]
	}
}

export type AgentEvent =
	| {
			type: "INTENT_WRITE"
			agentId: string
			path: string
			permission: WritePermission
	  }
	| {
			type: "PROGRESS"
			agentId: string
			message: string
			kind?: AgentActivityKind
			path?: string
	  }
	| {
			type: "INTENT_COMMAND"
			agentId: string
			command: string
			cwd?: string
	  }
	| {
			type: "SIGNAL"
			agentId: string
			signal: string
			payload?: string
	  }
	| {
			type: "STATUS"
			agentId: string
			status: AgentStatus
	  }
	| {
			type: "COMPLETE"
			agentId: string
			result?: string
	  }
	| {
			type: "FAILED"
			agentId: string
			reason: string
	  }
	| {
			type: "BLOCKED"
			agentId: string
			reason: string
			blockedOn?: AgentDependency[]
	  }
	| {
			type: "CONFLICT_QUERY"
			agentId: string
			path: string
			ownerAgentId?: string
	  }
	| {
			type: "INTENT_CLEARED"
			agentId: string
			path: string
	  }
	| {
			type: "COORDINATION"
			event: AgentCoordinationEvent
	  }
	| {
			type: "COMPLETION_PACKET"
			agentId: string
			packet: AgentCompletionPacket
	  }
	| {
			type: "PLAN_COMPLETION_PACKET"
			packet: ParallelPlanCompletionPacket
	  }

export interface AgentStatusUpdate {
	agentId: string
	status: AgentStatus
	lastTouchedFile?: string
	reason?: string
	blockedOn?: AgentDependency[]
	usage?: TokenUsage
	activities?: AgentActivityEvent[]
}

export interface WriteIntentConflict {
	agentId: string
	filePath: string
	ownerAgentId?: string
	ownerTask?: string
	reason?: string
}

export interface MergeReviewChangeStats {
	filesChanged: number
	additions: number
	deletions: number
	totalChanges: number
	binaryFiles: number
}

export interface ParallelAgentReviewSummary {
	path: string
	markdown: string
}

function normalizeDiffPath(filePath: string | undefined): string | undefined {
	const normalized = String(filePath ?? "")
		.trim()
		.replace(/^"|"$/g, "")
		.replace(/\\/g, "/")

	if (!normalized || normalized === "/dev/null") {
		return undefined
	}

	return normalized.replace(/^[ab]\//, "")
}

function parseDiffGitPaths(line: string): { previousPath?: string; path?: string } {
	const content = line.slice("diff --git ".length)
	const separatorIndex = content.indexOf(" b/")

	if (separatorIndex === -1) {
		const parts = content.split(/\s+/)
		return {
			previousPath: normalizeDiffPath(parts[0]),
			path: normalizeDiffPath(parts[1]),
		}
	}

	return {
		previousPath: normalizeDiffPath(content.slice(0, separatorIndex)),
		path: normalizeDiffPath(content.slice(separatorIndex + 1)),
	}
}

export function computeArtifactManifestFromDiff(diff: string): ParallelArtifactManifestEntry[] {
	const artifacts: ParallelArtifactManifestEntry[] = []
	let current: ParallelArtifactManifestEntry | undefined

	const finishCurrentArtifact = () => {
		if (current?.path) {
			artifacts.push(current)
		}
		current = undefined
	}

	const lines = diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")

	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			finishCurrentArtifact()
			const paths = parseDiffGitPaths(line)
			const path = paths.path ?? paths.previousPath
			if (path) {
				current = {
					path,
					...(paths.previousPath && paths.previousPath !== path ? { previousPath: paths.previousPath } : {}),
					status: "modified",
					additions: 0,
					deletions: 0,
					binary: false,
					source: "diff",
				}
			}
			continue
		}

		if (!current) {
			continue
		}

		if (line.startsWith("new file mode ")) {
			current.status = "created"
			continue
		}

		if (line.startsWith("deleted file mode ")) {
			current.status = "deleted"
			if (current.previousPath) {
				current.path = current.previousPath
				delete current.previousPath
			}
			continue
		}

		if (line.startsWith("rename from ")) {
			current.previousPath = normalizeDiffPath(line.slice("rename from ".length))
			current.status = "renamed"
			continue
		}

		if (line.startsWith("rename to ")) {
			current.path = normalizeDiffPath(line.slice("rename to ".length)) ?? current.path
			current.status = "renamed"
			continue
		}

		if (line.startsWith("Binary files ") || line === "GIT binary patch") {
			current.binary = true
			continue
		}

		if (line.startsWith("+") && !line.startsWith("+++")) {
			current.additions += 1
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			current.deletions += 1
		}
	}

	finishCurrentArtifact()

	return artifacts
		.map((artifact) => ({ ...artifact, path: normalizeDiffPath(artifact.path) ?? artifact.path }))
		.filter((artifact) => artifact.path.length > 0)
}

function getDeliverableStatus(status: AgentStatus): AgentDeliverableStatus {
	switch (status) {
		case "complete":
			return "satisfied"
		case "failed":
			return "failed"
		case "pending":
		case "running":
		case "blocked":
			return "pending"
	}
}

function getOwnershipCompliance(
	agent: AgentPlan,
	attemptedWrites: AgentWriteIntentEvidence[],
): AgentOwnershipCompliance {
	const attemptedOutOfScopeWrites = attemptedWrites.filter((attempt) => !attempt.approved || attempt.unownedWarning)
	const conflicts = attemptedWrites.filter((attempt) => !attempt.approved)
	const hasViolation = conflicts.length > 0
	const hasWarning = attemptedWrites.some((attempt) => Boolean(attempt.unownedWarning))
	const notes: string[] = []

	if (hasViolation) {
		notes.push("One or more write attempts were denied by ownership enforcement.")
	}

	if (hasWarning) {
		notes.push("One or more write attempts targeted paths not declared in the execution plan.")
	}

	if (!hasViolation && !hasWarning) {
		notes.push("No ownership violations were recorded by the AgentBus.")
	}

	return {
		status: hasViolation ? "violation" : hasWarning ? "warning" : "compliant",
		ownedPaths: agent.owns,
		attemptedWrites,
		attemptedOutOfScopeWrites,
		conflicts,
		notes,
	}
}

export function createAgentCompletionPacket(
	plan: ExecutionPlan,
	agent: AgentPlan,
	options: {
		status?: AgentStatus
		completionResult?: string
		attemptedWrites?: AgentWriteIntentEvidence[]
		artifactManifest?: ParallelArtifactManifestEntry[]
		validation?: AgentValidationResult[]
		merge?: Partial<AgentMergeEvidence>
		evidence?: AgentCompletionEvidenceMetadata
		ts?: number
	} = {},
): AgentCompletionPacket {
	const ts = options.ts ?? Date.now()
	const status = options.status ?? agent.status
	const attemptedWrites = options.attemptedWrites ?? []
	const ownership = getOwnershipCompliance(agent, attemptedWrites)
	const deliverableStatus = getDeliverableStatus(status)
	const validation: AgentValidationResult[] = [
		{
			name: "agent-terminal-status",
			status: status === "failed" ? "failed" : status === "complete" ? "passed" : "unknown",
			summary:
				status === "complete"
					? "Agent reported completion through the AgentBus."
					: status === "failed"
						? "Agent reported failure through the AgentBus."
						: "Agent has not reported a terminal state yet.",
			ts,
			source: "agent-bus",
		},
		{
			name: "ownership-compliance",
			status: ownership.status === "violation" ? "failed" : ownership.status === "warning" ? "warning" : "passed",
			summary: ownership.notes.join(" "),
			ts,
			source: "agent-bus",
		},
		...(options.validation ?? []),
	]

	return {
		schemaVersion: 1,
		planId: plan.planId,
		agentId: agent.id,
		agentName: agent.id,
		mode: agent.mode,
		task: agent.task,
		status,
		ownedPaths: agent.owns,
		artifactManifest: options.artifactManifest ?? [],
		ownership,
		deliverables: [
			{
				id: "assigned-task",
				label: agent.task,
				status: deliverableStatus,
				source: "assigned-task",
				note: options.completionResult,
			},
			...(plan.sharedContext.trim()
				? [
						{
							id: "shared-context",
							label: "Plan shared context considered",
							status: deliverableStatus,
							source: "shared-context" as const,
							note: plan.sharedContext,
						},
					]
				: []),
			...((plan.sharedContract ?? "").trim()
				? [
						{
							id: "shared-contract",
							label: "Plan shared contract acknowledged and applied",
							status: deliverableStatus,
							source: "shared-contract" as const,
							note: plan.sharedContract,
						},
					]
				: []),
		],
		validation,
		merge: {
			readiness: status === "complete" ? "awaiting-review" : "not-reviewed",
			result: "not-merged",
			worktreePath: agent.worktreePath,
			notes: [],
			ts,
			...options.merge,
		},
		...(options.completionResult ? { completionResult: options.completionResult } : {}),
		evidence: {
			createdAt: ts,
			updatedAt: ts,
			sources: [
				options.evidence ?? {
					source: "agent-bus",
					sourceId: agent.id,
					ts,
				},
			],
		},
	}
}

function uniqueByKey<T>(items: T[], getKey: (item: T) => string): T[] {
	const seen = new Set<string>()
	const result: T[] = []

	for (const item of items) {
		const key = getKey(item)
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		result.push(item)
	}

	return result
}

export function buildParallelPlanCompletionPacket(
	plan: ExecutionPlan,
	agentPackets: AgentCompletionPacket[],
	options: { status?: ParallelPlanCompletionStatus; ts?: number; source?: AgentCompletionEvidenceMetadata } = {},
): ParallelPlanCompletionPacket {
	const ts = options.ts ?? Date.now()
	const packetsByAgentId = new Map(agentPackets.map((packet) => [packet.agentId, packet]))
	const completedAgentCount = plan.agents.filter((agent) => agent.status === "complete").length
	const failedAgentCount = plan.agents.filter((agent) => agent.status === "failed").length
	const failedAgents = plan.agents
		.filter((agent) => agent.status === "failed")
		.map((agent) => ({
			agentId: agent.id,
			status: agent.status,
			reason: packetsByAgentId.get(agent.id)?.completionResult,
		}))
	const aggregateArtifactManifest = uniqueByKey(
		agentPackets.flatMap((packet) =>
			packet.artifactManifest.map((artifact) => ({ ...artifact, agentId: artifact.agentId ?? packet.agentId })),
		),
		(artifact) => `${artifact.agentId ?? ""}:${artifact.path}:${artifact.status}:${artifact.previousPath ?? ""}`,
	)
	const attemptedOutOfScopeWrites = agentPackets.flatMap((packet) => packet.ownership.attemptedOutOfScopeWrites)
	const conflicts = agentPackets.flatMap((packet) => packet.ownership.conflicts)
	const ownershipStatus: AgentOwnershipComplianceStatus = conflicts.length
		? "violation"
		: attemptedOutOfScopeWrites.length
			? "warning"
			: "compliant"
	const mergeResults = agentPackets.map((packet) => packet.merge.result)
	const mergedAgents = agentPackets
		.filter((packet) => packet.merge.result === "merged")
		.map((packet) => packet.agentId)
	const pendingAgents = plan.agents
		.filter((agent) => {
			const packet = packetsByAgentId.get(agent.id)
			return !packet || packet.merge.result === "pending" || packet.merge.result === "not-merged"
		})
		.map((agent) => agent.id)
	const mergeFailedAgents = agentPackets
		.filter((packet) => packet.merge.result === "failed")
		.map((packet) => packet.agentId)
	const skippedAgents = agentPackets
		.filter((packet) => packet.merge.result === "skipped")
		.map((packet) => ({ agentId: packet.agentId, reason: packet.merge.notes[0] }))
	const conflictedFiles = uniqueByKey(
		agentPackets.flatMap((packet) => packet.merge.conflictedFiles ?? []),
		(filePath) => filePath,
	)
	const mergeStatus = (() => {
		if (mergeResults.length > 0 && mergeResults.every((status) => status === "merged")) {
			return "merged"
		}

		if (mergeFailedAgents.length > 0) {
			return "failed"
		}

		if (skippedAgents.length > 0) {
			return "skipped"
		}

		if (plan.agents.every((agent) => agent.status === "complete")) {
			return "awaiting-review"
		}

		if (mergeResults.some((status) => status === "pending" || status === "not-merged")) {
			return "pending"
		}

		return "not-merged"
	})()
	const validationResults = agentPackets.flatMap((packet) => packet.validation)
	const validationSummary = validationResults.reduce(
		(summary, result) => {
			switch (result.status) {
				case "passed":
					summary.passed += 1
					break
				case "warning":
					summary.warnings += 1
					break
				case "failed":
					summary.failed += 1
					break
				case "skipped":
					summary.skipped += 1
					break
				case "unknown":
					summary.unknown += 1
					break
			}
			if (result.status !== "passed") {
				summary.notes.push(`${result.name}: ${result.summary}`)
			}
			return summary
		},
		{ passed: 0, warnings: 0, failed: 0, skipped: 0, unknown: 0, notes: [] as string[] },
	)
	const derivedStatus: ParallelPlanCompletionStatus = (() => {
		if (mergeStatus === "merged") {
			return "merged"
		}

		if (mergeStatus === "failed") {
			return "failed"
		}

		if (mergeStatus === "skipped") {
			return "cancelled"
		}

		if (failedAgentCount > 0 && completedAgentCount > 0) {
			return "partially-complete"
		}

		if (failedAgentCount > 0) {
			return "failed"
		}

		if (completedAgentCount === plan.agents.length && plan.agents.length > 0) {
			return agentPackets.length === plan.agents.length ? "complete" : "awaiting-review"
		}

		return "running"
	})()
	const evidenceSources = uniqueByKey(
		[
			...agentPackets.flatMap((packet) => packet.evidence.sources),
			options.source ?? { source: "plan-aggregation" as const, sourceId: plan.planId, ts },
		],
		(source) => `${source.source}:${source.sourceId ?? ""}:${source.ts}:${source.note ?? ""}`,
	)

	return {
		schemaVersion: 1,
		planId: plan.planId,
		status: options.status ?? derivedStatus,
		sharedContext: plan.sharedContext,
		sharedContract: plan.sharedContract ?? "",
		agentCount: plan.agents.length,
		completedAgentCount,
		failedAgentCount,
		packetCount: agentPackets.length,
		agentPacketRefs: agentPackets.map((packet) => ({
			agentId: packet.agentId,
			status: packet.status,
			packetUpdatedAt: packet.evidence.updatedAt,
		})),
		aggregateArtifactManifest,
		ownership: {
			status: ownershipStatus,
			attemptedOutOfScopeWrites,
			conflicts,
			notes:
				ownershipStatus === "compliant"
					? ["All agent packets report compliant ownership evidence."]
					: ["One or more agent packets report ownership warnings or violations."],
		},
		merge: {
			status: mergeStatus,
			clean: mergeFailedAgents.length === 0 && conflictedFiles.length === 0,
			mergedAgents,
			pendingAgents,
			failedAgents: mergeFailedAgents,
			skippedAgents: skippedAgents.map((agent) => agent.agentId),
			conflictedFiles,
			notes: [
				`Merge status: ${mergeStatus}.`,
				...(conflictedFiles.length ? [`Conflicted files: ${conflictedFiles.join(", ")}.`] : []),
			],
		},
		failedAgents,
		skippedAgents,
		validationSummary,
		evidence: {
			createdAt: Math.min(...agentPackets.map((packet) => packet.evidence.createdAt), ts),
			updatedAt: ts,
			sources: evidenceSources,
		},
	}
}

export function computeMergeReviewChangeStats(diff: string): MergeReviewChangeStats {
	const stats: MergeReviewChangeStats = {
		filesChanged: 0,
		additions: 0,
		deletions: 0,
		totalChanges: 0,
		binaryFiles: 0,
	}

	let sawDiffHeader = false
	let currentFileIsBinary = false

	const finishCurrentFile = () => {
		if (currentFileIsBinary) {
			stats.binaryFiles += 1
			currentFileIsBinary = false
		}
	}

	const lines = diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")

	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			finishCurrentFile()
			sawDiffHeader = true
			stats.filesChanged += 1
			continue
		}

		const isBinaryMarker = line.startsWith("Binary files ") || line === "GIT binary patch"

		if (!sawDiffHeader) {
			if (isBinaryMarker) {
				stats.filesChanged = Math.max(stats.filesChanged, 1)
				currentFileIsBinary = true
			}
			continue
		}

		if (isBinaryMarker) {
			currentFileIsBinary = true
			continue
		}

		if (line.startsWith("+") && !line.startsWith("+++")) {
			stats.additions += 1
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			stats.deletions += 1
		}
	}

	finishCurrentFile()
	stats.totalChanges = stats.additions + stats.deletions

	return stats
}

export interface MergeReviewEntry {
	agentId: string
	mode?: string
	task: string
	diff: string
	noChangesReason?: string
	worktreePath: string
	branch: string
	changeStats?: MergeReviewChangeStats
	reviewError?: string
	mergeable?: boolean
	mergeStatus?: "pending" | "merged" | "failed" | "skipped"
	mergeError?: string
	autoMergeSkippedReason?: string
	conflictedFiles?: string[]
}

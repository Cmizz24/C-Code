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
}

export interface ExecutionPlan {
	planId: string
	sharedContext: string
	fileOwnershipMap: Record<string, string>
	agents: AgentPlan[]
	createdAt: number
}

export interface WritePermission {
	approved: boolean
	reason?: string
	suggestWait?: boolean
	unownedWarning?: string
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

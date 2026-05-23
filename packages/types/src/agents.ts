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
}

export interface WriteIntentConflict {
	agentId: string
	filePath: string
	ownerAgentId?: string
	ownerTask?: string
	reason?: string
}

export interface MergeReviewEntry {
	agentId: string
	mode?: string
	task: string
	diff: string
	noChangesReason?: string
	worktreePath: string
	branch: string
}

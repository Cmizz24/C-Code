import { z } from "zod"

/**
 * Context Management Types
 *
 * This module provides type definitions for context management events.
 * These events are used to handle different strategies for managing conversation context
 * when approaching token limits.
 *
 * Event Types:
 * - `condense_context`: Context was condensed using AI summarization
 * - `condense_context_error`: An error occurred during context condensation
 * - `sliding_window_truncation`: Context was truncated using sliding window strategy
 * - `context_cache_event`: Hot/cold context cache activity occurred
 */

/**
 * Array of all context management event types.
 * Used for runtime type checking.
 */
export const CONTEXT_MANAGEMENT_EVENTS = [
	"condense_context",
	"condense_context_error",
	"sliding_window_truncation",
	"context_cache_event",
] as const

/**
 * Union type representing all possible context management event types.
 */
export type ContextManagementEvent = (typeof CONTEXT_MANAGEMENT_EVENTS)[number]

export interface ContextCacheBudgetOption {
	valueMb: number
	recommended?: boolean
}

export interface ContextCacheEvictionTotals {
	hot: number
	cold: number
	total: number
}

export interface ContextCacheContributorStats {
	id: string
	label: string
	taskId?: string
	instanceId?: string
	mode?: string
	agentId?: string
	isBackground?: boolean
	isActive?: boolean
	hotCacheChunks: number
	coldCacheChunks: number
	hotCacheRamMb: number
	coldCacheRamMb: number
	ramUsedMb: number
	evictions?: ContextCacheEvictionTotals
}

export interface ContextCacheCrossWindowStats {
	schemaVersion: number
	livePeerCount: number
	windowCount: number
	localUsageRamMb: number
	localBudgetRamMb: number
	peerUsageRamMb: number
	peerBudgetRamMb: number
	globalBudgetRamMb: number
	effectiveLocalBudgetRamMb: number
	localActiveTaskCount?: number
	localBackgroundTaskCount?: number
	peerActiveTaskCount?: number
	peerBackgroundTaskCount?: number
	staleHeartbeatCount?: number
	staleHeartbeatsCleaned?: number
	staleHeartbeatCleanupFailures?: number
	lastUpdatedAt?: number
}

export interface ContextCacheCombinedBudgetStats {
	ramUsedMb: number
	ramBudgetMb: number
	configuredRamBudgetMb?: number
	hotCacheRamMb: number
	coldCacheRamMb: number
	hotCacheChunks: number
	coldCacheChunks: number
	managerCount: number
	evictions: ContextCacheEvictionTotals
	contributors: ContextCacheContributorStats[]
	crossWindow?: ContextCacheCrossWindowStats
}

export interface ContextCacheStats {
	hotCacheTokens: number
	hotCacheChunks: number
	coldCacheChunks: number
	ramUsedMb: number
	ramBudgetMb: number
	swapsThisSession: number
	condensingAvoided: number
	combinedBudget?: ContextCacheCombinedBudgetStats
	evictions?: ContextCacheEvictionTotals
	contributors?: ContextCacheContributorStats[]
	crossWindow?: ContextCacheCrossWindowStats
}

export const CONTEXT_CACHE_EVENT_TYPES = [
	"chunks_moved_to_cold",
	"chunks_pulled_from_cold",
	"condensing_avoided",
	"cold_cache_full",
] as const

export const contextCacheEventTypeSchema = z.enum(CONTEXT_CACHE_EVENT_TYPES)

export type ContextCacheEventType = (typeof CONTEXT_CACHE_EVENT_TYPES)[number]

export const contextCacheEventSchema = z.object({
	id: z.string(),
	type: contextCacheEventTypeSchema,
	createdAt: z.number(),
	chunkCount: z.number().optional(),
	tokenCount: z.number().optional(),
	ramUsedMb: z.number().optional(),
	ramBudgetMb: z.number().optional(),
	query: z.string().optional(),
	filePath: z.string().optional(),
	warning: z.string().optional(),
})

export type ContextCacheEvent = z.infer<typeof contextCacheEventSchema>

export interface ContextCacheSearchResult {
	id: string
	type: string
	content: string
	filePath?: string
	tokens: number
	score: number
	breakdown?: {
		queryMatches: number
		filePathMatch: boolean
		typeBoost: number
		recencyBoost: number
	}
}

/**
 * Type guard function to check if a value is a valid context management event.
 */
export function isContextManagementEvent(value: unknown): value is ContextManagementEvent {
	return typeof value === "string" && (CONTEXT_MANAGEMENT_EVENTS as readonly string[]).includes(value)
}

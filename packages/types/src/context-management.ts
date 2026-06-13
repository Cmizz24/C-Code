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

export interface ContextCacheStats {
	hotCacheTokens: number
	hotCacheChunks: number
	coldCacheChunks: number
	ramUsedMb: number
	ramBudgetMb: number
	swapsThisSession: number
	condensingAvoided: number
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

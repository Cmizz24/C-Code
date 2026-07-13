import { describe, it, expect } from "vitest"
import {
	CONTEXT_CACHE_EVENT_OUTCOMES,
	CONTEXT_CACHE_EVENT_REASONS,
	CONTEXT_CACHE_EVENT_SOURCES,
	CONTEXT_CACHE_EVENT_TYPES,
	CONTEXT_MANAGEMENT_EVENTS,
	contextCacheEventSchema,
	isContextManagementEvent,
} from "../context-management.js"

const expectedContextManagementEvents = [
	"condense_context",
	"condense_context_error",
	"sliding_window_truncation",
	"context_cache_event",
	"context_management_blocked",
] as const

const expectedContextCacheEventTypes = [
	"chunks_moved_to_cold",
	"chunks_pulled_from_cold",
	"chunks_evicted_from_cache",
	"condensing_avoided",
	"cold_cache_full",
] as const

const expectedContextCacheEventReasons = [
	"hot_budget_trim",
	"request_pressure",
	"rebuild",
	"combined_budget_eviction",
	"ask_for_context",
] as const

const expectedContextCacheEventSources = ["active_task", "foreground_task", "background_agent"] as const

const expectedContextCacheEventOutcomes = [
	"moved",
	"merged_duplicate",
	"partially_merged",
	"rejected",
	"evicted",
	"retrieved",
] as const

describe("context-management", () => {
	describe("CONTEXT_MANAGEMENT_EVENTS", () => {
		it("should contain all expected event types", () => {
			expect(CONTEXT_MANAGEMENT_EVENTS).toEqual(expectedContextManagementEvents)
		})
	})

	describe("isContextManagementEvent", () => {
		it("should return true for valid context management events", () => {
			for (const event of expectedContextManagementEvents) {
				expect(isContextManagementEvent(event)).toBe(true)
			}
		})

		it("should return false for non-context-management events", () => {
			expect(isContextManagementEvent("text")).toBe(false)
			expect(isContextManagementEvent("error")).toBe(false)
			expect(isContextManagementEvent(null)).toBe(false)
			expect(isContextManagementEvent(undefined)).toBe(false)
		})
	})

	describe("contextCacheEventSchema", () => {
		it("should expose all supported cache event metadata values", () => {
			expect(CONTEXT_CACHE_EVENT_TYPES).toEqual(expectedContextCacheEventTypes)
			expect(CONTEXT_CACHE_EVENT_REASONS).toEqual(expectedContextCacheEventReasons)
			expect(CONTEXT_CACHE_EVENT_SOURCES).toEqual(expectedContextCacheEventSources)
			expect(CONTEXT_CACHE_EVENT_OUTCOMES).toEqual(expectedContextCacheEventOutcomes)
		})

		it("should parse cache attribution and duplicate diagnostics", () => {
			const result = contextCacheEventSchema.safeParse({
				id: "cache-event",
				type: "chunks_evicted_from_cache",
				createdAt: 123,
				chunkCount: 1,
				tokenCount: 2000,
				duplicateChunkCount: 2,
				duplicateTokenCount: 4000,
				reason: "combined_budget_eviction",
				source: "background_agent",
				outcome: "evicted",
			})

			expect(result.success).toBe(true)
		})
	})
})

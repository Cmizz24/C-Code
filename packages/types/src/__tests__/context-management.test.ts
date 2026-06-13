import { describe, it, expect } from "vitest"
import { CONTEXT_MANAGEMENT_EVENTS, isContextManagementEvent } from "../context-management.js"

const expectedContextManagementEvents = [
	"condense_context",
	"condense_context_error",
	"sliding_window_truncation",
	"context_cache_event",
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
})

import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchOpenAiCodexRateLimitInfo, parseOpenAiCodexUsagePayload } from "../rate-limits"

describe("parseOpenAiCodexUsagePayload()", () => {
	it("maps primary/secondary windows", () => {
		const fetchedAt = 1234567890000
		const payload = {
			rate_limit: {
				primary_window: { used_percent: 12.34, limit_window_seconds: 300 * 60, reset_at: 1700000000 },
				secondary_window: { used_percent: 99.9, limit_window_seconds: 10080 * 60, reset_at: 1700000000 },
			},
			plan_type: "plus",
		}

		const out = parseOpenAiCodexUsagePayload(payload, fetchedAt)

		expect(out).toEqual({
			primary: {
				usedPercent: 12.34,
				windowMinutes: 300,
				resetsAt: 1700000000 * 1000,
			},
			secondary: {
				usedPercent: 99.9,
				windowMinutes: 10080,
				resetsAt: 1700000000 * 1000,
			},
			planType: "plus",
			fetchedAt,
		})
	})

	it("clamps used_percent to 0–100 and tolerates missing fields", () => {
		const fetchedAt = 1
		const payload = {
			rate_limit: {
				primary_window: { used_percent: 1000 },
				secondary_window: { used_percent: -5 },
			},
		}
		const out = parseOpenAiCodexUsagePayload(payload, fetchedAt)
		expect(out.primary?.usedPercent).toBe(100)
		expect(out.secondary?.usedPercent).toBe(0)
		expect(out.fetchedAt).toBe(fetchedAt)
	})
})

describe("fetchOpenAiCodexRateLimitInfo()", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("throws a friendly session-expired error for invalidated Codex tokens", async () => {
		const createTokenInvalidatedResponse = () =>
			new Response(
				JSON.stringify({
					error: {
						message: "Your authentication token has been invalidated. Please try signing in again.",
						code: "token_invalidated",
					},
					status: 401,
				}),
				{ status: 401, statusText: "Unauthorized" },
			)

		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() => Promise.resolve(createTokenInvalidatedResponse())),
		)

		await expect(fetchOpenAiCodexRateLimitInfo("token")).rejects.toThrow(
			"OpenAI Codex session expired. Please sign in again to refresh usage limits.",
		)

		await expect(fetchOpenAiCodexRateLimitInfo("token")).rejects.not.toThrow("token_invalidated")
	})
})

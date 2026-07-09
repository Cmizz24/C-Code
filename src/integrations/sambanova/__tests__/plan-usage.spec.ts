// npx vitest run src/integrations/sambanova/__tests__/plan-usage.spec.ts

import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchSambaNovaPlanUsage } from "../plan-usage"

describe("fetchSambaNovaPlanUsage()", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("parses rate-limit headers into plan usage", async () => {
		const headers = new Headers({
			"x-ratelimit-limit-requests": "100",
			"x-ratelimit-remaining-requests": "60",
			"x-ratelimit-limit-requests-day": "5000",
			"x-ratelimit-remaining-requests-day": "3500",
		})
		const response = new Response(JSON.stringify({ data: [] }), { status: 200, headers })
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

		const usage = await fetchSambaNovaPlanUsage("test-api-key")

		expect(usage.minuteRequestLimit).toBe(100)
		expect(usage.minuteRequestsRemaining).toBe(60)
		expect(usage.minuteUsedPercent).toBe(40)
		expect(usage.dayRequestLimit).toBe(5000)
		expect(usage.dayRequestsRemaining).toBe(3500)
		expect(usage.dayUsedPercent).toBe(30)
		expect(typeof usage.fetchedAt).toBe("number")
	})

	it("handles missing rate-limit headers gracefully", async () => {
		const response = new Response(JSON.stringify({ data: [] }), { status: 200 })
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

		const usage = await fetchSambaNovaPlanUsage("test-api-key")

		expect(usage.minuteRequestLimit).toBeUndefined()
		expect(usage.minuteRequestsRemaining).toBeUndefined()
		expect(usage.minuteUsedPercent).toBeUndefined()
		expect(usage.dayRequestLimit).toBeUndefined()
		expect(usage.dayRequestsRemaining).toBeUndefined()
		expect(usage.dayUsedPercent).toBeUndefined()
		expect(typeof usage.fetchedAt).toBe("number")
	})

	it("clamps computed percent to 0–100", async () => {
		const headers = new Headers({
			"x-ratelimit-limit-requests": "100",
			"x-ratelimit-remaining-requests": "0",
			"x-ratelimit-limit-requests-day": "1000",
			"x-ratelimit-remaining-requests-day": "1000",
		})
		const response = new Response(JSON.stringify({ data: [] }), { status: 200, headers })
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

		const usage = await fetchSambaNovaPlanUsage("test-api-key")

		expect(usage.minuteUsedPercent).toBe(100)
		expect(usage.dayUsedPercent).toBe(0)
	})

	it("throws on 401 with a friendly error", async () => {
		const response = new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
			status: 401,
			statusText: "Unauthorized",
		})
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

		await expect(fetchSambaNovaPlanUsage("bad-key")).rejects.toThrow(/SambaNova API key is invalid or expired/)
	})

	it("throws on 429 with a rate limit error", async () => {
		const response = new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), {
			status: 429,
			statusText: "Too Many Requests",
		})
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

		await expect(fetchSambaNovaPlanUsage("test-key")).rejects.toThrow(/SambaNova rate limit exceeded/)
	})

	it("sends correct Authorization header", async () => {
		const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))
		vi.stubGlobal("fetch", mockFetch)

		await fetchSambaNovaPlanUsage("my-secret-key")

		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.sambanova.ai/v1/models",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer my-secret-key",
				}),
			}),
		)
	})

	it("handles partial rate-limit headers (only daily)", async () => {
		const headers = new Headers({
			"x-ratelimit-limit-requests-day": "10000",
			"x-ratelimit-remaining-requests-day": "2500",
		})
		const response = new Response(JSON.stringify({ data: [] }), { status: 200, headers })
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

		const usage = await fetchSambaNovaPlanUsage("test-api-key")

		expect(usage.minuteRequestLimit).toBeUndefined()
		expect(usage.dayRequestLimit).toBe(10000)
		expect(usage.dayRequestsRemaining).toBe(2500)
		expect(usage.dayUsedPercent).toBe(75)
	})
})

// npx vitest run src/integrations/qwen-code/__tests__/plan-usage.spec.ts

import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchQwenCodePlanUsage } from "../plan-usage"

// Mock fs/promises and os modules
vi.mock("node:fs", () => ({
	promises: {
		readFile: vi.fn(),
	},
}))

vi.mock("os", () => ({
	default: {
		homedir: vi.fn().mockReturnValue("/home/test"),
		platform: vi.fn().mockReturnValue("linux"),
		arch: vi.fn().mockReturnValue("x64"),
	},
	homedir: vi.fn().mockReturnValue("/home/test"),
	platform: vi.fn().mockReturnValue("linux"),
	arch: vi.fn().mockReturnValue("x64"),
}))

import { promises as fs } from "node:fs"

const mockReadFile = fs.readFile as unknown as ReturnType<typeof vi.fn>

const VALID_CREDS = JSON.stringify({
	access_token: "test-access-token",
	refresh_token: "test-refresh-token",
	token_type: "Bearer",
	expiry_date: Date.now() + 3600_000,
})

describe("fetchQwenCodePlanUsage()", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		mockReadFile.mockReset()
	})

	it("returns usage data from rate-limit headers", async () => {
		mockReadFile.mockResolvedValue(VALID_CREDS)

		const headers = new Headers({
			"x-ratelimit-limit-requests": "6000",
			"x-ratelimit-remaining-requests": "4500",
			"x-ratelimit-limit-requests-day": "45000",
			"x-ratelimit-remaining-requests-day": "30000",
		})
		const response = new Response(JSON.stringify({ data: [] }), { status: 200, headers })
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

		const usage = await fetchQwenCodePlanUsage()

		expect(usage.requestLimit).toBe(6000)
		expect(usage.requestsRemaining).toBe(4500)
		expect(usage.usedPercent).toBe(25)
		expect(usage.windowLabel).toBe("5h")
		expect(usage.secondaryRequestLimit).toBe(45000)
		expect(usage.secondaryRequestsRemaining).toBe(30000)
		expect(usage.secondaryWindowLabel).toBe("day")
		expect(typeof usage.fetchedAt).toBe("number")
	})

	it("handles missing rate-limit headers gracefully", async () => {
		mockReadFile.mockResolvedValue(VALID_CREDS)

		const response = new Response(JSON.stringify({ data: [] }), { status: 200 })
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

		const usage = await fetchQwenCodePlanUsage()

		expect(usage.requestLimit).toBeUndefined()
		expect(usage.requestsRemaining).toBeUndefined()
		expect(usage.usedPercent).toBeUndefined()
		expect(typeof usage.fetchedAt).toBe("number")
	})

	it("throws when credentials file cannot be read", async () => {
		mockReadFile.mockRejectedValue(new Error("ENOENT"))

		await expect(fetchQwenCodePlanUsage()).rejects.toThrow(/Failed to read Qwen OAuth credentials/)
	})

	it("throws when credentials do not contain access_token", async () => {
		mockReadFile.mockResolvedValue(JSON.stringify({ refresh_token: "only-refresh" }))

		await expect(fetchQwenCodePlanUsage()).rejects.toThrow(/Qwen OAuth credentials do not contain an access_token/)
	})

	it("throws when credentials file contains invalid JSON", async () => {
		mockReadFile.mockResolvedValue("not-json")

		await expect(fetchQwenCodePlanUsage()).rejects.toThrow(/Failed to parse Qwen OAuth credentials/)
	})

	it("throws on 401 with a friendly error", async () => {
		mockReadFile.mockResolvedValue(VALID_CREDS)

		const response = new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
			status: 401,
			statusText: "Unauthorized",
		})
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

		await expect(fetchQwenCodePlanUsage()).rejects.toThrow(/Qwen Code OAuth token is invalid or expired/)
	})

	it("uses the correct models endpoint with OAuth headers", async () => {
		mockReadFile.mockResolvedValue(VALID_CREDS)

		const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))
		vi.stubGlobal("fetch", mockFetch)

		await fetchQwenCodePlanUsage()

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("/models"),
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer test-access-token",
					"X-DashScope-AuthType": "qwen-oauth",
				}),
			}),
		)
	})

	it("supports a custom OAuth path", async () => {
		const customPath = "/custom/path/creds.json"
		mockReadFile.mockResolvedValue(VALID_CREDS)

		const response = new Response(JSON.stringify({ data: [] }), { status: 200 })
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

		await fetchQwenCodePlanUsage(customPath)

		// path.resolve may normalize the path on Windows (e.g. /custom -> C:\custom)
		expect(mockReadFile).toHaveBeenCalledTimes(1)
		const calledPath = mockReadFile.mock.calls[0][0] as string
		expect(calledPath).toContain("custom")
		expect(calledPath).toContain("creds.json")
	})

	it("uses resource_url from credentials when available", async () => {
		const credsWithResourceUrl = JSON.stringify({
			access_token: "test-token",
			resource_url: "https://coding.dashscope.aliyuncs.com/v1",
			expiry_date: Date.now() + 3600_000,
		})
		mockReadFile.mockResolvedValue(credsWithResourceUrl)

		const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))
		vi.stubGlobal("fetch", mockFetch)

		await fetchQwenCodePlanUsage()

		expect(mockFetch).toHaveBeenCalledWith("https://coding.dashscope.aliyuncs.com/v1/models", expect.anything())
	})

	it("handles partial rate-limit headers (only primary)", async () => {
		mockReadFile.mockResolvedValue(VALID_CREDS)

		const headers = new Headers({
			"x-ratelimit-limit-requests": "6000",
			"x-ratelimit-remaining-requests": "1200",
		})
		const response = new Response(JSON.stringify({ data: [] }), { status: 200, headers })
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))

		const usage = await fetchQwenCodePlanUsage()

		expect(usage.requestLimit).toBe(6000)
		expect(usage.requestsRemaining).toBe(1200)
		expect(usage.usedPercent).toBe(80)
		expect(usage.windowLabel).toBe("5h")
		expect(usage.secondaryRequestLimit).toBeUndefined()
	})
})

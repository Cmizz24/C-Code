// npx vitest run api/providers/fetchers/__tests__/requesty.spec.ts

import axios from "axios"

import { getRequestyModels, parseRequestyModel } from "../requesty"

vi.mock("axios", () => ({
	default: {
		get: vi.fn(),
	},
}))

const mockAxiosGet = vi.mocked(axios.get)

describe("Requesty model fetcher", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getRequestyModels", () => {
		it("fetches Requesty models with optional auth and avoids duplicating /v1 for trailing-slash base URLs", async () => {
			mockAxiosGet.mockResolvedValueOnce({
				data: {
					data: [
						{
							id: "coding/claude-sonnet-4-20250514",
							description: "Requesty Claude Sonnet 4",
							max_output_tokens: 8192,
							context_window: 200_000,
							supports_caching: true,
							supports_vision: true,
							supports_reasoning: true,
							input_price: "0.000003",
							output_price: "0.000015",
							caching_price: "0.00000375",
							cached_price: "0.0000003",
						},
						{
							id: "free/model",
							description: "Free model",
							context_window: 8192,
							input_price: 0,
							output_price: 0,
						},
						{
							id: "missing-context-window",
							max_output_tokens: 4096,
						},
					],
				},
			})

			const models = await getRequestyModels("https://router.requesty.ai/v1/", "requesty-key")

			expect(mockAxiosGet).toHaveBeenCalledWith("https://router.requesty.ai/v1/models", {
				headers: { Authorization: "Bearer requesty-key" },
			})
			expect(models["coding/claude-sonnet-4-20250514"]).toEqual({
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsPromptCache: true,
				supportsImages: true,
				supportsReasoningBudget: true,
				supportsReasoningEffort: false,
				inputPrice: 3,
				outputPrice: 15,
				description: "Requesty Claude Sonnet 4",
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
			})
			expect(models["free/model"]).toMatchObject({
				contextWindow: 8192,
				inputPrice: 0,
				outputPrice: 0,
			})
			expect(models["missing-context-window"]).toBeUndefined()
		})

		it("falls back to per-record validation when the response schema contains invalid records", async () => {
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
			mockAxiosGet.mockResolvedValueOnce({
				data: {
					data: [
						{
							id: "valid/model",
							context_window: 128_000,
						},
						{
							id: "invalid/context",
							context_window: "128000",
						},
					],
				},
			})

			const models = await getRequestyModels()

			expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Requesty models response is invalid"))
			expect(models["valid/model"]).toMatchObject({
				contextWindow: 128_000,
				supportsPromptCache: false,
				supportsImages: false,
			})
			expect(models["invalid/context"]).toBeUndefined()

			consoleErrorSpy.mockRestore()
		})
	})

	describe("parseRequestyModel", () => {
		it("marks retired models as deprecated", () => {
			vi.spyOn(Date, "now").mockReturnValue(new Date("2026-01-01T00:00:00Z").getTime())

			const parsed = parseRequestyModel({
				id: "retired/model",
				context_window: 4096,
				retires_at: "2025-01-01T00:00:00Z",
			})

			expect(parsed?.info.deprecated).toBe(true)

			vi.mocked(Date.now).mockRestore()
		})

		it("skips models without verified context windows", () => {
			expect(
				parseRequestyModel({
					id: "missing-context/model",
					max_output_tokens: 8192,
				}),
			).toBeUndefined()
		})
	})
})

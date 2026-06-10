// npx vitest run api/providers/fetchers/__tests__/unbound.spec.ts

import axios from "axios"

import { getUnboundModels, parseUnboundModel } from "../unbound"

vi.mock("axios", () => ({
	default: {
		get: vi.fn(),
	},
}))

const mockAxiosGet = vi.mocked(axios.get)

describe("Unbound model fetcher", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getUnboundModels", () => {
		it("fetches official /v1/models with optional auth and normalizes nested model metadata", async () => {
			mockAxiosGet.mockResolvedValueOnce({
				data: {
					data: [
						{
							id: "anthropic/claude-sonnet-4-20250514",
							description: "Unbound Claude Sonnet 4",
							pricing: {
								input_token_price: "3",
								output_token_price: 15,
								cache_write_price: "3.75",
								cache_read_price: "0.3",
							},
							parameters: {
								context_window: 200_000,
								max_tokens: 64_000,
								supports_prompt_caching: true,
								supports_images: true,
							},
						},
						{
							id: "missing/context-window",
							parameters: {
								max_tokens: 8192,
							},
						},
					],
				},
			})

			const models = await getUnboundModels("unbound-key")

			expect(mockAxiosGet).toHaveBeenCalledWith("https://api.getunbound.ai/v1/models", {
				headers: { Authorization: "Bearer unbound-key" },
			})
			expect(models["anthropic/claude-sonnet-4-20250514"]).toEqual({
				maxTokens: 64_000,
				contextWindow: 200_000,
				supportsPromptCache: true,
				supportsImages: true,
				inputPrice: 3,
				outputPrice: 15,
				description: "Unbound Claude Sonnet 4",
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
			})
			expect(models["missing/context-window"]).toBeUndefined()
		})

		it("omits Authorization for public model-list refreshes", async () => {
			mockAxiosGet.mockResolvedValueOnce({ data: { data: [] } })

			await getUnboundModels()

			expect(mockAxiosGet).toHaveBeenCalledWith("https://api.getunbound.ai/v1/models", { headers: {} })
		})
	})

	describe("parseUnboundModel", () => {
		it("parses per-million prices directly without multiplying them", () => {
			const parsed = parseUnboundModel({
				id: "unbound/price-test",
				description: "Per-million prices",
				pricing: {
					input_token_price: "0.5",
					output_token_price: "1.25",
					cache_write_price: 0,
					cache_read_price: "0.05",
				},
				parameters: {
					context_window: 32_000,
				},
			})

			expect(parsed?.info).toMatchObject({
				contextWindow: 32_000,
				inputPrice: 0.5,
				outputPrice: 1.25,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0.05,
			})
			expect(parsed?.info.maxTokens).toBeUndefined()
		})

		it("skips models without verified context windows instead of inventing fallbacks", () => {
			expect(
				parseUnboundModel({
					id: "unbound/no-context",
					parameters: {
						max_tokens: 8192,
					},
				}),
			).toBeUndefined()
		})
	})
})

// npx vitest run api/providers/fetchers/__tests__/static-provider-models.spec.ts

import axios from "axios"

import {
	getAnthropicModels,
	getBasetenModels,
	getDeepSeekModels,
	getFireworksModels,
	getGeminiModels,
	getMiniMaxModels,
	getMistralModels,
	getMoonshotModels,
	getOpenAiNativeModels,
	getSambaNovaModels,
	getXAIModels,
} from "../static-provider-models"

vi.mock("axios", () => ({
	default: {
		get: vi.fn(),
	},
}))

const mockAxiosGet = vi.mocked(axios.get)

describe("static provider model fetchers", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getAnthropicModels", () => {
		it("fetches paginated official /v1/models data and maps current capability fields", async () => {
			mockAxiosGet
				.mockResolvedValueOnce({
					data: {
						data: [
							{
								id: "claude-opus-4-7",
								display_name: "Claude Opus 4.7",
								max_input_tokens: 1_000_000,
								max_tokens: 128_000,
								capabilities: {
									image_input: { supported: true },
									thinking: { supported: true },
								},
							},
							{
								id: "claude-haiku-4-5-20251001",
								display_name: "Claude Haiku 4.5",
								max_input_tokens: 200_000,
								max_tokens: 64_000,
								capabilities: {
									image_input: { supported: true },
									thinking: { supported: true },
								},
							},
						],
						has_more: true,
						last_id: "claude-haiku-4-5-20251001",
					},
				})
				.mockResolvedValueOnce({
					data: {
						data: [
							{
								id: "claude-dynamic-model",
								display_name: "Claude Dynamic Model",
								max_input_tokens: 0,
								max_tokens: 0,
								capabilities: {
									image_input: { supported: false },
									thinking: { supported: false },
								},
							},
						],
						has_more: false,
						last_id: "claude-dynamic-model",
					},
				})

			const models = await getAnthropicModels("anthropic-key", "https://api.anthropic.com/v1")

			expect(mockAxiosGet).toHaveBeenNthCalledWith(1, "https://api.anthropic.com/v1/models", {
				headers: { "x-api-key": "anthropic-key", "anthropic-version": "2023-06-01" },
				params: { limit: 1000 },
			})
			expect(mockAxiosGet).toHaveBeenNthCalledWith(2, "https://api.anthropic.com/v1/models", {
				headers: { "x-api-key": "anthropic-key", "anthropic-version": "2023-06-01" },
				params: { limit: 1000, after_id: "claude-haiku-4-5-20251001" },
			})

			expect(models["claude-opus-4-7"]).toMatchObject({
				contextWindow: 1_000_000,
				maxTokens: 128_000,
				description: "Claude Opus 4.7",
				supportsImages: true,
				supportsPromptCache: true,
				supportsReasoningAdaptive: true,
				supportsReasoningEffort: ["disable", "low", "medium", "high", "xhigh"],
				adaptiveThinkingEffort: "medium",
				supportsTemperature: false,
				inputPrice: 5,
				outputPrice: 25,
			})
			expect(models["claude-opus-4-7"].supportsReasoningBudget).toBeUndefined()
			expect(models["claude-haiku-4-5-20251001"]).toMatchObject({
				contextWindow: 200_000,
				maxTokens: 64_000,
				description: "Claude Haiku 4.5",
				supportsImages: true,
				supportsPromptCache: true,
				supportsReasoningBudget: true,
				inputPrice: 1,
				outputPrice: 5,
			})
			expect(models["claude-dynamic-model"]).toMatchObject({
				contextWindow: 128_000,
				description: "Claude Dynamic Model",
				supportsImages: false,
				supportsPromptCache: false,
				supportsReasoningBudget: false,
			})
			expect(models["claude-dynamic-model"].maxTokens).toBeUndefined()
		})
	})

	describe("getXAIModels", () => {
		it("fetches official /v1/language-models data, aliases, modalities, pricing, and long-context tiers", async () => {
			mockAxiosGet.mockResolvedValueOnce({
				data: {
					models: [
						{
							id: "latest",
							aliases: ["grok-4.3-latest", "grok-latest"],
							input_modalities: ["text", "image"],
							output_modalities: ["text"],
							prompt_text_token_price: 12_500,
							cached_prompt_text_token_price: 2_000,
							prompt_image_token_price: 12_500,
							completion_text_token_price: 25_000,
							search_price: 0,
							prompt_text_token_price_long_context: 0,
							cached_prompt_text_token_price_long_context: 0,
							completion_text_token_price_long_context: 0,
							long_context_threshold: 0,
						},
						{
							id: "grok-420-reasoning",
							aliases: [],
							input_modalities: ["text"],
							output_modalities: ["text"],
							prompt_text_token_price: 20_000,
							cached_prompt_text_token_price: 2_000,
							prompt_image_token_price: 0,
							completion_text_token_price: 80_000,
							search_price: 250_000_000,
							prompt_text_token_price_long_context: 40_000,
							cached_prompt_text_token_price_long_context: 0,
							completion_text_token_price_long_context: 160_000,
							long_context_threshold: 128_000,
						},
					],
				},
			})

			const models = await getXAIModels("xai-key")

			expect(mockAxiosGet).toHaveBeenCalledWith("https://api.x.ai/v1/language-models", {
				headers: { Authorization: "Bearer xai-key" },
			})
			expect(models.latest).toMatchObject({
				contextWindow: 128_000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 1.25,
				outputPrice: 2.5,
				cacheReadsPrice: 0.2,
			})
			expect(models["grok-4.3-latest"]).toEqual(models.latest)
			expect(models["grok-latest"]).toEqual(models.latest)
			expect(models["grok-420-reasoning"]).toMatchObject({
				contextWindow: 128_000,
				supportsImages: false,
				supportsPromptCache: true,
				inputPrice: 2,
				outputPrice: 8,
				cacheReadsPrice: 0.2,
				longContextPricing: {
					thresholdTokens: 128_000,
					inputPriceMultiplier: 2,
					outputPriceMultiplier: 2,
				},
			})
		})
	})

	describe("getMistralModels", () => {
		it("maps the official bare-array /v1/models response", async () => {
			mockAxiosGet.mockResolvedValueOnce({
				data: [
					{
						id: "mistral-dynamic-model",
						description: "Dynamic Mistral model",
						max_context_length: 32_768,
						capabilities: {
							vision: true,
							function_calling: true,
						},
					},
				],
			})

			const models = await getMistralModels("mistral-key")

			expect(mockAxiosGet).toHaveBeenCalledWith("https://api.mistral.ai/v1/models", {
				headers: { Authorization: "Bearer mistral-key" },
			})
			expect(models["mistral-dynamic-model"]).toMatchObject({
				contextWindow: 32_768,
				description: "Dynamic Mistral model",
				supportsImages: true,
				supportsPromptCache: false,
			})
		})
	})

	describe("getOpenAiNativeModels", () => {
		it("maps official OpenAI-compatible /v1/models ids and preserves static fallback metadata", async () => {
			mockAxiosGet.mockResolvedValueOnce({
				data: {
					data: [{ id: "gpt-5.5" }, { id: "openai-dynamic-model" }],
				},
			})

			const models = await getOpenAiNativeModels("openai-key", "https://api.openai.com/v1")

			expect(mockAxiosGet).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
				headers: { Authorization: "Bearer openai-key" },
			})
			expect(models["gpt-5.5"]).toMatchObject({
				contextWindow: 1_050_000,
				maxTokens: 128_000,
				supportsPromptCache: true,
				supportsTemperature: false,
			})
			expect(models["openai-dynamic-model"]).toMatchObject({
				contextWindow: 128_000,
				supportsPromptCache: false,
			})
		})
	})

	describe("getDeepSeekModels", () => {
		it("maps official OpenAI-compatible /models ids", async () => {
			mockAxiosGet.mockResolvedValueOnce({
				data: {
					data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }, { id: "deepseek-dynamic-model" }],
				},
			})

			const models = await getDeepSeekModels("deepseek-key")

			expect(mockAxiosGet).toHaveBeenCalledWith("https://api.deepseek.com/models", {
				headers: { Authorization: "Bearer deepseek-key" },
			})
			expect(models["deepseek-v4-pro"]).toMatchObject({
				contextWindow: 1_000_000,
				maxTokens: 384_000,
				supportsPromptCache: true,
				supportsReasoningEffort: ["disable", "high", "xhigh"],
				reasoningEffort: "high",
				requiredReasoningEffort: true,
				preserveReasoning: true,
				inputPrice: 0.435,
				outputPrice: 0.87,
				cacheWritesPrice: 0.435,
				cacheReadsPrice: 0.003625,
			})
			expect(models["deepseek-v4-flash"]).toMatchObject({
				contextWindow: 1_000_000,
				maxTokens: 384_000,
				supportsPromptCache: true,
				supportsReasoningEffort: ["disable", "high", "xhigh"],
				reasoningEffort: "high",
				inputPrice: 0.14,
				outputPrice: 0.28,
				cacheWritesPrice: 0.14,
				cacheReadsPrice: 0.0028,
			})
			expect(models["deepseek-dynamic-model"]).toMatchObject({
				contextWindow: 128_000,
				supportsPromptCache: false,
			})
		})
	})

	describe("getGeminiModels", () => {
		it("maps the official paginated Gemini API /v1beta/models response and filters non-generation models", async () => {
			mockAxiosGet
				.mockResolvedValueOnce({
					data: {
						models: [
							{
								name: "models/gemini-3.1-pro-preview",
								displayName: "Gemini 3.1 Pro Preview",
								description: "Dynamic Gemini Pro description",
								inputTokenLimit: 1_048_576,
								outputTokenLimit: 65_536,
								supportedGenerationMethods: ["generateContent", "countTokens"],
								temperature: 1,
								maxTemperature: 2,
							},
							{
								name: "models/text-embedding-004",
								displayName: "Text Embedding 004",
								inputTokenLimit: 2_048,
								supportedGenerationMethods: ["embedContent"],
							},
						],
						nextPageToken: "next-page",
					},
				})
				.mockResolvedValueOnce({
					data: {
						models: [
							{
								name: "models/gemini-dynamic-model",
								displayName: "Gemini Dynamic Model",
								inputTokenLimit: 64_000,
								outputTokenLimit: 8_192,
								supportedGenerationMethods: ["generateContent"],
								temperature: 0.7,
							},
						],
					},
				})

			const models = await getGeminiModels("gemini-key")

			expect(mockAxiosGet).toHaveBeenNthCalledWith(1, "https://generativelanguage.googleapis.com/v1beta/models", {
				params: { key: "gemini-key", pageSize: 1000 },
			})
			expect(mockAxiosGet).toHaveBeenNthCalledWith(2, "https://generativelanguage.googleapis.com/v1beta/models", {
				params: { key: "gemini-key", pageSize: 1000, pageToken: "next-page" },
			})
			expect(models["gemini-3.1-pro-preview"]).toMatchObject({
				contextWindow: 1_048_576,
				maxTokens: 65_536,
				description: "Dynamic Gemini Pro description",
				supportsPromptCache: true,
				supportsReasoningEffort: ["low", "medium", "high"],
				inputPrice: 4,
				outputPrice: 18,
				supportsTemperature: true,
				defaultTemperature: 1,
			})
			expect(models["gemini-dynamic-model"]).toMatchObject({
				contextWindow: 64_000,
				maxTokens: 8_192,
				description: "Gemini Dynamic Model",
				supportsPromptCache: false,
				supportsTemperature: true,
				defaultTemperature: 0.7,
			})
			expect(models["text-embedding-004"]).toBeUndefined()
		})
	})

	describe("getMoonshotModels", () => {
		it("maps the official OpenAI-compatible /v1/models response with Moonshot capability fields", async () => {
			mockAxiosGet.mockResolvedValueOnce({
				data: {
					data: [
						{
							id: "kimi-k2-thinking",
							context_length: 262_144,
							supports_image_in: false,
							supports_reasoning: true,
						},
						{
							id: "kimi-dynamic-vision",
							context_length: 131_072,
							max_completion_tokens: 8_192,
							supports_image_in: true,
							supports_reasoning: false,
						},
					],
				},
			})

			const models = await getMoonshotModels("moonshot-key", "https://api.moonshot.cn/v1")

			expect(mockAxiosGet).toHaveBeenCalledWith("https://api.moonshot.cn/v1/models", {
				headers: { Authorization: "Bearer moonshot-key" },
			})
			expect(models["kimi-k2-thinking"]).toMatchObject({
				contextWindow: 262_144,
				maxTokens: 16_000,
				supportsImages: false,
				supportsPromptCache: true,
				preserveReasoning: true,
			})
			expect(models["kimi-dynamic-vision"]).toMatchObject({
				contextWindow: 131_072,
				maxTokens: 8_192,
				supportsImages: true,
				supportsPromptCache: false,
				preserveReasoning: false,
			})
		})
	})

	describe("getSambaNovaModels", () => {
		it("maps the official /v1/models response with token limits and pricing", async () => {
			mockAxiosGet.mockResolvedValueOnce({
				data: {
					data: [
						{
							id: "DeepSeek-R1",
							context_length: 32_768,
							max_completion_tokens: 16_384,
							pricing: { prompt: "0.00000500", completion: "0.00000700" },
						},
						{
							id: "SambaNova-Dynamic-Model",
							context_length: 64_000,
							max_completion_tokens: 12_000,
							pricing: { prompt: "0.00000050", completion: "0.00000100" },
						},
					],
				},
			})

			const models = await getSambaNovaModels("sambanova-key")

			expect(mockAxiosGet).toHaveBeenCalledWith("https://api.sambanova.ai/v1/models", {
				headers: { Authorization: "Bearer sambanova-key" },
			})
			expect(models["DeepSeek-R1"]).toMatchObject({
				contextWindow: 32_768,
				maxTokens: 16_384,
				supportsReasoningBudget: true,
				inputPrice: 5,
				outputPrice: 7,
			})
			expect(models["SambaNova-Dynamic-Model"]).toMatchObject({
				contextWindow: 64_000,
				maxTokens: 12_000,
				supportsPromptCache: false,
				inputPrice: 0.5,
				outputPrice: 1,
			})
		})
	})

	describe("getMiniMaxModels", () => {
		it("maps the official Anthropic-compatible /anthropic/v1/models response with X-Api-Key", async () => {
			mockAxiosGet.mockResolvedValueOnce({
				data: {
					data: [
						{
							id: "MiniMax-M2.7",
							display_name: "MiniMax M2.7",
							created_at: "2026-03-18T02:00:00Z",
							type: "model",
						},
						{
							id: "MiniMax-Dynamic-Model",
							display_name: "MiniMax Dynamic Model",
							type: "model",
						},
					],
					first_id: "MiniMax-M2.7",
					has_more: false,
					last_id: "MiniMax-Dynamic-Model",
				},
			})

			const models = await getMiniMaxModels("minimax-key", "https://api.minimax.io/v1")

			expect(mockAxiosGet).toHaveBeenCalledWith("https://api.minimax.io/anthropic/v1/models", {
				headers: { "X-Api-Key": "minimax-key" },
			})
			expect(models["MiniMax-M2.7"]).toMatchObject({
				contextWindow: 204_800,
				maxTokens: 16_384,
				supportsPromptCache: true,
			})
			expect(models["MiniMax-Dynamic-Model"]).toMatchObject({
				contextWindow: 128_000,
				description: "MiniMax Dynamic Model",
				supportsPromptCache: false,
			})
		})

		it("accepts a configured Anthropic-compatible MiniMax base URL without duplicating path segments", async () => {
			mockAxiosGet.mockResolvedValueOnce({
				data: {
					data: [{ id: "MiniMax-M2.5", display_name: "MiniMax M2.5", type: "model" }],
					has_more: false,
				},
			})

			await getMiniMaxModels("minimax-key", "https://api.minimax.io/anthropic")

			expect(mockAxiosGet).toHaveBeenCalledWith("https://api.minimax.io/anthropic/v1/models", {
				headers: { "X-Api-Key": "minimax-key" },
			})
		})
	})

	describe("getBasetenModels", () => {
		it("maps the verified Model APIs /v1/models response with a models array", async () => {
			mockAxiosGet.mockResolvedValueOnce({
				data: {
					models: [
						{
							id: "baseten/dynamic-model",
							name: "Baseten Dynamic Model",
							context_window: 256_000,
							max_output_tokens: 16_384,
						},
					],
				},
			})

			const models = await getBasetenModels("baseten-key")

			expect(mockAxiosGet).toHaveBeenCalledWith("https://inference.baseten.co/v1/models", {
				headers: { Authorization: "Bearer baseten-key" },
			})
			expect(models["baseten/dynamic-model"]).toMatchObject({
				contextWindow: 256_000,
				maxTokens: 16_384,
				description: "Baseten Dynamic Model",
				supportsPromptCache: false,
			})
		})
	})

	describe("getFireworksModels", () => {
		it("maps the official paginated /v1/accounts/fireworks/models response", async () => {
			mockAxiosGet
				.mockResolvedValueOnce({
					data: {
						models: [
							{
								name: "accounts/fireworks/models/deepseek-v3",
								displayName: "DeepSeek V3",
								contextLength: 128_000,
							},
						],
						nextPageToken: "next-page",
					},
				})
				.mockResolvedValueOnce({
					data: {
						models: [
							{
								name: "accounts/fireworks/models/fireworks-dynamic-model",
								description: "Fireworks Dynamic Model",
								maxContextLength: 64_000,
							},
						],
					},
				})

			const models = await getFireworksModels("fireworks-key")

			expect(mockAxiosGet).toHaveBeenNthCalledWith(1, "https://api.fireworks.ai/v1/accounts/fireworks/models", {
				headers: { Authorization: "Bearer fireworks-key" },
				params: { pageSize: 200 },
			})
			expect(mockAxiosGet).toHaveBeenNthCalledWith(2, "https://api.fireworks.ai/v1/accounts/fireworks/models", {
				headers: { Authorization: "Bearer fireworks-key" },
				params: { pageSize: 200, pageToken: "next-page" },
			})
			expect(models["accounts/fireworks/models/deepseek-v3"]).toMatchObject({
				contextWindow: 128_000,
				description: "DeepSeek V3",
			})
			expect(models["accounts/fireworks/models/fireworks-dynamic-model"]).toMatchObject({
				contextWindow: 64_000,
				description: "Fireworks Dynamic Model",
				supportsPromptCache: false,
			})
		})
	})
})

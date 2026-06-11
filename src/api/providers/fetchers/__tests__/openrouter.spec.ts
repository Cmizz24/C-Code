// npx vitest run api/providers/fetchers/__tests__/openrouter.spec.ts

import * as path from "path"

import { back as nockBack } from "nock"

import { getOpenRouterModelEndpoints, getOpenRouterModels, parseOpenRouterModel } from "../openrouter"

nockBack.fixtures = path.join(__dirname, "fixtures")
nockBack.setMode("lockdown")

describe("OpenRouter API", () => {
	describe("getOpenRouterModels", () => {
		it("fetches models and validates schema", async () => {
			const { nockDone } = await nockBack("openrouter-models.json")

			const models = await getOpenRouterModels()

			expect(models["anthropic/claude-3.7-sonnet"]).toEqual({
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsImageOutput: false,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: expect.any(String),
				supportsReasoningBudget: false,
				supportsReasoningEffort: false,
				supportedParameters: ["max_tokens", "temperature", "reasoning", "include_reasoning"],
			})

			expect(models["anthropic/claude-3.7-sonnet:thinking"]).toEqual({
				maxTokens: 128000,
				contextWindow: 200000,
				supportsImages: true,
				supportsImageOutput: false,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: expect.any(String),
				supportsReasoningBudget: true,
				requiredReasoningBudget: true,
				supportsReasoningEffort: true,
				supportedParameters: ["max_tokens", "temperature", "reasoning", "include_reasoning"],
			})

			expect(models["google/gemini-2.5-flash-preview-05-20"].maxTokens).toEqual(65535)

			const anthropicModels = Object.entries(models)
				.filter(([id, _]) => id.startsWith("anthropic/claude-3"))
				.map(([id, model]) => ({ id, maxTokens: model.maxTokens }))
				.sort(({ id: a }, { id: b }) => a.localeCompare(b))

			expect(anthropicModels).toEqual([
				{ id: "anthropic/claude-3-haiku", maxTokens: 4096 },
				{ id: "anthropic/claude-3-haiku:beta", maxTokens: 4096 },
				{ id: "anthropic/claude-3-opus", maxTokens: 4096 },
				{ id: "anthropic/claude-3-opus:beta", maxTokens: 4096 },
				{ id: "anthropic/claude-3-sonnet", maxTokens: 4096 },
				{ id: "anthropic/claude-3-sonnet:beta", maxTokens: 4096 },
				{ id: "anthropic/claude-3.5-haiku", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-haiku-20241022", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-haiku-20241022:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-haiku:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-sonnet", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-sonnet-20240620", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-sonnet-20240620:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-sonnet:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.7-sonnet", maxTokens: 8192 },
				{ id: "anthropic/claude-3.7-sonnet:beta", maxTokens: 128000 },
				{ id: "anthropic/claude-3.7-sonnet:thinking", maxTokens: 128000 },
			])

			nockDone()
		})

		it("separates chat and image-output OpenRouter model lists", async () => {
			const mockModelsResponse = {
				data: {
					data: [
						{
							id: "anthropic/claude-sonnet-4",
							name: "Claude Sonnet 4",
							description: "Text generation model",
							context_length: 200000,
							architecture: {
								input_modalities: ["text", "image"],
								output_modalities: ["text"],
							},
							top_provider: { max_completion_tokens: 8192 },
							pricing: {
								prompt: "0.000003",
								completion: "0.000015",
							},
							supported_parameters: ["max_tokens", "temperature"],
						},
						{
							id: "google/gemini-2.5-flash-image-preview",
							name: "Gemini 2.5 Flash Image Preview",
							description: "Google Gemini image generation model",
							context_length: 128000,
							architecture: {
								input_modalities: ["text", "image"],
								output_modalities: ["image"],
							},
							top_provider: { max_completion_tokens: 8192 },
							pricing: {
								prompt: "0.000003",
								completion: "0.000015",
							},
							supported_parameters: ["max_tokens", "temperature"],
						},
						{
							id: "google/imagen-4",
							name: "Imagen 4",
							description: "Google image generation model",
							context_length: 32000,
							architecture: {
								input_modalities: ["text"],
							},
							top_provider: { max_completion_tokens: 4096 },
							pricing: {
								prompt: "0.000001",
								completion: "0.000005",
							},
							supported_parameters: ["max_tokens"],
						},
					],
				},
			}

			const axios = await import("axios")
			const getSpy = vi.spyOn(axios.default, "get").mockResolvedValue(mockModelsResponse)

			const chatModels = await getOpenRouterModels({ baseUrl: "https://openrouter.test/api/v1" })
			const imageModels = await getOpenRouterModels({
				baseUrl: "https://openrouter.test/api/v1",
				modelType: "image",
			})

			expect(chatModels["anthropic/claude-sonnet-4"]).toBeDefined()
			expect(chatModels["google/gemini-2.5-flash-image-preview"]).toBeUndefined()
			expect(chatModels["google/imagen-4"]).toBeUndefined()
			expect(imageModels["anthropic/claude-sonnet-4"]).toBeUndefined()
			expect(imageModels["google/gemini-2.5-flash-image-preview"]).toMatchObject({
				contextWindow: 128000,
				supportsImages: true,
				supportsImageOutput: true,
			})
			expect(imageModels["google/imagen-4"]).toMatchObject({
				contextWindow: 32000,
				supportsImages: false,
				supportsImageOutput: false,
			})

			expect(getSpy).toHaveBeenCalledWith("https://openrouter.test/api/v1/models")
			expect(getSpy).toHaveBeenCalledTimes(2)
			getSpy.mockRestore()
		})

		it("uses Authorization for OpenRouter model discovery when an API key is provided", async () => {
			const axios = await import("axios")
			const getSpy = vi.spyOn(axios.default, "get").mockResolvedValue({ data: { data: [] } })

			await getOpenRouterModels({ baseUrl: "https://openrouter.test/api/v1", apiKey: "test-key" })

			expect(getSpy).toHaveBeenCalledWith("https://openrouter.test/api/v1/models", {
				headers: { Authorization: "Bearer test-key" },
			})
			getSpy.mockRestore()
		})
	})

	describe("getOpenRouterModelEndpoints", () => {
		it("fetches model endpoints and validates schema", async () => {
			const mockEndpointsResponse = {
				data: {
					data: {
						id: "google/gemini-2.5-pro-preview",
						name: "Gemini 2.5 Pro Preview",
						architecture: {
							input_modalities: ["text", "image"],
							output_modalities: ["text"],
						},
						endpoints: [
							{
								provider_name: "Google Vertex",
								tag: "google-vertex",
								context_length: 1048576,
								max_completion_tokens: 65535,
								pricing: {
									prompt: "0.00000125",
									completion: "0.00001",
									input_cache_write: "0.000001625",
									input_cache_read: "0.00000031",
								},
							},
							{
								provider_name: "Google AI Studio",
								tag: "google-ai-studio",
								context_length: 1048576,
								max_completion_tokens: 65536,
								pricing: {
									prompt: "0.00000125",
									completion: "0.00001",
									input_cache_write: "0.000001625",
									input_cache_read: "0.00000031",
								},
							},
						],
					},
				},
			}

			// Mock cached parent model data
			const mockCachedModels = {
				"google/gemini-2.5-pro-preview": {
					maxTokens: 65536,
					contextWindow: 1048576,
					supportsImages: true,
					supportsPromptCache: true,
					supportsReasoningBudget: true,
					inputPrice: 1.25,
					outputPrice: 10,
					cacheWritesPrice: 1.625,
					cacheReadsPrice: 0.31,
					supportsReasoningEffort: true,
					// Tool support is handled via metadata/tools at request time.
					supportedParameters: ["max_tokens", "temperature", "reasoning"],
				},
			} as Record<string, any>

			const axios = await import("axios")
			const getSpy = vi.spyOn(axios.default, "get").mockResolvedValue(mockEndpointsResponse)

			const endpoints = await getOpenRouterModelEndpoints("google/gemini-2.5-pro-preview")

			// Simulate what modelEndpointCache does - copy capabilities from parent
			const parentModel = mockCachedModels["google/gemini-2.5-pro-preview"]
			if (parentModel) {
				for (const key of Object.keys(endpoints)) {
					endpoints[key].supportsReasoningEffort = parentModel.supportsReasoningEffort
					endpoints[key].supportedParameters = parentModel.supportedParameters
				}
			}

			expect(endpoints).toEqual({
				"google-vertex": {
					maxTokens: 65535,
					contextWindow: 1048576,
					supportsImages: true,
					supportsImageOutput: false,
					supportsPromptCache: true,
					supportsReasoningBudget: true,
					inputPrice: 1.25,
					outputPrice: 10,
					cacheWritesPrice: 1.625,
					cacheReadsPrice: 0.31,
					description: undefined,
					supportsReasoningEffort: true,
					supportedParameters: ["max_tokens", "temperature", "reasoning"],
				},
				"google-ai-studio": {
					maxTokens: 65536,
					contextWindow: 1048576,
					supportsImages: true,
					supportsImageOutput: false,
					supportsPromptCache: true,
					supportsReasoningBudget: true,
					inputPrice: 1.25,
					outputPrice: 10,
					cacheWritesPrice: 1.625,
					cacheReadsPrice: 0.31,
					description: undefined,
					supportsReasoningEffort: true,
					supportedParameters: ["max_tokens", "temperature", "reasoning"],
				},
			})

			getSpy.mockRestore()
		})

		it("copies model-level capabilities from parent model to endpoint models", async () => {
			const mockEndpointsResponse = {
				data: {
					data: {
						id: "anthropic/claude-sonnet-4",
						name: "Claude Sonnet 4",
						description: "Latest Claude model",
						architecture: {
							input_modalities: ["text", "image"],
							output_modalities: ["text"],
						},
						endpoints: [
							{
								provider_name: "Anthropic",
								name: "Claude Sonnet 4",
								context_length: 200000,
								max_completion_tokens: 8192,
								pricing: {
									prompt: "0.000003",
									completion: "0.000015",
									input_cache_write: "0.00000375",
									input_cache_read: "0.0000003",
								},
							},
						],
					},
				},
			}

			// Mock cached parent model capabilities
			const mockCachedModels = {
				"anthropic/claude-sonnet-4": {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
					supportsReasoningBudget: true,
					inputPrice: 3,
					outputPrice: 15,
					cacheWritesPrice: 3.75,
					cacheReadsPrice: 0.3,
					supportsReasoningEffort: true,
					// Tool support is handled via metadata/tools at request time.
					supportedParameters: ["max_tokens", "temperature", "reasoning"],
				},
			} as Record<string, any>

			const axios = await import("axios")
			const getSpy = vi.spyOn(axios.default, "get").mockResolvedValue(mockEndpointsResponse)

			const endpoints = await getOpenRouterModelEndpoints("anthropic/claude-sonnet-4")

			// Simulate what modelEndpointCache does - copy capabilities from parent
			const parentModel = mockCachedModels["anthropic/claude-sonnet-4"]
			if (parentModel) {
				for (const key of Object.keys(endpoints)) {
					endpoints[key].supportsReasoningEffort = parentModel.supportsReasoningEffort
					endpoints[key].supportedParameters = parentModel.supportedParameters
				}
			}

			expect(endpoints["Anthropic"]).toEqual({
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsImageOutput: false,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: undefined,
				supportsReasoningBudget: true,
				supportsReasoningEffort: true,
				supportedParameters: ["max_tokens", "temperature", "reasoning"],
			})

			getSpy.mockRestore()
		})

		it("uses Authorization for OpenRouter endpoint discovery when an API key is provided", async () => {
			const axios = await import("axios")
			const getSpy = vi.spyOn(axios.default, "get").mockResolvedValue({ data: { data: { endpoints: [] } } })

			await getOpenRouterModelEndpoints("google/gemini-2.5-flash-image-preview", {
				baseUrl: "https://openrouter.test/api/v1",
				apiKey: "test-key",
			})

			expect(getSpy).toHaveBeenCalledWith(
				"https://openrouter.test/api/v1/models/google/gemini-2.5-flash-image-preview/endpoints",
				{ headers: { Authorization: "Bearer test-key" } },
			)
			getSpy.mockRestore()
		})
	})

	describe("parseOpenRouterModel", () => {
		it("sets claude-sonnet-4.6 model to Anthropic max tokens", () => {
			const mockModel = {
				name: "Claude Sonnet 4.6",
				description: "Test model",
				context_length: 200000,
				max_completion_tokens: 8192,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const result = parseOpenRouterModel({
				id: "anthropic/claude-sonnet-4.6",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 8192,
			})

			expect(result.maxTokens).toBe(64000)
			expect(result.contextWindow).toBe(200000)
		})

		it("sets horizon-alpha model to 32k max tokens", () => {
			const mockModel = {
				name: "Horizon Alpha",
				description: "Test model",
				context_length: 128000,
				max_completion_tokens: 128000,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const result = parseOpenRouterModel({
				id: "openrouter/horizon-alpha",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 128000,
			})

			expect(result.maxTokens).toBe(32768)
			expect(result.contextWindow).toBe(128000)
		})

		it("sets horizon-beta model to 32k max tokens", () => {
			const mockModel = {
				name: "Horizon Beta",
				description: "Test model",
				context_length: 128000,
				max_completion_tokens: 128000,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const result = parseOpenRouterModel({
				id: "openrouter/horizon-beta",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 128000,
			})

			expect(result.maxTokens).toBe(32768)
			expect(result.contextWindow).toBe(128000)
		})

		it("does not override max tokens for other models", () => {
			const mockModel = {
				name: "Other Model",
				description: "Test model",
				context_length: 128000,
				max_completion_tokens: 64000,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const result = parseOpenRouterModel({
				id: "openrouter/other-model",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 64000,
			})

			expect(result.maxTokens).toBe(64000)
			expect(result.contextWindow).toBe(128000)
		})

		it("does not invent max tokens when OpenRouter omits completion limits", () => {
			const mockModel = {
				name: "No Completion Limit Model",
				description: "Test model without max_completion_tokens",
				context_length: 128000,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const result = parseOpenRouterModel({
				id: "openrouter/no-completion-limit",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: undefined,
			})

			expect(result).not.toHaveProperty("maxTokens")
			expect(result.contextWindow).toBe(128000)
		})

		it("marks expired OpenRouter models as deprecated", () => {
			vi.spyOn(Date, "now").mockReturnValue(new Date("2026-01-01T00:00:00Z").getTime())
			const mockModel = {
				name: "Expired Model",
				description: "Test expired model",
				context_length: 128000,
				max_completion_tokens: 8192,
				expiration_date: "2025-01-01T00:00:00Z",
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const result = parseOpenRouterModel({
				id: "openrouter/expired-model",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 8192,
			})

			expect(result.deprecated).toBe(true)

			vi.mocked(Date.now).mockRestore()
		})

		it("marks image-output support when parsing model metadata", () => {
			const mockImageModel = {
				name: "Image Model",
				description: "Test image generation model",
				context_length: 128000,
				max_completion_tokens: 64000,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const mockTextModel = {
				name: "Text Model",
				description: "Test text generation model",
				context_length: 128000,
				max_completion_tokens: 64000,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const textResult = parseOpenRouterModel({
				id: "test/text-model",
				model: mockTextModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 64000,
			})

			const imageResult = parseOpenRouterModel({
				id: "test/image-model",
				model: mockImageModel,
				inputModality: ["text"],
				outputModality: ["image"],
				maxTokens: 64000,
			})

			expect(textResult.maxTokens).toBe(64000)
			expect(textResult.supportsImageOutput).toBe(false)
			expect(imageResult.maxTokens).toBe(64000)
			expect(imageResult.supportsImageOutput).toBe(true)
		})

		it("treats supportedParameters containing tools as allowed", () => {
			const mockModel = {
				name: "Tools Model",
				description: "Model with native tool support",
				context_length: 128000,
				max_completion_tokens: 8192,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const resultWithTools = parseOpenRouterModel({
				id: "test/tools-model",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 8192,
				supportedParameters: ["tools", "max_tokens", "temperature"],
			})

			expect(resultWithTools.supportedParameters).toContain("max_tokens")
		})

		it("treats supportedParameters without tools as allowed", () => {
			const mockModel = {
				name: "No Tools Model",
				description: "Model without native tool support",
				context_length: 128000,
				max_completion_tokens: 8192,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const resultWithoutTools = parseOpenRouterModel({
				id: "test/no-tools-model",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 8192,
				supportedParameters: ["max_tokens", "temperature"],
			})

			expect(resultWithoutTools.supportedParameters).toContain("max_tokens")
		})
	})
})

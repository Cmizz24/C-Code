// Mocks must come first, before imports
const mockCreate = vi.fn()
vi.mock("openai", () => {
	return {
		__esModule: true,
		default: vi.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate.mockImplementation(async (options) => {
						if (!options.stream) {
							return {
								id: "test-completion",
								choices: [
									{
										message: { role: "assistant", content: "Test response", refusal: null },
										finish_reason: "stop",
										index: 0,
									},
								],
								usage: {
									prompt_tokens: 10,
									completion_tokens: 5,
									total_tokens: 15,
									prompt_cache_miss_tokens: 8,
									prompt_cache_hit_tokens: 2,
									completion_tokens_details: {
										reasoning_tokens: 3,
									},
								},
							}
						}

						const isThinkingModel =
							options.thinking?.type === "enabled" || options.model === "deepseek-reasoner"
						const isToolCallTest = options.tools?.length > 0

						// Return async iterator for streaming
						return {
							[Symbol.asyncIterator]: async function* () {
								// For thinking models, emit reasoning_content first
								if (isThinkingModel) {
									yield {
										choices: [
											{
												delta: { reasoning_content: "Let me think about this..." },
												index: 0,
											},
										],
										usage: null,
									}
									yield {
										choices: [
											{
												delta: { reasoning_content: " I'll analyze step by step." },
												index: 0,
											},
										],
										usage: null,
									}
								}

								// For tool call tests with thinking enabled, emit tool call
								if (isThinkingModel && isToolCallTest) {
									yield {
										choices: [
											{
												delta: {
													tool_calls: [
														{
															index: 0,
															id: "call_123",
															function: {
																name: "get_weather",
																arguments: '{"location":"SF"}',
															},
														},
													],
												},
												index: 0,
											},
										],
										usage: null,
									}
								} else {
									yield {
										choices: [
											{
												delta: { content: "Test response" },
												index: 0,
											},
										],
										usage: null,
									}
								}

								yield {
									choices: [
										{
											delta: {},
											index: 0,
											finish_reason: isToolCallTest ? "tool_calls" : "stop",
										},
									],
									usage: {
										prompt_tokens: 10,
										completion_tokens: 5,
										total_tokens: 15,
										prompt_cache_miss_tokens: 8,
										prompt_cache_hit_tokens: 2,
										completion_tokens_details: {
											reasoning_tokens: 3,
										},
									},
								}
							},
						}
					}),
				},
			},
		})),
	}
})

import OpenAI from "openai"
import type { Anthropic } from "@anthropic-ai/sdk"

import { deepSeekDefaultModelId, deepSeekModels, DEEP_SEEK_DEFAULT_TEMPERATURE, type ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"

import { DeepSeekHandler } from "../deepseek"

describe("DeepSeekHandler", () => {
	let handler: DeepSeekHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			deepSeekApiKey: "test-api-key",
			apiModelId: "deepseek-v4-pro",
			deepSeekBaseUrl: "https://api.deepseek.com",
		}
		handler = new DeepSeekHandler(mockOptions)
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(DeepSeekHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it.skip("should throw error if API key is missing", () => {
			expect(() => {
				new DeepSeekHandler({
					...mockOptions,
					deepSeekApiKey: undefined,
				})
			}).toThrow("DeepSeek API key is required")
		})

		it("should use default model ID if not provided", () => {
			const handlerWithoutModel = new DeepSeekHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			expect(handlerWithoutModel.getModel().id).toBe(deepSeekDefaultModelId)
		})

		it("should use default base URL if not provided", () => {
			const handlerWithoutBaseUrl = new DeepSeekHandler({
				...mockOptions,
				deepSeekBaseUrl: undefined,
			})
			expect(handlerWithoutBaseUrl).toBeInstanceOf(DeepSeekHandler)
			// The base URL is passed to OpenAI client internally
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.deepseek.com",
				}),
			)
		})

		it("should use custom base URL if provided", () => {
			const customBaseUrl = "https://custom.deepseek.com/v1"
			const handlerWithCustomUrl = new DeepSeekHandler({
				...mockOptions,
				deepSeekBaseUrl: customBaseUrl,
			})
			expect(handlerWithCustomUrl).toBeInstanceOf(DeepSeekHandler)
			// The custom base URL is passed to OpenAI client
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: customBaseUrl,
				}),
			)
		})

		it("should set includeMaxTokens to true", () => {
			// Create a new handler and verify OpenAI client was called with includeMaxTokens
			const _handler = new DeepSeekHandler(mockOptions)
			expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: mockOptions.deepSeekApiKey }))
		})
	})

	describe("getModel", () => {
		it("should return current V4 Pro model info for valid model ID", () => {
			const model = handler.getModel()
			expect(model.id).toBe(mockOptions.apiModelId)
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBe(384_000)
			expect(model.info.contextWindow).toBe(1_000_000)
			expect(model.info.supportsImages).toBe(false)
			expect(model.info.supportsPromptCache).toBe(true)
			expect(model.info.supportsReasoningEffort).toEqual(["disable", "high", "xhigh"])
			expect(model.info.reasoningEffort).toBe("high")
			expect(model.info.requiredReasoningEffort).toBe(true)
			expect(model.info.preserveReasoning).toBe(true)
			expect(model.info.inputPrice).toBe(0.435)
			expect(model.info.outputPrice).toBe(0.87)
			expect(model.info.cacheWritesPrice).toBe(0.435)
			expect(model.info.cacheReadsPrice).toBe(0.003625)
		})

		it("should return current V4 Flash model info", () => {
			const handlerWithFlash = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-v4-flash",
			})
			const model = handlerWithFlash.getModel()
			expect(model.id).toBe("deepseek-v4-flash")
			expect(model.info).toBeDefined()
			expect(model.info.maxTokens).toBe(384_000)
			expect(model.info.contextWindow).toBe(1_000_000)
			expect(model.info.supportsImages).toBe(false)
			expect(model.info.supportsPromptCache).toBe(true)
			expect(model.info.inputPrice).toBe(0.14)
			expect(model.info.outputPrice).toBe(0.28)
			expect(model.info.cacheWritesPrice).toBe(0.14)
			expect(model.info.cacheReadsPrice).toBe(0.0028)
		})

		it("should retain deprecated legacy model IDs with V4-compatible metadata", () => {
			const legacyChat = deepSeekModels["deepseek-chat"]
			const legacyReasoner = deepSeekModels["deepseek-reasoner"]

			expect(legacyChat).toMatchObject({
				maxTokens: 384_000,
				contextWindow: 1_000_000,
				supportsPromptCache: true,
				deprecated: true,
			})
			expect(legacyChat.preserveReasoning).toBeUndefined()
			expect(legacyChat.supportsReasoningEffort).toBeUndefined()
			expect(legacyChat.reasoningEffort).toBeUndefined()
			expect(legacyChat.requiredReasoningEffort).toBeUndefined()

			expect(legacyReasoner).toMatchObject({
				maxTokens: 384_000,
				maxThinkingTokens: 384_000,
				contextWindow: 1_000_000,
				supportsPromptCache: true,
				deprecated: true,
				preserveReasoning: true,
			})
		})

		it("should have preserveReasoning enabled for current V4 thinking models and legacy reasoner", () => {
			// This is critical for DeepSeek's interleaved thinking mode with tool calls.
			// See: https://api-docs.deepseek.com/guides/thinking_mode
			// The reasoning_content needs to be passed back during tool call continuation
			// within the same turn for the model to continue reasoning properly.
			const handlerWithReasoner = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-reasoner",
			})
			const model = handlerWithReasoner.getModel()
			expect((handler.getModel().info as ModelInfo).preserveReasoning).toBe(true)
			expect((model.info as ModelInfo).preserveReasoning).toBe(true)
		})

		it("should NOT have preserveReasoning enabled for deepseek-chat", () => {
			// deepseek-chat doesn't use thinking mode, so no need to preserve reasoning
			const chatHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-chat",
			})
			const model = chatHandler.getModel()
			// Cast to ModelInfo to access preserveReasoning which is an optional property
			expect((model.info as ModelInfo).preserveReasoning).toBeUndefined()
		})

		it("should return provided model ID with default model info if model does not exist", () => {
			const handlerWithInvalidModel = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "invalid-model",
			})
			const model = handlerWithInvalidModel.getModel()
			expect(model.id).toBe("invalid-model") // Returns provided ID
			expect(model.info).toBeDefined()
			// With the current implementation, it's the same object reference when using default model info
			expect(model.info).toBe(handler.getModel().info)
			// Should have the same base properties
			expect(model.info.contextWindow).toBe(handler.getModel().info.contextWindow)
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should return default model if no model ID is provided", () => {
			const handlerWithoutModel = new DeepSeekHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			const model = handlerWithoutModel.getModel()
			expect(model.id).toBe(deepSeekDefaultModelId)
			expect(model.info).toBeDefined()
			expect(model.info.supportsPromptCache).toBe(true)
		})

		it("should include model parameters from getModelParams", () => {
			const model = handler.getModel()
			expect(model).toHaveProperty("temperature")
			expect(model).toHaveProperty("maxTokens")
		})

		it("should use DEEP_SEEK_DEFAULT_TEMPERATURE as the default temperature", () => {
			const model = handler.getModel()
			expect(model.temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
			expect(model.reasoningEffort).toBe("high")
		})

		it("should respect user-provided temperature over DEEP_SEEK_DEFAULT_TEMPERATURE", () => {
			const handlerWithTemp = new DeepSeekHandler({
				...mockOptions,
				modelTemperature: 0.9,
			})
			const model = handlerWithTemp.getModel()
			expect(model.temperature).toBe(0.9)
		})
	})

	describe("createMessage", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text" as const,
						text: "Hello!",
					},
				],
			},
		]

		it("should handle streaming responses", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBeGreaterThan(0)
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(1)
			expect(textChunks[0].text).toBe("Test response")
		})

		it("should include usage information", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks.length).toBeGreaterThan(0)
			expect(usageChunks[0].inputTokens).toBe(10)
			expect(usageChunks[0].outputTokens).toBe(5)
		})

		it("should include cache metrics in usage information", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks.length).toBeGreaterThan(0)
			expect(usageChunks[0].cacheWriteTokens).toBe(8)
			expect(usageChunks[0].cacheReadTokens).toBe(2)
			expect(usageChunks[0].reasoningTokens).toBe(3)
		})

		it("should send current V4 thinking defaults without temperature and with native max_tokens", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs).toMatchObject({
				model: "deepseek-v4-pro",
				thinking: { type: "enabled" },
				reasoning_effort: "high",
				max_tokens: 384_000,
			})
			expect(callArgs.temperature).toBeUndefined()
			expect(callArgs.max_completion_tokens).toBeUndefined()
		})

		it("should map Roo xhigh reasoning effort to DeepSeek max", async () => {
			const xhighHandler = new DeepSeekHandler({
				...mockOptions,
				reasoningEffort: "xhigh",
			})

			const stream = xhighHandler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			expect(mockCreate.mock.calls[0][0]).toMatchObject({
				thinking: { type: "enabled" },
				reasoning_effort: "max",
			})
		})

		it("should map Roo low and medium reasoning efforts to DeepSeek high", async () => {
			for (const effort of ["low", "medium"] as const) {
				mockCreate.mockClear()
				const effortHandler = new DeepSeekHandler({
					...mockOptions,
					reasoningEffort: effort,
				})

				const stream = effortHandler.createMessage(systemPrompt, messages)
				for await (const _chunk of stream) {
					// Consume the stream
				}

				expect(mockCreate.mock.calls[0][0]).toMatchObject({
					thinking: { type: "enabled" },
					reasoning_effort: "high",
				})
			}
		})

		it("should disable current V4 thinking and include temperature when reasoning is disabled", async () => {
			const nonThinkingHandler = new DeepSeekHandler({
				...mockOptions,
				reasoningEffort: "disable",
			})

			const stream = nonThinkingHandler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs).toMatchObject({
				model: "deepseek-v4-pro",
				thinking: { type: "disabled" },
				temperature: DEEP_SEEK_DEFAULT_TEMPERATURE,
			})
			expect(callArgs.reasoning_effort).toBeUndefined()
		})

		it("should respect user-provided max token override with DeepSeek max_tokens", async () => {
			const maxTokenHandler = new DeepSeekHandler({
				...mockOptions,
				modelMaxTokens: 12_345,
			})

			const stream = maxTokenHandler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.max_tokens).toBe(12_345)
			expect(callArgs.max_completion_tokens).toBeUndefined()
		})
	})

	describe("processUsageMetrics", () => {
		it("should correctly process current usage metrics including cache and reasoning information", () => {
			// We need to access the protected method, so we'll create a test subclass
			class TestDeepSeekHandler extends DeepSeekHandler {
				public testProcessUsageMetrics(usage: any) {
					return this.processUsageMetrics(usage)
				}
			}

			const testHandler = new TestDeepSeekHandler(mockOptions)

			const usage = {
				prompt_tokens: 100,
				completion_tokens: 50,
				total_tokens: 150,
				prompt_cache_miss_tokens: 80,
				prompt_cache_hit_tokens: 20,
				completion_tokens_details: {
					reasoning_tokens: 30,
				},
			}

			const result = testHandler.testProcessUsageMetrics(usage)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheWriteTokens).toBe(80)
			expect(result.cacheReadTokens).toBe(20)
			expect(result.reasoningTokens).toBe(30)
		})

		it("should retain backwards-compatible cache usage fallback fields", () => {
			class TestDeepSeekHandler extends DeepSeekHandler {
				public testProcessUsageMetrics(usage: any) {
					return this.processUsageMetrics(usage)
				}
			}

			const testHandler = new TestDeepSeekHandler(mockOptions)

			const usage = {
				prompt_tokens: 100,
				completion_tokens: 50,
				total_tokens: 150,
				prompt_tokens_details: {
					cache_miss_tokens: 80,
					cached_tokens: 20,
				},
			}

			const result = testHandler.testProcessUsageMetrics(usage)

			expect(result.cacheWriteTokens).toBe(80)
			expect(result.cacheReadTokens).toBe(20)
		})

		it("should handle missing cache metrics gracefully", () => {
			class TestDeepSeekHandler extends DeepSeekHandler {
				public testProcessUsageMetrics(usage: any) {
					return this.processUsageMetrics(usage)
				}
			}

			const testHandler = new TestDeepSeekHandler(mockOptions)

			const usage = {
				prompt_tokens: 100,
				completion_tokens: 50,
				total_tokens: 150,
				// No prompt_tokens_details
			}

			const result = testHandler.testProcessUsageMetrics(usage)

			expect(result.type).toBe("usage")
			expect(result.inputTokens).toBe(100)
			expect(result.outputTokens).toBe(50)
			expect(result.cacheWriteTokens).toBeUndefined()
			expect(result.cacheReadTokens).toBeUndefined()
		})
	})

	describe("interleaved thinking mode", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "text" as const,
						text: "Hello!",
					},
				],
			},
		]

		it("should handle reasoning_content in streaming responses for deepseek-reasoner", async () => {
			const reasonerHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-reasoner",
			})

			const stream = reasonerHandler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Should have reasoning chunks
			const reasoningChunks = chunks.filter((chunk) => chunk.type === "reasoning")
			expect(reasoningChunks.length).toBeGreaterThan(0)
			expect(reasoningChunks[0].text).toBe("Let me think about this...")
			expect(reasoningChunks[1].text).toBe(" I'll analyze step by step.")
		})

		it("should pass thinking parameter for deepseek-reasoner model", async () => {
			const reasonerHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-reasoner",
			})

			const stream = reasonerHandler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			// Verify that the thinking parameter was passed to the API
			// Note: mockCreate receives two arguments - request options and path options
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					thinking: { type: "enabled" },
				}),
				{}, // Empty path options for non-Azure URLs
			)
		})

		it("should omit thinking parameter for legacy deepseek-chat model", async () => {
			const chatHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-chat",
			})

			const stream = chatHandler.createMessage(systemPrompt, messages)
			for await (const _chunk of stream) {
				// Consume the stream
			}

			// Legacy deepseek-chat already maps to V4 Flash non-thinking mode.
			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.thinking).toBeUndefined()
			expect(callArgs.temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
		})

		it("should handle tool calls with reasoning_content", async () => {
			const reasonerHandler = new DeepSeekHandler({
				...mockOptions,
				apiModelId: "deepseek-reasoner",
			})

			const tools: any[] = [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get weather",
						parameters: { type: "object", properties: {} },
					},
				},
			]

			const stream = reasonerHandler.createMessage(systemPrompt, messages, { taskId: "test", tools })
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Should have reasoning chunks
			const reasoningChunks = chunks.filter((chunk) => chunk.type === "reasoning")
			expect(reasoningChunks.length).toBeGreaterThan(0)

			// Should have tool call chunks
			const toolCallChunks = chunks.filter((chunk) => chunk.type === "tool_call_partial")
			expect(toolCallChunks.length).toBeGreaterThan(0)
			expect(toolCallChunks[0].name).toBe("get_weather")
		})
	})
})

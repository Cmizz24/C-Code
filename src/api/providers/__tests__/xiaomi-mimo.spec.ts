// Mocks must come first, before imports
const mockCreate = vi.fn()
vi.mock("openai", () => {
	return {
		__esModule: true,
		default: vi.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate.mockImplementation(async (options) => {
						const isToolCallTest = options.tools?.length > 0

						return {
							[Symbol.asyncIterator]: async function* () {
								if (options.thinking?.type === "enabled") {
									yield {
										choices: [
											{
												delta: { reasoning_content: "MiMo reasoning" },
												index: 0,
											},
										],
										usage: null,
									}
								}

								if (isToolCallTest) {
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
												delta: { content: "MiMo response" },
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
										cache_creation_input_tokens: 4,
										prompt_tokens_details: {
											cached_tokens: 2,
										},
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

import { xiaomiMiMoDefaultModelId, xiaomiMiMoModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"

import { XiaomiMiMoHandler } from "../xiaomi-mimo"

describe("XiaomiMiMoHandler", () => {
	let handler: XiaomiMiMoHandler
	let mockOptions: ApiHandlerOptions

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

	beforeEach(() => {
		mockOptions = {
			xiaomiMiMoApiKey: "test-api-key",
			apiModelId: "mimo-v2.5-pro",
			xiaomiMiMoBaseUrl: "https://api.xiaomimimo.com/v1",
		}
		handler = new XiaomiMiMoHandler(mockOptions)
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(XiaomiMiMoHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it("should use the Xiaomi MiMo default model ID if not provided", () => {
			const handlerWithoutModel = new XiaomiMiMoHandler({
				...mockOptions,
				apiModelId: undefined,
			})

			expect(handlerWithoutModel.getModel().id).toBe(xiaomiMiMoDefaultModelId)
		})

		it("should use the default Xiaomi MiMo base URL if not provided", () => {
			const handlerWithoutBaseUrl = new XiaomiMiMoHandler({
				...mockOptions,
				xiaomiMiMoBaseUrl: undefined,
			})

			expect(handlerWithoutBaseUrl).toBeInstanceOf(XiaomiMiMoHandler)
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "https://api.xiaomimimo.com/v1",
				}),
			)
		})

		it("should use the official Token Plan base URL when configured", () => {
			const tokenPlanBaseUrl = "https://token-plan-cn.xiaomimimo.com/v1"
			const handlerWithTokenPlanUrl = new XiaomiMiMoHandler({
				...mockOptions,
				xiaomiMiMoBaseUrl: tokenPlanBaseUrl,
			})

			expect(handlerWithTokenPlanUrl).toBeInstanceOf(XiaomiMiMoHandler)
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: tokenPlanBaseUrl,
				}),
			)
		})

		it("should map the Xiaomi MiMo API key to the OpenAI client API key", () => {
			new XiaomiMiMoHandler(mockOptions)

			expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: mockOptions.xiaomiMiMoApiKey }))
		})
	})

	describe("getModel", () => {
		it("should return Xiaomi MiMo default model metadata", () => {
			const defaultHandler = new XiaomiMiMoHandler({
				...mockOptions,
				apiModelId: undefined,
			})
			const model = defaultHandler.getModel()

			expect(model.id).toBe(xiaomiMiMoDefaultModelId)
			expect(model.info).toEqual(xiaomiMiMoModels[xiaomiMiMoDefaultModelId])
			expect(model.info.contextWindow).toBe(1_000_000)
			expect(model.info.maxTokens).toBe(128_000)
			expect(model.info.supportsImages).toBe(false)
			expect(model.info.supportsPromptCache).toBe(true)
			expect(model.info.supportsReasoningBinary).toBe(true)
			expect(model.info.inputPrice).toBe(0.435)
			expect(model.info.outputPrice).toBe(0.87)
			expect(model.info.cacheWritesPrice).toBe(0)
			expect(model.info.cacheReadsPrice).toBe(0.0036)
		})

		it("should expose official Xiaomi MiMo pricing metadata", () => {
			expect(xiaomiMiMoModels["mimo-v2.5-pro"]).toMatchObject({
				inputPrice: 0.435,
				outputPrice: 0.87,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0.0036,
				supportsPromptCache: true,
			})
			expect(xiaomiMiMoModels["mimo-v2.5"]).toMatchObject({
				inputPrice: 0.14,
				outputPrice: 0.28,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0.0028,
				supportsPromptCache: true,
			})
			expect(xiaomiMiMoModels["mimo-v2-pro"]).toMatchObject({
				inputPrice: 1,
				outputPrice: 3,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0.2,
				supportsPromptCache: true,
				longContextPricing: {
					thresholdTokens: 256_000,
					inputPriceMultiplier: 2,
					outputPriceMultiplier: 2,
					cacheReadsPriceMultiplier: 2,
				},
			})
			expect(xiaomiMiMoModels["mimo-v2-omni"]).toMatchObject({
				inputPrice: 0.4,
				outputPrice: 2,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0.08,
				supportsPromptCache: true,
			})
			expect(xiaomiMiMoModels["mimo-v2-flash"]).toMatchObject({
				inputPrice: 0.1,
				outputPrice: 0.3,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0.01,
				supportsPromptCache: true,
			})
		})

		it("should return 256K context metadata for the Omni model", () => {
			const omniHandler = new XiaomiMiMoHandler({
				...mockOptions,
				apiModelId: "mimo-v2-omni",
			})
			const model = omniHandler.getModel()

			expect(model.id).toBe("mimo-v2-omni")
			expect(model.info).toEqual(xiaomiMiMoModels["mimo-v2-omni"])
			expect(model.info.contextWindow).toBe(256_000)
			expect(model.info.maxTokens).toBe(128_000)
			expect(model.info.supportsReasoningBinary).toBe(true)
		})

		it("should return 64K output metadata for the Flash model", () => {
			const flashHandler = new XiaomiMiMoHandler({
				...mockOptions,
				apiModelId: "mimo-v2-flash",
			})
			const model = flashHandler.getModel()

			expect(model.id).toBe("mimo-v2-flash")
			expect(model.info).toEqual(xiaomiMiMoModels["mimo-v2-flash"])
			expect(model.info.contextWindow).toBe(256_000)
			expect(model.info.maxTokens).toBe(64_000)
			expect(model.info.supportsReasoningBinary).toBe(true)
		})

		it("should retain provided model ID with default model info if the model does not exist", () => {
			const handlerWithInvalidModel = new XiaomiMiMoHandler({
				...mockOptions,
				apiModelId: "invalid-model",
			})
			const model = handlerWithInvalidModel.getModel()

			expect(model.id).toBe("invalid-model")
			expect(model.info).toBe(xiaomiMiMoModels[xiaomiMiMoDefaultModelId])
		})

		it("should default to zero temperature and respect user-provided temperature", () => {
			expect(handler.getModel().temperature).toBe(0)

			const handlerWithTemperature = new XiaomiMiMoHandler({
				...mockOptions,
				modelTemperature: 0.7,
			})

			expect(handlerWithTemperature.getModel().temperature).toBe(0.7)
		})
	})

	describe("createMessage", () => {
		it("should send OpenAI-compatible streaming request with Xiaomi MiMo thinking enabled", async () => {
			const reasoningHandler = new XiaomiMiMoHandler({
				...mockOptions,
				enableReasoningEffort: true,
			})

			for await (const _chunk of reasoningHandler.createMessage(systemPrompt, messages)) {
				// Consume stream
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs).toMatchObject({
				model: "mimo-v2.5-pro",
				temperature: 0,
				stream: true,
				stream_options: { include_usage: true },
				thinking: { type: "enabled" },
				parallel_tool_calls: true,
				max_completion_tokens: 128_000,
			})
			expect(callArgs.messages[0]).toEqual({ role: "system", content: systemPrompt })
			expect(callArgs.max_tokens).toBeUndefined()
		})

		it("should send Xiaomi MiMo thinking disabled by default", async () => {
			for await (const _chunk of handler.createMessage(systemPrompt, messages)) {
				// Consume stream
			}

			expect(mockCreate.mock.calls[0][0]).toMatchObject({
				thinking: { type: "disabled" },
			})
		})

		it("should respect user-provided max token override with max_completion_tokens", async () => {
			const maxTokenHandler = new XiaomiMiMoHandler({
				...mockOptions,
				modelMaxTokens: 12_345,
			})

			for await (const _chunk of maxTokenHandler.createMessage(systemPrompt, messages)) {
				// Consume stream
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.max_completion_tokens).toBe(12_345)
			expect(callArgs.max_tokens).toBeUndefined()
		})

		it("should handle text, reasoning_content, and usage chunks", async () => {
			const reasoningHandler = new XiaomiMiMoHandler({
				...mockOptions,
				enableReasoningEffort: true,
			})
			const chunks: any[] = []

			for await (const chunk of reasoningHandler.createMessage(systemPrompt, messages)) {
				chunks.push(chunk)
			}

			expect(chunks.filter((chunk) => chunk.type === "reasoning")).toEqual([
				{ type: "reasoning", text: "MiMo reasoning" },
			])
			expect(chunks.filter((chunk) => chunk.type === "text")).toEqual([{ type: "text", text: "MiMo response" }])
			expect(chunks.filter((chunk) => chunk.type === "usage")).toEqual([
				{
					type: "usage",
					inputTokens: 10,
					outputTokens: 5,
					cacheWriteTokens: 4,
					cacheReadTokens: 2,
					reasoningTokens: 3,
				},
			])
		})

		it("should handle tool call partials and emit tool call end", async () => {
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
			const chunks: any[] = []

			for await (const chunk of handler.createMessage(systemPrompt, messages, { taskId: "test", tools })) {
				chunks.push(chunk)
			}

			expect(chunks.filter((chunk) => chunk.type === "tool_call_partial")).toEqual([
				{
					type: "tool_call_partial",
					index: 0,
					id: "call_123",
					name: "get_weather",
					arguments: '{"location":"SF"}',
				},
			])
			expect(chunks.filter((chunk) => chunk.type === "tool_call_end")).toEqual([
				{ type: "tool_call_end", id: "call_123" },
			])

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs.tools[0].function.strict).toBe(true)
		})
	})

	describe("processUsageMetrics", () => {
		class TestXiaomiMiMoHandler extends XiaomiMiMoHandler {
			public testProcessUsageMetrics(usage: any) {
				return this.processUsageMetrics(usage)
			}
		}

		it("should process current usage metrics including cached and reasoning tokens", () => {
			const testHandler = new TestXiaomiMiMoHandler(mockOptions)
			const result = testHandler.testProcessUsageMetrics({
				prompt_tokens: 100,
				completion_tokens: 50,
				cache_creation_input_tokens: 12,
				prompt_tokens_details: {
					cached_tokens: 8,
				},
				completion_tokens_details: {
					reasoning_tokens: 30,
				},
			})

			expect(result).toEqual({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: 12,
				cacheReadTokens: 8,
				reasoningTokens: 30,
			})
		})

		it("should retain cache read fallback and handle missing optional metrics", () => {
			const testHandler = new TestXiaomiMiMoHandler(mockOptions)
			const result = testHandler.testProcessUsageMetrics({
				prompt_tokens: 100,
				completion_tokens: 50,
				cache_read_input_tokens: 7,
			})

			expect(result).toEqual({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheWriteTokens: undefined,
				cacheReadTokens: 7,
				reasoningTokens: undefined,
			})
		})
	})
})

// npx vitest run api/providers/__tests__/baseten.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type BasetenModelId, basetenDefaultModelId, basetenModels } from "@roo-code/types"

import { getModelMaxOutputTokens } from "../../../shared/api"

import { BasetenHandler } from "../baseten"

const mockCreate = vi.fn()

vi.mock("openai", () => ({
	default: vi.fn(() => ({
		chat: {
			completions: {
				create: mockCreate,
			},
		},
	})),
}))

describe("BasetenHandler", () => {
	let handler: BasetenHandler

	beforeEach(() => {
		vi.clearAllMocks()
		mockCreate.mockImplementation(async () => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [{ delta: { content: "Baseten response" }, index: 0 }],
					usage: null,
				}
				yield {
					choices: [{ delta: {}, index: 0 }],
					usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
				}
			},
		}))
		handler = new BasetenHandler({ basetenApiKey: "test-baseten-api-key" })
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should use the correct Baseten base URL", () => {
		new BasetenHandler({ basetenApiKey: "test-baseten-api-key" })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://inference.baseten.co/v1" }))
	})

	it("should use the provided API key", () => {
		const basetenApiKey = "test-baseten-api-key"
		new BasetenHandler({ basetenApiKey })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: basetenApiKey }))
	})

	it("should throw error when API key is not provided", () => {
		expect(() => new BasetenHandler({})).toThrow("API key is required")
	})

	it("should return default model when no model is specified", () => {
		const model = handler.getModel()
		expect(model.id).toBe(basetenDefaultModelId)
		expect(model.info).toEqual(expect.objectContaining(basetenModels[basetenDefaultModelId]))
	})

	it("should return specified model when valid model is provided", () => {
		const testModelId: BasetenModelId = "zai-org/GLM-5.1"
		const handlerWithModel = new BasetenHandler({
			apiModelId: testModelId,
			basetenApiKey: "test-baseten-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(expect.objectContaining(basetenModels[testModelId]))
	})

	it("should expose current Baseten metadata for reasoning-capable DeepSeek V4 Pro", () => {
		const modelInfo = basetenModels["deepseek-ai/DeepSeek-V4-Pro"]

		expect(modelInfo).toMatchObject({
			maxTokens: 131_072,
			contextWindow: 131_072,
			supportsImages: false,
			supportsPromptCache: true,
			supportsReasoningEffort: ["disable", "low", "medium", "high"],
			preserveReasoning: true,
			inputPrice: 1.74,
			outputPrice: 3.48,
			cacheReadsPrice: 0.145,
			description: expect.stringContaining("OpenAI-compatible reasoning_effort support"),
		})
	})

	it("completePrompt method should return text from Baseten API", async () => {
		const expectedResponse = "This is a test response from Baseten"
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	it("should handle errors in completePrompt", async () => {
		const errorMessage = "Baseten API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))
		await expect(handler.completePrompt("test prompt")).rejects.toThrow(`Baseten completion error: ${errorMessage}`)
	})

	it("createMessage should yield text content and usage from stream", async () => {
		const chunks = []

		for await (const chunk of handler.createMessage("system prompt", [])) {
			chunks.push(chunk)
		}

		expect(chunks[0]).toEqual({ type: "text", text: "Baseten response" })
		expect(chunks[1]).toMatchObject({ type: "usage", inputTokens: 10, outputTokens: 5 })
	})

	it("createMessage should pass correct parameters to Baseten client", async () => {
		const modelId: BasetenModelId = "zai-org/GLM-5.1"
		const modelInfo = basetenModels[modelId]
		const options = {
			apiModelId: modelId,
			basetenApiKey: "test-baseten-api-key",
		}
		const handlerWithModel = new BasetenHandler(options)

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({
				async next() {
					return { done: true }
				},
			}),
		}))

		const systemPrompt = "Test system prompt for Baseten"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message for Baseten" }]

		const messageGenerator = handlerWithModel.createMessage(systemPrompt, messages)
		await messageGenerator.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: modelId,
				max_tokens: getModelMaxOutputTokens({ modelId, model: modelInfo, settings: options, format: "openai" }),
				temperature: 0.5,
				messages: expect.arrayContaining([{ role: "system", content: systemPrompt }]),
				stream: true,
				stream_options: { include_usage: true },
				parallel_tool_calls: true,
			}),
			undefined,
		)
	})

	it("passes OpenAI-compatible reasoning_effort for reasoning-capable Baseten models", async () => {
		const modelId: BasetenModelId = "deepseek-ai/DeepSeek-V4-Pro"
		const handlerWithReasoning = new BasetenHandler({
			apiModelId: modelId,
			basetenApiKey: "test-baseten-api-key",
			enableReasoningEffort: true,
			reasoningEffort: "high",
		})

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({
				async next() {
					return { done: true }
				},
			}),
		}))

		const messageGenerator = handlerWithReasoning.createMessage("system", [])
		await messageGenerator.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: modelId,
				reasoning_effort: "high",
			}),
			undefined,
		)
	})

	it("omits reasoning_effort when reasoning is disabled", async () => {
		const modelId: BasetenModelId = "deepseek-ai/DeepSeek-V4-Pro"
		const handlerWithoutReasoning = new BasetenHandler({
			apiModelId: modelId,
			basetenApiKey: "test-baseten-api-key",
			enableReasoningEffort: false,
			reasoningEffort: "high",
		})

		mockCreate.mockImplementationOnce(() => ({
			[Symbol.asyncIterator]: () => ({
				async next() {
					return { done: true }
				},
			}),
		}))

		const messageGenerator = handlerWithoutReasoning.createMessage("system", [])
		await messageGenerator.next()

		expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("reasoning_effort")
	})

	it("completePrompt should pass reasoning_effort for reasoning-capable Baseten models", async () => {
		const handlerWithReasoning = new BasetenHandler({
			apiModelId: "deepseek-ai/DeepSeek-V4-Pro",
			basetenApiKey: "test-baseten-api-key",
			enableReasoningEffort: true,
			reasoningEffort: "medium",
		})

		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "reasoned answer" } }] })

		await expect(handlerWithReasoning.completePrompt("reason about this")).resolves.toBe("reasoned answer")
		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: "deepseek-ai/DeepSeek-V4-Pro",
				reasoning_effort: "medium",
			}),
		)
	})
})

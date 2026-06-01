// npx vitest run api/providers/__tests__/openai-codex.spec.ts

import { OpenAiCodexHandler } from "../openai-codex"
import type { ApiHandlerCreateMessageMetadata } from "../../index"

describe("OpenAiCodexHandler.getModel", () => {
	it.each([
		"gpt-5.5",
		"gpt-5.4",
		"gpt-5.4-mini",
		"gpt-5.3-codex",
		"gpt-5.1",
		"gpt-5",
		"gpt-5.1-codex",
		"gpt-5-codex",
		"gpt-5-codex-mini",
		"gpt-5.3-codex-spark",
	])("should return specified model when a valid model id is provided: %s", (apiModelId) => {
		const handler = new OpenAiCodexHandler({ apiModelId })
		const model = handler.getModel()

		expect(model.id).toBe(apiModelId)
		expect(model.info).toBeDefined()
	})

	it("should fall back to default model when an invalid model id is provided", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "not-a-real-model" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-5.5")
		expect(model.info).toBeDefined()
	})

	it("should use Spark-specific limits and capabilities", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.3-codex-spark" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-5.3-codex-spark")
		expect(model.info.contextWindow).toBe(128000)
		expect(model.info.maxTokens).toBe(8192)
		expect(model.info.supportsImages).toBe(false)
	})

	it("should use GPT-5.4 Mini capabilities when selected", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.4-mini" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-5.4-mini")
		expect(model.info).toBeDefined()
	})

	it.each([
		["gpt-5.5", 256_000],
		["gpt-5.4", 200_000],
	])("should use ChatGPT subscription model context window: %s", (apiModelId, contextWindow) => {
		const handler = new OpenAiCodexHandler({ apiModelId })
		const model = handler.getModel()

		expect(model.id).toBe(apiModelId)
		expect(model.info.contextWindow).toBe(contextWindow)
	})

	it("should use ChatGPT subscription GPT-5.5 Thinking context and default reasoning", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.5" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-5.5")
		expect(model.info.contextWindow).toBe(256_000)
		expect(model.info.reasoningEffort).toBe("medium")
	})
})

describe("OpenAiCodexHandler Fast mode request body", () => {
	const formattedInput = [
		{
			role: "user",
			content: [{ type: "input_text", text: "Hello" }],
		},
	]

	const buildRequestBody = (
		apiModelId: string,
		options: { openAiCodexFastMode?: boolean } = {},
		metadata?: ApiHandlerCreateMessageMetadata,
	) => {
		const handler = new OpenAiCodexHandler({ apiModelId, ...options })
		return (handler as any).buildRequestBody(
			handler.getModel(),
			formattedInput,
			"system prompt",
			undefined,
			metadata,
		)
	}

	it.each(["gpt-5.5", "gpt-5.4"])(
		"should request priority service tier when persistent Fast mode is enabled for supported model %s",
		(apiModelId) => {
			const body = buildRequestBody(apiModelId, { openAiCodexFastMode: true })

			expect(body.service_tier).toBe("priority")
		},
	)

	it("should omit service_tier when Fast mode is disabled by default", () => {
		const body = buildRequestBody("gpt-5.5")

		expect(body.service_tier).toBeUndefined()
	})

	it("should request priority service tier when request metadata enables Fast mode", () => {
		const body = buildRequestBody("gpt-5.5", {}, { taskId: "task-1", openAiCodexFastMode: true })

		expect(body.service_tier).toBe("priority")
	})

	it("should let request metadata disable persistent Fast mode for the current request", () => {
		const body = buildRequestBody(
			"gpt-5.5",
			{ openAiCodexFastMode: true },
			{ taskId: "task-1", openAiCodexFastMode: false },
		)

		expect(body.service_tier).toBeUndefined()
	})

	it("should omit service_tier for unsupported models even when Fast mode is enabled", () => {
		const body = buildRequestBody(
			"gpt-5.3-codex-spark",
			{ openAiCodexFastMode: true },
			{ taskId: "task-1", openAiCodexFastMode: true },
		)

		expect(body.service_tier).toBeUndefined()
	})
})

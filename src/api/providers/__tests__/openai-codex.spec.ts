// npx vitest run api/providers/__tests__/openai-codex.spec.ts

import { OpenAiCodexHandler } from "../openai-codex"
import type { ApiHandlerCreateMessageMetadata } from "../../index"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"
import { SINGLE_COMPLETION_SYSTEM_PROMPT } from "../../../shared/single-completion"

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
		systemPrompt = "system prompt",
	) => {
		const handler = new OpenAiCodexHandler({ apiModelId, ...options })
		return (handler as any).buildRequestBody(handler.getModel(), formattedInput, systemPrompt, undefined, metadata)
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

	it("should supply default instructions when the streaming request system prompt is empty", () => {
		const body = buildRequestBody("gpt-5.5", {}, undefined, "")

		expect(body.instructions).toBe(SINGLE_COMPLETION_SYSTEM_PROMPT)
		expect(body.instructions.trim().length).toBeGreaterThan(0)
	})
})

describe("OpenAiCodexHandler.completePrompt", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	const sseBody = (...events: any[]) =>
		new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder()
				for (const event of events) {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
				}
				controller.close()
			},
		})

	beforeEach(() => {
		vi.restoreAllMocks()
		vi.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("test-token")
		vi.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("acct_test")

		fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			body: sseBody(
				{ type: "response.output_text.delta", delta: "Enhanced " },
				{ type: "response.output_text.delta", delta: "prompt" },
				{ type: "response.completed", response: { output: [] } },
			),
		})
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("streams lightweight completion requests with non-empty instructions required by the Codex backend", async () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.5" })

		const result = await handler.completePrompt("Generate an enhanced prompt")

		expect(result).toBe("Enhanced prompt")
		const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body)
		expect(requestBody.stream).toBe(true)
		expect(requestBody.instructions).toBe(SINGLE_COMPLETION_SYSTEM_PROMPT)
		expect(requestBody.instructions.trim().length).toBeGreaterThan(0)
		expect(requestBody.input).toEqual([
			{
				role: "user",
				content: [{ type: "input_text", text: "Generate an enhanced prompt" }],
			},
		])
	})

	it("reads Codex lightweight completions from streamed SSE responses", async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			body: sseBody({
				type: "response.completed",
				response: {
					output: [
						{
							type: "message",
							content: [{ type: "output_text", text: "Enhanced from final event" }],
						},
					],
				},
			}),
		})

		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.5" })

		const result = await handler.completePrompt("Generate an enhanced prompt")

		expect(result).toBe("Enhanced from final event")
	})
})

describe("OpenAiCodexHandler Fast mode status", () => {
	const beginStatus = (handler: OpenAiCodexHandler, metadata?: ApiHandlerCreateMessageMetadata) => {
		;(handler as any).beginOpenAiCodexFastStatus(handler.getModel(), metadata)
	}

	it("reports off when Fast mode is not requested", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.5" })

		beginStatus(handler)

		expect(handler.getOpenAiCodexFastStatus()).toMatchObject({
			state: "off",
			modelId: "gpt-5.5",
		})
	})

	it("reports unsupported when Fast mode is enabled for a model without priority tier support", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.3-codex-spark", openAiCodexFastMode: true })

		beginStatus(handler)

		expect(handler.getOpenAiCodexFastStatus()).toMatchObject({
			state: "unsupported",
			modelId: "gpt-5.3-codex-spark",
			requestedServiceTier: "priority",
		})
	})

	it("keeps requested status when the provider does not echo service tier confirmation", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.5", openAiCodexFastMode: true })

		beginStatus(handler)
		;(handler as any).captureOpenAiCodexFastStatusFromEvent({ type: "response.created" })

		expect(handler.getOpenAiCodexFastStatus()).toMatchObject({
			state: "requested",
			modelId: "gpt-5.5",
			requestedServiceTier: "priority",
		})
	})

	it("reports confirmed when the provider echoes the requested priority service tier", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.5", openAiCodexFastMode: true })

		beginStatus(handler)
		;(handler as any).captureOpenAiCodexFastStatusFromEvent({ response: { service_tier: "priority" } })

		expect(handler.getOpenAiCodexFastStatus()).toMatchObject({
			state: "confirmed",
			modelId: "gpt-5.5",
			requestedServiceTier: "priority",
			observedServiceTier: "priority",
		})
	})

	it("reports rejected when the provider returns a non-priority service tier", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.5", openAiCodexFastMode: true })

		beginStatus(handler)
		;(handler as any).captureOpenAiCodexFastStatusFromEvent({ response: { service_tier: "default" } })

		expect(handler.getOpenAiCodexFastStatus()).toMatchObject({
			state: "rejected",
			modelId: "gpt-5.5",
			requestedServiceTier: "priority",
			observedServiceTier: "default",
			error: "Provider returned default service tier instead of priority.",
		})
	})

	it("reports rejected when the provider errors after priority was requested", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.5", openAiCodexFastMode: true })

		beginStatus(handler)
		;(handler as any).markOpenAiCodexFastStatusRejected(new Error("priority tier rejected"))

		expect(handler.getOpenAiCodexFastStatus()).toMatchObject({
			state: "rejected",
			modelId: "gpt-5.5",
			requestedServiceTier: "priority",
			error: "priority tier rejected",
		})
	})
})

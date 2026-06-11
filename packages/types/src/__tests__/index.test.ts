// npx vitest run src/__tests__/index.test.ts

import {
	CLOUDFLARE_WORKERS_AI_DAILY_FREE_NEURONS,
	GLOBAL_STATE_KEYS,
	MODELS_BY_PROVIDER,
	type ModelInfo,
	applyCloudflareWorkersAiImageUsageUpdate,
	estimateCloudflareWorkersAiImageGenerationUsage,
	getApiProtocol,
	getCloudflareWorkersAiImageUsageSnapshot,
	modelIdKeysByProvider,
	providerNames,
	providerSettingsSchemaDiscriminated,
} from "../index.js"
import {
	anthropicModels,
	basetenDefaultModelId,
	basetenModels,
	bedrockModels,
	deepSeekModels,
	fireworksDefaultModelId,
	fireworksModels,
	geminiModels,
	getProviderDefaultModelId,
	internationalZAiModels,
	minimaxModels,
	mistralModels,
	moonshotModels,
	openAiCodexModels,
	openAiCodexSelectableModelIds,
	openAiNativeModels,
	qwenCodeModels,
	openAiNativeDefaultModelId,
	sambaNovaDefaultModelId,
	sambaNovaModels,
	vertexModels,
	vscodeLlmModels,
	xaiModels,
	xiaomiMiMoDefaultModelId,
	xiaomiMiMoModels,
} from "../providers/index.js"

describe("GLOBAL_STATE_KEYS", () => {
	it("should contain provider settings keys", () => {
		expect(GLOBAL_STATE_KEYS).toContain("autoApprovalEnabled")
	})

	it("should contain provider settings keys", () => {
		expect(GLOBAL_STATE_KEYS).toContain("anthropicBaseUrl")
	})

	it("should not contain secret state keys", () => {
		expect(GLOBAL_STATE_KEYS).not.toContain("openRouterApiKey")
	})

	it("should contain OpenAI Compatible base URL setting", () => {
		expect(GLOBAL_STATE_KEYS).toContain("codebaseIndexOpenAiCompatibleBaseUrl")
	})

	it("should contain OpenAI Codex Fast mode setting", () => {
		expect(GLOBAL_STATE_KEYS).toContain("openAiCodexFastMode")
	})

	it("should contain Cloudflare Workers AI image usage aggregate but not image API key secret", () => {
		expect(GLOBAL_STATE_KEYS).toContain("cloudflareWorkersAiImageUsage")
		expect(GLOBAL_STATE_KEYS).not.toContain("cloudflareImageApiKey")
	})

	it("should not contain OpenAI Compatible API key (secret)", () => {
		expect(GLOBAL_STATE_KEYS).not.toContain("codebaseIndexOpenAiCompatibleApiKey")
	})
})

describe("OpenAI Codex provider settings", () => {
	it("should accept the persistent Fast mode setting", () => {
		expect(
			providerSettingsSchemaDiscriminated.safeParse({
				apiProvider: "openai-codex",
				apiModelId: "gpt-5.5",
				openAiCodexFastMode: true,
			}).success,
		).toBe(true)
	})

	it("should only mark GPT-5.5 and GPT-5.4 as Fast mode supported", () => {
		const supportedFastModeModels = Object.entries(openAiCodexModels)
			.filter(([, model]) => (model as ModelInfo).supportsFastMode === true)
			.map(([modelId]) => modelId)

		expect(supportedFastModeModels).toEqual(["gpt-5.5", "gpt-5.4"])
		expect((openAiCodexModels["gpt-5.3-codex-spark"] as ModelInfo).supportsFastMode).toBeUndefined()
	})

	it("should expose only current ChatGPT sign-in Codex models as selectable", () => {
		expect(openAiCodexSelectableModelIds).toEqual(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"])
		expect(MODELS_BY_PROVIDER["openai-codex"].models).toEqual([...openAiCodexSelectableModelIds])

		for (const modelId of openAiCodexSelectableModelIds) {
			expect((openAiCodexModels[modelId] as ModelInfo).deprecated).not.toBe(true)
		}
	})

	it.each([
		"gpt-5.1-codex-max",
		"gpt-5.1-codex",
		"gpt-5.3-codex",
		"gpt-5.2-codex",
		"gpt-5.1",
		"gpt-5",
		"gpt-5-codex",
		"gpt-5-codex-mini",
		"gpt-5.1-codex-mini",
		"gpt-5.2",
	])("should mark unsupported ChatGPT sign-in Codex model %s as deprecated", (modelId) => {
		expect((openAiCodexModels[modelId as keyof typeof openAiCodexModels] as ModelInfo).deprecated).toBe(true)
		expect(MODELS_BY_PROVIDER["openai-codex"].models).not.toContain(modelId)
	})
})

describe("getProviderDefaultModelId", () => {
	const staticModelsByProvider = {
		anthropic: anthropicModels,
		bedrock: bedrockModels,
		deepseek: deepSeekModels,
		fireworks: fireworksModels,
		gemini: geminiModels,
		mistral: mistralModels,
		moonshot: moonshotModels,
		minimax: minimaxModels,
		"xiaomi-mimo": xiaomiMiMoModels,
		"openai-codex": openAiCodexModels,
		"openai-native": openAiNativeModels,
		"qwen-code": qwenCodeModels,
		sambanova: sambaNovaModels,
		vertex: vertexModels,
		"vscode-lm": vscodeLlmModels,
		xai: xaiModels,
		zai: internationalZAiModels,
		baseten: basetenModels,
	} as const

	it("should use the OpenAI native provider default instead of stale fallback metadata", () => {
		expect(getProviderDefaultModelId("openai-native")).toBe(openAiNativeDefaultModelId)
	})

	it("should return the Xiaomi MiMo provider default", () => {
		expect(getProviderDefaultModelId("xiaomi-mimo")).toBe(xiaomiMiMoDefaultModelId)
	})

	it("should return active hosted inference provider defaults", () => {
		expect(getProviderDefaultModelId("fireworks")).toBe(fireworksDefaultModelId)
		expect(fireworksModels[fireworksDefaultModelId]).toBeDefined()
		expect(fireworksModels[fireworksDefaultModelId]).not.toHaveProperty("deprecated")

		expect(getProviderDefaultModelId("baseten")).toBe(basetenDefaultModelId)
		expect(basetenModels[basetenDefaultModelId]).toBeDefined()
		expect(basetenModels[basetenDefaultModelId]).not.toHaveProperty("deprecated")

		expect(getProviderDefaultModelId("sambanova")).toBe(sambaNovaDefaultModelId)
		expect(sambaNovaModels[sambaNovaDefaultModelId]).toBeDefined()
		expect(sambaNovaModels[sambaNovaDefaultModelId]).not.toHaveProperty("deprecated")
	})

	it("should not expose deprecated static provider models as active MODELS_BY_PROVIDER choices", () => {
		for (const [provider, models] of Object.entries(staticModelsByProvider)) {
			const listedModelIds = MODELS_BY_PROVIDER[provider as keyof typeof staticModelsByProvider].models

			for (const modelId of listedModelIds) {
				expect((models as Record<string, ModelInfo>)[modelId]?.deprecated).not.toBe(true)
			}
		}
	})
})

describe("Cloudflare Workers AI image usage helpers", () => {
	const now = new Date("2026-06-08T08:00:00.000Z")

	it("should derive local daily usage snapshots with remaining free neurons", () => {
		const snapshot = getCloudflareWorkersAiImageUsageSnapshot(
			{
				utcDate: "2026-06-08",
				neuronsUsed: 1_250,
				requestCount: 3,
				estimatedNeuronsUsed: 1_250,
				updatedAt: "2026-06-08T07:00:00.000Z",
			},
			now,
		)

		expect(snapshot).toMatchObject({
			utcDate: "2026-06-08",
			neuronsUsed: 1_250,
			requestCount: 3,
			dailyQuotaNeurons: CLOUDFLARE_WORKERS_AI_DAILY_FREE_NEURONS,
			estimatedRemainingNeurons: 8_750,
			resetAt: "2026-06-09T00:00:00.000Z",
			source: "local_estimate",
		})
	})

	it("should reset stale daily state and keep provider-reported usage separate from local estimates", () => {
		const providerUpdate = applyCloudflareWorkersAiImageUsageUpdate(
			{
				utcDate: "2026-06-07",
				neuronsUsed: 9_000,
				requestCount: 12,
				estimatedNeuronsUsed: 9_000,
				updatedAt: "2026-06-07T23:59:00.000Z",
			},
			{ neurons: 250, source: "provider_response" },
			now,
		)

		expect(providerUpdate).toMatchObject({
			utcDate: "2026-06-08",
			neuronsUsed: 250,
			requestCount: 1,
			providerReportedNeuronsUsed: 250,
			updatedAt: "2026-06-08T08:00:00.000Z",
		})
		expect(providerUpdate.estimatedNeuronsUsed).toBeUndefined()

		const localEstimateUpdate = applyCloudflareWorkersAiImageUsageUpdate(
			providerUpdate,
			{ neurons: 4.8, source: "local_estimate" },
			now,
		)

		expect(localEstimateUpdate).toMatchObject({
			utcDate: "2026-06-08",
			neuronsUsed: 254.8,
			requestCount: 2,
			providerReportedNeuronsUsed: 250,
			estimatedNeuronsUsed: 4.8,
		})
	})

	it("should estimate Cloudflare image-generation neurons and overage cost from output dimensions", () => {
		const estimate = estimateCloudflareWorkersAiImageGenerationUsage({
			model: "@cf/black-forest-labs/flux-1-schnell",
			imageWidth: 1_024,
			imageHeight: 512,
		})

		expect(estimate).toEqual({
			estimatedNeurons: 9.6,
			estimatedCost: 0.000106,
			currency: "USD",
			outputTileCount: 2,
			outputMegapixels: 1,
			basis: "image_dimensions",
		})
	})
})

describe("Xiaomi MiMo provider settings", () => {
	const xiaomiMiMoTextModelIds = ["mimo-v2.5-pro", "mimo-v2-pro", "mimo-v2.5", "mimo-v2-omni", "mimo-v2-flash"]
	const xiaomiMiMoSelectableTextModelIds = ["mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-flash"]

	it("should register Xiaomi MiMo as a provider", () => {
		expect(providerNames).toContain("xiaomi-mimo")
	})

	it("should accept both official Xiaomi MiMo base URLs", () => {
		for (const xiaomiMiMoBaseUrl of ["https://api.xiaomimimo.com/v1", "https://token-plan-ams.xiaomimimo.com/v1"]) {
			expect(
				providerSettingsSchemaDiscriminated.safeParse({
					apiProvider: "xiaomi-mimo",
					apiModelId: xiaomiMiMoDefaultModelId,
					xiaomiMiMoBaseUrl,
					xiaomiMiMoApiKey: "test-api-key",
				}).success,
			).toBe(true)
		}
	})

	it("should reject unofficial Xiaomi MiMo base URLs", () => {
		expect(
			providerSettingsSchemaDiscriminated.safeParse({
				apiProvider: "xiaomi-mimo",
				apiModelId: xiaomiMiMoDefaultModelId,
				xiaomiMiMoBaseUrl: "https://example.com/v1",
				xiaomiMiMoApiKey: "test-api-key",
			}).success,
		).toBe(false)
	})

	it("should list only active official text/chat models and exclude deprecated or TTS models", () => {
		expect(MODELS_BY_PROVIDER["xiaomi-mimo"].models).toEqual(xiaomiMiMoSelectableTextModelIds)
		expect(Object.keys(xiaomiMiMoModels)).toEqual(xiaomiMiMoTextModelIds)
		expect(MODELS_BY_PROVIDER["xiaomi-mimo"].models).not.toContain("mimo-v2-pro")
		expect(MODELS_BY_PROVIDER["xiaomi-mimo"].models).not.toContain("mimo-v2-omni")
		expect(MODELS_BY_PROVIDER["xiaomi-mimo"].models).not.toContain("mimo-v2.5-tts")
		expect(MODELS_BY_PROVIDER["xiaomi-mimo"].models).not.toContain("mimo-v2.5-tts-voiceclone")
		expect(MODELS_BY_PROVIDER["xiaomi-mimo"].models).not.toContain("mimo-v2.5-tts-voicedesign")
		expect(MODELS_BY_PROVIDER["xiaomi-mimo"].models).not.toContain("mimo-v2-tts")
	})

	it("should use static apiModelId selection with OpenAI protocol", () => {
		expect(modelIdKeysByProvider["xiaomi-mimo"]).toBe("apiModelId")
		expect(getApiProtocol("xiaomi-mimo")).toBe("openai")
	})

	it("should expose official Xiaomi MiMo pay-as-you-go pricing metadata", () => {
		const expectedPricing = {
			"mimo-v2.5-pro": { inputPrice: 0.435, outputPrice: 0.87, cacheReadsPrice: 0.0036 },
			"mimo-v2-pro": { inputPrice: 0.435, outputPrice: 0.87, cacheReadsPrice: 0.0036 },
			"mimo-v2.5": { inputPrice: 0.14, outputPrice: 0.28, cacheReadsPrice: 0.0028 },
			"mimo-v2-omni": { inputPrice: 0.14, outputPrice: 0.28, cacheReadsPrice: 0.0028 },
			"mimo-v2-flash": { inputPrice: 0.1, outputPrice: 0.3, cacheReadsPrice: 0.01 },
		} as const

		for (const [modelId, pricing] of Object.entries(expectedPricing)) {
			const model = xiaomiMiMoModels[modelId as keyof typeof xiaomiMiMoModels] as ModelInfo

			expect(model).toMatchObject({
				...pricing,
				cacheWritesPrice: 0,
				supportsPromptCache: true,
			})
		}

		const deprecatedProModel = xiaomiMiMoModels["mimo-v2-pro"] as ModelInfo

		expect(deprecatedProModel.deprecated).toBe(true)
		expect(deprecatedProModel.longContextPricing).toBeUndefined()
		expect(xiaomiMiMoModels["mimo-v2.5"].supportsImages).toBe(true)
		expect(xiaomiMiMoModels["mimo-v2-omni"]).toMatchObject({
			contextWindow: 256_000,
			supportsImages: true,
			deprecated: true,
		})
	})
})

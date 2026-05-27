// npx vitest run src/__tests__/index.test.ts

import {
	GLOBAL_STATE_KEYS,
	MODELS_BY_PROVIDER,
	type ModelInfo,
	getApiProtocol,
	modelIdKeysByProvider,
	providerNames,
	providerSettingsSchemaDiscriminated,
} from "../index.js"
import {
	getProviderDefaultModelId,
	openAiNativeDefaultModelId,
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

	it("should not contain OpenAI Compatible API key (secret)", () => {
		expect(GLOBAL_STATE_KEYS).not.toContain("codebaseIndexOpenAiCompatibleApiKey")
	})
})

describe("getProviderDefaultModelId", () => {
	it("should use the OpenAI native provider default instead of stale fallback metadata", () => {
		expect(getProviderDefaultModelId("openai-native")).toBe(openAiNativeDefaultModelId)
	})

	it("should return the Xiaomi MiMo provider default", () => {
		expect(getProviderDefaultModelId("xiaomi-mimo")).toBe(xiaomiMiMoDefaultModelId)
	})
})

describe("Xiaomi MiMo provider settings", () => {
	const xiaomiMiMoTextModelIds = ["mimo-v2.5-pro", "mimo-v2-pro", "mimo-v2.5", "mimo-v2-omni", "mimo-v2-flash"]

	it("should register Xiaomi MiMo as a provider", () => {
		expect(providerNames).toContain("xiaomi-mimo")
	})

	it("should accept both official Xiaomi MiMo base URLs", () => {
		for (const xiaomiMiMoBaseUrl of ["https://api.xiaomimimo.com/v1", "https://token-plan-cn.xiaomimimo.com/v1"]) {
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

	it("should list only official text/chat models and exclude TTS models", () => {
		expect(MODELS_BY_PROVIDER["xiaomi-mimo"].models).toEqual(xiaomiMiMoTextModelIds)
		expect(Object.keys(xiaomiMiMoModels)).toEqual(xiaomiMiMoTextModelIds)
		expect(MODELS_BY_PROVIDER["xiaomi-mimo"].models).not.toContain("mimo-v2.5-tts")
		expect(MODELS_BY_PROVIDER["xiaomi-mimo"].models).not.toContain("mimo-v2.5-tts-voiceclone")
		expect(MODELS_BY_PROVIDER["xiaomi-mimo"].models).not.toContain("mimo-v2.5-tts-voicedesign")
		expect(MODELS_BY_PROVIDER["xiaomi-mimo"].models).not.toContain("mimo-v2-tts")
	})

	it("should use static apiModelId selection with OpenAI protocol", () => {
		expect(modelIdKeysByProvider["xiaomi-mimo"]).toBe("apiModelId")
		expect(getApiProtocol("xiaomi-mimo")).toBe("openai")
	})

	it("should not invent pricing metadata", () => {
		for (const model of Object.values(xiaomiMiMoModels) as ModelInfo[]) {
			expect(model.inputPrice).toBeUndefined()
			expect(model.outputPrice).toBeUndefined()
			expect(model.cacheWritesPrice).toBeUndefined()
			expect(model.cacheReadsPrice).toBeUndefined()
		}
	})
})

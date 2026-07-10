// npx vitest run src/__tests__/provider-freshness.spec.ts

import {
	customProviders,
	dynamicProviders,
	fauxProviders,
	internalProviders,
	localProviders,
	modelInfoSchema,
	providerNames,
	type ModelInfo,
	type ProviderName,
} from "../index.js"
import {
	anthropicModels,
	basetenModels,
	bedrockModels,
	deepSeekModels,
	fireworksModels,
	geminiModels,
	internationalZAiModels,
	minimaxModels,
	mistralModels,
	moonshotModels,
	openAiCodexModels,
	openAiNativeModels,
	qwenCodeModels,
	sambaNovaModels,
	vertexModels,
	xaiModels,
	xiaomiMiMoModels,
} from "../providers/index.js"

const staticProviderModelRecords = {
	anthropic: anthropicModels,
	baseten: basetenModels,
	bedrock: bedrockModels,
	deepseek: deepSeekModels,
	fireworks: fireworksModels,
	gemini: geminiModels,
	mistral: mistralModels,
	moonshot: moonshotModels,
	minimax: minimaxModels,
	"openai-codex": openAiCodexModels,
	"openai-native": openAiNativeModels,
	"qwen-code": qwenCodeModels,
	sambanova: sambaNovaModels,
	vertex: vertexModels,
	xai: xaiModels,
	"xiaomi-mimo": xiaomiMiMoModels,
	zai: internationalZAiModels,
} as const

type StaticProviderWithModels = keyof typeof staticProviderModelRecords

const modelEntries = (provider: StaticProviderWithModels): Array<[string, ModelInfo]> =>
	Object.entries(staticProviderModelRecords[provider]) as Array<[string, ModelInfo]>

const sourceBackedStaticProviderSeeds = ["openai-codex", "xiaomi-mimo"] as const satisfies readonly ProviderName[]

const sourceBackedStaticProviderProvenanceExpectations = {
	"openai-codex": {
		modelSource: {
			type: "curated",
			url: "https://chatgpt.com",
		},
		capabilitySources: {
			contextWindow: {
				type: "curated",
				url: "https://chatgpt.com",
			},
			pricing: {
				type: "curated",
				url: "https://chatgpt.com",
			},
			serviceTiers: {
				type: "curated",
				url: "https://chatgpt.com",
			},
		},
	},
	"xiaomi-mimo": {
		modelSource: {
			type: "official-docs",
			url: "https://platform.xiaomimimo.com/docs",
		},
		capabilitySources: {
			contextWindow: {
				type: "official-docs",
				url: "https://platform.xiaomimimo.com/docs",
			},
			pricing: {
				type: "official-docs",
				url: "https://platform.xiaomimimo.com/static/docs/price/pay-as-you-go.md",
			},
		},
	},
} as const

const unreviewedStaticProviderAllowlist = [
	"anthropic",
	"baseten",
	"bedrock",
	"deepseek",
	"fireworks",
	"gemini",
	"mistral",
	"moonshot",
	"minimax",
	"openai-native",
	"qwen-code",
	"sambanova",
	"vertex",
	"xai",
	"zai",
] as const satisfies readonly ProviderName[]

const modelListExemptions = ["gemini-cli"] as const satisfies readonly ProviderName[]

const staticFreshnessExemptProviders = new Set<ProviderName>([
	...dynamicProviders,
	...localProviders,
	...customProviders,
	...internalProviders,
	...fauxProviders,
	...modelListExemptions,
])

const freshnessTrackedProviders = new Set<ProviderName>([
	...sourceBackedStaticProviderSeeds,
	...unreviewedStaticProviderAllowlist,
])

describe("provider freshness policy", () => {
	it("accounts for each provider through a checked static seed, allowlist, or category exemption", () => {
		const unaccountedProviders = providerNames.filter(
			(provider) => !staticFreshnessExemptProviders.has(provider) && !freshnessTrackedProviders.has(provider),
		)

		expect(unaccountedProviders).toEqual([])
	})

	it("keeps the unreviewed provider allowlist explicit and scoped to known static providers", () => {
		const staticProviderNames = new Set(Object.keys(staticProviderModelRecords) as StaticProviderWithModels[])

		for (const provider of unreviewedStaticProviderAllowlist) {
			expect(staticProviderNames.has(provider as StaticProviderWithModels)).toBe(true)
			expect(staticFreshnessExemptProviders.has(provider)).toBe(false)
			expect(sourceBackedStaticProviderSeeds).not.toContain(provider)
		}
	})

	it("exempts dynamic, local, custom, internal, and faux providers from static freshness requirements", () => {
		for (const provider of [
			...dynamicProviders,
			...localProviders,
			...customProviders,
			...internalProviders,
			...fauxProviders,
		] as ProviderName[]) {
			expect(staticFreshnessExemptProviders.has(provider)).toBe(true)
			expect(freshnessTrackedProviders.has(provider)).toBe(false)
		}
	})

	it("validates representative source-backed static provenance without inventing review dates", () => {
		for (const provider of sourceBackedStaticProviderSeeds) {
			const entries = modelEntries(provider)
			const expectation = sourceBackedStaticProviderProvenanceExpectations[provider]

			expect(entries.length).toBeGreaterThan(0)

			for (const [modelId, model] of entries) {
				const parsed = modelInfoSchema.safeParse(model)

				if (!parsed.success) {
					throw new Error(`Static provider ${provider} model ${modelId} failed modelInfoSchema validation`)
				}

				expect(parsed.data.provenance).toMatchObject({
					reviewStatus: "unreviewed",
					sources: [expect.objectContaining(expectation.modelSource)],
				})
				expect(parsed.data.provenance?.lastReviewed).toBeUndefined()

				for (const [capability, expectedSource] of Object.entries(expectation.capabilitySources)) {
					expect(
						parsed.data.capabilityProvenance?.[
							capability as keyof NonNullable<ModelInfo["capabilityProvenance"]>
						]?.sources?.[0],
					).toMatchObject(expectedSource)
				}
			}
		}
	})
})

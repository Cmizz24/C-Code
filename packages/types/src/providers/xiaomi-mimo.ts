import type { ModelInfo } from "../model.js"

// https://platform.xiaomimimo.com/docs
// Xiaomi MiMo exposes an OpenAI-compatible chat completions API.
export type XiaomiMiMoModelId = keyof typeof xiaomiMiMoModels

export const xiaomiMiMoDefaultModelId: XiaomiMiMoModelId = "mimo-v2.5-pro"

const XIAOMI_MIMO_1M_CONTEXT_WINDOW = 1_000_000
const XIAOMI_MIMO_256K_CONTEXT_WINDOW = 256_000
const XIAOMI_MIMO_128K_MAX_OUTPUT_TOKENS = 128_000
const XIAOMI_MIMO_64K_MAX_OUTPUT_TOKENS = 64_000

const xiaomiMiMoTextModelInfo = {
	maxTokens: XIAOMI_MIMO_128K_MAX_OUTPUT_TOKENS,
	contextWindow: XIAOMI_MIMO_1M_CONTEXT_WINDOW,
	supportsImages: false,
	supportsPromptCache: false,
	supportsReasoningBinary: true,
} as const satisfies ModelInfo

const xiaomiMiMoPromptCachePricing = {
	// https://platform.xiaomimimo.com/static/docs/price/pay-as-you-go.md
	// Xiaomi MiMo lists overseas pricing in USD per 1M tokens. Cache writes are currently limited-time free.
	supportsPromptCache: true,
	cacheWritesPrice: 0,
} as const satisfies Partial<ModelInfo>

const xiaomiMiMoV25ProPricing = {
	...xiaomiMiMoPromptCachePricing,
	inputPrice: 0.435,
	outputPrice: 0.87,
	cacheReadsPrice: 0.0036,
} as const satisfies Partial<ModelInfo>

const xiaomiMiMoV25Pricing = {
	...xiaomiMiMoPromptCachePricing,
	inputPrice: 0.14,
	outputPrice: 0.28,
	cacheReadsPrice: 0.0028,
} as const satisfies Partial<ModelInfo>

const xiaomiMiMoV2ProPricing = {
	...xiaomiMiMoPromptCachePricing,
	inputPrice: 1,
	outputPrice: 3,
	cacheReadsPrice: 0.2,
	longContextPricing: {
		thresholdTokens: XIAOMI_MIMO_256K_CONTEXT_WINDOW,
		inputPriceMultiplier: 2,
		outputPriceMultiplier: 2,
		cacheReadsPriceMultiplier: 2,
	},
} as const satisfies Partial<ModelInfo>

const xiaomiMiMoV2OmniPricing = {
	...xiaomiMiMoPromptCachePricing,
	inputPrice: 0.4,
	outputPrice: 2,
	cacheReadsPrice: 0.08,
} as const satisfies Partial<ModelInfo>

const xiaomiMiMoV2FlashPricing = {
	...xiaomiMiMoPromptCachePricing,
	inputPrice: 0.1,
	outputPrice: 0.3,
	cacheReadsPrice: 0.01,
} as const satisfies Partial<ModelInfo>

export const xiaomiMiMoModels = {
	"mimo-v2.5-pro": {
		...xiaomiMiMoTextModelInfo,
		...xiaomiMiMoV25ProPricing,
		description: "Xiaomi MiMo V2.5 Pro model with 1M context and 128K maximum output.",
	},
	"mimo-v2-pro": {
		...xiaomiMiMoTextModelInfo,
		...xiaomiMiMoV2ProPricing,
		description: "Xiaomi MiMo V2 Pro model with 1M context and 128K maximum output.",
	},
	"mimo-v2.5": {
		...xiaomiMiMoTextModelInfo,
		...xiaomiMiMoV25Pricing,
		description: "Xiaomi MiMo V2.5 model with 1M context and 128K maximum output.",
	},
	"mimo-v2-omni": {
		...xiaomiMiMoTextModelInfo,
		...xiaomiMiMoV2OmniPricing,
		contextWindow: XIAOMI_MIMO_256K_CONTEXT_WINDOW,
		description: "Xiaomi MiMo V2 Omni model with 256K context and 128K maximum output.",
	},
	"mimo-v2-flash": {
		...xiaomiMiMoTextModelInfo,
		...xiaomiMiMoV2FlashPricing,
		contextWindow: XIAOMI_MIMO_256K_CONTEXT_WINDOW,
		maxTokens: XIAOMI_MIMO_64K_MAX_OUTPUT_TOKENS,
		description: "Xiaomi MiMo V2 Flash model with 256K context and 64K maximum output.",
	},
} as const satisfies Record<string, ModelInfo>

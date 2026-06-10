import type { ModelInfo } from "../model.js"

// Minimax
// https://platform.minimax.io/docs/guides/models-intro
// https://platform.minimax.io/docs/guides/pricing-paygo
// https://platform.minimax.io/docs/guides/pricing-tokenplan
export type MinimaxModelId = keyof typeof minimaxModels
export const minimaxDefaultModelId: MinimaxModelId = "MiniMax-M3"

export const MINIMAX_DEFAULT_MAX_TOKENS = 16_384
export const MINIMAX_DEFAULT_TEMPERATURE = 1.0

const MINIMAX_M_SERIES_CONTEXT_WINDOW = 204_800
const MINIMAX_M3_CONTEXT_WINDOW = 1_000_000
const MINIMAX_M3_LONG_CONTEXT_THRESHOLD = 512_000
const MINIMAX_CACHE_WRITE_PRICE = 0.375
const MINIMAX_LEGACY_CACHE_READ_PRICE = 0.03
const MINIMAX_M27_CACHE_READ_PRICE = 0.06
const MINIMAX_STANDARD_INPUT_PRICE = 0.3
const MINIMAX_STANDARD_OUTPUT_PRICE = 1.2
const MINIMAX_HIGHSPEED_INPUT_PRICE = 0.6
const MINIMAX_HIGHSPEED_OUTPUT_PRICE = 2.4

const minimaxCommonModelInfo = {
	maxTokens: MINIMAX_DEFAULT_MAX_TOKENS,
	contextWindow: MINIMAX_M_SERIES_CONTEXT_WINDOW,
	supportsImages: false,
	supportsPromptCache: true,
	includedTools: ["search_and_replace"],
	excludedTools: ["apply_diff"],
	preserveReasoning: true,
	cacheWritesPrice: MINIMAX_CACHE_WRITE_PRICE,
} satisfies ModelInfo

const minimaxStandardPricing = {
	inputPrice: MINIMAX_STANDARD_INPUT_PRICE,
	outputPrice: MINIMAX_STANDARD_OUTPUT_PRICE,
	cacheReadsPrice: MINIMAX_LEGACY_CACHE_READ_PRICE,
} satisfies Partial<ModelInfo>

const minimaxM27Pricing = {
	inputPrice: MINIMAX_STANDARD_INPUT_PRICE,
	outputPrice: MINIMAX_STANDARD_OUTPUT_PRICE,
	cacheReadsPrice: MINIMAX_M27_CACHE_READ_PRICE,
} satisfies Partial<ModelInfo>

const minimaxHighspeedPricing = {
	inputPrice: MINIMAX_HIGHSPEED_INPUT_PRICE,
	outputPrice: MINIMAX_HIGHSPEED_OUTPUT_PRICE,
	cacheReadsPrice: MINIMAX_LEGACY_CACHE_READ_PRICE,
} satisfies Partial<ModelInfo>

const minimaxM27HighspeedPricing = {
	inputPrice: MINIMAX_HIGHSPEED_INPUT_PRICE,
	outputPrice: MINIMAX_HIGHSPEED_OUTPUT_PRICE,
	cacheReadsPrice: MINIMAX_M27_CACHE_READ_PRICE,
} satisfies Partial<ModelInfo>

export const minimaxModels = {
	"MiniMax-M3": {
		...minimaxCommonModelInfo,
		contextWindow: MINIMAX_M3_CONTEXT_WINDOW,
		supportsImages: true,
		inputPrice: MINIMAX_STANDARD_INPUT_PRICE,
		outputPrice: MINIMAX_STANDARD_OUTPUT_PRICE,
		cacheReadsPrice: MINIMAX_M27_CACHE_READ_PRICE,
		longContextPricing: {
			thresholdTokens: MINIMAX_M3_LONG_CONTEXT_THRESHOLD,
			inputPriceMultiplier: 2,
			outputPriceMultiplier: 2,
			cacheReadsPriceMultiplier: 2,
		},
		tiers: [
			{
				name: "priority",
				contextWindow: MINIMAX_M3_CONTEXT_WINDOW,
				inputPrice: 0.45,
				outputPrice: 1.8,
				cacheReadsPrice: 0.09,
			},
		],
		description:
			"MiniMax M3, the latest M-series multimodal language model with a 1M context window for agentic reasoning, tool use, coding, and long-context tasks. Standard pricing is discounted 50%; long-context pricing applies above 512K input tokens.",
	},
	"MiniMax-M2.5": {
		...minimaxCommonModelInfo,
		...minimaxStandardPricing,
		description:
			"MiniMax M2.5 with enhanced coding and agentic capabilities, building on the strengths of the M2 series. See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2.5-highspeed": {
		...minimaxCommonModelInfo,
		...minimaxHighspeedPricing,
		description:
			"MiniMax M2.5 highspeed: same performance as M2.5 but with faster response (approximately 100 tps vs 60 tps). See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Requires TokenPlan High-Speed subscription for use with TokenPlan keys. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2.7": {
		...minimaxCommonModelInfo,
		...minimaxM27Pricing,
		description:
			"MiniMax M2.7, MiniMax's M-series model with recursive self-improvement capabilities. See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2.7-highspeed": {
		...minimaxCommonModelInfo,
		...minimaxM27HighspeedPricing,
		description:
			"MiniMax M2.7 highspeed: same performance as M2.7 but with faster response (approximately 100 tps vs 60 tps). See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Requires TokenPlan High-Speed subscription for use with TokenPlan keys. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2": {
		...minimaxCommonModelInfo,
		...minimaxStandardPricing,
		description:
			"MiniMax M2, a model born for Agents and code, featuring Top-tier Coding Capabilities, Powerful Agentic Performance, and Ultimate Cost-Effectiveness & Speed. See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2-Stable": {
		...minimaxCommonModelInfo,
		...minimaxStandardPricing,
		description:
			"MiniMax M2 Stable (High Concurrency, Commercial Use), a model born for Agents and code, featuring Top-tier Coding Capabilities, Powerful Agentic Performance, and Ultimate Cost-Effectiveness & Speed. See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2.1": {
		...minimaxCommonModelInfo,
		...minimaxStandardPricing,
		description:
			"MiniMax M2.1 builds on M2 with improved overall performance for agentic coding tasks and significantly faster response times. See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
	"MiniMax-M2.1-highspeed": {
		...minimaxCommonModelInfo,
		...minimaxHighspeedPricing,
		description:
			"MiniMax M2.1 highspeed: same performance as M2.1 but with faster response (approximately 100 tps vs 60 tps). See pricing at https://platform.minimax.io/docs/guides/pricing-paygo. Requires TokenPlan High-Speed subscription for use with TokenPlan keys. Note: When using TokenPlan, usage is billed per request, not per token.",
	},
} as const satisfies Record<string, ModelInfo>

export const minimaxDefaultModelInfo: ModelInfo = minimaxModels[minimaxDefaultModelId]

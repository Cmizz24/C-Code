import type { ModelInfo } from "../model.js"

const GEMINI_31_PRO_PREVIEW_INFO = {
	maxTokens: 65_536,
	contextWindow: 1_048_576,
	supportsImages: true,
	supportsPromptCache: true,
	supportsReasoningEffort: ["low", "medium", "high"],
	reasoningEffort: "high",

	supportsTemperature: true,
	defaultTemperature: 1,
	inputPrice: 4.0,
	outputPrice: 18.0,
	cacheReadsPrice: 0.4,
	cacheWritesPrice: 4.5,
	tiers: [
		{
			contextWindow: 200_000,
			inputPrice: 2.0,
			outputPrice: 12.0,
			cacheReadsPrice: 0.2,
		},
		{
			contextWindow: Infinity,
			inputPrice: 4.0,
			outputPrice: 18.0,
			cacheReadsPrice: 0.4,
		},
	],
} as const satisfies ModelInfo

const GEMINI_35_FLASH_INFO = {
	maxTokens: 65_536,
	contextWindow: 1_048_576,
	supportsImages: true,
	supportsPromptCache: true,
	supportsReasoningEffort: ["minimal", "low", "medium", "high"],
	reasoningEffort: "medium",

	supportsTemperature: true,
	defaultTemperature: 1,
	inputPrice: 1.5,
	outputPrice: 9.0,
	cacheReadsPrice: 0.15,
	cacheWritesPrice: 1.0,
} as const satisfies ModelInfo

const GEMINI_31_FLASH_LITE_INFO = {
	maxTokens: 65_536,
	contextWindow: 1_048_576,
	supportsImages: true,
	supportsPromptCache: true,
	supportsReasoningEffort: ["minimal", "low", "medium", "high"],
	reasoningEffort: "minimal",

	supportsTemperature: true,
	defaultTemperature: 1,
	inputPrice: 0.25,
	outputPrice: 1.5,
	cacheReadsPrice: 0.025,
	cacheWritesPrice: 1.0,
} as const satisfies ModelInfo

const GEMINI_3_PRO_PREVIEW_INFO = {
	maxTokens: 65_536,
	contextWindow: 1_048_576,
	supportsImages: true,
	supportsPromptCache: true,
	supportsReasoningEffort: ["low", "high"],
	reasoningEffort: "low",

	supportsTemperature: true,
	defaultTemperature: 1,
	inputPrice: 4.0,
	outputPrice: 18.0,
	cacheReadsPrice: 0.4,
	cacheWritesPrice: 4.5,
	tiers: [
		{
			contextWindow: 200_000,
			inputPrice: 2.0,
			outputPrice: 12.0,
			cacheReadsPrice: 0.2,
		},
		{
			contextWindow: Infinity,
			inputPrice: 4.0,
			outputPrice: 18.0,
			cacheReadsPrice: 0.4,
		},
	],
	deprecated: true,
} as const satisfies ModelInfo

const GEMINI_3_FLASH_PREVIEW_INFO = {
	maxTokens: 65_536,
	contextWindow: 1_048_576,
	supportsImages: true,
	supportsPromptCache: true,
	supportsReasoningEffort: ["minimal", "low", "medium", "high"],
	reasoningEffort: "medium",

	supportsTemperature: true,
	defaultTemperature: 1,
	inputPrice: 0.5,
	outputPrice: 3.0,
	cacheReadsPrice: 0.05,
} as const satisfies ModelInfo

const GEMINI_25_PRO_INFO = {
	maxTokens: 65_536,
	contextWindow: 1_048_576,
	supportsImages: true,
	supportsPromptCache: true,

	inputPrice: 2.5, // This is the pricing for prompts above 200k tokens.
	outputPrice: 15,
	cacheReadsPrice: 0.25,
	cacheWritesPrice: 4.5,
	maxThinkingTokens: 32_768,
	supportsReasoningBudget: true,
	requiredReasoningBudget: true,
	tiers: [
		{
			contextWindow: 200_000,
			inputPrice: 1.25,
			outputPrice: 10,
			cacheReadsPrice: 0.125,
		},
		{
			contextWindow: Infinity,
			inputPrice: 2.5,
			outputPrice: 15,
			cacheReadsPrice: 0.25,
		},
	],
} as const satisfies ModelInfo

const GEMINI_25_FLASH_INFO = {
	maxTokens: 65_536,
	contextWindow: 1_048_576,
	supportsImages: true,
	supportsPromptCache: true,

	inputPrice: 0.3,
	outputPrice: 2.5,
	cacheReadsPrice: 0.03,
	cacheWritesPrice: 1.0,
	maxThinkingTokens: 24_576,
	supportsReasoningBudget: true,
} as const satisfies ModelInfo

const GEMINI_25_FLASH_LITE_INFO = {
	maxTokens: 65_536,
	contextWindow: 1_048_576,
	supportsImages: true,
	supportsPromptCache: true,

	inputPrice: 0.1,
	outputPrice: 0.4,
	cacheReadsPrice: 0.01,
	cacheWritesPrice: 1.0,
	maxThinkingTokens: 24_576,
	supportsReasoningBudget: true,
} as const satisfies ModelInfo

// https://ai.google.dev/gemini-api/docs/models/gemini
export type GeminiModelId = keyof typeof geminiModels

export const geminiDefaultModelId: GeminiModelId = "gemini-3.1-pro-preview"

export const geminiModels = {
	"gemini-3.1-pro-preview": GEMINI_31_PRO_PREVIEW_INFO,
	"gemini-3.1-pro-preview-customtools": GEMINI_31_PRO_PREVIEW_INFO,
	"gemini-3.5-flash": GEMINI_35_FLASH_INFO,
	"gemini-flash-latest": GEMINI_35_FLASH_INFO,
	"gemini-3.1-flash-lite": GEMINI_31_FLASH_LITE_INFO,
	"gemini-flash-lite-latest": GEMINI_31_FLASH_LITE_INFO,
	"gemini-3-pro-preview": GEMINI_3_PRO_PREVIEW_INFO,
	"gemini-3-flash-preview": GEMINI_3_FLASH_PREVIEW_INFO,

	// 2.5 Pro models
	"gemini-2.5-pro": GEMINI_25_PRO_INFO,
	"gemini-2.5-pro-preview-06-05": {
		...GEMINI_25_PRO_INFO,
		deprecated: true,
	},
	"gemini-2.5-pro-preview-05-06": {
		...GEMINI_25_PRO_INFO,
		deprecated: true,
	},
	"gemini-2.5-pro-preview-03-25": {
		...GEMINI_25_PRO_INFO,
		deprecated: true,
	},

	// 2.5 Flash models
	"gemini-2.5-flash": GEMINI_25_FLASH_INFO,
	"gemini-2.5-flash-preview-09-2025": {
		...GEMINI_25_FLASH_INFO,
		deprecated: true,
	},

	// 2.5 Flash-Lite models
	"gemini-2.5-flash-lite": GEMINI_25_FLASH_LITE_INFO,
	"gemini-2.5-flash-lite-preview-09-2025": {
		...GEMINI_25_FLASH_LITE_INFO,
		deprecated: true,
	},
} as const satisfies Record<string, ModelInfo>

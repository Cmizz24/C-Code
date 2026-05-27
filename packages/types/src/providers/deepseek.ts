import type { ModelInfo } from "../model.js"

// https://api-docs.deepseek.com/quick_start/pricing
// https://api-docs.deepseek.com/api/create-chat-completion
// https://api-docs.deepseek.com/guides/thinking_mode
// preserveReasoning enables interleaved thinking mode for tool calls:
// DeepSeek requires reasoning_content to be passed back during tool call
// continuation within the same turn.
export type DeepSeekModelId = keyof typeof deepSeekModels

export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-v4-pro"

const DEEP_SEEK_V4_CONTEXT_WINDOW = 1_000_000
const DEEP_SEEK_V4_MAX_OUTPUT_TOKENS = 384_000
const DEEP_SEEK_V4_REASONING = {
	supportsReasoningEffort: ["disable", "high", "xhigh"],
	reasoningEffort: "high",
	requiredReasoningEffort: true,
	preserveReasoning: true,
} as const satisfies Partial<ModelInfo>

const deepSeekV4FlashPricing = {
	inputPrice: 0.14,
	outputPrice: 0.28,
	cacheWritesPrice: 0.14,
	cacheReadsPrice: 0.0028,
} as const satisfies Partial<ModelInfo>

const deepSeekV4ProPricing = {
	// Current official promotional pricing through 2026-05-31 15:59 UTC.
	// The same pricing page lists the scheduled post-promotion prices as
	// cache hit $0.0145, cache miss $1.74, output $3.48 per 1M tokens.
	inputPrice: 0.435,
	outputPrice: 0.87,
	cacheWritesPrice: 0.435,
	cacheReadsPrice: 0.003625,
} as const satisfies Partial<ModelInfo>

const deepSeekV4FlashInfo = {
	maxTokens: DEEP_SEEK_V4_MAX_OUTPUT_TOKENS,
	contextWindow: DEEP_SEEK_V4_CONTEXT_WINDOW,
	supportsImages: false,
	supportsPromptCache: true,
	supportsTemperature: true,
	defaultTemperature: 0.3,
	...DEEP_SEEK_V4_REASONING,
	...deepSeekV4FlashPricing,
} as const satisfies ModelInfo

export const deepSeekModels = {
	"deepseek-v4-pro": {
		maxTokens: DEEP_SEEK_V4_MAX_OUTPUT_TOKENS,
		contextWindow: DEEP_SEEK_V4_CONTEXT_WINDOW,
		supportsImages: false,
		supportsPromptCache: true,
		supportsTemperature: true,
		defaultTemperature: 0.3,
		...DEEP_SEEK_V4_REASONING,
		...deepSeekV4ProPricing,
		description:
			"DeepSeek-V4-Pro: flagship DeepSeek V4 model with 1M context, 384K maximum output, thinking/non-thinking modes, JSON output, tool calls, chat prefix completion (beta), and non-thinking FIM completion (beta).",
	},
	"deepseek-v4-flash": {
		...deepSeekV4FlashInfo,
		description:
			"DeepSeek-V4-Flash: fast, economical DeepSeek V4 model with 1M context, 384K maximum output, thinking/non-thinking modes, JSON output, tool calls, chat prefix completion (beta), and non-thinking FIM completion (beta).",
	},
	"deepseek-chat": {
		...deepSeekV4FlashInfo,
		preserveReasoning: undefined,
		supportsReasoningEffort: undefined,
		reasoningEffort: undefined,
		requiredReasoningEffort: undefined,
		deprecated: true,
		description:
			"Legacy DeepSeek chat model ID retained for existing profiles. Official docs state it maps to deepseek-v4-flash non-thinking mode and will be retired after 2026-07-24 15:59 UTC.",
	},
	"deepseek-reasoner": {
		...deepSeekV4FlashInfo,
		maxThinkingTokens: 384_000,
		deprecated: true,
		description:
			"Legacy DeepSeek reasoner model ID retained for existing profiles. Official docs state it maps to deepseek-v4-flash thinking mode and will be retired after 2026-07-24 15:59 UTC.",
	},
} as const satisfies Record<string, ModelInfo>

// https://api-docs.deepseek.com/api/create-chat-completion
export const DEEP_SEEK_DEFAULT_TEMPERATURE = 0.3

import type { ModelInfo } from "../model.js"

// https://platform.moonshot.ai/
export type MoonshotModelId = keyof typeof moonshotModels

export const moonshotDefaultModelId: MoonshotModelId = "kimi-k2.6"

const KIMI_256K_CONTEXT_WINDOW = 262_144
const KIMI_32K_MAX_OUTPUT_TOKENS = 32_768
const KIMI_DEPRECATED_PREVIEW_DESCRIPTION = "Deprecated preview model retained for existing configurations."

export const moonshotModels = {
	"kimi-k2.6": {
		maxTokens: KIMI_32K_MAX_OUTPUT_TOKENS,
		contextWindow: KIMI_256K_CONTEXT_WINDOW,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningBinary: true,
		preserveReasoning: true,
		supportsTemperature: true,
		defaultTemperature: 1.0,
		inputPrice: 0.95,
		outputPrice: 4.0,
		cacheReadsPrice: 0.16,
		description:
			"Kimi K2.6 is Moonshot AI's latest multimodal model with 256K context, visual/text input, thinking and non-thinking modes, stronger agentic coding, and automatic context caching.",
	},
	"kimi-k2.5": {
		maxTokens: KIMI_32K_MAX_OUTPUT_TOKENS,
		contextWindow: KIMI_256K_CONTEXT_WINDOW,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningBinary: true,
		preserveReasoning: true,
		inputPrice: 0.6,
		outputPrice: 3.0,
		cacheReadsPrice: 0.1,
		supportsTemperature: true,
		defaultTemperature: 1.0,
		description:
			"Kimi K2.5 is Moonshot AI's multimodal Kimi series model with improved reasoning, visual input, and enhanced performance across diverse tasks.",
	},
	"kimi-k2-0711-preview": {
		maxTokens: 32_000,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6, // $0.60 per million tokens (cache miss)
		outputPrice: 2.5, // $2.50 per million tokens
		cacheWritesPrice: 0, // $0 per million tokens (cache miss)
		cacheReadsPrice: 0.15, // $0.15 per million tokens (cache hit)
		deprecated: true,
		description: `${KIMI_DEPRECATED_PREVIEW_DESCRIPTION} Kimi K2 is a state-of-the-art mixture-of-experts (MoE) language model with 32 billion activated parameters and 1 trillion total parameters.`,
	},
	"kimi-k2-0905-preview": {
		maxTokens: 16_384,
		contextWindow: KIMI_256K_CONTEXT_WINDOW,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.6,
		outputPrice: 2.5,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.15,
		deprecated: true,
		description: `${KIMI_DEPRECATED_PREVIEW_DESCRIPTION} Kimi K2 model update with agentic coding improvements, frontend coding improvements, and 256K context support.`,
	},
	"kimi-k2-turbo-preview": {
		maxTokens: 32_000,
		contextWindow: KIMI_256K_CONTEXT_WINDOW,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 2.4, // $2.40 per million tokens (cache miss)
		outputPrice: 10, // $10.00 per million tokens
		cacheWritesPrice: 0, // $0 per million tokens (cache miss)
		cacheReadsPrice: 0.6, // $0.60 per million tokens (cache hit)
		deprecated: true,
		description: `${KIMI_DEPRECATED_PREVIEW_DESCRIPTION} Kimi K2 Turbo is a high-speed version of the Kimi K2 mixture-of-experts (MoE) language model, optimized for faster output speeds.`,
	},
	"kimi-k2-thinking": {
		maxTokens: 16_000, // Recommended ≥ 16,000
		contextWindow: KIMI_256K_CONTEXT_WINDOW, // 262,144 tokens
		supportsImages: false, // Text-only (no image/vision support)
		supportsPromptCache: true,
		supportsReasoningBinary: true,
		inputPrice: 0.6, // $0.60 per million tokens (cache miss)
		outputPrice: 2.5, // $2.50 per million tokens
		cacheWritesPrice: 0, // $0 per million tokens (cache miss)
		cacheReadsPrice: 0.15, // $0.15 per million tokens (cache hit)
		supportsTemperature: true, // Default temperature: 1.0
		preserveReasoning: true,
		defaultTemperature: 1.0,
		deprecated: true,
		description: `${KIMI_DEPRECATED_PREVIEW_DESCRIPTION} The kimi-k2-thinking model is a general-purpose agentic reasoning model developed by Moonshot AI for deep reasoning and multi-turn tool use.`,
	},
	"kimi-k2-thinking-turbo": {
		maxTokens: 16_000,
		contextWindow: KIMI_256K_CONTEXT_WINDOW,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoningBinary: true,
		inputPrice: 2.4,
		outputPrice: 10,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.6,
		supportsTemperature: true,
		preserveReasoning: true,
		defaultTemperature: 1.0,
		deprecated: true,
		description: `${KIMI_DEPRECATED_PREVIEW_DESCRIPTION} Kimi K2 Thinking Turbo is the high-speed variant of Moonshot AI's Kimi K2 reasoning model.`,
	},
	"moonshot-v1-8k": {
		maxTokens: 8_192,
		contextWindow: 8_192,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.5,
		outputPrice: 1.5,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.15,
		description: "Moonshot v1 text model with an 8K context window.",
	},
	"moonshot-v1-32k": {
		maxTokens: 8_192,
		contextWindow: 32_768,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 3.0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.3,
		description: "Moonshot v1 text model with a 32K context window.",
	},
	"moonshot-v1-128k": {
		maxTokens: 8_192,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 9.0,
		outputPrice: 9.0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.9,
		description: "Moonshot v1 text model with a 128K context window.",
	},
} as const satisfies Record<string, ModelInfo>

export const MOONSHOT_DEFAULT_TEMPERATURE = 0.6

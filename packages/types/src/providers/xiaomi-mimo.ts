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

export const xiaomiMiMoModels = {
	"mimo-v2.5-pro": {
		...xiaomiMiMoTextModelInfo,
		description: "Xiaomi MiMo V2.5 Pro model with 1M context and 128K maximum output.",
	},
	"mimo-v2-pro": {
		...xiaomiMiMoTextModelInfo,
		description: "Xiaomi MiMo V2 Pro model with 1M context and 128K maximum output.",
	},
	"mimo-v2.5": {
		...xiaomiMiMoTextModelInfo,
		description: "Xiaomi MiMo V2.5 model with 1M context and 128K maximum output.",
	},
	"mimo-v2-omni": {
		...xiaomiMiMoTextModelInfo,
		contextWindow: XIAOMI_MIMO_256K_CONTEXT_WINDOW,
		description: "Xiaomi MiMo V2 Omni model with 256K context and 128K maximum output.",
	},
	"mimo-v2-flash": {
		...xiaomiMiMoTextModelInfo,
		contextWindow: XIAOMI_MIMO_256K_CONTEXT_WINDOW,
		maxTokens: XIAOMI_MIMO_64K_MAX_OUTPUT_TOKENS,
		description: "Xiaomi MiMo V2 Flash model with 256K context and 64K maximum output.",
	},
} as const satisfies Record<string, ModelInfo>

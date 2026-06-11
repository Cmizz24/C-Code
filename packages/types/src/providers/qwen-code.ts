import type { ModelInfo } from "../model.js"

export type QwenCodeModelId = "qwen3-coder-plus" | "qwen3-coder-flash"

export const qwenCodeDefaultModelId: QwenCodeModelId = "qwen3-coder-plus"

export const qwenCodeModels = {
	"qwen3-coder-plus": {
		maxTokens: 65_536,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description:
			"Qwen3 Coder Plus - High-performance coding model with 1M context window, 65K maximum output, and context cache support for large codebases. Pricing depends on the Qwen Code access path and is not represented by simple per-token fields.",
	},
	"qwen3-coder-flash": {
		maxTokens: 65_536,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description:
			"Qwen3 Coder Flash - Fast coding model with 1M context window, 65K maximum output, and context cache support optimized for speed. Pricing depends on the Qwen Code access path and is not represented by simple per-token fields.",
	},
} as const satisfies Record<QwenCodeModelId, ModelInfo>

import type { ModelInfo } from "../model.js"

// Unbound
// https://gateway.getunbound.ai
export const unboundDefaultModelId = "anthropic/claude-sonnet-4-20250514"

export const unboundDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description:
		"Claude Sonnet 4 is an advanced language model with strong coding, reasoning, and problem-solving capabilities, routed through Unbound.",
}

import type { ModelInfo } from "../model.js"

// Requesty
// https://requesty.ai/router-2
export const requestyDefaultModelId = "coding/claude-sonnet-4-20250514"

export const requestyDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description:
		"The best coding model, optimized by Requesty, and automatically routed to the fastest provider. Claude Sonnet 4 is an advanced large language model with strong coding, reasoning, and problem-solving capabilities.",
}

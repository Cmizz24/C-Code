import type { ModelInfo } from "../model.js"

// https://docs.litellm.ai/
export const litellmDefaultModelId = "claude-3-7-sonnet-20250219"

export const litellmDefaultModelInfo: ModelInfo = {
	contextWindow: 128_000,
	supportsPromptCache: false,
}

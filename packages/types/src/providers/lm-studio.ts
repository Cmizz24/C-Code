import type { ModelInfo } from "../model.js"

export const LMSTUDIO_DEFAULT_TEMPERATURE = 0

// LM Studio
// https://lmstudio.ai/docs/cli/ls
export const lMStudioDefaultModelId = "mistralai/devstral-small-2505"
export const lMStudioDefaultModelInfo: ModelInfo = {
	contextWindow: 128_000,
	supportsPromptCache: false,
	description: "LM Studio-hosted model",
}

import type { ModelInfo } from "../model.js"

// Ollama
// https://ollama.com/models
export const ollamaDefaultModelId = "devstral:24b"
export const ollamaDefaultModelInfo: ModelInfo = {
	contextWindow: 128_000,
	supportsPromptCache: false,
	description: "Ollama-hosted model",
}

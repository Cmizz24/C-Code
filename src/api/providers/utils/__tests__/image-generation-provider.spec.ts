import type { RooCodeSettings } from "@roo-code/types"

import { generateImageWithConfiguredProvider, resolveImageGenerationConfig } from "../image-generation-provider"
import { generateImageWithImagesApi, generateImageWithProvider } from "../image-generation"

vi.mock("../../../../i18n", () => ({
	t: (key: string, options?: Record<string, string>) => {
		if (!options) {
			return key
		}

		const renderedOptions = Object.entries(options)
			.map(([optionKey, optionValue]) => `${optionKey}=${optionValue}`)
			.join(",")
		return `${key}(${renderedOptions})`
	},
}))

vi.mock("../image-generation", () => ({
	generateImageWithImagesApi: vi.fn(),
	generateImageWithProvider: vi.fn(),
}))

const state = (overrides: Partial<RooCodeSettings>): Partial<RooCodeSettings> => overrides

describe("resolveImageGenerationConfig", () => {
	it("should return a localized error when settings are unavailable", () => {
		const result = resolveImageGenerationConfig(undefined)

		expect(result).toEqual({
			success: false,
			error: "tools:generateImage.missingConfiguration",
		})
	})

	it("should resolve legacy OpenRouter settings when no provider is explicitly configured", () => {
		const result = resolveImageGenerationConfig(
			state({
				openRouterImageApiKey: "  openrouter-key  ",
				openRouterImageBaseUrl: "https://openrouter.example/api/v1///",
				openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
			}),
		)

		expect(result.success).toBe(true)
		if (!result.success) {
			throw new Error(result.error)
		}

		expect(result.config).toEqual({
			provider: "openrouter",
			providerLabel: "OpenRouter",
			baseURL: "https://openrouter.example/api/v1",
			authToken: "openrouter-key",
			model: "google/gemini-2.5-flash-image",
			apiMethod: "chat_completions",
		})
	})

	it("should require API keys for remote providers", () => {
		const result = resolveImageGenerationConfig(
			state({
				imageGenerationProvider: "openai",
				openAiImageGenerationSelectedModel: "gpt-image-1",
			}),
		)

		expect(result.success).toBe(false)
		if (result.success) {
			throw new Error("Expected remote provider resolution to fail without an API key")
		}
		expect(result.error).toBe("tools:generateImage.apiKeyRequired(provider=OpenAI / OpenAI Compatible)")
	})

	it("should lock known OpenAI models to their required API method", () => {
		const result = resolveImageGenerationConfig(
			state({
				imageGenerationProvider: "openai",
				openAiImageApiKey: "openai-key",
				openAiImageGenerationSelectedModel: "dall-e-3",
				openAiImageGenerationApiMethod: "chat_completions",
			}),
		)

		expect(result.success).toBe(true)
		if (!result.success) {
			throw new Error(result.error)
		}

		expect(result.config).toMatchObject({
			provider: "openai",
			baseURL: "https://api.openai.com/v1",
			authToken: "openai-key",
			model: "dall-e-3",
			apiMethod: "images_api",
		})
	})

	it("should allow local providers without API keys but require a model ID", () => {
		const missingModelResult = resolveImageGenerationConfig(
			state({
				imageGenerationProvider: "ollama",
			}),
		)

		expect(missingModelResult.success).toBe(false)
		if (missingModelResult.success) {
			throw new Error("Expected local provider resolution to fail without a model")
		}
		expect(missingModelResult.error).toBe("tools:generateImage.modelRequired(provider=Ollama)")

		const result = resolveImageGenerationConfig(
			state({
				imageGenerationProvider: "ollama",
				ollamaImageBaseUrl: "http://localhost:11434/v1/",
				ollamaImageGenerationSelectedModel: "llava:latest",
				ollamaImageGenerationApiMethod: "chat_completions",
			}),
		)

		expect(result.success).toBe(true)
		if (!result.success) {
			throw new Error(result.error)
		}

		expect(result.config).toEqual({
			provider: "ollama",
			providerLabel: "Ollama",
			baseURL: "http://localhost:11434/v1",
			authToken: undefined,
			model: "llava:latest",
			apiMethod: "chat_completions",
		})
	})

	it("should report unsupported API methods for provider definitions", () => {
		const result = resolveImageGenerationConfig(
			state({
				imageGenerationProvider: "openrouter",
				openRouterImageApiKey: "openrouter-key",
				openRouterImageGenerationApiMethod: "images_api",
			}),
		)

		expect(result.success).toBe(false)
		if (result.success) {
			throw new Error("Expected OpenRouter images_api resolution to fail")
		}
		expect(result.error).toBe("tools:generateImage.unsupportedApiMethod(provider=OpenRouter,apiMethod=images_api)")
	})
})

describe("generateImageWithConfiguredProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(generateImageWithImagesApi).mockResolvedValue({
			success: true,
			imageData: "data:image/png;base64,imagesapi",
			imageFormat: "png",
		})
		vi.mocked(generateImageWithProvider).mockResolvedValue({
			success: true,
			imageData: "data:image/png;base64,chatcompletions",
			imageFormat: "png",
		})
	})

	it("should dispatch Images API configurations to the Images API helper", async () => {
		const result = await generateImageWithConfiguredProvider({
			state: state({
				imageGenerationProvider: "openai",
				openAiImageApiKey: "openai-key",
				openAiImageGenerationSelectedModel: "gpt-image-1",
			}),
			prompt: "Draw a cat",
			inputImage: "data:image/png;base64,input",
		})

		expect(result).toEqual({
			success: true,
			imageData: "data:image/png;base64,imagesapi",
			imageFormat: "png",
		})
		expect(generateImageWithImagesApi).toHaveBeenCalledWith({
			baseURL: "https://api.openai.com/v1",
			authToken: "openai-key",
			model: "gpt-image-1",
			prompt: "Draw a cat",
			inputImage: "data:image/png;base64,input",
		})
		expect(generateImageWithProvider).not.toHaveBeenCalled()
	})

	it("should dispatch chat-completions configurations to the chat-completions helper", async () => {
		const result = await generateImageWithConfiguredProvider({
			state: state({
				imageGenerationProvider: "openrouter",
				openRouterImageApiKey: "openrouter-key",
				openRouterImageBaseUrl: "https://openrouter.example/api/v1/",
				openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
			}),
			prompt: "Draw a dog",
		})

		expect(result).toEqual({
			success: true,
			imageData: "data:image/png;base64,chatcompletions",
			imageFormat: "png",
		})
		expect(generateImageWithProvider).toHaveBeenCalledWith({
			baseURL: "https://openrouter.example/api/v1",
			authToken: "openrouter-key",
			model: "google/gemini-2.5-flash-image",
			prompt: "Draw a dog",
			inputImage: undefined,
		})
		expect(generateImageWithImagesApi).not.toHaveBeenCalled()
	})

	it("should dispatch OpenAI-compatible custom chat-completions models", async () => {
		await generateImageWithConfiguredProvider({
			state: state({
				imageGenerationProvider: "openai",
				openAiImageApiKey: "compatible-key",
				openAiImageBaseUrl: "https://compatible.example/v1/",
				openAiImageGenerationSelectedModel: "custom-image-model",
				openAiImageGenerationApiMethod: "chat_completions",
			}),
			prompt: "Draw with a custom model",
		})

		expect(generateImageWithProvider).toHaveBeenCalledWith({
			baseURL: "https://compatible.example/v1",
			authToken: "compatible-key",
			model: "custom-image-model",
			prompt: "Draw with a custom model",
			inputImage: undefined,
		})
		expect(generateImageWithImagesApi).not.toHaveBeenCalled()
	})

	it("should return resolver errors without calling provider helpers", async () => {
		const result = await generateImageWithConfiguredProvider({
			state: state({
				imageGenerationProvider: "openai",
			}),
			prompt: "Draw without settings",
		})

		expect(result).toEqual({
			success: false,
			error: "tools:generateImage.apiKeyRequired(provider=OpenAI / OpenAI Compatible)",
		})
		expect(generateImageWithImagesApi).not.toHaveBeenCalled()
		expect(generateImageWithProvider).not.toHaveBeenCalled()
	})
})

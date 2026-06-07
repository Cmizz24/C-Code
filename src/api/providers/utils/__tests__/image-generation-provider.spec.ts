import type { RooCodeSettings } from "@roo-code/types"

import { generateImageWithConfiguredProvider, resolveImageGenerationConfig } from "../image-generation-provider"
import {
	generateImageWithAutomatic1111,
	generateImageWithComfyUi,
	generateImageWithImagesApi,
	generateImageWithProvider,
} from "../image-generation"

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
	generateImageWithAutomatic1111: vi.fn(),
	generateImageWithComfyUi: vi.fn(),
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
			isLocal: false,
			authToken: "openrouter-key",
			model: "google/gemini-2.5-flash-image",
			apiMethod: "chat_completions",
			negativePrompt: undefined,
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

	it("should resolve ComfyUI settings with required checkpoint and optional auth", () => {
		const missingModelResult = resolveImageGenerationConfig(
			state({
				imageGenerationProvider: "comfyui",
			}),
		)

		expect(missingModelResult.success).toBe(false)
		if (missingModelResult.success) {
			throw new Error("Expected ComfyUI resolution to fail without a checkpoint")
		}
		expect(missingModelResult.error).toBe("tools:generateImage.modelRequired(provider=ComfyUI)")

		const result = resolveImageGenerationConfig(
			state({
				imageGenerationProvider: "comfyui",
				comfyUiImageApiKey: "  local-proxy-token  ",
				comfyUiImageBaseUrl: " http://127.0.0.1:8188/// ",
				comfyUiImageGenerationSelectedModel: "  sdxl.safetensors  ",
				comfyUiImageGenerationApiMethod: "comfyui_api",
				comfyUiImageGenerationNegativePrompt: "  blurry, low quality  ",
			}),
		)

		expect(result.success).toBe(true)
		if (!result.success) {
			throw new Error(result.error)
		}

		expect(result.config).toEqual({
			provider: "comfyui",
			providerLabel: "ComfyUI",
			baseURL: "http://127.0.0.1:8188",
			isLocal: true,
			authToken: "local-proxy-token",
			model: "sdxl.safetensors",
			apiMethod: "comfyui_api",
			negativePrompt: "blurry, low quality",
		})
	})

	it("should resolve Automatic1111 settings without requiring a checkpoint override", () => {
		const result = resolveImageGenerationConfig(
			state({
				imageGenerationProvider: "automatic1111",
				automatic1111ImageGenerationSelectedModel: "   ",
				automatic1111ImageGenerationNegativePrompt: "  bad anatomy  ",
			}),
		)

		expect(result.success).toBe(true)
		if (!result.success) {
			throw new Error(result.error)
		}

		expect(result.config).toEqual({
			provider: "automatic1111",
			providerLabel: "Automatic1111",
			baseURL: "http://127.0.0.1:7860",
			isLocal: true,
			authToken: undefined,
			model: "",
			apiMethod: "automatic1111_api",
			negativePrompt: "bad anatomy",
		})
	})

	it("should reject legacy unsupported local providers", () => {
		const ollamaResult = resolveImageGenerationConfig(
			state({
				imageGenerationProvider: "ollama",
				ollamaImageBaseUrl: "http://localhost:11434",
				ollamaImageGenerationSelectedModel: "llava:latest",
				ollamaImageGenerationApiMethod: "chat_completions",
			}),
		)

		expect(ollamaResult).toEqual({
			success: false,
			error: "tools:generateImage.unsupportedProvider(provider=Ollama)",
		})

		const lmStudioResult = resolveImageGenerationConfig(
			state({
				imageGenerationProvider: "lmstudio",
				lmStudioImageBaseUrl: "http://localhost:1234",
				lmStudioImageGenerationSelectedModel: "local-image-model",
				lmStudioImageGenerationApiMethod: "images_api",
			}),
		)

		expect(lmStudioResult).toEqual({
			success: false,
			error: "tools:generateImage.unsupportedProvider(provider=LM Studio)",
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
		vi.mocked(generateImageWithComfyUi).mockResolvedValue({
			success: true,
			imageData: "data:image/png;base64,comfyui",
			imageFormat: "png",
		})
		vi.mocked(generateImageWithAutomatic1111).mockResolvedValue({
			success: true,
			imageData: "data:image/png;base64,automatic1111",
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
			metadata: {
				provider: "openai",
				providerLabel: "OpenAI / OpenAI Compatible",
				baseURL: "https://api.openai.com/v1",
				model: "gpt-image-1",
				apiMethod: "images_api",
				isLocal: false,
			},
		})
		expect(generateImageWithImagesApi).toHaveBeenCalledWith({
			baseURL: "https://api.openai.com/v1",
			authToken: "openai-key",
			model: "gpt-image-1",
			prompt: "Draw a cat",
			inputImage: "data:image/png;base64,input",
			negativePrompt: undefined,
			provider: "openai",
		})
		expect(generateImageWithProvider).not.toHaveBeenCalled()
		expect(generateImageWithComfyUi).not.toHaveBeenCalled()
		expect(generateImageWithAutomatic1111).not.toHaveBeenCalled()
	})

	it("should reject legacy unsupported local providers without calling provider helpers", async () => {
		const result = await generateImageWithConfiguredProvider({
			state: state({
				imageGenerationProvider: "ollama",
				ollamaImageBaseUrl: "http://localhost:11434/v1/",
				ollamaImageGenerationSelectedModel: "x/z-image-turbo",
				ollamaImageGenerationApiMethod: "images_api",
			}),
			prompt: "Draw locally",
		})

		expect(result).toEqual({
			success: false,
			error: "tools:generateImage.unsupportedProvider(provider=Ollama)",
		})
		expect(generateImageWithImagesApi).not.toHaveBeenCalled()
		expect(generateImageWithProvider).not.toHaveBeenCalled()
		expect(generateImageWithComfyUi).not.toHaveBeenCalled()
		expect(generateImageWithAutomatic1111).not.toHaveBeenCalled()
	})

	it("should dispatch ComfyUI configurations to the ComfyUI helper", async () => {
		const result = await generateImageWithConfiguredProvider({
			state: state({
				imageGenerationProvider: "comfyui",
				comfyUiImageApiKey: "proxy-token",
				comfyUiImageBaseUrl: "http://localhost:8188/",
				comfyUiImageGenerationSelectedModel: "sdxl.safetensors",
				comfyUiImageGenerationNegativePrompt: "blurry",
			}),
			prompt: "Draw locally with ComfyUI",
		})

		expect(result).toEqual({
			success: true,
			imageData: "data:image/png;base64,comfyui",
			imageFormat: "png",
			metadata: {
				provider: "comfyui",
				providerLabel: "ComfyUI",
				baseURL: "http://localhost:8188",
				model: "sdxl.safetensors",
				apiMethod: "comfyui_api",
				isLocal: true,
			},
		})
		expect(generateImageWithComfyUi).toHaveBeenCalledWith({
			baseURL: "http://localhost:8188",
			authToken: "proxy-token",
			model: "sdxl.safetensors",
			prompt: "Draw locally with ComfyUI",
			inputImage: undefined,
			negativePrompt: "blurry",
			provider: "comfyui",
		})
		expect(generateImageWithImagesApi).not.toHaveBeenCalled()
		expect(generateImageWithProvider).not.toHaveBeenCalled()
		expect(generateImageWithAutomatic1111).not.toHaveBeenCalled()
	})

	it("should dispatch Automatic1111 configurations to the Automatic1111 helper", async () => {
		const result = await generateImageWithConfiguredProvider({
			state: state({
				imageGenerationProvider: "automatic1111",
				automatic1111ImageBaseUrl: "http://localhost:7860/",
				automatic1111ImageGenerationSelectedModel: "   ",
				automatic1111ImageGenerationNegativePrompt: "bad anatomy",
			}),
			prompt: "Draw locally with Automatic1111",
		})

		expect(result).toEqual({
			success: true,
			imageData: "data:image/png;base64,automatic1111",
			imageFormat: "png",
			metadata: {
				provider: "automatic1111",
				providerLabel: "Automatic1111",
				baseURL: "http://localhost:7860",
				model: "",
				apiMethod: "automatic1111_api",
				isLocal: true,
			},
		})
		expect(generateImageWithAutomatic1111).toHaveBeenCalledWith({
			baseURL: "http://localhost:7860",
			authToken: undefined,
			model: "",
			prompt: "Draw locally with Automatic1111",
			inputImage: undefined,
			negativePrompt: "bad anatomy",
			provider: "automatic1111",
		})
		expect(generateImageWithImagesApi).not.toHaveBeenCalled()
		expect(generateImageWithProvider).not.toHaveBeenCalled()
		expect(generateImageWithComfyUi).not.toHaveBeenCalled()
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
			metadata: {
				provider: "openrouter",
				providerLabel: "OpenRouter",
				baseURL: "https://openrouter.example/api/v1",
				model: "google/gemini-2.5-flash-image",
				apiMethod: "chat_completions",
				isLocal: false,
			},
		})
		expect(generateImageWithProvider).toHaveBeenCalledWith({
			baseURL: "https://openrouter.example/api/v1",
			authToken: "openrouter-key",
			model: "google/gemini-2.5-flash-image",
			prompt: "Draw a dog",
			inputImage: undefined,
			negativePrompt: undefined,
			provider: "openrouter",
		})
		expect(generateImageWithImagesApi).not.toHaveBeenCalled()
		expect(generateImageWithComfyUi).not.toHaveBeenCalled()
		expect(generateImageWithAutomatic1111).not.toHaveBeenCalled()
	})

	it("should dispatch OpenAI-compatible custom chat-completions models", async () => {
		const result = await generateImageWithConfiguredProvider({
			state: state({
				imageGenerationProvider: "openai",
				openAiImageApiKey: "compatible-key",
				openAiImageBaseUrl: "https://compatible.example/v1/",
				openAiImageGenerationSelectedModel: "custom-image-model",
				openAiImageGenerationApiMethod: "chat_completions",
			}),
			prompt: "Draw with a custom model",
		})

		expect(result.metadata).toEqual({
			provider: "openai",
			providerLabel: "OpenAI / OpenAI Compatible",
			baseURL: "https://compatible.example/v1",
			model: "custom-image-model",
			apiMethod: "chat_completions",
			isLocal: false,
		})

		expect(generateImageWithProvider).toHaveBeenCalledWith({
			baseURL: "https://compatible.example/v1",
			authToken: "compatible-key",
			model: "custom-image-model",
			prompt: "Draw with a custom model",
			inputImage: undefined,
			negativePrompt: undefined,
			provider: "openai",
		})
		expect(generateImageWithImagesApi).not.toHaveBeenCalled()
		expect(generateImageWithComfyUi).not.toHaveBeenCalled()
		expect(generateImageWithAutomatic1111).not.toHaveBeenCalled()
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
		expect(generateImageWithComfyUi).not.toHaveBeenCalled()
		expect(generateImageWithAutomatic1111).not.toHaveBeenCalled()
	})
})

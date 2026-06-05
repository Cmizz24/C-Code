/**
 * API method used for image generation
 */
export type ImageGenerationApiMethod = "chat_completions" | "images_api"

export const IMAGE_GENERATION_API_METHODS = ["chat_completions", "images_api"] as const

export const IMAGE_GENERATION_PROVIDER_IDS = ["openrouter", "openai", "ollama", "lmstudio"] as const

/**
 * Image generation provider type.
 *
 * This intentionally stays separate from chat provider profiles so image-generation
 * settings can be configured independently from the active model/profile.
 */
export type ImageGenerationProvider = (typeof IMAGE_GENERATION_PROVIDER_IDS)[number]

export interface ImageGenerationProviderSettingsKeys {
	apiKey?: "openRouterImageApiKey" | "openAiImageApiKey" | "ollamaImageApiKey" | "lmStudioImageApiKey"
	baseUrl: "openRouterImageBaseUrl" | "openAiImageBaseUrl" | "ollamaImageBaseUrl" | "lmStudioImageBaseUrl"
	model:
		| "openRouterImageGenerationSelectedModel"
		| "openAiImageGenerationSelectedModel"
		| "ollamaImageGenerationSelectedModel"
		| "lmStudioImageGenerationSelectedModel"
	apiMethod:
		| "openRouterImageGenerationApiMethod"
		| "openAiImageGenerationApiMethod"
		| "ollamaImageGenerationApiMethod"
		| "lmStudioImageGenerationApiMethod"
}

export interface ImageGenerationProviderDefinition {
	value: ImageGenerationProvider
	label: string
	requiresApiKey: boolean
	supportsOptionalApiKey?: boolean
	isLocal: boolean
	defaultBaseUrl: string
	defaultModel: string
	defaultApiMethod: ImageGenerationApiMethod
	supportedApiMethods: ImageGenerationApiMethod[]
	supportsCustomModelId: boolean
	apiKeyUrl?: string
	settingsKeys: ImageGenerationProviderSettingsKeys
}

export interface ImageGenerationModel {
	value: string
	label: string
	provider: ImageGenerationProvider
	apiMethod?: ImageGenerationApiMethod
	supportsImageInput?: boolean
	isCustom?: boolean
}

export const IMAGE_GENERATION_PROVIDERS: Record<ImageGenerationProvider, ImageGenerationProviderDefinition> = {
	openrouter: {
		value: "openrouter",
		label: "OpenRouter",
		requiresApiKey: true,
		isLocal: false,
		defaultBaseUrl: "https://openrouter.ai/api/v1",
		defaultModel: "google/gemini-2.5-flash-image",
		defaultApiMethod: "chat_completions",
		supportedApiMethods: ["chat_completions"],
		supportsCustomModelId: false,
		apiKeyUrl: "https://openrouter.ai/keys",
		settingsKeys: {
			apiKey: "openRouterImageApiKey",
			baseUrl: "openRouterImageBaseUrl",
			model: "openRouterImageGenerationSelectedModel",
			apiMethod: "openRouterImageGenerationApiMethod",
		},
	},
	openai: {
		value: "openai",
		label: "OpenAI / OpenAI Compatible",
		requiresApiKey: true,
		isLocal: false,
		defaultBaseUrl: "https://api.openai.com/v1",
		defaultModel: "gpt-image-1",
		defaultApiMethod: "images_api",
		supportedApiMethods: ["images_api", "chat_completions"],
		supportsCustomModelId: true,
		apiKeyUrl: "https://platform.openai.com/api-keys",
		settingsKeys: {
			apiKey: "openAiImageApiKey",
			baseUrl: "openAiImageBaseUrl",
			model: "openAiImageGenerationSelectedModel",
			apiMethod: "openAiImageGenerationApiMethod",
		},
	},
	ollama: {
		value: "ollama",
		label: "Ollama",
		requiresApiKey: false,
		supportsOptionalApiKey: true,
		isLocal: true,
		defaultBaseUrl: "http://localhost:11434/v1",
		defaultModel: "",
		defaultApiMethod: "images_api",
		supportedApiMethods: ["images_api", "chat_completions"],
		supportsCustomModelId: true,
		settingsKeys: {
			apiKey: "ollamaImageApiKey",
			baseUrl: "ollamaImageBaseUrl",
			model: "ollamaImageGenerationSelectedModel",
			apiMethod: "ollamaImageGenerationApiMethod",
		},
	},
	lmstudio: {
		value: "lmstudio",
		label: "LM Studio",
		requiresApiKey: false,
		supportsOptionalApiKey: true,
		isLocal: true,
		defaultBaseUrl: "http://localhost:1234/v1",
		defaultModel: "",
		defaultApiMethod: "images_api",
		supportedApiMethods: ["images_api", "chat_completions"],
		supportsCustomModelId: true,
		settingsKeys: {
			apiKey: "lmStudioImageApiKey",
			baseUrl: "lmStudioImageBaseUrl",
			model: "lmStudioImageGenerationSelectedModel",
			apiMethod: "lmStudioImageGenerationApiMethod",
		},
	},
}

export const IMAGE_GENERATION_MODELS: ImageGenerationModel[] = [
	// OpenRouter models
	{ value: "google/gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image", provider: "openrouter" },
	{ value: "google/gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview", provider: "openrouter" },
	{ value: "openai/gpt-5-image", label: "GPT-5 Image", provider: "openrouter" },
	{ value: "openai/gpt-5-image-mini", label: "GPT-5 Image Mini", provider: "openrouter" },
	{ value: "black-forest-labs/flux.2-flex", label: "Black Forest Labs FLUX.2 Flex", provider: "openrouter" },
	{ value: "black-forest-labs/flux.2-pro", label: "Black Forest Labs FLUX.2 Pro", provider: "openrouter" },

	// OpenAI native / OpenAI-compatible images API models
	{
		value: "gpt-image-1",
		label: "GPT Image 1",
		provider: "openai",
		apiMethod: "images_api",
		supportsImageInput: true,
	},
	{ value: "dall-e-3", label: "DALL·E 3", provider: "openai", apiMethod: "images_api" },
	{ value: "dall-e-2", label: "DALL·E 2", provider: "openai", apiMethod: "images_api", supportsImageInput: true },
]

/**
 * Get array of model values only (for backend validation)
 */
export const IMAGE_GENERATION_MODEL_IDS = IMAGE_GENERATION_MODELS.map((m) => m.value)

/**
 * Image generation provider definitions as an array for UI rendering.
 */
export const IMAGE_GENERATION_PROVIDER_DEFINITIONS = IMAGE_GENERATION_PROVIDER_IDS.map(
	(provider) => IMAGE_GENERATION_PROVIDERS[provider],
)

export function isImageGenerationProvider(provider: string | undefined): provider is ImageGenerationProvider {
	return IMAGE_GENERATION_PROVIDER_IDS.includes(provider as ImageGenerationProvider)
}

export function isImageGenerationApiMethod(method: string | undefined): method is ImageGenerationApiMethod {
	return IMAGE_GENERATION_API_METHODS.includes(method as ImageGenerationApiMethod)
}

/**
 * Get the image generation provider with backwards compatibility
 * - If provider is explicitly set, use it
 * - If a model is already configured (existing users), default to "openrouter"
 * - Otherwise default to "openrouter" (new users)
 */
export function getImageGenerationProvider(
	explicitProvider: ImageGenerationProvider | undefined,
	_hasExistingModel: boolean,
): ImageGenerationProvider {
	return explicitProvider !== undefined && isImageGenerationProvider(explicitProvider)
		? explicitProvider
		: "openrouter"
}

export function getImageGenerationProviderDefinition(
	provider: ImageGenerationProvider | undefined,
): ImageGenerationProviderDefinition {
	return IMAGE_GENERATION_PROVIDERS[getImageGenerationProvider(provider, false)]
}

export function getImageGenerationModels(provider: ImageGenerationProvider): ImageGenerationModel[] {
	return IMAGE_GENERATION_MODELS.filter((model) => model.provider === provider)
}

export function getDefaultImageGenerationModel(provider: ImageGenerationProvider): string {
	const definition = IMAGE_GENERATION_PROVIDERS[provider]
	return definition.defaultModel || getImageGenerationModels(provider)[0]?.value || ""
}

export function getDefaultImageGenerationBaseUrl(provider: ImageGenerationProvider): string {
	return IMAGE_GENERATION_PROVIDERS[provider].defaultBaseUrl
}

export function getDefaultImageGenerationApiMethod(provider: ImageGenerationProvider): ImageGenerationApiMethod {
	return IMAGE_GENERATION_PROVIDERS[provider].defaultApiMethod
}

export function getImageGenerationModel(
	provider: ImageGenerationProvider,
	modelId: string | undefined,
): ImageGenerationModel | undefined {
	return IMAGE_GENERATION_MODELS.find((model) => model.provider === provider && model.value === modelId)
}

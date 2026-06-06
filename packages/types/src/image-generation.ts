/**
 * API method used for image generation
 */
export type ImageGenerationApiMethod = "chat_completions" | "images_api" | "comfyui_api" | "automatic1111_api"

export const IMAGE_GENERATION_API_METHODS = [
	"chat_completions",
	"images_api",
	"comfyui_api",
	"automatic1111_api",
] as const

export const IMAGE_GENERATION_ACTIVE_PROVIDER_IDS = ["openrouter", "openai", "comfyui", "automatic1111"] as const

export const IMAGE_GENERATION_LEGACY_UNSUPPORTED_PROVIDER_IDS = ["ollama", "lmstudio"] as const

export const IMAGE_GENERATION_PROVIDER_IDS = [
	...IMAGE_GENERATION_ACTIVE_PROVIDER_IDS,
	...IMAGE_GENERATION_LEGACY_UNSUPPORTED_PROVIDER_IDS,
] as const

/**
 * Image generation provider type.
 *
 * This intentionally stays separate from chat provider profiles so image-generation
 * settings can be configured independently from the active model/profile.
 */
export type ImageGenerationProvider = (typeof IMAGE_GENERATION_PROVIDER_IDS)[number]

export type ActiveImageGenerationProvider = (typeof IMAGE_GENERATION_ACTIVE_PROVIDER_IDS)[number]

export type LegacyUnsupportedImageGenerationProvider = (typeof IMAGE_GENERATION_LEGACY_UNSUPPORTED_PROVIDER_IDS)[number]

export interface ImageGenerationProviderSettingsKeys {
	apiKey?:
		| "openRouterImageApiKey"
		| "openAiImageApiKey"
		| "comfyUiImageApiKey"
		| "automatic1111ImageApiKey"
		| "ollamaImageApiKey"
		| "lmStudioImageApiKey"
	baseUrl:
		| "openRouterImageBaseUrl"
		| "openAiImageBaseUrl"
		| "comfyUiImageBaseUrl"
		| "automatic1111ImageBaseUrl"
		| "ollamaImageBaseUrl"
		| "lmStudioImageBaseUrl"
	model:
		| "openRouterImageGenerationSelectedModel"
		| "openAiImageGenerationSelectedModel"
		| "comfyUiImageGenerationSelectedModel"
		| "automatic1111ImageGenerationSelectedModel"
		| "ollamaImageGenerationSelectedModel"
		| "lmStudioImageGenerationSelectedModel"
	apiMethod:
		| "openRouterImageGenerationApiMethod"
		| "openAiImageGenerationApiMethod"
		| "comfyUiImageGenerationApiMethod"
		| "automatic1111ImageGenerationApiMethod"
		| "ollamaImageGenerationApiMethod"
		| "lmStudioImageGenerationApiMethod"
	negativePrompt?: "comfyUiImageGenerationNegativePrompt" | "automatic1111ImageGenerationNegativePrompt"
}

export interface ImageGenerationProviderDefinition {
	value: ImageGenerationProvider
	label: string
	requiresApiKey: boolean
	supportsOptionalApiKey?: boolean
	isLocal: boolean
	defaultBaseUrl: string
	defaultModel: string
	requiresModel?: boolean
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
	comfyui: {
		value: "comfyui",
		label: "ComfyUI",
		requiresApiKey: false,
		supportsOptionalApiKey: true,
		isLocal: true,
		defaultBaseUrl: "http://127.0.0.1:8188",
		defaultModel: "",
		requiresModel: true,
		defaultApiMethod: "comfyui_api",
		supportedApiMethods: ["comfyui_api"],
		supportsCustomModelId: true,
		settingsKeys: {
			apiKey: "comfyUiImageApiKey",
			baseUrl: "comfyUiImageBaseUrl",
			model: "comfyUiImageGenerationSelectedModel",
			apiMethod: "comfyUiImageGenerationApiMethod",
			negativePrompt: "comfyUiImageGenerationNegativePrompt",
		},
	},
	automatic1111: {
		value: "automatic1111",
		label: "Automatic1111",
		requiresApiKey: false,
		supportsOptionalApiKey: true,
		isLocal: true,
		defaultBaseUrl: "http://127.0.0.1:7860",
		defaultModel: "",
		requiresModel: false,
		defaultApiMethod: "automatic1111_api",
		supportedApiMethods: ["automatic1111_api"],
		supportsCustomModelId: true,
		settingsKeys: {
			apiKey: "automatic1111ImageApiKey",
			baseUrl: "automatic1111ImageBaseUrl",
			model: "automatic1111ImageGenerationSelectedModel",
			apiMethod: "automatic1111ImageGenerationApiMethod",
			negativePrompt: "automatic1111ImageGenerationNegativePrompt",
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
		supportedApiMethods: [],
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
		supportedApiMethods: [],
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
	{ value: "openai/gpt-5.4-image-2", label: "GPT-5.4 Image 2 (Paid)", provider: "openrouter" },
	{
		value: "google/gemini-3.1-flash-image-preview",
		label: "Gemini 3.1 Flash Image Preview (Paid)",
		provider: "openrouter",
	},
	{
		value: "google/gemini-3-pro-image-preview",
		label: "Gemini 3 Pro Image Preview (Paid)",
		provider: "openrouter",
	},
	{ value: "openai/gpt-5-image-mini", label: "GPT-5 Image Mini (Paid)", provider: "openrouter" },
	{ value: "openai/gpt-5-image", label: "GPT-5 Image (Paid)", provider: "openrouter" },
	{ value: "google/gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image (Paid)", provider: "openrouter" },
	{ value: "openrouter/auto", label: "OpenRouter Auto (Variable/unknown pricing)", provider: "openrouter" },

	// OpenAI native / OpenAI-compatible images API models
	{
		value: "gpt-image-2",
		label: "GPT Image 2 (Paid)",
		provider: "openai",
		apiMethod: "images_api",
		supportsImageInput: true,
	},
	{
		value: "gpt-image-1.5",
		label: "GPT Image 1.5 (Paid)",
		provider: "openai",
		apiMethod: "images_api",
		supportsImageInput: true,
	},
	{
		value: "gpt-image-1",
		label: "GPT Image 1 (Paid)",
		provider: "openai",
		apiMethod: "images_api",
		supportsImageInput: true,
	},
	{
		value: "gpt-image-1-mini",
		label: "GPT Image 1 Mini (Paid)",
		provider: "openai",
		apiMethod: "images_api",
		supportsImageInput: true,
	},
	{ value: "dall-e-3", label: "DALL·E 3 (legacy compatibility)", provider: "openai", apiMethod: "images_api" },
	{
		value: "dall-e-2",
		label: "DALL·E 2 (legacy compatibility)",
		provider: "openai",
		apiMethod: "images_api",
		supportsImageInput: true,
	},
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

export const ACTIVE_IMAGE_GENERATION_PROVIDER_DEFINITIONS = IMAGE_GENERATION_ACTIVE_PROVIDER_IDS.map(
	(provider) => IMAGE_GENERATION_PROVIDERS[provider],
)

export function isImageGenerationProvider(provider: string | undefined): provider is ImageGenerationProvider {
	return IMAGE_GENERATION_PROVIDER_IDS.includes(provider as ImageGenerationProvider)
}

export function isActiveImageGenerationProvider(
	provider: string | undefined,
): provider is ActiveImageGenerationProvider {
	return IMAGE_GENERATION_ACTIVE_PROVIDER_IDS.includes(provider as ActiveImageGenerationProvider)
}

export function isLegacyUnsupportedImageGenerationProvider(
	provider: string | undefined,
): provider is LegacyUnsupportedImageGenerationProvider {
	return IMAGE_GENERATION_LEGACY_UNSUPPORTED_PROVIDER_IDS.includes(
		provider as LegacyUnsupportedImageGenerationProvider,
	)
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
): ActiveImageGenerationProvider {
	return explicitProvider !== undefined && isActiveImageGenerationProvider(explicitProvider)
		? explicitProvider
		: "openrouter"
}

export function getImageGenerationProviderDefinition(
	provider: ImageGenerationProvider | undefined,
): ImageGenerationProviderDefinition {
	return IMAGE_GENERATION_PROVIDERS[getImageGenerationProvider(provider, false)]
}

export function getImageGenerationModels(provider: ActiveImageGenerationProvider): ImageGenerationModel[] {
	return IMAGE_GENERATION_MODELS.filter((model) => model.provider === provider)
}

export function getDefaultImageGenerationModel(provider: ActiveImageGenerationProvider): string {
	const definition = IMAGE_GENERATION_PROVIDERS[provider]
	return definition.defaultModel || getImageGenerationModels(provider)[0]?.value || ""
}

export function getDefaultImageGenerationBaseUrl(provider: ActiveImageGenerationProvider): string {
	return IMAGE_GENERATION_PROVIDERS[provider].defaultBaseUrl
}

export function getDefaultImageGenerationApiMethod(provider: ActiveImageGenerationProvider): ImageGenerationApiMethod {
	return IMAGE_GENERATION_PROVIDERS[provider].defaultApiMethod
}

export function getImageGenerationModel(
	provider: ActiveImageGenerationProvider,
	modelId: string | undefined,
): ImageGenerationModel | undefined {
	return IMAGE_GENERATION_MODELS.find((model) => model.provider === provider && model.value === modelId)
}

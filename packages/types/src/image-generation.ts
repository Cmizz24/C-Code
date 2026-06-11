/**
 * API method used for image generation
 */
export type ImageGenerationApiMethod =
	| "chat_completions"
	| "images_api"
	| "workers_ai"
	| "comfyui_api"
	| "automatic1111_api"

export const IMAGE_GENERATION_API_METHODS = [
	"chat_completions",
	"images_api",
	"workers_ai",
	"comfyui_api",
	"automatic1111_api",
] as const

export const IMAGE_GENERATION_ACTIVE_PROVIDER_IDS = ["openrouter", "openai", "cloudflare"] as const

export const IMAGE_GENERATION_REMOVED_PROVIDER_IDS = ["comfyui", "automatic1111"] as const

export const IMAGE_GENERATION_LEGACY_UNSUPPORTED_PROVIDER_IDS = ["ollama", "lmstudio"] as const

export const IMAGE_GENERATION_PROVIDER_IDS = [
	...IMAGE_GENERATION_ACTIVE_PROVIDER_IDS,
	...IMAGE_GENERATION_REMOVED_PROVIDER_IDS,
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

export type RemovedImageGenerationProvider = (typeof IMAGE_GENERATION_REMOVED_PROVIDER_IDS)[number]

export type LegacyUnsupportedImageGenerationProvider = (typeof IMAGE_GENERATION_LEGACY_UNSUPPORTED_PROVIDER_IDS)[number]

export type ImageGenerationToolStatus = "pending" | "running" | "completed" | "error"

export type ImageGenerationUsageSource =
	| "provider_response"
	| "provider_response_with_local_quota"
	| "local_estimate"
	| "unknown"

export interface ImageGenerationUsageDetails {
	tokensIn?: number
	tokensOut?: number
	totalTokens?: number
	imageCount?: number
	neurons?: number
	estimatedNeurons?: number
	cost?: number
	estimatedCost?: number
	currency?: string
	usageSource?: ImageGenerationUsageSource
	dailyQuotaNeurons?: number
	estimatedUsedNeuronsToday?: number
	estimatedRemainingNeurons?: number
	quotaResetAt?: string
	pricingDescription?: string
	quotaDescription?: string
}

export interface GeneratedImageMetadata {
	status?: ImageGenerationToolStatus
	prompt?: string
	originalPrompt?: string
	editedPrompt?: string
	path?: string
	outputPath?: string
	inputImage?: string
	provider?: ActiveImageGenerationProvider
	providerLabel?: string
	model?: string
	baseURL?: string
	apiMethod?: ImageGenerationApiMethod
	isLocal?: boolean
	imageFormat?: string
	imageWidth?: number
	imageHeight?: number
	usage?: ImageGenerationUsageDetails
	error?: string
}

export interface ImageGenerationProviderSettingsKeys {
	apiKey?:
		| "openRouterImageApiKey"
		| "openAiImageApiKey"
		| "cloudflareImageApiKey"
		| "comfyUiImageApiKey"
		| "automatic1111ImageApiKey"
		| "ollamaImageApiKey"
		| "lmStudioImageApiKey"
	accountId?: "cloudflareImageAccountId"
	baseUrl:
		| "openRouterImageBaseUrl"
		| "openAiImageBaseUrl"
		| "cloudflareImageBaseUrl"
		| "comfyUiImageBaseUrl"
		| "automatic1111ImageBaseUrl"
		| "ollamaImageBaseUrl"
		| "lmStudioImageBaseUrl"
	model:
		| "openRouterImageGenerationSelectedModel"
		| "openAiImageGenerationSelectedModel"
		| "cloudflareImageGenerationSelectedModel"
		| "comfyUiImageGenerationSelectedModel"
		| "automatic1111ImageGenerationSelectedModel"
		| "ollamaImageGenerationSelectedModel"
		| "lmStudioImageGenerationSelectedModel"
	apiMethod:
		| "openRouterImageGenerationApiMethod"
		| "openAiImageGenerationApiMethod"
		| "cloudflareImageGenerationApiMethod"
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

export const CLOUDFLARE_WORKERS_AI_DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4"

export const CLOUDFLARE_WORKERS_AI_FREE_ALLOCATION = {
	neuronsPerDay: "10,000 Neurons per day",
	resetTime: "00:00 UTC",
	paidOverage: "$0.011 / 1,000 Neurons",
} as const

export const CLOUDFLARE_WORKERS_AI_DAILY_FREE_NEURONS = 10_000

export const CLOUDFLARE_WORKERS_AI_PAID_OVERAGE_USD_PER_1000_NEURONS = 0.011

export interface CloudflareWorkersAiImageUsageState {
	utcDate: string
	neuronsUsed: number
	requestCount: number
	providerReportedNeuronsUsed?: number
	estimatedNeuronsUsed?: number
	updatedAt: string
}

export interface CloudflareWorkersAiImageUsageUpdate {
	neurons: number
	source: Extract<ImageGenerationUsageSource, "provider_response" | "local_estimate">
}

export interface CloudflareWorkersAiImageUsageSnapshot extends CloudflareWorkersAiImageUsageState {
	dailyQuotaNeurons: number
	estimatedRemainingNeurons: number
	resetAt: string
	source: Extract<ImageGenerationUsageSource, "local_estimate">
}

export interface CloudflareWorkersAiImageGenerationEstimateOptions {
	model: string
	imageWidth?: number
	imageHeight?: number
	hasInputImage?: boolean
}

export interface CloudflareWorkersAiImageGenerationEstimate {
	estimatedNeurons: number
	estimatedCost: number
	currency: "USD"
	outputTileCount: number
	outputMegapixels: number
	basis: "image_dimensions" | "default_512_tile"
}

const roundCloudflareNeuronValue = (value: number): number => Math.round(value * 100) / 100

const roundCloudflareCostValue = (value: number): number => Math.round(value * 1_000_000) / 1_000_000

const getNonNegativeFiniteNumber = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0

const getPositiveInteger = (value: unknown): number | undefined => {
	const numericValue = getNonNegativeFiniteNumber(value)
	return numericValue > 0 ? Math.trunc(numericValue) : undefined
}

export function getCloudflareWorkersAiUtcDate(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10)
}

export function getCloudflareWorkersAiNextResetIso(now: Date = new Date()): string {
	const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0))
	return reset.toISOString()
}

export function getCurrentCloudflareWorkersAiImageUsageState(
	state?: CloudflareWorkersAiImageUsageState,
	now: Date = new Date(),
): CloudflareWorkersAiImageUsageState {
	const utcDate = getCloudflareWorkersAiUtcDate(now)

	if (!state || state.utcDate !== utcDate) {
		return {
			utcDate,
			neuronsUsed: 0,
			requestCount: 0,
			updatedAt: now.toISOString(),
		}
	}

	const providerReportedNeuronsUsed = getNonNegativeFiniteNumber(state.providerReportedNeuronsUsed)
	const estimatedNeuronsUsed = getNonNegativeFiniteNumber(state.estimatedNeuronsUsed)

	return {
		utcDate,
		neuronsUsed: getNonNegativeFiniteNumber(state.neuronsUsed),
		requestCount: Math.trunc(getNonNegativeFiniteNumber(state.requestCount)),
		...(providerReportedNeuronsUsed > 0 && { providerReportedNeuronsUsed }),
		...(estimatedNeuronsUsed > 0 && { estimatedNeuronsUsed }),
		updatedAt: typeof state.updatedAt === "string" && state.updatedAt ? state.updatedAt : now.toISOString(),
	}
}

export function getCloudflareWorkersAiImageUsageSnapshot(
	state?: CloudflareWorkersAiImageUsageState,
	now: Date = new Date(),
): CloudflareWorkersAiImageUsageSnapshot {
	const currentState = getCurrentCloudflareWorkersAiImageUsageState(state, now)
	const neuronsUsed = roundCloudflareNeuronValue(currentState.neuronsUsed)

	return {
		...currentState,
		neuronsUsed,
		dailyQuotaNeurons: CLOUDFLARE_WORKERS_AI_DAILY_FREE_NEURONS,
		estimatedRemainingNeurons: roundCloudflareNeuronValue(
			Math.max(CLOUDFLARE_WORKERS_AI_DAILY_FREE_NEURONS - neuronsUsed, 0),
		),
		resetAt: getCloudflareWorkersAiNextResetIso(now),
		source: "local_estimate",
	}
}

export function applyCloudflareWorkersAiImageUsageUpdate(
	state: CloudflareWorkersAiImageUsageState | undefined,
	update: CloudflareWorkersAiImageUsageUpdate,
	now: Date = new Date(),
): CloudflareWorkersAiImageUsageState {
	const currentState = getCurrentCloudflareWorkersAiImageUsageState(state, now)
	const neurons = roundCloudflareNeuronValue(getNonNegativeFiniteNumber(update.neurons))

	if (neurons <= 0) {
		return currentState
	}

	const providerReportedNeuronsUsed =
		update.source === "provider_response"
			? roundCloudflareNeuronValue(getNonNegativeFiniteNumber(currentState.providerReportedNeuronsUsed) + neurons)
			: currentState.providerReportedNeuronsUsed
	const estimatedNeuronsUsed =
		update.source === "local_estimate"
			? roundCloudflareNeuronValue(getNonNegativeFiniteNumber(currentState.estimatedNeuronsUsed) + neurons)
			: currentState.estimatedNeuronsUsed

	return {
		...currentState,
		neuronsUsed: roundCloudflareNeuronValue(currentState.neuronsUsed + neurons),
		requestCount: currentState.requestCount + 1,
		...(providerReportedNeuronsUsed !== undefined &&
			providerReportedNeuronsUsed > 0 && { providerReportedNeuronsUsed }),
		...(estimatedNeuronsUsed !== undefined && estimatedNeuronsUsed > 0 && { estimatedNeuronsUsed }),
		updatedAt: now.toISOString(),
	}
}

export function estimateCloudflareWorkersAiImageGenerationUsage({
	model,
	imageWidth,
	imageHeight,
	hasInputImage = false,
}: CloudflareWorkersAiImageGenerationEstimateOptions): CloudflareWorkersAiImageGenerationEstimate {
	const width = getPositiveInteger(imageWidth)
	const height = getPositiveInteger(imageHeight)
	const hasDimensions = width !== undefined && height !== undefined
	const outputTileCount = hasDimensions ? Math.max(1, Math.ceil(width / 512) * Math.ceil(height / 512)) : 1
	const outputMegapixels = hasDimensions ? Math.max((width * height) / (1024 * 1024), 1) : 1
	const normalizedModel = model.trim()

	let estimatedNeurons: number

	switch (normalizedModel) {
		case "@cf/leonardo/lucid-origin":
			estimatedNeurons = outputTileCount * 636
			break
		case "@cf/leonardo/phoenix-1.0":
			estimatedNeurons = outputTileCount * 530
			break
		case "@cf/black-forest-labs/flux-2-dev":
			estimatedNeurons = outputTileCount * 37.5 + (hasInputImage ? outputTileCount * 18.75 : 0)
			break
		case "@cf/black-forest-labs/flux-2-klein-4b":
			estimatedNeurons = outputTileCount * 26.05 + (hasInputImage ? outputTileCount * 5.37 : 0)
			break
		case "@cf/black-forest-labs/flux-2-klein-9b":
			estimatedNeurons =
				1363.64 + Math.max(outputMegapixels - 1, 0) * 181.82 + (hasInputImage ? outputMegapixels * 181.82 : 0)
			break
		case "@cf/black-forest-labs/flux-1-schnell":
		default:
			estimatedNeurons = outputTileCount * 4.8
			break
	}

	const roundedNeurons = roundCloudflareNeuronValue(estimatedNeurons)

	return {
		estimatedNeurons: roundedNeurons,
		estimatedCost: roundCloudflareCostValue(
			(roundedNeurons / 1_000) * CLOUDFLARE_WORKERS_AI_PAID_OVERAGE_USD_PER_1000_NEURONS,
		),
		currency: "USD",
		outputTileCount,
		outputMegapixels: roundCloudflareNeuronValue(outputMegapixels),
		basis: hasDimensions ? "image_dimensions" : "default_512_tile",
	}
}

export const CLOUDFLARE_WORKERS_AI_IMAGE_MODEL_PRICING = [
	{
		model: "@cf/black-forest-labs/flux-1-schnell",
		label: "FLUX.1 Schnell",
		requestFormat: "json",
		priceDetails: ["$0.0000528 per 512x512 tile", "$0.0001056 per step"],
		neuronDetails: ["4.80 neurons per 512x512 tile", "9.60 neurons per step"],
	},
	{
		model: "@cf/leonardo/lucid-origin",
		label: "Leonardo Lucid Origin",
		requestFormat: "json",
		priceDetails: ["$0.006996 per 512x512 tile", "$0.000132 per step"],
		neuronDetails: ["636.00 neurons per 512x512 tile", "12.00 neurons per step"],
	},
	{
		model: "@cf/leonardo/phoenix-1.0",
		label: "Leonardo Phoenix 1.0",
		requestFormat: "json",
		priceDetails: ["$0.005830 per 512x512 tile", "$0.000110 per step"],
		neuronDetails: ["530.00 neurons per 512x512 tile", "10.00 neurons per step"],
	},
	{
		model: "@cf/black-forest-labs/flux-2-dev",
		label: "FLUX.2 Dev",
		requestFormat: "multipart",
		priceDetails: ["$0.00021 per input 512x512 tile, per step", "$0.00041 per output 512x512 tile, per step"],
		neuronDetails: [
			"18.75 neurons per input 512x512 tile, per step",
			"37.50 neurons per output 512x512 tile, per step",
		],
	},
	{
		model: "@cf/black-forest-labs/flux-2-klein-4b",
		label: "FLUX.2 Klein 4B",
		requestFormat: "multipart",
		priceDetails: ["$0.000059 per input 512x512 tile", "$0.000287 per output 512x512 tile"],
		neuronDetails: ["5.37 neurons per input 512x512 tile", "26.05 neurons per output 512x512 tile"],
	},
	{
		model: "@cf/black-forest-labs/flux-2-klein-9b",
		label: "FLUX.2 Klein 9B",
		requestFormat: "multipart",
		priceDetails: ["$0.015 per first MP (1024x1024)", "$0.002 per subsequent MP", "$0.002 per input image MP"],
		neuronDetails: [
			"1363.64 neurons per first MP (1024x1024)",
			"181.82 neurons per subsequent MP",
			"181.82 neurons per input image MP",
		],
	},
] as const

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
	cloudflare: {
		value: "cloudflare",
		label: "Cloudflare Workers AI",
		requiresApiKey: true,
		isLocal: false,
		defaultBaseUrl: CLOUDFLARE_WORKERS_AI_DEFAULT_BASE_URL,
		defaultModel: "@cf/black-forest-labs/flux-1-schnell",
		defaultApiMethod: "workers_ai",
		supportedApiMethods: ["workers_ai"],
		supportsCustomModelId: false,
		apiKeyUrl: "https://dash.cloudflare.com/profile/api-tokens",
		settingsKeys: {
			apiKey: "cloudflareImageApiKey",
			accountId: "cloudflareImageAccountId",
			baseUrl: "cloudflareImageBaseUrl",
			model: "cloudflareImageGenerationSelectedModel",
			apiMethod: "cloudflareImageGenerationApiMethod",
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

	// Cloudflare Workers AI models
	{
		value: "@cf/black-forest-labs/flux-1-schnell",
		label: "FLUX.1 Schnell",
		provider: "cloudflare",
		apiMethod: "workers_ai",
	},
	{
		value: "@cf/leonardo/lucid-origin",
		label: "Leonardo Lucid Origin",
		provider: "cloudflare",
		apiMethod: "workers_ai",
	},
	{
		value: "@cf/leonardo/phoenix-1.0",
		label: "Leonardo Phoenix 1.0",
		provider: "cloudflare",
		apiMethod: "workers_ai",
	},
	{
		value: "@cf/black-forest-labs/flux-2-dev",
		label: "FLUX.2 Dev",
		provider: "cloudflare",
		apiMethod: "workers_ai",
		supportsImageInput: true,
	},
	{
		value: "@cf/black-forest-labs/flux-2-klein-4b",
		label: "FLUX.2 Klein 4B",
		provider: "cloudflare",
		apiMethod: "workers_ai",
		supportsImageInput: true,
	},
	{
		value: "@cf/black-forest-labs/flux-2-klein-9b",
		label: "FLUX.2 Klein 9B",
		provider: "cloudflare",
		apiMethod: "workers_ai",
		supportsImageInput: true,
	},

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

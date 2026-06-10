import axios from "axios"
import { z } from "zod"
import {
	BedrockClient,
	type BedrockClientConfig,
	ListFoundationModelsCommand,
	ListInferenceProfilesCommand,
} from "@aws-sdk/client-bedrock"
import { fromIni } from "@aws-sdk/credential-providers"

import {
	type ModelInfo,
	type ModelRecord,
	bedrockModels,
	anthropicModels,
	xaiModels,
	openAiNativeModels,
	mistralModels,
	deepSeekModels,
	geminiModels,
	moonshotModels,
	sambaNovaModels,
	fireworksModels,
	basetenModels,
	minimaxModels,
	xiaomiMiMoModels,
} from "@roo-code/types"
import type { GetModelsOptions } from "../../../shared/api"

const DEFAULT_DYNAMIC_MODEL_INFO: ModelInfo = {
	contextWindow: 128_000,
	supportsPromptCache: false,
}

type BedrockModelsOptions = Extract<GetModelsOptions, { provider: "bedrock" }>

type BedrockControlClientConfig = BedrockClientConfig & {
	token?: { token: string }
	authSchemePreference?: string[]
}

const BEDROCK_INFERENCE_PROFILE_PREFIXES = ["global.", "us.", "eu.", "apac.", "au.", "jp.", "ca.", "sa.", "ug."]

const openAiCompatibleModelsResponseSchema = z.object({
	data: z.array(z.object({ id: z.string() }).passthrough()),
})

const capabilitySupportSchema = z.object({ supported: z.boolean().optional() }).passthrough()

const mistralCapabilitySchema = z.union([z.boolean(), capabilitySupportSchema]).optional()

const mistralModelSchema = z
	.object({
		id: z.string(),
		description: z.string().nullable().optional(),
		max_context_length: z.number().nullable().optional(),
		context_length: z.number().nullable().optional(),
		context_window: z.number().nullable().optional(),
		maxContextLength: z.number().nullable().optional(),
		max_output_tokens: z.number().nullable().optional(),
		max_completion_tokens: z.number().nullable().optional(),
		max_tokens: z.number().nullable().optional(),
		input_modalities: z.array(z.string()).nullable().optional(),
		output_modalities: z.array(z.string()).nullable().optional(),
		modalities: z.array(z.string()).nullable().optional(),
		capabilities: z
			.object({
				vision: z.boolean().optional(),
				image_input: mistralCapabilitySchema,
				image_output: mistralCapabilitySchema,
				function_calling: z.boolean().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough()

const mistralModelsResponseSchema = z.union([
	z.object({ data: z.array(mistralModelSchema) }).passthrough(),
	z.array(mistralModelSchema),
])

type MistralModel = z.infer<typeof mistralModelSchema>

const anthropicModelsResponseSchema = z.object({
	data: z.array(
		z
			.object({
				id: z.string(),
				display_name: z.string().optional(),
				max_input_tokens: z.number().optional(),
				max_tokens: z.number().optional(),
				capabilities: z
					.object({
						image_input: capabilitySupportSchema.optional(),
						thinking: capabilitySupportSchema.optional(),
					})
					.passthrough()
					.optional(),
			})
			.passthrough(),
	),
	first_id: z.string().optional(),
	has_more: z.boolean().optional(),
	last_id: z.string().optional(),
})

const minimaxModelsResponseSchema = z.object({
	data: z.array(
		z
			.object({
				id: z.string(),
				display_name: z.string().optional(),
				created_at: z.string().optional(),
				type: z.literal("model").optional(),
			})
			.passthrough(),
	),
	first_id: z.string().optional(),
	has_more: z.boolean().optional(),
	last_id: z.string().optional(),
})

const geminiModelsResponseSchema = z.object({
	models: z.array(
		z
			.object({
				name: z.string(),
				baseModelId: z.string().optional(),
				displayName: z.string().optional(),
				description: z.string().optional(),
				inputTokenLimit: z.number().optional(),
				outputTokenLimit: z.number().optional(),
				supportedGenerationMethods: z.array(z.string()).optional(),
				thinking: z.boolean().optional(),
				temperature: z.number().optional(),
				maxTemperature: z.number().optional(),
			})
			.passthrough(),
	),
	nextPageToken: z.string().optional(),
})

const moonshotModelsResponseSchema = z.object({
	data: z.array(
		z
			.object({
				id: z.string(),
				context_length: z.number().optional(),
				max_completion_tokens: z.number().optional(),
				max_tokens: z.number().optional(),
				supports_image_in: z.boolean().optional(),
				supports_video_in: z.boolean().optional(),
				supports_reasoning: z.boolean().optional(),
			})
			.passthrough(),
	),
})

const providerPricingSchema = z
	.object({
		prompt: z.union([z.string(), z.number()]).nullish(),
		completion: z.union([z.string(), z.number()]).nullish(),
		input: z.union([z.string(), z.number()]).nullish(),
		output: z.union([z.string(), z.number()]).nullish(),
		cache_read: z.union([z.string(), z.number()]).nullish(),
		input_cache_read: z.union([z.string(), z.number()]).nullish(),
		cached_prompt: z.union([z.string(), z.number()]).nullish(),
	})
	.passthrough()

const openAiCompatibleCapabilitySchema = z.union([z.boolean(), capabilitySupportSchema]).optional()

const sambaNovaModelsResponseSchema = z.object({
	data: z.array(
		z
			.object({
				id: z.string(),
				context_length: z.number().optional(),
				context_window: z.number().optional(),
				max_context_length: z.number().optional(),
				max_completion_tokens: z.number().optional(),
				max_output_tokens: z.number().optional(),
				max_tokens: z.number().optional(),
				description: z.string().optional(),
				input_modalities: z.array(z.string()).optional(),
				modalities: z.array(z.string()).optional(),
				capabilities: z
					.object({
						vision: z.boolean().optional(),
						image_input: openAiCompatibleCapabilitySchema,
					})
					.passthrough()
					.optional(),
				pricing: providerPricingSchema.optional(),
			})
			.passthrough(),
	),
})

const xaiModelSchema = z
	.object({
		id: z.string(),
		aliases: z.array(z.string()).optional(),
		input_modalities: z.array(z.string()).optional(),
		output_modalities: z.array(z.string()).optional(),
		context_window: z.number().optional(),
		max_prompt_text_tokens: z.number().optional(),
		max_completion_tokens: z.number().optional(),
		prompt_text_token_price: z.number().nullable().optional(),
		prompt_text_token_price_long_context: z.number().nullable().optional(),
		completion_text_token_price: z.number().nullable().optional(),
		completion_text_token_price_long_context: z.number().nullable().optional(),
		cached_prompt_text_token_price: z.number().nullable().optional(),
		cached_prompt_text_token_price_long_context: z.number().nullable().optional(),
		long_context_threshold: z.number().nullable().optional(),
		image_price: z.number().nullable().optional(),
	})
	.passthrough()

const xaiLanguageModelsResponseSchema = z.object({
	models: z.array(xaiModelSchema),
})

const xaiModelsResponseSchema = z.object({
	data: z.array(xaiModelSchema),
})

type XaiModel = z.infer<typeof xaiModelSchema>

const basetenModelSchema = z
	.object({
		id: z.string(),
		name: z.string().optional(),
		context_length: z.number().optional(),
		context_window: z.number().optional(),
		max_context_length: z.number().optional(),
		max_completion_tokens: z.number().optional(),
		max_output_tokens: z.number().optional(),
		max_tokens: z.number().optional(),
		description: z.string().optional(),
		supports_image_input: z.boolean().optional(),
		supports_images: z.boolean().optional(),
		supports_vision: z.boolean().optional(),
		supports_reasoning_effort: z.boolean().optional(),
		input_modalities: z.array(z.string()).optional(),
		modalities: z.array(z.string()).optional(),
		capabilities: z
			.object({
				vision: z.boolean().optional(),
				image_input: openAiCompatibleCapabilitySchema,
				reasoning_effort: openAiCompatibleCapabilitySchema,
				thinking: openAiCompatibleCapabilitySchema,
			})
			.passthrough()
			.optional(),
		pricing: providerPricingSchema.optional(),
	})
	.passthrough()

const basetenModelsResponseSchema = z.union([
	z.object({
		data: z.array(basetenModelSchema),
	}),
	z.object({
		models: z.array(
			basetenModelSchema.extend({
				created_at: z.string().optional(),
			}),
		),
	}),
])

const fireworksModelsResponseSchema = z.object({
	models: z.array(
		z
			.object({
				name: z.string(),
				displayName: z.string().optional(),
				contextLength: z.number().optional(),
				maxContextLength: z.number().optional(),
				maxCompletionTokens: z.number().optional(),
				maxOutputTokens: z.number().optional(),
				maxTokens: z.number().optional(),
				supportsImageInput: z.boolean().optional(),
				supportsTools: z.boolean().optional(),
				supportsServerless: z.boolean().optional(),
				deprecationDate: z.string().nullable().optional(),
				state: z.string().optional(),
				description: z.string().optional(),
			})
			.passthrough(),
	),
	nextPageToken: z.string().optional(),
})

type SambaNovaModel = z.infer<typeof sambaNovaModelsResponseSchema>["data"][number]
type BasetenModel = z.infer<typeof basetenModelSchema>
type FireworksModel = z.infer<typeof fireworksModelsResponseSchema>["models"][number]

function mergeModelInfo(modelId: string, fallbackModels: ModelRecord, dynamicInfo: Partial<ModelInfo> = {}): ModelInfo {
	const definedDynamicInfo = Object.fromEntries(
		Object.entries(dynamicInfo).filter(([, value]) => value !== undefined),
	) as Partial<ModelInfo>

	return {
		...DEFAULT_DYNAMIC_MODEL_INFO,
		...fallbackModels[modelId],
		...definedDynamicInfo,
		contextWindow:
			definedDynamicInfo.contextWindow ??
			fallbackModels[modelId]?.contextWindow ??
			DEFAULT_DYNAMIC_MODEL_INFO.contextWindow,
		supportsPromptCache:
			definedDynamicInfo.supportsPromptCache ??
			fallbackModels[modelId]?.supportsPromptCache ??
			DEFAULT_DYNAMIC_MODEL_INFO.supportsPromptCache,
	}
}

function stripBedrockInferenceProfilePrefix(modelId: string): string {
	for (const prefix of BEDROCK_INFERENCE_PROFILE_PREFIXES) {
		if (modelId.startsWith(prefix)) {
			return modelId.substring(prefix.length)
		}
	}

	return modelId
}

function getModelIdFromBedrockArn(arn?: string): string | undefined {
	return arn?.match(/(?:foundation-model|inference-profile|application-inference-profile)\/(.+)$/)?.[1]
}

function getBedrockModelInfo(modelId: string, description?: string, metadataModelId = modelId): ModelInfo {
	const bedrockModelRecord = bedrockModels as ModelRecord
	const baseModelId = stripBedrockInferenceProfilePrefix(metadataModelId)
	const staticModelInfo = bedrockModelRecord[metadataModelId] ?? bedrockModelRecord[baseModelId]

	if (staticModelInfo) {
		return { ...staticModelInfo }
	}

	return {
		...DEFAULT_DYNAMIC_MODEL_INFO,
		...(description ? { description } : {}),
	}
}

function supportsBedrockTextGeneration(outputModalities?: string[]): boolean {
	return !outputModalities?.length || outputModalities.includes("TEXT")
}

function createBedrockClient(options: BedrockModelsOptions): BedrockClient | undefined {
	const region = options.awsRegion?.trim()

	if (!region) {
		return undefined
	}

	const clientConfig: BedrockControlClientConfig = { region }
	const endpoint = options.awsBedrockEndpoint?.trim()

	if (options.awsBedrockEndpointEnabled && endpoint) {
		clientConfig.endpoint = endpoint
	}

	if (options.awsUseApiKey && options.awsApiKey?.trim()) {
		clientConfig.token = { token: options.awsApiKey.trim() }
		clientConfig.authSchemePreference = ["httpBearerAuth"]
	} else if (options.awsUseProfile && options.awsProfile?.trim()) {
		clientConfig.credentials = fromIni({
			profile: options.awsProfile.trim(),
			ignoreCache: true,
		})
	} else if (options.awsAccessKey?.trim() && options.awsSecretKey?.trim()) {
		clientConfig.credentials = {
			accessKeyId: options.awsAccessKey.trim(),
			secretAccessKey: options.awsSecretKey.trim(),
			...(options.awsSessionToken?.trim() ? { sessionToken: options.awsSessionToken.trim() } : {}),
		}
	}

	return new BedrockClient(clientConfig)
}

function getAnthropicThinkingCapabilities(modelId: string, thinkingSupported?: boolean): Partial<ModelInfo> {
	if ((anthropicModels as ModelRecord)[modelId]?.supportsReasoningAdaptive) {
		return {}
	}

	return { supportsReasoningBudget: thinkingSupported }
}

function positiveCentsPer100MillionTokensToDollarsPerMillion(price?: number | null): number | undefined {
	return typeof price === "number" && price > 0 ? price / 10_000 : undefined
}

function positiveNumber(value?: number | null): number | undefined {
	return typeof value === "number" && value > 0 ? value : undefined
}

function capabilitySupported(value?: boolean | { supported?: boolean }): boolean | undefined {
	return typeof value === "boolean" ? value : value?.supported
}

function hasModality(modalities: string[] | null | undefined, expected: string): boolean | undefined {
	return modalities?.some((modality) => modality.toLowerCase() === expected) || undefined
}

function normalizeMistralModelInfo(model: MistralModel): Partial<ModelInfo> {
	const inputSupportsImages =
		model.capabilities?.vision ??
		capabilitySupported(model.capabilities?.image_input) ??
		hasModality(model.input_modalities, "image") ??
		hasModality(model.modalities, "image")
	const outputSupportsImages =
		capabilitySupported(model.capabilities?.image_output) ?? hasModality(model.output_modalities, "image")

	return {
		contextWindow: positiveNumber(
			model.max_context_length ?? model.context_length ?? model.context_window ?? model.maxContextLength,
		),
		maxTokens: positiveNumber(model.max_output_tokens ?? model.max_completion_tokens ?? model.max_tokens),
		description: model.description ?? undefined,
		supportsImages: inputSupportsImages,
		supportsImageOutput: outputSupportsImages,
	}
}

function getVersionedEndpoint(baseUrl: string, versionPath: string, endpointPath: string): string | undefined {
	const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")

	if (!URL.canParse(normalizedBaseUrl)) {
		return undefined
	}

	const versionPrefix = `/${versionPath.replace(/^\/+/, "")}`
	const baseUrlWithVersion = normalizedBaseUrl.endsWith(versionPrefix)
		? normalizedBaseUrl
		: `${normalizedBaseUrl}${versionPrefix}`

	return `${baseUrlWithVersion}${endpointPath}`
}

function getMiniMaxModelsEndpoint(baseUrl: string): string | undefined {
	const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")

	if (!URL.canParse(normalizedBaseUrl)) {
		return undefined
	}

	if (normalizedBaseUrl.endsWith("/anthropic/v1/models")) {
		return normalizedBaseUrl
	}

	if (normalizedBaseUrl.endsWith("/anthropic/v1")) {
		return `${normalizedBaseUrl}/models`
	}

	if (normalizedBaseUrl.endsWith("/anthropic")) {
		return `${normalizedBaseUrl}/v1/models`
	}

	if (normalizedBaseUrl.endsWith("/v1")) {
		return `${normalizedBaseUrl.replace(/\/v1$/, "/anthropic/v1")}/models`
	}

	return `${normalizedBaseUrl}/anthropic/v1/models`
}

function getGeminiModelsEndpoint(baseUrl: string): string | undefined {
	const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")

	if (!URL.canParse(normalizedBaseUrl)) {
		return undefined
	}

	if (normalizedBaseUrl.endsWith("/models")) {
		return normalizedBaseUrl
	}

	if (normalizedBaseUrl.endsWith("/v1beta")) {
		return `${normalizedBaseUrl}/models`
	}

	return `${normalizedBaseUrl}/v1beta/models`
}

function normalizeGeminiModelId(modelName: string): string {
	return modelName.replace(/^models\//, "")
}

function supportsGeminiContentGeneration(methods?: string[]): boolean {
	return !methods?.length || methods.includes("generateContent") || methods.includes("streamGenerateContent")
}

function priceMultiplier(longContextPrice?: number | null, standardPrice?: number | null): number | undefined {
	return typeof longContextPrice === "number" &&
		longContextPrice > 0 &&
		typeof standardPrice === "number" &&
		standardPrice > 0
		? longContextPrice / standardPrice
		: undefined
}

function dollarsPerTokenToDollarsPerMillion(price?: string | number | null): number | undefined {
	if (price === undefined || price === null || price === "") {
		return undefined
	}

	const parsed = typeof price === "number" ? price : Number(price)

	if (!Number.isFinite(parsed) || parsed <= 0) {
		return undefined
	}

	return parsed < 0.1 ? parsed * 1_000_000 : parsed
}

function firstPositiveNumber(...values: Array<number | null | undefined>): number | undefined {
	for (const value of values) {
		const positive = positiveNumber(value)
		if (positive !== undefined) {
			return positive
		}
	}

	return undefined
}

function normalizeProviderPricing(pricing?: z.infer<typeof providerPricingSchema>): Partial<ModelInfo> {
	return {
		inputPrice: dollarsPerTokenToDollarsPerMillion(pricing?.prompt ?? pricing?.input),
		outputPrice: dollarsPerTokenToDollarsPerMillion(pricing?.completion ?? pricing?.output),
		cacheReadsPrice: dollarsPerTokenToDollarsPerMillion(
			pricing?.cache_read ?? pricing?.input_cache_read ?? pricing?.cached_prompt,
		),
	}
}

function hasImageInput(modalities?: string[] | null): boolean | undefined {
	return modalities?.some((modality) => modality.toLowerCase() === "image") || undefined
}

function normalizeOpenAiCompatibleImageSupport(model: SambaNovaModel | BasetenModel): boolean | undefined {
	const modelWithOptionalCapabilities = model as {
		supports_image_input?: boolean
		supports_images?: boolean
		supports_vision?: boolean
		capabilities?: {
			vision?: boolean
			image_input?: boolean | { supported?: boolean }
		}
		input_modalities?: string[]
		modalities?: string[]
	}

	return (
		modelWithOptionalCapabilities.supports_image_input ??
		modelWithOptionalCapabilities.supports_images ??
		modelWithOptionalCapabilities.supports_vision ??
		modelWithOptionalCapabilities.capabilities?.vision ??
		capabilitySupported(modelWithOptionalCapabilities.capabilities?.image_input) ??
		hasImageInput(modelWithOptionalCapabilities.input_modalities) ??
		hasImageInput(modelWithOptionalCapabilities.modalities)
	)
}

function normalizeBasetenReasoningEffortSupport(model: BasetenModel): ModelInfo["supportsReasoningEffort"] | undefined {
	const dynamicSupport =
		model.supports_reasoning_effort ??
		capabilitySupported(model.capabilities?.reasoning_effort) ??
		capabilitySupported(model.capabilities?.thinking)

	if (dynamicSupport === true) {
		return ["low", "medium", "high"]
	}

	return undefined
}

function normalizeFireworksDeprecated(model: FireworksModel): boolean | undefined {
	if (model.deprecationDate) {
		return true
	}

	const normalizedState = model.state?.toLowerCase()

	return normalizedState?.includes("deprecated") || normalizedState?.includes("decommission") || undefined
}

function getSparseSafeDescription(
	modelId: string,
	fallbackModels: ModelRecord,
	description?: string,
): string | undefined {
	return fallbackModels[modelId]?.description ? undefined : description
}

function buildXaiLongContextPricing(model: XaiModel): ModelInfo["longContextPricing"] {
	const thresholdTokens = positiveNumber(model.long_context_threshold)

	if (!thresholdTokens) {
		return undefined
	}

	const inputPriceMultiplier = priceMultiplier(
		model.prompt_text_token_price_long_context,
		model.prompt_text_token_price,
	)
	const outputPriceMultiplier = priceMultiplier(
		model.completion_text_token_price_long_context,
		model.completion_text_token_price,
	)
	const cacheReadsPriceMultiplier = priceMultiplier(
		model.cached_prompt_text_token_price_long_context,
		model.cached_prompt_text_token_price,
	)

	if (!inputPriceMultiplier && !outputPriceMultiplier && !cacheReadsPriceMultiplier) {
		return undefined
	}

	return {
		thresholdTokens,
		inputPriceMultiplier,
		outputPriceMultiplier,
		cacheReadsPriceMultiplier,
	}
}

function shouldIncludeXaiLanguageModel(model: XaiModel): boolean {
	if (model.output_modalities?.length && !model.output_modalities.includes("text")) {
		return false
	}

	const hasTextTokenPricing =
		typeof model.prompt_text_token_price === "number" || typeof model.completion_text_token_price === "number"

	return !(typeof model.image_price === "number" && !hasTextTokenPricing)
}

function mergeXaiModel(model: XaiModel, models: ModelRecord): void {
	if (!shouldIncludeXaiLanguageModel(model)) {
		return
	}

	for (const id of [model.id, ...(model.aliases ?? [])]) {
		models[id] = mergeModelInfo(id, xaiModels, {
			contextWindow: positiveNumber(model.context_window ?? model.max_prompt_text_tokens),
			maxTokens: positiveNumber(model.max_completion_tokens),
			supportsImages: model.input_modalities?.includes("image"),
			supportsPromptCache:
				typeof model.cached_prompt_text_token_price === "number" && model.cached_prompt_text_token_price > 0
					? true
					: undefined,
			inputPrice: positiveCentsPer100MillionTokensToDollarsPerMillion(model.prompt_text_token_price),
			outputPrice: positiveCentsPer100MillionTokensToDollarsPerMillion(model.completion_text_token_price),
			cacheReadsPrice: positiveCentsPer100MillionTokensToDollarsPerMillion(model.cached_prompt_text_token_price),
			longContextPricing: buildXaiLongContextPricing(model),
		})
	}
}

async function fetchOpenAiCompatibleModelIds({
	baseUrl,
	apiKey,
	openAiHeaders,
}: {
	baseUrl: string
	apiKey?: string
	openAiHeaders?: Record<string, string>
}): Promise<string[]> {
	if (!URL.canParse(baseUrl)) {
		return []
	}

	const response = await axios.get(`${baseUrl.replace(/\/$/, "")}/models`, {
		headers: {
			...(openAiHeaders ?? {}),
			...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
		},
	})
	const parsed = openAiCompatibleModelsResponseSchema.safeParse(response.data)

	if (!parsed.success) {
		console.error("OpenAI-compatible models response is invalid", parsed.error.format())
		return []
	}

	return [...new Set(parsed.data.data.map((model) => model.id))]
}

function buildOpenAiCompatibleModels(modelIds: string[], fallbackModels: ModelRecord): ModelRecord {
	const models: ModelRecord = {}

	for (const id of modelIds) {
		models[id] = mergeModelInfo(id, fallbackModels)
	}

	return models
}

async function fetchMistralModels(apiKey?: string, baseUrl = "https://api.mistral.ai/v1"): Promise<ModelRecord> {
	if (!URL.canParse(baseUrl)) {
		return {}
	}

	const response = await axios.get(`${baseUrl.replace(/\/$/, "")}/models`, {
		headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
	})
	const parsed = mistralModelsResponseSchema.safeParse(response.data)

	if (!parsed.success) {
		console.error("Mistral models response is invalid", parsed.error.format())
		return {}
	}

	const models: ModelRecord = {}
	const mistralModelsResponse = Array.isArray(parsed.data) ? parsed.data : parsed.data.data

	for (const model of mistralModelsResponse) {
		models[model.id] = mergeModelInfo(model.id, mistralModels, normalizeMistralModelInfo(model))
	}

	return models
}

export async function getAnthropicModels(apiKey?: string, baseUrl = "https://api.anthropic.com"): Promise<ModelRecord> {
	if (!apiKey) return {}

	const modelsUrl = getVersionedEndpoint(baseUrl, "v1", "/models")

	if (!modelsUrl) {
		return {}
	}

	const models: ModelRecord = {}
	let afterId: string | undefined
	let hasMore = true

	while (hasMore) {
		const response = await axios.get(modelsUrl, {
			headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
			params: { limit: 1000, ...(afterId ? { after_id: afterId } : {}) },
		})
		const parsed = anthropicModelsResponseSchema.safeParse(response.data)

		if (!parsed.success) {
			console.error("Anthropic models response is invalid", parsed.error.format())
			return models
		}

		for (const model of parsed.data.data) {
			models[model.id] = mergeModelInfo(model.id, anthropicModels, {
				contextWindow: positiveNumber(model.max_input_tokens),
				maxTokens: positiveNumber(model.max_tokens),
				description: model.display_name,
				supportsImages: model.capabilities?.image_input?.supported,
				...getAnthropicThinkingCapabilities(model.id, model.capabilities?.thinking?.supported),
			})
		}

		hasMore = !!parsed.data.has_more && !!parsed.data.last_id && parsed.data.last_id !== afterId
		afterId = parsed.data.last_id
	}

	return models
}

export async function getXAIModels(apiKey?: string): Promise<ModelRecord> {
	if (!apiKey) return {}

	const headers = { Authorization: `Bearer ${apiKey}` }
	const models: ModelRecord = {}

	try {
		const response = await axios.get("https://api.x.ai/v1/language-models", { headers })
		const parsed = xaiLanguageModelsResponseSchema.safeParse(response.data)

		if (!parsed.success) {
			console.error("xAI language models response is invalid", parsed.error.format())
		} else {
			for (const model of parsed.data.models) {
				mergeXaiModel(model, models)
			}

			if (Object.keys(models).length > 0) {
				return models
			}
		}
	} catch (error) {
		console.error("Failed to fetch xAI language models", error)
	}

	const response = await axios.get("https://api.x.ai/v1/models", { headers })
	const parsed = xaiModelsResponseSchema.safeParse(response.data)

	if (!parsed.success) {
		console.error("xAI models response is invalid", parsed.error.format())
		return {}
	}

	for (const model of parsed.data.data) {
		mergeXaiModel(model, models)
	}

	return models
}

export async function getOpenAiNativeModels(
	apiKey?: string,
	baseUrl = "https://api.openai.com/v1",
): Promise<ModelRecord> {
	return buildOpenAiCompatibleModels(await fetchOpenAiCompatibleModelIds({ baseUrl, apiKey }), openAiNativeModels)
}

export async function getMistralModels(apiKey?: string, baseUrl = "https://api.mistral.ai/v1"): Promise<ModelRecord> {
	return fetchMistralModels(apiKey, baseUrl)
}

export async function getDeepSeekModels(apiKey?: string, baseUrl = "https://api.deepseek.com"): Promise<ModelRecord> {
	return buildOpenAiCompatibleModels(await fetchOpenAiCompatibleModelIds({ baseUrl, apiKey }), deepSeekModels)
}

export async function getXiaomiMiMoModels(
	apiKey?: string,
	baseUrl = "https://api.xiaomimimo.com/v1",
): Promise<ModelRecord> {
	return buildOpenAiCompatibleModels(
		await fetchOpenAiCompatibleModelIds({
			baseUrl,
			apiKey,
			openAiHeaders: apiKey ? { "api-key": apiKey } : undefined,
		}),
		xiaomiMiMoModels,
	)
}

export async function getBedrockModels(options: BedrockModelsOptions): Promise<ModelRecord> {
	const client = createBedrockClient(options)

	if (!client) {
		return {}
	}

	const models: ModelRecord = {}
	const foundationModels = await client.send(new ListFoundationModelsCommand({}))

	for (const model of foundationModels.modelSummaries ?? []) {
		const modelId = model.modelId?.trim()

		if (!modelId || !supportsBedrockTextGeneration(model.outputModalities)) {
			continue
		}

		models[modelId] = getBedrockModelInfo(modelId, model.modelName)
	}

	let nextToken: string | undefined

	do {
		const inferenceProfiles = await client.send(
			new ListInferenceProfilesCommand({ maxResults: 100, ...(nextToken ? { nextToken } : {}) }),
		)

		for (const profile of inferenceProfiles.inferenceProfileSummaries ?? []) {
			if (profile.status && profile.status !== "ACTIVE") {
				continue
			}

			const profileId =
				profile.inferenceProfileId?.trim() ?? getModelIdFromBedrockArn(profile.inferenceProfileArn)

			if (!profileId) {
				continue
			}

			const baseModelId = getModelIdFromBedrockArn(profile.models?.[0]?.modelArn) ?? profileId
			models[profileId] = getBedrockModelInfo(profileId, profile.inferenceProfileName, baseModelId)
		}

		nextToken = inferenceProfiles.nextToken
	} while (nextToken)

	return models
}

export async function getGeminiModels(
	apiKey?: string,
	baseUrl = "https://generativelanguage.googleapis.com",
): Promise<ModelRecord> {
	if (!apiKey) return {}

	const modelsUrl = getGeminiModelsEndpoint(baseUrl)

	if (!modelsUrl) {
		return {}
	}

	const models: ModelRecord = {}
	let pageToken: string | undefined

	do {
		const response = await axios.get(modelsUrl, {
			params: { key: apiKey, pageSize: 1000, ...(pageToken ? { pageToken } : {}) },
		})
		const parsed = geminiModelsResponseSchema.safeParse(response.data)

		if (!parsed.success) {
			console.error("Gemini models response is invalid", parsed.error.format())
			return models
		}

		for (const model of parsed.data.models) {
			if (!supportsGeminiContentGeneration(model.supportedGenerationMethods)) {
				continue
			}

			const id = normalizeGeminiModelId(model.name)

			models[id] = mergeModelInfo(id, geminiModels, {
				contextWindow: positiveNumber(model.inputTokenLimit),
				maxTokens: positiveNumber(model.outputTokenLimit),
				description: model.description ?? model.displayName,
				supportsTemperature:
					typeof model.maxTemperature === "number" || typeof model.temperature === "number" || undefined,
				defaultTemperature: typeof model.temperature === "number" ? model.temperature : undefined,
			})
		}

		pageToken = parsed.data.nextPageToken
	} while (pageToken)

	return models
}

export async function getMoonshotModels(apiKey?: string, baseUrl = "https://api.moonshot.ai/v1"): Promise<ModelRecord> {
	if (!apiKey || !URL.canParse(baseUrl)) return {}

	const response = await axios.get(`${baseUrl.replace(/\/+$/, "")}/models`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	})
	const parsed = moonshotModelsResponseSchema.safeParse(response.data)

	if (!parsed.success) {
		console.error("Moonshot models response is invalid", parsed.error.format())
		return {}
	}

	const models: ModelRecord = {}

	for (const model of parsed.data.data) {
		models[model.id] = mergeModelInfo(model.id, moonshotModels, {
			contextWindow: positiveNumber(model.context_length),
			maxTokens: positiveNumber(model.max_completion_tokens ?? model.max_tokens),
			supportsImages: model.supports_image_in,
			supportsReasoningBinary: model.supports_reasoning,
			preserveReasoning: model.supports_reasoning,
		})
	}

	return models
}

export async function getSambaNovaModels(apiKey?: string): Promise<ModelRecord> {
	const response = await axios.get("https://api.sambanova.ai/v1/models", {
		headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
	})
	const parsed = sambaNovaModelsResponseSchema.safeParse(response.data)

	if (!parsed.success) {
		console.error("SambaNova models response is invalid", parsed.error.format())
		return {}
	}

	const models: ModelRecord = {}

	for (const model of parsed.data.data) {
		models[model.id] = mergeModelInfo(model.id, sambaNovaModels, {
			contextWindow: firstPositiveNumber(model.context_length, model.context_window, model.max_context_length),
			maxTokens: firstPositiveNumber(model.max_completion_tokens, model.max_output_tokens, model.max_tokens),
			description: getSparseSafeDescription(model.id, sambaNovaModels, model.description),
			supportsImages: normalizeOpenAiCompatibleImageSupport(model),
			...normalizeProviderPricing(model.pricing),
		})
	}

	return models
}

export async function getMiniMaxModels(apiKey?: string, baseUrl = "https://api.minimax.io/v1"): Promise<ModelRecord> {
	if (!apiKey) return {}

	const modelsUrl = getMiniMaxModelsEndpoint(baseUrl)

	if (!modelsUrl) {
		return {}
	}

	const response = await axios.get(modelsUrl, {
		headers: { "X-Api-Key": apiKey },
	})
	const parsed = minimaxModelsResponseSchema.safeParse(response.data)

	if (!parsed.success) {
		console.error("MiniMax models response is invalid", parsed.error.format())
		return {}
	}

	const models: ModelRecord = {}

	for (const model of parsed.data.data) {
		const fallbackDescription = (minimaxModels as ModelRecord)[model.id]?.description

		models[model.id] = mergeModelInfo(model.id, minimaxModels, {
			description: fallbackDescription ? undefined : model.display_name,
		})
	}

	return models
}

export async function getBasetenModels(apiKey?: string): Promise<ModelRecord> {
	if (!apiKey) return {}

	const response = await axios.get("https://inference.baseten.co/v1/models", {
		headers: { Authorization: `Bearer ${apiKey}` },
	})
	const parsed = basetenModelsResponseSchema.safeParse(response.data)

	if (!parsed.success) {
		console.error("Baseten models response is invalid", parsed.error.format())
		return {}
	}

	const basetenModelList = "data" in parsed.data ? parsed.data.data : parsed.data.models
	const models: ModelRecord = {}

	for (const model of basetenModelList) {
		models[model.id] = mergeModelInfo(model.id, basetenModels, {
			contextWindow: firstPositiveNumber(model.context_length, model.context_window, model.max_context_length),
			maxTokens: firstPositiveNumber(model.max_completion_tokens, model.max_output_tokens, model.max_tokens),
			description: getSparseSafeDescription(model.id, basetenModels, model.description ?? model.name),
			supportsImages: normalizeOpenAiCompatibleImageSupport(model),
			supportsReasoningEffort: normalizeBasetenReasoningEffortSupport(model),
			...normalizeProviderPricing(model.pricing),
		})
	}

	return models
}

export async function getFireworksModels(apiKey?: string): Promise<ModelRecord> {
	if (!apiKey) return {}

	const models: ModelRecord = {}
	let pageToken: string | undefined

	do {
		const response = await axios.get("https://api.fireworks.ai/v1/accounts/fireworks/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
			params: { pageSize: 200, filter: "supports_serverless=true", ...(pageToken ? { pageToken } : {}) },
		})
		const parsed = fireworksModelsResponseSchema.safeParse(response.data)

		if (!parsed.success) {
			console.error("Fireworks models response is invalid", parsed.error.format())
			return models
		}

		for (const model of parsed.data.models) {
			if (model.supportsServerless === false) {
				continue
			}

			const id = model.name
			models[id] = mergeModelInfo(id, fireworksModels, {
				contextWindow: firstPositiveNumber(model.contextLength, model.maxContextLength),
				maxTokens: firstPositiveNumber(model.maxCompletionTokens, model.maxOutputTokens, model.maxTokens),
				description: getSparseSafeDescription(id, fireworksModels, model.description ?? model.displayName),
				supportsImages: model.supportsImageInput,
				deprecated: normalizeFireworksDeprecated(model),
			})
		}

		pageToken = parsed.data.nextPageToken
	} while (pageToken)

	return models
}

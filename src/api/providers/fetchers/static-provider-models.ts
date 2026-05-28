import axios from "axios"
import { z } from "zod"

import {
	type ModelInfo,
	type ModelRecord,
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
} from "@roo-code/types"

const DEFAULT_DYNAMIC_MODEL_INFO: ModelInfo = {
	contextWindow: 128_000,
	supportsPromptCache: false,
}

const openAiCompatibleModelsResponseSchema = z.object({
	data: z.array(z.object({ id: z.string() }).passthrough()),
})

const mistralModelsResponseSchema = z.union([
	openAiCompatibleModelsResponseSchema,
	z.array(
		z
			.object({
				id: z.string(),
				description: z.string().nullable().optional(),
				max_context_length: z.number().optional(),
				capabilities: z
					.object({
						vision: z.boolean().optional(),
						function_calling: z.boolean().optional(),
					})
					.passthrough()
					.optional(),
			})
			.passthrough(),
	),
])

const capabilitySupportSchema = z.object({ supported: z.boolean().optional() }).passthrough()

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

const sambaNovaModelsResponseSchema = z.object({
	data: z.array(
		z
			.object({
				id: z.string(),
				context_length: z.number().optional(),
				max_completion_tokens: z.number().optional(),
				pricing: z
					.object({
						prompt: z.string().optional(),
						completion: z.string().optional(),
					})
					.passthrough()
					.optional(),
			})
			.passthrough(),
	),
})

const xaiLanguageModelsResponseSchema = z.object({
	models: z.array(
		z
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
			})
			.passthrough(),
	),
})

type XaiLanguageModel = z.infer<typeof xaiLanguageModelsResponseSchema>["models"][number]

const basetenModelSchema = z
	.object({
		id: z.string(),
		name: z.string().optional(),
		context_length: z.number().optional(),
		context_window: z.number().optional(),
		max_context_length: z.number().optional(),
		max_output_tokens: z.number().optional(),
		max_tokens: z.number().optional(),
		description: z.string().optional(),
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
				description: z.string().optional(),
			})
			.passthrough(),
	),
	nextPageToken: z.string().optional(),
})

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

function getAnthropicThinkingCapabilities(modelId: string, thinkingSupported?: boolean): Partial<ModelInfo> {
	if ((anthropicModels as ModelRecord)[modelId]?.supportsReasoningAdaptive) {
		return {}
	}

	return { supportsReasoningBudget: thinkingSupported }
}

function centsPer100MillionTokensToDollarsPerMillion(price?: number | null): number | undefined {
	return typeof price === "number" ? price / 10_000 : undefined
}

function positiveNumber(value?: number | null): number | undefined {
	return typeof value === "number" && value > 0 ? value : undefined
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

function dollarsPerTokenToDollarsPerMillion(price?: string): number | undefined {
	if (!price) {
		return undefined
	}

	const parsed = Number(price)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : undefined
}

function buildXaiLongContextPricing(model: XaiLanguageModel): ModelInfo["longContextPricing"] {
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

	if (Array.isArray(parsed.data)) {
		const models: ModelRecord = {}

		for (const model of parsed.data) {
			models[model.id] = mergeModelInfo(model.id, mistralModels, {
				contextWindow: positiveNumber(model.max_context_length),
				description: model.description ?? undefined,
				supportsImages: model.capabilities?.vision,
			})
		}

		return models
	}

	return buildOpenAiCompatibleModels([...new Set(parsed.data.data.map((model) => model.id))], mistralModels)
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

	const response = await axios.get("https://api.x.ai/v1/language-models", {
		headers: { Authorization: `Bearer ${apiKey}` },
	})
	const parsed = xaiLanguageModelsResponseSchema.safeParse(response.data)

	if (!parsed.success) {
		console.error("xAI language models response is invalid", parsed.error.format())
		return {}
	}

	const models: ModelRecord = {}

	for (const model of parsed.data.models) {
		for (const id of [model.id, ...(model.aliases ?? [])]) {
			models[id] = mergeModelInfo(id, xaiModels, {
				contextWindow: positiveNumber(model.context_window ?? model.max_prompt_text_tokens),
				maxTokens: model.max_completion_tokens,
				supportsImages: model.input_modalities?.includes("image"),
				supportsPromptCache:
					typeof model.cached_prompt_text_token_price === "number" && model.cached_prompt_text_token_price > 0
						? true
						: undefined,
				inputPrice: centsPer100MillionTokensToDollarsPerMillion(model.prompt_text_token_price),
				outputPrice: centsPer100MillionTokensToDollarsPerMillion(model.completion_text_token_price),
				cacheReadsPrice: centsPer100MillionTokensToDollarsPerMillion(model.cached_prompt_text_token_price),
				longContextPricing: buildXaiLongContextPricing(model),
			})
		}
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
			preserveReasoning: model.supports_reasoning,
		})
	}

	return models
}

export async function getSambaNovaModels(apiKey?: string): Promise<ModelRecord> {
	if (!apiKey) return {}

	const response = await axios.get("https://api.sambanova.ai/v1/models", {
		headers: { Authorization: `Bearer ${apiKey}` },
	})
	const parsed = sambaNovaModelsResponseSchema.safeParse(response.data)

	if (!parsed.success) {
		console.error("SambaNova models response is invalid", parsed.error.format())
		return {}
	}

	const models: ModelRecord = {}

	for (const model of parsed.data.data) {
		models[model.id] = mergeModelInfo(model.id, sambaNovaModels, {
			contextWindow: positiveNumber(model.context_length),
			maxTokens: positiveNumber(model.max_completion_tokens),
			inputPrice: dollarsPerTokenToDollarsPerMillion(model.pricing?.prompt),
			outputPrice: dollarsPerTokenToDollarsPerMillion(model.pricing?.completion),
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
			contextWindow: model.context_length ?? model.context_window ?? model.max_context_length,
			maxTokens: model.max_output_tokens ?? model.max_tokens,
			description: model.description ?? model.name,
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
			params: { pageSize: 200, ...(pageToken ? { pageToken } : {}) },
		})
		const parsed = fireworksModelsResponseSchema.safeParse(response.data)

		if (!parsed.success) {
			console.error("Fireworks models response is invalid", parsed.error.format())
			return models
		}

		for (const model of parsed.data.models) {
			const id = model.name
			models[id] = mergeModelInfo(id, fireworksModels, {
				contextWindow: model.contextLength ?? model.maxContextLength,
				description: model.description ?? model.displayName,
			})
		}

		pageToken = parsed.data.nextPageToken
	} while (pageToken)

	return models
}

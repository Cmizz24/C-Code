import axios from "axios"
import { z } from "zod"

import type { ModelInfo } from "@roo-code/types"

import { parseApiPrice } from "../../../shared/cost"
import { toRequestyServiceUrl } from "../../../shared/utils/requesty"

const requestyPriceSchema = z.union([z.string(), z.number()]).nullish()

const requestyModelSchema = z
	.object({
		id: z.string().optional(),
		description: z.string().nullish(),
		max_output_tokens: z.number().nullish(),
		context_window: z.number().nullish(),
		supports_caching: z.boolean().nullish(),
		supports_vision: z.boolean().nullish(),
		supports_reasoning: z.boolean().nullish(),
		input_price: requestyPriceSchema,
		output_price: requestyPriceSchema,
		caching_price: requestyPriceSchema,
		cached_price: requestyPriceSchema,
		retires_at: z.union([z.string(), z.number()]).nullish(),
	})
	.passthrough()

const requestyModelsResponseSchema = z.object({
	data: z.array(requestyModelSchema),
})

type RequestyModel = z.infer<typeof requestyModelSchema>

const parseRequestyPrice = (price: z.infer<typeof requestyPriceSchema>) => (price === 0 ? 0 : parseApiPrice(price))

const getRequestyModelsUrl = (baseUrl?: string): string => {
	const url = new URL(toRequestyServiceUrl(baseUrl))
	const path = url.pathname.replace(/\/+$/, "")

	url.pathname = path.endsWith("/v1") ? `${path}/models` : `${path}/v1/models`
	url.search = ""
	url.hash = ""

	return url.toString()
}

const hasDatePassed = (date: string | number | null | undefined): boolean => {
	if (!date) {
		return false
	}

	const timestamp = typeof date === "number" ? (date < 1_000_000_000_000 ? date * 1000 : date) : Date.parse(date)

	return Number.isFinite(timestamp) && timestamp <= Date.now()
}

export const parseRequestyModel = (rawModel: RequestyModel): { id: string; info: ModelInfo } | undefined => {
	const { id, context_window } = rawModel

	if (!id || typeof context_window !== "number") {
		return undefined
	}

	const supportsReasoning = rawModel.supports_reasoning ?? false
	const reasoningBudget =
		supportsReasoning &&
		(id.includes("claude") || id.includes("coding/gemini-2.5") || id.includes("vertex/gemini-2.5"))
	const reasoningEffort = supportsReasoning && (id.includes("openai") || id.includes("google/gemini-2.5"))

	const modelInfo: ModelInfo = {
		maxTokens: rawModel.max_output_tokens ?? undefined,
		contextWindow: context_window,
		supportsPromptCache: rawModel.supports_caching ?? false,
		supportsImages: rawModel.supports_vision ?? false,
		supportsReasoningBudget: reasoningBudget,
		supportsReasoningEffort: reasoningEffort,
		inputPrice: parseRequestyPrice(rawModel.input_price),
		outputPrice: parseRequestyPrice(rawModel.output_price),
		description: rawModel.description ?? undefined,
		cacheWritesPrice: parseRequestyPrice(rawModel.caching_price),
		cacheReadsPrice: parseRequestyPrice(rawModel.cached_price),
	}

	if (hasDatePassed(rawModel.retires_at)) {
		modelInfo.deprecated = true
	}

	return { id, info: modelInfo }
}

export async function getRequestyModels(baseUrl?: string, apiKey?: string): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string> = {}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const modelsUrl = getRequestyModelsUrl(baseUrl)

		const response = await axios.get(modelsUrl, { headers })
		const result = requestyModelsResponseSchema.safeParse(response.data)
		const rawModels = result.success
			? result.data.data
			: Array.isArray(response.data?.data)
				? response.data.data
				: []

		if (!result.success) {
			console.error(`Requesty models response is invalid ${JSON.stringify(result.error.format())}`)
		}

		for (const rawModel of rawModels) {
			const parsedModel = requestyModelSchema.safeParse(rawModel)

			if (!parsedModel.success) {
				continue
			}

			const model = parseRequestyModel(parsedModel.data)

			if (!model) {
				continue
			}

			models[model.id] = model.info
		}
	} catch (error) {
		console.error(`Error fetching Requesty models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	return models
}

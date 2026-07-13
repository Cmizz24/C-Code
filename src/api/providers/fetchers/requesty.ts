import axios from "axios"
import { z } from "zod"

import type { ModelInfo, ModelProvenance } from "@roo-code/types"

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
		supports_computer_use: z.boolean().nullish(),
		supports_reasoning: z.boolean().nullish(),
		supports_web_search: z.boolean().nullish(),
		supports_json_schema: z.boolean().nullish(),
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

const REQUESTY_REASONING_EFFORTS: Exclude<ModelInfo["supportsReasoningEffort"], boolean | undefined> = [
	"disable",
	"none",
	"low",
	"medium",
	"high",
	"max",
]

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

const getOfficialApiProvenance = (modelsUrl = getRequestyModelsUrl(), sourceFields?: string[]): ModelProvenance => ({
	sources: [
		{
			type: "official-api",
			url: modelsUrl,
			endpoint: "/v1/models",
			label: "Requesty model-list API",
		},
	],
	sourceFields,
	reviewStatus: "reviewed",
	reviewNote: "Mapped from fields returned by the Requesty model-list API response.",
})

const hasSourceField = (rawModel: RequestyModel, field: keyof RequestyModel): boolean =>
	rawModel[field] !== null && typeof rawModel[field] !== "undefined"

const hasAnySourceField = (rawModel: RequestyModel, fields: Array<keyof RequestyModel>): boolean =>
	fields.some((field) => hasSourceField(rawModel, field))

export const parseRequestyModel = (
	rawModel: RequestyModel,
	modelsUrl = getRequestyModelsUrl(),
): { id: string; info: ModelInfo } | undefined => {
	const { id, context_window } = rawModel

	if (!id || typeof context_window !== "number") {
		return undefined
	}

	const supportsReasoning = rawModel.supports_reasoning ?? false
	const reasoningEffort: ModelInfo["supportsReasoningEffort"] = supportsReasoning ? REQUESTY_REASONING_EFFORTS : false
	const provenance = getOfficialApiProvenance(modelsUrl)
	const capabilityProvenance: NonNullable<ModelInfo["capabilityProvenance"]> = {
		contextWindow: getOfficialApiProvenance(modelsUrl, ["context_window"]),
	}

	if (hasSourceField(rawModel, "max_output_tokens")) {
		capabilityProvenance.maxTokens = getOfficialApiProvenance(modelsUrl, ["max_output_tokens"])
	}

	if (hasAnySourceField(rawModel, ["input_price", "output_price", "caching_price", "cached_price"])) {
		capabilityProvenance.pricing = getOfficialApiProvenance(modelsUrl, [
			"input_price",
			"output_price",
			"caching_price",
			"cached_price",
		])
	}

	if (hasAnySourceField(rawModel, ["supports_caching", "caching_price", "cached_price"])) {
		capabilityProvenance.promptCaching = getOfficialApiProvenance(modelsUrl, [
			"supports_caching",
			"caching_price",
			"cached_price",
		])
	}

	if (hasSourceField(rawModel, "supports_vision")) {
		capabilityProvenance.images = getOfficialApiProvenance(modelsUrl, ["supports_vision"])
	}

	if (hasSourceField(rawModel, "supports_reasoning")) {
		capabilityProvenance.reasoning = getOfficialApiProvenance(modelsUrl, ["supports_reasoning"])
	}

	if (hasSourceField(rawModel, "supports_computer_use")) {
		capabilityProvenance.computerUse = getOfficialApiProvenance(modelsUrl, ["supports_computer_use"])
	}

	if (hasSourceField(rawModel, "supports_web_search")) {
		capabilityProvenance.webSearch = getOfficialApiProvenance(modelsUrl, ["supports_web_search"])
	}

	if (hasSourceField(rawModel, "supports_json_schema")) {
		capabilityProvenance.jsonSchema = getOfficialApiProvenance(modelsUrl, ["supports_json_schema"])
	}

	if (hasSourceField(rawModel, "description")) {
		capabilityProvenance.description = getOfficialApiProvenance(modelsUrl, ["description"])
	}

	const modelInfo: ModelInfo = {
		maxTokens: rawModel.max_output_tokens ?? undefined,
		contextWindow: context_window,
		supportsPromptCache: rawModel.supports_caching ?? false,
		supportsImages: rawModel.supports_vision ?? false,
		supportsReasoningBudget: false,
		supportsReasoningEffort: reasoningEffort,
		inputPrice: parseRequestyPrice(rawModel.input_price),
		outputPrice: parseRequestyPrice(rawModel.output_price),
		description: rawModel.description ?? undefined,
		cacheWritesPrice: parseRequestyPrice(rawModel.caching_price),
		cacheReadsPrice: parseRequestyPrice(rawModel.cached_price),
		provenance,
		capabilityProvenance,
	}

	if (hasDatePassed(rawModel.retires_at)) {
		modelInfo.deprecated = true
		modelInfo.capabilityProvenance = {
			...modelInfo.capabilityProvenance,
			deprecation: getOfficialApiProvenance(modelsUrl, ["retires_at"]),
		}
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

			const model = parseRequestyModel(parsedModel.data, modelsUrl)

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

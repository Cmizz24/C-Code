import axios from "axios"
import { z } from "zod"

import type { ModelInfo } from "@roo-code/types"

const unboundPriceSchema = z.union([z.string(), z.number()]).nullish()

const unboundPricingSchema = z
	.object({
		input_token_price: unboundPriceSchema,
		output_token_price: unboundPriceSchema,
		cache_read_price: unboundPriceSchema,
		cache_write_price: unboundPriceSchema,
	})
	.partial()
	.passthrough()

const unboundParametersSchema = z
	.object({
		context_window: z.number().nullish(),
		max_tokens: z.number().nullish(),
		supports_prompt_caching: z.boolean().nullish(),
		supports_images: z.boolean().nullish(),
		supports_computer_use: z.boolean().nullish(),
	})
	.passthrough()

const unboundModelSchema = z
	.object({
		id: z.string().optional(),
		name: z.string().nullish(),
		description: z.string().nullish(),
		pricing: unboundPricingSchema.nullish(),
		parameters: unboundParametersSchema.nullish(),
	})
	.passthrough()

const unboundModelsResponseSchema = z.object({
	data: z.array(unboundModelSchema),
})

type UnboundModel = z.infer<typeof unboundModelSchema>

const parseUnboundPrice = (price: z.infer<typeof unboundPriceSchema>): number | undefined => {
	if (price === null || typeof price === "undefined" || price === "") {
		return undefined
	}

	const parsed = typeof price === "number" ? price : parseFloat(price)

	return Number.isFinite(parsed) ? parsed : undefined
}

export const parseUnboundModel = (rawModel: UnboundModel): { id: string; info: ModelInfo } | undefined => {
	const { id, parameters } = rawModel
	const contextWindow = parameters?.context_window

	if (!id || typeof contextWindow !== "number") {
		return undefined
	}

	return {
		id,
		info: {
			maxTokens: parameters?.max_tokens ?? undefined,
			contextWindow,
			supportsPromptCache: parameters?.supports_prompt_caching ?? false,
			supportsImages: parameters?.supports_images ?? false,
			inputPrice: parseUnboundPrice(rawModel.pricing?.input_token_price),
			outputPrice: parseUnboundPrice(rawModel.pricing?.output_token_price),
			description: rawModel.description ?? undefined,
			cacheWritesPrice: parseUnboundPrice(rawModel.pricing?.cache_write_price),
			cacheReadsPrice: parseUnboundPrice(rawModel.pricing?.cache_read_price),
		},
	}
}

export async function getUnboundModels(apiKey?: string | null): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string> = {}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const response = await axios.get("https://api.getunbound.ai/v1/models", { headers })
		const result = unboundModelsResponseSchema.safeParse(response.data)
		const rawModels = result.success
			? result.data.data
			: Array.isArray(response.data?.data)
				? response.data.data
				: []

		if (!result.success) {
			console.error(`Unbound models response is invalid ${JSON.stringify(result.error.format())}`)
		}

		for (const rawModel of rawModels) {
			const parsedModel = unboundModelSchema.safeParse(rawModel)

			if (!parsedModel.success) {
				continue
			}

			const model = parseUnboundModel(parsedModel.data)

			if (!model) {
				continue
			}

			models[model.id] = model.info
		}
	} catch (error) {
		console.error(`Error fetching Unbound models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	return models
}

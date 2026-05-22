import axios from "axios"

import type { ModelInfo } from "@roo-code/types"

import { parseApiPrice } from "../../../shared/cost"

export async function getUnboundModels(apiKey?: string | null): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string> = {}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const response = await axios.get("https://api.getunbound.ai/models", { headers })
		const rawModels = Array.isArray(response.data?.data)
			? response.data.data
			: Array.isArray(response.data)
				? response.data
				: []

		if (rawModels.length === 0 && response.data) {
			console.error(`Unexpected Unbound models response format: ${JSON.stringify(response.data)}`)
		}

		for (const rawModel of rawModels) {
			if (!rawModel?.id) {
				continue
			}

			const modelInfo: ModelInfo = {
				maxTokens: rawModel.max_output_tokens ?? 8192,
				contextWindow: rawModel.context_window ?? 200_000,
				supportsPromptCache: rawModel.supports_caching ?? false,
				supportsImages: rawModel.supports_vision ?? false,
				inputPrice: parseApiPrice(rawModel.input_price),
				outputPrice: parseApiPrice(rawModel.output_price),
				description: rawModel.description,
				cacheWritesPrice: parseApiPrice(rawModel.caching_price),
				cacheReadsPrice: parseApiPrice(rawModel.cached_price),
			}

			models[rawModel.id] = modelInfo
		}
	} catch (error) {
		console.error(`Error fetching Unbound models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	return models
}

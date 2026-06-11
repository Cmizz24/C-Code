import axios from "axios"

import { litellmDefaultModelInfo, type ModelInfo, type ModelRecord } from "@roo-code/types"

import { DEFAULT_HEADERS } from "../constants"

const MILLION_TOKENS = 1_000_000

const firstPositiveNumber = (...values: unknown[]): number | undefined =>
	values.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)

const pricePerMillion = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value * MILLION_TOKENS : undefined

const normalizeLiteLLMModelInfo = (modelName: string, rawModelInfo: Record<string, any> = {}): ModelInfo => {
	const maxTokens = firstPositiveNumber(rawModelInfo.max_output_tokens, rawModelInfo.max_tokens)

	return {
		...litellmDefaultModelInfo,
		...(maxTokens ? { maxTokens } : {}),
		contextWindow: firstPositiveNumber(rawModelInfo.max_input_tokens) ?? litellmDefaultModelInfo.contextWindow,
		supportsImages: rawModelInfo.supports_vision === true,
		supportsPromptCache: rawModelInfo.supports_prompt_caching === true,
		inputPrice: pricePerMillion(rawModelInfo.input_cost_per_token),
		outputPrice: pricePerMillion(rawModelInfo.output_cost_per_token),
		cacheWritesPrice: pricePerMillion(rawModelInfo.cache_creation_input_token_cost),
		cacheReadsPrice: pricePerMillion(rawModelInfo.cache_read_input_token_cost),
		description: `${modelName} via LiteLLM proxy`,
	}
}

/**
 * Fetches available models from a LiteLLM server
 *
 * @param apiKey The API key for the LiteLLM server
 * @param baseUrl The base URL of the LiteLLM server
 * @returns A promise that resolves to a record of model IDs to model info
 * @throws Will throw an error if the request fails or the response is not as expected.
 */
export async function getLiteLLMModels(apiKey: string, baseUrl: string): Promise<ModelRecord> {
	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...DEFAULT_HEADERS,
		}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}
		// Use URL constructor to properly join base URL and path
		// This approach handles all edge cases including paths, query params, and fragments
		const urlObj = new URL(baseUrl)
		// Normalize the pathname by removing trailing slashes and multiple slashes
		urlObj.pathname = urlObj.pathname.replace(/\/+$/, "").replace(/\/+/g, "/") + "/v1/model/info"
		const url = urlObj.href
		// Added timeout to prevent indefinite hanging
		const response = await axios.get(url, { headers, timeout: 5000 })
		const models: ModelRecord = {}

		// Process the model info from the response
		if (response.data && response.data.data && Array.isArray(response.data.data)) {
			for (const model of response.data.data) {
				const modelName = model.model_name

				if (!modelName) continue

				models[modelName] = normalizeLiteLLMModelInfo(modelName, model.model_info ?? {})
			}
		} else {
			// If response.data.data is not in the expected format, consider it an error.
			console.error("Error fetching LiteLLM models: Unexpected response format", response.data)
			throw new Error("Failed to fetch LiteLLM models: Unexpected response format.")
		}

		return models
	} catch (error: any) {
		console.error("Error fetching LiteLLM models:", error.message ? error.message : error)
		if (axios.isAxiosError(error) && error.response) {
			throw new Error(
				`Failed to fetch LiteLLM models: ${error.response.status} ${error.response.statusText}. Check base URL and API key.`,
			)
		} else if (axios.isAxiosError(error) && error.request) {
			throw new Error(
				"Failed to fetch LiteLLM models: No response from server. Check LiteLLM server status and base URL.",
			)
		} else {
			throw new Error(`Failed to fetch LiteLLM models: ${error.message || "An unknown error occurred."}`)
		}
	}
}

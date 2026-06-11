import axios from "axios"
import { type ModelInfo, ollamaDefaultModelInfo } from "@roo-code/types"
import { z } from "zod"

const OllamaModelDetailsSchema = z.object({
	family: z.string().optional(),
	families: z.array(z.string()).nullable().optional(),
	format: z.string().optional(),
	parameter_size: z.string().optional(),
	parent_model: z.string().optional(),
	quantization_level: z.string().optional(),
})

const OllamaModelSchema = z.object({
	details: OllamaModelDetailsSchema.optional(),
	digest: z.string().optional(),
	model: z.string(),
	modified_at: z.string().optional(),
	name: z.string().optional(),
	size: z.number().optional(),
})

const OllamaModelInfoResponseSchema = z.object({
	modelfile: z.string().optional(),
	parameters: z.string().optional(),
	template: z.string().optional(),
	details: OllamaModelDetailsSchema.optional(),
	model_info: z.record(z.string(), z.any()).optional().default({}),
	capabilities: z.array(z.string()).optional(),
})

const OllamaModelsResponseSchema = z.object({
	models: z.array(OllamaModelSchema),
})

type OllamaModelsResponse = z.infer<typeof OllamaModelsResponseSchema>

type OllamaModelInfoResponse = z.infer<typeof OllamaModelInfoResponseSchema>

const getPositiveNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined

export const parseOllamaModel = (rawModel: OllamaModelInfoResponse): ModelInfo | null => {
	const modelInfo = rawModel.model_info ?? {}
	const contextKey = Object.keys(modelInfo).find((k) => k.includes("context_length"))
	const contextWindow = contextKey ? getPositiveNumber(modelInfo[contextKey]) : undefined

	// Filter out models that don't support tools. Models without tool capability won't work.
	const supportsTools = rawModel.capabilities?.includes("tools") ?? false
	if (!supportsTools) {
		return null
	}

	const descriptionParts = [
		rawModel.details?.family ? `Family: ${rawModel.details.family}` : undefined,
		contextWindow ? `Context: ${contextWindow}` : undefined,
		rawModel.details?.parameter_size ? `Size: ${rawModel.details.parameter_size}` : undefined,
	].filter(Boolean)

	const parsedModelInfo: ModelInfo = {
		...ollamaDefaultModelInfo,
		contextWindow: contextWindow ?? ollamaDefaultModelInfo.contextWindow,
		description: descriptionParts.length > 0 ? descriptionParts.join(", ") : "Ollama model",
		...(rawModel.capabilities?.includes("vision") ? { supportsImages: true } : {}),
	}

	return parsedModelInfo
}

export async function getOllamaModels(
	baseUrl = "http://localhost:11434",
	apiKey?: string,
): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	// clearing the input can leave an empty string; use the default in that case
	baseUrl = baseUrl === "" ? "http://localhost:11434" : baseUrl

	try {
		if (!URL.canParse(baseUrl)) {
			return models
		}

		// Prepare headers with optional API key
		const headers: Record<string, string> = {}
		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const response = await axios.get<OllamaModelsResponse>(`${baseUrl}/api/tags`, { headers })
		const parsedResponse = OllamaModelsResponseSchema.safeParse(response.data)
		let modelInfoPromises = []

		if (parsedResponse.success) {
			for (const ollamaModel of parsedResponse.data.models) {
				const modelName = ollamaModel.name ?? ollamaModel.model

				modelInfoPromises.push(
					axios
						.post<OllamaModelInfoResponse>(
							`${baseUrl}/api/show`,
							{
								model: ollamaModel.model,
							},
							{ headers },
						)
						.then((ollamaModelInfo) => {
							const modelInfo = parseOllamaModel(ollamaModelInfo.data)
							// Only include models that support native tools
							if (modelInfo) {
								models[modelName] = modelInfo
							}
						}),
				)
			}

			await Promise.all(modelInfoPromises)
		} else {
			console.error(`Error parsing Ollama models response: ${JSON.stringify(parsedResponse.error, null, 2)}`)
		}
	} catch (error) {
		if (error.code === "ECONNREFUSED") {
			console.warn(`Failed connecting to Ollama at ${baseUrl}`)
		} else {
			console.error(
				`Error fetching Ollama models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)
		}
	}

	return models
}

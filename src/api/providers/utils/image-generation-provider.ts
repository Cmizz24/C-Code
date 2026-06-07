import {
	getDefaultImageGenerationApiMethod,
	getDefaultImageGenerationBaseUrl,
	getDefaultImageGenerationModel,
	getImageGenerationModel,
	getImageGenerationProvider,
	IMAGE_GENERATION_PROVIDERS,
	isImageGenerationApiMethod,
	type ImageGenerationApiMethod,
	type ImageGenerationProvider,
	type RooCodeSettings,
} from "@roo-code/types"

import { t } from "../../../i18n"
import { generateImageWithImagesApi, generateImageWithProvider, type ImageGenerationResult } from "./image-generation"

export interface ResolvedImageGenerationConfig {
	provider: ImageGenerationProvider
	providerLabel: string
	baseURL: string
	authToken?: string
	model: string
	apiMethod: ImageGenerationApiMethod
}

export type ResolveImageGenerationConfigResult =
	| { success: true; config: ResolvedImageGenerationConfig }
	| { success: false; error: string }

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, "")

const normalizeConfiguredBaseUrl = (baseUrl: string | undefined, provider: ImageGenerationProvider): string => {
	const fallback = getDefaultImageGenerationBaseUrl(provider)
	const value = (baseUrl || fallback).trim()
	return trimTrailingSlashes(value || fallback)
}

const getProviderState = (state: Partial<RooCodeSettings>, provider: ImageGenerationProvider) => {
	switch (provider) {
		case "openrouter":
			return {
				apiKey: state.openRouterImageApiKey,
				baseUrl: state.openRouterImageBaseUrl,
				model: state.openRouterImageGenerationSelectedModel,
				apiMethod: state.openRouterImageGenerationApiMethod,
			}
		case "openai":
			return {
				apiKey: state.openAiImageApiKey,
				baseUrl: state.openAiImageBaseUrl,
				model: state.openAiImageGenerationSelectedModel,
				apiMethod: state.openAiImageGenerationApiMethod,
			}
		case "ollama":
			return {
				apiKey: state.ollamaImageApiKey,
				baseUrl: state.ollamaImageBaseUrl,
				model: state.ollamaImageGenerationSelectedModel,
				apiMethod: state.ollamaImageGenerationApiMethod,
			}
		case "lmstudio":
			return {
				apiKey: state.lmStudioImageApiKey,
				baseUrl: state.lmStudioImageBaseUrl,
				model: state.lmStudioImageGenerationSelectedModel,
				apiMethod: state.lmStudioImageGenerationApiMethod,
			}
	}
}

export function resolveImageGenerationConfig(
	state: Partial<RooCodeSettings> | undefined,
): ResolveImageGenerationConfigResult {
	if (!state) {
		return {
			success: false,
			error: t("tools:generateImage.missingConfiguration"),
		}
	}

	const provider = getImageGenerationProvider(
		state.imageGenerationProvider,
		!!state.openRouterImageGenerationSelectedModel,
	)
	const definition = IMAGE_GENERATION_PROVIDERS[provider]
	const providerState = getProviderState(state, provider)
	const authToken = providerState.apiKey?.trim()

	if (definition.requiresApiKey && !authToken) {
		return {
			success: false,
			error: t("tools:generateImage.apiKeyRequired", { provider: definition.label }),
		}
	}

	const model = (providerState.model || getDefaultImageGenerationModel(provider)).trim()
	if (!model) {
		return {
			success: false,
			error: t("tools:generateImage.modelRequired", { provider: definition.label }),
		}
	}

	const modelInfo = getImageGenerationModel(provider, model)
	const configuredApiMethod = isImageGenerationApiMethod(providerState.apiMethod)
		? providerState.apiMethod
		: getDefaultImageGenerationApiMethod(provider)
	const apiMethod = modelInfo?.apiMethod ?? configuredApiMethod

	if (!definition.supportedApiMethods.includes(apiMethod)) {
		return {
			success: false,
			error: t("tools:generateImage.unsupportedApiMethod", {
				provider: definition.label,
				apiMethod,
			}),
		}
	}

	return {
		success: true,
		config: {
			provider,
			providerLabel: definition.label,
			baseURL: normalizeConfiguredBaseUrl(providerState.baseUrl, provider),
			authToken: authToken || undefined,
			model,
			apiMethod,
		},
	}
}

export async function generateImageWithConfiguredProvider(options: {
	state: Partial<RooCodeSettings> | undefined
	prompt: string
	inputImage?: string
}): Promise<ImageGenerationResult> {
	const resolved = resolveImageGenerationConfig(options.state)

	if (!resolved.success) {
		return {
			success: false,
			error: resolved.error,
		}
	}

	const { config } = resolved
	const generatorOptions = {
		baseURL: config.baseURL,
		authToken: config.authToken,
		model: config.model,
		prompt: options.prompt,
		inputImage: options.inputImage,
	}

	if (config.apiMethod === "images_api") {
		return generateImageWithImagesApi(generatorOptions)
	}

	return generateImageWithProvider(generatorOptions)
}

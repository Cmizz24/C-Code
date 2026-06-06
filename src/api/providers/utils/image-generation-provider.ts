import {
	getDefaultImageGenerationApiMethod,
	getDefaultImageGenerationBaseUrl,
	getDefaultImageGenerationModel,
	getImageGenerationModel,
	getImageGenerationProvider,
	IMAGE_GENERATION_PROVIDERS,
	isActiveImageGenerationProvider,
	isImageGenerationApiMethod,
	isLegacyUnsupportedImageGenerationProvider,
	type ActiveImageGenerationProvider,
	type ImageGenerationApiMethod,
	type ImageGenerationProvider,
	type RooCodeSettings,
} from "@roo-code/types"

import { t } from "../../../i18n"
import {
	generateImageWithAutomatic1111,
	generateImageWithComfyUi,
	generateImageWithImagesApi,
	generateImageWithProvider,
	type ImageGenerationResult,
} from "./image-generation"

export interface ResolvedImageGenerationConfig {
	provider: ActiveImageGenerationProvider
	providerLabel: string
	baseURL: string
	authToken?: string
	model: string
	apiMethod: ImageGenerationApiMethod
	negativePrompt?: string
}

export type ResolveImageGenerationConfigResult =
	| { success: true; config: ResolvedImageGenerationConfig }
	| { success: false; error: string }

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, "")

const normalizeConfiguredBaseUrl = (baseUrl: string | undefined, provider: ActiveImageGenerationProvider): string => {
	const fallback = getDefaultImageGenerationBaseUrl(provider)
	const value = (baseUrl || fallback).trim()
	const normalized = trimTrailingSlashes(value || fallback)

	return normalized
}

const getProviderState = (state: Partial<RooCodeSettings>, provider: ActiveImageGenerationProvider) => {
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
		case "comfyui":
			return {
				apiKey: state.comfyUiImageApiKey,
				baseUrl: state.comfyUiImageBaseUrl,
				model: state.comfyUiImageGenerationSelectedModel,
				apiMethod: state.comfyUiImageGenerationApiMethod,
				negativePrompt: state.comfyUiImageGenerationNegativePrompt,
			}
		case "automatic1111":
			return {
				apiKey: state.automatic1111ImageApiKey,
				baseUrl: state.automatic1111ImageBaseUrl,
				model: state.automatic1111ImageGenerationSelectedModel,
				apiMethod: state.automatic1111ImageGenerationApiMethod,
				negativePrompt: state.automatic1111ImageGenerationNegativePrompt,
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

	if (isLegacyUnsupportedImageGenerationProvider(state.imageGenerationProvider)) {
		const definition = IMAGE_GENERATION_PROVIDERS[state.imageGenerationProvider]
		return {
			success: false,
			error: t("tools:generateImage.unsupportedProvider", { provider: definition.label }),
		}
	}

	const provider = getImageGenerationProvider(
		state.imageGenerationProvider,
		!!state.openRouterImageGenerationSelectedModel,
	)

	if (!isActiveImageGenerationProvider(provider)) {
		return {
			success: false,
			error: t("tools:generateImage.unsupportedProvider", { provider: provider ?? "unknown" }),
		}
	}

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
	if ((definition.requiresModel ?? true) && !model) {
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
			negativePrompt: providerState.negativePrompt?.trim() || undefined,
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
		negativePrompt: config.negativePrompt,
	}

	if (config.provider === "comfyui") {
		return generateImageWithComfyUi({ ...generatorOptions, provider: "comfyui" })
	}

	if (config.provider === "automatic1111") {
		return generateImageWithAutomatic1111({ ...generatorOptions, provider: "automatic1111" })
	}

	if (config.apiMethod === "images_api") {
		return generateImageWithImagesApi({ ...generatorOptions, provider: config.provider })
	}

	return generateImageWithProvider({ ...generatorOptions, provider: config.provider })
}

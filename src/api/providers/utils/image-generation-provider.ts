import {
	getDefaultImageGenerationApiMethod,
	getDefaultImageGenerationBaseUrl,
	getDefaultImageGenerationModel,
	getImageGenerationModel,
	getImageGenerationProvider,
	IMAGE_GENERATION_PROVIDERS,
	isImageGenerationApiMethod,
	isLegacyUnsupportedImageGenerationProvider,
	type ActiveImageGenerationProvider,
	type ImageGenerationApiMethod,
	type ImageGenerationProvider,
	type RooCodeSettings,
} from "@roo-code/types"

import { t } from "../../../i18n"
import { generateImageWithImagesApi, generateImageWithProvider, type ImageGenerationResult } from "./image-generation"

export interface ResolvedImageGenerationConfig {
	provider: ActiveImageGenerationProvider
	providerLabel: string
	baseURL: string
	isLocal: boolean
	authToken?: string
	model: string
	apiMethod: ImageGenerationApiMethod
	negativePrompt?: string
}

type ProviderState = {
	apiKey?: string
	baseUrl?: string
	model?: string
	apiMethod?: ImageGenerationApiMethod
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

const getProviderState = (state: Partial<RooCodeSettings>, provider: ActiveImageGenerationProvider): ProviderState => {
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
			isLocal: definition.isLocal,
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
	outputFormat?: string
}): Promise<ImageGenerationResult> {
	const resolved = resolveImageGenerationConfig(options.state)

	if (!resolved.success) {
		return {
			success: false,
			error: resolved.error,
		}
	}

	const { config } = resolved
	const safeMetadata = {
		provider: config.provider,
		providerLabel: config.providerLabel,
		baseURL: config.baseURL,
		model: config.model,
		apiMethod: config.apiMethod,
		isLocal: config.isLocal,
	}
	const withSafeMetadata = (result: ImageGenerationResult): ImageGenerationResult => ({
		...result,
		metadata: {
			...safeMetadata,
			...result.metadata,
		},
	})
	const generatorOptions = {
		baseURL: config.baseURL,
		authToken: config.authToken,
		model: config.model,
		prompt: options.prompt,
		inputImage: options.inputImage,
		negativePrompt: config.negativePrompt,
	}

	if (config.apiMethod === "images_api") {
		return withSafeMetadata(
			await generateImageWithImagesApi({
				...generatorOptions,
				outputFormat: options.outputFormat,
				provider: config.provider,
			}),
		)
	}

	return withSafeMetadata(await generateImageWithProvider({ ...generatorOptions, provider: config.provider }))
}

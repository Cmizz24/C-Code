import {
	type ProviderName,
	type ProviderSettings,
	type ModelInfo,
	type ModelRecord,
	type RouterModels,
	anthropicModels,
	bedrockModels,
	deepSeekModels,
	moonshotModels,
	xiaomiMiMoModels,
	minimaxModels,
	geminiModels,
	mistralModels,
	openAiModelInfoSaneDefaults,
	openAiNativeModels,
	vertexModels,
	xaiModels,
	vscodeLlmModels,
	vscodeLlmDefaultModelId,
	openAiCodexModels,
	sambaNovaModels,
	internationalZAiModels,
	mainlandZAiModels,
	zaiApiLineConfigs,
	fireworksModels,
	basetenModels,
	qwenCodeModels,
	litellmDefaultModelInfo,
	BEDROCK_1M_CONTEXT_MODEL_IDS,
	isRetiredProvider,
	getProviderDefaultModelId,
} from "@roo-code/types"

import { isRouterName, type RouterName } from "@roo/api"
import { stringifyVsCodeLmModelSelector } from "@roo/vsCodeSelectorUtils"

import { useRouterModels } from "./useRouterModels"
import { useOpenRouterModelProviders } from "./useOpenRouterModelProviders"
import { useLmStudioModels } from "./useLmStudioModels"
import { useOllamaModels } from "./useOllamaModels"

/**
 * Helper to get a validated model ID for dynamic providers.
 * Returns the configured model ID if it exists in the available models, otherwise returns the default.
 */
function getValidatedModelId(
	configuredId: string | undefined,
	availableModels: ModelRecord | undefined,
	defaultModelId: string,
): string {
	return configuredId && availableModels?.[configuredId] ? configuredId : defaultModelId
}

const localModelProviders = new Set<ProviderName>(["ollama", "lmstudio"])

function hasBedrockModelDiscoveryConfig(apiConfiguration?: ProviderSettings): boolean {
	if (!apiConfiguration?.awsRegion) {
		return false
	}

	if (apiConfiguration.awsUseApiKey) {
		return !!apiConfiguration.awsApiKey
	}

	if (apiConfiguration.awsUseProfile) {
		return !!apiConfiguration.awsProfile
	}

	return (
		(!!apiConfiguration.awsAccessKey && !!apiConfiguration.awsSecretKey) ||
		(!apiConfiguration.awsAccessKey && !apiConfiguration.awsSecretKey)
	)
}

function getBedrockRouterModelRequestValues(apiConfiguration?: ProviderSettings) {
	if (!apiConfiguration) {
		return undefined
	}

	return {
		awsRegion: apiConfiguration.awsRegion,
		awsAccessKey: apiConfiguration.awsAccessKey,
		awsSecretKey: apiConfiguration.awsSecretKey,
		awsSessionToken: apiConfiguration.awsSessionToken,
		awsUseProfile: apiConfiguration.awsUseProfile,
		awsProfile: apiConfiguration.awsProfile,
		awsUseApiKey: apiConfiguration.awsUseApiKey,
		awsApiKey: apiConfiguration.awsApiKey,
		awsBedrockEndpointEnabled: apiConfiguration.awsBedrockEndpointEnabled,
		awsBedrockEndpoint: apiConfiguration.awsBedrockEndpoint,
	}
}

function getRouterModelRequestValues(
	provider: RouterName | undefined,
	apiConfiguration?: ProviderSettings,
): Record<string, unknown> | undefined {
	if (!apiConfiguration) {
		return undefined
	}

	switch (provider) {
		case "openrouter":
			return {
				openRouterApiKey: apiConfiguration.openRouterApiKey,
				openRouterBaseUrl: apiConfiguration.openRouterBaseUrl,
			}
		case "requesty":
			return {
				requestyApiKey: apiConfiguration.requestyApiKey,
				requestyBaseUrl: apiConfiguration.requestyBaseUrl,
			}
		case "unbound":
			return {
				unboundApiKey: apiConfiguration.unboundApiKey,
			}
		case "bedrock":
			return getBedrockRouterModelRequestValues(apiConfiguration)
		case "litellm":
			return {
				litellmApiKey: apiConfiguration.litellmApiKey,
				litellmBaseUrl: apiConfiguration.litellmBaseUrl,
			}
		case "poe":
			return {
				poeApiKey: apiConfiguration.poeApiKey,
				poeBaseUrl: apiConfiguration.poeBaseUrl,
			}
		case "anthropic":
			return {
				apiKey: apiConfiguration.apiKey,
				anthropicBaseUrl: apiConfiguration.anthropicBaseUrl,
			}
		case "xai":
			return {
				xaiApiKey: apiConfiguration.xaiApiKey,
			}
		case "openai-native":
			return {
				openAiNativeApiKey: apiConfiguration.openAiNativeApiKey,
				openAiNativeBaseUrl: apiConfiguration.openAiNativeBaseUrl,
			}
		case "mistral":
			return {
				mistralApiKey: apiConfiguration.mistralApiKey,
			}
		case "deepseek":
			return {
				deepSeekApiKey: apiConfiguration.deepSeekApiKey,
				deepSeekBaseUrl: apiConfiguration.deepSeekBaseUrl,
			}
		case "xiaomi-mimo":
			return {
				xiaomiMiMoApiKey: apiConfiguration.xiaomiMiMoApiKey,
				xiaomiMiMoBaseUrl: apiConfiguration.xiaomiMiMoBaseUrl,
			}
		case "gemini":
			return {
				geminiApiKey: apiConfiguration.geminiApiKey,
				googleGeminiBaseUrl: apiConfiguration.googleGeminiBaseUrl,
			}
		case "moonshot":
			return {
				moonshotApiKey: apiConfiguration.moonshotApiKey,
				moonshotBaseUrl: apiConfiguration.moonshotBaseUrl,
			}
		case "fireworks":
			return {
				fireworksApiKey: apiConfiguration.fireworksApiKey,
			}
		case "baseten":
			return {
				basetenApiKey: apiConfiguration.basetenApiKey,
			}
		case "sambanova":
			return {
				sambaNovaApiKey: apiConfiguration.sambaNovaApiKey,
			}
		case "minimax":
			return {
				minimaxApiKey: apiConfiguration.minimaxApiKey,
				minimaxBaseUrl: apiConfiguration.minimaxBaseUrl,
			}
		default:
			return undefined
	}
}

function getRouterFetchProvider(provider: ProviderName | undefined): RouterName | undefined {
	return provider && isRouterName(provider) && !localModelProviders.has(provider) ? provider : undefined
}

function canFetchProviderModels(provider: RouterName | undefined, apiConfiguration?: ProviderSettings): boolean {
	if (!provider) {
		return false
	}

	switch (provider) {
		case "openrouter":
		case "requesty":
		case "unbound":
		case "vercel-ai-gateway":
			return true
		case "litellm":
			return !!apiConfiguration?.litellmApiKey && !!apiConfiguration?.litellmBaseUrl
		case "poe":
			return !!apiConfiguration?.poeApiKey
		case "anthropic":
			return !!apiConfiguration?.apiKey
		case "xai":
			return !!apiConfiguration?.xaiApiKey
		case "openai-native":
			return !!apiConfiguration?.openAiNativeApiKey
		case "mistral":
			return !!apiConfiguration?.mistralApiKey
		case "deepseek":
			return !!apiConfiguration?.deepSeekApiKey
		case "xiaomi-mimo":
			return !!apiConfiguration?.xiaomiMiMoApiKey
		case "gemini":
			return !!apiConfiguration?.geminiApiKey
		case "moonshot":
			return !!apiConfiguration?.moonshotApiKey
		case "fireworks":
			return !!apiConfiguration?.fireworksApiKey
		case "baseten":
			return !!apiConfiguration?.basetenApiKey
		case "sambanova":
			return !!apiConfiguration?.sambaNovaApiKey
		case "minimax":
			return !!apiConfiguration?.minimaxApiKey
		case "bedrock":
			return hasBedrockModelDiscoveryConfig(apiConfiguration)
		case "ollama":
		case "lmstudio":
			return false
		default:
			return false
	}
}

function needsRouterModelsForSelection(provider: RouterName | undefined): boolean {
	return !!provider && ["openrouter", "requesty", "unbound", "litellm", "poe", "vercel-ai-gateway"].includes(provider)
}

function mergeStaticAndRouterModelInfo(
	provider: RouterName,
	routerModels: RouterModels,
	modelId: string,
	fallbackModels: ModelRecord,
): ModelInfo | undefined {
	const fallbackInfo = fallbackModels[modelId]
	const routerInfo = routerModels[provider]?.[modelId]

	if (!fallbackInfo && !routerInfo) {
		return undefined
	}

	return { ...(fallbackInfo ?? {}), ...(routerInfo ?? {}) } as ModelInfo
}

export const useSelectedModel = (apiConfiguration?: ProviderSettings) => {
	const provider = apiConfiguration?.apiProvider || "openrouter"
	const activeProvider: ProviderName | undefined = isRetiredProvider(provider) ? undefined : provider
	const routerFetchProvider = getRouterFetchProvider(activeProvider)
	const openRouterModelId = activeProvider === "openrouter" ? apiConfiguration?.openRouterModelId : undefined
	const lmStudioModelId = activeProvider === "lmstudio" ? apiConfiguration?.lmStudioModelId : undefined
	const ollamaModelId = activeProvider === "ollama" ? apiConfiguration?.ollamaModelId : undefined

	const shouldFetchRouterModels = canFetchProviderModels(routerFetchProvider, apiConfiguration)
	const routerModelRequestValues = getRouterModelRequestValues(routerFetchProvider, apiConfiguration)
	const routerModels = useRouterModels({
		provider: routerFetchProvider,
		...(routerModelRequestValues ? { values: routerModelRequestValues } : {}),
		enabled: shouldFetchRouterModels,
	})

	const openRouterModelProviders = useOpenRouterModelProviders(openRouterModelId)
	const lmStudioModels = useLmStudioModels(lmStudioModelId, { baseUrl: apiConfiguration?.lmStudioBaseUrl })
	const ollamaModels = useOllamaModels(ollamaModelId, {
		baseUrl: apiConfiguration?.ollamaBaseUrl,
		apiKey: apiConfiguration?.ollamaApiKey,
	})

	// Compute readiness only for the data actually needed for the selected provider
	const needRouterModels = shouldFetchRouterModels && needsRouterModelsForSelection(routerFetchProvider)
	const needOpenRouterProviders = activeProvider === "openrouter"
	const needLmStudio = typeof lmStudioModelId !== "undefined"
	const needOllama = typeof ollamaModelId !== "undefined"

	const hasValidRouterData =
		needRouterModels && routerFetchProvider
			? routerModels.data &&
				routerModels.data[routerFetchProvider] !== undefined &&
				typeof routerModels.data[routerFetchProvider] === "object" &&
				!routerModels.isLoading
			: true

	const isReady =
		(!needLmStudio || typeof lmStudioModels.data !== "undefined") &&
		(!needOllama || typeof ollamaModels.data !== "undefined") &&
		hasValidRouterData &&
		(!needOpenRouterProviders || typeof openRouterModelProviders.data !== "undefined")

	const { id, info } =
		apiConfiguration && isReady && activeProvider
			? getSelectedModel({
					provider: activeProvider,
					apiConfiguration,
					routerModels: (routerModels.data || {}) as RouterModels,
					openRouterModelProviders: (openRouterModelProviders.data || {}) as Record<string, ModelInfo>,
					lmStudioModels: (lmStudioModels.data || undefined) as ModelRecord | undefined,
					ollamaModels: (ollamaModels.data || undefined) as ModelRecord | undefined,
				})
			: { id: getProviderDefaultModelId(activeProvider ?? "openrouter"), info: undefined }

	return {
		provider,
		id,
		info,
		isLoading:
			(needRouterModels && routerModels.isLoading) ||
			(needOpenRouterProviders && openRouterModelProviders.isLoading) ||
			(needLmStudio && lmStudioModels!.isLoading) ||
			(needOllama && ollamaModels!.isLoading),
		isError:
			(needRouterModels && routerModels.isError) ||
			(needOpenRouterProviders && openRouterModelProviders.isError) ||
			(needLmStudio && lmStudioModels!.isError) ||
			(needOllama && ollamaModels!.isError),
	}
}

function getSelectedModel({
	provider,
	apiConfiguration,
	routerModels,
	openRouterModelProviders,
	lmStudioModels,
	ollamaModels,
}: {
	provider: ProviderName
	apiConfiguration: ProviderSettings
	routerModels: RouterModels
	openRouterModelProviders: Record<string, ModelInfo>
	lmStudioModels: ModelRecord | undefined
	ollamaModels: ModelRecord | undefined
}): { id: string; info: ModelInfo | undefined } {
	// the `undefined` case are used to show the invalid selection to prevent
	// users from seeing the default model if their selection is invalid
	// this gives a better UX than showing the default model
	const defaultModelId = getProviderDefaultModelId(provider)
	switch (provider) {
		case "openrouter": {
			const id = getValidatedModelId(apiConfiguration.openRouterModelId, routerModels.openrouter, defaultModelId)
			let info = routerModels.openrouter?.[id]
			const specificProvider = apiConfiguration.openRouterSpecificProvider

			if (specificProvider && openRouterModelProviders[specificProvider]) {
				// Overwrite the info with the specific provider info. Some
				// fields are missing the model info for `openRouterModelProviders`
				// so we need to merge the two.
				info = info
					? { ...info, ...openRouterModelProviders[specificProvider] }
					: openRouterModelProviders[specificProvider]
			}

			return { id, info }
		}
		case "requesty": {
			const id = getValidatedModelId(apiConfiguration.requestyModelId, routerModels.requesty, defaultModelId)
			const routerInfo = routerModels.requesty?.[id]
			return { id, info: routerInfo }
		}
		case "unbound": {
			const id = getValidatedModelId(apiConfiguration.unboundModelId, routerModels.unbound, defaultModelId)
			const routerInfo = routerModels.unbound?.[id]
			return { id, info: routerInfo }
		}
		case "litellm": {
			const id = getValidatedModelId(apiConfiguration.litellmModelId, routerModels.litellm, defaultModelId)
			const routerInfo = routerModels.litellm?.[id]
			return { id, info: routerInfo ?? litellmDefaultModelInfo }
		}
		case "xai": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mergeStaticAndRouterModelInfo("xai", routerModels, id, xaiModels)
			return info ? { id, info } : { id, info: undefined }
		}
		case "baseten": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mergeStaticAndRouterModelInfo("baseten", routerModels, id, basetenModels)
			return { id, info }
		}
		case "bedrock": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const staticInfo = bedrockModels[id as keyof typeof bedrockModels]
			const routerInfo = routerModels.bedrock?.[id]
			const baseInfo = staticInfo ?? routerInfo

			// Special case for custom ARN.
			if (id === "custom-arn") {
				return {
					id,
					info: { maxTokens: 5000, contextWindow: 128_000, supportsPromptCache: true, supportsImages: true },
				}
			}

			// Apply 1M context for supported Claude 4 models when enabled
			if (BEDROCK_1M_CONTEXT_MODEL_IDS.includes(id as any) && apiConfiguration.awsBedrock1MContext && baseInfo) {
				// Create a new ModelInfo object with updated context window
				const info: ModelInfo = {
					...baseInfo,
					contextWindow: 1_000_000,
				}
				return { id, info }
			}

			return { id, info: baseInfo }
		}
		case "vertex": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const baseInfo = vertexModels[id as keyof typeof vertexModels]

			return { id, info: baseInfo }
		}
		case "gemini": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mergeStaticAndRouterModelInfo("gemini", routerModels, id, geminiModels)
			return { id, info }
		}
		case "deepseek": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mergeStaticAndRouterModelInfo("deepseek", routerModels, id, deepSeekModels)
			return { id, info }
		}
		case "moonshot": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mergeStaticAndRouterModelInfo("moonshot", routerModels, id, moonshotModels)
			return { id, info }
		}
		case "minimax": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mergeStaticAndRouterModelInfo("minimax", routerModels, id, minimaxModels)
			return { id, info }
		}
		case "xiaomi-mimo": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mergeStaticAndRouterModelInfo("xiaomi-mimo", routerModels, id, xiaomiMiMoModels)
			return { id, info }
		}
		case "zai": {
			const isChina = zaiApiLineConfigs[apiConfiguration.zaiApiLine ?? "international_coding"].isChina
			const models = isChina ? mainlandZAiModels : internationalZAiModels
			const defaultModelId = getProviderDefaultModelId(provider, { isChina })
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = models[id as keyof typeof models]
			return { id, info }
		}
		case "openai-native": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mergeStaticAndRouterModelInfo("openai-native", routerModels, id, openAiNativeModels)
			return { id, info }
		}
		case "mistral": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mergeStaticAndRouterModelInfo("mistral", routerModels, id, mistralModels)
			return { id, info }
		}
		case "openai": {
			const id = apiConfiguration.openAiModelId ?? ""
			const customInfo = apiConfiguration?.openAiCustomModelInfo
			const info = customInfo ?? openAiModelInfoSaneDefaults
			return { id, info }
		}
		case "ollama": {
			const id = apiConfiguration.ollamaModelId ?? ""
			const info = ollamaModels && ollamaModels[apiConfiguration.ollamaModelId!]

			const adjustedInfo =
				info?.contextWindow &&
				apiConfiguration?.ollamaNumCtx &&
				apiConfiguration.ollamaNumCtx < info.contextWindow
					? { ...info, contextWindow: apiConfiguration.ollamaNumCtx }
					: info

			return {
				id,
				info: adjustedInfo || undefined,
			}
		}
		case "lmstudio": {
			const id = apiConfiguration.lmStudioModelId ?? ""
			const modelInfo = lmStudioModels && lmStudioModels[apiConfiguration.lmStudioModelId!]
			return {
				id,
				info: modelInfo,
			}
		}
		case "vscode-lm": {
			const id =
				stringifyVsCodeLmModelSelector(apiConfiguration?.vsCodeLmModelSelector) || vscodeLlmDefaultModelId
			const modelFamily = apiConfiguration?.vsCodeLmModelSelector?.family ?? vscodeLlmDefaultModelId
			const staticInfo = vscodeLlmModels[modelFamily as keyof typeof vscodeLlmModels]
			const {
				maxTokens: _maxTokens,
				inputPrice: _inputPrice,
				outputPrice: _outputPrice,
				cacheWritesPrice: _cacheWritesPrice,
				cacheReadsPrice: _cacheReadsPrice,
				...info
			} = { ...openAiModelInfoSaneDefaults, ...staticInfo }

			return { id, info: { ...info, supportsImages: false, supportsPromptCache: false } } // VSCode LM API currently doesn't support images or prompt caching.
		}
		case "sambanova": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mergeStaticAndRouterModelInfo("sambanova", routerModels, id, sambaNovaModels)
			return { id, info }
		}
		case "fireworks": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mergeStaticAndRouterModelInfo("fireworks", routerModels, id, fireworksModels)
			return { id, info }
		}
		case "poe": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = routerModels.poe?.[id]
			return { id, info }
		}
		case "qwen-code": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = qwenCodeModels[id as keyof typeof qwenCodeModels]
			return { id, info }
		}
		case "openai-codex": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = openAiCodexModels[id as keyof typeof openAiCodexModels]
			return { id, info }
		}
		case "vercel-ai-gateway": {
			const id = getValidatedModelId(
				apiConfiguration.vercelAiGatewayModelId,
				routerModels["vercel-ai-gateway"],
				defaultModelId,
			)
			const info = routerModels["vercel-ai-gateway"]?.[id]
			return { id, info }
		}
		// case "anthropic":
		// case "fake-ai":
		default: {
			provider satisfies "anthropic" | "gemini-cli" | "fake-ai"
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const baseInfo =
				provider === "anthropic"
					? mergeStaticAndRouterModelInfo("anthropic", routerModels, id, anthropicModels)
					: anthropicModels[id as keyof typeof anthropicModels]

			return { id, info: baseInfo }
		}
	}
}

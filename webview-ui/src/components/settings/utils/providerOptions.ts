import {
	type OrganizationAllowList,
	type ProviderName,
	type ProviderSettings,
	getProviderDefaultModelId,
} from "@roo-code/types"

import { PROVIDERS } from "../constants"
import { getStaticModelsForProvider, isStaticModelProvider } from "./providerModelConfig"

import { filterModels, filterProviders } from "./organizationFilters"

export type ProviderOption = {
	value: ProviderName
	label: string
}

type ProviderOptionParams = {
	organizationAllowList?: OrganizationAllowList
	selectedProvider?: ProviderSettings["apiProvider"]
	apiConfiguration?: ProviderSettings
	prioritizeOpenRouter?: boolean
	customArnLabel?: string
}

export const getAvailableProviderOptions = ({
	organizationAllowList,
	selectedProvider,
	apiConfiguration,
	prioritizeOpenRouter = false,
	customArnLabel,
}: ProviderOptionParams): ProviderOption[] => {
	const allowedProviders = filterProviders(PROVIDERS, organizationAllowList)

	const providersWithModels = allowedProviders.filter(({ value }) => {
		if (value === selectedProvider) {
			return true
		}

		const provider = value as ProviderName

		if (isStaticModelProvider(provider)) {
			const staticModels = getStaticModelsForProvider(provider, customArnLabel, apiConfiguration)
			const filteredModels = filterModels(staticModels, provider, organizationAllowList)
			return filteredModels && Object.keys(filteredModels).length > 0
		}

		return true
	})

	const options = providersWithModels.map(({ value, label }) => ({
		value: value as ProviderName,
		label,
	}))

	if (prioritizeOpenRouter) {
		const openRouterIndex = options.findIndex((opt) => opt.value === "openrouter")
		if (openRouterIndex > 0) {
			const [openRouterOption] = options.splice(openRouterIndex, 1)
			options.unshift(openRouterOption)
		}
	}

	return options
}

export type ProviderDefaultModelConfig = {
	field: keyof ProviderSettings
	default?: string
}

export const getProviderDefaultModelConfig = (
	provider: ProviderName,
	apiConfiguration?: ProviderSettings,
): ProviderDefaultModelConfig | undefined => {
	switch (provider) {
		case "openrouter":
			return { field: "openRouterModelId", default: getProviderDefaultModelId(provider) }
		case "requesty":
			return { field: "requestyModelId", default: getProviderDefaultModelId(provider) }
		case "unbound":
			return { field: "unboundModelId", default: getProviderDefaultModelId(provider) }
		case "litellm":
			return { field: "litellmModelId", default: getProviderDefaultModelId(provider) }
		case "anthropic":
		case "openai-codex":
		case "qwen-code":
		case "gemini":
		case "deepseek":
		case "moonshot":
		case "minimax":
		case "xiaomi-mimo":
		case "mistral":
		case "xai":
		case "baseten":
		case "bedrock":
		case "vertex":
		case "sambanova":
		case "fireworks":
		case "poe":
			return { field: "apiModelId", default: getProviderDefaultModelId(provider) }
		case "openai-native":
			return { field: "apiModelId", default: getProviderDefaultModelId(provider) }
		case "zai":
			return {
				field: "apiModelId",
				default: getProviderDefaultModelId(provider, {
					isChina: apiConfiguration?.zaiApiLine === "china_coding",
				}),
			}
		case "vercel-ai-gateway":
			return { field: "vercelAiGatewayModelId", default: getProviderDefaultModelId(provider) }
		case "openai":
			return { field: "openAiModelId" }
		case "ollama":
			return { field: "ollamaModelId" }
		case "lmstudio":
			return { field: "lmStudioModelId" }
		default:
			return undefined
	}
}

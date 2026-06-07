import React, { memo, useCallback, useEffect, useMemo, useState } from "react"
import { convertHeadersToObject } from "./utils/headers"
import { useDebounce } from "react-use"
import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ExternalLinkIcon } from "@radix-ui/react-icons"

import {
	type ModelRecord,
	type ProviderName,
	type ProviderSettings,
	type RouterModels,
	isRetiredProvider,
	DEFAULT_CONSECUTIVE_MISTAKE_LIMIT,
} from "@roo-code/types"

import {
	getProviderServiceConfig,
	getDefaultModelIdForProvider,
	getStaticModelsForProvider,
	shouldUseGenericModelPicker,
	handleModelChangeSideEffects,
} from "./utils/providerModelConfig"

import { vscode } from "@src/utils/vscode"
import { validateApiConfigurationExcludingModelErrors, getModelValidationError } from "@src/utils/validate"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useRouterModels } from "@src/components/ui/hooks/useRouterModels"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import {
	useOpenRouterModelProviders,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
} from "@src/components/ui/hooks/useOpenRouterModelProviders"
import { filterModels } from "./utils/organizationFilters"
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
	SearchableSelect,
	Collapsible,
	CollapsibleTrigger,
	CollapsibleContent,
} from "@src/components/ui"

import {
	Anthropic,
	Baseten,
	Bedrock,
	DeepSeek,
	Gemini,
	LMStudio,
	LiteLLM,
	Mistral,
	Moonshot,
	XiaomiMiMo,
	Ollama,
	OpenAI,
	OpenAICompatible,
	OpenAICodex,
	OpenRouter,
	Poe,
	QwenCode,
	Requesty,
	SambaNova,
	Unbound,
	Vertex,
	VSCodeLM,
	XAI,
	ZAi,
	Fireworks,
	VercelAiGateway,
	MiniMax,
} from "./providers"
import { isRouterName } from "@roo/api"

import { MODELS_BY_PROVIDER, PROVIDERS } from "./constants"
import { getAvailableProviderOptions, getProviderDefaultModelConfig } from "./utils/providerOptions"
import { inputEventTransform, noTransform } from "./transforms"
import { ModelPicker } from "./ModelPicker"
import { ApiErrorMessage } from "./ApiErrorMessage"
import { ThinkingBudget } from "./ThinkingBudget"
import { Verbosity } from "./Verbosity"
import { TodoListSettingsControl } from "./TodoListSettingsControl"
import { TemperatureControl } from "./TemperatureControl"
import { RateLimitSecondsControl } from "./RateLimitSecondsControl"
import { ConsecutiveMistakeLimitControl } from "./ConsecutiveMistakeLimitControl"
import { BedrockCustomArn } from "./providers/BedrockCustomArn"
import { buildDocLink } from "@src/utils/docLinks"
import { BookOpenText } from "lucide-react"

export interface ApiOptionsProps {
	uriScheme: string | undefined
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	fromWelcomeView?: boolean
	errorMessage: string | undefined
	setErrorMessage: React.Dispatch<React.SetStateAction<string | undefined>>
}

const LOCAL_ROUTER_MODEL_PROVIDERS = new Set<ProviderName>(["ollama", "lmstudio"])

function mergeRouterModelSources(...sources: Array<RouterModels | undefined>): RouterModels | undefined {
	const merged: RouterModels = {}
	let hasModels = false

	for (const source of sources) {
		if (!source) {
			continue
		}

		for (const [provider, models] of Object.entries(source) as Array<[ProviderName, ModelRecord | undefined]>) {
			if (!models) {
				continue
			}

			merged[provider] = { ...(merged[provider] ?? {}), ...models }
			hasModels = true
		}
	}

	return hasModels ? merged : undefined
}

function shouldRequestRouterModelsForProvider(provider: ProviderName, apiConfiguration: ProviderSettings): boolean {
	if (!isRouterName(provider) || LOCAL_ROUTER_MODEL_PROVIDERS.has(provider)) {
		return false
	}

	switch (provider) {
		case "openrouter":
		case "requesty":
		case "unbound":
		case "vercel-ai-gateway":
			return true
		case "litellm":
			return !!apiConfiguration.litellmApiKey && !!apiConfiguration.litellmBaseUrl
		case "poe":
			return !!apiConfiguration.poeApiKey
		case "anthropic":
			return !!apiConfiguration.apiKey
		case "xai":
			return !!apiConfiguration.xaiApiKey
		case "openai-native":
			return !!apiConfiguration.openAiNativeApiKey
		case "mistral":
			return !!apiConfiguration.mistralApiKey
		case "deepseek":
			return !!apiConfiguration.deepSeekApiKey
		case "gemini":
			return !!apiConfiguration.geminiApiKey
		case "moonshot":
			return !!apiConfiguration.moonshotApiKey
		case "fireworks":
			return !!apiConfiguration.fireworksApiKey
		case "baseten":
			return !!apiConfiguration.basetenApiKey
		case "sambanova":
			return !!apiConfiguration.sambaNovaApiKey
		case "minimax":
			return !!apiConfiguration.minimaxApiKey
		case "ollama":
		case "lmstudio":
			return false
	}
}

function getRouterModelRequestValues(provider: ProviderName, apiConfiguration: ProviderSettings) {
	const values = { provider }

	switch (provider) {
		case "requesty":
			return {
				...values,
				requestyApiKey: apiConfiguration.requestyApiKey,
				requestyBaseUrl: apiConfiguration.requestyBaseUrl,
			}
		case "unbound":
			return { ...values, unboundApiKey: apiConfiguration.unboundApiKey }
		case "litellm":
			return {
				...values,
				litellmApiKey: apiConfiguration.litellmApiKey,
				litellmBaseUrl: apiConfiguration.litellmBaseUrl,
			}
		case "poe":
			return { ...values, poeApiKey: apiConfiguration.poeApiKey, poeBaseUrl: apiConfiguration.poeBaseUrl }
		case "anthropic":
			return { ...values, apiKey: apiConfiguration.apiKey, anthropicBaseUrl: apiConfiguration.anthropicBaseUrl }
		case "xai":
			return { ...values, xaiApiKey: apiConfiguration.xaiApiKey }
		case "openai-native":
			return {
				...values,
				openAiNativeApiKey: apiConfiguration.openAiNativeApiKey,
				openAiNativeBaseUrl: apiConfiguration.openAiNativeBaseUrl,
			}
		case "mistral":
			return { ...values, mistralApiKey: apiConfiguration.mistralApiKey }
		case "deepseek":
			return {
				...values,
				deepSeekApiKey: apiConfiguration.deepSeekApiKey,
				deepSeekBaseUrl: apiConfiguration.deepSeekBaseUrl,
			}
		case "gemini":
			return {
				...values,
				geminiApiKey: apiConfiguration.geminiApiKey,
				googleGeminiBaseUrl: apiConfiguration.googleGeminiBaseUrl,
			}
		case "moonshot":
			return {
				...values,
				moonshotApiKey: apiConfiguration.moonshotApiKey,
				moonshotBaseUrl: apiConfiguration.moonshotBaseUrl,
			}
		case "fireworks":
			return { ...values, fireworksApiKey: apiConfiguration.fireworksApiKey }
		case "baseten":
			return { ...values, basetenApiKey: apiConfiguration.basetenApiKey }
		case "sambanova":
			return { ...values, sambaNovaApiKey: apiConfiguration.sambaNovaApiKey }
		case "minimax":
			return {
				...values,
				minimaxApiKey: apiConfiguration.minimaxApiKey,
				minimaxBaseUrl: apiConfiguration.minimaxBaseUrl,
			}
		default:
			return values
	}
}

const ApiOptions = ({
	uriScheme,
	apiConfiguration,
	setApiConfigurationField,
	fromWelcomeView,
	errorMessage,
	setErrorMessage,
}: ApiOptionsProps) => {
	const { t } = useAppTranslation()
	const {
		organizationAllowList,
		openAiCodexIsAuthenticated,
		openAiCodexFastStatus,
		routerModels: extensionRouterModels,
	} = useExtensionState()

	const [customHeaders, setCustomHeaders] = useState<[string, string][]>(() => {
		const headers = apiConfiguration?.openAiHeaders || {}
		return Object.entries(headers)
	})

	useEffect(() => {
		const propHeaders = apiConfiguration?.openAiHeaders || {}

		if (JSON.stringify(customHeaders) !== JSON.stringify(Object.entries(propHeaders))) {
			setCustomHeaders(Object.entries(propHeaders))
		}
	}, [apiConfiguration?.openAiHeaders, customHeaders])

	// Helper to convert array of tuples to object (filtering out empty keys).

	// Debounced effect to update the main configuration when local
	// customHeaders state stabilizes.
	useDebounce(
		() => {
			const currentConfigHeaders = apiConfiguration?.openAiHeaders || {}
			const newHeadersObject = convertHeadersToObject(customHeaders)

			// Only update if the processed object is different from the current config.
			if (JSON.stringify(currentConfigHeaders) !== JSON.stringify(newHeadersObject)) {
				setApiConfigurationField("openAiHeaders", newHeadersObject, false)
			}
		},
		300,
		[customHeaders, apiConfiguration?.openAiHeaders, setApiConfigurationField],
	)

	const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false)

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	const {
		provider: selectedProvider,
		id: selectedModelId,
		info: selectedModelInfo,
	} = useSelectedModel(apiConfiguration)
	const activeSelectedProvider: ProviderName | undefined = isRetiredProvider(selectedProvider)
		? undefined
		: selectedProvider
	const isRetiredSelectedProvider =
		typeof apiConfiguration.apiProvider === "string" && isRetiredProvider(apiConfiguration.apiProvider)

	const { data: routerModels, refetch: refetchRouterModels } = useRouterModels()
	const availableRouterModels = useMemo(
		() => mergeRouterModelSources(extensionRouterModels, routerModels),
		[extensionRouterModels, routerModels],
	)

	const genericPickerModels = useMemo(() => {
		if (!activeSelectedProvider) {
			return {}
		}

		return {
			...getStaticModelsForProvider(activeSelectedProvider, t("settings:labels.useCustomArn")),
			...(availableRouterModels?.[activeSelectedProvider] ?? {}),
		}
	}, [activeSelectedProvider, availableRouterModels, t])

	const { data: openRouterModelProviders } = useOpenRouterModelProviders(
		apiConfiguration?.openRouterModelId,
		apiConfiguration?.openRouterBaseUrl,
		{
			enabled:
				!!apiConfiguration?.openRouterModelId &&
				availableRouterModels?.openrouter &&
				Object.keys(availableRouterModels.openrouter).length > 1 &&
				apiConfiguration.openRouterModelId in availableRouterModels.openrouter,
		},
	)

	// Update `apiModelId` whenever `selectedModelId` changes.
	useEffect(() => {
		if (isRetiredSelectedProvider) {
			return
		}

		if (selectedModelId && apiConfiguration.apiModelId !== selectedModelId) {
			// Pass false as third parameter to indicate this is not a user action
			// This is an internal sync, not a user-initiated change
			setApiConfigurationField("apiModelId", selectedModelId, false)
		}
	}, [selectedModelId, setApiConfigurationField, apiConfiguration.apiModelId, isRetiredSelectedProvider])

	// Debounced refresh model updates, only executed 250ms after the user
	// stops typing.
	useDebounce(
		() => {
			if (selectedProvider === "openai") {
				// Use our custom headers state to build the headers object.
				const headerObject = convertHeadersToObject(customHeaders)

				vscode.postMessage({
					type: "requestOpenAiModels",
					values: {
						baseUrl: apiConfiguration?.openAiBaseUrl,
						apiKey: apiConfiguration?.openAiApiKey,
						customHeaders: {}, // Reserved for any additional headers.
						openAiHeaders: headerObject,
					},
				})
			} else if (selectedProvider === "ollama") {
				vscode.postMessage({ type: "requestOllamaModels" })
			} else if (selectedProvider === "lmstudio") {
				vscode.postMessage({ type: "requestLmStudioModels" })
			} else if (selectedProvider === "vscode-lm") {
				vscode.postMessage({ type: "requestVsCodeLmModels" })
			} else if (
				activeSelectedProvider &&
				shouldRequestRouterModelsForProvider(activeSelectedProvider, apiConfiguration)
			) {
				vscode.postMessage({
					type: "requestRouterModels",
					values: getRouterModelRequestValues(activeSelectedProvider, apiConfiguration),
				})
			}
		},
		250,
		[
			activeSelectedProvider,
			selectedProvider,
			apiConfiguration?.requestyApiKey,
			apiConfiguration?.requestyBaseUrl,
			apiConfiguration?.unboundApiKey,
			apiConfiguration?.apiKey,
			apiConfiguration?.anthropicBaseUrl,
			apiConfiguration?.xaiApiKey,
			apiConfiguration?.openAiBaseUrl,
			apiConfiguration?.openAiApiKey,
			apiConfiguration?.openAiNativeApiKey,
			apiConfiguration?.openAiNativeBaseUrl,
			apiConfiguration?.mistralApiKey,
			apiConfiguration?.deepSeekApiKey,
			apiConfiguration?.deepSeekBaseUrl,
			apiConfiguration?.geminiApiKey,
			apiConfiguration?.googleGeminiBaseUrl,
			apiConfiguration?.moonshotApiKey,
			apiConfiguration?.moonshotBaseUrl,
			apiConfiguration?.fireworksApiKey,
			apiConfiguration?.basetenApiKey,
			apiConfiguration?.sambaNovaApiKey,
			apiConfiguration?.minimaxApiKey,
			apiConfiguration?.minimaxBaseUrl,
			apiConfiguration?.ollamaBaseUrl,
			apiConfiguration?.lmStudioBaseUrl,
			apiConfiguration?.litellmBaseUrl,
			apiConfiguration?.litellmApiKey,
			apiConfiguration?.poeApiKey,
			apiConfiguration?.poeBaseUrl,
			customHeaders,
		],
	)

	useEffect(() => {
		if (isRetiredSelectedProvider) {
			setErrorMessage(undefined)
			return
		}

		const apiValidationResult = validateApiConfigurationExcludingModelErrors(
			apiConfiguration,
			availableRouterModels,
			organizationAllowList,
		)
		setErrorMessage(apiValidationResult)
	}, [apiConfiguration, availableRouterModels, organizationAllowList, setErrorMessage, isRetiredSelectedProvider])

	const onProviderChange = useCallback(
		(value: ProviderName) => {
			setApiConfigurationField("apiProvider", value)

			// It would be much easier to have a single attribute that stores
			// the modelId, but we have a separate attribute for each of
			// OpenRouter and Requesty.
			// If you switch to one of these providers and the corresponding
			// modelId is not set then you immediately end up in an error state.
			// To address that we set the modelId to the default value for th
			// provider if it's not already set.
			const validateAndResetModel = (
				provider: ProviderName,
				modelId: string | undefined,
				field: keyof ProviderSettings,
				defaultValue?: string,
			) => {
				// in case we haven't set a default value for a provider
				if (!defaultValue) return

				// 1) If nothing is set, initialize to the provider default.
				if (!modelId) {
					setApiConfigurationField(field, defaultValue, false)
					return
				}

				// 2) If something *is* set, ensure it's valid for the newly selected provider.
				//
				// Without this, switching providers can leave the UI showing a model from the
				// previously selected provider (including model IDs that don't exist for the
				// newly selected provider).
				//
				// Note: We only validate providers with static model lists.
				const staticModels = MODELS_BY_PROVIDER[provider]
				if (!staticModels) {
					return
				}

				// Bedrock has a special “custom-arn” pseudo-model that isn't part of MODELS_BY_PROVIDER.
				if (provider === "bedrock" && modelId === "custom-arn") {
					return
				}

				const filteredModels = filterModels(staticModels, provider, organizationAllowList)
				const isValidModel = !!filteredModels && Object.prototype.hasOwnProperty.call(filteredModels, modelId)
				if (!isValidModel) {
					setApiConfigurationField(field, defaultValue, false)
				}
			}

			const config = getProviderDefaultModelConfig(value, apiConfiguration)
			if (config) {
				validateAndResetModel(
					value,
					apiConfiguration[config.field] as string | undefined,
					config.field,
					config.default,
				)
			}
		},
		[setApiConfigurationField, apiConfiguration, organizationAllowList],
	)

	const modelValidationError = useMemo(() => {
		return getModelValidationError(apiConfiguration, availableRouterModels, organizationAllowList)
	}, [apiConfiguration, availableRouterModels, organizationAllowList])

	const docs = useMemo(() => {
		const provider = PROVIDERS.find(({ value }) => value === selectedProvider)
		const name = provider?.label

		if (!name) {
			return undefined
		}

		// Get the URL slug - use custom mapping if available, otherwise use the provider key.
		const slugs: Record<string, string> = {
			"openai-native": "openai",
			openai: "openai-compatible",
		}

		const slug = slugs[selectedProvider] || selectedProvider
		return {
			url: buildDocLink(`providers/${slug}`, "provider_docs"),
			name,
		}
	}, [selectedProvider])

	// Convert providers to SearchableSelect options
	const providerOptions = useMemo(() => {
		return getAvailableProviderOptions({
			organizationAllowList,
			selectedProvider: apiConfiguration.apiProvider,
			prioritizeOpenRouter: fromWelcomeView,
		})
	}, [organizationAllowList, apiConfiguration.apiProvider, fromWelcomeView])

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1 relative">
				<div className="flex justify-between items-center">
					<label className="block font-medium">{t("settings:providers.apiProvider")}</label>
					{docs && (
						<VSCodeLink href={docs.url} target="_blank" className="flex gap-2">
							{t("settings:providers.apiProviderDocs")}
							<BookOpenText className="size-4 inline ml-2" />
						</VSCodeLink>
					)}
				</div>
				<SearchableSelect
					value={selectedProvider}
					onValueChange={(value) => onProviderChange(value as ProviderName)}
					options={providerOptions}
					placeholder={t("settings:common.select")}
					searchPlaceholder={t("settings:providers.searchProviderPlaceholder")}
					emptyMessage={t("settings:providers.noProviderMatchFound")}
					className="w-full"
					data-testid="provider-select"
				/>
			</div>

			{errorMessage && <ApiErrorMessage errorMessage={errorMessage} />}

			{isRetiredSelectedProvider ? (
				<div
					className="rounded-md border border-vscode-panel-border px-3 py-2 text-sm text-vscode-descriptionForeground"
					data-testid="retired-provider-message">
					{t(
						apiConfiguration.apiProvider === "roo"
							? "settings:providers.retiredRooProviderMessage"
							: "settings:providers.retiredProviderMessage",
					)}
				</div>
			) : (
				<>
					{selectedProvider === "openrouter" && (
						<OpenRouter
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							routerModels={availableRouterModels}
							selectedModelId={selectedModelId}
							uriScheme={uriScheme}
							simplifySettings={fromWelcomeView}
							organizationAllowList={organizationAllowList}
							modelValidationError={modelValidationError}
						/>
					)}

					{selectedProvider === "requesty" && (
						<Requesty
							uriScheme={uriScheme}
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							routerModels={availableRouterModels}
							refetchRouterModels={refetchRouterModels}
							organizationAllowList={organizationAllowList}
							modelValidationError={modelValidationError}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "unbound" && (
						<Unbound
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							routerModels={availableRouterModels}
							refetchRouterModels={refetchRouterModels}
							organizationAllowList={organizationAllowList}
							modelValidationError={modelValidationError}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "anthropic" && (
						<Anthropic
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "openai-codex" && (
						<OpenAICodex
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							simplifySettings={fromWelcomeView}
							openAiCodexIsAuthenticated={openAiCodexIsAuthenticated}
							openAiCodexFastStatus={openAiCodexFastStatus}
						/>
					)}

					{selectedProvider === "openai-native" && (
						<OpenAI
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							selectedModelInfo={selectedModelInfo}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "mistral" && (
						<Mistral
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "baseten" && (
						<Baseten
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "bedrock" && (
						<Bedrock
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							selectedModelInfo={selectedModelInfo}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "vertex" && (
						<Vertex
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
						/>
					)}

					{selectedProvider === "gemini" && (
						<Gemini
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
						/>
					)}

					{selectedProvider === "openai" && (
						<OpenAICompatible
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							organizationAllowList={organizationAllowList}
							modelValidationError={modelValidationError}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "lmstudio" && (
						<LMStudio
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
						/>
					)}

					{selectedProvider === "deepseek" && (
						<DeepSeek
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "qwen-code" && (
						<QwenCode
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "moonshot" && (
						<Moonshot
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "minimax" && (
						<MiniMax
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
						/>
					)}

					{selectedProvider === "xiaomi-mimo" && (
						<XiaomiMiMo
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
						/>
					)}

					{selectedProvider === "vscode-lm" && (
						<VSCodeLM
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
						/>
					)}

					{selectedProvider === "ollama" && (
						<Ollama
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
						/>
					)}

					{selectedProvider === "xai" && (
						<XAI apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
					)}

					{selectedProvider === "litellm" && (
						<LiteLLM
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							organizationAllowList={organizationAllowList}
							modelValidationError={modelValidationError}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "sambanova" && (
						<SambaNova
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
						/>
					)}

					{selectedProvider === "zai" && (
						<ZAi apiConfiguration={apiConfiguration} setApiConfigurationField={setApiConfigurationField} />
					)}

					{selectedProvider === "vercel-ai-gateway" && (
						<VercelAiGateway
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							routerModels={availableRouterModels}
							organizationAllowList={organizationAllowList}
							modelValidationError={modelValidationError}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{selectedProvider === "fireworks" && (
						<Fireworks
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
						/>
					)}

					{selectedProvider === "poe" && (
						<Poe
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							organizationAllowList={organizationAllowList}
							modelValidationError={modelValidationError}
							simplifySettings={fromWelcomeView}
						/>
					)}

					{/* Generic model picker for providers with static models */}
					{activeSelectedProvider && shouldUseGenericModelPicker(activeSelectedProvider) && (
						<>
							<ModelPicker
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
								defaultModelId={getDefaultModelIdForProvider(activeSelectedProvider, apiConfiguration)}
								models={genericPickerModels}
								modelIdKey="apiModelId"
								serviceName={getProviderServiceConfig(activeSelectedProvider).serviceName}
								serviceUrl={getProviderServiceConfig(activeSelectedProvider).serviceUrl}
								organizationAllowList={organizationAllowList}
								errorMessage={modelValidationError}
								simplifySettings={fromWelcomeView}
								onModelChange={(modelId) =>
									handleModelChangeSideEffects(
										activeSelectedProvider,
										modelId,
										setApiConfigurationField,
									)
								}
							/>

							{selectedProvider === "bedrock" && selectedModelId === "custom-arn" && (
								<BedrockCustomArn
									apiConfiguration={apiConfiguration}
									setApiConfigurationField={setApiConfigurationField}
								/>
							)}
						</>
					)}

					{!fromWelcomeView && (
						<ThinkingBudget
							key={`${selectedProvider}-${selectedModelId}`}
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							modelInfo={selectedModelInfo}
						/>
					)}

					{/* Gate Verbosity UI by capability flag */}
					{!fromWelcomeView && selectedModelInfo?.supportsVerbosity && (
						<Verbosity
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							modelInfo={selectedModelInfo}
						/>
					)}

					{!fromWelcomeView && (
						<Collapsible open={isAdvancedSettingsOpen} onOpenChange={setIsAdvancedSettingsOpen}>
							<CollapsibleTrigger className="flex items-center gap-1 w-full cursor-pointer hover:opacity-80 mb-2">
								<span
									className={`codicon codicon-chevron-${isAdvancedSettingsOpen ? "down" : "right"}`}></span>
								<span className="font-medium">{t("settings:advancedSettings.title")}</span>
							</CollapsibleTrigger>
							<CollapsibleContent className="space-y-3">
								<TodoListSettingsControl
									todoListEnabled={apiConfiguration.todoListEnabled}
									onChange={(field, value) => setApiConfigurationField(field, value)}
								/>
								{selectedModelInfo?.supportsTemperature !== false && (
									<TemperatureControl
										value={apiConfiguration.modelTemperature}
										onChange={handleInputChange("modelTemperature", noTransform)}
										maxValue={2}
										defaultValue={selectedModelInfo?.defaultTemperature}
									/>
								)}
								<RateLimitSecondsControl
									value={apiConfiguration.rateLimitSeconds || 0}
									onChange={(value) => setApiConfigurationField("rateLimitSeconds", value)}
								/>
								<ConsecutiveMistakeLimitControl
									value={
										apiConfiguration.consecutiveMistakeLimit !== undefined
											? apiConfiguration.consecutiveMistakeLimit
											: DEFAULT_CONSECUTIVE_MISTAKE_LIMIT
									}
									onChange={(value) => setApiConfigurationField("consecutiveMistakeLimit", value)}
								/>
								{selectedProvider === "poe" && (
									<VSCodeTextField
										value={apiConfiguration?.poeBaseUrl || ""}
										onInput={handleInputChange("poeBaseUrl")}
										placeholder="https://api.poe.com/v1"
										className="w-full">
										<label className="block font-medium mb-1">
											{t("settings:providers.poeBaseUrl")}
										</label>
									</VSCodeTextField>
								)}
								{selectedProvider === "openrouter" &&
									openRouterModelProviders &&
									Object.keys(openRouterModelProviders).length > 0 && (
										<div>
											<div className="flex items-center gap-1">
												<label className="block font-medium mb-1">
													{t("settings:providers.openRouter.providerRouting.title")}
												</label>
												<a href={`https://openrouter.ai/${selectedModelId}/providers`}>
													<ExternalLinkIcon className="w-4 h-4" />
												</a>
											</div>
											<Select
												value={
													apiConfiguration?.openRouterSpecificProvider ||
													OPENROUTER_DEFAULT_PROVIDER_NAME
												}
												onValueChange={(value) =>
													setApiConfigurationField("openRouterSpecificProvider", value)
												}>
												<SelectTrigger className="w-full">
													<SelectValue placeholder={t("settings:common.select")} />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value={OPENROUTER_DEFAULT_PROVIDER_NAME}>
														{OPENROUTER_DEFAULT_PROVIDER_NAME}
													</SelectItem>
													{Object.entries(openRouterModelProviders).map(
														([value, { label }]) => (
															<SelectItem key={value} value={value}>
																{label}
															</SelectItem>
														),
													)}
												</SelectContent>
											</Select>
											<div className="text-sm text-vscode-descriptionForeground mt-1">
												{t("settings:providers.openRouter.providerRouting.description")}{" "}
												<a href="https://openrouter.ai/docs/features/provider-routing">
													{t("settings:providers.openRouter.providerRouting.learnMore")}.
												</a>
											</div>
										</div>
									)}
							</CollapsibleContent>
						</Collapsible>
					)}
				</>
			)}
		</div>
	)
}

export default memo(ApiOptions)

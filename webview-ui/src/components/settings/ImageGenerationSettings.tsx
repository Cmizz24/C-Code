import React, { useMemo } from "react"
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import {
	getDefaultImageGenerationApiMethod,
	getDefaultImageGenerationModel,
	getImageGenerationModel,
	getImageGenerationModels,
	getImageGenerationProvider,
	ACTIVE_IMAGE_GENERATION_PROVIDER_DEFINITIONS,
	IMAGE_GENERATION_PROVIDERS,
	type ImageGenerationModel,
	type ImageGenerationApiMethod,
	type ImageGenerationProvider,
	type ImageGenerationProviderSettingsKeys,
} from "@roo-code/types"
import type { ExtensionStateContextType } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useRouterModels } from "@src/components/ui/hooks/useRouterModels"

import { Section } from "./Section"
import { SectionHeader } from "./SectionHeader"

export type ImageGenerationSettingField =
	| "imageGenerationProvider"
	| NonNullable<ImageGenerationProviderSettingsKeys[keyof ImageGenerationProviderSettingsKeys]>

export type ImageGenerationSettingsValues = Partial<Pick<ExtensionStateContextType, ImageGenerationSettingField>>

export type SetImageGenerationSetting = <K extends ImageGenerationSettingField>(
	field: K,
	value: ExtensionStateContextType[K],
) => void

interface ImageGenerationSettingsProps {
	imageGenerationSettings: ImageGenerationSettingsValues
	setImageGenerationSetting: SetImageGenerationSetting
}

export const ImageGenerationSettings = ({
	imageGenerationSettings,
	setImageGenerationSetting,
}: ImageGenerationSettingsProps) => {
	const { t } = useAppTranslation()

	const getStringSetting = (field: ImageGenerationSettingField | undefined): string | undefined => {
		if (!field) {
			return undefined
		}

		const value = imageGenerationSettings[field]
		return typeof value === "string" ? value : undefined
	}

	const currentProvider = getImageGenerationProvider(
		imageGenerationSettings.imageGenerationProvider,
		!!imageGenerationSettings.openRouterImageGenerationSelectedModel,
	)
	const providerDefinition = IMAGE_GENERATION_PROVIDERS[currentProvider]
	const settingsKeys = providerDefinition.settingsKeys

	const configuredModel = getStringSetting(settingsKeys.model)?.trim()
	const defaultModel = getDefaultImageGenerationModel(currentProvider)
	const currentModel = configuredModel || defaultModel
	const configuredBaseUrl = getStringSetting(settingsKeys.baseUrl) ?? ""
	const configuredApiKey = getStringSetting(settingsKeys.apiKey) ?? ""
	const configuredOpenRouterBaseUrl = getStringSetting("openRouterImageBaseUrl") ?? ""
	const configuredOpenRouterApiKey = getStringSetting("openRouterImageApiKey") ?? ""
	const openRouterModelRequestValues = useMemo(() => {
		const values: Record<string, string> = {}

		if (configuredOpenRouterBaseUrl.trim()) {
			values.openRouterImageBaseUrl = configuredOpenRouterBaseUrl.trim()
		}

		if (configuredOpenRouterApiKey.trim()) {
			values.openRouterImageApiKey = configuredOpenRouterApiKey.trim()
		}

		return values
	}, [configuredOpenRouterApiKey, configuredOpenRouterBaseUrl])
	const { data: openRouterImageRouterModels } = useRouterModels({
		provider: "openrouter",
		modelType: "image",
		values: openRouterModelRequestValues,
		enabled: currentProvider === "openrouter",
	})
	const availableModels = useMemo(() => {
		const staticModels = getImageGenerationModels(currentProvider)

		if (currentProvider !== "openrouter") {
			return staticModels
		}

		const staticModelIds = new Set(staticModels.map((model) => model.value))
		const dynamicModels: ImageGenerationModel[] = Object.entries(openRouterImageRouterModels?.openrouter ?? {})
			.filter(([modelId]) => !staticModelIds.has(modelId))
			.map(([modelId, modelInfo]) => ({
				value: modelId,
				label: modelId,
				provider: "openrouter",
				supportsImageInput: modelInfo.supportsImages,
			}))

		return [...staticModels, ...dynamicModels]
	}, [currentProvider, openRouterImageRouterModels])
	const selectableModels = useMemo(() => {
		if (!currentModel || availableModels.some((model) => model.value === currentModel)) {
			return availableModels
		}

		return [
			{
				value: currentModel,
				label: currentModel,
				provider: currentProvider,
				isCustom: true,
			},
			...availableModels,
		]
	}, [availableModels, currentModel, currentProvider])
	const currentModelInfo = getImageGenerationModel(currentProvider, currentModel)
	const configuredApiMethod = getStringSetting(settingsKeys.apiMethod) as ImageGenerationApiMethod | undefined
	const supportedConfiguredApiMethod =
		configuredApiMethod && providerDefinition.supportedApiMethods.includes(configuredApiMethod)
			? configuredApiMethod
			: undefined
	const currentApiMethod =
		currentModelInfo?.apiMethod ||
		supportedConfiguredApiMethod ||
		getDefaultImageGenerationApiMethod(currentProvider)
	const apiMethodLockedByModel = !!currentModelInfo?.apiMethod
	const configuredNegativePrompt = getStringSetting(settingsKeys.negativePrompt) ?? ""
	const hasRequiredApiKey = !providerDefinition.requiresApiKey || configuredApiKey.trim().length > 0
	const requiresModel = providerDefinition.requiresModel ?? true
	const hasModel = !requiresModel || currentModel.trim().length > 0
	const isConfigured = hasRequiredApiKey && hasModel
	const apiMethodDescriptionKey = "settings:imageGeneration.apiMethodDescription"
	const modelFieldPlaceholder = providerDefinition.defaultModel
		? t("settings:imageGeneration.modelIdPlaceholderWithDefault", {
				model: providerDefinition.defaultModel,
			})
		: t("settings:imageGeneration.customModelIdPlaceholder")

	const handleProviderChange = (value: string) => {
		setImageGenerationSetting("imageGenerationProvider", value as ImageGenerationProvider)
	}

	const handleApiMethodChange = (value: string) => {
		setImageGenerationSetting(settingsKeys.apiMethod, value as ImageGenerationApiMethod)
	}

	const handleModelChange = (value: string) => {
		setImageGenerationSetting(settingsKeys.model, value)
	}

	const handleNegativePromptChange = (value: string) => {
		if (settingsKeys.negativePrompt) {
			setImageGenerationSetting(settingsKeys.negativePrompt, value)
		}
	}

	const renderModelInput = () => {
		if (providerDefinition.supportsCustomModelId) {
			return (
				<VSCodeTextField
					value={configuredModel ?? ""}
					onInput={(e: any) => handleModelChange(e.target.value)}
					placeholder={modelFieldPlaceholder}
					className="w-full"
				/>
			)
		}

		return (
			<VSCodeDropdown
				value={currentModel}
				onChange={(e: any) => handleModelChange(e.target.value)}
				className="w-full">
				{selectableModels.map((model) => (
					<VSCodeOption key={model.value} value={model.value} className="py-2 px-3">
						{model.label}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
		)
	}

	return (
		<div>
			<SectionHeader>{t("settings:sections.imageGeneration")}</SectionHeader>

			<Section>
				<p className="text-vscode-descriptionForeground text-sm mt-0">
					{t("settings:imageGeneration.description")}
				</p>

				<div className="space-y-3">
					<div>
						<label className="block font-medium mb-1">{t("settings:imageGeneration.providerLabel")}</label>
						<VSCodeDropdown
							value={currentProvider}
							onChange={(e: any) => handleProviderChange(e.target.value)}
							className="w-full">
							{ACTIVE_IMAGE_GENERATION_PROVIDER_DEFINITIONS.map((provider) => (
								<VSCodeOption key={provider.value} value={provider.value} className="py-2 px-3">
									{provider.label}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:imageGeneration.providerDescription")}
						</p>
					</div>

					{settingsKeys.apiKey && (
						<div>
							<label className="block font-medium mb-1">
								{providerDefinition.requiresApiKey
									? t("settings:imageGeneration.apiKeyLabel", {
											provider: providerDefinition.label,
										})
									: t("settings:imageGeneration.optionalApiKeyLabel", {
											provider: providerDefinition.label,
										})}
							</label>
							<VSCodeTextField
								value={configuredApiKey}
								onInput={(e: any) => setImageGenerationSetting(settingsKeys.apiKey!, e.target.value)}
								placeholder={t("settings:imageGeneration.apiKeyPlaceholder", {
									provider: providerDefinition.label,
								})}
								className="w-full"
								type="password"
							/>
							<p className="text-vscode-descriptionForeground text-xs mt-1">
								{providerDefinition.requiresApiKey
									? t("settings:imageGeneration.apiKeyRequiredDescription")
									: t("settings:imageGeneration.apiKeyOptionalDescription")}
								{providerDefinition.apiKeyUrl && (
									<>
										{" "}
										{t("settings:imageGeneration.getApiKeyText")}{" "}
										<a
											href={providerDefinition.apiKeyUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
											{providerDefinition.apiKeyUrl.replace(/^https?:\/\//, "")}
										</a>
									</>
								)}
							</p>
						</div>
					)}

					<div>
						<label className="block font-medium mb-1">{t("settings:imageGeneration.baseUrlLabel")}</label>
						<VSCodeTextField
							value={configuredBaseUrl}
							onInput={(e: any) => setImageGenerationSetting(settingsKeys.baseUrl, e.target.value)}
							placeholder={t("settings:imageGeneration.baseUrlPlaceholder", {
								url: providerDefinition.defaultBaseUrl,
							})}
							className="w-full"
							type="url"
						/>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:imageGeneration.baseUrlDescription", {
								url: providerDefinition.defaultBaseUrl,
							})}
						</p>
					</div>

					<div>
						<label className="block font-medium mb-1">
							{providerDefinition.supportsCustomModelId
								? t("settings:imageGeneration.modelIdLabel")
								: t("settings:imageGeneration.modelSelectionLabel")}
						</label>
						{renderModelInput()}
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{!requiresModel
								? t("settings:imageGeneration.optionalModelIdDescription")
								: providerDefinition.supportsCustomModelId
									? t("settings:imageGeneration.customModelIdDescription")
									: currentProvider === "openrouter"
										? t("settings:imageGeneration.openRouterModelDiscoveryDescription")
										: t("settings:imageGeneration.modelSelectionDescription")}
						</p>
					</div>

					{settingsKeys.negativePrompt && (
						<div>
							<label className="block font-medium mb-1">
								{t("settings:imageGeneration.negativePromptLabel")}
							</label>
							<VSCodeTextField
								value={configuredNegativePrompt}
								onInput={(e: any) => handleNegativePromptChange(e.target.value)}
								placeholder={t("settings:imageGeneration.negativePromptPlaceholder")}
								className="w-full"
							/>
							<p className="text-vscode-descriptionForeground text-xs mt-1">
								{t("settings:imageGeneration.negativePromptDescription")}
							</p>
						</div>
					)}

					<div>
						<label className="block font-medium mb-1">{t("settings:imageGeneration.apiMethodLabel")}</label>
						<VSCodeDropdown
							value={currentApiMethod}
							onChange={(e: any) => handleApiMethodChange(e.target.value)}
							className="w-full"
							disabled={apiMethodLockedByModel || providerDefinition.supportedApiMethods.length === 1}>
							{providerDefinition.supportedApiMethods.map((method) => (
								<VSCodeOption key={method} value={method} className="py-2 px-3">
									{t(`settings:imageGeneration.apiMethodLabels.${method}`)}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{apiMethodLockedByModel && currentModelInfo
								? t("settings:imageGeneration.apiMethodLockedDescription", {
										model: currentModelInfo.label,
									})
								: t(apiMethodDescriptionKey)}
						</p>
					</div>

					{!hasRequiredApiKey && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:imageGeneration.warningMissingApiKey", {
								provider: providerDefinition.label,
							})}
						</div>
					)}

					{hasRequiredApiKey && requiresModel && !hasModel && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:imageGeneration.warningMissingModel", {
								provider: providerDefinition.label,
							})}
						</div>
					)}

					{isConfigured && (
						<div className="p-2 bg-vscode-editorInfo-background text-vscode-editorInfo-foreground rounded text-sm">
							{t("settings:imageGeneration.successConfigured", {
								provider: providerDefinition.label,
							})}
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

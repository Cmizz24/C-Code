import React, { useMemo } from "react"
import { VSCodeCheckbox, VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import {
	getDefaultImageGenerationApiMethod,
	getDefaultImageGenerationModel,
	getImageGenerationModel,
	getImageGenerationModels,
	getImageGenerationProvider,
	IMAGE_GENERATION_PROVIDER_DEFINITIONS,
	IMAGE_GENERATION_PROVIDERS,
	type ImageGenerationApiMethod,
	type ImageGenerationProvider,
	type ImageGenerationProviderSettingsKeys,
} from "@roo-code/types"
import type { ExtensionStateContextType } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"

export type ImageGenerationSettingField =
	| "imageGenerationProvider"
	| NonNullable<ImageGenerationProviderSettingsKeys[keyof ImageGenerationProviderSettingsKeys]>

export type ImageGenerationSettingsValues = Partial<Pick<ExtensionStateContextType, ImageGenerationSettingField>>

export type SetImageGenerationSetting = <K extends ImageGenerationSettingField>(
	field: K,
	value: ExtensionStateContextType[K],
) => void

interface ImageGenerationSettingsProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
	imageGenerationSettings: ImageGenerationSettingsValues
	setImageGenerationSetting: SetImageGenerationSetting
}

export const ImageGenerationSettings = ({
	enabled,
	onChange,
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

	const availableModels = useMemo(() => getImageGenerationModels(currentProvider), [currentProvider])
	const configuredModel = getStringSetting(settingsKeys.model)?.trim()
	const defaultModel = getDefaultImageGenerationModel(currentProvider)
	const currentModel = configuredModel || defaultModel
	const currentModelInfo = getImageGenerationModel(currentProvider, currentModel)
	const configuredApiMethod = getStringSetting(settingsKeys.apiMethod) as ImageGenerationApiMethod | undefined
	const currentApiMethod =
		currentModelInfo?.apiMethod || configuredApiMethod || getDefaultImageGenerationApiMethod(currentProvider)
	const apiMethodLockedByModel = !!currentModelInfo?.apiMethod
	const configuredBaseUrl = getStringSetting(settingsKeys.baseUrl) ?? ""
	const configuredApiKey = getStringSetting(settingsKeys.apiKey) ?? ""
	const hasRequiredApiKey = !providerDefinition.requiresApiKey || configuredApiKey.trim().length > 0
	const hasModel = currentModel.trim().length > 0
	const isConfigured = hasRequiredApiKey && hasModel
	const modelFieldPlaceholder = providerDefinition.defaultModel
		? t("settings:experimental.IMAGE_GENERATION.modelIdPlaceholderWithDefault", {
				model: providerDefinition.defaultModel,
			})
		: t("settings:experimental.IMAGE_GENERATION.customModelIdPlaceholder")

	const handleProviderChange = (value: string) => {
		setImageGenerationSetting("imageGenerationProvider", value as ImageGenerationProvider)
	}

	const handleApiMethodChange = (value: string) => {
		setImageGenerationSetting(settingsKeys.apiMethod, value as ImageGenerationApiMethod)
	}

	const handleModelChange = (value: string) => {
		setImageGenerationSetting(settingsKeys.model, value)
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
				{availableModels.map((model) => (
					<VSCodeOption key={model.value} value={model.value} className="py-2 px-3">
						{model.label}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
		)
	}

	return (
		<div className="space-y-4">
			<div>
				<div className="flex items-center gap-2">
					<VSCodeCheckbox checked={enabled} onChange={(e: any) => onChange(e.target.checked)}>
						<span className="font-medium">{t("settings:experimental.IMAGE_GENERATION.name")}</span>
					</VSCodeCheckbox>
				</div>
				<p className="text-vscode-descriptionForeground text-sm mt-0">
					{t("settings:experimental.IMAGE_GENERATION.description")}
				</p>
			</div>

			{enabled && (
				<div className="ml-2 space-y-3">
					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.providerLabel")}
						</label>
						<VSCodeDropdown
							value={currentProvider}
							onChange={(e: any) => handleProviderChange(e.target.value)}
							className="w-full">
							{IMAGE_GENERATION_PROVIDER_DEFINITIONS.map((provider) => (
								<VSCodeOption key={provider.value} value={provider.value} className="py-2 px-3">
									{provider.label}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:experimental.IMAGE_GENERATION.providerDescription")}
						</p>
					</div>

					{settingsKeys.apiKey && (
						<div>
							<label className="block font-medium mb-1">
								{providerDefinition.requiresApiKey
									? t("settings:experimental.IMAGE_GENERATION.apiKeyLabel", {
											provider: providerDefinition.label,
										})
									: t("settings:experimental.IMAGE_GENERATION.optionalApiKeyLabel", {
											provider: providerDefinition.label,
										})}
							</label>
							<VSCodeTextField
								value={configuredApiKey}
								onInput={(e: any) => setImageGenerationSetting(settingsKeys.apiKey!, e.target.value)}
								placeholder={t("settings:experimental.IMAGE_GENERATION.apiKeyPlaceholder", {
									provider: providerDefinition.label,
								})}
								className="w-full"
								type="password"
							/>
							<p className="text-vscode-descriptionForeground text-xs mt-1">
								{providerDefinition.requiresApiKey
									? t("settings:experimental.IMAGE_GENERATION.apiKeyRequiredDescription")
									: t("settings:experimental.IMAGE_GENERATION.apiKeyOptionalDescription")}
								{providerDefinition.apiKeyUrl && (
									<>
										{" "}
										{t("settings:experimental.IMAGE_GENERATION.getApiKeyText")}{" "}
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
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.baseUrlLabel")}
						</label>
						<VSCodeTextField
							value={configuredBaseUrl}
							onInput={(e: any) => setImageGenerationSetting(settingsKeys.baseUrl, e.target.value)}
							placeholder={t("settings:experimental.IMAGE_GENERATION.baseUrlPlaceholder", {
								url: providerDefinition.defaultBaseUrl,
							})}
							className="w-full"
							type="url"
						/>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:experimental.IMAGE_GENERATION.baseUrlDescription", {
								url: providerDefinition.defaultBaseUrl,
							})}
						</p>
					</div>

					<div>
						<label className="block font-medium mb-1">
							{providerDefinition.supportsCustomModelId
								? t("settings:experimental.IMAGE_GENERATION.modelIdLabel")
								: t("settings:experimental.IMAGE_GENERATION.modelSelectionLabel")}
						</label>
						{renderModelInput()}
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{providerDefinition.supportsCustomModelId
								? t("settings:experimental.IMAGE_GENERATION.customModelIdDescription")
								: t("settings:experimental.IMAGE_GENERATION.modelSelectionDescription")}
						</p>
					</div>

					<div>
						<label className="block font-medium mb-1">
							{t("settings:experimental.IMAGE_GENERATION.apiMethodLabel")}
						</label>
						<VSCodeDropdown
							value={currentApiMethod}
							onChange={(e: any) => handleApiMethodChange(e.target.value)}
							className="w-full"
							disabled={apiMethodLockedByModel || providerDefinition.supportedApiMethods.length === 1}>
							{providerDefinition.supportedApiMethods.map((method) => (
								<VSCodeOption key={method} value={method} className="py-2 px-3">
									{t(`settings:experimental.IMAGE_GENERATION.apiMethodLabels.${method}`)}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<p className="text-vscode-descriptionForeground text-xs mt-1">
							{apiMethodLockedByModel && currentModelInfo
								? t("settings:experimental.IMAGE_GENERATION.apiMethodLockedDescription", {
										model: currentModelInfo.label,
									})
								: t("settings:experimental.IMAGE_GENERATION.apiMethodDescription")}
						</p>
					</div>

					{!hasRequiredApiKey && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.warningMissingApiKey", {
								provider: providerDefinition.label,
							})}
						</div>
					)}

					{hasRequiredApiKey && !hasModel && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.warningMissingModel", {
								provider: providerDefinition.label,
							})}
						</div>
					)}

					{isConfigured && (
						<div className="p-2 bg-vscode-editorInfo-background text-vscode-editorInfo-foreground rounded text-sm">
							{t("settings:experimental.IMAGE_GENERATION.successConfigured", {
								provider: providerDefinition.label,
							})}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

import React, { useMemo } from "react"
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import {
	getDefaultImageGenerationApiMethod,
	getDefaultImageGenerationModel,
	getCloudflareWorkersAiImageUsageSnapshot,
	getImageGenerationModel,
	getImageGenerationModels,
	getImageGenerationProvider,
	ACTIVE_IMAGE_GENERATION_PROVIDER_DEFINITIONS,
	CLOUDFLARE_WORKERS_AI_FREE_ALLOCATION,
	CLOUDFLARE_WORKERS_AI_IMAGE_MODEL_PRICING,
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
	cloudflareWorkersAiImageUsage?: ExtensionStateContextType["cloudflareWorkersAiImageUsage"]
	setImageGenerationSetting: SetImageGenerationSetting
}

export const ImageGenerationSettings = ({
	imageGenerationSettings,
	cloudflareWorkersAiImageUsage,
	setImageGenerationSetting,
}: ImageGenerationSettingsProps) => {
	const { t, i18n } = useAppTranslation()

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
	const configuredAccountId = getStringSetting(settingsKeys.accountId) ?? ""
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
	const hasRequiredAccountId = !settingsKeys.accountId || configuredAccountId.trim().length > 0
	const requiresModel = providerDefinition.requiresModel ?? true
	const hasModel = !requiresModel || currentModel.trim().length > 0
	const isConfigured = hasRequiredApiKey && hasRequiredAccountId && hasModel
	const apiMethodDescriptionKey =
		currentProvider === "cloudflare"
			? "settings:imageGeneration.cloudflareApiMethodDescription"
			: "settings:imageGeneration.apiMethodDescription"
	const numberFormatter = useMemo(
		() =>
			new Intl.NumberFormat(i18n.language || undefined, {
				maximumFractionDigits: 2,
			}),
		[i18n.language],
	)
	const dateTimeFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(i18n.language || undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				timeZone: "UTC",
				timeZoneName: "short",
			}),
		[i18n.language],
	)
	const cloudflareUsageSnapshot = useMemo(
		() => getCloudflareWorkersAiImageUsageSnapshot(cloudflareWorkersAiImageUsage),
		[cloudflareWorkersAiImageUsage],
	)
	const cloudflareUsageResetAt = useMemo(
		() => dateTimeFormatter.format(new Date(cloudflareUsageSnapshot.resetAt)),
		[cloudflareUsageSnapshot.resetAt, dateTimeFormatter],
	)
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

	const handleAccountIdChange = (value: string) => {
		if (settingsKeys.accountId) {
			setImageGenerationSetting(settingsKeys.accountId, value)
		}
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

	const renderCloudflarePricing = () => {
		if (currentProvider !== "cloudflare") {
			return null
		}

		return (
			<div className="rounded border border-vscode-panel-border bg-vscode-editor-background p-3 text-xs text-vscode-descriptionForeground">
				<div className="mb-2 text-sm font-medium text-vscode-foreground">
					{t("settings:imageGeneration.cloudflarePricing.title")}
				</div>
				<p className="mb-3 mt-0">
					{t("settings:imageGeneration.cloudflarePricing.quotaDescription", {
						freeAllocation: CLOUDFLARE_WORKERS_AI_FREE_ALLOCATION.neuronsPerDay,
						resetTime: CLOUDFLARE_WORKERS_AI_FREE_ALLOCATION.resetTime,
						paidOverage: CLOUDFLARE_WORKERS_AI_FREE_ALLOCATION.paidOverage,
					})}
				</p>
				<div className="mb-3 rounded border border-vscode-panel-border bg-vscode-sideBar-background p-3">
					<div className="mb-2 text-sm font-medium text-vscode-foreground">
						{t("settings:imageGeneration.cloudflareUsage.title")}
					</div>
					<div className="grid gap-2 sm:grid-cols-2">
						<div>
							<div className="text-vscode-descriptionForeground">
								{t("settings:imageGeneration.cloudflareUsage.remainingLabel")}
							</div>
							<div className="text-sm font-medium text-vscode-foreground">
								{t("settings:imageGeneration.cloudflareUsage.neuronsValue", {
									count: numberFormatter.format(cloudflareUsageSnapshot.estimatedRemainingNeurons),
								})}
							</div>
						</div>
						<div>
							<div className="text-vscode-descriptionForeground">
								{t("settings:imageGeneration.cloudflareUsage.usedLabel")}
							</div>
							<div className="text-sm font-medium text-vscode-foreground">
								{t("settings:imageGeneration.cloudflareUsage.usedValue", {
									used: numberFormatter.format(cloudflareUsageSnapshot.neuronsUsed),
									quota: numberFormatter.format(cloudflareUsageSnapshot.dailyQuotaNeurons),
								})}
							</div>
						</div>
						<div>
							<div className="text-vscode-descriptionForeground">
								{t("settings:imageGeneration.cloudflareUsage.requestsLabel")}
							</div>
							<div className="text-sm font-medium text-vscode-foreground">
								{numberFormatter.format(cloudflareUsageSnapshot.requestCount)}
							</div>
						</div>
						<div>
							<div className="text-vscode-descriptionForeground">
								{t("settings:imageGeneration.cloudflareUsage.resetLabel")}
							</div>
							<div className="text-sm font-medium text-vscode-foreground">{cloudflareUsageResetAt}</div>
						</div>
					</div>
					<p className="mb-0 mt-3">
						{t("settings:imageGeneration.cloudflareUsage.localEstimateDescription")}
					</p>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full border-collapse text-left">
						<thead>
							<tr className="border-b border-vscode-panel-border">
								<th className="py-1 pr-3 font-medium text-vscode-foreground">
									{t("settings:imageGeneration.cloudflarePricing.modelColumn")}
								</th>
								<th className="py-1 pr-3 font-medium text-vscode-foreground">
									{t("settings:imageGeneration.cloudflarePricing.priceColumn")}
								</th>
								<th className="py-1 font-medium text-vscode-foreground">
									{t("settings:imageGeneration.cloudflarePricing.neuronsColumn")}
								</th>
							</tr>
						</thead>
						<tbody>
							{CLOUDFLARE_WORKERS_AI_IMAGE_MODEL_PRICING.map((pricing) => (
								<tr key={pricing.model} className="border-b border-vscode-panel-border last:border-b-0">
									<td className="py-2 pr-3 align-top">
										<div className="font-medium text-vscode-foreground">{pricing.label}</div>
										<div className="font-mono text-[11px]">{pricing.model}</div>
									</td>
									<td className="py-2 pr-3 align-top">
										<ul className="m-0 list-none p-0">
											{pricing.priceDetails.map((detail) => (
												<li key={detail}>{detail}</li>
											))}
										</ul>
									</td>
									<td className="py-2 align-top">
										<ul className="m-0 list-none p-0">
											{pricing.neuronDetails.map((detail) => (
												<li key={detail}>{detail}</li>
											))}
										</ul>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
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

					{settingsKeys.accountId && (
						<div>
							<label className="block font-medium mb-1">
								{t("settings:imageGeneration.cloudflareAccountIdLabel")}
							</label>
							<VSCodeTextField
								value={configuredAccountId}
								onInput={(e: any) => handleAccountIdChange(e.target.value)}
								placeholder={t("settings:imageGeneration.cloudflareAccountIdPlaceholder")}
								className="w-full"
							/>
							<p className="text-vscode-descriptionForeground text-xs mt-1">
								{t("settings:imageGeneration.cloudflareAccountIdDescription")}
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
							{currentProvider === "cloudflare"
								? t("settings:imageGeneration.cloudflareBaseUrlDescription", {
										url: providerDefinition.defaultBaseUrl,
									})
								: t("settings:imageGeneration.baseUrlDescription", {
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
							{apiMethodLockedByModel && currentModelInfo && currentProvider !== "cloudflare"
								? t("settings:imageGeneration.apiMethodLockedDescription", {
										model: currentModelInfo.label,
									})
								: t(apiMethodDescriptionKey)}
						</p>
					</div>

					{renderCloudflarePricing()}

					{!hasRequiredApiKey && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:imageGeneration.warningMissingApiKey", {
								provider: providerDefinition.label,
							})}
						</div>
					)}

					{hasRequiredApiKey && !hasRequiredAccountId && (
						<div className="p-2 bg-vscode-editorWarning-background text-vscode-editorWarning-foreground rounded text-sm">
							{t("settings:imageGeneration.warningMissingAccountId", {
								provider: providerDefinition.label,
							})}
						</div>
					)}

					{hasRequiredApiKey && hasRequiredAccountId && requiresModel && !hasModel && (
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

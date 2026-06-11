import { useState, useCallback, useMemo } from "react"
import { useEvent } from "react-use"

import {
	openAiModelInfoSaneDefaults,
	type ProviderSettings,
	type ExtensionMessage,
	type ModelInfo,
	type LanguageModelChatSelector,
} from "@roo-code/types"
import {
	parseVsCodeLmModelSelector,
	stringifyVsCodeLmModelSelector,
	VSCODE_LM_SELECTOR_KEYS,
} from "@roo/vsCodeSelectorUtils"

import { useAppTranslation } from "@src/i18n/TranslationContext"

import { ModelPicker } from "../ModelPicker"

type VSCodeLMProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const VSCodeLM = ({ apiConfiguration, setApiConfigurationField }: VSCodeLMProps) => {
	const { t } = useAppTranslation()

	const [vsCodeLmModels, setVsCodeLmModels] = useState<LanguageModelChatSelector[]>([])

	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data

		switch (message.type) {
			case "vsCodeLmModels":
				{
					const newModels = message.vsCodeLmModels ?? []
					setVsCodeLmModels(newModels)
				}
				break
		}
	}, [])

	useEvent("message", onMessage)

	// Convert VSCode LM models array to Record format for ModelPicker
	const modelsRecord = useMemo((): Record<string, ModelInfo> => {
		return vsCodeLmModels.reduce(
			(acc, model) => {
				const modelId = stringifyVsCodeLmModelSelector(model)
				const description = VSCODE_LM_SELECTOR_KEYS.map((key) => model[key])
					.filter(Boolean)
					.join(" - ")

				acc[modelId] = {
					...openAiModelInfoSaneDefaults,
					supportsImages: false,
					supportsPromptCache: false,
					description,
				}
				return acc
			},
			{} as Record<string, ModelInfo>,
		)
	}, [vsCodeLmModels])

	// Transform string model ID to a full selector object for storage.
	const valueTransform = useCallback((modelId: string) => {
		return parseVsCodeLmModelSelector(modelId)
	}, [])

	// Transform stored selector object back to display string.
	const displayTransform = useCallback((value: unknown) => {
		if (!value) return ""
		return stringifyVsCodeLmModelSelector(value as LanguageModelChatSelector)
	}, [])

	return (
		<>
			{vsCodeLmModels.length > 0 ? (
				<ModelPicker
					apiConfiguration={apiConfiguration}
					setApiConfigurationField={setApiConfigurationField}
					defaultModelId=""
					models={modelsRecord}
					modelIdKey="vsCodeLmModelSelector"
					serviceName="VS Code LM"
					serviceUrl="https://code.visualstudio.com/api/extension-guides/language-model"
					valueTransform={valueTransform}
					displayTransform={displayTransform}
					hidePricing
				/>
			) : (
				<div>
					<label className="block font-medium mb-1">{t("settings:providers.vscodeLmModel")}</label>
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.vscodeLmDescription")}
					</div>
				</div>
			)}
			<div className="text-sm text-vscode-errorForeground">{t("settings:providers.vscodeLmWarning")}</div>
		</>
	)
}

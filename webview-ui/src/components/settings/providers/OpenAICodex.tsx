import React from "react"

import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import {
	type ModelInfo,
	type OpenAiCodexFastStatus,
	type OpenAiCodexModelId,
	type ProviderSettings,
	openAiCodexDefaultModelId,
	openAiCodexModels,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "@src/components/ui"
import { vscode } from "@src/utils/vscode"

import { ModelPicker } from "../ModelPicker"
import { OpenAICodexRateLimitDashboard } from "./OpenAICodexRateLimitDashboard"

interface OpenAICodexProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
	openAiCodexIsAuthenticated?: boolean
	openAiCodexFastStatus?: OpenAiCodexFastStatus
}

type FastModeStatusKey = "disabled" | "unsupported" | "signInRequired" | "active" | "confirmed" | "rejected"
type FastModeStatusSeverity = "green" | "amber" | "red"

type FastModeStatusView = {
	key: FastModeStatusKey
	severity: FastModeStatusSeverity
}

const fastModeIndicatorClassNames: Record<FastModeStatusSeverity, string> = {
	green: "bg-vscode-charts-green",
	amber: "bg-vscode-charts-yellow",
	red: "bg-vscode-errorForeground",
}

export const OpenAICodex: React.FC<OpenAICodexProps> = ({
	apiConfiguration,
	setApiConfigurationField,
	simplifySettings,
	openAiCodexIsAuthenticated = false,
	openAiCodexFastStatus,
}) => {
	const { t } = useAppTranslation()
	const selectedModelId = apiConfiguration.apiModelId ?? openAiCodexDefaultModelId
	const selectedModel =
		selectedModelId in openAiCodexModels
			? (openAiCodexModels[selectedModelId as OpenAiCodexModelId] as ModelInfo)
			: undefined
	const fastModeEnabled = apiConfiguration.openAiCodexFastMode ?? false
	const fastModeSupported = selectedModel?.supportsFastMode === true
	const fastStatusMatchesSelectedModel = openAiCodexFastStatus?.modelId === selectedModelId
	const fastModeStatus: FastModeStatusView = !fastModeSupported
		? { key: "unsupported", severity: "red" }
		: !fastModeEnabled
			? { key: "disabled", severity: "red" }
			: !openAiCodexIsAuthenticated
				? { key: "signInRequired", severity: "amber" }
				: fastStatusMatchesSelectedModel && openAiCodexFastStatus.state === "rejected"
					? { key: "rejected", severity: "red" }
					: fastStatusMatchesSelectedModel && openAiCodexFastStatus.state === "confirmed"
						? { key: "confirmed", severity: "green" }
						: { key: "active", severity: "green" }

	return (
		<div className="flex flex-col gap-4">
			{/* Authentication Section */}
			<div className="flex flex-col gap-2">
				{openAiCodexIsAuthenticated ? (
					<div className="flex justify-end">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => vscode.postMessage({ type: "openAiCodexSignOut" })}>
							{t("settings:providers.openAiCodex.signOutButton", {
								defaultValue: "Sign Out",
							})}
						</Button>
					</div>
				) : (
					<Button
						variant="primary"
						onClick={() => vscode.postMessage({ type: "openAiCodexSignIn" })}
						className="w-fit">
						{t("settings:providers.openAiCodex.signInButton", {
							defaultValue: "Sign in to OpenAI Codex",
						})}
					</Button>
				)}
			</div>

			{/* Rate Limit Dashboard - only shown when authenticated */}
			<OpenAICodexRateLimitDashboard isAuthenticated={openAiCodexIsAuthenticated} />

			<div className="flex flex-col gap-1">
				<VSCodeCheckbox
					checked={fastModeEnabled}
					onChange={(event: any) => {
						setApiConfigurationField("openAiCodexFastMode", event.target.checked)
					}}>
					<span className="font-medium">{t("settings:providers.openAiCodexFastMode.label")}</span>
				</VSCodeCheckbox>
				<p className="m-0 text-sm text-vscode-descriptionForeground">
					{t("settings:providers.openAiCodexFastMode.description")}
				</p>
				<div className="flex items-start gap-2" data-testid="openai-codex-fast-mode-status-row">
					<span
						className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${fastModeIndicatorClassNames[fastModeStatus.severity]}`}
						data-severity={fastModeStatus.severity}
						data-testid="openai-codex-fast-mode-indicator"
						aria-hidden="true"
					/>
					<p
						className="m-0 text-sm text-vscode-descriptionForeground"
						data-testid="openai-codex-fast-mode-status">
						{t(`settings:providers.openAiCodexFastMode.status.${fastModeStatus.key}`, {
							modelId: selectedModelId,
							observedServiceTier: openAiCodexFastStatus?.observedServiceTier ?? "unknown",
						})}
					</p>
				</div>
			</div>

			{/* Model Picker */}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={openAiCodexDefaultModelId}
				models={openAiCodexModels}
				modelIdKey="apiModelId"
				serviceName="OpenAI - ChatGPT Plus/Pro"
				serviceUrl="https://chatgpt.com"
				simplifySettings={simplifySettings}
				hidePricing
			/>
		</div>
	)
}

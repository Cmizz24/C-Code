import { useCallback, useMemo, useState } from "react"
import { Trans } from "react-i18next"
import { ArrowLeft, Brain } from "lucide-react"

import { openRouterDefaultModelId, type ProviderName, type ProviderSettings } from "@roo-code/types"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { validateApiConfiguration } from "@src/utils/validate"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, SearchableSelect } from "@src/components/ui"

import ApiOptions from "../settings/ApiOptions"
import { getAvailableProviderOptions, getProviderDefaultModelConfig } from "../settings/utils/providerOptions"
import { Tab, TabContent } from "../common/Tab"

import LocalAiSetupView from "./LocalAiSetupView"
import RooHero from "./RooHero"

const DEFAULT_WELCOME_API_CONFIGURATION: ProviderSettings = {
	apiProvider: "openrouter",
	openRouterModelId: openRouterDefaultModelId,
}

const getWelcomeApiConfiguration = (apiConfiguration?: ProviderSettings): ProviderSettings => {
	if (!apiConfiguration?.apiProvider) {
		return DEFAULT_WELCOME_API_CONFIGURATION
	}

	if (apiConfiguration.apiProvider === "anthropic" && !apiConfiguration.apiKey) {
		return DEFAULT_WELCOME_API_CONFIGURATION
	}

	return apiConfiguration
}

const getWelcomeApiConfigurationForProvider = (
	provider: ProviderName,
	apiConfiguration?: ProviderSettings,
): ProviderSettings => {
	const nextConfiguration: ProviderSettings = {
		...getWelcomeApiConfiguration(apiConfiguration),
		apiProvider: provider,
	}
	const defaultModelConfig = getProviderDefaultModelConfig(provider, nextConfiguration)
	const isExistingProvider = apiConfiguration?.apiProvider === provider

	if (defaultModelConfig?.default && (!nextConfiguration[defaultModelConfig.field] || !isExistingProvider)) {
		return {
			...nextConfiguration,
			[defaultModelConfig.field]: defaultModelConfig.default,
		}
	}

	return nextConfiguration
}

const WelcomeViewProvider = () => {
	const { apiConfiguration, currentApiConfigName, organizationAllowList, setApiConfiguration, uriScheme } =
		useExtensionState()
	const { t } = useAppTranslation()
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
	const [welcomeStep, setWelcomeStep] = useState<"landing" | "provider" | "local">("landing")
	const [welcomeApiConfiguration, setWelcomeApiConfiguration] = useState<ProviderSettings>()
	const effectiveApiConfiguration = welcomeApiConfiguration ?? getWelcomeApiConfiguration(apiConfiguration)
	const providerOptions = useMemo(
		() =>
			getAvailableProviderOptions({
				organizationAllowList,
				selectedProvider: effectiveApiConfiguration.apiProvider,
				prioritizeOpenRouter: true,
			}),
		[organizationAllowList, effectiveApiConfiguration.apiProvider],
	)

	const setApiConfigurationFieldForApiOptions = useCallback(
		<K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => {
			setWelcomeApiConfiguration((current) => ({
				...(current ?? effectiveApiConfiguration),
				[field]: value,
			}))
			setApiConfiguration({ [field]: value })
		},
		[effectiveApiConfiguration, setApiConfiguration],
	)

	const enterProviderSetup = useCallback(
		(provider?: ProviderName) => {
			const initialApiConfiguration = provider
				? getWelcomeApiConfigurationForProvider(provider, apiConfiguration)
				: getWelcomeApiConfiguration(apiConfiguration)

			setWelcomeApiConfiguration(initialApiConfiguration)
			setApiConfiguration(initialApiConfiguration)
			setWelcomeStep("provider")
		},
		[apiConfiguration, setApiConfiguration],
	)

	const handleGetStarted = useCallback(() => {
		if (welcomeStep !== "provider") {
			enterProviderSetup()
			return
		}

		const error = validateApiConfiguration(effectiveApiConfiguration)

		if (error) {
			setErrorMessage(error)
			return
		}

		setErrorMessage(undefined)
		vscode.postMessage({
			type: "upsertApiConfiguration",
			text: currentApiConfigName,
			apiConfiguration: effectiveApiConfiguration,
		})
	}, [welcomeStep, enterProviderSetup, effectiveApiConfiguration, currentApiConfigName])

	if (welcomeStep === "landing") {
		return (
			<Tab>
				<TabContent className="relative flex flex-col gap-4 p-6 justify-center">
					<RooHero />
					<h2 className="mt-0 mb-0 text-xl">{t("welcome:landing.greeting")}</h2>

					<div className="space-y-4 leading-normal">
						<p className="text-base text-vscode-foreground">
							<Trans i18nKey="welcome:landing.introduction" />
						</p>
					</div>

					<div className="mt-2 grid gap-3 md:grid-cols-2">
						<button
							data-testid="local-ai-option-card"
							onClick={() => setWelcomeStep("local")}
							className="cursor-pointer rounded-md border border-vscode-foreground/20 bg-transparent p-4 text-left text-vscode-foreground hover:bg-vscode-foreground/5">
							<div className="font-medium">{t("welcome:landing.localAi.title")}</div>
							<div className="mt-1 text-sm">{t("welcome:landing.localAi.description")}</div>
						</button>
						<div
							data-testid="api-provider-option-card"
							className="rounded-md border border-vscode-foreground/20 bg-transparent p-4 text-left text-vscode-foreground">
							<div className="font-medium">{t("welcome:landing.provider.title")}</div>
							<div className="mt-1 text-sm">{t("welcome:landing.provider.description")}</div>
							<div className="mt-3">
								<SearchableSelect
									onValueChange={(value) => enterProviderSetup(value as ProviderName)}
									options={providerOptions}
									placeholder={t("settings:common.select")}
									searchPlaceholder={t("settings:providers.searchProviderPlaceholder")}
									emptyMessage={t("settings:providers.noProviderMatchFound")}
									className="w-full"
									data-testid="welcome-provider-select"
								/>
							</div>
						</div>
					</div>

					<div className="absolute bottom-6 left-6">
						<button
							onClick={() => vscode.postMessage({ type: "importSettings" })}
							className="cursor-pointer bg-transparent border-none p-0 text-vscode-foreground hover:underline">
							{t("welcome:importSettings")}
						</button>
					</div>
				</TabContent>
			</Tab>
		)
	}

	if (welcomeStep === "local") {
		return (
			<Tab>
				<TabContent className="flex flex-col gap-4 p-6 justify-center">
					<LocalAiSetupView onBack={() => setWelcomeStep("landing")} />
				</TabContent>
			</Tab>
		)
	}

	return (
		<Tab>
			<TabContent className="flex flex-col gap-4 p-6 justify-center">
				<Brain className="size-8" strokeWidth={1.5} />
				<h2 className="mt-0 mb-0 text-xl">{t("welcome:providerSignup.heading")}</h2>

				<p className="text-base text-vscode-foreground">
					<Trans i18nKey="welcome:providerSignup.chooseProvider" />
				</p>

				<div className="mb-8">
					<ApiOptions
						fromWelcomeView
						apiConfiguration={effectiveApiConfiguration}
						uriScheme={uriScheme}
						setApiConfigurationField={setApiConfigurationFieldForApiOptions}
						errorMessage={errorMessage}
						setErrorMessage={setErrorMessage}
					/>
				</div>

				<div className="-mt-4 flex gap-2">
					<Button onClick={() => setWelcomeStep("landing")} variant="secondary">
						<ArrowLeft className="size-4" />
						{t("welcome:providerSignup.goBack")}
					</Button>
					<Button onClick={handleGetStarted} variant="primary">
						{t("welcome:providerSignup.finish")} →
					</Button>
				</div>
			</TabContent>
		</Tab>
	)
}

export default WelcomeViewProvider

import { type FormEvent, useCallback } from "react"
import { VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { cn } from "@src/lib/utils"

type XiaomiMiMoProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
}

export const XiaomiMiMo = ({ apiConfiguration, setApiConfigurationField }: XiaomiMiMoProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings>(field: K) =>
			(event: Event | FormEvent<HTMLElement>) => {
				setApiConfigurationField(field, (event.target as HTMLInputElement)?.value as ProviderSettings[K])
			},
		[setApiConfigurationField],
	)

	return (
		<>
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.xiaomiMiMoBaseUrl")}</label>
				<VSCodeDropdown
					value={apiConfiguration.xiaomiMiMoBaseUrl || "https://api.xiaomimimo.com/v1"}
					onChange={handleInputChange("xiaomiMiMoBaseUrl")}
					className={cn("w-full")}>
					<VSCodeOption value="https://api.xiaomimimo.com/v1" className="p-2">
						api.xiaomimimo.com
					</VSCodeOption>
					<VSCodeOption value="https://token-plan-ams.xiaomimimo.com/v1" className="p-2">
						token-plan-ams.xiaomimimo.com
					</VSCodeOption>
				</VSCodeDropdown>
			</div>

			<div>
				<VSCodeTextField
					value={apiConfiguration?.xiaomiMiMoApiKey || ""}
					type="password"
					onInput={handleInputChange("xiaomiMiMoApiKey")}
					placeholder={t("settings:placeholders.apiKey")}
					className="w-full">
					<label className="block font-medium mb-1">{t("settings:providers.xiaomiMiMoApiKey")}</label>
				</VSCodeTextField>
				{!apiConfiguration?.xiaomiMiMoApiKey && (
					<VSCodeButtonLink href="https://platform.xiaomimimo.com" appearance="secondary">
						{t("settings:providers.getXiaomiMiMoApiKey")}
					</VSCodeButtonLink>
				)}
			</div>
		</>
	)
}

import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { Input, Slider, Textarea } from "../ui"

const parseRecipients = (value: string) =>
	value
		.split(/[\n,]/)
		.map((recipient) => recipient.trim())
		.filter(Boolean)

type NotificationSettingsProps = HTMLAttributes<HTMLDivElement> & {
	ttsEnabled?: boolean
	ttsSpeed?: number
	soundEnabled?: boolean
	soundVolume?: number
	emailNotificationsEnabled?: boolean
	emailNotifyOnSuccess?: boolean
	emailNotifyOnFailure?: boolean
	smtpHost?: string
	smtpPort?: number
	smtpSecure?: boolean
	smtpRequireTls?: boolean
	smtpUsername?: string
	smtpPassword?: string
	smtpPasswordConfigured?: boolean
	smtpFromAddress?: string
	smtpRecipients?: string[]
	smtpRecipientsText?: string
	smtpSubjectTemplate?: string
	setCachedStateField: SetCachedStateField<
		| "ttsEnabled"
		| "ttsSpeed"
		| "soundEnabled"
		| "soundVolume"
		| "emailNotificationsEnabled"
		| "emailNotifyOnSuccess"
		| "emailNotifyOnFailure"
		| "smtpHost"
		| "smtpPort"
		| "smtpSecure"
		| "smtpRequireTls"
		| "smtpUsername"
		| "smtpPassword"
		| "smtpFromAddress"
		| "smtpRecipients"
		| "smtpRecipientsText"
		| "smtpSubjectTemplate"
	>
}

export const NotificationSettings = ({
	ttsEnabled,
	ttsSpeed,
	soundEnabled,
	soundVolume,
	emailNotificationsEnabled,
	emailNotifyOnSuccess,
	emailNotifyOnFailure,
	smtpHost,
	smtpPort,
	smtpSecure,
	smtpRequireTls,
	smtpUsername,
	smtpPassword,
	smtpPasswordConfigured,
	smtpFromAddress,
	smtpRecipients,
	smtpRecipientsText,
	smtpSubjectTemplate,
	setCachedStateField,
	...props
}: NotificationSettingsProps) => {
	const { t } = useAppTranslation()
	const recipientsText = smtpRecipientsText ?? (smtpRecipients ?? []).join("\n")

	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.notifications")}</SectionHeader>

			<Section>
				<SearchableSetting
					settingId="notifications-email"
					section="notifications"
					label={t("settings:notifications.email.label")}>
					<VSCodeCheckbox
						checked={emailNotificationsEnabled ?? false}
						onChange={(e: any) => setCachedStateField("emailNotificationsEnabled", e.target.checked)}
						data-testid="email-notifications-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.email.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.email.description")}
					</div>
				</SearchableSetting>

				{emailNotificationsEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<SearchableSetting
							settingId="notifications-email-success"
							section="notifications"
							label={t("settings:notifications.email.notifyOnSuccess.label")}>
							<VSCodeCheckbox
								checked={emailNotifyOnSuccess ?? true}
								onChange={(e: any) => setCachedStateField("emailNotifyOnSuccess", e.target.checked)}
								data-testid="email-notify-success-checkbox">
								<span className="font-medium">
									{t("settings:notifications.email.notifyOnSuccess.label")}
								</span>
							</VSCodeCheckbox>
						</SearchableSetting>

						<SearchableSetting
							settingId="notifications-email-failure"
							section="notifications"
							label={t("settings:notifications.email.notifyOnFailure.label")}>
							<VSCodeCheckbox
								checked={emailNotifyOnFailure ?? false}
								onChange={(e: any) => setCachedStateField("emailNotifyOnFailure", e.target.checked)}
								data-testid="email-notify-failure-checkbox">
								<span className="font-medium">
									{t("settings:notifications.email.notifyOnFailure.label")}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:notifications.email.notifyOnFailure.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="notifications-email-host"
							section="notifications"
							label={t("settings:notifications.email.smtpHost.label")}>
							<label className="block font-medium mb-1" htmlFor="smtp-host-input">
								{t("settings:notifications.email.smtpHost.label")}
							</label>
							<Input
								id="smtp-host-input"
								value={smtpHost ?? ""}
								onChange={(event) => setCachedStateField("smtpHost", event.target.value)}
								placeholder={t("settings:notifications.email.smtpHost.placeholder")}
								data-testid="smtp-host-input"
							/>
						</SearchableSetting>

						<SearchableSetting
							settingId="notifications-email-port"
							section="notifications"
							label={t("settings:notifications.email.smtpPort.label")}>
							<label className="block font-medium mb-1" htmlFor="smtp-port-input">
								{t("settings:notifications.email.smtpPort.label")}
							</label>
							<Input
								id="smtp-port-input"
								type="number"
								min={1}
								max={65535}
								value={smtpPort ?? 587}
								onChange={(event) => {
									const value = Number(event.target.value)

									setCachedStateField("smtpPort", Number.isFinite(value) ? value : 587)
								}}
								data-testid="smtp-port-input"
							/>
						</SearchableSetting>

						<SearchableSetting
							settingId="notifications-email-secure"
							section="notifications"
							label={t("settings:notifications.email.smtpSecure.label")}>
							<VSCodeCheckbox
								checked={smtpSecure ?? false}
								onChange={(e: any) => setCachedStateField("smtpSecure", e.target.checked)}
								data-testid="smtp-secure-checkbox">
								<span className="font-medium">
									{t("settings:notifications.email.smtpSecure.label")}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:notifications.email.smtpSecure.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="notifications-email-require-tls"
							section="notifications"
							label={t("settings:notifications.email.smtpRequireTls.label")}>
							<VSCodeCheckbox
								checked={smtpRequireTls ?? false}
								onChange={(e: any) => setCachedStateField("smtpRequireTls", e.target.checked)}
								data-testid="smtp-require-tls-checkbox">
								<span className="font-medium">
									{t("settings:notifications.email.smtpRequireTls.label")}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:notifications.email.smtpRequireTls.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="notifications-email-username"
							section="notifications"
							label={t("settings:notifications.email.smtpUsername.label")}>
							<label className="block font-medium mb-1" htmlFor="smtp-username-input">
								{t("settings:notifications.email.smtpUsername.label")}
							</label>
							<Input
								id="smtp-username-input"
								value={smtpUsername ?? ""}
								onChange={(event) => setCachedStateField("smtpUsername", event.target.value)}
								placeholder={t("settings:notifications.email.smtpUsername.placeholder")}
								data-testid="smtp-username-input"
							/>
						</SearchableSetting>

						<SearchableSetting
							settingId="notifications-email-password"
							section="notifications"
							label={t("settings:notifications.email.smtpPassword.label")}>
							<label className="block font-medium mb-1" htmlFor="smtp-password-input">
								{t("settings:notifications.email.smtpPassword.label")}
							</label>
							<Input
								id="smtp-password-input"
								type="password"
								value={smtpPassword ?? ""}
								onChange={(event) => setCachedStateField("smtpPassword", event.target.value)}
								placeholder={
									smtpPasswordConfigured
										? t("settings:notifications.email.smtpPassword.configuredPlaceholder")
										: t("settings:notifications.email.smtpPassword.placeholder")
								}
								data-testid="smtp-password-input"
							/>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{smtpPasswordConfigured
									? t("settings:notifications.email.smtpPassword.configuredDescription")
									: t("settings:notifications.email.smtpPassword.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="notifications-email-from"
							section="notifications"
							label={t("settings:notifications.email.smtpFromAddress.label")}>
							<label className="block font-medium mb-1" htmlFor="smtp-from-input">
								{t("settings:notifications.email.smtpFromAddress.label")}
							</label>
							<Input
								id="smtp-from-input"
								value={smtpFromAddress ?? ""}
								onChange={(event) => setCachedStateField("smtpFromAddress", event.target.value)}
								placeholder={t("settings:notifications.email.smtpFromAddress.placeholder")}
								data-testid="smtp-from-input"
							/>
						</SearchableSetting>

						<SearchableSetting
							settingId="notifications-email-recipients"
							section="notifications"
							label={t("settings:notifications.email.smtpRecipients.label")}>
							<label className="block font-medium mb-1" htmlFor="smtp-recipients-input">
								{t("settings:notifications.email.smtpRecipients.label")}
							</label>
							<Textarea
								id="smtp-recipients-input"
								value={recipientsText}
								onChange={(event) => {
									setCachedStateField("smtpRecipientsText", event.target.value)
									setCachedStateField("smtpRecipients", parseRecipients(event.target.value))
								}}
								placeholder={t("settings:notifications.email.smtpRecipients.placeholder")}
								data-testid="smtp-recipients-input"
							/>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:notifications.email.smtpRecipients.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="notifications-email-subject"
							section="notifications"
							label={t("settings:notifications.email.smtpSubjectTemplate.label")}>
							<label className="block font-medium mb-1" htmlFor="smtp-subject-input">
								{t("settings:notifications.email.smtpSubjectTemplate.label")}
							</label>
							<Input
								id="smtp-subject-input"
								value={smtpSubjectTemplate ?? ""}
								onChange={(event) => setCachedStateField("smtpSubjectTemplate", event.target.value)}
								placeholder={t("settings:notifications.email.smtpSubjectTemplate.placeholder")}
								data-testid="smtp-subject-input"
							/>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:notifications.email.smtpSubjectTemplate.description")}
							</div>
						</SearchableSetting>
					</div>
				)}

				<SearchableSetting
					settingId="notifications-tts"
					section="notifications"
					label={t("settings:notifications.tts.label")}>
					<VSCodeCheckbox
						checked={ttsEnabled}
						onChange={(e: any) => setCachedStateField("ttsEnabled", e.target.checked)}
						data-testid="tts-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.tts.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.tts.description")}
					</div>
				</SearchableSetting>

				{ttsEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<SearchableSetting
							settingId="notifications-tts-speed"
							section="notifications"
							label={t("settings:notifications.tts.speedLabel")}>
							<label className="block font-medium mb-1">
								{t("settings:notifications.tts.speedLabel")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0.1}
									max={2.0}
									step={0.01}
									value={[ttsSpeed ?? 1.0]}
									onValueChange={([value]) => setCachedStateField("ttsSpeed", value)}
									data-testid="tts-speed-slider"
								/>
								<span className="w-10">{((ttsSpeed ?? 1.0) * 100).toFixed(0)}%</span>
							</div>
						</SearchableSetting>
					</div>
				)}

				<SearchableSetting
					settingId="notifications-sound"
					section="notifications"
					label={t("settings:notifications.sound.label")}>
					<VSCodeCheckbox
						checked={soundEnabled}
						onChange={(e: any) => setCachedStateField("soundEnabled", e.target.checked)}
						data-testid="sound-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.sound.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.sound.description")}
					</div>
				</SearchableSetting>

				{soundEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<SearchableSetting
							settingId="notifications-sound-volume"
							section="notifications"
							label={t("settings:notifications.sound.volumeLabel")}>
							<label className="block font-medium mb-1">
								{t("settings:notifications.sound.volumeLabel")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0}
									max={1}
									step={0.01}
									value={[soundVolume ?? 0.5]}
									onValueChange={([value]) => setCachedStateField("soundVolume", value)}
									data-testid="sound-volume-slider"
								/>
								<span className="w-10">{((soundVolume ?? 0.5) * 100).toFixed(0)}%</span>
							</div>
						</SearchableSetting>
					</div>
				)}
			</Section>
		</div>
	)
}

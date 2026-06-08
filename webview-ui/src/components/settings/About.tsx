import { HTMLAttributes } from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Download, Upload, TriangleAlert, Bug, Shield } from "lucide-react"
import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { Package } from "@roo/package"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { Button, Input } from "@/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

type AboutProps = HTMLAttributes<HTMLDivElement> & {
	debug?: boolean
	setDebug?: (debug: boolean) => void
	remoteDebugLoggingEnabled?: boolean
	remoteDebugLoggingEndpoint?: string
	remoteDebugLoggingAuthToken?: string
	remoteDebugLoggingAuthTokenConfigured?: boolean
	setRemoteDebugLoggingEnabled?: (enabled: boolean) => void
	setRemoteDebugLoggingEndpoint?: (endpoint: string) => void
	setRemoteDebugLoggingAuthToken?: (token: string) => void
}

export const About = ({
	debug,
	setDebug,
	remoteDebugLoggingEnabled,
	remoteDebugLoggingEndpoint,
	remoteDebugLoggingAuthToken,
	remoteDebugLoggingAuthTokenConfigured,
	setRemoteDebugLoggingEnabled,
	setRemoteDebugLoggingEndpoint,
	setRemoteDebugLoggingAuthToken,
	className,
	...props
}: AboutProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.about")}</SectionHeader>

			<Section>
				<p>
					{Package.sha
						? `Version: ${Package.version} (${Package.sha.slice(0, 8)})`
						: `Version: ${Package.version}`}
				</p>
			</Section>

			<Section className="space-y-0">
				<h3>{t("settings:about.contact")}</h3>
				<div className="flex flex-col gap-3">
					<div className="flex items-start gap-2">
						<Bug className="size-4 text-vscode-descriptionForeground shrink-0" />
						<span>
							{t("settings:about.bugReport.label")}{" "}
							<VSCodeLink href="https://github.com/Cmizz24/C-Code/issues/new">
								{t("settings:about.bugReport.link")}
							</VSCodeLink>
						</span>
					</div>
					<div className="flex items-start gap-2">
						<Shield className="size-4 text-vscode-descriptionForeground shrink-0" />
						<span>
							{t("settings:about.securityIssue.label")}{" "}
							<VSCodeLink href="https://github.com/Cmizz24/C-Code/security/policy">
								{t("settings:about.securityIssue.link")}
							</VSCodeLink>
						</span>
					</div>
					{setDebug && (
						<SearchableSetting
							settingId="about-debug-mode"
							section="about"
							label={t("settings:about.debugMode.label")}
							className="mt-4 pt-4 border-t border-vscode-settings-headerBorder">
							<VSCodeCheckbox
								checked={debug ?? false}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									setDebug(checked)
								}}>
								{t("settings:about.debugMode.label")}
							</VSCodeCheckbox>
							<p className="text-vscode-descriptionForeground text-sm mt-0">
								{t("settings:about.debugMode.description")}
							</p>
						</SearchableSetting>
					)}
					{setRemoteDebugLoggingEnabled &&
						setRemoteDebugLoggingEndpoint &&
						setRemoteDebugLoggingAuthToken && (
							<SearchableSetting
								settingId="about-remote-debug-logging"
								section="about"
								label={t("settings:about.remoteDebugLogging.label")}
								className="mt-4 pt-4 border-t border-vscode-settings-headerBorder">
								<VSCodeCheckbox
									checked={remoteDebugLoggingEnabled ?? false}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										setRemoteDebugLoggingEnabled(checked)
									}}>
									{t("settings:about.remoteDebugLogging.label")}
								</VSCodeCheckbox>

								<div className="flex flex-col gap-2 mt-2">
									<p className="text-vscode-descriptionForeground text-sm mt-0 mb-0">
										{t("settings:about.remoteDebugLogging.description")}
									</p>
									<p className="text-vscode-descriptionForeground text-sm mt-0 mb-0">
										{t("settings:about.remoteDebugLogging.privacy")}
									</p>
								</div>

								<div className="flex flex-col gap-3 mt-3 pl-3 border-l-2 border-vscode-button-background">
									<label className="flex flex-col gap-1" htmlFor="remote-debug-endpoint-input">
										<span className="text-vscode-foreground text-sm font-medium">
											{t("settings:about.remoteDebugLogging.endpoint.label")}
										</span>
										<Input
											id="remote-debug-endpoint-input"
											type="url"
											value={remoteDebugLoggingEndpoint ?? ""}
											onChange={(event) => setRemoteDebugLoggingEndpoint(event.target.value)}
											placeholder={t("settings:about.remoteDebugLogging.endpoint.placeholder")}
											data-testid="remote-debug-endpoint-input"
										/>
									</label>

									<label className="flex flex-col gap-1" htmlFor="remote-debug-auth-token-input">
										<span className="text-vscode-foreground text-sm font-medium">
											{t("settings:about.remoteDebugLogging.authToken.label")}
										</span>
										<Input
											id="remote-debug-auth-token-input"
											type="password"
											value={remoteDebugLoggingAuthToken ?? ""}
											onChange={(event) => setRemoteDebugLoggingAuthToken(event.target.value)}
											placeholder={
												remoteDebugLoggingAuthTokenConfigured
													? t(
															"settings:about.remoteDebugLogging.authToken.configuredPlaceholder",
														)
													: t("settings:about.remoteDebugLogging.authToken.placeholder")
											}
											data-testid="remote-debug-auth-token-input"
										/>
									</label>
								</div>
							</SearchableSetting>
						)}
				</div>
			</Section>

			<Section className="space-y-0">
				<SearchableSetting
					settingId="about-manage-settings"
					section="about"
					label={t("settings:about.manageSettings")}>
					<h3>{t("settings:about.manageSettings")}</h3>
					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={() => vscode.postMessage({ type: "exportSettings" })} className="w-28">
							<Upload className="p-0.5" />
							{t("settings:footer.settings.export")}
						</Button>
						<Button onClick={() => vscode.postMessage({ type: "importSettings" })} className="w-28">
							<Download className="p-0.5" />
							{t("settings:footer.settings.import")}
						</Button>
						<Button
							variant="destructive"
							onClick={() => vscode.postMessage({ type: "resetState" })}
							className="w-28">
							<TriangleAlert className="p-0.5" />
							{t("settings:footer.settings.reset")}
						</Button>
					</div>
				</SearchableSetting>
			</Section>
		</div>
	)
}

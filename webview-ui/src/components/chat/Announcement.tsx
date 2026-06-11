import { memo, type ReactNode, useState } from "react"
import { Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { Package } from "@roo/package"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@src/components/ui"

interface AnnouncementProps {
	hideAnnouncement: () => void
}

/**
 * You must update the `latestAnnouncementId` in ClineProvider for new
 * announcements to show to users. This new id will be compared with what's in
 * state for the 'last announcement shown', and if it's different then the
 * announcement will render. As soon as an announcement is shown, the id will be
 * updated in state. This ensures that announcements are not shown more than
 * once, even if the user doesn't close it themselves.
 */

const Announcement = ({ hideAnnouncement }: AnnouncementProps) => {
	const { t } = useAppTranslation()
	const [open, setOpen] = useState(true)

	return (
		<Dialog
			open={open}
			onOpenChange={(open) => {
				setOpen(open)

				if (!open) {
					hideAnnouncement()
				}
			}}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("chat:announcement.finalRelease.title", { version: Package.version })}</DialogTitle>
				</DialogHeader>
				<div className="text-sm leading-relaxed text-vscode-descriptionForeground">
					<p className="mt-0">
						<Trans
							i18nKey="chat:announcement.finalRelease.intro"
							values={{ version: Package.version }}
							components={{
								repoLink: <ExternalLink href="https://github.com/Cmizz24/C-Code" />,
							}}
						/>
					</p>
					<p>{t("chat:announcement.finalRelease.summary")}</p>
					<p className="font-medium text-vscode-foreground">
						{t("chat:announcement.finalRelease.highlightsHeading")}
					</p>
					<ul className="mb-3 list-disc space-y-1 pl-5">
						<li>{t("chat:announcement.finalRelease.memory")}</li>
						<li>{t("chat:announcement.finalRelease.localAiSetup")}</li>
						<li>{t("chat:announcement.finalRelease.imageGeneration")}</li>
						<li>{t("chat:announcement.finalRelease.visualInspector")}</li>
						<li>{t("chat:announcement.finalRelease.promptEnhancement")}</li>
						<li>{t("chat:announcement.finalRelease.orchestration")}</li>
						<li>{t("chat:announcement.finalRelease.providerTooling")}</li>
						<li>{t("chat:announcement.finalRelease.diagnosticsHelp")}</li>
					</ul>
					<p>
						<Trans
							i18nKey="chat:announcement.finalRelease.alternatives"
							components={{
								repoLink: <ExternalLink href="https://github.com/Cmizz24/C-Code" />,
							}}
						/>
					</p>
					<p className="mb-0">{t("chat:announcement.finalRelease.signoff")}</p>
				</div>
			</DialogContent>
		</Dialog>
	)
}

const ExternalLink = ({ children, href }: { children?: ReactNode; href: string }) => (
	<VSCodeLink
		href={href}
		onClick={(e) => {
			e.preventDefault()
			vscode.postMessage({ type: "openExternal", url: href })
		}}>
		{children}
	</VSCodeLink>
)

export default memo(Announcement)

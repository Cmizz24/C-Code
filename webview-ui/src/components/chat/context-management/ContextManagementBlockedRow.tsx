import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import type { ContextManagementBlocked } from "@roo-code/types"

interface ContextManagementBlockedRowProps {
	data?: ContextManagementBlocked
	fallbackReason?: string
}

export function ContextManagementBlockedRow({ data, fallbackReason }: ContextManagementBlockedRowProps) {
	const { t } = useTranslation()
	const retryTime = useMemo(() => {
		if (!data?.retryAt) {
			return undefined
		}

		return new Date(data.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
	}, [data?.retryAt])

	const reason = data?.reason ?? fallbackReason

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-2">
				<span className="codicon codicon-clock text-vscode-editorWarning-foreground opacity-80 text-base -mb-0.5" />
				<span className="font-bold text-vscode-foreground">{t("chat:contextManagement.blocked.title")}</span>
			</div>
			<span className="text-vscode-descriptionForeground text-sm">
				{retryTime
					? t("chat:contextManagement.blocked.descriptionWithRetry", { retryTime })
					: t("chat:contextManagement.blocked.description")}
			</span>
			{reason && <span className="text-vscode-descriptionForeground text-sm">{reason}</span>}
		</div>
	)
}

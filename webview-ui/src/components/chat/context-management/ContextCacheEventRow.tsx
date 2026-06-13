import { useState } from "react"
import { useTranslation } from "react-i18next"
import { FoldVertical } from "lucide-react"

import type { ContextCacheEvent } from "@roo-code/types"

interface ContextCacheEventRowProps {
	event: ContextCacheEvent
}

const formatContextCacheNumber = (value: number | undefined) => (value ?? 0).toLocaleString()

const formatContextCacheRamValue = (valueMb: number | undefined) => {
	const safeValueMb = Number.isFinite(valueMb) && (valueMb ?? 0) > 0 ? (valueMb ?? 0) : 0

	if (safeValueMb >= 1024 && safeValueMb % 1024 === 0) {
		return `${safeValueMb / 1024}GB`
	}

	const formatted = Number.isInteger(safeValueMb) ? safeValueMb.toString() : safeValueMb.toFixed(1)
	return `${formatted}MB`
}

export function ContextCacheEventRow({ event }: ContextCacheEventRowProps) {
	const { t } = useTranslation()
	const [isExpanded, setIsExpanded] = useState(false)
	const chunkCount = event.chunkCount ?? 0
	const tokenCount = event.tokenCount ?? 0
	const summaryParts = [
		chunkCount > 0 ? t("chat:contextManagement.contextCache.summary.chunks", { count: chunkCount }) : undefined,
		tokenCount > 0 ? `${formatContextCacheNumber(tokenCount)} ${t("chat:contextManagement.tokens")}` : undefined,
	]
		.filter(Boolean)
		.join(" · ")
	const titleKey = `chat:contextManagement.contextCache.titles.${event.type}`
	const descriptionKey = `chat:contextManagement.contextCache.descriptions.${event.type}`

	const details = [
		chunkCount > 0
			? [t("chat:contextManagement.contextCache.details.chunks"), formatContextCacheNumber(chunkCount)]
			: undefined,
		tokenCount > 0
			? [t("chat:contextManagement.contextCache.details.tokens"), formatContextCacheNumber(tokenCount)]
			: undefined,
		event.ramBudgetMb !== undefined
			? [
					t("chat:contextManagement.contextCache.details.ram"),
					`${formatContextCacheRamValue(event.ramUsedMb)} / ${formatContextCacheRamValue(event.ramBudgetMb)}`,
				]
			: undefined,
		event.query ? [t("chat:contextManagement.contextCache.details.query"), event.query] : undefined,
		event.filePath ? [t("chat:contextManagement.contextCache.details.file"), event.filePath] : undefined,
		event.warning ? [t("chat:contextManagement.contextCache.details.warning"), event.warning] : undefined,
	].filter((detail): detail is [string, string] => Array.isArray(detail))

	return (
		<div className="mb-2" data-testid="context-cache-event-row">
			<div
				className="flex items-center justify-between cursor-pointer select-none"
				onClick={() => setIsExpanded(!isExpanded)}>
				<div className="flex items-center gap-2 flex-grow">
					<FoldVertical size={16} className="text-vscode-foreground" />
					<span className="font-bold text-vscode-foreground">{t(titleKey)}</span>
					{summaryParts && <span className="text-vscode-descriptionForeground text-sm">{summaryParts}</span>}
				</div>
				<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
			</div>

			{isExpanded && (
				<div className="mt-2 ml-0 p-4 bg-vscode-editor-background rounded text-vscode-foreground text-sm">
					<div className="flex flex-col gap-2">
						<p className="text-vscode-descriptionForeground text-xs m-0">{t(descriptionKey)}</p>
						{details.length > 0 && (
							<dl className="grid gap-1 text-xs text-vscode-descriptionForeground sm:grid-cols-2">
								{details.map(([label, value]) => (
									<div key={label}>
										<dt className="font-medium text-vscode-foreground">{label}</dt>
										<dd className="m-0 break-all">{value}</dd>
									</div>
								))}
							</dl>
						)}
					</div>
				</div>
			)}
		</div>
	)
}

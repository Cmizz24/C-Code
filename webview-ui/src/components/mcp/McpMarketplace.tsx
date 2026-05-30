import React, { useMemo, useState } from "react"

import type { McpServer } from "@roo-code/types"
import { marketplaceMcpCatalog, type MarketplaceMcpCatalogItem, type MarketplaceMcpScope } from "@roo/mcpMarketplace"

import { Button } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

type McpMarketplaceProps = {
	servers: McpServer[]
}

const formatList = (items: string[], fallback: string) => {
	return items.length > 0 ? items.join(", ") : fallback
}

const MetadataRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
	<div className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-2 text-xs">
		<span className="font-medium text-vscode-descriptionForeground">{label}</span>
		<span className="text-vscode-foreground">{children}</span>
	</div>
)

const McpMarketplace = ({ servers }: McpMarketplaceProps) => {
	const { t } = useAppTranslation()
	const [scopeByItemId, setScopeByItemId] = useState<Record<string, MarketplaceMcpScope>>({})

	const installedServerNames = useMemo(() => new Set(servers.map((server) => server.name)), [servers])

	const handleInstall = (item: MarketplaceMcpCatalogItem, targetScope: MarketplaceMcpScope) => {
		vscode.postMessage({
			type: "installMarketplaceMcp",
			marketplaceMcpId: item.id,
			marketplaceMcpScope: targetScope,
		})
	}

	return (
		<section className="mt-4 rounded-md border border-vscode-panel-border bg-vscode-editor-background p-3">
			<div className="mb-3 flex flex-col gap-1">
				<div className="flex items-center gap-2">
					<span className="codicon codicon-extensions text-vscode-descriptionForeground" />
					<h3 className="m-0 text-sm font-semibold text-vscode-foreground">{t("mcp:marketplace.title")}</h3>
				</div>
				<p className="m-0 text-xs text-vscode-descriptionForeground">{t("mcp:marketplace.description")}</p>
			</div>

			<div className="mb-2 text-xs font-semibold uppercase tracking-wide text-vscode-descriptionForeground">
				{t("mcp:marketplace.featuredCatalog")}
			</div>

			<div className="grid grid-cols-1 gap-3">
				{marketplaceMcpCatalog.map((item) => {
					const selectedScope = scopeByItemId[item.id] ?? item.recommendedScope
					const isInstalled = installedServerNames.has(item.serverName)

					return (
						<article
							key={item.id}
							className="rounded-md border border-vscode-widget-border bg-vscode-textCodeBlock-background p-3">
							<div className="mb-2 flex items-start justify-between gap-2">
								<div>
									<h4 className="m-0 text-sm font-semibold text-vscode-foreground">{item.name}</h4>
									<p className="m-0 mt-1 text-xs text-vscode-descriptionForeground">
										{item.description}
									</p>
								</div>
								{isInstalled && (
									<span className="shrink-0 rounded-full bg-vscode-badge-background px-2 py-0.5 text-xs font-medium text-vscode-badge-foreground">
										{t("mcp:marketplace.status.installed")}
									</span>
								)}
							</div>

							<div className="mb-3 flex flex-col gap-1.5">
								<MetadataRow label={t("mcp:marketplace.labels.category")}>{item.category}</MetadataRow>
								<MetadataRow label={t("mcp:marketplace.labels.package")}>
									{item.packageName}
								</MetadataRow>
								<MetadataRow label={t("mcp:marketplace.labels.source")}>{item.source}</MetadataRow>
								<MetadataRow label={t("mcp:marketplace.labels.transport")}>
									{item.transportType}
								</MetadataRow>
								<MetadataRow label={t("mcp:marketplace.labels.requiredSecrets")}>
									{formatList(item.requiredSecrets, t("mcp:marketplace.noneRequired"))}
								</MetadataRow>
								<MetadataRow label={t("mcp:marketplace.labels.prerequisites")}>
									{formatList(item.prerequisites, t("mcp:marketplace.noneRequired"))}
								</MetadataRow>
								<MetadataRow label={t("mcp:marketplace.labels.suggestedScope")}>
									{t(`mcp:marketplace.scope.${item.recommendedScope}`)}
								</MetadataRow>
								<MetadataRow label={t("mcp:marketplace.labels.verification")}>
									{item.verificationApproach}
								</MetadataRow>
								<MetadataRow label={t("mcp:marketplace.labels.riskNotes")}>
									{item.riskNotes}
								</MetadataRow>
							</div>

							<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
								<label className="flex flex-1 flex-col gap-1 text-xs text-vscode-descriptionForeground">
									<span>{t("mcp:marketplace.labels.scope")}</span>
									<select
										className="h-7 rounded border border-vscode-dropdown-border bg-vscode-dropdown-background px-2 text-xs text-vscode-dropdown-foreground focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
										aria-label={`${t("mcp:marketplace.labels.scope")} ${item.name}`}
										value={selectedScope}
										onChange={(event) => {
											const nextScope = event.target.value === "project" ? "project" : "global"
											setScopeByItemId((current) => ({ ...current, [item.id]: nextScope }))
										}}>
										<option value="global">{t("mcp:marketplace.scope.global")}</option>
										<option value="project">{t("mcp:marketplace.scope.project")}</option>
									</select>
								</label>
								<Button className="w-full sm:w-auto" onClick={() => handleInstall(item, selectedScope)}>
									<span className="codicon codicon-sparkle" />
									{isInstalled
										? t("mcp:marketplace.actions.configureAgain")
										: t("mcp:marketplace.actions.installWithAI")}
								</Button>
							</div>
						</article>
					)
				})}
			</div>
		</section>
	)
}

export default McpMarketplace

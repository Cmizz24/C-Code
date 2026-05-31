import React, { useMemo, useState } from "react"

import type { McpServer } from "@roo-code/types"
import { marketplaceMcpCatalog, type MarketplaceMcpCatalogItem, type MarketplaceMcpScope } from "@roo/mcpMarketplace"

import { Button } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

type McpMarketplaceProps = {
	servers: McpServer[]
}

const catalogItems = marketplaceMcpCatalog as readonly MarketplaceMcpCatalogItem[]

const formatList = (items: string[], fallback: string) => {
	return items.length > 0 ? items.join(", ") : fallback
}

const getSearchText = (item: MarketplaceMcpCatalogItem) =>
	[
		item.name,
		item.serverName,
		item.category,
		item.description,
		item.packageName,
		item.source,
		item.transportType,
		...item.requiredSecrets,
		...(item.optionalSecrets ?? []),
		...item.prerequisites,
	]
		.join(" ")
		.toLowerCase()

const Chip = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
	<span
		className={`inline-flex items-center gap-1 rounded-full border border-vscode-widget-border bg-vscode-textCodeBlock-background px-2 py-0.5 text-[11px] font-medium leading-5 text-vscode-descriptionForeground ${className}`}>
		{children}
	</span>
)

const McpMarketplace = ({ servers }: McpMarketplaceProps) => {
	const { t } = useAppTranslation()
	const [scopeByItemId, setScopeByItemId] = useState<Record<string, MarketplaceMcpScope>>({})
	const [searchQuery, setSearchQuery] = useState("")
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

	const installedServerNames = useMemo(() => new Set(servers.map((server) => server.name)), [servers])
	const installedCatalogCount = useMemo(
		() => catalogItems.filter((item) => installedServerNames.has(item.serverName)).length,
		[installedServerNames],
	)
	const categories = useMemo(
		() => Array.from(new Set(catalogItems.map((item) => item.category))).sort((a, b) => a.localeCompare(b)),
		[],
	)
	const normalizedSearchQuery = searchQuery.trim().toLowerCase()
	const filteredCatalog = useMemo(
		() =>
			catalogItems.filter((item) => {
				const matchesCategory = !selectedCategory || item.category === selectedCategory
				const matchesSearch = !normalizedSearchQuery || getSearchText(item).includes(normalizedSearchQuery)

				return matchesCategory && matchesSearch
			}),
		[normalizedSearchQuery, selectedCategory],
	)
	const hasActiveFilters = Boolean(normalizedSearchQuery || selectedCategory)

	const handleInstall = (item: MarketplaceMcpCatalogItem, targetScope: MarketplaceMcpScope) => {
		vscode.postMessage({
			type: "installMarketplaceMcp",
			marketplaceMcpId: item.id,
			marketplaceMcpScope: targetScope,
		})
	}

	const clearFilters = () => {
		setSearchQuery("")
		setSelectedCategory(null)
	}

	return (
		<section className="mt-4 overflow-hidden rounded-lg border border-vscode-panel-border bg-vscode-editor-background">
			<div className="border-b border-vscode-panel-border bg-vscode-textCodeBlock-background p-4">
				<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
					<div className="min-w-0 flex-1">
						<div className="mb-2 flex items-center gap-2">
							<span className="codicon codicon-extensions text-vscode-descriptionForeground" />
							<h3 className="m-0 text-base font-semibold text-vscode-foreground">
								{t("mcp:marketplace.title")}
							</h3>
						</div>
						<p className="m-0 max-w-2xl text-xs leading-5 text-vscode-descriptionForeground">
							{t("mcp:marketplace.description")}
						</p>
					</div>

					<div className="grid grid-cols-2 gap-2 text-xs sm:min-w-56">
						<div className="rounded-md border border-vscode-widget-border bg-vscode-editor-background px-3 py-2">
							<div className="text-lg font-semibold text-vscode-foreground">{catalogItems.length}</div>
							<div className="text-vscode-descriptionForeground">
								{t("mcp:marketplace.stats.servers")}
							</div>
						</div>
						<div className="rounded-md border border-vscode-widget-border bg-vscode-editor-background px-3 py-2">
							<div className="text-lg font-semibold text-vscode-foreground">{installedCatalogCount}</div>
							<div className="text-vscode-descriptionForeground">
								{t("mcp:marketplace.stats.installed")}
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className="flex flex-col gap-3 border-b border-vscode-panel-border p-3">
				<label className="flex flex-col gap-1 text-xs font-medium text-vscode-descriptionForeground">
					<span>{t("mcp:marketplace.search.label")}</span>
					<div className="relative">
						<span className="codicon codicon-search absolute left-2 top-1/2 -translate-y-1/2 text-vscode-descriptionForeground" />
						<input
							className="h-8 w-full rounded-md border border-vscode-input-border bg-vscode-input-background px-8 text-xs text-vscode-input-foreground placeholder:text-vscode-descriptionForeground focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
							type="search"
							aria-label={t("mcp:marketplace.search.label")}
							placeholder={t("mcp:marketplace.search.placeholder")}
							value={searchQuery}
							onChange={(event) => setSearchQuery(event.target.value)}
						/>
					</div>
				</label>

				<div className="flex flex-col gap-2">
					<div className="text-xs font-medium text-vscode-descriptionForeground">
						{t("mcp:marketplace.filters.categoryLabel")}
					</div>
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							className={`rounded-full border px-3 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder ${
								selectedCategory === null
									? "border-vscode-button-background bg-vscode-button-background text-vscode-button-foreground"
									: "border-vscode-widget-border bg-vscode-textCodeBlock-background text-vscode-descriptionForeground hover:bg-vscode-list-hoverBackground hover:text-vscode-list-hoverForeground"
							}`}
							onClick={() => setSelectedCategory(null)}>
							{t("mcp:marketplace.filters.all")}
						</button>
						{categories.map((category) => (
							<button
								key={category}
								type="button"
								className={`rounded-full border px-3 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder ${
									selectedCategory === category
										? "border-vscode-button-background bg-vscode-button-background text-vscode-button-foreground"
										: "border-vscode-widget-border bg-vscode-textCodeBlock-background text-vscode-descriptionForeground hover:bg-vscode-list-hoverBackground hover:text-vscode-list-hoverForeground"
								}`}
								onClick={() => setSelectedCategory(category)}>
								{category}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className="p-3">
				<div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div className="text-xs font-semibold uppercase tracking-wide text-vscode-descriptionForeground">
						{t("mcp:marketplace.resultsSummary", {
							shown: filteredCatalog.length,
							total: catalogItems.length,
						})}
					</div>
					{hasActiveFilters && (
						<Button variant="secondary" size="sm" onClick={clearFilters}>
							<span className="codicon codicon-clear-all" />
							{t("mcp:marketplace.actions.clearFilters")}
						</Button>
					)}
				</div>

				{filteredCatalog.length === 0 ? (
					<div className="rounded-md border border-dashed border-vscode-widget-border bg-vscode-textCodeBlock-background p-6 text-center">
						<div className="mb-2 text-sm font-semibold text-vscode-foreground">
							{t("mcp:marketplace.empty.title")}
						</div>
						<p className="m-0 text-xs text-vscode-descriptionForeground">
							{t("mcp:marketplace.empty.description")}
						</p>
					</div>
				) : (
					<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
						{filteredCatalog.map((item) => {
							const selectedScope = scopeByItemId[item.id] ?? item.recommendedScope
							const isInstalled = installedServerNames.has(item.serverName)
							const secretCount = item.requiredSecrets.length
							const optionalSecretCount = item.optionalSecrets?.length ?? 0
							const prerequisitePreview = item.prerequisites.slice(0, 2)
							const hiddenPrerequisiteCount = Math.max(
								0,
								item.prerequisites.length - prerequisitePreview.length,
							)

							return (
								<article
									key={item.id}
									className="flex min-h-full flex-col rounded-lg border border-vscode-widget-border bg-vscode-textCodeBlock-background p-3 shadow-sm">
									<div className="mb-3 flex items-start justify-between gap-3">
										<div className="min-w-0 flex-1">
											<div className="mb-1 flex flex-wrap items-center gap-1.5">
												<h4 className="m-0 text-sm font-semibold text-vscode-foreground">
													{item.name}
												</h4>
												{item.featured && (
													<Chip className="border-vscode-button-background text-vscode-foreground">
														<span className="codicon codicon-star-full" />
														{t("mcp:marketplace.badges.featured")}
													</Chip>
												)}
												{item.popular && (
													<Chip>
														<span className="codicon codicon-flame" />
														{t("mcp:marketplace.badges.popular")}
													</Chip>
												)}
											</div>
											<p className="m-0 text-xs leading-5 text-vscode-descriptionForeground">
												{item.description}
											</p>
										</div>
										{isInstalled && (
											<span className="shrink-0 rounded-full bg-vscode-badge-background px-2 py-0.5 text-xs font-medium text-vscode-badge-foreground">
												{t("mcp:marketplace.status.installed")}
											</span>
										)}
									</div>

									<div className="mb-3 flex flex-wrap gap-1.5">
										<Chip>{item.category}</Chip>
										<Chip>{item.transportType}</Chip>
										{prerequisitePreview.map((prerequisite) => (
											<Chip key={prerequisite}>{prerequisite}</Chip>
										))}
										{hiddenPrerequisiteCount > 0 && (
											<Chip>
												{t("mcp:marketplace.prerequisiteOverflow", {
													count: hiddenPrerequisiteCount,
												})}
											</Chip>
										)}
									</div>

									<div className="mb-3 grid gap-2 text-xs text-vscode-descriptionForeground">
										<div>
											<span className="font-medium text-vscode-foreground">
												{t("mcp:marketplace.labels.package")}:
											</span>
											<span>{item.packageName}</span>
										</div>
										<div>
											<span className="font-medium text-vscode-foreground">
												{t("mcp:marketplace.labels.requiredSecrets")}:
											</span>
											<span>
												{secretCount > 0
													? t("mcp:marketplace.secretSummary", { count: secretCount })
													: optionalSecretCount > 0
														? t("mcp:marketplace.optionalSecretSummary", {
																count: optionalSecretCount,
															})
														: t("mcp:marketplace.noSecrets")}
											</span>
											{secretCount > 0 && (
												<span className="ml-1 text-vscode-foreground">
													{formatList(
														item.requiredSecrets,
														t("mcp:marketplace.noneRequired"),
													)}
												</span>
											)}
										</div>
										<div>
											<span className="font-medium text-vscode-foreground">
												{t("mcp:marketplace.labels.verification")}:
											</span>
											<span>{item.verificationApproach}</span>
										</div>
									</div>

									<div className="mt-auto flex flex-col gap-2 border-t border-vscode-widget-border pt-3 sm:flex-row sm:items-end">
										<label className="flex flex-1 flex-col gap-1 text-xs text-vscode-descriptionForeground">
											<span>{t("mcp:marketplace.labels.scope")}</span>
											<select
												className="h-7 rounded border border-vscode-dropdown-border bg-vscode-dropdown-background px-2 text-xs text-vscode-dropdown-foreground focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder"
												aria-label={`${t("mcp:marketplace.labels.scope")} ${item.name}`}
												value={selectedScope}
												onChange={(event) => {
													const nextScope =
														event.target.value === "project" ? "project" : "global"
													setScopeByItemId((current) => ({
														...current,
														[item.id]: nextScope,
													}))
												}}>
												<option value="global">{t("mcp:marketplace.scope.global")}</option>
												<option value="project">{t("mcp:marketplace.scope.project")}</option>
											</select>
										</label>
										<Button
											className="w-full sm:w-auto"
											onClick={() => handleInstall(item, selectedScope)}>
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
				)}
			</div>
		</section>
	)
}

export default McpMarketplace

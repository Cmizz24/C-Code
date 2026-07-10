import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import type { ModelCapabilityProvenanceKey, ModelInfo, ModelProvenance, ModelProvenanceSource } from "@roo-code/types"

import { formatPrice } from "@src/utils/formatPrice"
import { cn } from "@src/lib/utils"
import { useAppTranslation } from "@src/i18n/TranslationContext"

import { ModelDescriptionMarkdown } from "./ModelDescriptionMarkdown"

type AppTranslationT = ReturnType<typeof useAppTranslation>["t"]

type ModelInfoViewProps = {
	apiProvider?: string
	selectedModelId: string
	modelInfo?: ModelInfo
	isDescriptionExpanded: boolean
	setIsDescriptionExpanded: (isExpanded: boolean) => void
	hidePricing?: boolean
}

const capabilityProvenanceDisplayOrder = [
	"contextWindow",
	"maxTokens",
	"pricing",
	"reasoning",
	"promptCaching",
	"images",
	"imageOutput",
	"tools",
	"computerUse",
	"webSearch",
	"jsonSchema",
	"deprecation",
	"description",
	"serviceTiers",
] satisfies ModelCapabilityProvenanceKey[]

const getCapabilityProvenanceEntries = (modelInfo?: ModelInfo) =>
	(Object.entries(modelInfo?.capabilityProvenance ?? {}) as [ModelCapabilityProvenanceKey, ModelProvenance][]).sort(
		([left], [right]) =>
			capabilityProvenanceDisplayOrder.indexOf(left) - capabilityProvenanceDisplayOrder.indexOf(right),
	)

const getPrimaryProvenance = (
	modelInfo: ModelInfo | undefined,
	capabilityEntries: [ModelCapabilityProvenanceKey, ModelProvenance][],
) => modelInfo?.provenance ?? capabilityEntries[0]?.[1]

const getPrimaryProvenanceSource = (provenance?: ModelProvenance) =>
	provenance?.sources?.find((source) => source.label || source.url || source.endpoint || source.type)

const getProvenanceSourceLabel = (source: ModelProvenanceSource | undefined, t: AppTranslationT) => {
	if (!source) {
		return undefined
	}

	return source.label || t(`settings:modelInfo.provenance.sourceTypes.${source.type}`)
}

const formatCapabilityProvenanceSummary = (
	capabilityEntries: [ModelCapabilityProvenanceKey, ModelProvenance][],
	t: AppTranslationT,
) => {
	if (capabilityEntries.length === 0) {
		return undefined
	}

	const visibleCapabilities = capabilityEntries
		.slice(0, 4)
		.map(([capability]) => t(`settings:modelInfo.provenance.capabilities.${capability}`))
	const remainingCount = capabilityEntries.length - visibleCapabilities.length

	if (remainingCount > 0) {
		return t("settings:modelInfo.provenance.capabilitySummaryWithMore", {
			capabilities: visibleCapabilities.join(", "),
			count: remainingCount,
		})
	}

	return t("settings:modelInfo.provenance.capabilitySummary", {
		capabilities: visibleCapabilities.join(", "),
	})
}

export const ModelInfoView = ({
	apiProvider,
	selectedModelId,
	modelInfo,
	isDescriptionExpanded,
	setIsDescriptionExpanded,
	hidePricing,
}: ModelInfoViewProps) => {
	const { t } = useAppTranslation()

	// Show tiered pricing table for OpenAI Native when model supports non-standard tiers
	const allowedTierNames =
		modelInfo?.tiers?.filter((t) => t.name === "flex" || t.name === "priority")?.map((t) => t.name) ?? []
	const shouldShowTierPricingTable = apiProvider === "openai-native" && allowedTierNames.length > 0
	const fmt = (n?: number) => (typeof n === "number" ? `${formatPrice(n)}` : "—")
	const capabilityProvenanceEntries = getCapabilityProvenanceEntries(modelInfo)
	const primaryProvenance = getPrimaryProvenance(modelInfo, capabilityProvenanceEntries)
	const primaryProvenanceSource = getPrimaryProvenanceSource(primaryProvenance)
	const primaryProvenanceSourceLabel = getProvenanceSourceLabel(primaryProvenanceSource, t)
	const capabilityProvenanceSummary = formatCapabilityProvenanceSummary(capabilityProvenanceEntries, t)
	const shouldShowProvenance = Boolean(primaryProvenance || capabilityProvenanceSummary)

	const baseInfoItems = [
		typeof modelInfo?.contextWindow === "number" && modelInfo.contextWindow > 0 && (
			<>
				<span className="font-medium">{t("settings:modelInfo.contextWindow")}</span>{" "}
				{modelInfo.contextWindow?.toLocaleString()} tokens
			</>
		),
		typeof modelInfo?.maxTokens === "number" && modelInfo.maxTokens > 0 && (
			<>
				<span className="font-medium">{t("settings:modelInfo.maxOutput")}:</span>{" "}
				{modelInfo.maxTokens?.toLocaleString()} tokens
			</>
		),
		<ModelInfoSupportsItem
			isSupported={modelInfo?.supportsImages ?? false}
			supportsLabel={t("settings:modelInfo.supportsImages")}
			doesNotSupportLabel={t("settings:modelInfo.noImages")}
		/>,
		<ModelInfoSupportsItem
			isSupported={modelInfo?.supportsPromptCache ?? false}
			supportsLabel={t("settings:modelInfo.supportsPromptCache")}
			doesNotSupportLabel={t("settings:modelInfo.noPromptCache")}
		/>,
		apiProvider === "gemini" && (
			<span className="italic">
				{selectedModelId.includes("pro-preview")
					? t("settings:modelInfo.gemini.billingEstimate")
					: t("settings:modelInfo.gemini.freeRequests", {
							count: selectedModelId && selectedModelId.includes("flash") ? 15 : 2,
						})}{" "}
				<VSCodeLink href="https://ai.google.dev/pricing" className="text-sm">
					{t("settings:modelInfo.gemini.pricingDetails")}
				</VSCodeLink>
			</span>
		),
	].filter(Boolean)

	const priceInfoItems = [
		modelInfo?.inputPrice !== undefined && (
			<>
				<span className="font-medium">{t("settings:modelInfo.inputPrice")}:</span>{" "}
				{formatPrice(modelInfo.inputPrice)} / 1M tokens
			</>
		),
		modelInfo?.outputPrice !== undefined && (
			<>
				<span className="font-medium">{t("settings:modelInfo.outputPrice")}:</span>{" "}
				{formatPrice(modelInfo.outputPrice)} / 1M tokens
			</>
		),
		modelInfo?.supportsPromptCache && modelInfo.cacheReadsPrice && (
			<>
				<span className="font-medium">{t("settings:modelInfo.cacheReadsPrice")}:</span>{" "}
				{formatPrice(modelInfo.cacheReadsPrice || 0)} / 1M tokens
			</>
		),
		modelInfo?.supportsPromptCache && modelInfo.cacheWritesPrice && (
			<>
				<span className="font-medium">{t("settings:modelInfo.cacheWritesPrice")}:</span>{" "}
				{formatPrice(modelInfo.cacheWritesPrice || 0)} / 1M tokens
			</>
		),
	].filter(Boolean)

	// Show pricing info unless hidePricing is set or tier pricing table is shown
	const infoItems = shouldShowTierPricingTable || hidePricing ? baseInfoItems : [...baseInfoItems, ...priceInfoItems]

	return (
		<>
			{modelInfo?.description && (
				<ModelDescriptionMarkdown
					key="description"
					markdown={modelInfo.description}
					isExpanded={isDescriptionExpanded}
					setIsExpanded={setIsDescriptionExpanded}
				/>
			)}
			<div className="text-sm text-vscode-descriptionForeground">
				{infoItems.map((item, index) => (
					<div key={index}>{item}</div>
				))}
			</div>

			{shouldShowProvenance && (
				<div
					className="mt-2 rounded border border-vscode-dropdown-border bg-vscode-sideBar-background/40 px-2 py-1.5 text-xs text-vscode-descriptionForeground"
					data-testid="model-info-provenance">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="font-medium text-vscode-foreground">
							{t("settings:modelInfo.provenance.title")}
						</span>
						{primaryProvenance?.reviewStatus && (
							<span data-testid="model-info-provenance-review-status">
								{t("settings:modelInfo.provenance.reviewStatus", {
									status: t(
										`settings:modelInfo.provenance.reviewStatuses.${primaryProvenance.reviewStatus}`,
									),
								})}
							</span>
						)}
						{primaryProvenance?.lastReviewed && (
							<span>
								{t("settings:modelInfo.provenance.lastReviewed", {
									date: primaryProvenance.lastReviewed,
								})}
							</span>
						)}
					</div>
					{capabilityProvenanceSummary && (
						<div data-testid="model-info-capability-provenance">{capabilityProvenanceSummary}</div>
					)}
					{primaryProvenanceSource && primaryProvenanceSourceLabel && (
						<div className="flex flex-wrap items-center gap-x-1" data-testid="model-info-provenance-source">
							<span>{t("settings:modelInfo.provenance.source")}</span>
							{primaryProvenanceSource.url ? (
								<VSCodeLink href={primaryProvenanceSource.url} className="text-xs">
									{primaryProvenanceSourceLabel}
								</VSCodeLink>
							) : (
								<span>{primaryProvenanceSourceLabel}</span>
							)}
							{primaryProvenanceSource.endpoint && (
								<span>
									{t("settings:modelInfo.provenance.endpoint", {
										endpoint: primaryProvenanceSource.endpoint,
									})}
								</span>
							)}
						</div>
					)}
				</div>
			)}

			{shouldShowTierPricingTable && !hidePricing && (
				<div className="mt-2">
					<div className="text-xs text-vscode-descriptionForeground mb-1">
						{t("settings:serviceTier.pricingTableTitle")}
					</div>
					<div className="border border-vscode-dropdown-border rounded-xs overflow-hidden">
						<table className="w-full text-sm">
							<thead className="bg-vscode-dropdown-background">
								<tr>
									<th className="text-left px-3 py-1.5">{t("settings:serviceTier.columns.tier")}</th>
									<th className="text-right px-3 py-1.5">
										{t("settings:serviceTier.columns.input")}
									</th>
									<th className="text-right px-3 py-1.5">
										{t("settings:serviceTier.columns.output")}
									</th>
									<th className="text-right px-3 py-1.5">
										{t("settings:serviceTier.columns.cacheReads")}
									</th>
								</tr>
							</thead>
							<tbody>
								<tr className="border-t border-vscode-dropdown-border/60">
									<td className="px-3 py-1.5">{t("settings:serviceTier.standard")}</td>
									<td className="px-3 py-1.5 text-right">{fmt(modelInfo?.inputPrice)}</td>
									<td className="px-3 py-1.5 text-right">{fmt(modelInfo?.outputPrice)}</td>
									<td className="px-3 py-1.5 text-right">{fmt(modelInfo?.cacheReadsPrice)}</td>
								</tr>
								{allowedTierNames.includes("flex") && (
									<tr className="border-t border-vscode-dropdown-border/60">
										<td className="px-3 py-1.5">{t("settings:serviceTier.flex")}</td>
										<td className="px-3 py-1.5 text-right">
											{fmt(
												modelInfo?.tiers?.find((t) => t.name === "flex")?.inputPrice ??
													modelInfo?.inputPrice,
											)}
										</td>
										<td className="px-3 py-1.5 text-right">
											{fmt(
												modelInfo?.tiers?.find((t) => t.name === "flex")?.outputPrice ??
													modelInfo?.outputPrice,
											)}
										</td>
										<td className="px-3 py-1.5 text-right">
											{fmt(
												modelInfo?.tiers?.find((t) => t.name === "flex")?.cacheReadsPrice ??
													modelInfo?.cacheReadsPrice,
											)}
										</td>
									</tr>
								)}
								{allowedTierNames.includes("priority") && (
									<tr className="border-t border-vscode-dropdown-border/60">
										<td className="px-3 py-1.5">{t("settings:serviceTier.priority")}</td>
										<td className="px-3 py-1.5 text-right">
											{fmt(
												modelInfo?.tiers?.find((t) => t.name === "priority")?.inputPrice ??
													modelInfo?.inputPrice,
											)}
										</td>
										<td className="px-3 py-1.5 text-right">
											{fmt(
												modelInfo?.tiers?.find((t) => t.name === "priority")?.outputPrice ??
													modelInfo?.outputPrice,
											)}
										</td>
										<td className="px-3 py-1.5 text-right">
											{fmt(
												modelInfo?.tiers?.find((t) => t.name === "priority")?.cacheReadsPrice ??
													modelInfo?.cacheReadsPrice,
											)}
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</>
	)
}

const ModelInfoSupportsItem = ({
	isSupported,
	supportsLabel,
	doesNotSupportLabel,
}: {
	isSupported: boolean
	supportsLabel: string
	doesNotSupportLabel: string
}) => (
	<div className="flex items-center gap-1 font-medium">
		<span className={cn("codicon", isSupported ? "codicon-check" : "codicon-x")} />
		{isSupported ? supportsLabel : doesNotSupportLabel}
	</div>
)

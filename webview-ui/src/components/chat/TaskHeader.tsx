import { memo, useRef, useState, useMemo, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { ChevronUp, ChevronDown, HardDriveDownload, HardDriveUpload, FoldVertical, ArrowLeft } from "lucide-react"
import prettyBytes from "pretty-bytes"

import type { ClineMessage, ContextCacheStats } from "@roo-code/types"

import { getModelMaxOutputTokens } from "@roo/api"

import { formatLargeNumber } from "@src/utils/format"
import { cn } from "@src/lib/utils"
import { StandardTooltip, Button, Table, TableBody, TableRow, TableCell, CircularProgress } from "@src/components/ui"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { vscode } from "@src/utils/vscode"

import Thumbnails from "../common/Thumbnails"

import { TaskActions } from "./TaskActions"
import { ContextWindowProgress } from "./ContextWindowProgress"
import { Mention } from "./Mention"
import { TodoListDisplay } from "./TodoListDisplay"
import { LucideIconButton } from "./LucideIconButton"

export interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	aggregatedCost?: number
	hasSubtasks?: boolean
	parentTaskId?: string
	costBreakdown?: string
	contextTokens: number
	buttonsDisabled: boolean
	handleCondenseContext: (taskId: string) => void
	todos?: any[]
}

const DEFAULT_CONTEXT_CACHE_STATS: ContextCacheStats = {
	hotCacheTokens: 0,
	hotCacheChunks: 0,
	coldCacheChunks: 0,
	ramUsedMb: 0,
	ramBudgetMb: 1024,
	swapsThisSession: 0,
	condensingAvoided: 0,
}

const formatContextCacheRamValue = (valueMb: number | undefined) => {
	const safeValueMb = Number.isFinite(valueMb) && (valueMb ?? 0) > 0 ? (valueMb ?? 0) : 0

	if (safeValueMb >= 1024 && safeValueMb % 1024 === 0) {
		return `${safeValueMb / 1024}GB`
	}

	const formatted = Number.isInteger(safeValueMb) ? safeValueMb.toString() : safeValueMb.toFixed(1)
	return `${formatted}MB`
}

const formatContextCacheEvictions = (
	hot: number | undefined,
	cold: number | undefined,
	t: ReturnType<typeof useTranslation>["t"],
) => {
	const hotTotal = hot ?? 0
	const coldTotal = cold ?? 0
	return t("chat:task.contextCache.diagnostics.evictionsValue", {
		total: formatLargeNumber(hotTotal + coldTotal),
		hot: formatLargeNumber(hotTotal),
		cold: formatLargeNumber(coldTotal),
	})
}

const formatContextCacheSummary = (stats: ContextCacheStats, t: ReturnType<typeof useTranslation>["t"]) => {
	const combined = stats.combinedBudget
	const hotChunks = combined?.hotCacheChunks ?? stats.hotCacheChunks
	const coldChunks = combined?.coldCacheChunks ?? stats.coldCacheChunks
	const ramUsedMb = combined?.ramUsedMb ?? stats.ramUsedMb
	const ramBudgetMb = combined?.ramBudgetMb ?? stats.ramBudgetMb
	const contributorSummary =
		combined && combined.managerCount > 1
			? ` · ${t("chat:task.contextCache.diagnostics.contributors", { count: combined.managerCount })}`
			: ""

	return `${formatLargeNumber(hotChunks)} ${t("chat:task.contextCache.hotShort")} / ${formatLargeNumber(coldChunks)} ${t("chat:task.contextCache.coldShort")} · ${formatContextCacheRamValue(ramUsedMb)}/${formatContextCacheRamValue(ramBudgetMb)}${contributorSummary}`
}

const formatContextCacheContributorUsage = (
	ramUsedMb: number | undefined,
	hotChunks: number | undefined,
	coldChunks: number | undefined,
	t: ReturnType<typeof useTranslation>["t"],
) =>
	t("chat:task.contextCache.diagnostics.contributorUsage", {
		ram: formatContextCacheRamValue(ramUsedMb),
		hot: formatLargeNumber(hotChunks ?? 0),
		cold: formatLargeNumber(coldChunks ?? 0),
	})

/**
 * Format a reset timestamp into a human-readable "resets in Xh Ym" string.
 * Returns undefined if no reset time is available or if it's in the past.
 */
function formatResetTime(resetsAt: number | undefined, now = Date.now()): string | undefined {
	if (!resetsAt) return undefined
	const diffMs = resetsAt - now
	if (diffMs <= 0) return undefined
	const totalMinutes = Math.ceil(diffMs / 60000)
	const hours = Math.floor(totalMinutes / 60)
	const minutes = totalMinutes % 60
	if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
	if (hours > 0) return `${hours}h`
	return `${minutes}m`
}

/**
 * Get the Tailwind color class for a plan usage percentage.
 */
function getPlanUsageColorClass(usedPercent: number): string {
	if (usedPercent >= 80) return "text-vscode-errorForeground"
	if (usedPercent >= 50) return "text-vscode-editorWarning-foreground"
	return "text-vscode-charts-green"
}

const OPENAI_CODEX_RATE_LIMIT_STALE_MS = 5 * 60_000
const OPENAI_CODEX_RATE_LIMIT_POLL_MS = 5 * 60_000
const PLAN_USAGE_RESET_TICK_MS = 60_000

const formatPlanUsageCost = (value: number) => `$${Math.max(0, value).toFixed(2)}`

type PlanUsageDisplay = {
	percent: number
	resetTime?: string
	remainingText?: string
	colorClass: string
}

const TaskHeader = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	aggregatedCost,
	hasSubtasks,
	parentTaskId,
	costBreakdown,
	contextTokens,
	buttonsDisabled,
	handleCondenseContext,
	todos,
}: TaskHeaderProps) => {
	const { t } = useTranslation()
	const {
		apiConfiguration,
		currentTaskItem,
		contextCacheEnabled,
		contextCacheStats,
		contextCacheWarning,
		openAiCodexRateLimits,
		cachedProviderPlanUsage,
	} = useExtensionState()
	const { id: modelId, info: model } = useSelectedModel(apiConfiguration)
	const isPlanBased = model?.subscriptionBased === true
	const providerName = apiConfiguration.apiProvider
	const [isTaskExpanded, setIsTaskExpanded] = useState(false)
	const [planUsageResetTick, setPlanUsageResetTick] = useState(() => Date.now())

	// Auto-fetch live plan usage when switching to a plan-based provider with a live API.
	// Extract individual apiConfiguration values so the useEffect dependency array
	// uses simple variables that ESLint can statically check.
	const { apiKey, zaiApiLine, minimaxApiKey, minimaxBaseUrl } = apiConfiguration
	const xiaomiMiMoPlatformCookie = (apiConfiguration as any).xiaomiMiMoPlatformCookie as string | undefined
	const sambaNovaApiKey = (apiConfiguration as any).sambaNovaApiKey as string | undefined
	const qwenCodeOauthPath = (apiConfiguration as any).qwenCodeOauthPath as string | undefined

	useEffect(() => {
		if (!isPlanBased || !providerName) return

		const LIVE_PROVIDERS = ["poe", "zai", "moonshot", "minimax", "xiaomi-mimo", "qwen-code", "sambanova"] as const
		if (!(LIVE_PROVIDERS as readonly string[]).includes(providerName)) return

		// Always fetch live data — no caching/stale check.
		switch (providerName) {
			case "poe":
				if (apiKey) {
					vscode.postMessage({ type: "fetchPoePlanUsage", text: apiKey })
				}
				break
			case "zai":
				if (apiKey) {
					// Determine if using China region
					vscode.postMessage({
						type: "fetchZAiPlanUsage",
						text: apiKey,
						bool: zaiApiLine ? zaiApiLine === "china_coding" || zaiApiLine === "china_api" : false,
					})
				}
				break
			case "moonshot":
				if (apiKey) {
					vscode.postMessage({ type: "fetchMoonshotPlanUsage", text: apiKey })
				}
				break
			case "minimax":
				if (minimaxApiKey) {
					// Determine if using China region from the base URL
					vscode.postMessage({
						type: "fetchMiniMaxPlanUsage",
						text: minimaxApiKey,
						bool: minimaxBaseUrl === "https://api.minimaxi.com/v1",
					})
				}
				break
			case "xiaomi-mimo": {
				// Use the platform cookie stored in settings
				if (xiaomiMiMoPlatformCookie) {
					vscode.postMessage({ type: "fetchXiaomiMiMoPlanUsage", text: xiaomiMiMoPlatformCookie })
				}
				break
			}
			case "qwen-code": {
				// Qwen Code uses OAuth credentials; pass the custom path if configured
				vscode.postMessage({ type: "fetchQwenCodePlanUsage", text: qwenCodeOauthPath ?? "" })
				break
			}
			case "sambanova": {
				if (sambaNovaApiKey) {
					vscode.postMessage({ type: "fetchSambaNovaPlanUsage", text: sambaNovaApiKey })
				}
				break
			}
		}
	}, [
		isPlanBased,
		providerName,
		apiKey,
		zaiApiLine,
		minimaxApiKey,
		minimaxBaseUrl,
		xiaomiMiMoPlatformCookie,
		sambaNovaApiKey,
		qwenCodeOauthPath,
	])

	useEffect(() => {
		const interval = window.setInterval(() => {
			setPlanUsageResetTick(Date.now())
		}, PLAN_USAGE_RESET_TICK_MS)

		return () => window.clearInterval(interval)
	}, [])

	useEffect(() => {
		if (!isPlanBased || providerName !== "openai-codex") return

		const requestIfStale = () => {
			const fetchedAt = openAiCodexRateLimits?.fetchedAt
			if (typeof fetchedAt !== "number" || Date.now() - fetchedAt >= OPENAI_CODEX_RATE_LIMIT_STALE_MS) {
				vscode.postMessage({ type: "requestOpenAiCodexRateLimits" })
			}
		}

		requestIfStale()
		const interval = window.setInterval(requestIfStale, OPENAI_CODEX_RATE_LIMIT_POLL_MS)

		return () => window.clearInterval(interval)
	}, [isPlanBased, openAiCodexRateLimits?.fetchedAt, providerName])

	const textContainerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)
	const contextWindow = model?.contextWindow || 1

	// Calculate maxTokens (reserved for output) once for reuse in percentage and tooltip
	const maxTokens = useMemo(
		() =>
			model
				? getModelMaxOutputTokens({
						modelId,
						model,
						settings: apiConfiguration,
					})
				: 0,
		[model, modelId, apiConfiguration],
	)
	const reservedForOutput = maxTokens || 0

	const condenseButton = (
		<LucideIconButton
			title={t("chat:task.condenseContext")}
			icon={FoldVertical}
			disabled={buttonsDisabled}
			onClick={() => currentTaskItem && handleCondenseContext(currentTaskItem.id)}
		/>
	)

	const hasTodos = todos && Array.isArray(todos) && todos.length > 0

	// OpenAI Codex exposes provider-reported ChatGPT plan usage; prefer it over local estimates.
	const openAiCodexPlanUsage = useMemo<PlanUsageDisplay | undefined>(() => {
		if (providerName !== "openai-codex" || !openAiCodexRateLimits?.primary) return undefined
		const { usedPercent, resetsAt } = openAiCodexRateLimits.primary
		return {
			percent: Math.round(usedPercent),
			resetTime: formatResetTime(resetsAt, planUsageResetTick),
			colorClass: getPlanUsageColorClass(usedPercent),
		}
	}, [openAiCodexRateLimits, planUsageResetTick, providerName])

	// Live API-fetched plan usage for providers with usable public APIs.
	const liveProviderPlanUsage = useMemo<PlanUsageDisplay | undefined>(() => {
		if (!providerName || !cachedProviderPlanUsage) return undefined

		const cached = cachedProviderPlanUsage[providerName]
		if (!cached) return undefined

		switch (providerName) {
			case "poe": {
				const balance =
					typeof (cached as any).currentPointBalance === "number"
						? ((cached as any).currentPointBalance as number)
						: undefined
				if (balance === undefined) return undefined
				return {
					percent: 0, // Poe points don't have a percentage concept
					remainingText: `${formatLargeNumber(balance)} points`,
					colorClass: balance <= 0 ? "text-vscode-errorForeground" : "text-vscode-charts-green",
				}
			}
			case "zai": {
				const primary = (cached as any)?.primary as { usedPercent?: number; resetsAt?: number } | undefined
				if (!primary || typeof primary.usedPercent !== "number") return undefined
				return {
					percent: Math.round(primary.usedPercent),
					resetTime: formatResetTime(primary.resetsAt),
					colorClass: getPlanUsageColorClass(primary.usedPercent),
				}
			}
			case "moonshot": {
				const balance =
					typeof (cached as any).balance === "number" ? ((cached as any).balance as number) : undefined
				const currency =
					typeof (cached as any).currency === "string" ? ((cached as any).currency as string) : undefined
				if (balance === undefined) return undefined
				const currencyLabel = currency ? ` ${currency}` : ""
				return {
					percent: 0, // Balance doesn't have a percentage concept
					remainingText: `${formatPlanUsageCost(balance)}${currencyLabel} balance`,
					colorClass: balance <= 0 ? "text-vscode-errorForeground" : "text-vscode-charts-green",
				}
			}
			case "minimax": {
				const usedPercent =
					typeof (cached as any).usedPercent === "number"
						? ((cached as any).usedPercent as number)
						: undefined
				const tokensRemaining =
					typeof (cached as any).tokensRemaining === "number"
						? ((cached as any).tokensRemaining as number)
						: undefined
				if (usedPercent === undefined && tokensRemaining === undefined) return undefined
				const percent = typeof usedPercent === "number" ? Math.round(usedPercent) : 0
				return {
					percent,
					remainingText:
						tokensRemaining !== undefined ? `${formatLargeNumber(tokensRemaining)} tokens left` : undefined,
					colorClass: getPlanUsageColorClass(percent),
				}
			}
			case "xiaomi-mimo": {
				const creditsRemaining =
					typeof (cached as any).creditsRemaining === "number"
						? ((cached as any).creditsRemaining as number)
						: undefined
				const usedPercent =
					typeof (cached as any).usedPercent === "number"
						? ((cached as any).usedPercent as number)
						: undefined
				if (creditsRemaining === undefined && usedPercent === undefined) return undefined
				const percent = typeof usedPercent === "number" ? Math.round(usedPercent) : 0
				return {
					percent,
					remainingText:
						creditsRemaining !== undefined
							? `${formatLargeNumber(creditsRemaining)} credits left`
							: undefined,
					colorClass:
						creditsRemaining !== undefined && creditsRemaining <= 0
							? "text-vscode-errorForeground"
							: getPlanUsageColorClass(percent),
				}
			}
			case "qwen-code": {
				const usedPercent =
					typeof (cached as any).usedPercent === "number"
						? ((cached as any).usedPercent as number)
						: undefined
				const requestsRemaining =
					typeof (cached as any).requestsRemaining === "number"
						? ((cached as any).requestsRemaining as number)
						: undefined
				const windowLabel =
					typeof (cached as any).windowLabel === "string"
						? ((cached as any).windowLabel as string)
						: undefined
				if (usedPercent === undefined && requestsRemaining === undefined) return undefined
				const percent = typeof usedPercent === "number" ? Math.round(usedPercent) : 0
				return {
					percent,
					remainingText:
						requestsRemaining !== undefined
							? `${formatLargeNumber(requestsRemaining)} req${windowLabel ? ` / ${windowLabel}` : ""} left`
							: undefined,
					colorClass: getPlanUsageColorClass(percent),
				}
			}
			case "sambanova": {
				const dayUsedPercent =
					typeof (cached as any).dayUsedPercent === "number"
						? ((cached as any).dayUsedPercent as number)
						: undefined
				const minuteUsedPercent =
					typeof (cached as any).minuteUsedPercent === "number"
						? ((cached as any).minuteUsedPercent as number)
						: undefined
				const dayRequestsRemaining =
					typeof (cached as any).dayRequestsRemaining === "number"
						? ((cached as any).dayRequestsRemaining as number)
						: undefined
				// Prefer daily usage as the primary display; fall back to per-minute
				if (
					dayUsedPercent === undefined &&
					minuteUsedPercent === undefined &&
					dayRequestsRemaining === undefined
				) {
					return undefined
				}
				const percent =
					typeof dayUsedPercent === "number"
						? Math.round(dayUsedPercent)
						: typeof minuteUsedPercent === "number"
							? Math.round(minuteUsedPercent)
							: 0
				return {
					percent,
					remainingText:
						dayRequestsRemaining !== undefined
							? `${formatLargeNumber(dayRequestsRemaining)} req/day left`
							: undefined,
					colorClass: getPlanUsageColorClass(percent),
				}
			}
			default:
				return undefined
		}
	}, [providerName, cachedProviderPlanUsage])

	const planUsage = openAiCodexPlanUsage ?? liveProviderPlanUsage

	// Determine if this is a subtask (has a parent)
	const isSubtask = !!parentTaskId
	const displayCost = aggregatedCost ?? totalCost
	const shouldShowCost = Number.isFinite(displayCost) && displayCost > 0 && !isPlanBased
	// For plan-based providers, show token usage prominently in the collapsed view
	const hasTokenUsage =
		(typeof tokensIn === "number" && tokensIn > 0) || (typeof tokensOut === "number" && tokensOut > 0)
	const shouldShowTokenUsage = isPlanBased && hasTokenUsage
	const safeContextCacheStats = contextCacheStats ?? DEFAULT_CONTEXT_CACHE_STATS
	const shouldShowContextCacheStatus = contextCacheEnabled !== false
	const contextCacheSummary = formatContextCacheSummary(safeContextCacheStats, t)
	const combinedContextCache = safeContextCacheStats.combinedBudget
	const contextCacheColdChunks = combinedContextCache?.coldCacheChunks ?? safeContextCacheStats.coldCacheChunks
	const contextCacheColdRamDisplay = combinedContextCache
		? formatContextCacheRamValue(combinedContextCache.coldCacheRamMb)
		: `${formatContextCacheRamValue(safeContextCacheStats.ramUsedMb)} / ${formatContextCacheRamValue(safeContextCacheStats.ramBudgetMb)}`
	const contextCacheContributors = safeContextCacheStats.contributors ?? combinedContextCache?.contributors ?? []
	const contextCacheEvictions = safeContextCacheStats.evictions ?? combinedContextCache?.evictions
	const topContextCacheContributors = contextCacheContributors.slice(0, 3)
	const shouldShowCombinedContextCacheDiagnostics = Boolean(
		combinedContextCache || contextCacheContributors.length > 0 || (contextCacheEvictions?.total ?? 0) > 0,
	)
	const contextCacheTooltip = (
		<Table className="text-base ml-1.5">
			<TableBody>
				<TableRow>
					<TableCell className="font-medium whitespace-nowrap">
						{t("chat:task.contextCache.hotCache")}
					</TableCell>
					<TableCell className="text-right text-[0.9em] font-mono">
						{formatLargeNumber(safeContextCacheStats.hotCacheChunks)} /{" "}
						{formatLargeNumber(safeContextCacheStats.hotCacheTokens)} {t("chat:contextManagement.tokens")}
					</TableCell>
				</TableRow>
				<TableRow>
					<TableCell className="font-medium whitespace-nowrap">
						{t("chat:task.contextCache.coldCache")}
					</TableCell>
					<TableCell className="text-right text-[0.9em] font-mono">
						{formatLargeNumber(contextCacheColdChunks)} · {contextCacheColdRamDisplay}
					</TableCell>
				</TableRow>
				<TableRow>
					<TableCell className="font-medium whitespace-nowrap">{t("chat:task.contextCache.swaps")}</TableCell>
					<TableCell className="text-right text-[0.9em] font-mono">
						{formatLargeNumber(safeContextCacheStats.swapsThisSession)}
					</TableCell>
				</TableRow>
				<TableRow>
					<TableCell className="font-medium whitespace-nowrap">
						{t("chat:task.contextCache.condensingAvoided")}
					</TableCell>
					<TableCell className="text-right text-[0.9em] font-mono">
						{formatLargeNumber(safeContextCacheStats.condensingAvoided)}
					</TableCell>
				</TableRow>
				{shouldShowCombinedContextCacheDiagnostics && (
					<>
						<TableRow>
							<TableCell className="font-medium whitespace-nowrap">
								{t("chat:task.contextCache.diagnostics.combinedBudget")}
							</TableCell>
							<TableCell className="text-right text-[0.9em] font-mono">
								{formatContextCacheRamValue(
									combinedContextCache?.ramUsedMb ?? safeContextCacheStats.ramUsedMb,
								)}{" "}
								/{" "}
								{formatContextCacheRamValue(
									combinedContextCache?.ramBudgetMb ?? safeContextCacheStats.ramBudgetMb,
								)}
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell className="font-medium whitespace-nowrap">
								{t("chat:task.contextCache.diagnostics.hotColdRam")}
							</TableCell>
							<TableCell className="text-right text-[0.9em] font-mono">
								{formatContextCacheRamValue(combinedContextCache?.hotCacheRamMb)} /{" "}
								{formatContextCacheRamValue(
									combinedContextCache?.coldCacheRamMb ?? safeContextCacheStats.ramUsedMb,
								)}
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell className="font-medium whitespace-nowrap">
								{t("chat:task.contextCache.diagnostics.evictionsLabel")}
							</TableCell>
							<TableCell className="text-right text-[0.9em] font-mono">
								{formatContextCacheEvictions(
									contextCacheEvictions?.hot,
									contextCacheEvictions?.cold,
									t,
								)}
							</TableCell>
						</TableRow>
						{topContextCacheContributors.map((contributor) => (
							<TableRow key={contributor.id}>
								<TableCell className="font-medium whitespace-nowrap">{contributor.label}</TableCell>
								<TableCell className="text-right text-[0.9em] font-mono">
									{formatContextCacheContributorUsage(
										contributor.ramUsedMb,
										contributor.hotCacheChunks,
										contributor.coldCacheChunks,
										t,
									)}
								</TableCell>
							</TableRow>
						))}
					</>
				)}
				{contextCacheWarning && (
					<TableRow>
						<TableCell className="font-medium whitespace-nowrap">
							{t("chat:task.contextCache.warning")}
						</TableCell>
						<TableCell className="text-right text-[0.9em] font-mono">{contextCacheWarning}</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	)

	const handleBackToParent = () => {
		if (parentTaskId) {
			vscode.postMessage({ type: "showTaskWithId", text: parentTaskId })
		}
	}

	return (
		<div className="group pt-2 pb-0 px-3">
			{isSubtask && (
				<div className="mb-2" onClick={(e) => e.stopPropagation()}>
					<Button
						variant="ghost"
						size="sm"
						onClick={handleBackToParent}
						className="flex items-center gap-1.5 text-xs text-vscode-descriptionForeground hover:text-vscode-foreground">
						<ArrowLeft className="size-3" />
						{t("chat:task.backToParentTask")}
					</Button>
				</div>
			)}
			<div
				className={cn(
					"px-3 pt-2.5 pb-2 flex flex-col gap-1.5 relative z-1 cursor-pointer",
					"bg-vscode-input-background hover:bg-vscode-input-background/90",
					"text-vscode-foreground/80 hover:text-vscode-foreground",
					"shadow-lg shadow-vscode-sideBar-background/50 rounded-xl",
					hasTodos && "border-b-0",
				)}
				onClick={(e) => {
					// Don't expand if clicking on todos section
					if (e.target instanceof Element && e.target.closest("[data-todo-list]")) {
						return
					}

					// Don't expand if clicking on buttons or interactive elements
					if (
						e.target instanceof Element &&
						(e.target.closest("button") ||
							e.target.closest('[role="button"]') ||
							e.target.closest(".share-button") ||
							e.target.closest("[data-radix-popper-content-wrapper]") ||
							e.target.closest("img") ||
							e.target.tagName === "IMG")
					) {
						return
					}

					// Don't expand/collapse if user is selecting text
					const selection = window.getSelection()
					if (selection && selection.toString().length > 0) {
						return
					}

					setIsTaskExpanded(!isTaskExpanded)
				}}>
				<div className="flex justify-between items-center gap-0">
					<div className="flex items-center select-none grow min-w-0">
						<div className="grow min-w-0">
							{isTaskExpanded && <span className="font-bold">{t("chat:task.title")}</span>}
							{!isTaskExpanded && (
								<div className="flex items-center gap-2 whitespace-nowrap overflow-hidden text-ellipsis">
									<Mention text={task.text} />
								</div>
							)}
						</div>
						<div className="flex items-center shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
							<StandardTooltip content={isTaskExpanded ? t("chat:task.collapse") : t("chat:task.expand")}>
								<button
									onClick={() => setIsTaskExpanded(!isTaskExpanded)}
									className="shrink-0 min-h-[20px] min-w-[20px] p-[2px] cursor-pointer opacity-85 hover:opacity-100 bg-transparent border-none rounded-md">
									{isTaskExpanded ? (
										<ChevronUp size={16} />
									) : (
										<ChevronDown size={16} className="opacity-0 group-hover:opacity-100" />
									)}
								</button>
							</StandardTooltip>
						</div>
					</div>
				</div>
				{!isTaskExpanded && contextWindow > 0 && (
					<div
						className="flex items-center justify-between text-sm text-muted-foreground/70"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center gap-2 flex-wrap">
							<StandardTooltip
								content={(() => {
									const availableSpace = contextWindow - (contextTokens || 0) - reservedForOutput

									return (
										<Table className="text-base ml-1.5">
											<TableBody>
												<TableRow>
													<TableCell className="font-medium whitespace-nowrap">
														{t("chat:tokenProgress.tokensUsedLabel")}
													</TableCell>
													<TableCell className="text-right text-[0.9em] font-mono">
														{formatLargeNumber(contextTokens || 0)} /{" "}
														{formatLargeNumber(contextWindow)}
													</TableCell>
												</TableRow>
												{reservedForOutput > 0 && (
													<TableRow>
														<TableCell className="font-medium whitespace-nowrap">
															{t("chat:tokenProgress.reservedForResponseLabel")}
														</TableCell>
														<TableCell className="text-right text-[0.9em] font-mono">
															{formatLargeNumber(reservedForOutput)}
														</TableCell>
													</TableRow>
												)}
												{availableSpace > 0 && (
													<TableRow>
														<TableCell className="font-medium whitespace-nowrap">
															{t("chat:tokenProgress.availableSpaceLabel")}
														</TableCell>
														<TableCell className="text-right text-[0.9em] font-mono">
															{formatLargeNumber(availableSpace)}
														</TableCell>
													</TableRow>
												)}
											</TableBody>
										</Table>
									)
								})()}
								side="top"
								sideOffset={8}>
								<span className="flex items-center gap-1.5">
									{(() => {
										// Calculate percentage of available input space used
										// Available input space = context window - reserved for output
										const availableInputSpace = contextWindow - reservedForOutput
										const percentage =
											availableInputSpace > 0
												? Math.round(((contextTokens || 0) / availableInputSpace) * 100)
												: 0
										return (
											<>
												<CircularProgress percentage={percentage} />
												<span>{percentage}%</span>
											</>
										)
									})()}
								</span>
							</StandardTooltip>
							{shouldShowContextCacheStatus && (
								<>
									<span>·</span>
									<StandardTooltip content={contextCacheTooltip} side="top" sideOffset={8}>
										<span
											className="flex items-center gap-1.5"
											data-testid="context-cache-collapsed-status">
											<HardDriveDownload className="size-3" />
											<span>{contextCacheSummary}</span>
										</span>
									</StandardTooltip>
								</>
							)}
							{shouldShowCost && (
								<>
									<span>·</span>
									<StandardTooltip
										content={
											hasSubtasks ? (
												<div>
													<div>
														{t("chat:costs.totalWithSubtasks", {
															cost: displayCost.toFixed(2),
														})}
													</div>
													{costBreakdown && (
														<div className="text-xs mt-1">{costBreakdown}</div>
													)}
												</div>
											) : (
												<div>{t("chat:costs.total", { cost: displayCost.toFixed(2) })}</div>
											)
										}
										side="top"
										sideOffset={8}>
										<>
											<span>
												${displayCost.toFixed(2)}
												{hasSubtasks && (
													<span
														className="text-xs ml-1"
														title={t("chat:costs.includesSubtasks")}>
														*
													</span>
												)}
											</span>
										</>
									</StandardTooltip>
								</>
							)}
							{shouldShowTokenUsage && (
								<>
									<span>·</span>
									<span className="flex items-center gap-1">
										{typeof tokensIn === "number" && tokensIn > 0 && (
											<span>↑ {formatLargeNumber(tokensIn)}</span>
										)}
										{typeof tokensOut === "number" && tokensOut > 0 && (
											<span>↓ {formatLargeNumber(tokensOut)}</span>
										)}
									</span>
								</>
							)}
							{planUsage && (
								<>
									<span>·</span>
									<span className={`flex items-center gap-1 ${planUsage.colorClass}`}>
										<span data-testid="plan-usage-percent">{planUsage.percent}% plan used</span>
										{planUsage.remainingText && (
											<span
												className="text-muted-foreground/70"
												data-testid="plan-usage-remaining">
												· {planUsage.remainingText}
											</span>
										)}
										{planUsage.resetTime && (
											<span className="text-muted-foreground/70" data-testid="plan-usage-reset">
												· resets in {planUsage.resetTime}
											</span>
										)}
									</span>
								</>
							)}
						</div>
					</div>
				)}
				{/* Expanded state: Show task text and images */}
				{isTaskExpanded && (
					<>
						<div
							ref={textContainerRef}
							className="text-vscode-font-size overflow-y-auto break-words break-anywhere relative">
							<div
								ref={textRef}
								className="overflow-auto max-h-80 whitespace-pre-wrap break-words break-anywhere cursor-text py-0.5"
								style={{
									display: "-webkit-box",
									WebkitLineClamp: "unset",
									WebkitBoxOrient: "vertical",
								}}>
								<Mention text={task.text} />
							</div>
						</div>
						{task.images && task.images.length > 0 && <Thumbnails images={task.images} />}

						<div onClick={(e) => e.stopPropagation()}>
							<TaskActions item={currentTaskItem} buttonsDisabled={buttonsDisabled} />
						</div>

						<div className="pt-3 mt-2 -mx-2.5 px-2.5 border-t border-vscode-sideBar-background">
							<table className="w-full text-sm">
								<tbody>
									{contextWindow > 0 && (
										<tr>
											<th
												className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]"
												data-testid="context-window-label">
												{t("chat:task.contextWindow")}
											</th>
											<td className="font-light align-top">
												<div className={`max-w-md -mt-1.5 flex flex-nowrap gap-1`}>
													<ContextWindowProgress
														contextWindow={contextWindow}
														contextTokens={contextTokens || 0}
														maxTokens={maxTokens || undefined}
													/>
													{condenseButton}
												</div>
											</td>
										</tr>
									)}

									{shouldShowContextCacheStatus && (
										<tr data-testid="context-cache-status">
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
												{t("chat:task.contextCache.label")}
											</th>
											<td className="font-light align-top">
												<div className="flex flex-col gap-1">
													<div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
														<span>
															{t("chat:task.contextCache.hotCache")}:{" "}
															{formatLargeNumber(safeContextCacheStats.hotCacheChunks)} /{" "}
															{formatLargeNumber(safeContextCacheStats.hotCacheTokens)}{" "}
															{t("chat:contextManagement.tokens")}
														</span>
														<span data-testid="context-cache-cold-status">
															{t("chat:task.contextCache.coldCache")}:{" "}
															{formatLargeNumber(contextCacheColdChunks)} /{" "}
															{contextCacheColdRamDisplay}
														</span>
														<span>
															{t("chat:task.contextCache.swaps")}:{" "}
															{formatLargeNumber(safeContextCacheStats.swapsThisSession)}
														</span>
														<span>
															{t("chat:task.contextCache.condensingAvoided")}:{" "}
															{formatLargeNumber(safeContextCacheStats.condensingAvoided)}
														</span>
														{shouldShowCombinedContextCacheDiagnostics && (
															<>
																<span data-testid="context-cache-combined-status">
																	{t(
																		"chat:task.contextCache.diagnostics.combinedStatus",
																		{
																			used: formatContextCacheRamValue(
																				combinedContextCache?.ramUsedMb ??
																					safeContextCacheStats.ramUsedMb,
																			),
																			budget: formatContextCacheRamValue(
																				combinedContextCache?.ramBudgetMb ??
																					safeContextCacheStats.ramBudgetMb,
																			),
																		},
																	)}
																	{combinedContextCache &&
																	combinedContextCache.managerCount > 0
																		? ` · ${t("chat:task.contextCache.diagnostics.contributors", { count: combinedContextCache.managerCount })}`
																		: ""}
																</span>
																<span data-testid="context-cache-eviction-status">
																	{t(
																		"chat:task.contextCache.diagnostics.evictionsStatus",
																		{
																			value: formatContextCacheEvictions(
																				contextCacheEvictions?.hot,
																				contextCacheEvictions?.cold,
																				t,
																			),
																		},
																	)}
																</span>
															</>
														)}
													</div>
													{topContextCacheContributors.length > 0 && (
														<div
															className="flex flex-wrap gap-x-3 gap-y-1 text-xs"
															data-testid="context-cache-contributor-status">
															{topContextCacheContributors.map((contributor) => (
																<span key={contributor.id}>
																	{contributor.label}:{" "}
																	{formatContextCacheContributorUsage(
																		contributor.ramUsedMb,
																		contributor.hotCacheChunks,
																		contributor.coldCacheChunks,
																		t,
																	)}
																</span>
															))}
														</div>
													)}
													{contextCacheWarning && (
														<div
															className="text-vscode-inputValidation-warningForeground"
															data-testid="context-cache-status-warning">
															{contextCacheWarning}
														</div>
													)}
												</div>
											</td>
										</tr>
									)}

									<tr>
										<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
											{t("chat:task.tokens")}
										</th>
										<td className="font-light align-top">
											<div className="flex items-center gap-1 flex-wrap">
												{typeof tokensIn === "number" && tokensIn > 0 && (
													<span>↑ {formatLargeNumber(tokensIn)}</span>
												)}
												{typeof tokensOut === "number" && tokensOut > 0 && (
													<span>↓ {formatLargeNumber(tokensOut)}</span>
												)}
											</div>
										</td>
									</tr>

									{((typeof cacheReads === "number" && cacheReads > 0) ||
										(typeof cacheWrites === "number" && cacheWrites > 0)) && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
												{t("chat:task.cache")}
											</th>
											<td className="font-light align-top">
												<div className="flex items-center gap-1 flex-wrap">
													{typeof cacheWrites === "number" && cacheWrites > 0 && (
														<>
															<HardDriveDownload className="size-2.5" />
															<span>{formatLargeNumber(cacheWrites)}</span>
														</>
													)}
													{typeof cacheReads === "number" && cacheReads > 0 && (
														<>
															<HardDriveUpload className="size-2.5" />
															<span>{formatLargeNumber(cacheReads)}</span>
														</>
													)}
												</div>
											</td>
										</tr>
									)}

									{shouldShowCost && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
												{t("chat:task.apiCost")}
											</th>
											<td className="font-light align-top">
												<StandardTooltip
													content={
														hasSubtasks ? (
															<div>
																<div>
																	{t("chat:costs.totalWithSubtasks", {
																		cost: displayCost.toFixed(2),
																	})}
																</div>
																{costBreakdown && (
																	<div className="text-xs mt-1">{costBreakdown}</div>
																)}
															</div>
														) : (
															<div>
																{t("chat:costs.total", {
																	cost: displayCost.toFixed(2),
																})}
															</div>
														)
													}
													side="top"
													sideOffset={8}>
													<span>
														${displayCost.toFixed(2)}
														{hasSubtasks && (
															<span
																className="text-xs ml-1"
																title={t("chat:costs.includesSubtasks")}>
																*
															</span>
														)}
													</span>
												</StandardTooltip>
											</td>
										</tr>
									)}

									{/* Size display */}
									{!!currentTaskItem?.size && currentTaskItem.size > 0 && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-2 h-[20px]">
												{t("chat:task.size")}
											</th>
											<td className="font-light align-top">
												{prettyBytes(currentTaskItem.size)}
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</>
				)}
				{/* Todo list - always shown at bottom when todos exist */}
				{hasTodos && <TodoListDisplay todos={todos ?? (task as any)?.tool?.todos ?? []} />}
			</div>
		</div>
	)
}

export default memo(TaskHeader)

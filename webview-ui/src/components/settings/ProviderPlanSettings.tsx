import { useEffect, useMemo, useState } from "react"

import type { ProviderSettings } from "@roo-code/types"

import type { ExtensionStateContextType } from "@src/context/ExtensionStateContext"
import {
	Button,
	Input,
	SearchableSelect,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@src/components/ui"

import { SearchableSetting } from "./SearchableSetting"
import { PROVIDERS } from "./constants"
import type { SetCachedStateField } from "./types"

type ProviderPlanLimits = NonNullable<ExtensionStateContextType["providerPlanLimits"]>
type ProviderPlanUsage = NonNullable<ExtensionStateContextType["providerPlanUsage"]>
type ProviderPlanResetPeriod = NonNullable<ProviderPlanLimits[string]>["resetPeriod"]

type ProviderPlanSettingsProps = {
	apiConfiguration: ProviderSettings
	providerPlanLimits: ProviderPlanLimits
	providerPlanUsage: ProviderPlanUsage
	setCachedStateField: SetCachedStateField<keyof ExtensionStateContextType>
}

const RESET_PERIOD_OPTIONS: Array<{ value: ProviderPlanResetPeriod; label: string }> = [
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
]

const DEFAULT_RESET_PERIOD: ProviderPlanResetPeriod = "monthly"

const providerOptions = PROVIDERS.map((provider) => ({
	value: provider.value,
	label: provider.label,
}))

const formatNumber = (value: number | undefined) =>
	Number.isFinite(value) ? Math.round(value ?? 0).toLocaleString() : "0"

const formatCost = (value: number | undefined) => (Number.isFinite(value) ? `$${(value ?? 0).toFixed(2)}` : "$0.00")

const parseOptionalNumber = (value: string): number | undefined => {
	const trimmed = value.trim()

	if (!trimmed) {
		return undefined
	}

	const parsed = Number(trimmed)

	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export const ProviderPlanSettings = ({
	apiConfiguration,
	providerPlanLimits,
	providerPlanUsage,
	setCachedStateField,
}: ProviderPlanSettingsProps) => {
	const currentProvider = apiConfiguration.apiProvider ?? "openrouter"
	const [selectedProvider, setSelectedProvider] = useState<string>(currentProvider)

	useEffect(() => {
		setSelectedProvider(currentProvider)
	}, [currentProvider])

	const selectedLimit = providerPlanLimits[selectedProvider]
	const selectedUsage = providerPlanUsage[selectedProvider]
	const resetPeriod = selectedLimit?.resetPeriod ?? DEFAULT_RESET_PERIOD
	const tokenLimit = selectedLimit?.tokenLimit
	const costLimit = selectedLimit?.costLimit
	const tokensUsed = selectedUsage?.tokensUsed ?? 0
	const costUsed = selectedUsage?.costUsed ?? 0

	const usagePercent = useMemo(() => {
		const tokenPercent = tokenLimit && tokenLimit > 0 ? (tokensUsed / tokenLimit) * 100 : 0
		const costPercent = costLimit && costLimit > 0 ? (costUsed / costLimit) * 100 : 0

		return Math.round(Math.max(tokenPercent, costPercent))
	}, [costLimit, costUsed, tokenLimit, tokensUsed])

	const updateLimit = (updates: Partial<ProviderPlanLimits[string]>) => {
		setCachedStateField("providerPlanLimits", {
			...providerPlanLimits,
			[selectedProvider]: {
				...selectedLimit,
				resetPeriod,
				...updates,
			},
		})
	}

	const resetUsage = () => {
		const now = Date.now()
		setCachedStateField("providerPlanUsage", {
			...providerPlanUsage,
			[selectedProvider]: {
				tokensUsed: 0,
				costUsed: 0,
				periodStart: now,
			},
		})
		setCachedStateField("providerPlanLimits", {
			...providerPlanLimits,
			[selectedProvider]: {
				...selectedLimit,
				resetPeriod,
				lastReset: now,
			},
		})
	}

	return (
		<SearchableSetting settingId="provider-plan-usage" section="providers" label="Plan usage tracking">
			<div className="flex flex-col gap-3 rounded-md border border-vscode-input-border p-3">
				<div>
					<h4 className="m-0 text-sm font-medium">Plan usage tracking</h4>
					<p className="m-0 mt-1 text-sm text-vscode-descriptionForeground">
						Configure optional token or cost limits for each provider. Usage is tracked cumulatively per
						provider and resets automatically by period.
					</p>
				</div>

				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Provider</span>
						<SearchableSelect
							value={selectedProvider}
							onValueChange={setSelectedProvider}
							options={providerOptions}
							placeholder="Select provider"
							searchPlaceholder="Search providers"
							emptyMessage="No provider found"
							className="w-full"
						/>
					</label>

					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Reset period</span>
						<Select
							value={resetPeriod}
							onValueChange={(value) => updateLimit({ resetPeriod: value as ProviderPlanResetPeriod })}>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{RESET_PERIOD_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</label>

					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Token limit</span>
						<Input
							type="number"
							min={0}
							value={tokenLimit ?? ""}
							onChange={(event) => updateLimit({ tokenLimit: parseOptionalNumber(event.target.value) })}
							placeholder="Monthly tokens"
						/>
					</label>

					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium">Cost limit (USD)</span>
						<Input
							type="number"
							min={0}
							step="0.01"
							value={costLimit ?? ""}
							onChange={(event) => updateLimit({ costLimit: parseOptionalNumber(event.target.value) })}
							placeholder="Monthly cost"
						/>
					</label>
				</div>

				<div className="flex flex-col gap-2 rounded bg-vscode-input-background p-2 text-sm text-vscode-descriptionForeground">
					<div className="flex flex-wrap gap-x-4 gap-y-1">
						<span>Tokens used: {formatNumber(tokensUsed)}</span>
						<span>Cost used: {formatCost(costUsed)}</span>
						{(tokenLimit || costLimit) && <span>{usagePercent}% plan used</span>}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button type="button" variant="secondary" onClick={resetUsage} className="w-fit">
							Reset usage for selected provider
						</Button>
						<span>Changes are saved when you click Save.</span>
					</div>
				</div>
			</div>
		</SearchableSetting>
	)
}

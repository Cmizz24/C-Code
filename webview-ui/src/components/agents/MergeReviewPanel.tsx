import { useMemo, useState } from "react"
import type { MergeReviewEntry } from "@roo-code/types"

import DiffView from "@/components/common/DiffView"
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"

import { getAgentModeLabel } from "./agentDisplay"
import { formatMergeReviewStatsLabel, getMergeReviewChangeStats, hasMergeReviewDiff } from "./mergeReviewDisplay"

interface MergeReviewPanelProps {
	entries: MergeReviewEntry[]
	failedAgentId?: string
	gitOutput?: string
	onClose: () => void
}

export const MergeReviewPanel = ({ entries, failedAgentId, gitOutput, onClose }: MergeReviewPanelProps) => {
	const { t } = useAppTranslation()
	const { customModes } = useExtensionState()
	const [approvedAgentIds, setApprovedAgentIds] = useState<Set<string>>(() => new Set())
	const [expandedDiffAgentIds, setExpandedDiffAgentIds] = useState<Set<string>>(() => new Set())

	const approvedIds = useMemo(() => [...approvedAgentIds], [approvedAgentIds])

	const toggleDiff = (agentId: string) => {
		setExpandedDiffAgentIds((current) => {
			const next = new Set(current)
			if (next.has(agentId)) {
				next.delete(agentId)
			} else {
				next.add(agentId)
			}
			return next
		})
	}

	const toggleApproval = (agentId: string) => {
		setApprovedAgentIds((current) => {
			const next = new Set(current)
			if (next.has(agentId)) {
				next.delete(agentId)
			} else {
				next.add(agentId)
			}
			return next
		})
	}

	const discardAgent = (agentId: string) => {
		setApprovedAgentIds((current) => {
			const next = new Set(current)
			next.delete(agentId)
			return next
		})
	}

	const mergeApproved = () => {
		vscode.postMessage({ type: "mergeApprovedAgents", ids: approvedIds })
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[92vh] max-w-[min(1100px,96vw)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{t("chat:parallelAgents.mergeReview.title")}</DialogTitle>
					<DialogDescription>{t("chat:parallelAgents.mergeReview.description")}</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{entries.map((entry) => {
						const approved = approvedAgentIds.has(entry.agentId)
						const failed = failedAgentId === entry.agentId
						const agentLabel = getAgentModeLabel(entry.mode, customModes)
						const stats = getMergeReviewChangeStats(entry)
						const statsLabel = formatMergeReviewStatsLabel(stats, t)
						const hasDiff = hasMergeReviewDiff(entry)
						const isDiffExpanded = expandedDiffAgentIds.has(entry.agentId)
						const canApprove = entry.mergeable !== false

						return (
							<section
								key={entry.agentId}
								className={cn(
									"rounded-md border bg-vscode-sideBar-background p-3",
									failed ? "border-vscode-errorForeground" : "border-vscode-panel-border",
								)}>
								<div className="mb-3 flex flex-wrap items-start justify-between gap-3">
									<div>
										<h3 className="text-sm font-semibold text-vscode-foreground">{agentLabel}</h3>
										<div className="mt-1 text-xs text-vscode-descriptionForeground">
											{entry.task}
										</div>
										<div className="mt-1 grid gap-1 font-mono text-[11px] text-vscode-descriptionForeground">
											<span title="Agent ID">{entry.agentId}</span>
											<span>{entry.branch}</span>
											<span>{entry.worktreePath}</span>
										</div>
										<div
											data-testid={`merge-review-stats-${entry.agentId}`}
											className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-vscode-descriptionForeground"
											aria-label={statsLabel}>
											<span className="rounded bg-vscode-editor-background px-2 py-0.5">
												{t("chat:parallelAgents.mergeReview.stats.files", {
													count: stats.filesChanged,
												})}
											</span>
											<span className="rounded bg-vscode-editor-background px-2 py-0.5">
												{t("chat:parallelAgents.mergeReview.stats.lines", {
													count: stats.totalChanges,
												})}
											</span>
											<span className="font-mono font-medium text-vscode-charts-green">
												+{stats.additions}
											</span>
											<span className="font-mono font-medium text-vscode-charts-red">
												-{stats.deletions}
											</span>
											{stats.binaryFiles > 0 && (
												<span>
													{t("chat:parallelAgents.mergeReview.stats.binaryFiles", {
														count: stats.binaryFiles,
													})}
												</span>
											)}
										</div>
									</div>
									<div className="flex flex-wrap gap-2">
										<Button
											variant={approved ? "primary" : "secondary"}
											size="sm"
											disabled={!canApprove}
											onClick={() => toggleApproval(entry.agentId)}>
											{approved
												? t("chat:parallelAgents.mergeReview.approved")
												: t("chat:parallelAgents.mergeReview.approveAndMerge")}
										</Button>
										<Button
											variant="destructive"
											size="sm"
											onClick={() => discardAgent(entry.agentId)}>
											{t("chat:parallelAgents.mergeReview.discard")}
										</Button>
									</div>
								</div>

								{failed && gitOutput && (
									<pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-vscode-errorForeground/60 bg-vscode-errorForeground/10 p-2 text-xs text-vscode-errorForeground">
										{gitOutput}
									</pre>
								)}

								{entry.reviewError ? (
									<pre className="rounded border border-vscode-errorForeground/60 bg-vscode-errorForeground/10 p-3 text-xs text-vscode-errorForeground whitespace-pre-wrap">
										{entry.reviewError}
									</pre>
								) : hasDiff ? (
									<div className="rounded border border-vscode-panel-border bg-vscode-editor-background/60">
										<button
											type="button"
											data-testid={`merge-review-diff-toggle-${entry.agentId}`}
											aria-expanded={isDiffExpanded}
											onClick={() => toggleDiff(entry.agentId)}
											className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-vscode-foreground hover:bg-vscode-list-hoverBackground/40 focus:outline-none focus:ring-1 focus:ring-vscode-focusBorder">
											<span
												className={cn(
													"codicon shrink-0 text-xs text-vscode-descriptionForeground",
													isDiffExpanded ? "codicon-chevron-up" : "codicon-chevron-down",
												)}
											/>
											<span>
												{isDiffExpanded
													? t("chat:parallelAgents.mergeReview.hideDiff")
													: t("chat:parallelAgents.mergeReview.showDiff")}
											</span>
											<span className="ml-auto truncate font-normal text-vscode-descriptionForeground">
												{statsLabel}
											</span>
										</button>
										{isDiffExpanded && (
											<div
												data-testid={`merge-review-diff-${entry.agentId}`}
												className="border-t border-vscode-panel-border">
												<DiffView source={entry.diff} />
											</div>
										)}
									</div>
								) : (
									<pre className="rounded bg-vscode-editor-background p-3 text-xs text-vscode-descriptionForeground">
										{entry.noChangesReason ?? t("chat:parallelAgents.mergeReview.noChanges")}
									</pre>
								)}
							</section>
						)
					})}
				</div>

				<DialogFooter>
					<Button variant="secondary" onClick={onClose}>
						{t("chat:parallelAgents.mergeReview.close")}
					</Button>
					<Button variant="primary" disabled={approvedIds.length === 0} onClick={mergeApproved}>
						{t("chat:parallelAgents.mergeReview.mergeAllApproved")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

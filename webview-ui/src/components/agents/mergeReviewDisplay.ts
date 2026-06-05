import { computeMergeReviewChangeStats, type MergeReviewChangeStats, type MergeReviewEntry } from "@roo-code/types"

import type { useAppTranslation } from "@src/i18n/TranslationContext"

type TranslationFn = ReturnType<typeof useAppTranslation>["t"]

export const getMergeReviewChangeStats = (entry: MergeReviewEntry): MergeReviewChangeStats =>
	entry.changeStats ?? computeMergeReviewChangeStats(entry.diff)

export const hasMergeReviewDiff = (entry: MergeReviewEntry): boolean => Boolean(entry.diff.trim()) && !entry.reviewError

export const getMergeReviewEntryStatus = (entry: MergeReviewEntry): NonNullable<MergeReviewEntry["mergeStatus"]> =>
	entry.mergeStatus ?? (entry.reviewError || entry.mergeError ? "failed" : "pending")

export const isMergeReviewEntrySelectable = (entry: MergeReviewEntry): boolean => {
	const status = getMergeReviewEntryStatus(entry)
	return (
		entry.mergeable !== false &&
		!entry.reviewError &&
		!entry.mergeError &&
		status !== "failed" &&
		status !== "merged"
	)
}

export const getSelectableMergeReviewAgentIds = (entries: MergeReviewEntry[] = []): string[] =>
	entries.filter(isMergeReviewEntrySelectable).map((entry) => entry.agentId)

export const formatMergeReviewStatsLabel = (stats: MergeReviewChangeStats, t: TranslationFn): string => {
	const parts = [
		t("chat:parallelAgents.mergeReview.stats.files", { count: stats.filesChanged }),
		t("chat:parallelAgents.mergeReview.stats.lines", { count: stats.totalChanges }),
		`+${stats.additions}`,
		`-${stats.deletions}`,
	]

	if (stats.binaryFiles > 0) {
		parts.push(t("chat:parallelAgents.mergeReview.stats.binaryFiles", { count: stats.binaryFiles }))
	}

	return parts.join(" · ")
}

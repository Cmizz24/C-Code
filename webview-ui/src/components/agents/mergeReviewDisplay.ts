import { computeMergeReviewChangeStats, type MergeReviewChangeStats, type MergeReviewEntry } from "@roo-code/types"

import type { useAppTranslation } from "@/i18n/TranslationContext"

type TranslationFn = ReturnType<typeof useAppTranslation>["t"]

export const getMergeReviewChangeStats = (entry: MergeReviewEntry): MergeReviewChangeStats =>
	entry.changeStats ?? computeMergeReviewChangeStats(entry.diff)

export const hasMergeReviewDiff = (entry: MergeReviewEntry): boolean => Boolean(entry.diff.trim()) && !entry.reviewError

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

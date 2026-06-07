import type {
	LocalAiHardwareProbe,
	LocalAiModelCatalogItem,
	LocalAiQuestionnaire,
	LocalAiRecommendation,
	LocalAiRecommendationRequest,
} from "@roo-code/types"

const TIER_SCORE: Record<LocalAiModelCatalogItem["tier"], number> = {
	tiny: 0,
	small: 1,
	standard: 2,
	large: 3,
	xl: 4,
}

export const LOCAL_AI_MODEL_CATALOG: LocalAiModelCatalogItem[] = [
	{
		provider: "ollama",
		tag: "qwen2.5-coder:0.5b",
		displayName: "Qwen2.5 Coder 0.5B",
		description: "Very small coder model for quick local smoke tests and lightweight code help.",
		approximateSizeGb: 0.4,
		minimumRamGb: 4,
		recommendedRamGb: 6,
		tier: "tiny",
		defaultNumCtx: 4096,
	},
	{
		provider: "ollama",
		tag: "qwen2.5-coder:1.5b",
		displayName: "Qwen2.5 Coder 1.5B",
		description: "Fast local coder model for low-memory machines and short code edits.",
		approximateSizeGb: 1.1,
		minimumRamGb: 4,
		recommendedRamGb: 8,
		tier: "tiny",
		defaultNumCtx: 4096,
	},
	{
		provider: "ollama",
		tag: "qwen2.5-coder:3b",
		displayName: "Qwen2.5 Coder 3B",
		description: "Small balanced coder model for everyday local assistance.",
		approximateSizeGb: 2,
		minimumRamGb: 8,
		recommendedRamGb: 12,
		tier: "small",
		defaultNumCtx: 8192,
	},
	{
		provider: "ollama",
		tag: "qwen2.5-coder:7b",
		displayName: "Qwen2.5 Coder 7B",
		description: "Standard local coder model for daily coding with stronger reasoning than smaller tiers.",
		approximateSizeGb: 4.7,
		minimumRamGb: 12,
		recommendedRamGb: 16,
		tier: "standard",
		defaultNumCtx: 8192,
	},
	{
		provider: "ollama",
		tag: "qwen2.5-coder:14b",
		displayName: "Qwen2.5 Coder 14B",
		description: "Higher-quality local coder model for larger refactors on machines with more memory.",
		approximateSizeGb: 9,
		minimumRamGb: 24,
		recommendedRamGb: 32,
		tier: "large",
		defaultNumCtx: 8192,
		requiresExplicitQualityIntent: true,
	},
	{
		provider: "ollama",
		tag: "qwen2.5-coder:32b",
		displayName: "Qwen2.5 Coder 32B",
		description: "Large local coder model for quality-focused agentic work on high-memory machines.",
		approximateSizeGb: 20,
		minimumRamGb: 48,
		recommendedRamGb: 64,
		tier: "xl",
		defaultNumCtx: 8192,
		requiresExplicitQualityIntent: true,
	},
]

const getRamTierScore = (ramGb: number) => {
	if (ramGb >= 64) {
		return TIER_SCORE.xl
	}

	if (ramGb >= 32) {
		return TIER_SCORE.large
	}

	if (ramGb >= 16) {
		return TIER_SCORE.standard
	}

	if (ramGb >= 8) {
		return TIER_SCORE.small
	}

	return TIER_SCORE.tiny
}

const getQuestionnaireTargetScore = (questionnaire: LocalAiQuestionnaire) => {
	const usageScore = {
		light: TIER_SCORE.small,
		daily: TIER_SCORE.standard,
		agentic: TIER_SCORE.large,
	}[questionnaire.usageProfile]

	const preferenceAdjustment = {
		speed: -1,
		balanced: 0,
		quality: 1,
	}[questionnaire.preference]

	return Math.max(TIER_SCORE.tiny, Math.min(TIER_SCORE.xl, usageScore + preferenceAdjustment))
}

const hasExplicitLargeModelIntent = (questionnaire: LocalAiQuestionnaire) =>
	questionnaire.usageProfile === "agentic" || questionnaire.preference === "quality"

const getDiskLimitGb = (probe: LocalAiHardwareProbe, questionnaire: LocalAiQuestionnaire) => {
	const configuredBudget = Math.max(0, questionnaire.diskBudgetGb)

	if (probe.disk.status !== "known" || probe.disk.freeGb === undefined) {
		return configuredBudget
	}

	// Keep a small safety margin so the recommendation does not consume the last free gigabytes.
	return Math.max(0, Math.min(configuredBudget, probe.disk.freeGb - 2))
}

export function recommendLocalAiModel(
	request: LocalAiRecommendationRequest,
	catalog: LocalAiModelCatalogItem[] = LOCAL_AI_MODEL_CATALOG,
): LocalAiRecommendation {
	const { probe, questionnaire } = request
	const reasons: string[] = []
	const warnings: string[] = []
	const ramGb = probe.memory.totalGb
	const diskLimitGb = getDiskLimitGb(probe, questionnaire)
	const ramScore = getRamTierScore(ramGb)
	let targetScore = Math.min(ramScore, getQuestionnaireTargetScore(questionnaire))

	if (!hasExplicitLargeModelIntent(questionnaire)) {
		targetScore = Math.min(targetScore, TIER_SCORE.standard)
	}

	if (probe.gpu.status === "unknown" && targetScore > TIER_SCORE.large) {
		targetScore = TIER_SCORE.large
		warnings.push("GPU details are unknown, so the recommendation avoids the largest model tier.")
	}

	if (probe.disk.status === "unknown") {
		warnings.push("Free disk space could not be detected; the recommendation uses only your disk budget.")
	}

	if (questionnaire.providerPreference === "lmstudio" && probe.runtimes.lmStudio.status === "running") {
		warnings.push("LM Studio is reachable, but guided first-run model downloads currently use Ollama.")
	}

	const candidates = catalog
		.filter((model) => TIER_SCORE[model.tier] <= targetScore)
		.filter((model) => model.minimumRamGb <= ramGb)
		.filter((model) => model.approximateSizeGb <= questionnaire.diskBudgetGb)
		.filter((model) => model.approximateSizeGb <= diskLimitGb)
		.filter((model) => !model.requiresExplicitQualityIntent || hasExplicitLargeModelIntent(questionnaire))
		.sort((a, b) => {
			const scoreDelta = TIER_SCORE[b.tier] - TIER_SCORE[a.tier]
			return scoreDelta !== 0 ? scoreDelta : b.approximateSizeGb - a.approximateSizeGb
		})

	const fallbackCandidates = catalog
		.filter((model) => model.approximateSizeGb <= questionnaire.diskBudgetGb)
		.filter((model) => model.approximateSizeGb <= diskLimitGb)
		.sort((a, b) => a.approximateSizeGb - b.approximateSizeGb)

	const model = candidates[0] ?? fallbackCandidates[0] ?? catalog[0]

	if (model.approximateSizeGb > questionnaire.diskBudgetGb) {
		warnings.push("Your disk budget is below the smallest catalog model; increase it before downloading.")
	}

	if (probe.disk.freeGb !== undefined && model.approximateSizeGb > probe.disk.freeGb) {
		warnings.push("Detected free disk space is below the approximate model size.")
	}

	if (model.minimumRamGb > ramGb) {
		warnings.push("This model may be too large for the detected system memory.")
	}

	reasons.push(`Detected about ${ramGb} GB RAM and ${probe.cpu.count} CPU cores.`)
	reasons.push(`Selected for ${questionnaire.usageProfile} usage with a ${questionnaire.preference} preference.`)
	reasons.push(
		`Approximate model download size is ${model.approximateSizeGb} GB within a ${questionnaire.diskBudgetGb} GB budget.`,
	)

	if (probe.gpu.status === "detected") {
		reasons.push(`Detected GPU: ${probe.gpu.names.join(", ")}.`)
	}

	const diskKnown = probe.disk.status === "known" && probe.disk.freeGb !== undefined
	const runtimeReady = probe.runtimes.ollama.status === "running"
	const enoughRecommendedRam = ramGb >= model.recommendedRamGb
	const confidence: LocalAiRecommendation["confidence"] =
		enoughRecommendedRam && diskKnown && runtimeReady ? "high" : enoughRecommendedRam ? "medium" : "low"

	return {
		provider: "ollama",
		runtimeDisplayName: "Ollama",
		baseUrl: probe.runtimes.ollama.baseUrl || "http://localhost:11434",
		model,
		ollamaNumCtx: confidence === "high" ? model.defaultNumCtx : undefined,
		confidence,
		reasons,
		warnings,
		freeDiskGb: probe.disk.freeGb,
		diskBudgetGb: questionnaire.diskBudgetGb,
		privacyNote: "Inference runs locally once Ollama and the selected model are installed.",
	}
}

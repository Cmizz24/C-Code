import type {
	LocalAiHardwareProbe,
	LocalAiModelCatalogItem,
	LocalAiQuestionnaire,
	LocalAiRecommendation,
	LocalAiRecommendationRequest,
} from "@roo-code/types"

import { LM_STUDIO_DEFAULT_BASE_URL, OLLAMA_DEFAULT_BASE_URL } from "./hardware"

const TIER_SCORE: Record<LocalAiModelCatalogItem["tier"], number> = {
	tiny: 0,
	small: 1,
	standard: 2,
	large: 3,
	xl: 4,
}

const PRACTICAL_LOCAL_CODING_RAM_GB = 12
const LOW_RAM_WITH_WEAK_GPU_GB = 16
const VERY_LOW_FREE_DISK_GB = 6

const LM_STUDIO_MANUAL_MODEL_TAG = "LM Studio model"

const WEAK_GPU_PATTERNS = [
	/\bintel(?:\(r\))?\s+(?:uhd|hd|iris)\b/i,
	/\buhd graphics\b/i,
	/\bhd graphics\b/i,
	/\biris(?:\(r\))?\s*(?:xe|plus|graphics)?\b/i,
	/\bintegrated\b/i,
	/\bmicrosoft basic (?:display|render)/i,
	/\bsoftware rasterizer\b/i,
	/\bllvmpipe\b/i,
]

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

const hasWeakOrIntegratedGpu = (probe: LocalAiHardwareProbe) => {
	if (probe.gpu.status === "unknown") {
		return true
	}

	return probe.gpu.names.some((name) => WEAK_GPU_PATTERNS.some((pattern) => pattern.test(name)))
}

const getWeakHardwareWarnings = (probe: LocalAiHardwareProbe) => {
	const warnings: string[] = []
	const ramGb = probe.memory.totalGb
	const weakOrUnknownGpu = hasWeakOrIntegratedGpu(probe)

	if (ramGb < PRACTICAL_LOCAL_CODING_RAM_GB) {
		warnings.push(
			`Detected memory is below the practical ${PRACTICAL_LOCAL_CODING_RAM_GB} GB threshold for useful local coding models.`,
		)
	}

	if (
		probe.disk.status === "known" &&
		typeof probe.disk.freeGb === "number" &&
		probe.disk.freeGb < VERY_LOW_FREE_DISK_GB
	) {
		warnings.push("Detected free disk space is very low for local model downloads.")
	}

	if (ramGb < LOW_RAM_WITH_WEAK_GPU_GB && weakOrUnknownGpu) {
		warnings.push(
			probe.gpu.status === "unknown"
				? "GPU details are unknown and system memory is limited, so local coding models may run slowly."
				: "Detected an integrated or entry-level GPU with limited system memory, so local coding models may run slowly.",
		)
	}

	return warnings
}

const getDiskLimitGb = (probe: LocalAiHardwareProbe, questionnaire: LocalAiQuestionnaire) => {
	const configuredBudget = Math.max(0, questionnaire.diskBudgetGb)

	if (probe.disk.status !== "known" || probe.disk.freeGb === undefined) {
		return configuredBudget
	}

	// Keep a small safety margin so the recommendation does not consume the last free gigabytes.
	return Math.max(0, Math.min(configuredBudget, probe.disk.freeGb - 2))
}

const getLmStudioModelIds = (probe: LocalAiHardwareProbe) => probe.runtimes.lmStudio.models?.filter(Boolean) ?? []

const hasUsableLmStudioModels = (probe: LocalAiHardwareProbe) =>
	probe.runtimes.lmStudio.status === "running" && getLmStudioModelIds(probe).length > 0

const buildLmStudioModelItem = (modelId: string): LocalAiModelCatalogItem => ({
	provider: "lmstudio",
	tag: modelId,
	displayName: modelId,
	description: "Existing LM Studio model available through the local server.",
	approximateSizeGb: 0,
	minimumRamGb: 0,
	recommendedRamGb: 0,
	tier: "standard",
})

const selectLmStudioModelId = (probe: LocalAiHardwareProbe, questionnaire: LocalAiQuestionnaire) => {
	const models = getLmStudioModelIds(probe)
	return questionnaire.selectedModel && models.includes(questionnaire.selectedModel)
		? questionnaire.selectedModel
		: models[0]
}

const buildLmStudioRecommendation = (
	probe: LocalAiHardwareProbe,
	questionnaire: LocalAiQuestionnaire,
): LocalAiRecommendation => {
	const runtime = probe.runtimes.lmStudio
	const modelId = selectLmStudioModelId(probe, questionnaire)
	const warnings: string[] = []
	const reasons: string[] = []

	if (modelId) {
		reasons.push("LM Studio is reachable through its local OpenAI-compatible server.")
		reasons.push(`Selected existing LM Studio model: ${modelId}.`)

		return {
			provider: "lmstudio",
			recommendedSetup: "existing",
			runtimeDisplayName: "LM Studio",
			baseUrl: runtime.baseUrl || LM_STUDIO_DEFAULT_BASE_URL,
			model: buildLmStudioModelItem(modelId),
			confidence: "high",
			reasons,
			hasWeakHardwareWarning: false,
			warnings,
			freeDiskGb: probe.disk.freeGb,
			diskBudgetGb: questionnaire.diskBudgetGb,
			privacyNote: "Inference runs locally through LM Studio's local server with your selected model.",
		}
	}

	if (runtime.status === "running") {
		warnings.push(
			"LM Studio is running, but no usable models were reported. Download or load a chat model in LM Studio, then refresh this check.",
		)
	} else if (runtime.status === "installed-not-running") {
		warnings.push(
			"LM Studio appears to be installed, but the local server is not running. Start the LM Studio local server, then refresh this check.",
		)
	} else if (runtime.status === "detection-failed") {
		warnings.push(`LM Studio detection failed: ${runtime.error ?? "unknown error"}`)
	} else {
		warnings.push(
			"LM Studio is not installed or its local server is not reachable. Download LM Studio, install a model, start the local server, then refresh this check.",
		)
	}

	reasons.push(
		"LM Studio model downloads are managed inside LM Studio, so C Code will not run installers or download models silently.",
	)

	return {
		provider: "lmstudio",
		recommendedSetup: "manual",
		runtimeDisplayName: "LM Studio",
		baseUrl: runtime.baseUrl || LM_STUDIO_DEFAULT_BASE_URL,
		model: buildLmStudioModelItem(questionnaire.selectedModel || LM_STUDIO_MANUAL_MODEL_TAG),
		confidence: "low",
		reasons,
		hasWeakHardwareWarning: false,
		warnings,
		freeDiskGb: probe.disk.freeGb,
		diskBudgetGb: questionnaire.diskBudgetGb,
		privacyNote: "Inference stays local once LM Studio is installed, the server is running, and a model is loaded.",
	}
}

export function recommendLocalAiModel(
	request: LocalAiRecommendationRequest,
	catalog: LocalAiModelCatalogItem[] = LOCAL_AI_MODEL_CATALOG,
): LocalAiRecommendation {
	const { probe, questionnaire } = request
	const wantsLmStudio = questionnaire.runtimeChoice === "lmstudio" || questionnaire.providerPreference === "lmstudio"
	const wantsExistingRuntime = questionnaire.runtimeChoice === "existing"

	if (wantsLmStudio || (wantsExistingRuntime && hasUsableLmStudioModels(probe))) {
		return buildLmStudioRecommendation(probe, questionnaire)
	}

	const reasons: string[] = []
	const warnings: string[] = []
	const ramGb = probe.memory.totalGb
	const diskLimitGb = getDiskLimitGb(probe, questionnaire)
	const ramScore = getRamTierScore(ramGb)
	const weakHardwareWarnings = getWeakHardwareWarnings(probe)
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

	const candidates = catalog
		.filter((model) => model.provider === "ollama")
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
		.filter((model) => model.provider === "ollama")
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
	const hasWeakHardwareWarning = weakHardwareWarnings.length > 0
	const confidence: LocalAiRecommendation["confidence"] =
		enoughRecommendedRam && diskKnown && runtimeReady ? "high" : enoughRecommendedRam ? "medium" : "low"

	return {
		provider: "ollama",
		recommendedSetup: "local",
		runtimeDisplayName: "Ollama",
		baseUrl: probe.runtimes.ollama.baseUrl || OLLAMA_DEFAULT_BASE_URL,
		model,
		ollamaNumCtx: confidence === "high" ? model.defaultNumCtx : undefined,
		confidence,
		reasons,
		hasWeakHardwareWarning,
		warnings,
		freeDiskGb: probe.disk.freeGb,
		diskBudgetGb: questionnaire.diskBudgetGb,
		privacyNote: "Inference runs locally once Ollama and the selected model are installed.",
	}
}

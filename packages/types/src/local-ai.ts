import type { ProviderSettings } from "./provider-settings.js"

export type LocalAiUsageProfile = "light" | "daily" | "agentic"

export type LocalAiPreference = "speed" | "balanced" | "quality"

export type LocalAiPrivacyPreference = "local-only" | "local-preferred"

export type LocalAiRuntimeChoice = "existing" | "ollama" | "manual"

export type LocalAiProviderPreference = "ollama" | "lmstudio"

export interface LocalAiQuestionnaire {
	usageProfile: LocalAiUsageProfile
	preference: LocalAiPreference
	privacy: LocalAiPrivacyPreference
	diskBudgetGb: number
	runtimeChoice: LocalAiRuntimeChoice
	providerPreference?: LocalAiProviderPreference
}

export interface LocalAiCpuInfo {
	model?: string
	count: number
}

export interface LocalAiMemoryInfo {
	totalBytes: number
	totalGb: number
}

export interface LocalAiDiskInfo {
	freeBytes?: number
	freeGb?: number
	path?: string
	status: "known" | "unknown"
}

export interface LocalAiGpuInfo {
	status: "detected" | "unknown"
	names: string[]
	source?: string
}

export interface LocalAiRuntimeStatus {
	provider: LocalAiProviderPreference
	displayName: string
	baseUrl: string
	status: "running" | "installed-not-running" | "missing" | "unknown"
	version?: string
	models?: string[]
	error?: string
}

export interface LocalAiHardwareProbe {
	os: string
	arch: string
	cpu: LocalAiCpuInfo
	memory: LocalAiMemoryInfo
	disk: LocalAiDiskInfo
	gpu: LocalAiGpuInfo
	runtimes: {
		ollama: LocalAiRuntimeStatus
		lmStudio: LocalAiRuntimeStatus
	}
	probedAt: string
}

export interface LocalAiModelCatalogItem {
	provider: "ollama"
	tag: string
	displayName: string
	description: string
	approximateSizeGb: number
	minimumRamGb: number
	recommendedRamGb: number
	tier: "tiny" | "small" | "standard" | "large" | "xl"
	defaultNumCtx?: number
	requiresExplicitQualityIntent?: boolean
}

export interface LocalAiRecommendationRequest {
	probe: LocalAiHardwareProbe
	questionnaire: LocalAiQuestionnaire
}

export interface LocalAiRecommendation {
	provider: "ollama"
	recommendedSetup?: "local" | "api-provider"
	runtimeDisplayName: string
	baseUrl: string
	model: LocalAiModelCatalogItem
	ollamaNumCtx?: number
	confidence: "low" | "medium" | "high"
	reasons: string[]
	warnings: string[]
	freeDiskGb?: number
	diskBudgetGb: number
	privacyNote: string
}

export interface LocalAiSetupStartRequest {
	recommendation: LocalAiRecommendation
	questionnaire: LocalAiQuestionnaire
}

export interface LocalAiSetupProgress {
	stage: "runtime" | "download" | "verify" | "configure" | "success" | "error" | "cancelled"
	message: string
	status?: string
	completedBytes?: number
	totalBytes?: number
	percent?: number
	modelTag?: string
	installUrl?: string
	error?: string
}

export interface LocalAiSetupResult {
	success: boolean
	providerSettings?: ProviderSettings
	profileName?: string
	modelTag?: string
	error?: string
	installUrl?: string
}

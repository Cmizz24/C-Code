import type { LocalAiHardwareProbe, LocalAiQuestionnaire } from "@roo-code/types"

import { recommendLocalAiModel } from "../recommendation"

const baseProbe: LocalAiHardwareProbe = {
	os: "win32",
	arch: "x64",
	cpu: { model: "Test CPU", count: 8 },
	memory: { totalBytes: 16 * 1024 ** 3, totalGb: 16 },
	disk: { status: "known", freeBytes: 80 * 1024 ** 3, freeGb: 80, path: "C:" },
	gpu: { status: "unknown", names: [] },
	runtimes: {
		ollama: { provider: "ollama", displayName: "Ollama", baseUrl: "http://localhost:11434", status: "running" },
		lmStudio: {
			provider: "lmstudio",
			displayName: "LM Studio",
			baseUrl: "http://localhost:1234",
			status: "unknown",
		},
	},
	probedAt: "2026-01-01T00:00:00.000Z",
}

const baseQuestionnaire: LocalAiQuestionnaire = {
	usageProfile: "daily",
	preference: "balanced",
	privacy: "local-only",
	diskBudgetGb: 8,
	runtimeChoice: "ollama",
}

describe("recommendLocalAiModel", () => {
	it("recommends a standard coder model for a 16 GB daily coding machine", () => {
		const recommendation = recommendLocalAiModel({ probe: baseProbe, questionnaire: baseQuestionnaire })

		expect(recommendation.model.tag).toBe("qwen2.5-coder:7b")
		expect(recommendation.recommendedSetup).toBe("local")
		expect(recommendation.hasWeakHardwareWarning).toBe(false)
		expect(recommendation.model.approximateSizeGb).toBeLessThanOrEqual(baseQuestionnaire.diskBudgetGb)
		expect(recommendation.provider).toBe("ollama")
		expect(recommendation.ollamaNumCtx).toBe(8192)
	})

	it("recommends a small local model with a warning for low-RAM systems with integrated graphics", () => {
		const lowMemoryProbe: LocalAiHardwareProbe = {
			...baseProbe,
			memory: { totalBytes: 7.7 * 1024 ** 3, totalGb: 7.7 },
			gpu: { status: "detected", names: ["Intel UHD Graphics"] },
			runtimes: {
				...baseProbe.runtimes,
				ollama: {
					provider: "ollama",
					displayName: "Ollama",
					baseUrl: "http://localhost:11434",
					status: "missing",
				},
			},
		}

		const recommendation = recommendLocalAiModel({ probe: lowMemoryProbe, questionnaire: baseQuestionnaire })

		expect(recommendation.recommendedSetup).toBe("local")
		expect(recommendation.model.tag).toBe("qwen2.5-coder:1.5b")
		expect(recommendation.hasWeakHardwareWarning).toBe(true)
		expect(recommendation.warnings).not.toContain(
			"Detected memory is below the practical 12 GB threshold for useful local coding models.",
		)
	})

	it("keeps local setup available with a warning when free disk space is very low", () => {
		const recommendation = recommendLocalAiModel({
			probe: { ...baseProbe, disk: { status: "known", freeBytes: 5 * 1024 ** 3, freeGb: 5, path: "C:" } },
			questionnaire: baseQuestionnaire,
		})

		expect(recommendation.recommendedSetup).toBe("local")
		expect(recommendation.hasWeakHardwareWarning).toBe(true)
	})

	it("does not silently choose a model above the user disk budget", () => {
		const recommendation = recommendLocalAiModel({
			probe: baseProbe,
			questionnaire: { ...baseQuestionnaire, preference: "quality", usageProfile: "agentic", diskBudgetGb: 2.5 },
		})

		expect(recommendation.model.approximateSizeGb).toBeLessThanOrEqual(2.5)
		expect(recommendation.model.tag).toBe("qwen2.5-coder:3b")
	})

	it("keeps largest tiers behind explicit quality or agentic intent", () => {
		const highMemoryProbe: LocalAiHardwareProbe = {
			...baseProbe,
			memory: { totalBytes: 64 * 1024 ** 3, totalGb: 64 },
			disk: { status: "known", freeBytes: 200 * 1024 ** 3, freeGb: 200, path: "C:" },
			gpu: { status: "detected", names: ["NVIDIA Test GPU"] },
		}

		const balanced = recommendLocalAiModel({
			probe: highMemoryProbe,
			questionnaire: { ...baseQuestionnaire, diskBudgetGb: 64, usageProfile: "daily", preference: "balanced" },
		})
		const quality = recommendLocalAiModel({
			probe: highMemoryProbe,
			questionnaire: { ...baseQuestionnaire, diskBudgetGb: 64, usageProfile: "agentic", preference: "quality" },
		})

		expect(balanced.model.tag).toBe("qwen2.5-coder:7b")
		expect(quality.model.tag).toBe("qwen2.5-coder:32b")
	})

	it("reports unknown disk and GPU as uncertainty rather than absence", () => {
		const recommendation = recommendLocalAiModel({
			probe: { ...baseProbe, disk: { status: "unknown" }, gpu: { status: "unknown", names: [] } },
			questionnaire: { ...baseQuestionnaire, diskBudgetGb: 16, preference: "quality", usageProfile: "agentic" },
		})

		expect(recommendation.warnings).toContain(
			"Free disk space could not be detected; the recommendation uses only your disk budget.",
		)
		expect(recommendation.model.tag).not.toBe("qwen2.5-coder:32b")
	})
})

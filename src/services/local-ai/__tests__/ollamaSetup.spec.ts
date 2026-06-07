import { LocalAiSetupStartRequest } from "@roo-code/types"

import { LocalAiSetupManager, parseOllamaPullLine } from "../ollamaSetup"

vi.mock("../hardware", () => ({
	OLLAMA_DEFAULT_BASE_URL: "http://localhost:11434",
	detectOllamaRuntime: vi.fn().mockResolvedValue({
		provider: "ollama",
		displayName: "Ollama",
		baseUrl: "http://localhost:11434",
		status: "missing",
	}),
}))

const startRequest: LocalAiSetupStartRequest = {
	questionnaire: {
		usageProfile: "daily",
		preference: "balanced",
		privacy: "local-only",
		diskBudgetGb: 8,
		runtimeChoice: "ollama",
	},
	recommendation: {
		provider: "ollama",
		runtimeDisplayName: "Ollama",
		baseUrl: "http://localhost:11434",
		model: {
			provider: "ollama",
			tag: "qwen2.5-coder:7b",
			displayName: "Qwen2.5 Coder 7B",
			description: "Test model",
			approximateSizeGb: 4.7,
			minimumRamGb: 12,
			recommendedRamGb: 16,
			tier: "standard",
			defaultNumCtx: 8192,
		},
		ollamaNumCtx: 8192,
		confidence: "high",
		reasons: [],
		warnings: [],
		diskBudgetGb: 8,
		privacyNote: "Inference runs locally once Ollama and the selected model are installed.",
	},
}

describe("parseOllamaPullLine", () => {
	it("parses streamed byte progress", () => {
		const progress = parseOllamaPullLine('{"status":"downloading","completed":50,"total":100}')

		expect(progress).toEqual(
			expect.objectContaining({
				stage: "download",
				message: "downloading",
				completedBytes: 50,
				totalBytes: 100,
				percent: 50,
			}),
		)
	})

	it("returns undefined for malformed stream lines", () => {
		expect(parseOllamaPullLine("not json")).toBeUndefined()
	})

	it("converts Ollama stream errors to error progress", () => {
		expect(parseOllamaPullLine('{"error":"pull failed"}')).toEqual(
			expect.objectContaining({ stage: "error", error: "pull failed" }),
		)
	})
})

describe("LocalAiSetupManager", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("returns install help when Ollama is missing", async () => {
		const manager = new LocalAiSetupManager()
		const progress = vi.fn()

		const result = await manager.start(startRequest, progress)

		expect(result.success).toBe(false)
		expect(result.installUrl).toBe("https://ollama.com/download")
		expect(progress).toHaveBeenCalledWith(
			expect.objectContaining({ stage: "error", installUrl: result.installUrl }),
		)
	})

	it("supports cancellation without throwing", async () => {
		const manager = new LocalAiSetupManager()
		manager.cancel()

		const result = await manager.start(startRequest, vi.fn())

		expect(result.success).toBe(false)
	})
})

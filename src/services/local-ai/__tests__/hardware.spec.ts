import { execFile } from "child_process"
import { access } from "fs/promises"

vi.mock("child_process", () => ({
	execFile: vi.fn(),
}))

vi.mock("fs/promises", () => {
	const access = vi.fn()

	return {
		default: { access },
		access,
	}
})

const mockExecFile = vi.mocked(execFile)
const mockAccess = vi.mocked(access)
const originalFetch = global.fetch

describe("local AI hardware probing", () => {
	beforeEach(() => {
		vi.resetModules()
		vi.clearAllMocks()
		mockAccess.mockRejectedValue(new Error("not found"))
	})

	afterEach(() => {
		global.fetch = originalFetch
	})

	it("reports unknown free disk when platform command fails", async () => {
		mockExecFile.mockImplementation(((_command: string, _args: string[], _options: any, callback: any) => {
			callback(new Error("not available"), "", "")
		}) as any)

		const { detectFreeDisk } = await import("../hardware")
		const result = await detectFreeDisk("/workspace")

		expect(result.status).toBe("unknown")
	})

	it("reports unknown GPU when best-effort GPU commands fail", async () => {
		mockExecFile.mockImplementation(((_command: string, _args: string[], _options: any, callback: any) => {
			callback(new Error("not available"), "", "")
		}) as any)

		const { detectGpu } = await import("../hardware")
		const result = await detectGpu()

		expect(result.status).toBe("unknown")
		expect(result.names).toEqual([])
	})

	it("detects Ollama as installed-not-running when command exists but API is unreachable", async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error("connection refused")) as any
		mockExecFile.mockImplementation(((_command: string, args: string[], _options: any, callback: any) => {
			callback(null, args.includes("--version") ? "ollama version 0.1.0" : "", "")
		}) as any)

		const { detectOllamaRuntime } = await import("../hardware")
		const result = await detectOllamaRuntime()

		expect(result.status).toBe("installed-not-running")
		expect(result.version).toBe("ollama version 0.1.0")
	})

	it("normalizes LM Studio server URLs to the OpenAI-compatible v1 API base", async () => {
		const { normalizeLmStudioBaseUrl } = await import("../hardware")

		expect(normalizeLmStudioBaseUrl("http://localhost:1234")).toBe("http://localhost:1234/v1")
		expect(normalizeLmStudioBaseUrl("http://localhost:1234/v1/")).toBe("http://localhost:1234/v1")
	})

	it("detects LM Studio as running when the local server returns models", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ data: [{ id: "local-model" }, { id: "second-model" }] }),
		}) as any

		const { detectLmStudioRuntime } = await import("../hardware")
		const result = await detectLmStudioRuntime("http://localhost:1234")

		expect(global.fetch).toHaveBeenCalledWith("http://localhost:1234/v1/models", expect.any(Object))
		expect(result).toEqual(
			expect.objectContaining({
				provider: "lmstudio",
				baseUrl: "http://localhost:1234/v1",
				status: "running",
				models: ["local-model", "second-model"],
			}),
		)
	})

	it("detects LM Studio as installed-not-running when the CLI exists but the server is unreachable", async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any
		mockExecFile.mockImplementation(((_command: string, args: string[], _options: any, callback: any) => {
			callback(null, args.includes("--version") ? "0.3.0" : "", "")
		}) as any)

		const { detectLmStudioRuntime } = await import("../hardware")
		const result = await detectLmStudioRuntime()

		expect(result.status).toBe("installed-not-running")
		expect(result.baseUrl).toBe("http://localhost:1234/v1")
		expect(result.version).toBe("0.3.0")
	})

	it("detects LM Studio as missing when neither server nor install hints are available", async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any
		mockExecFile.mockImplementation(((_command: string, _args: string[], _options: any, callback: any) => {
			callback(new Error("not installed"), "", "")
		}) as any)

		const { detectLmStudioRuntime } = await import("../hardware")
		const result = await detectLmStudioRuntime()

		expect(result.status).toBe("missing")
		expect(result.error).toBe("ECONNREFUSED")
	})

	it("reports LM Studio detection failures without treating non-connection errors as missing", async () => {
		global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any
		mockExecFile.mockImplementation(((_command: string, _args: string[], _options: any, callback: any) => {
			callback(new Error("not installed"), "", "")
		}) as any)

		const { detectLmStudioRuntime } = await import("../hardware")
		const result = await detectLmStudioRuntime()

		expect(result.status).toBe("detection-failed")
		expect(result.error).toBe("HTTP 500")
	})
})

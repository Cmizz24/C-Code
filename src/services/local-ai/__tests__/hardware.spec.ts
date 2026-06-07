import { execFile } from "child_process"

vi.mock("child_process", () => ({
	execFile: vi.fn(),
}))

const mockExecFile = vi.mocked(execFile)

describe("local AI hardware probing", () => {
	beforeEach(() => {
		vi.resetModules()
		vi.clearAllMocks()
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
		const originalFetch = global.fetch
		global.fetch = vi.fn().mockRejectedValue(new Error("connection refused")) as any
		mockExecFile.mockImplementation(((_command: string, args: string[], _options: any, callback: any) => {
			callback(null, args.includes("--version") ? "ollama version 0.1.0" : "", "")
		}) as any)

		const { detectOllamaRuntime } = await import("../hardware")
		const result = await detectOllamaRuntime()

		expect(result.status).toBe("installed-not-running")
		expect(result.version).toBe("ollama version 0.1.0")
		global.fetch = originalFetch
	})
})

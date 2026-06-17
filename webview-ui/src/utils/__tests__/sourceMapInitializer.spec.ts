const mockEnhanceErrorWithSourceMaps = vi.fn(async (error: Error) => error)

vi.mock("../sourceMapUtils", () => ({
	enhanceErrorWithSourceMaps: mockEnhanceErrorWithSourceMaps,
}))

describe("sourceMapInitializer", () => {
	const originalFetch = globalThis.fetch
	let appendChildSpy: { mockRestore: () => void }

	beforeEach(() => {
		vi.resetModules()
		vi.stubEnv("NODE_ENV", "production")
		mockEnhanceErrorWithSourceMaps.mockClear()
		globalThis.fetch = vi.fn()
		appendChildSpy = vi.spyOn(document.head, "appendChild")
	})

	afterEach(() => {
		appendChildSpy.mockRestore()
		globalThis.fetch = originalFetch
		vi.unstubAllEnvs()
	})

	it("registers lazy error handlers without preloading source maps during startup", async () => {
		const { initializeSourceMaps } = await import("../sourceMapInitializer")

		initializeSourceMaps()

		expect(globalThis.fetch).not.toHaveBeenCalled()
		expect(appendChildSpy).not.toHaveBeenCalled()

		const error = new Error("source mapped later")
		window.dispatchEvent(new ErrorEvent("error", { error }))

		await vi.waitFor(() => {
			expect(mockEnhanceErrorWithSourceMaps).toHaveBeenCalledWith(error)
		})
	})

	it("initializes only once", async () => {
		const addEventListenerSpy = vi.spyOn(window, "addEventListener")
		const { initializeSourceMaps } = await import("../sourceMapInitializer")

		initializeSourceMaps()
		initializeSourceMaps()

		expect(addEventListenerSpy.mock.calls.filter(([eventName]) => eventName === "error")).toHaveLength(1)
		expect(addEventListenerSpy.mock.calls.filter(([eventName]) => eventName === "unhandledrejection")).toHaveLength(
			1,
		)

		addEventListenerSpy.mockRestore()
	})
})

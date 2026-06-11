import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const playwrightMock = vi.hoisted(() => {
	let nextId = 1

	type MockPage = {
		id: number
		closed: boolean
		currentUrl: string
		close: ReturnType<typeof vi.fn>
		setDefaultTimeout: ReturnType<typeof vi.fn>
		setViewportSize: ReturnType<typeof vi.fn>
		goto: ReturnType<typeof vi.fn>
		waitForLoadState: ReturnType<typeof vi.fn>
		url: ReturnType<typeof vi.fn>
	}

	type MockContext = {
		id: number
		closed: boolean
		pages: MockPage[]
		close: ReturnType<typeof vi.fn>
		newPage: ReturnType<typeof vi.fn>
	}

	type MockBrowser = {
		id: number
		closed: boolean
		contexts: MockContext[]
		close: ReturnType<typeof vi.fn>
		newContext: ReturnType<typeof vi.fn>
	}

	const state = {
		browsers: [] as MockBrowser[],
		gotoFailures: [] as Error[],
		newContextFailures: [] as Error[],
		newPageFailures: [] as Error[],
	}

	const createPage = (): MockPage => {
		const page: MockPage = {
			id: nextId++,
			closed: false,
			currentUrl: "about:blank",
			close: vi.fn(async () => {
				page.closed = true
			}),
			setDefaultTimeout: vi.fn(),
			setViewportSize: vi.fn(),
			goto: vi.fn(async (url: string) => {
				const failure = state.gotoFailures.shift()

				if (failure) {
					throw failure
				}

				page.currentUrl = url
			}),
			waitForLoadState: vi.fn(async () => undefined),
			url: vi.fn(() => page.currentUrl),
		}

		return page
	}

	const createContext = (): MockContext => {
		const context: MockContext = {
			id: nextId++,
			closed: false,
			pages: [],
			close: vi.fn(async () => {
				context.closed = true
			}),
			newPage: vi.fn(async () => {
				const failure = state.newPageFailures.shift()

				if (failure) {
					throw failure
				}

				const page = createPage()
				context.pages.push(page)
				return page
			}),
		}

		return context
	}

	const createBrowser = (): MockBrowser => {
		const browser: MockBrowser = {
			id: nextId++,
			closed: false,
			contexts: [],
			close: vi.fn(async () => {
				browser.closed = true
			}),
			newContext: vi.fn(async () => {
				const failure = state.newContextFailures.shift()

				if (failure) {
					throw failure
				}

				const context = createContext()
				browser.contexts.push(context)
				return context
			}),
		}

		return browser
	}

	const chromium = {
		executablePath: vi.fn(() => process.execPath),
		launch: vi.fn(async () => {
			const browser = createBrowser()
			state.browsers.push(browser)
			return browser
		}),
	}

	const reset = () => {
		nextId = 1
		state.browsers.length = 0
		state.gotoFailures.length = 0
		state.newContextFailures.length = 0
		state.newPageFailures.length = 0
		chromium.executablePath.mockClear()
		chromium.launch.mockClear()
	}

	return { chromium, reset, state }
})

vi.mock("playwright", () => ({
	chromium: playwrightMock.chromium,
}))

import { resetVisualBrowserPlaywrightStateForTests } from "../PlaywrightBrowserManager"
import { type VisualBrowserExecuteOptions, VisualBrowserInspectorService } from "../VisualBrowserInspectorService"

const tempDirs: string[] = []

async function createOptions(): Promise<VisualBrowserExecuteOptions & { log: ReturnType<typeof vi.fn> }> {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "roo-vbi-lifecycle-"))
	tempDirs.push(cwd)

	return {
		cwd,
		globalStoragePath: path.join(cwd, "global-storage"),
		log: vi.fn(),
	}
}

async function openLocalhost(
	service: VisualBrowserInspectorService,
	options: VisualBrowserExecuteOptions,
	url = "http://localhost:3000",
) {
	return service.execute(
		{
			action: "visual_browser_open",
			url,
			allowExternal: false,
			headless: false,
		},
		options,
	)
}

describe("VisualBrowserInspectorService browser lifecycle", () => {
	beforeEach(() => {
		playwrightMock.reset()
		resetVisualBrowserPlaywrightStateForTests()
	})

	afterEach(async () => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop()

			if (dir) {
				await fs.rm(dir, { recursive: true, force: true })
			}
		}
	})

	it("closes a failed first controlled browser before a retry opens another one", async () => {
		const service = new VisualBrowserInspectorService()
		const options = await createOptions()
		playwrightMock.state.gotoFailures.push(new Error("navigation failed"))

		await expect(openLocalhost(service, options)).rejects.toThrow("navigation failed")

		expect(playwrightMock.state.browsers).toHaveLength(1)
		const failedBrowser = playwrightMock.state.browsers[0]
		const failedContext = failedBrowser.contexts[0]
		const failedPage = failedContext.pages[0]
		expect(failedPage.close).toHaveBeenCalledTimes(1)
		expect(failedContext.close).toHaveBeenCalledTimes(1)
		expect(failedBrowser.close).toHaveBeenCalledTimes(1)
		expect(service.getPanelState(options).session).toBeUndefined()

		const retryResult = await openLocalhost(service, options, "http://localhost:3001")

		expect(retryResult.session.status).toBe("active")
		expect(playwrightMock.state.browsers).toHaveLength(2)
		expect(failedBrowser.close).toHaveBeenCalledTimes(1)
		expect(playwrightMock.state.browsers[1].close).not.toHaveBeenCalled()
	})

	it("reuses the active controlled session for repeated open actions", async () => {
		const service = new VisualBrowserInspectorService()
		const options = await createOptions()

		const firstResult = await openLocalhost(service, options)
		const secondResult = await openLocalhost(service, options, "http://localhost:3001/path")

		expect(playwrightMock.chromium.launch).toHaveBeenCalledTimes(1)
		expect(firstResult.session.sessionId).toBe(secondResult.session.sessionId)
		const browser = playwrightMock.state.browsers[0]
		const page = browser.contexts[0].pages[0]
		expect(page.goto).toHaveBeenCalledTimes(2)
		expect(page.goto).toHaveBeenLastCalledWith("http://localhost:3001/path", {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		})
		expect(browser.close).not.toHaveBeenCalled()
	})

	it("closes all controlled sessions on close even if only the current session is resolved", async () => {
		const service = new VisualBrowserInspectorService()
		const options = await createOptions()
		const firstRuntime = await (service as any).createRuntime({
			cwd: options.cwd,
			globalStoragePath: options.globalStoragePath,
			url: "http://localhost:3000",
			viewport: { name: "mobile", width: 390, height: 844 },
			headless: false,
			allowExternal: false,
		})
		const secondRuntime = await (service as any).createRuntime({
			cwd: options.cwd,
			globalStoragePath: options.globalStoragePath,
			url: "http://localhost:3001",
			viewport: { name: "mobile", width: 390, height: 844 },
			headless: false,
			allowExternal: false,
		})
		;(service as any).currentSessionId = secondRuntime.metadata.sessionId

		await service.execute({ action: "visual_browser_close", sessionId: secondRuntime.metadata.sessionId }, options)

		for (const browser of playwrightMock.state.browsers) {
			expect(browser.contexts[0].pages[0].close).toHaveBeenCalledTimes(1)
			expect(browser.contexts[0].close).toHaveBeenCalledTimes(1)
			expect(browser.close).toHaveBeenCalledTimes(1)
		}
		expect(firstRuntime.metadata.status).toBe("closed")
		expect(secondRuntime.metadata.status).toBe("closed")
		expect(service.getPanelState(options).session).toBeUndefined()
	})

	it("continues cleanup and logs when individual close calls throw", async () => {
		const service = new VisualBrowserInspectorService()
		const options = await createOptions()
		const firstRuntime = await (service as any).createRuntime({
			cwd: options.cwd,
			globalStoragePath: options.globalStoragePath,
			url: "http://localhost:3000",
			viewport: { name: "mobile", width: 390, height: 844 },
			headless: false,
			allowExternal: false,
		})
		const secondRuntime = await (service as any).createRuntime({
			cwd: options.cwd,
			globalStoragePath: options.globalStoragePath,
			url: "http://localhost:3001",
			viewport: { name: "mobile", width: 390, height: 844 },
			headless: false,
			allowExternal: false,
		})
		;(service as any).currentSessionId = firstRuntime.metadata.sessionId
		const firstBrowser = playwrightMock.state.browsers[0]
		firstBrowser.contexts[0].pages[0].close.mockRejectedValueOnce(new Error("page close failed"))
		firstBrowser.contexts[0].close.mockRejectedValueOnce(new Error("context close failed"))

		await expect(
			service.execute({ action: "visual_browser_close", sessionId: firstRuntime.metadata.sessionId }, options),
		).resolves.toEqual(expect.objectContaining({ action: "visual_browser_close" }))

		expect(options.log).toHaveBeenCalledWith(
			expect.stringContaining("Visual Browser Inspector ignored page cleanup error: page close failed"),
		)
		expect(options.log).toHaveBeenCalledWith(
			expect.stringContaining("Visual Browser Inspector ignored context cleanup error: context close failed"),
		)
		for (const browser of playwrightMock.state.browsers) {
			expect(browser.close).toHaveBeenCalledTimes(1)
		}
		expect(playwrightMock.state.browsers[1].contexts[0].pages[0].close).toHaveBeenCalledTimes(1)
		expect(playwrightMock.state.browsers[1].contexts[0].close).toHaveBeenCalledTimes(1)
		expect(secondRuntime.metadata.status).toBe("closed")
		expect(service.getPanelState(options).session).toBeUndefined()
	})

	it("closes partial launch resources when page creation fails", async () => {
		const service = new VisualBrowserInspectorService()
		const options = await createOptions()
		playwrightMock.state.newPageFailures.push(new Error("page creation failed"))

		await expect(openLocalhost(service, options)).rejects.toThrow("page creation failed")

		expect(playwrightMock.state.browsers).toHaveLength(1)
		const browser = playwrightMock.state.browsers[0]
		expect(browser.contexts[0].close).toHaveBeenCalledTimes(1)
		expect(browser.close).toHaveBeenCalledTimes(1)
		expect(service.getPanelState(options).session).toBeUndefined()
	})
})

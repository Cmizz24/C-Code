import path from "path"

import {
	ensureVisualBrowserPlaywright,
	getVisualBrowserPlaywrightBrowsersPath,
	resetVisualBrowserPlaywrightStateForTests,
	type VisualBrowserPlaywrightDependencies,
} from "../PlaywrightBrowserManager"

describe("PlaywrightBrowserManager", () => {
	const originalPlaywrightBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH

	afterEach(() => {
		resetVisualBrowserPlaywrightStateForTests()

		if (originalPlaywrightBrowsersPath === undefined) {
			delete process.env.PLAYWRIGHT_BROWSERS_PATH
		} else {
			process.env.PLAYWRIGHT_BROWSERS_PATH = originalPlaywrightBrowsersPath
		}
	})

	it("derives the managed browser cache path from extension global storage", () => {
		expect(getVisualBrowserPlaywrightBrowsersPath({ cwd: "/workspace", globalStoragePath: "/global" })).toBe(
			path.join("/global", "visual-browser-inspector", "playwright-browsers"),
		)
	})

	it("falls back to the workspace VBI directory when extension storage is unavailable", () => {
		expect(getVisualBrowserPlaywrightBrowsersPath({ cwd: "/workspace" })).toBe(
			path.join("/workspace", ".roo", "visual-browser-inspector", "playwright-browsers"),
		)
	})

	it("does not install Chromium when the managed executable already exists", async () => {
		const browsersPath = getVisualBrowserPlaywrightBrowsersPath({
			cwd: "/workspace",
			globalStoragePath: "/global",
		})
		const executablePath = path.join(browsersPath, "chromium-1223", "chrome")
		const existingPaths = new Set([executablePath])
		const chromium = { executablePath: vi.fn(() => executablePath) }
		const dependencies: VisualBrowserPlaywrightDependencies = {
			importPlaywright: vi.fn(async () => ({ chromium }) as any),
			resolvePlaywrightPackageDir: vi.fn(() => "/extension/dist/node_modules/playwright"),
			installChromium: vi.fn(),
			access: vi.fn(async (filePath) => {
				if (!existingPaths.has(filePath)) {
					throw new Error(`missing ${filePath}`)
				}
			}),
			mkdir: vi.fn(async () => undefined),
		}

		const result = await ensureVisualBrowserPlaywright({
			cwd: "/workspace",
			globalStoragePath: "/global",
			dependencies,
		})

		expect(process.env.PLAYWRIGHT_BROWSERS_PATH).toBe(browsersPath)
		expect(dependencies.mkdir).toHaveBeenCalledWith(browsersPath, { recursive: true })
		expect(dependencies.installChromium).not.toHaveBeenCalled()
		expect(result).toEqual({ chromium, browsersPath, executablePath, installed: false })
	})

	it("installs Chromium automatically when the managed executable is missing", async () => {
		const browsersPath = getVisualBrowserPlaywrightBrowsersPath({
			cwd: "/workspace",
			globalStoragePath: "/global",
		})
		const executablePath = path.join(browsersPath, "chromium-1223", "chrome")
		const existingPaths = new Set<string>()
		const chromium = { executablePath: vi.fn(() => executablePath) }
		const onProgress = vi.fn()
		const dependencies: VisualBrowserPlaywrightDependencies = {
			importPlaywright: vi.fn(async () => ({ chromium }) as any),
			resolvePlaywrightPackageDir: vi.fn(() => "/extension/dist/node_modules/playwright"),
			installChromium: vi.fn(async (options) => {
				expect(options.browsersPath).toBe(browsersPath)
				expect(options.playwrightPackageDir).toBe("/extension/dist/node_modules/playwright")
				await options.onProgress?.("Downloading Chromium for Visual Browser Inspector.")
				existingPaths.add(executablePath)
			}),
			access: vi.fn(async (filePath) => {
				if (!existingPaths.has(filePath)) {
					throw new Error(`missing ${filePath}`)
				}
			}),
			mkdir: vi.fn(async () => undefined),
		}

		const result = await ensureVisualBrowserPlaywright({
			cwd: "/workspace",
			globalStoragePath: "/global",
			onProgress,
			dependencies,
		})

		expect(dependencies.installChromium).toHaveBeenCalledTimes(1)
		expect(onProgress).toHaveBeenCalledWith(
			`Visual Browser Inspector is preparing its managed Chromium browser in ${browsersPath}.`,
		)
		expect(onProgress).toHaveBeenCalledWith("Downloading Chromium for Visual Browser Inspector.")
		expect(onProgress).toHaveBeenCalledWith(
			"Chromium is ready. Opening the controlled Visual Browser Inspector page.",
		)
		expect(result).toEqual({ chromium, browsersPath, executablePath, installed: true })
	})

	it("records install failures and avoids immediate repeated attempts", async () => {
		let now = 1_000
		const browsersPath = getVisualBrowserPlaywrightBrowsersPath({
			cwd: "/workspace",
			globalStoragePath: "/global",
		})
		const executablePath = path.join(browsersPath, "chromium-1223", "chrome")
		const chromium = { executablePath: vi.fn(() => executablePath) }
		const dependencies: VisualBrowserPlaywrightDependencies = {
			importPlaywright: vi.fn(async () => ({ chromium }) as any),
			resolvePlaywrightPackageDir: vi.fn(() => "/extension/dist/node_modules/playwright"),
			installChromium: vi.fn(async () => {
				throw new Error("network unavailable")
			}),
			access: vi.fn(async () => {
				throw new Error("missing executable")
			}),
			mkdir: vi.fn(async () => undefined),
			now: vi.fn(() => now),
		}

		await expect(
			ensureVisualBrowserPlaywright({
				cwd: "/workspace",
				globalStoragePath: "/global",
				failureCooldownMs: 60_000,
				dependencies,
			}),
		).rejects.toThrow(/could not install Chromium automatically/)

		now = 2_000

		await expect(
			ensureVisualBrowserPlaywright({
				cwd: "/workspace",
				globalStoragePath: "/global",
				failureCooldownMs: 60_000,
				dependencies,
			}),
		).rejects.toThrow(/recently failed to install Chromium/)

		expect(dependencies.installChromium).toHaveBeenCalledTimes(1)
	})
})

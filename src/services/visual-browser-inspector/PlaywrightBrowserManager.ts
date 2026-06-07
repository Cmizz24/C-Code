import * as childProcess from "child_process"
import fs from "fs/promises"
import { createRequire } from "module"
import path from "path"

type PlaywrightRuntime = Pick<typeof import("playwright"), "chromium">

export interface VisualBrowserPlaywrightEnsureResult {
	chromium: PlaywrightRuntime["chromium"]
	browsersPath: string
	executablePath: string
	installed: boolean
}

export interface VisualBrowserPlaywrightInstallOptions {
	playwrightPackageDir: string
	browsersPath: string
	timeoutMs: number
	env: NodeJS.ProcessEnv
	access?: (filePath: string) => Promise<void>
	onProgress?: (message: string) => void | Promise<void>
}

export interface VisualBrowserPlaywrightDependencies {
	importPlaywright?: () => Promise<PlaywrightRuntime>
	resolvePlaywrightPackageDir?: () => string
	installChromium?: (options: VisualBrowserPlaywrightInstallOptions) => Promise<void>
	access?: (filePath: string) => Promise<void>
	mkdir?: (dirPath: string, options?: { recursive?: boolean }) => Promise<unknown>
	now?: () => number
}

export interface VisualBrowserPlaywrightEnsureOptions {
	cwd: string
	globalStoragePath?: string
	log?: (message: string) => void
	onProgress?: (message: string) => void | Promise<void>
	installTimeoutMs?: number
	failureCooldownMs?: number
	dependencies?: VisualBrowserPlaywrightDependencies
}

const VISUAL_BROWSER_STORAGE_DIR = "visual-browser-inspector"
const PLAYWRIGHT_BROWSER_CACHE_DIR = "playwright-browsers"
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000
const INSTALL_FAILURE_COOLDOWN_MS = 60 * 1000
const MAX_INSTALL_OUTPUT_LENGTH = 20_000

const runtimeRequire = createRequire(__filename)

let playwrightRuntimePromise: Promise<PlaywrightRuntime> | undefined
const browserInstallPromises = new Map<string, Promise<VisualBrowserPlaywrightEnsureResult>>()
const browserInstallFailures = new Map<string, { error: Error; failedAt: number }>()

function messageFromError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

async function notifyProgress(
	options: Pick<VisualBrowserPlaywrightEnsureOptions, "log" | "onProgress">,
	message: string,
): Promise<void> {
	options.log?.(message)

	try {
		await options.onProgress?.(message)
	} catch {
		// Progress callbacks update UI only. Browser installation should not fail if a panel was closed.
	}
}

function createBrowserInstallError(message: string, cause?: unknown): Error {
	const error = new Error(message)
	;(error as Error & { cause?: unknown }).cause = cause
	return error
}

function getAccess(dependencies?: VisualBrowserPlaywrightDependencies): (filePath: string) => Promise<void> {
	return dependencies?.access ?? ((filePath: string) => fs.access(filePath))
}

async function pathExists(filePath: string, dependencies?: VisualBrowserPlaywrightDependencies): Promise<boolean> {
	try {
		await getAccess(dependencies)(filePath)
		return true
	} catch {
		return false
	}
}

async function loadPlaywrightRuntime(dependencies?: VisualBrowserPlaywrightDependencies): Promise<PlaywrightRuntime> {
	if (dependencies?.importPlaywright) {
		try {
			return await dependencies.importPlaywright()
		} catch (error) {
			throw createBrowserInstallError(
				`Visual Browser Inspector could not load Playwright at runtime: ${messageFromError(error)}`,
				error,
			)
		}
	}

	playwrightRuntimePromise ??= import("playwright")
		.then((playwright) => ({ chromium: playwright.chromium }))
		.catch((error) => {
			playwrightRuntimePromise = undefined

			throw createBrowserInstallError(
				`Visual Browser Inspector could not load Playwright at runtime: ${messageFromError(error)}`,
				error,
			)
		})

	return playwrightRuntimePromise
}

export function getVisualBrowserPlaywrightBrowsersPath(options: { cwd: string; globalStoragePath?: string }): string {
	const storageRoot = options.globalStoragePath ?? path.join(options.cwd, ".roo")

	return path.join(storageRoot, VISUAL_BROWSER_STORAGE_DIR, PLAYWRIGHT_BROWSER_CACHE_DIR)
}

export function resolvePlaywrightPackageDir(): string {
	return path.dirname(runtimeRequire.resolve("playwright/package.json"))
}

async function runPlaywrightChromiumInstall(options: VisualBrowserPlaywrightInstallOptions): Promise<void> {
	const cliPath = path.join(options.playwrightPackageDir, "cli.js")

	try {
		await (options.access ?? fs.access)(cliPath)
	} catch (error) {
		throw createBrowserInstallError(
			`Visual Browser Inspector could not find the Playwright installer at ${cliPath}. Reinstall the extension and try again.`,
			error,
		)
	}

	try {
		await options.onProgress?.(
			"Downloading Chromium for Visual Browser Inspector. This one-time setup may take a few minutes.",
		)
	} catch {
		// Progress callbacks update UI only. Browser installation should not fail if a panel was closed.
	}

	await new Promise<void>((resolve, reject) => {
		let settled = false
		let timedOut = false
		let output = ""

		const appendOutput = (chunk: Buffer | string) => {
			output += chunk.toString()
			if (output.length > MAX_INSTALL_OUTPUT_LENGTH) {
				output = output.slice(-MAX_INSTALL_OUTPUT_LENGTH)
			}
		}

		const finish = (error?: Error) => {
			if (settled) {
				return
			}

			settled = true
			clearTimeout(timeout)

			if (error) {
				reject(error)
			} else {
				resolve()
			}
		}

		const installProcess = childProcess.spawn(process.execPath, [cliPath, "install", "chromium"], {
			cwd: options.playwrightPackageDir,
			env: {
				...options.env,
				ELECTRON_RUN_AS_NODE: "1",
				PLAYWRIGHT_BROWSERS_PATH: options.browsersPath,
				PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "0",
			},
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		})

		const timeout = setTimeout(() => {
			timedOut = true
			installProcess.kill()
		}, options.timeoutMs)

		installProcess.stdout?.on("data", appendOutput)
		installProcess.stderr?.on("data", appendOutput)
		installProcess.on("error", (error) => {
			finish(createBrowserInstallError(`Playwright Chromium installer could not start: ${error.message}`, error))
		})
		installProcess.on("close", (code, signal) => {
			if (code === 0 && !timedOut) {
				finish()
				return
			}

			const status = timedOut
				? `timed out after ${Math.round(options.timeoutMs / 1000)} seconds`
				: signal
					? `stopped with signal ${signal}`
					: `exited with code ${code}`
			const outputSuffix = output.trim() ? `\n\nInstaller output:\n${output.trim()}` : ""

			finish(
				createBrowserInstallError(
					`Playwright Chromium installer ${status}. Browser cache: ${options.browsersPath}.${outputSuffix}`,
				),
			)
		})
	})
}

async function installMissingChromium(
	options: VisualBrowserPlaywrightEnsureOptions,
	runtime: PlaywrightRuntime,
	browsersPath: string,
): Promise<VisualBrowserPlaywrightEnsureResult> {
	const dependencies = options.dependencies
	const resolvePackageDir = dependencies?.resolvePlaywrightPackageDir ?? resolvePlaywrightPackageDir
	const installChromium = dependencies?.installChromium ?? runPlaywrightChromiumInstall
	const playwrightPackageDir = resolvePackageDir()

	await notifyProgress(
		options,
		`Visual Browser Inspector is preparing its managed Chromium browser in ${browsersPath}.`,
	)

	try {
		await installChromium({
			playwrightPackageDir,
			browsersPath,
			timeoutMs: options.installTimeoutMs ?? INSTALL_TIMEOUT_MS,
			env: process.env,
			access: dependencies?.access,
			onProgress: (message) => notifyProgress(options, message),
		})
	} catch (error) {
		throw createBrowserInstallError(
			`Visual Browser Inspector could not install Chromium automatically. Check your network connection and try again. Browser cache: ${browsersPath}. ${messageFromError(error)}`,
			error,
		)
	}

	const executablePath = runtime.chromium.executablePath()

	if (!(await pathExists(executablePath, dependencies))) {
		throw createBrowserInstallError(
			`Visual Browser Inspector installed Chromium, but the expected executable is still missing at ${executablePath}. Browser cache: ${browsersPath}.`,
		)
	}

	await notifyProgress(options, "Chromium is ready. Opening the controlled Visual Browser Inspector page.")

	return {
		chromium: runtime.chromium,
		browsersPath,
		executablePath,
		installed: true,
	}
}

export async function ensureVisualBrowserPlaywright(
	options: VisualBrowserPlaywrightEnsureOptions,
): Promise<VisualBrowserPlaywrightEnsureResult> {
	const dependencies = options.dependencies
	const mkdir = dependencies?.mkdir ?? fs.mkdir
	const now = dependencies?.now ?? Date.now
	const browsersPath = getVisualBrowserPlaywrightBrowsersPath({
		cwd: options.cwd,
		globalStoragePath: options.globalStoragePath,
	})

	process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath
	await mkdir(browsersPath, { recursive: true })

	const runtime = await loadPlaywrightRuntime(dependencies)
	const executablePath = runtime.chromium.executablePath()

	if (await pathExists(executablePath, dependencies)) {
		browserInstallFailures.delete(browsersPath)
		return {
			chromium: runtime.chromium,
			browsersPath,
			executablePath,
			installed: false,
		}
	}

	const activeInstall = browserInstallPromises.get(browsersPath)
	if (activeInstall) {
		return activeInstall
	}

	const failureCooldownMs = options.failureCooldownMs ?? INSTALL_FAILURE_COOLDOWN_MS
	const recentFailure = browserInstallFailures.get(browsersPath)
	if (recentFailure && now() - recentFailure.failedAt < failureCooldownMs) {
		const secondsRemaining = Math.max(1, Math.ceil((failureCooldownMs - (now() - recentFailure.failedAt)) / 1000))

		throw createBrowserInstallError(
			`Visual Browser Inspector recently failed to install Chromium and will retry automatically in ${secondsRemaining} seconds. Browser cache: ${browsersPath}. Last error: ${recentFailure.error.message}`,
			recentFailure.error,
		)
	}

	const installPromise = installMissingChromium(options, runtime, browsersPath)
		.then((result) => {
			browserInstallFailures.delete(browsersPath)
			return result
		})
		.catch((error) => {
			const normalizedError = error instanceof Error ? error : new Error(String(error))
			browserInstallFailures.set(browsersPath, { error: normalizedError, failedAt: now() })
			throw normalizedError
		})
		.finally(() => {
			browserInstallPromises.delete(browsersPath)
		})

	browserInstallPromises.set(browsersPath, installPromise)
	return installPromise
}

export function resetVisualBrowserPlaywrightStateForTests(): void {
	playwrightRuntimePromise = undefined
	browserInstallPromises.clear()
	browserInstallFailures.clear()
}

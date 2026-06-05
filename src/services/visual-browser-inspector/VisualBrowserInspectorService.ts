import crypto from "crypto"
import fs from "fs/promises"
import path from "path"

import type { Browser, BrowserContext, Page } from "playwright"
import { PNG } from "pngjs"

import type {
	VisualBrowserAnalysisResult,
	VisualBrowserAnalyzeCropParams,
	VisualBrowserAnalyzeScreenshotParams,
	VisualBrowserBoundingBox,
	VisualBrowserCaptureParams,
	VisualBrowserClickParams,
	VisualBrowserCloseParams,
	VisualBrowserCropMetadata,
	VisualBrowserCropParams,
	VisualBrowserDeleteSessionParams,
	VisualBrowserElementMetadata,
	VisualBrowserHoverParams,
	VisualBrowserInspectionResult,
	VisualBrowserInspectorToolParams,
	VisualBrowserIssue,
	VisualBrowserNavigationParams,
	VisualBrowserOpenParams,
	VisualBrowserPanelState,
	VisualBrowserScreenshotMetadata,
	VisualBrowserScrollParams,
	VisualBrowserSessionMetadata,
	VisualBrowserToolResult,
	VisualBrowserTypeParams,
	VisualBrowserViewport,
	VisualBrowserViewportPresetName,
	VisualBrowserWebviewRequest,
} from "@roo-code/types"
import { visualBrowserViewportPresets } from "@roo-code/types"

import { safeWriteJson } from "../../utils/safeWriteJson"

const VISUAL_BROWSER_ARTIFACT_ROOT = ".roo/visual-browser-inspector"
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000
const DEFAULT_ACTION_TIMEOUT_MS = 10_000
const MAX_REGION_ELEMENTS = 50

type PlaywrightRuntime = Pick<typeof import("playwright"), "chromium">

let playwrightRuntimePromise: Promise<PlaywrightRuntime> | undefined

async function loadPlaywrightRuntime(): Promise<PlaywrightRuntime> {
	playwrightRuntimePromise ??= import("playwright")
		.then((playwright) => ({ chromium: playwright.chromium }))
		.catch((error) => {
			playwrightRuntimePromise = undefined

			throw new Error(
				`Visual Browser Inspector could not load Playwright at runtime: ${error instanceof Error ? error.message : String(error)}`,
			)
		})

	return playwrightRuntimePromise
}

export type ToWebviewUri = (filePath: string) => string

export interface VisualBrowserExecuteOptions {
	cwd: string
	toWebviewUri?: ToWebviewUri
}

export interface CropResult {
	region: VisualBrowserBoundingBox
	width: number
	height: number
}

interface VisualBrowserSessionRuntime {
	browser: Browser
	context: BrowserContext
	page: Page
	metadata: VisualBrowserSessionMetadata
	screenshots: VisualBrowserScreenshotMetadata[]
	crops: VisualBrowserCropMetadata[]
	inspections: VisualBrowserInspectionResult[]
	findings: VisualBrowserAnalysisResult[]
}

interface SerializedVisualBrowserSession {
	session: VisualBrowserSessionMetadata
	screenshots: VisualBrowserScreenshotMetadata[]
	crops: VisualBrowserCropMetadata[]
	inspections: VisualBrowserInspectionResult[]
	findings: VisualBrowserAnalysisResult[]
}

function nowIso(): string {
	return new Date().toISOString()
}

function clampInteger(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return min
	}

	return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeBoundingBox(region: VisualBrowserBoundingBox): VisualBrowserBoundingBox {
	return {
		x: Math.max(0, Math.round(region.x)),
		y: Math.max(0, Math.round(region.y)),
		width: Math.max(1, Math.round(region.width)),
		height: Math.max(1, Math.round(region.height)),
	}
}

function createSessionId(): string {
	return `vbi-${Date.now()}-${crypto.randomUUID()}`
}

function createArtifactPaths(cwd: string, sessionId: string): VisualBrowserSessionMetadata["artifacts"] {
	const rootDir = path.join(cwd, VISUAL_BROWSER_ARTIFACT_ROOT, sessionId)

	return {
		rootDir,
		screenshotsDir: path.join(rootDir, "screenshots"),
		cropsDir: path.join(rootDir, "crops"),
		metadataPath: path.join(rootDir, "metadata.json"),
		findingsPath: path.join(rootDir, "findings.json"),
	}
}

function viewportFromInput(viewport?: VisualBrowserViewportPresetName | VisualBrowserViewport): VisualBrowserViewport {
	if (!viewport) {
		return { ...visualBrowserViewportPresets.mobile }
	}

	if (typeof viewport === "string") {
		return { ...visualBrowserViewportPresets[viewport] }
	}

	return {
		...viewport,
		name: viewport.name ?? "custom",
		width: Math.max(1, Math.round(viewport.width)),
		height: Math.max(1, Math.round(viewport.height)),
		deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
	}
}

function withWebviewScreenshotUri(
	screenshot: VisualBrowserScreenshotMetadata,
	options: VisualBrowserExecuteOptions,
): VisualBrowserScreenshotMetadata {
	return {
		...screenshot,
		webviewUri: options.toWebviewUri ? options.toWebviewUri(screenshot.path) : screenshot.webviewUri,
	}
}

function withWebviewCropUri(
	crop: VisualBrowserCropMetadata,
	options: VisualBrowserExecuteOptions,
): VisualBrowserCropMetadata {
	return {
		...crop,
		webviewUri: options.toWebviewUri ? options.toWebviewUri(crop.path) : crop.webviewUri,
	}
}

function isSensitiveName(name: string | undefined | null): boolean {
	return Boolean(
		name && /(password|passwd|secret|token|api[-_]?key|credential|credit|card|cc-|ssn|email|phone|tel)/i.test(name),
	)
}

export function redactVisualBrowserText(value: string | undefined | null): string | undefined {
	if (value === undefined || value === null) {
		return undefined
	}

	const normalized = value.replace(/\s+/g, " ").trim()

	if (!normalized) {
		return ""
	}

	let redacted = normalized
	redacted = redacted.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
	redacted = redacted.replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted-card]")
	redacted = redacted.replace(/\b(?:\+?\d[\d ().-]{7,}\d)\b/g, "[redacted-phone]")

	if (/\b(password|passwd|secret|token|api[-_]?key|credential|credit card|security code)\b/i.test(redacted)) {
		return "[redacted]"
	}

	return redacted.length > 180 ? `${redacted.slice(0, 180)}…` : redacted
}

export function normalizeVisualBrowserUrl(input: string): string {
	const trimmed = input.trim()

	if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) || trimmed.startsWith("file:")) {
		return trimmed
	}

	return `http://${trimmed}`
}

export function isVisualBrowserLocalUrl(input: string): boolean {
	try {
		const url = new URL(normalizeVisualBrowserUrl(input))
		const hostname = url.hostname.toLowerCase()

		return (
			url.protocol === "file:" ||
			hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "::1" ||
			hostname.endsWith(".localhost") ||
			/^127\./.test(hostname) ||
			/^10\./.test(hostname) ||
			/^192\.168\./.test(hostname) ||
			/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
		)
	} catch {
		return false
	}
}

export async function cropPngRegion(
	sourcePath: string,
	outputPath: string,
	region: VisualBrowserBoundingBox,
): Promise<CropResult> {
	const source = PNG.sync.read(await fs.readFile(sourcePath))
	const x = clampInteger(region.x, 0, Math.max(0, source.width - 1))
	const y = clampInteger(region.y, 0, Math.max(0, source.height - 1))
	const width = clampInteger(region.width, 1, source.width - x)
	const height = clampInteger(region.height, 1, source.height - y)

	const cropped = new PNG({ width, height })
	PNG.bitblt(source, cropped, x, y, width, height, 0, 0)
	await fs.mkdir(path.dirname(outputPath), { recursive: true })
	await fs.writeFile(outputPath, PNG.sync.write(cropped))

	return {
		region: { x, y, width, height },
		width,
		height,
	}
}

export function visualBrowserWebviewRequestToToolParams(
	request: VisualBrowserWebviewRequest,
): VisualBrowserInspectorToolParams | undefined {
	switch (request.action) {
		case "get_state":
			return undefined
		case "open":
			return {
				action: "visual_browser_open",
				url: request.url,
				viewport: request.viewport,
				headless: false,
				allowExternal: request.allowExternal,
			}
		case "capture":
			return { action: "visual_browser_capture", sessionId: request.sessionId, fullPage: request.fullPage }
		case "crop":
			return {
				action: "visual_browser_crop",
				sessionId: request.sessionId,
				screenshotId: request.screenshotId,
				region: request.region,
			}
		case "inspect_point":
			return {
				action: "visual_browser_inspect_point",
				sessionId: request.sessionId,
				x: request.x,
				y: request.y,
				screenshotId: request.screenshotId,
			}
		case "inspect_region":
			return {
				action: "visual_browser_inspect_region",
				sessionId: request.sessionId,
				region: request.region,
				screenshotId: request.screenshotId,
			}
		case "analyze_screenshot":
			return {
				action: "visual_browser_analyze_screenshot",
				sessionId: request.sessionId,
				screenshotId: request.screenshotId,
				prompt: request.prompt,
			}
		case "analyze_crop":
			return {
				action: "visual_browser_analyze_crop",
				sessionId: request.sessionId,
				cropId: request.cropId,
				prompt: request.prompt,
			}
		case "stop":
			return { action: "visual_browser_close", sessionId: request.sessionId }
		case "delete_session":
			return { action: "visual_browser_delete_session", sessionId: request.sessionId }
	}
}

export class VisualBrowserInspectorService {
	private sessions = new Map<string, VisualBrowserSessionRuntime>()
	private currentSessionId: string | undefined

	async execute(
		params: VisualBrowserInspectorToolParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		switch (params.action) {
			case "visual_browser_open":
				return this.open(params, options)
			case "visual_browser_reload":
			case "visual_browser_back":
			case "visual_browser_forward":
				return this.navigate(params, options)
			case "visual_browser_capture":
				return this.capture(params, options)
			case "visual_browser_crop":
				return this.crop(params, options)
			case "visual_browser_inspect_point":
				return this.inspectPoint(params, options)
			case "visual_browser_inspect_region":
				return this.inspectRegion(params, options)
			case "visual_browser_click":
				return this.click(params, options)
			case "visual_browser_hover":
				return this.hover(params, options)
			case "visual_browser_type":
				return this.type(params, options)
			case "visual_browser_scroll":
				return this.scroll(params, options)
			case "visual_browser_analyze_screenshot":
				return this.analyzeScreenshot(params, options)
			case "visual_browser_analyze_crop":
				return this.analyzeCrop(params, options)
			case "visual_browser_close":
				return this.close(params, options)
			case "visual_browser_delete_session":
				return this.deleteSession(params, options)
		}
	}

	getPanelState(options: VisualBrowserExecuteOptions): VisualBrowserPanelState {
		const runtime = this.currentSessionId ? this.sessions.get(this.currentSessionId) : undefined

		if (!runtime) {
			return {
				screenshots: [],
				crops: [],
				inspections: [],
				findings: [],
				statusMessage: "No controlled Playwright browser session is active.",
			}
		}

		return this.createPanelState(runtime, options)
	}

	private async open(
		params: VisualBrowserOpenParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const normalizedUrl = normalizeVisualBrowserUrl(params.url)

		if (!params.allowExternal && !isVisualBrowserLocalUrl(normalizedUrl)) {
			throw new Error(
				"Visual Browser Inspector blocks non-local/private URLs unless allowExternal is true. This avoids unintended screenshot capture of external sites.",
			)
		}

		const viewport = viewportFromInput(params.viewport)
		let runtime = params.sessionId ? this.sessions.get(params.sessionId) : undefined

		if (!runtime || runtime.metadata.status === "closed") {
			runtime = await this.createRuntime({
				cwd: options.cwd,
				url: normalizedUrl,
				viewport,
				headless: params.headless ?? false,
				allowExternal: params.allowExternal ?? false,
			})
		} else {
			await runtime.page.setViewportSize({ width: viewport.width, height: viewport.height })
			runtime.metadata.viewport = viewport
			runtime.metadata.headless = params.headless ?? runtime.metadata.headless
			runtime.metadata.allowExternal = params.allowExternal ?? runtime.metadata.allowExternal
			runtime.metadata.status = "opening"
		}

		this.currentSessionId = runtime.metadata.sessionId
		runtime.page.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT_MS)
		await runtime.page.goto(normalizedUrl, {
			waitUntil: "domcontentloaded",
			timeout: DEFAULT_NAVIGATION_TIMEOUT_MS,
		})
		await runtime.page
			.waitForLoadState("networkidle", { timeout: DEFAULT_ACTION_TIMEOUT_MS })
			.catch(() => undefined)
		this.touchSession(runtime, { status: "active", url: runtime.page.url() })
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: "visual_browser_open",
				session: runtime.metadata,
				message:
					"Controlled Playwright browser session opened. Screenshots and crops are stored locally under .roo/visual-browser-inspector.",
			},
			options,
		)
	}

	private async navigate(
		params: VisualBrowserNavigationParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)

		switch (params.action) {
			case "visual_browser_reload":
				await runtime.page.reload({ waitUntil: "domcontentloaded", timeout: DEFAULT_NAVIGATION_TIMEOUT_MS })
				break
			case "visual_browser_back":
				await runtime.page.goBack({ waitUntil: "domcontentloaded", timeout: DEFAULT_NAVIGATION_TIMEOUT_MS })
				break
			case "visual_browser_forward":
				await runtime.page.goForward({ waitUntil: "domcontentloaded", timeout: DEFAULT_NAVIGATION_TIMEOUT_MS })
				break
		}

		await runtime.page
			.waitForLoadState("networkidle", { timeout: DEFAULT_ACTION_TIMEOUT_MS })
			.catch(() => undefined)
		this.touchSession(runtime, { status: "active", url: runtime.page.url() })
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: params.action,
				session: runtime.metadata,
				message: `Navigation action ${params.action} completed.`,
			},
			options,
		)
	}

	private async capture(
		params: VisualBrowserCaptureParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)
		await this.applyScreenshotRedactions(runtime.page)

		const screenshotId = `screenshot-${Date.now()}-${crypto.randomUUID()}`
		const screenshotPath = path.join(runtime.metadata.artifacts.screenshotsDir, `${screenshotId}.png`)
		await fs.mkdir(runtime.metadata.artifacts.screenshotsDir, { recursive: true })
		await runtime.page.screenshot({ path: screenshotPath, fullPage: params.fullPage ?? false })

		const image = PNG.sync.read(await fs.readFile(screenshotPath))
		const pageInfo = await runtime.page.evaluate(() => ({
			title: document.title,
			url: location.href,
			pageWidth: Math.max(
				document.documentElement.scrollWidth,
				document.body?.scrollWidth ?? 0,
				window.innerWidth,
			),
			pageHeight: Math.max(
				document.documentElement.scrollHeight,
				document.body?.scrollHeight ?? 0,
				window.innerHeight,
			),
		}))

		const screenshot: VisualBrowserScreenshotMetadata = {
			sessionId: runtime.metadata.sessionId,
			screenshotId,
			url: pageInfo.url,
			title: pageInfo.title,
			path: screenshotPath,
			createdAt: nowIso(),
			viewport: runtime.metadata.viewport,
			pageWidth: image.width || pageInfo.pageWidth,
			pageHeight: image.height || pageInfo.pageHeight,
			fullPage: params.fullPage ?? false,
			redacted: true,
		}

		runtime.screenshots.unshift(screenshot)
		this.touchSession(runtime, { status: "active", url: pageInfo.url })
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: "visual_browser_capture",
				session: runtime.metadata,
				screenshot,
				message: "Redacted screenshot captured locally from the controlled Playwright page.",
			},
			options,
		)
	}

	private async crop(
		params: VisualBrowserCropParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)
		const screenshot = this.findScreenshot(runtime, params.screenshotId)
		const cropId = `crop-${Date.now()}-${crypto.randomUUID()}`
		const cropPath = path.join(runtime.metadata.artifacts.cropsDir, `${cropId}.png`)
		const cropResult = await cropPngRegion(screenshot.path, cropPath, normalizeBoundingBox(params.region))
		const elements = await this.collectRegionElements(runtime.page, cropResult.region, screenshot.fullPage)

		const crop: VisualBrowserCropMetadata = {
			sessionId: runtime.metadata.sessionId,
			cropId,
			screenshotId: screenshot.screenshotId,
			url: screenshot.url,
			path: cropPath,
			createdAt: nowIso(),
			viewport: screenshot.viewport,
			region: cropResult.region,
			elements,
		}

		runtime.crops.unshift(crop)
		this.touchSession(runtime)
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: "visual_browser_crop",
				session: runtime.metadata,
				crop,
				message: "Crop saved locally and linked to screenshot, viewport, URL, and intersecting DOM elements.",
			},
			options,
		)
	}

	private async inspectPoint(
		params: VisualBrowserInspectorToolParams & { action: "visual_browser_inspect_point" },
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)
		const screenshot = params.screenshotId ? this.findScreenshot(runtime, params.screenshotId) : undefined
		const pointInspection = await runtime.page.evaluate(
			({ x, y, isFullPage, screenshotId }) => {
				const sensitiveTextPattern =
					/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\d[ -]*?){13,19}|\+?\d[\d ().-]{7,}\d)/gi
				const redact = (value: string | null | undefined): string | undefined => {
					if (!value) {
						return value ?? undefined
					}

					const normalized = value.replace(/\s+/g, " ").trim()
					if (!normalized) {
						return ""
					}

					if (/password|passwd|secret|token|api[-_]?key|credential|security code/i.test(normalized)) {
						return "[redacted]"
					}

					const redacted = normalized.replace(sensitiveTextPattern, "[redacted]")
					return redacted.length > 180 ? `${redacted.slice(0, 180)}…` : redacted
				}
				const escapePart = (value: string): string => {
					if (typeof CSS !== "undefined" && CSS.escape) {
						return CSS.escape(value)
					}

					return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&")
				}
				const selectorFor = (element: Element): string => {
					const html = element as HTMLElement
					if (html.id) {
						return `#${escapePart(html.id)}`
					}

					const testId = html.getAttribute("data-testid") || html.getAttribute("data-test")
					if (testId) {
						return `${element.tagName.toLowerCase()}[data-testid="${testId.replace(/"/g, '\\"')}"]`
					}

					const ariaLabel = html.getAttribute("aria-label")
					if (ariaLabel) {
						return `${element.tagName.toLowerCase()}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`
					}

					const parent = element.parentElement
					if (!parent) {
						return element.tagName.toLowerCase()
					}

					const siblings = Array.from(parent.children).filter(
						(sibling) => sibling.tagName === element.tagName,
					)
					const index = siblings.indexOf(element) + 1
					return `${selectorFor(parent)} > ${element.tagName.toLowerCase()}:nth-of-type(${Math.max(1, index)})`
				}
				const toMetadata = (element: Element) => {
					const html = element as HTMLElement
					const rect = html.getBoundingClientRect()
					const style = getComputedStyle(html)
					const attributes: Record<string, string> = {}
					for (const attribute of Array.from(html.attributes)) {
						const lower = attribute.name.toLowerCase()
						attributes[attribute.name] =
							lower === "value" ||
							lower.includes("password") ||
							lower.includes("token") ||
							html.closest("[data-roo-redact]")
								? "[redacted]"
								: (redact(attribute.value) ?? "")
					}

					const sourceMapping: Record<string, string> = {}
					for (const key of [
						"data-source",
						"data-source-file",
						"data-file",
						"data-component",
						"data-testid",
						"data-test",
					]) {
						const value = html.getAttribute(key)
						if (value) {
							sourceMapping[key] = value
						}
					}

					return {
						tagName: element.tagName.toLowerCase(),
						selector: selectorFor(element),
						text: html.closest("[data-roo-redact]")
							? "[redacted]"
							: redact(html.innerText || html.textContent || ""),
						role: html.getAttribute("role"),
						ariaLabel: html.closest("[data-roo-redact]")
							? "[redacted]"
							: (redact(html.getAttribute("aria-label")) ?? null),
						attributes,
						boundingBox: {
							x: Math.round(rect.left + window.scrollX),
							y: Math.round(rect.top + window.scrollY),
							width: Math.round(rect.width),
							height: Math.round(rect.height),
						},
						visible:
							style.display !== "none" &&
							style.visibility !== "hidden" &&
							Number(style.opacity || "1") > 0 &&
							rect.width > 0 &&
							rect.height > 0,
						computedStyles: {
							display: style.display,
							position: style.position,
							zIndex: style.zIndex,
							color: style.color,
							backgroundColor: style.backgroundColor,
							fontFamily: style.fontFamily,
							fontSize: style.fontSize,
							fontWeight: style.fontWeight,
							lineHeight: style.lineHeight,
							overflow: style.overflow,
							overflowX: style.overflowX,
							overflowY: style.overflowY,
							opacity: style.opacity,
							visibility: style.visibility,
						},
						sourceMapping,
					}
				}

				const viewportX = isFullPage ? x - window.scrollX : x
				const viewportY = isFullPage ? y - window.scrollY : y
				const element = document.elementFromPoint(viewportX, viewportY)
				if (!element) {
					return { element: null, issues: [] }
				}

				const ancestors = []
				let current = element.parentElement
				while (current && current !== document.body && ancestors.length < 8) {
					ancestors.push(toMetadata(current))
					current = current.parentElement
				}

				const metadata = toMetadata(element)
				return {
					element: { ...metadata, ancestors },
					issues: metadata.visible
						? []
						: [
								{
									severity: "minor" as const,
									confidence: 0.7,
									title: "Selected element is not visible",
									visualEvidence:
										"The element at the selected point reports hidden, transparent, or zero-sized computed layout.",
									screenshotId: screenshotId ?? "",
									cropId: null,
									selectorOrElement: metadata.selector,
									boundingBox: metadata.boundingBox,
									likelyCause:
										"CSS display, visibility, opacity, or layout size prevents visible rendering.",
									suggestedFix:
										"Inspect computed CSS and layout constraints for this element and its ancestors.",
									filesToInspect: Object.values(metadata.sourceMapping ?? {}).filter(Boolean),
								},
							],
				}
			},
			{ x: params.x, y: params.y, isFullPage: screenshot?.fullPage ?? false, screenshotId: params.screenshotId },
		)

		const inspection: VisualBrowserInspectionResult = {
			sessionId: runtime.metadata.sessionId,
			screenshotId: params.screenshotId,
			url: runtime.page.url(),
			viewport: runtime.metadata.viewport,
			point: { x: params.x, y: params.y },
			element: pointInspection.element,
			issues: pointInspection.issues,
		}

		runtime.inspections.unshift(inspection)
		this.touchSession(runtime, { url: runtime.page.url() })
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: "visual_browser_inspect_point",
				session: runtime.metadata,
				inspection,
				message: "Point inspection completed with redacted DOM metadata.",
			},
			options,
		)
	}

	private async inspectRegion(
		params: VisualBrowserInspectorToolParams & { action: "visual_browser_inspect_region" },
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)
		const screenshot = params.screenshotId ? this.findScreenshot(runtime, params.screenshotId) : undefined
		const region = normalizeBoundingBox(params.region)
		const elements = await this.collectRegionElements(runtime.page, region, screenshot?.fullPage ?? false)
		const issues = await this.collectPageDiagnostics(
			runtime.page,
			params.screenshotId,
			null,
			region,
			screenshot?.fullPage ?? false,
		)
		const inspection: VisualBrowserInspectionResult = {
			sessionId: runtime.metadata.sessionId,
			screenshotId: params.screenshotId,
			url: runtime.page.url(),
			viewport: runtime.metadata.viewport,
			region,
			elements,
			issues,
		}

		runtime.inspections.unshift(inspection)
		this.touchSession(runtime, { url: runtime.page.url() })
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: "visual_browser_inspect_region",
				session: runtime.metadata,
				inspection,
				message: "Region inspection completed with prioritized visible intersecting elements.",
			},
			options,
		)
	}

	private async click(
		params: VisualBrowserClickParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)
		if (params.selector) {
			await runtime.page.locator(params.selector).first().click({ timeout: DEFAULT_ACTION_TIMEOUT_MS })
		} else if (params.x !== undefined && params.y !== undefined) {
			await runtime.page.mouse.click(params.x, params.y)
		} else {
			throw new Error("visual_browser_click requires either selector or x/y coordinates.")
		}

		this.touchSession(runtime, { url: runtime.page.url() })
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: "visual_browser_click",
				session: runtime.metadata,
				message: "Click action completed on the controlled Playwright page.",
			},
			options,
		)
	}

	private async hover(
		params: VisualBrowserHoverParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)
		if (params.selector) {
			await runtime.page.locator(params.selector).first().hover({ timeout: DEFAULT_ACTION_TIMEOUT_MS })
		} else if (params.x !== undefined && params.y !== undefined) {
			await runtime.page.mouse.move(params.x, params.y)
		} else {
			throw new Error("visual_browser_hover requires either selector or x/y coordinates.")
		}

		this.touchSession(runtime, { url: runtime.page.url() })
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: "visual_browser_hover",
				session: runtime.metadata,
				message: "Hover action completed on the controlled Playwright page.",
			},
			options,
		)
	}

	private async type(
		params: VisualBrowserTypeParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)

		if (params.selector) {
			await runtime.page.locator(params.selector).first().click({ timeout: DEFAULT_ACTION_TIMEOUT_MS })
		}

		await runtime.page.keyboard.type(params.text)
		this.touchSession(runtime, { url: runtime.page.url() })
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: "visual_browser_type",
				session: runtime.metadata,
				message: "Typed text into the focused/selected element in the controlled Playwright page.",
			},
			options,
		)
	}

	private async scroll(
		params: VisualBrowserScrollParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)
		await runtime.page.mouse.wheel(params.deltaX ?? 0, params.deltaY ?? 500)
		this.touchSession(runtime, { url: runtime.page.url() })
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: "visual_browser_scroll",
				session: runtime.metadata,
				message: "Scroll action completed on the controlled Playwright page.",
			},
			options,
		)
	}

	private async analyzeScreenshot(
		params: VisualBrowserAnalyzeScreenshotParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)
		const screenshot = this.findScreenshot(runtime, params.screenshotId)
		const issues = await this.collectPageDiagnostics(
			runtime.page,
			screenshot.screenshotId,
			null,
			undefined,
			screenshot.fullPage,
		)
		const analysis: VisualBrowserAnalysisResult = {
			summary: `MVP local heuristic analysis${params.prompt ? ` for prompt: ${redactVisualBrowserText(params.prompt)}` : ""}. Found ${issues.length} potential visual/UI issue(s). No screenshot was sent to a remote model by this fallback.`,
			issues,
		}

		runtime.findings.unshift(analysis)
		this.touchSession(runtime)
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: "visual_browser_analyze_screenshot",
				session: runtime.metadata,
				screenshot,
				analysis,
				message: "Screenshot analysis used local MVP heuristics only.",
			},
			options,
		)
	}

	private async analyzeCrop(
		params: VisualBrowserAnalyzeCropParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)
		const crop = this.findCrop(runtime, params.cropId)
		const screenshot = this.findScreenshot(runtime, crop.screenshotId)
		const issues = await this.collectPageDiagnostics(
			runtime.page,
			screenshot.screenshotId,
			crop.cropId,
			crop.region,
			screenshot.fullPage,
		)
		const analysis: VisualBrowserAnalysisResult = {
			summary: `MVP local heuristic crop analysis${params.prompt ? ` for prompt: ${redactVisualBrowserText(params.prompt)}` : ""}. Found ${issues.length} potential issue(s) in the selected region. No crop was sent to a remote model by this fallback.`,
			issues,
		}

		runtime.findings.unshift(analysis)
		this.touchSession(runtime)
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: "visual_browser_analyze_crop",
				session: runtime.metadata,
				crop,
				analysis,
				message: "Crop analysis used local MVP heuristics only.",
			},
			options,
		)
	}

	private async close(
		params: VisualBrowserCloseParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)
		await this.closeRuntime(runtime)
		this.sessions.delete(runtime.metadata.sessionId)
		if (this.currentSessionId === runtime.metadata.sessionId) {
			this.currentSessionId = undefined
		}
		await this.persist(runtime)

		return this.decorateResult(
			{
				action: "visual_browser_close",
				session: runtime.metadata,
				message: "Controlled Playwright browser session closed. Local artifacts remain on disk.",
			},
			options,
		)
	}

	private async deleteSession(
		params: VisualBrowserDeleteSessionParams,
		options: VisualBrowserExecuteOptions,
	): Promise<VisualBrowserToolResult> {
		const runtime = this.resolveRuntime(params.sessionId)
		await this.closeRuntime(runtime)
		this.sessions.delete(runtime.metadata.sessionId)
		if (this.currentSessionId === runtime.metadata.sessionId) {
			this.currentSessionId = undefined
		}

		const session = { ...runtime.metadata }
		await fs.rm(runtime.metadata.artifacts.rootDir, { recursive: true, force: true })

		return this.decorateResult(
			{
				action: "visual_browser_delete_session",
				session,
				message: "Controlled browser session closed and local Visual Browser Inspector artifacts deleted.",
			},
			options,
		)
	}

	private async createRuntime(options: {
		cwd: string
		url: string
		viewport: VisualBrowserViewport
		headless: boolean
		allowExternal: boolean
	}): Promise<VisualBrowserSessionRuntime> {
		const sessionId = createSessionId()
		const artifacts = createArtifactPaths(options.cwd, sessionId)
		const createdAt = nowIso()
		const { chromium } = await loadPlaywrightRuntime()
		const browser = await chromium.launch({ headless: options.headless })
		const context = await browser.newContext({
			viewport: { width: options.viewport.width, height: options.viewport.height },
			deviceScaleFactor: options.viewport.deviceScaleFactor ?? 1,
			isMobile: options.viewport.isMobile ?? false,
			hasTouch: options.viewport.hasTouch ?? false,
		})
		const page = await context.newPage()
		page.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT_MS)

		const runtime: VisualBrowserSessionRuntime = {
			browser,
			context,
			page,
			metadata: {
				sessionId,
				status: "opening",
				url: options.url,
				createdAt,
				updatedAt: createdAt,
				viewport: options.viewport,
				headless: options.headless,
				allowExternal: options.allowExternal,
				artifacts,
			},
			screenshots: [],
			crops: [],
			inspections: [],
			findings: [],
		}

		this.sessions.set(sessionId, runtime)
		return runtime
	}

	private resolveRuntime(sessionId?: string): VisualBrowserSessionRuntime {
		const resolvedSessionId = sessionId ?? this.currentSessionId

		if (!resolvedSessionId) {
			throw new Error("No Visual Browser Inspector session is active. Open a controlled browser session first.")
		}

		const runtime = this.sessions.get(resolvedSessionId)
		if (!runtime) {
			throw new Error(`Visual Browser Inspector session ${resolvedSessionId} is not active.`)
		}

		return runtime
	}

	private findScreenshot(
		runtime: VisualBrowserSessionRuntime,
		screenshotId: string,
	): VisualBrowserScreenshotMetadata {
		const screenshot = runtime.screenshots.find((entry) => entry.screenshotId === screenshotId)

		if (!screenshot) {
			throw new Error(`Screenshot ${screenshotId} was not found for session ${runtime.metadata.sessionId}.`)
		}

		return screenshot
	}

	private findCrop(runtime: VisualBrowserSessionRuntime, cropId: string): VisualBrowserCropMetadata {
		const crop = runtime.crops.find((entry) => entry.cropId === cropId)

		if (!crop) {
			throw new Error(`Crop ${cropId} was not found for session ${runtime.metadata.sessionId}.`)
		}

		return crop
	}

	private touchSession(
		runtime: VisualBrowserSessionRuntime,
		updates: Partial<Pick<VisualBrowserSessionMetadata, "status" | "url" | "error">> = {},
	): void {
		runtime.metadata = {
			...runtime.metadata,
			...updates,
			updatedAt: nowIso(),
		}
	}

	private async closeRuntime(runtime: VisualBrowserSessionRuntime): Promise<void> {
		try {
			await runtime.context.close().catch(() => undefined)
			await runtime.browser.close().catch(() => undefined)
		} finally {
			this.touchSession(runtime, { status: "closed", url: runtime.metadata.url })
			runtime.metadata.closedAt = nowIso()
		}
	}

	private async persist(runtime: VisualBrowserSessionRuntime): Promise<void> {
		const serialized: SerializedVisualBrowserSession = {
			session: runtime.metadata,
			screenshots: runtime.screenshots,
			crops: runtime.crops,
			inspections: runtime.inspections,
			findings: runtime.findings,
		}

		await safeWriteJson(runtime.metadata.artifacts.metadataPath, serialized, { prettyPrint: true })

		if (runtime.metadata.artifacts.findingsPath) {
			await safeWriteJson(runtime.metadata.artifacts.findingsPath, runtime.findings, { prettyPrint: true })
		}
	}

	private decorateResult(
		result: VisualBrowserToolResult,
		options: VisualBrowserExecuteOptions,
	): VisualBrowserToolResult {
		return {
			...result,
			screenshot: result.screenshot ? withWebviewScreenshotUri(result.screenshot, options) : undefined,
			crop: result.crop ? withWebviewCropUri(result.crop, options) : undefined,
		}
	}

	private createPanelState(
		runtime: VisualBrowserSessionRuntime,
		options: VisualBrowserExecuteOptions,
	): VisualBrowserPanelState {
		return {
			session: runtime.metadata,
			screenshots: runtime.screenshots.map((screenshot) => withWebviewScreenshotUri(screenshot, options)),
			crops: runtime.crops.map((crop) => withWebviewCropUri(crop, options)),
			inspections: runtime.inspections,
			findings: runtime.findings,
			statusMessage:
				runtime.metadata.status === "active"
					? "Controlled Playwright browser session is active. Capture only this browser page."
					: `Session status: ${runtime.metadata.status}`,
		}
	}

	private async applyScreenshotRedactions(page: Page): Promise<void> {
		await page.evaluate(() => {
			const sensitivePattern =
				/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\d[ -]*?){13,19}|\+?\d[\d ().-]{7,}\d|password|passwd|secret|token|api[-_]?key|credential)/i
			const candidates = new Set<HTMLElement>()

			for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-roo-redact]"))) {
				candidates.add(element)
			}

			for (const element of Array.from(
				document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
					"input, textarea, select",
				),
			)) {
				const input = element as HTMLInputElement
				const attributes = [
					input.type,
					input.name,
					input.id,
					input.autocomplete,
					input.getAttribute("aria-label"),
				]
				const value = "value" in input ? input.value : ""
				if (
					attributes.some((attribute) => sensitivePattern.test(attribute ?? "")) ||
					sensitivePattern.test(value ?? "")
				) {
					candidates.add(element)
				}
			}

			for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
				if (
					element.children.length === 0 &&
					sensitivePattern.test(element.innerText || element.textContent || "")
				) {
					candidates.add(element)
				}
			}

			for (const element of candidates) {
				element.dataset.rooVbiRedacted = "true"
				element.style.setProperty("filter", "blur(8px)", "important")
				element.style.setProperty("color", "transparent", "important")
				element.style.setProperty("text-shadow", "0 0 0 rgba(0,0,0,0.6)", "important")
				element.style.setProperty("background-color", "rgba(0,0,0,0.35)", "important")
			}
		})
	}

	private async collectRegionElements(
		page: Page,
		region: VisualBrowserBoundingBox,
		regionIsFullPage: boolean,
	): Promise<VisualBrowserElementMetadata[]> {
		return page.evaluate(
			({ region, regionIsFullPage, maxRegionElements }) => {
				const sensitiveTextPattern =
					/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\d[ -]*?){13,19}|\+?\d[\d ().-]{7,}\d)/gi
				const redact = (value: string | null | undefined): string | undefined => {
					if (!value) {
						return value ?? undefined
					}

					const normalized = value.replace(/\s+/g, " ").trim()
					if (!normalized) {
						return ""
					}

					if (/password|passwd|secret|token|api[-_]?key|credential|security code/i.test(normalized)) {
						return "[redacted]"
					}

					const redacted = normalized.replace(sensitiveTextPattern, "[redacted]")
					return redacted.length > 180 ? `${redacted.slice(0, 180)}…` : redacted
				}
				const escapePart = (value: string): string => {
					if (typeof CSS !== "undefined" && CSS.escape) {
						return CSS.escape(value)
					}

					return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&")
				}
				const selectorFor = (element: Element): string => {
					const html = element as HTMLElement
					if (html.id) {
						return `#${escapePart(html.id)}`
					}

					const testId = html.getAttribute("data-testid") || html.getAttribute("data-test")
					if (testId) {
						return `${element.tagName.toLowerCase()}[data-testid="${testId.replace(/"/g, '\\"')}"]`
					}

					const parent = element.parentElement
					if (!parent) {
						return element.tagName.toLowerCase()
					}

					const siblings = Array.from(parent.children).filter(
						(sibling) => sibling.tagName === element.tagName,
					)
					const index = siblings.indexOf(element) + 1
					const parentSelector = parent === document.body ? "body" : selectorFor(parent)
					return `${parentSelector} > ${element.tagName.toLowerCase()}:nth-of-type(${Math.max(1, index)})`
				}
				const toMetadata = (element: Element) => {
					const html = element as HTMLElement
					const rect = html.getBoundingClientRect()
					const style = getComputedStyle(html)
					const attributes: Record<string, string> = {}
					for (const attribute of Array.from(html.attributes)) {
						const lower = attribute.name.toLowerCase()
						attributes[attribute.name] =
							lower === "value" ||
							lower.includes("password") ||
							lower.includes("token") ||
							html.closest("[data-roo-redact]")
								? "[redacted]"
								: (redact(attribute.value) ?? "")
					}

					const sourceMapping: Record<string, string> = {}
					for (const key of [
						"data-source",
						"data-source-file",
						"data-file",
						"data-component",
						"data-testid",
						"data-test",
					]) {
						const value = html.getAttribute(key)
						if (value) {
							sourceMapping[key] = value
						}
					}

					return {
						tagName: element.tagName.toLowerCase(),
						selector: selectorFor(element),
						text: html.closest("[data-roo-redact]")
							? "[redacted]"
							: redact(html.innerText || html.textContent || ""),
						role: html.getAttribute("role"),
						ariaLabel: html.closest("[data-roo-redact]")
							? "[redacted]"
							: (redact(html.getAttribute("aria-label")) ?? null),
						attributes,
						boundingBox: {
							x: Math.round(rect.left + window.scrollX),
							y: Math.round(rect.top + window.scrollY),
							width: Math.round(rect.width),
							height: Math.round(rect.height),
						},
						visible:
							style.display !== "none" &&
							style.visibility !== "hidden" &&
							Number(style.opacity || "1") > 0 &&
							rect.width > 0 &&
							rect.height > 0,
						computedStyles: {
							display: style.display,
							position: style.position,
							zIndex: style.zIndex,
							color: style.color,
							backgroundColor: style.backgroundColor,
							fontFamily: style.fontFamily,
							fontSize: style.fontSize,
							fontWeight: style.fontWeight,
							lineHeight: style.lineHeight,
							overflow: style.overflow,
							overflowX: style.overflowX,
							overflowY: style.overflowY,
							opacity: style.opacity,
							visibility: style.visibility,
						},
						sourceMapping,
					}
				}
				const intersects = (box: { x: number; y: number; width: number; height: number }) =>
					box.x < region.x + region.width &&
					box.x + box.width > region.x &&
					box.y < region.y + region.height &&
					box.y + box.height > region.y
				const documentRegion = regionIsFullPage
					? region
					: { ...region, x: region.x + window.scrollX, y: region.y + window.scrollY }

				return Array.from(document.querySelectorAll("body *"))
					.map(toMetadata)
					.filter((element) => element.visible && intersects(element.boundingBox))
					.sort((left, right) => {
						const leftInteractive =
							/^(button|a|input|select|textarea)$/.test(left.tagName) ||
							/button|link/i.test(left.role ?? "")
						const rightInteractive =
							/^(button|a|input|select|textarea)$/.test(right.tagName) ||
							/button|link/i.test(right.role ?? "")
						if (leftInteractive !== rightInteractive) {
							return leftInteractive ? -1 : 1
						}

						return (
							left.boundingBox.width * left.boundingBox.height -
							right.boundingBox.width * right.boundingBox.height
						)
					})
					.slice(0, maxRegionElements)
					.map((element) => ({ ...element, boundingBox: element.boundingBox, region: documentRegion }))
			},
			{ region, regionIsFullPage, maxRegionElements: MAX_REGION_ELEMENTS },
		)
	}

	private async collectPageDiagnostics(
		page: Page,
		screenshotId: string | undefined,
		cropId: string | null,
		region?: VisualBrowserBoundingBox,
		regionIsFullPage = false,
	): Promise<VisualBrowserIssue[]> {
		return page.evaluate(
			({ screenshotId, cropId, region, regionIsFullPage }) => {
				const escapePart = (value: string): string => {
					if (typeof CSS !== "undefined" && CSS.escape) {
						return CSS.escape(value)
					}

					return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&")
				}
				const selectorFor = (element: Element): string => {
					const html = element as HTMLElement
					if (html.id) {
						return `#${escapePart(html.id)}`
					}

					const testId = html.getAttribute("data-testid") || html.getAttribute("data-test")
					if (testId) {
						return `${element.tagName.toLowerCase()}[data-testid="${testId.replace(/"/g, '\\"')}"]`
					}

					return element.tagName.toLowerCase()
				}
				const bboxFor = (element: Element) => {
					const rect = (element as HTMLElement).getBoundingClientRect()
					return {
						x: Math.round(rect.left + window.scrollX),
						y: Math.round(rect.top + window.scrollY),
						width: Math.round(rect.width),
						height: Math.round(rect.height),
					}
				}
				const intersects = (box: { x: number; y: number; width: number; height: number }) => {
					if (!region) {
						return true
					}

					const documentRegion = regionIsFullPage
						? region
						: { ...region, x: region.x + window.scrollX, y: region.y + window.scrollY }
					return (
						box.x < documentRegion.x + documentRegion.width &&
						box.x + box.width > documentRegion.x &&
						box.y < documentRegion.y + documentRegion.height &&
						box.y + box.height > documentRegion.y
					)
				}
				const sourceFiles = (element: Element): string[] => {
					const html = element as HTMLElement
					return [
						html.getAttribute("data-source"),
						html.getAttribute("data-source-file"),
						html.getAttribute("data-file"),
					]
						.filter((value): value is string => Boolean(value))
						.slice(0, 5)
				}
				const issueFor = (
					element: Element,
					issue: Omit<
						VisualBrowserIssue,
						"screenshotId" | "cropId" | "selectorOrElement" | "boundingBox" | "filesToInspect"
					>,
				): VisualBrowserIssue => ({
					...issue,
					screenshotId: screenshotId ?? "",
					cropId,
					selectorOrElement: selectorFor(element),
					boundingBox: bboxFor(element),
					filesToInspect: sourceFiles(element),
				})
				const parseRgb = (value: string): [number, number, number] | undefined => {
					const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
					if (!match || match[4] === "0") {
						return undefined
					}

					return [Number(match[1]), Number(match[2]), Number(match[3])]
				}
				const luminance = ([r, g, b]: [number, number, number]) => {
					const values = [r, g, b].map((component) => {
						const channel = component / 255
						return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
					})

					return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]
				}
				const contrastRatio = (foreground: [number, number, number], background: [number, number, number]) => {
					const left = luminance(foreground)
					const right = luminance(background)
					return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)
				}
				const visibleElements = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter(
					(element) => {
						const rect = element.getBoundingClientRect()
						const style = getComputedStyle(element)
						return (
							style.display !== "none" &&
							style.visibility !== "hidden" &&
							Number(style.opacity || "1") > 0 &&
							rect.width > 0 &&
							rect.height > 0 &&
							intersects(bboxFor(element))
						)
					},
				)
				const issues: VisualBrowserIssue[] = []

				if (document.documentElement.scrollWidth > window.innerWidth + 2) {
					issues.push({
						severity: "major",
						confidence: 0.86,
						title: "Horizontal overflow detected",
						visualEvidence: `Document width ${document.documentElement.scrollWidth}px exceeds viewport width ${window.innerWidth}px.`,
						screenshotId: screenshotId ?? "",
						cropId,
						selectorOrElement: "document.documentElement",
						boundingBox: {
							x: 0,
							y: 0,
							width: document.documentElement.scrollWidth,
							height: window.innerHeight,
						},
						likelyCause:
							"A fixed-width element, unwrapped content, or off-canvas positioning exceeds the viewport.",
						suggestedFix: "Inspect large containers and add responsive max-width/overflow wrapping rules.",
						filesToInspect: [],
					})
				}

				for (const element of visibleElements) {
					const box = bboxFor(element)
					const style = getComputedStyle(element)
					const tag = element.tagName.toLowerCase()
					const role = element.getAttribute("role") ?? ""

					if (
						(/^(button|a|input|select|textarea)$/.test(tag) || /button|link|checkbox|radio/i.test(role)) &&
						(box.width < 44 || box.height < 44)
					) {
						issues.push(
							issueFor(element, {
								severity: "minor",
								confidence: 0.78,
								title: "Tiny tap target",
								visualEvidence: `Interactive element is ${box.width}×${box.height}px, below the common 44×44px tap target guideline.`,
								likelyCause:
									"Touch target padding or explicit dimensions are too small for mobile interaction.",
								suggestedFix:
									"Increase padding/min-width/min-height or provide a larger clickable wrapper.",
							}),
						)
					}

					if (box.x < 0 || box.y < 0 || box.x + box.width > window.scrollX + window.innerWidth + 1) {
						issues.push(
							issueFor(element, {
								severity: "major",
								confidence: 0.75,
								title: "Element extends outside the viewport",
								visualEvidence: `Element bounds ${box.x},${box.y},${box.width}×${box.height} exceed visible viewport width ${window.innerWidth}px.`,
								likelyCause:
									"Absolute positioning, transforms, or fixed width layout pushes content outside the viewport.",
								suggestedFix:
									"Use responsive constraints and verify left/right positioning for the active viewport.",
							}),
						)
					}

					if (
						(style.overflow === "hidden" || style.overflowX === "hidden" || style.overflowY === "hidden") &&
						(element.scrollWidth > element.clientWidth + 2 ||
							element.scrollHeight > element.clientHeight + 2)
					) {
						issues.push(
							issueFor(element, {
								severity: "minor",
								confidence: 0.72,
								title: "Potential clipped content",
								visualEvidence:
									"Element has hidden overflow while its scroll size exceeds its client size.",
								likelyCause: "Fixed height/width with overflow hidden may clip text or child content.",
								suggestedFix:
									"Allow wrapping/auto height or review overflow behavior at this viewport.",
							}),
						)
					}

					const fontSize = Number.parseFloat(style.fontSize || "0")
					if ((element.innerText || "").trim().length > 0 && fontSize > 0 && fontSize < 12) {
						issues.push(
							issueFor(element, {
								severity: "minor",
								confidence: 0.64,
								title: "Small text detected",
								visualEvidence: `Rendered font size is ${style.fontSize}.`,
								likelyCause: "Typography scale or responsive style makes text hard to read.",
								suggestedFix: "Increase font size or adjust responsive typography tokens.",
							}),
						)
					}

					if (
						(style.position === "fixed" || style.position === "sticky") &&
						box.height > window.innerHeight * 0.22 &&
						box.y <= window.scrollY + 8
					) {
						issues.push(
							issueFor(element, {
								severity: "major",
								confidence: 0.7,
								title: "Sticky/fixed element may cover content",
								visualEvidence: `A ${style.position} element occupies ${box.height}px near the top of a ${window.innerHeight}px viewport.`,
								likelyCause: "Persistent header/overlay consumes a large portion of the viewport.",
								suggestedFix:
									"Reduce sticky element height, add scroll margins, or verify overlay dismissal behavior.",
							}),
						)
					}

					if (tag === "img") {
						const image = element as HTMLImageElement
						if (image.complete && image.naturalWidth === 0) {
							issues.push(
								issueFor(element, {
									severity: "major",
									confidence: 0.9,
									title: "Broken image",
									visualEvidence: "Image reports complete loading with naturalWidth 0.",
									likelyCause: "The image URL failed, is invalid, or returned unsupported content.",
									suggestedFix:
										"Verify the image source URL, bundling, and fallback alt/placeholder behavior.",
								}),
							)
						}
					}

					if ((element.innerText || "").trim().length > 0) {
						const foreground = parseRgb(style.color)
						let background = parseRgb(style.backgroundColor)
						let parent = element.parentElement
						while (!background && parent) {
							background = parseRgb(getComputedStyle(parent).backgroundColor)
							parent = parent.parentElement
						}

						if (foreground && background && contrastRatio(foreground, background) < 3) {
							issues.push(
								issueFor(element, {
									severity: "minor",
									confidence: 0.58,
									title: "Low text contrast",
									visualEvidence: `Estimated text/background contrast is below 3:1 (${style.color} on ${style.backgroundColor}).`,
									likelyCause:
										"Foreground and background colors are too similar for reliable readability.",
									suggestedFix:
										"Adjust color tokens to meet WCAG contrast targets for the text size.",
								}),
							)
						}
					}
				}

				const interactive = visibleElements.filter((element) =>
					/^(button|a|input|select|textarea)$/.test(element.tagName.toLowerCase()),
				)
				for (let leftIndex = 0; leftIndex < interactive.length; leftIndex++) {
					for (let rightIndex = leftIndex + 1; rightIndex < interactive.length; rightIndex++) {
						const left = bboxFor(interactive[leftIndex])
						const right = bboxFor(interactive[rightIndex])
						const overlapWidth = Math.max(
							0,
							Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
						)
						const overlapHeight = Math.max(
							0,
							Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
						)
						const overlapArea = overlapWidth * overlapHeight
						if (
							overlapArea > 0 &&
							overlapArea > Math.min(left.width * left.height, right.width * right.height) * 0.25
						) {
							issues.push(
								issueFor(interactive[leftIndex], {
									severity: "major",
									confidence: 0.68,
									title: "Interactive elements overlap",
									visualEvidence: "Two interactive elements have overlapping bounding boxes.",
									likelyCause:
										"Positioning, margins, transforms, or responsive wrapping places controls on top of each other.",
									suggestedFix:
										"Inspect layout rules around the overlapping controls and add spacing/wrapping constraints.",
								}),
							)
						}
					}
				}

				return issues.slice(0, 40)
			},
			{ screenshotId, cropId, region, regionIsFullPage },
		)
	}
}

export const visualBrowserInspectorService = new VisualBrowserInspectorService()

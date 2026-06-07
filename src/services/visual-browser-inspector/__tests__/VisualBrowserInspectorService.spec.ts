import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { PNG } from "pngjs"

vi.mock("playwright", () => {
	throw new Error("VisualBrowserInspectorService must not resolve Playwright during module import")
})

import {
	buildVisualBrowserChangeTaskPrompt,
	buildVisualBrowserFixTaskPrompt,
	buildVisualBrowserLocalPreviewTaskPrompt,
	cropPngRegion,
	isVisualBrowserLocalUrl,
	normalizeVisualBrowserUrl,
	redactVisualBrowserText,
	visualBrowserWebviewRequestToToolParams,
} from "../VisualBrowserInspectorService"

describe("VisualBrowserInspectorService helpers", () => {
	it("does not load Playwright when helper-only service module exports are imported", () => {
		expect(normalizeVisualBrowserUrl("localhost:3000")).toBe("http://localhost:3000")
	})

	it("normalizes URLs and detects localhost or private targets", () => {
		expect(normalizeVisualBrowserUrl("localhost:3000")).toBe("http://localhost:3000")
		expect(isVisualBrowserLocalUrl("http://localhost:3000")).toBe(true)
		expect(isVisualBrowserLocalUrl("http://127.0.0.1:5173")).toBe(true)
		expect(isVisualBrowserLocalUrl("http://192.168.1.10")).toBe(true)
		expect(isVisualBrowserLocalUrl("https://example.com")).toBe(false)
	})

	it("redacts sensitive visual text before returning DOM metadata", () => {
		expect(redactVisualBrowserText("Contact clayton@example.com for help")).toContain("[redacted-email]")
		expect(redactVisualBrowserText("Call +44 7700 900123 today")).toContain("[redacted-phone]")
		expect(redactVisualBrowserText("4111 1111 1111 1111")).toBe("[redacted-card]")
		expect(redactVisualBrowserText("password: hunter2")).toBe("[redacted]")
	})

	it("maps webview requests to native tool params", () => {
		expect(
			visualBrowserWebviewRequestToToolParams({
				action: "open",
				url: "http://localhost:3000",
				viewport: "mobile",
			}),
		).toEqual({
			action: "visual_browser_open",
			url: "http://localhost:3000",
			viewport: "mobile",
			headless: false,
			allowExternal: undefined,
		})

		expect(visualBrowserWebviewRequestToToolParams({ action: "get_state" })).toBeUndefined()
		expect(
			visualBrowserWebviewRequestToToolParams({
				action: "start_fix_task",
				sessionId: "session-1",
				scope: "all",
			}),
		).toBeUndefined()
		expect(
			visualBrowserWebviewRequestToToolParams({
				action: "start_change_task",
				sessionId: "session-1",
				instruction: "Make the checkout CTA more prominent",
			}),
		).toBeUndefined()
		expect(
			visualBrowserWebviewRequestToToolParams({
				action: "start_local_preview_task",
				url: "http://localhost:5173",
				sessionId: "session-1",
				viewport: "desktop",
			}),
		).toBeUndefined()
	})

	it("builds a safe local-preview helper task prompt with strict non-destructive constraints", () => {
		const prompt = buildVisualBrowserLocalPreviewTaskPrompt(
			{
				session: {
					sessionId: "session-1",
					status: "active",
					url: "http://localhost:3000?token=secret-value",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					viewport: { name: "mobile", width: 390, height: 844 },
					headless: false,
					allowExternal: false,
					artifacts: {
						rootDir: ".roo/visual-browser-inspector/session-1",
						screenshotsDir: ".roo/visual-browser-inspector/session-1/screenshots",
						cropsDir: ".roo/visual-browser-inspector/session-1/crops",
						metadataPath: ".roo/visual-browser-inspector/session-1/metadata.json",
					},
				},
				screenshots: [],
				crops: [],
				inspections: [],
				findings: [],
			},
			{
				action: "start_local_preview_task",
				url: "localhost:5173?token=secret-value",
				sessionId: "session-1",
				viewport: "desktop",
			},
		)

		expect(prompt).toContain("Prepare a safe local preview for Visual Browser Inspector.")
		expect(prompt).toContain("Do not edit files.")
		expect(prompt).toContain("Do not install packages or modify dependencies.")
		expect(prompt).toContain("Do not delete files")
		expect(prompt).toContain("Do not run database migrations")
		expect(prompt).toContain("Do not commit, push, merge, rebase, or change branches.")
		expect(prompt).toContain("Prefer an already-running localhost/private preview")
		expect(prompt).toContain("LOCAL_PREVIEW_URL=<url>")
		expect(prompt).toContain("visual_browser_open")
		expect(prompt).toContain("allowExternal false")
		expect(prompt).toContain("localhost, 127.0.0.1, ::1, .localhost")
		expect(prompt).toContain("[redacted]")
		expect(prompt).not.toContain("secret-value")
	})

	it("builds a privacy-safe follow-up fix task prompt with actionable finding fields", () => {
		const prompt = buildVisualBrowserFixTaskPrompt(
			{
				session: {
					sessionId: "session-1",
					status: "active",
					url: "http://localhost:3000?token=secret-value",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					viewport: { name: "mobile", width: 390, height: 844 },
					headless: false,
					allowExternal: false,
					artifacts: {
						rootDir: ".roo/visual-browser-inspector/session-1",
						screenshotsDir: ".roo/visual-browser-inspector/session-1/screenshots",
						cropsDir: ".roo/visual-browser-inspector/session-1/crops",
						metadataPath: ".roo/visual-browser-inspector/session-1/metadata.json",
						findingsPath: ".roo/visual-browser-inspector/session-1/findings.json",
					},
				},
				screenshots: [
					{
						sessionId: "session-1",
						screenshotId: "shot-1",
						url: "http://localhost:3000",
						path: ".roo/visual-browser-inspector/session-1/screenshots/shot-1.png",
						createdAt: "2026-01-01T00:00:01.000Z",
						viewport: { name: "mobile", width: 390, height: 844 },
						pageWidth: 390,
						pageHeight: 844,
						fullPage: false,
						redacted: true,
					},
				],
				crops: [
					{
						sessionId: "session-1",
						cropId: "crop-1",
						screenshotId: "shot-1",
						url: "http://localhost:3000",
						path: ".roo/visual-browser-inspector/session-1/crops/crop-1.png",
						createdAt: "2026-01-01T00:00:02.000Z",
						viewport: { name: "mobile", width: 390, height: 844 },
						region: { x: 10, y: 20, width: 120, height: 80 },
						elements: [],
					},
				],
				inspections: [],
				findings: [
					{
						summary: "Local heuristic visual/UX analysis. Found 1 actionable issue.",
						analysisMode: "local-heuristic",
						generatedAt: "2026-01-01T00:00:03.000Z",
						scope: "screenshot",
						privacyNotice: "Artifacts remain local.",
						recommendationSummary: "1 major accessibility issue.",
						issues: [
							{
								severity: "major",
								confidence: 0.91,
								title: "Tiny checkout button",
								category: "accessibility",
								fixPriority: "medium",
								visualEvidence: "Button is 24×24px and hard to tap.",
								screenshotId: "shot-1",
								cropId: "crop-1",
								selectorOrElement: "button[data-testid=checkout]",
								boundingBox: { x: 10, y: 20, width: 24, height: 24 },
								userImpact: "Touch users may miss the control.",
								likelyCause: "Icon-only button lacks minimum dimensions.",
								suggestedFix: "Use a minimum 44×44px tap target.",
								recommendation: "Inspect the owning component before changing styles.",
								implementationHint: "Look for the checkout action component and button size tokens.",
								filesToInspect: ["webview-ui/src/components/CheckoutButton.tsx"],
								verificationSteps: ["Re-run the mobile viewport", "Confirm tap target size"],
								relatedArtifacts: [
									{
										type: "screenshot",
										id: "shot-1",
										region: { x: 10, y: 20, width: 24, height: 24 },
									},
								],
							},
						],
					},
				],
			},
			{ action: "start_fix_task", sessionId: "session-1", scope: "issue", findingIndex: 0, issueIndex: 0 },
		)

		expect(prompt).toContain("Fix Visual Browser Inspector findings.")
		expect(prompt).toContain("Tiny checkout button")
		expect(prompt).toContain("Severity/confidence/category/priority: major, 91%, accessibility, medium")
		expect(prompt).toContain("Suggested fix: Use a minimum 44×44px tap target.")
		expect(prompt).toContain("webview-ui/src/components/CheckoutButton.tsx")
		expect(prompt).toContain("Do not blindly apply these recommendations")
		expect(prompt).toContain("do not upload screenshots or crops to a remote service")
		expect(prompt).toContain("[redacted]")
		expect(prompt).not.toContain("secret-value")
	})

	it("builds a full-context custom change task prompt with findings as context only", () => {
		const prompt = buildVisualBrowserChangeTaskPrompt(
			{
				session: {
					sessionId: "session-1",
					status: "active",
					url: "http://localhost:3000?token=secret-value",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					viewport: { name: "mobile", width: 390, height: 844 },
					headless: false,
					allowExternal: false,
					artifacts: {
						rootDir: ".roo/visual-browser-inspector/session-1",
						screenshotsDir: ".roo/visual-browser-inspector/session-1/screenshots",
						cropsDir: ".roo/visual-browser-inspector/session-1/crops",
						metadataPath: ".roo/visual-browser-inspector/session-1/metadata.json",
						findingsPath: ".roo/visual-browser-inspector/session-1/findings.json",
					},
				},
				screenshots: [
					{
						sessionId: "session-1",
						screenshotId: "shot-1",
						url: "http://localhost:3000",
						path: ".roo/visual-browser-inspector/session-1/screenshots/shot-1.png",
						createdAt: "2026-01-01T00:00:01.000Z",
						viewport: { name: "mobile", width: 390, height: 844 },
						pageWidth: 390,
						pageHeight: 844,
						fullPage: false,
						redacted: true,
					},
				],
				crops: [
					{
						sessionId: "session-1",
						cropId: "crop-1",
						screenshotId: "shot-1",
						url: "http://localhost:3000",
						path: ".roo/visual-browser-inspector/session-1/crops/crop-1.png",
						createdAt: "2026-01-01T00:00:02.000Z",
						viewport: { name: "mobile", width: 390, height: 844 },
						region: { x: 10, y: 20, width: 120, height: 80 },
						elements: [],
					},
				],
				inspections: [
					{
						sessionId: "session-1",
						screenshotId: "shot-1",
						cropId: "crop-1",
						url: "http://localhost:3000",
						viewport: { name: "mobile", width: 390, height: 844 },
						point: { x: 40, y: 60 },
						region: { x: 10, y: 20, width: 120, height: 80 },
						element: {
							tagName: "BUTTON",
							selector: "button[data-testid=checkout]",
							text: "Checkout now",
							role: "button",
							ariaLabel: "Checkout",
							attributes: { "data-testid": "checkout", "data-token": "session-secret" },
							boundingBox: { x: 10, y: 20, width: 120, height: 80 },
							visible: true,
							computedStyles: {
								display: "flex",
								position: "relative",
								fontSize: "14px",
								color: "rgb(255, 255, 255)",
								backgroundColor: "rgb(34, 34, 34)",
							},
							sourceMapping: { component: "webview-ui/src/components/HeroCheckout.tsx" },
							ancestors: [
								{
									tagName: "SECTION",
									selector: "#hero",
									text: "Hero",
									role: null,
									ariaLabel: null,
									attributes: { id: "hero" },
									boundingBox: { x: 0, y: 0, width: 390, height: 420 },
									visible: true,
									sourceMapping: { component: "webview-ui/src/components/Hero.tsx" },
								},
							],
						},
					},
					{
						sessionId: "session-1",
						screenshotId: "shot-1",
						url: "http://localhost:3000",
						viewport: { name: "mobile", width: 390, height: 844 },
						element: {
							tagName: "NAV",
							selector: "#legacy-nav",
							attributes: {},
							boundingBox: { x: 0, y: 0, width: 390, height: 64 },
							visible: true,
							ancestors: [],
						},
					},
				],
				findings: [
					{
						summary: "CTA is visually understated.",
						analysisMode: "local-heuristic",
						generatedAt: "2026-01-01T00:00:03.000Z",
						scope: "screenshot",
						privacyNotice: "Artifacts remain local.",
						recommendationSummary: "1 major interaction issue.",
						issues: [
							{
								severity: "major",
								confidence: 0.91,
								title: "Tiny checkout button",
								category: "interaction",
								fixPriority: "medium",
								visualEvidence: "Button is visually quiet compared with surrounding content.",
								screenshotId: "shot-1",
								cropId: "crop-1",
								selectorOrElement: "button[data-testid=checkout]",
								boundingBox: { x: 10, y: 20, width: 120, height: 80 },
								likelyCause: "CTA styling lacks visual weight.",
								suggestedFix: "Increase prominence with existing design tokens.",
								recommendation: "Inspect the owning component before changing styles.",
								filesToInspect: ["webview-ui/src/components/CheckoutButton.tsx"],
							},
						],
					},
				],
			},
			{
				action: "start_change_task",
				sessionId: "session-1",
				instruction: "Make the checkout CTA more prominent and move it above the fold.",
				screenshotId: "shot-1",
				cropId: "crop-1",
				region: { x: 10, y: 20, width: 120, height: 80 },
			},
		)

		expect(prompt).toContain("Implement a specific Visual Browser Inspector change request.")
		expect(prompt).toContain("User intent (verbatim; treat this as the requested visual/UX/content/code change")
		expect(prompt).toContain("Make the checkout CTA more prominent and move it above the fold.")
		expect(prompt).toContain("Visual Browser Inspector context (local artifacts only):")
		expect(prompt).toContain("- URL: [redacted]")
		expect(prompt).toContain("- Session ID: session-1")
		expect(prompt).toContain(
			"- Screenshot context: shot-1 (.roo/visual-browser-inspector/session-1/screenshots/shot-1.png)",
		)
		expect(prompt).toContain("- Crop context: crop-1 (.roo/visual-browser-inspector/session-1/crops/crop-1.png)")
		expect(prompt).toContain("- Selected region bounds: 10,20 120×80px")
		expect(prompt).toContain("Inspected element context:")
		expect(prompt).toContain("- Selected element: button")
		expect(prompt).toContain("Source mapping hints: webview-ui/src/components/HeroCheckout.tsx")
		expect(prompt).toContain("Current findings/recommendations (context only")
		expect(prompt).toContain("Finding 1: CTA is visually understated.")
		expect(prompt).toContain("Tiny checkout button")
		expect(prompt).toContain("Make only the changes needed for the user's requested visual/UX/content/code update")
		expect(prompt).toContain("Do not frame this as only fixing automatically detected findings")
		expect(prompt).toContain("Do not upload screenshots or crops to a remote service")
		expect(prompt).toContain("Do not commit, push, merge, rebase, change branches, or build/package a VSIX")
		expect(prompt).not.toContain("secret-value")
		expect(prompt).not.toContain("session-secret")
		expect(prompt).not.toContain("#legacy-nav")
	})

	it("crops PNG regions and clamps to image bounds", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-visual-browser-"))
		const sourcePath = path.join(tempDir, "source.png")
		const outputPath = path.join(tempDir, "nested", "crop.png")
		const source = new PNG({ width: 4, height: 4 })

		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < 4; x++) {
				const index = (y * 4 + x) * 4
				source.data[index] = x * 10
				source.data[index + 1] = y * 10
				source.data[index + 2] = 255
				source.data[index + 3] = 255
			}
		}

		await fs.writeFile(sourcePath, PNG.sync.write(source))

		const result = await cropPngRegion(sourcePath, outputPath, { x: 2, y: 1, width: 10, height: 10 })
		const cropped = PNG.sync.read(await fs.readFile(outputPath))

		expect(result).toEqual({ region: { x: 2, y: 1, width: 2, height: 3 }, width: 2, height: 3 })
		expect(cropped.width).toBe(2)
		expect(cropped.height).toBe(3)
	})
})

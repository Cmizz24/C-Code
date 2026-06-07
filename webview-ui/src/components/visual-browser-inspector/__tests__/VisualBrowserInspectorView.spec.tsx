import React from "react"
import { act, cleanup, fireEvent, render, screen } from "@/utils/test-utils"

import VisualBrowserInspectorView from "../VisualBrowserInspectorView"

const { postMessageMock } = vi.hoisted(() => ({
	postMessageMock: vi.fn(),
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: postMessageMock,
	},
}))

function dispatchVisualBrowserState(state: any) {
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "visualBrowserInspector",
					payload: { state },
				},
			}),
		)
	})
}

function dispatchVisualBrowserResponse(payload: any) {
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "visualBrowserInspector",
					payload,
				},
			}),
		)
	})
}

describe("VisualBrowserInspectorView", () => {
	beforeEach(() => {
		postMessageMock.mockClear()
	})

	afterEach(() => {
		cleanup()
	})

	it("normalizes dragged screenshot selections to screenshot pixels before cropping", async () => {
		render(<VisualBrowserInspectorView />)

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "visualBrowserInspector",
						payload: {
							state: {
								session: {
									sessionId: "session-1",
									status: "active",
									url: "http://localhost:3000",
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
								screenshots: [
									{
										sessionId: "session-1",
										screenshotId: "shot-1",
										url: "http://localhost:3000",
										path: "screenshots/shot-1.png",
										webviewUri: "vscode-resource://shot-1.png",
										createdAt: "2026-01-01T00:00:00.000Z",
										viewport: { name: "mobile", width: 390, height: 844 },
										pageWidth: 1000,
										pageHeight: 500,
										fullPage: false,
										redacted: true,
									},
								],
								crops: [],
								inspections: [],
								findings: [],
								statusMessage: "Ready",
							},
						},
					},
				}),
			)
		})

		const screenshot = await screen.findByAltText("Captured screenshot shot-1")
		Object.defineProperty(screenshot, "naturalWidth", { configurable: true, value: 1000 })
		Object.defineProperty(screenshot, "naturalHeight", { configurable: true, value: 500 })
		screenshot.getBoundingClientRect = vi.fn(() => ({
			x: 10,
			y: 20,
			left: 10,
			top: 20,
			right: 510,
			bottom: 270,
			width: 500,
			height: 250,
			toJSON: () => ({}),
		}))
		postMessageMock.mockClear()

		fireEvent.mouseDown(screenshot, { clientX: 60, clientY: 45 })
		fireEvent.mouseMove(screenshot, { clientX: 260, clientY: 145, buttons: 1 })
		fireEvent.mouseUp(screenshot, { clientX: 260, clientY: 145 })

		expect(screen.getByText(/Selected 100, 50 · 400 × 200 px/)).toBeInTheDocument()

		fireEvent.click(screen.getByRole("button", { name: "Crop selected area" }))

		expect(postMessageMock).toHaveBeenCalledWith({
			type: "visualBrowserInspector",
			payload: {
				action: "crop",
				sessionId: "session-1",
				screenshotId: "shot-1",
				region: { x: 100, y: 50, width: 400, height: 200 },
			},
		})
	})

	it("focuses chat-synced screenshots and crops from VBI tool payloads", async () => {
		render(<VisualBrowserInspectorView />)
		postMessageMock.mockClear()

		dispatchVisualBrowserResponse({
			state: {
				session: {
					sessionId: "session-1",
					status: "active",
					url: "http://localhost:3000",
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
				screenshots: [
					{
						sessionId: "session-1",
						screenshotId: "shot-1",
						url: "http://localhost:3000",
						path: "screenshots/shot-1.png",
						webviewUri: "vscode-resource://shot-1.png",
						createdAt: "2026-01-01T00:00:02.000Z",
						viewport: { name: "mobile", width: 390, height: 844 },
						pageWidth: 1000,
						pageHeight: 500,
						fullPage: false,
						redacted: true,
					},
					{
						sessionId: "session-1",
						screenshotId: "shot-2",
						url: "http://localhost:3000",
						path: "screenshots/shot-2.png",
						webviewUri: "vscode-resource://shot-2.png",
						createdAt: "2026-01-01T00:00:01.000Z",
						viewport: { name: "mobile", width: 390, height: 844 },
						pageWidth: 1000,
						pageHeight: 500,
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
						path: "crops/crop-1.png",
						webviewUri: "vscode-resource://crop-1.png",
						createdAt: "2026-01-01T00:00:02.000Z",
						viewport: { name: "mobile", width: 390, height: 844 },
						region: { x: 10, y: 20, width: 100, height: 120 },
						elements: [],
					},
					{
						sessionId: "session-1",
						cropId: "crop-2",
						screenshotId: "shot-2",
						url: "http://localhost:3000",
						path: "crops/crop-2.png",
						webviewUri: "vscode-resource://crop-2.png",
						createdAt: "2026-01-01T00:00:01.000Z",
						viewport: { name: "mobile", width: 390, height: 844 },
						region: { x: 30, y: 40, width: 150, height: 160 },
						elements: [],
					},
				],
				inspections: [],
				findings: [],
				statusMessage: "Ready",
			},
			source: "chat_tool",
			status: "complete",
			focus: {
				sessionId: "session-1",
				screenshotId: "shot-2",
				cropId: "crop-2",
			},
			message: "Synced Visual Browser Inspector result from chat.",
		})

		expect(await screen.findByAltText("Captured screenshot shot-2")).toBeInTheDocument()
		const focusedCropButton = (await screen.findByAltText("Crop crop-2")).closest("button")
		expect(focusedCropButton).toHaveClass("border-vscode-focusBorder")
		expect(focusedCropButton).toHaveTextContent("crop-2")
	})

	it("sends a start fix task request for all current findings", async () => {
		render(<VisualBrowserInspectorView />)

		dispatchVisualBrowserState({
			session: {
				sessionId: "session-1",
				status: "active",
				url: "http://localhost:3000",
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
					path: "screenshots/shot-1.png",
					webviewUri: "vscode-resource://shot-1.png",
					createdAt: "2026-01-01T00:00:00.000Z",
					viewport: { name: "mobile", width: 390, height: 844 },
					pageWidth: 1000,
					pageHeight: 500,
					fullPage: false,
					redacted: true,
				},
			],
			crops: [],
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
							cropId: null,
							selectorOrElement: "button[data-testid=checkout]",
							boundingBox: { x: 10, y: 20, width: 24, height: 24 },
							userImpact: "Touch users may miss the control.",
							likelyCause: "Icon-only button lacks minimum dimensions.",
							suggestedFix: "Use a minimum 44×44px tap target.",
							recommendation: "Inspect the owning component before changing styles.",
							implementationHint: "Look for the checkout action component and button size tokens.",
							filesToInspect: ["webview-ui/src/components/CheckoutButton.tsx"],
							verificationSteps: ["Re-run the mobile viewport", "Confirm tap target size"],
							relatedArtifacts: [{ type: "screenshot", id: "shot-1" }],
						},
					],
				},
			],
			statusMessage: "Ready",
		})
		postMessageMock.mockClear()

		fireEvent.click(await screen.findByRole("button", { name: "Start Fix Task for all findings" }))

		expect(postMessageMock).toHaveBeenCalledWith({
			type: "visualBrowserInspector",
			payload: {
				action: "start_fix_task",
				sessionId: "session-1",
				screenshotId: "shot-1",
				cropId: undefined,
				scope: "all",
			},
		})
	})

	it("sends a custom change task request with current VBI artifact context", async () => {
		render(<VisualBrowserInspectorView />)

		dispatchVisualBrowserState({
			session: {
				sessionId: "session-1",
				status: "active",
				url: "http://localhost:3000",
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
					path: "screenshots/shot-1.png",
					webviewUri: "vscode-resource://shot-1.png",
					createdAt: "2026-01-01T00:00:00.000Z",
					viewport: { name: "mobile", width: 390, height: 844 },
					pageWidth: 1000,
					pageHeight: 500,
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
					path: "crops/crop-1.png",
					webviewUri: "vscode-resource://crop-1.png",
					createdAt: "2026-01-01T00:00:02.000Z",
					viewport: { name: "mobile", width: 390, height: 844 },
					region: { x: 10, y: 20, width: 100, height: 120 },
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
					region: { x: 10, y: 20, width: 100, height: 120 },
					element: {
						tagName: "BUTTON",
						selector: "button[data-testid=checkout]",
						text: "Checkout now",
						role: "button",
						ariaLabel: "Checkout",
						attributes: { "data-testid": "checkout" },
						boundingBox: { x: 10, y: 20, width: 100, height: 120 },
						visible: true,
						ancestors: [],
					},
				},
			],
			findings: [
				{
					summary: "Local heuristic visual/UX analysis. Found 1 actionable issue.",
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
							boundingBox: { x: 10, y: 20, width: 100, height: 120 },
							likelyCause: "CTA styling lacks visual weight.",
							suggestedFix: "Increase prominence with existing design tokens.",
							filesToInspect: ["webview-ui/src/components/CheckoutButton.tsx"],
						},
					],
				},
			],
			statusMessage: "Ready",
		})
		postMessageMock.mockClear()

		fireEvent.change(screen.getByLabelText("Specific change request"), {
			target: { value: "Make the checkout CTA more prominent" },
		})
		fireEvent.click(screen.getByRole("button", { name: "Start AI change task" }))

		expect(postMessageMock).toHaveBeenCalledWith({
			type: "visualBrowserInspector",
			payload: {
				action: "start_change_task",
				sessionId: "session-1",
				instruction: "Make the checkout CTA more prominent",
				screenshotId: "shot-1",
				cropId: "crop-1",
				region: { x: 10, y: 20, width: 100, height: 120 },
				inspectionIndex: 0,
				includeScreenshotContext: true,
				includeCropContext: true,
				includeRegionContext: true,
				includeInspectionContext: true,
				includeFindingsContext: true,
			},
		})
	})

	it("sends a safe local-preview helper task request from the URL controls", async () => {
		render(<VisualBrowserInspectorView />)

		dispatchVisualBrowserState({
			session: {
				sessionId: "session-1",
				status: "active",
				url: "http://localhost:3000",
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
			statusMessage: "Ready",
		})
		postMessageMock.mockClear()

		fireEvent.change(screen.getByLabelText("URL"), { target: { value: "localhost:5173" } })
		fireEvent.change(screen.getByLabelText("Viewport"), { target: { value: "desktop" } })
		fireEvent.click(screen.getByRole("button", { name: "Start local preview" }))

		expect(postMessageMock).toHaveBeenCalledWith({
			type: "visualBrowserInspector",
			payload: {
				action: "start_local_preview_task",
				url: "localhost:5173",
				sessionId: "session-1",
				viewport: "desktop",
			},
		})
	})

	it("auto-opens an explicit safe localhost URL returned by the helper task", async () => {
		render(<VisualBrowserInspectorView />)
		postMessageMock.mockClear()

		dispatchVisualBrowserResponse({
			state: {
				screenshots: [],
				crops: [],
				inspections: [],
				findings: [],
				statusMessage: "Helper task found a local preview.",
			},
			localhostUrl: "localhost:5173",
			message: "Local preview is ready.",
		})

		expect(postMessageMock).toHaveBeenCalledWith({
			type: "visualBrowserInspector",
			payload: {
				action: "open",
				url: "http://localhost:5173",
				sessionId: undefined,
				viewport: "mobile",
				allowExternal: false,
			},
		})
	})

	it("does not auto-open an external URL returned by a helper task", async () => {
		render(<VisualBrowserInspectorView />)
		postMessageMock.mockClear()

		dispatchVisualBrowserResponse({
			state: {
				screenshots: [],
				crops: [],
				inspections: [],
				findings: [],
				statusMessage: "Helper task returned a URL.",
			},
			localhostUrl: "https://example.com",
			message: "External URL should not auto-open.",
		})

		expect(postMessageMock).not.toHaveBeenCalledWith({
			type: "visualBrowserInspector",
			payload: expect.objectContaining({ action: "open" }),
		})
		expect(screen.getByText("Ignoring non-local preview URL returned by the helper task.")).toBeInTheDocument()
	})
})

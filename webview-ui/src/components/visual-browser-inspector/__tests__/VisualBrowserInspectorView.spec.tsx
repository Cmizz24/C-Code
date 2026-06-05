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
})

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { PNG } from "pngjs"

vi.mock("playwright", () => {
	throw new Error("VisualBrowserInspectorService must not resolve Playwright during module import")
})

import {
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

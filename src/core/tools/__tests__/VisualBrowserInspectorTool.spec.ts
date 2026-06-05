import type { VisualBrowserToolResult } from "@roo-code/types"

import type { ToolUse } from "../../../shared/tools"
import type { Task } from "../../task/Task"
import { visualBrowserInspectorTool } from "../VisualBrowserInspectorTool"
import { visualBrowserInspectorService } from "../../../services/visual-browser-inspector/VisualBrowserInspectorService"

vi.mock("../../../services/visual-browser-inspector/VisualBrowserInspectorService", () => ({
	visualBrowserInspectorService: {
		execute: vi.fn(),
	},
}))

describe("VisualBrowserInspectorTool", () => {
	const result: VisualBrowserToolResult = {
		action: "visual_browser_capture",
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
		message: "Captured screenshot.",
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(visualBrowserInspectorService.execute).mockResolvedValue(result)
	})

	it("requests approval, executes the service, and returns a formatted result", async () => {
		const convertToWebviewUri = vi.fn((filePath: string) => `vscode-resource://${filePath}`)
		const task = {
			cwd: "c:/workspace",
			providerRef: {
				deref: () => ({ convertToWebviewUri }),
			},
		} as unknown as Task
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
		const block: ToolUse<"visual_browser_inspector"> = {
			type: "tool_use",
			name: "visual_browser_inspector",
			params: {},
			partial: false,
			nativeArgs: {
				action: "visual_browser_capture",
				sessionId: "session-1",
				fullPage: false,
			},
		}

		await visualBrowserInspectorTool.handle(task, block, callbacks)

		expect(callbacks.askApproval).toHaveBeenCalledWith("tool", expect.stringContaining("visual_browser_capture"))
		expect(visualBrowserInspectorService.execute).toHaveBeenCalledWith(block.nativeArgs, {
			cwd: "c:/workspace",
			toWebviewUri: expect.any(Function),
		})
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Captured screenshot"))
		expect(callbacks.handleError).not.toHaveBeenCalled()
	})

	it("does not execute when approval is denied", async () => {
		const task = {
			cwd: "c:/workspace",
			providerRef: {
				deref: () => undefined,
			},
		} as unknown as Task
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(false),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
		const block: ToolUse<"visual_browser_inspector"> = {
			type: "tool_use",
			name: "visual_browser_inspector",
			params: {},
			partial: false,
			nativeArgs: {
				action: "visual_browser_close",
				sessionId: "session-1",
			},
		}

		await visualBrowserInspectorTool.handle(task, block, callbacks)

		expect(visualBrowserInspectorService.execute).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
	})
})

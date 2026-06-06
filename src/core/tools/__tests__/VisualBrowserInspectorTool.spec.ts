import type { VisualBrowserToolResult } from "@roo-code/types"

import type { ToolUse } from "../../../shared/tools"
import type { Task } from "../../task/Task"
import { visualBrowserInspectorTool } from "../VisualBrowserInspectorTool"
import { visualBrowserInspectorService } from "../../../services/visual-browser-inspector/VisualBrowserInspectorService"

vi.mock("../../../services/visual-browser-inspector/VisualBrowserInspectorService", () => ({
	isVisualBrowserLocalUrl: vi.fn((input: string) => input.includes("localhost") || input.includes("127.0.0.1")),
	visualBrowserInspectorService: {
		execute: vi.fn(),
		getPanelState: vi.fn(),
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
		screenshot: {
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
		message: "Captured screenshot.",
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(visualBrowserInspectorService.execute).mockResolvedValue(result)
		vi.mocked(visualBrowserInspectorService.getPanelState).mockReturnValue({
			session: result.session,
			screenshots: [],
			crops: [],
			inspections: [],
			findings: [],
			statusMessage: "Ready",
		})
	})

	it("requests approval, executes the service, and returns a formatted result", async () => {
		const convertToWebviewUri = vi.fn((filePath: string) => `vscode-resource://${filePath}`)
		const postMessageToVisualBrowserInspectorPanels = vi.fn()
		const say = vi.fn()
		const task = {
			cwd: "c:/workspace",
			say,
			providerRef: {
				deref: () => ({ convertToWebviewUri, postMessageToVisualBrowserInspectorPanels }),
			},
		} as unknown as Task
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
			toolCallId: "tool-call-1",
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
		expect(postMessageToVisualBrowserInspectorPanels).toHaveBeenCalledWith({
			type: "visualBrowserInspector",
			payload: expect.objectContaining({
				result,
				source: "chat_tool",
				status: "complete",
				toolCallId: "tool-call-1",
				focus: {
					sessionId: "session-1",
					screenshotId: "shot-1",
					cropId: undefined,
				},
				message: "Captured screenshot.",
			}),
		})
		expect(say).toHaveBeenCalledWith("tool", expect.any(String), undefined, false)
		const chatPayload = JSON.parse(say.mock.calls[0][1])
		expect(chatPayload).toEqual(
			expect.objectContaining({
				tool: "visualBrowserInspector",
				action: "visual_browser_capture",
				visualBrowserStatus: "complete",
				visualBrowserResult: result,
				sessionId: "session-1",
				url: "http://localhost:3000",
				screenshotId: "shot-1",
				toolCallId: "tool-call-1",
				message: "Captured screenshot.",
			}),
		)
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

	it("notifies visual-only VBI panels when opening a verified local preview", async () => {
		const convertToWebviewUri = vi.fn((filePath: string) => `vscode-resource://${filePath}`)
		const postMessageToVisualBrowserInspectorPanels = vi.fn()
		const say = vi.fn()
		const openResult: VisualBrowserToolResult = {
			...result,
			action: "visual_browser_open",
			session: { ...result.session, url: "http://localhost:5173" },
			screenshot: undefined,
			message: "Controlled Playwright browser session opened.",
		}
		vi.mocked(visualBrowserInspectorService.execute).mockResolvedValue(openResult)
		vi.mocked(visualBrowserInspectorService.getPanelState).mockReturnValue({
			session: openResult.session,
			screenshots: [],
			crops: [],
			inspections: [],
			findings: [],
			statusMessage: "Ready",
		})
		const task = {
			cwd: "c:/workspace",
			say,
			providerRef: {
				deref: () => ({ convertToWebviewUri, postMessageToVisualBrowserInspectorPanels }),
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
				action: "visual_browser_open",
				url: "http://localhost:5173",
				viewport: "desktop",
				allowExternal: false,
			},
		}

		await visualBrowserInspectorTool.handle(task, block, callbacks)

		expect(postMessageToVisualBrowserInspectorPanels).toHaveBeenCalledWith({
			type: "visualBrowserInspector",
			payload: expect.objectContaining({
				localhostUrl: "http://localhost:5173",
				message: "Verified local preview opened in Visual Browser Inspector.",
				result: openResult,
				source: "chat_tool",
				status: "complete",
				focus: {
					sessionId: "session-1",
					screenshotId: undefined,
					cropId: undefined,
				},
			}),
		})
		expect(say).toHaveBeenCalledWith("tool", expect.any(String), undefined, false)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("localhost:5173"))
	})

	it("syncs VBI panels for external URL results without marking them as localhost previews", async () => {
		const postMessageToVisualBrowserInspectorPanels = vi.fn()
		const say = vi.fn()
		const externalResult: VisualBrowserToolResult = {
			...result,
			action: "visual_browser_open",
			session: { ...result.session, url: "https://example.com" },
			screenshot: undefined,
			message: "Controlled Playwright browser session opened.",
		}
		vi.mocked(visualBrowserInspectorService.execute).mockResolvedValue(externalResult)
		const task = {
			cwd: "c:/workspace",
			say,
			providerRef: {
				deref: () => ({ postMessageToVisualBrowserInspectorPanels }),
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
				action: "visual_browser_open",
				url: "https://example.com",
				allowExternal: true,
			},
		}

		await visualBrowserInspectorTool.handle(task, block, callbacks)

		expect(postMessageToVisualBrowserInspectorPanels).toHaveBeenCalledWith({
			type: "visualBrowserInspector",
			payload: expect.objectContaining({
				result: externalResult,
				source: "chat_tool",
				status: "complete",
				focus: {
					sessionId: "session-1",
					screenshotId: undefined,
					cropId: undefined,
				},
				message: "Controlled Playwright browser session opened.",
			}),
		})
		const payload = postMessageToVisualBrowserInspectorPanels.mock.calls[0][0].payload
		expect(payload.localhostUrl).toBeUndefined()
		expect(say).toHaveBeenCalledWith("tool", expect.any(String), undefined, false)
		expect(callbacks.pushToolResult).toHaveBeenCalled()
	})

	it("emits a running chat row payload while native VBI arguments stream", async () => {
		const ask = vi.fn().mockResolvedValue(true)
		const task = { ask } as unknown as Task
		const block: ToolUse<"visual_browser_inspector"> = {
			type: "tool_use",
			id: "partial-tool-call-1",
			name: "visual_browser_inspector",
			params: {
				action: "visual_browser_crop",
				sessionId: "session-1",
				screenshotId: "shot-1",
				cropId: "crop-1",
			},
			partial: true,
		}

		await visualBrowserInspectorTool.handlePartial(task, block)

		expect(ask).toHaveBeenCalledWith("tool", expect.any(String), true)
		const runningPayload = JSON.parse(ask.mock.calls[0][1])
		expect(runningPayload).toEqual(
			expect.objectContaining({
				tool: "visualBrowserInspector",
				action: "visual_browser_crop",
				visualBrowserStatus: "running",
				sessionId: "session-1",
				screenshotId: "shot-1",
				cropId: "crop-1",
				toolCallId: "partial-tool-call-1",
			}),
		)
	})
})

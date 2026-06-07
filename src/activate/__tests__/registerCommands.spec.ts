import type { Mock } from "vitest"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"

import { getVisibleProviderOrLog, openClineInNewTab, openVisualBrowserInspectorPanel } from "../registerCommands"

const mocks = vi.hoisted(() => {
	const mockContextProxy = { extensionUri: "mock-context-proxy" }
	const mockPostMessageToWebview = vi.fn()
	const mockResolveWebviewView = vi.fn()
	const mockClineProvider = vi.fn(() => ({
		postMessageToWebview: mockPostMessageToWebview,
		resolveWebviewView: mockResolveWebviewView,
	}))

	Object.assign(mockClineProvider, {
		getVisibleInstance: vi.fn(),
		tabPanelId: "c-code.TabPanelProvider",
		visualBrowserInspectorPanelId: "c-code.VisualBrowserInspectorPanelProvider",
	})

	return {
		mockClineProvider,
		mockContextProxy,
		mockCreateTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		mockCreateWebviewPanel: vi.fn(),
		mockExecuteCommand: vi.fn(),
		mockGetContextProxy: vi.fn(),
		mockGetCodeIndexManager: vi.fn(),
		mockJoinPath: vi.fn((...parts: unknown[]) => ({ parts })),
		mockPostMessageToWebview,
		mockResolveWebviewView,
	}
})

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("delay", () => ({
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("vscode", () => ({
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	ViewColumn: {
		Two: 2,
	},
	commands: {
		executeCommand: mocks.mockExecuteCommand,
	},
	Uri: {
		joinPath: mocks.mockJoinPath,
	},
	window: {
		createTextEditorDecorationType: mocks.mockCreateTextEditorDecorationType,
		createWebviewPanel: mocks.mockCreateWebviewPanel,
		visibleTextEditors: [],
	},
	workspace: {
		workspaceFolders: [
			{
				uri: {
					fsPath: "/mock/workspace",
				},
			},
		],
	},
}))

vi.mock("../../core/config/ContextProxy", () => ({
	ContextProxy: {
		getInstance: mocks.mockGetContextProxy,
	},
}))

vi.mock("../../services/code-index/manager", () => ({
	CodeIndexManager: {
		getInstance: mocks.mockGetCodeIndexManager,
	},
}))

vi.mock("../../core/webview/ClineProvider", () => ({
	ClineProvider: mocks.mockClineProvider,
}))

const createMockOutputChannel = (): vscode.OutputChannel =>
	({
		appendLine: vi.fn(),
		append: vi.fn(),
		clear: vi.fn(),
		hide: vi.fn(),
		name: "mock",
		replace: vi.fn(),
		show: vi.fn(),
		dispose: vi.fn(),
	}) as unknown as vscode.OutputChannel

const createMockContext = (): vscode.ExtensionContext =>
	({
		extensionUri: { fsPath: "/mock/extension" },
		subscriptions: [],
	}) as unknown as vscode.ExtensionContext

const createMockPanel = (): vscode.WebviewPanel =>
	({
		webview: {
			postMessage: vi.fn(),
		},
		visible: true,
		onDidChangeViewState: vi.fn(),
		onDidDispose: vi.fn(),
		iconPath: undefined,
	}) as unknown as vscode.WebviewPanel

describe("getVisibleProviderOrLog", () => {
	let mockOutputChannel: vscode.OutputChannel

	beforeEach(() => {
		mockOutputChannel = createMockOutputChannel()
		vi.clearAllMocks()
	})

	it("returns the visible provider if found", () => {
		const mockProvider = {} as ClineProvider
		;(ClineProvider.getVisibleInstance as Mock).mockReturnValue(mockProvider)

		const result = getVisibleProviderOrLog(mockOutputChannel)

		expect(result).toBe(mockProvider)
		expect(mockOutputChannel.appendLine).not.toHaveBeenCalled()
	})

	it("logs and returns undefined if no provider found", () => {
		;(ClineProvider.getVisibleInstance as Mock).mockReturnValue(undefined)

		const result = getVisibleProviderOrLog(mockOutputChannel)

		expect(result).toBeUndefined()
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith("Cannot find any visible C Code instances.")
	})
})

describe("openClineInNewTab", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.mockCreateWebviewPanel.mockReturnValue(createMockPanel())
		mocks.mockGetContextProxy.mockResolvedValue(mocks.mockContextProxy)
		mocks.mockGetCodeIndexManager.mockReturnValue({})
		;(vscode.window as any).visibleTextEditors = []
	})

	it("opens the normal C Code tab without a VBI initial route", async () => {
		const context = createMockContext()
		const outputChannel = createMockOutputChannel()

		await openClineInNewTab({ context, outputChannel })

		expect(mocks.mockClineProvider).toHaveBeenCalledWith(
			context,
			outputChannel,
			"editor",
			mocks.mockContextProxy,
			undefined,
		)
		expect(mocks.mockCreateWebviewPanel).toHaveBeenCalledWith("c-code.TabPanelProvider", "C Code", 2, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [context.extensionUri],
		})
		expect(mocks.mockResolveWebviewView).toHaveBeenCalledWith(mocks.mockCreateWebviewPanel.mock.results[0].value)
		expect(mocks.mockPostMessageToWebview).not.toHaveBeenCalled()
	})
})

describe("openVisualBrowserInspectorPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.mockCreateWebviewPanel.mockReturnValue(createMockPanel())
		mocks.mockGetContextProxy.mockResolvedValue(mocks.mockContextProxy)
		mocks.mockGetCodeIndexManager.mockReturnValue({})
		;(vscode.window as any).visibleTextEditors = []
	})

	it("opens a tab with the Visual Browser Inspector initial route", async () => {
		const context = createMockContext()
		const outputChannel = createMockOutputChannel()

		await openVisualBrowserInspectorPanel({ context, outputChannel })

		expect(mocks.mockClineProvider).toHaveBeenCalledWith(
			context,
			outputChannel,
			"editor",
			mocks.mockContextProxy,
			"visualBrowserInspector",
		)
		expect(mocks.mockCreateWebviewPanel).toHaveBeenCalledWith(
			"c-code.VisualBrowserInspectorPanelProvider",
			"Visual Browser Inspector",
			2,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [context.extensionUri],
			},
		)
		expect(mocks.mockResolveWebviewView).toHaveBeenCalledWith(mocks.mockCreateWebviewPanel.mock.results[0].value)
		expect(mocks.mockPostMessageToWebview).toHaveBeenCalledWith({
			type: "visualBrowserInspector",
			payload: { action: "show" },
		})
	})
})

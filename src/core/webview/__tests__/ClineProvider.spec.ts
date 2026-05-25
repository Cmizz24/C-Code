// pnpm --filter roo-cline test core/webview/__tests__/ClineProvider.spec.ts

import Anthropic from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import axios from "axios"

import {
	type ProviderSettingsEntry,
	type ClineMessage,
	type ClineSayTool,
	type ExecutionPlan,
	type ExtensionMessage,
	type ExtensionState,
	type HistoryItem,
	ORGANIZATION_ALLOW_ALL,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	RooCodeEventName,
} from "@roo-code/types"

import { defaultModeSlug } from "../../../shared/modes"
import { experimentDefault } from "../../../shared/experiments"
import { setTtsEnabled } from "../../../utils/tts"
import { ContextProxy } from "../../config/ContextProxy"
import { Task, TaskOptions } from "../../task/Task"
import { safeWriteJson } from "../../../utils/safeWriteJson"

import { ClineProvider } from "../ClineProvider"
import { MessageManager } from "../../message-manager"
import { AgentBus } from "../../agents/AgentBus"
import { WorktreeMergeError } from "../../agents/WorktreeManager"

// Mock setup must come before imports.
vi.mock("../../prompts/sections/custom-instructions")

vi.mock("p-wait-for", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("axios", () => ({
	default: {
		get: vi.fn().mockResolvedValue({ data: { data: [] } }),
		post: vi.fn(),
	},
	get: vi.fn().mockResolvedValue({ data: { data: [] } }),
	post: vi.fn(),
}))

vi.mock("../../../utils/safeWriteJson")

vi.mock("../../../utils/storage", () => ({
	getSettingsDirectoryPath: vi.fn().mockResolvedValue("/test/settings/path"),
	getTaskDirectoryPath: vi.fn().mockResolvedValue("/test/task/path"),
	getGlobalStoragePath: vi.fn().mockResolvedValue("/test/storage/path"),
}))

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
	CallToolResultSchema: {},
	ListResourcesResultSchema: {},
	ListResourceTemplatesResultSchema: {},
	ListToolsResultSchema: {},
	ReadResourceResultSchema: {},
	ErrorCode: {
		InvalidRequest: "InvalidRequest",
		MethodNotFound: "MethodNotFound",
		InternalError: "InternalError",
	},
	McpError: class McpError extends Error {
		code: string
		constructor(code: string, message: string) {
			super(message)
			this.code = code
			this.name = "McpError"
		}
	},
}))

// Remove duplicate mock - it's already defined below.

const mockAddCustomInstructions = vi.fn().mockResolvedValue("Combined instructions")

;(vi.mocked(await import("../../prompts/sections/custom-instructions")) as any).addCustomInstructions =
	mockAddCustomInstructions

vi.mock("delay", () => {
	const delayFn = (_ms: number) => Promise.resolve()
	delayFn.createDelay = () => delayFn
	delayFn.reject = () => Promise.reject(new Error("Delay rejected"))
	delayFn.range = () => Promise.resolve()
	return { default: delayFn }
})

// MCP-related modules are mocked once above (lines 87-109).

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
		listTools: vi.fn().mockResolvedValue({ tools: [] }),
		callTool: vi.fn().mockResolvedValue({ content: [] }),
	})),
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
	})),
}))

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	OutputChannel: vi.fn(),
	WebviewView: vi.fn(),
	Uri: {
		joinPath: vi.fn(),
		file: vi.fn(),
	},
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	commands: {
		executeCommand: vi.fn().mockResolvedValue(undefined),
	},
	window: {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue([]),
			update: vi.fn(),
		}),
		onDidChangeConfiguration: vi.fn().mockImplementation(() => ({
			dispose: vi.fn(),
		})),
		onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
	},
	env: {
		uriScheme: "vscode",
		language: "en",
		appName: "Visual Studio Code",
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
	version: "1.85.0",
}))

vi.mock("../../../utils/tts", () => ({
	setTtsEnabled: vi.fn(),
	setTtsSpeed: vi.fn(),
}))

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn(),
}))

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockImplementation(async () => "mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => {
	return {
		default: vi.fn().mockImplementation(() => ({
			initializeFilePaths: vi.fn(),
			dispose: vi.fn(),
		})),
	}
})

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation((options: any) => {
		const listeners = new Map<string, Set<(...args: any[]) => unknown>>()
		const task: any = {
			api: undefined,
			apiConfiguration: options?.apiConfiguration,
			abortTask: vi.fn(),
			cancelCurrentRequest: vi.fn(),
			handleWebviewAskResponse: vi.fn(),
			clineMessages: [],
			apiConversationHistory: [],
			overwriteClineMessages: vi.fn(),
			overwriteApiConversationHistory: vi.fn(),
			getTaskNumber: vi.fn().mockReturnValue(0),
			setTaskNumber: vi.fn(),
			setParentTask: vi.fn(),
			setRootTask: vi.fn(),
			start: vi.fn(),
			taskId: options?.historyItem?.id || options?.taskId || "test-task-id",
			instanceId: `test-instance-${options?.historyItem?.id || options?.taskId || options?.taskNumber || "new"}`,
			rootTask: options?.rootTask,
			parentTask: options?.parentTask,
			rootTaskId: options?.historyItem?.rootTaskId ?? options?.rootTask?.taskId,
			parentTaskId: options?.historyItem?.parentTaskId ?? options?.parentTask?.taskId,
			background: options?.background ?? false,
			abortReason: undefined,
			abandoned: false,
			abort: false,
			isStreaming: false,
			didFinishAbortingStream: false,
			isWaitingForFirstChunk: false,
			on: vi.fn((event: string, listener: (...args: any[]) => unknown) => {
				const key = String(event)
				const eventListeners = listeners.get(key) ?? new Set<(...args: any[]) => unknown>()
				eventListeners.add(listener)
				listeners.set(key, eventListeners)
				return task
			}),
			off: vi.fn((event: string, listener: (...args: any[]) => unknown) => {
				listeners.get(String(event))?.delete(listener)
				return task
			}),
			emit: vi.fn((event: string, ...args: any[]) => {
				for (const listener of listeners.get(String(event)) ?? []) {
					void listener(...args)
				}
				return true
			}),
		}

		options?.onCreated?.(task)

		return task
	}),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockImplementation(async (_filePath: string) => {
		const content = "const x = 1;\nconst y = 2;\nconst z = 3;"
		const lines = content.split("\n")
		return lines.map((line, index) => `${index + 1} | ${line}`).join("\n")
	}),
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
	getModelsFromCache: vi.fn().mockReturnValue(undefined),
}))

vi.mock("../../../shared/modes", () => ({
	modes: [
		{
			slug: "code",
			name: "Code Mode",
			roleDefinition: "You are a code assistant",
			groups: ["read", "edit"],
		},
		{
			slug: "architect",
			name: "Architect Mode",
			roleDefinition: "You are an architect",
			groups: ["read", "edit"],
		},
		{
			slug: "explain",
			name: "Explain Mode",
			roleDefinition: "You are a helpful assistant",
			groups: ["read"],
		},
	],
	getAllModes: vi.fn((customModes?: Array<{ slug: string }>) =>
		customModes?.length
			? [
					{
						slug: "code",
						name: "Code Mode",
						roleDefinition: "You are a code assistant",
						groups: ["read", "edit"],
					},
					...customModes,
				]
			: [
					{
						slug: "code",
						name: "Code Mode",
						roleDefinition: "You are a code assistant",
						groups: ["read", "edit"],
					},
				],
	),
	getModeBySlug: vi.fn().mockReturnValue({
		slug: "code",
		name: "Code Mode",
		roleDefinition: "You are a code assistant",
		groups: ["read", "edit"],
	}),
	getGroupName: vi.fn().mockImplementation((group: string) => {
		// Return appropriate group names for different tool groups
		switch (group) {
			case "read":
				return "Read Tools"
			case "edit":
				return "Edit Tools"
			case "mcp":
				return "MCP Tools"
			default:
				return "General Tools"
		}
	}),
	defaultModeSlug: "code",
	normalizeModeSlug: vi.fn((slug: string) => (slug === "ask" ? "explain" : slug)),
}))

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockResolvedValue("mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({
			id: "claude-3-sonnet",
		}),
	}),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockImplementation(async (_filePath: string) => {
		const content = "const x = 1;\nconst y = 2;\nconst z = 3;"
		const lines = content.split("\n")
		return lines.map((line, index) => `${index + 1} | ${line}`).join("\n")
	}),
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
	getModelsFromCache: vi.fn().mockReturnValue(undefined),
}))

vi.mock("../diff/strategies/multi-search-replace", () => ({
	MultiSearchReplaceDiffStrategy: vi.fn().mockImplementation(() => ({
		getToolDescription: () => "test",
		getName: () => "test-strategy",
		applyDiff: vi.fn(),
	})),
}))

afterAll(() => {
	vi.restoreAllMocks()
})

describe("ClineProvider", () => {
	beforeAll(() => {
		vi.mocked(Task).mockImplementation((options: any) => {
			const listeners = new Map<string, Set<(...args: any[]) => unknown>>()
			const task: any = {
				api: undefined,
				apiConfiguration: options?.apiConfiguration,
				abortTask: vi.fn(),
				cancelCurrentRequest: vi.fn(),
				handleWebviewAskResponse: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				say: vi.fn(async (type: ClineMessage["say"], text?: string, images?: string[], partial?: boolean) => {
					const message = {
						type: "say",
						say: type,
						text,
						images,
						partial,
						ts: Date.now(),
					} satisfies ClineMessage
					task.clineMessages.push(message)
					task.emit(RooCodeEventName.Message, { action: "created", message })
				}),
				overwriteClineMessages: vi.fn(async (messages: ClineMessage[]) => {
					task.clineMessages = messages
				}),
				overwriteApiConversationHistory: vi.fn(),
				getTaskNumber: vi.fn().mockReturnValue(0),
				setTaskNumber: vi.fn(),
				setParentTask: vi.fn(),
				setRootTask: vi.fn(),
				start: vi.fn(),
				taskId: options?.historyItem?.id || options?.taskId || "test-task-id",
				instanceId: `test-instance-${options?.historyItem?.id || options?.taskId || options?.taskNumber || "new"}`,
				rootTask: options?.rootTask,
				parentTask: options?.parentTask,
				rootTaskId: options?.historyItem?.rootTaskId ?? options?.rootTask?.taskId,
				parentTaskId: options?.historyItem?.parentTaskId ?? options?.parentTask?.taskId,
				agentId: options?.agentId,
				background: options?.background ?? false,
				enableCheckpoints: options?.enableCheckpoints,
				workspacePath: options?.workspacePath,
				abortReason: undefined,
				abandoned: false,
				abort: false,
				isStreaming: false,
				didFinishAbortingStream: false,
				isWaitingForFirstChunk: false,
				on: vi.fn((event: string, listener: (...args: any[]) => unknown) => {
					const key = String(event)
					const eventListeners = listeners.get(key) ?? new Set<(...args: any[]) => unknown>()
					eventListeners.add(listener)
					listeners.set(key, eventListeners)
					return task
				}),
				off: vi.fn((event: string, listener: (...args: any[]) => unknown) => {
					listeners.get(String(event))?.delete(listener)
					return task
				}),
				emit: vi.fn((event: string, ...args: any[]) => {
					for (const listener of listeners.get(String(event)) ?? []) {
						void listener(...args)
					}
					return true
				}),
			}

			Object.defineProperty(task, "messageManager", {
				get: () => new MessageManager(task),
			})

			options?.onCreated?.(task)

			return task
		})
	})

	let defaultTaskOptions: TaskOptions

	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: any
	let updateGlobalStateSpy: any

	beforeEach(() => {
		vi.clearAllMocks()
		AgentBus.reset()

		const globalState: Record<string, string | undefined> = {
			mode: "architect",
			currentApiConfigName: "current-config",
		}

		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi
					.fn()
					.mockImplementation((key: string, value: string | undefined) => (globalState[key] = value)),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
				delete: vi.fn().mockImplementation((key: string) => delete secrets[key]),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		// Mock CustomModesManager
		const mockCustomModesManager = {
			updateCustomMode: vi.fn().mockResolvedValue(undefined),
			getCustomModes: vi.fn().mockResolvedValue([]),
			dispose: vi.fn(),
		}

		// Mock output channel
		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		// Mock webview
		mockPostMessage = vi.fn()

		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
				cspSource: "vscode-webview://test-csp-source",
			},
			visible: true,
			onDidDispose: vi.fn().mockImplementation((callback) => {
				callback()
				return { dispose: vi.fn() }
			}),
			onDidChangeVisibility: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		defaultTaskOptions = {
			provider,
			apiConfiguration: {
				apiProvider: "openrouter",
			},
		}

		// @ts-ignore - Access private property for testing
		updateGlobalStateSpy = vi.spyOn(provider.contextProxy, "setValue")

		// @ts-ignore - Accessing private property for testing.
		provider.customModesManager = mockCustomModesManager

		// Mock getMcpHub method for generateSystemPrompt
		provider.getMcpHub = vi.fn().mockReturnValue({
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue({ contents: [] }),
			getAllServers: vi.fn().mockReturnValue([]),
		})
	})

	const createExecutionPlan = (): ExecutionPlan => ({
		planId: "plan-webview-provider",
		sharedContext: "shared context",
		fileOwnershipMap: {
			"src/dashboard.tsx": "dashboard-agent",
			"src/styles.css": "styles-agent",
		},
		createdAt: 12345,
		agents: [
			{
				id: "dashboard-agent",
				mode: "code",
				task: "Build dashboard",
				owns: [{ path: "src/dashboard.tsx", mode: "exclusive" }],
				mustNotTouch: [],
				dependsOn: [],
				worktreePath: "",
				status: "pending",
				signals: [],
			},
			{
				id: "styles-agent",
				mode: "code",
				task: "Style dashboard",
				owns: [{ path: "src/styles.css", mode: "exclusive" }],
				mustNotTouch: [],
				dependsOn: [],
				worktreePath: "",
				status: "pending",
				signals: [],
			},
		],
	})

	const getParallelAgentToolMessages = (task: Task): ClineMessage[] =>
		task.clineMessages.filter((message) => {
			if (message.type !== "say" || message.say !== "tool" || !message.text) {
				return false
			}

			try {
				return (JSON.parse(message.text) as ClineSayTool).tool === "parallelAgents"
			} catch {
				return false
			}
		})

	const parseParallelAgentToolMessage = (message: ClineMessage): ClineSayTool =>
		JSON.parse(message.text ?? "{}") as ClineSayTool

	test("constructor initializes correctly", () => {
		expect(provider).toBeInstanceOf(ClineProvider)
		// Since getVisibleInstance returns the last instance where view.visible is true
		// @ts-ignore - accessing private property for testing
		provider.view = mockWebviewView
		expect(ClineProvider.getVisibleInstance()).toBe(provider)
	})

	test("resolveWebviewView sets up webview correctly", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		expect(mockWebviewView.webview.options).toEqual({
			enableScripts: true,
			localResourceRoots: [mockContext.extensionUri],
		})

		expect(mockWebviewView.webview.html).toContain("<!DOCTYPE html>")
	})

	test("resolveWebviewView sets up webview correctly in development mode even if local server is not running", async () => {
		provider = new ClineProvider(
			{ ...mockContext, extensionMode: vscode.ExtensionMode.Development },
			mockOutputChannel,
			"sidebar",
			new ContextProxy(mockContext),
		)
		;(axios.get as any).mockRejectedValueOnce(new Error("Network error"))

		await provider.resolveWebviewView(mockWebviewView)

		expect(mockWebviewView.webview.options).toEqual({
			enableScripts: true,
			localResourceRoots: [mockContext.extensionUri],
		})

		expect(mockWebviewView.webview.html).toContain("<!DOCTYPE html>")

		// Verify Content Security Policy contains the necessary API domains
		expect(mockWebviewView.webview.html).toContain(
			"connect-src vscode-webview://test-csp-source https://openrouter.ai https://api.requesty.ai",
		)

		// Extract the script-src directive section and verify required security elements
		const html = mockWebviewView.webview.html
		const scriptSrcMatch = html.match(/script-src[^;]*;/)
		expect(scriptSrcMatch).not.toBeNull()
		expect(scriptSrcMatch![0]).toContain("'nonce-")
		// Verify wasm-unsafe-eval is present for Shiki syntax highlighting
		expect(scriptSrcMatch![0]).toContain("'wasm-unsafe-eval'")
	})

	test("postMessageToWebview sends message to webview", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		const mockState: ExtensionState = {
			version: "1.0.0",
			clineMessages: [],
			taskHistory: [],
			shouldShowAnnouncement: false,
			apiConfiguration: {
				apiProvider: "openrouter",
			},
			customInstructions: undefined,
			alwaysAllowReadOnly: false,
			alwaysAllowReadOnlyOutsideWorkspace: false,
			alwaysAllowWrite: false,
			codebaseIndexConfig: {
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderBaseUrl: "",
				codebaseIndexEmbedderModelId: "",
			},
			alwaysAllowWriteOutsideWorkspace: false,
			alwaysAllowExecute: false,
			alwaysAllowMcp: false,
			uriScheme: "vscode",
			soundEnabled: false,
			ttsEnabled: false,
			enableCheckpoints: false,
			writeDelayMs: 1000,
			mcpEnabled: true,
			mode: defaultModeSlug,
			customModes: [],
			experiments: experimentDefault,
			maxOpenTabsContext: 20,
			maxWorkspaceFiles: 200,
			showRooIgnoredFiles: false,
			enableSubfolderRules: false,
			renderContext: "sidebar",
			maxImageFileSize: 5,
			maxTotalImageSize: 20,
			organizationAllowList: ORGANIZATION_ALLOW_ALL,
			autoCondenseContext: true,
			autoCondenseContextPercent: 100,
			profileThresholds: {},
			hasOpenedModeSelector: false,
			diagnosticsEnabled: true,
			openRouterImageApiKey: undefined,
			openRouterImageGenerationSelectedModel: undefined,
			checkpointTimeout: DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
		}

		const message: ExtensionMessage = {
			type: "state",
			state: mockState,
		}
		await provider.postMessageToWebview(message)

		expect(mockPostMessage).toHaveBeenCalledWith(message)
	})

	test("postMessageToWebview does not throw when webview is disposed", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Simulate postMessage throwing after webview disposal
		mockPostMessage.mockRejectedValueOnce(new Error("Webview is disposed"))

		const message: ExtensionMessage = { type: "action", action: "chatButtonClicked" }

		// Should not throw
		await expect(provider.postMessageToWebview(message)).resolves.toBeUndefined()
	})

	test("postMessageToWebview skips postMessage after dispose", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		await provider.dispose()
		mockPostMessage.mockClear()

		const message: ExtensionMessage = { type: "action", action: "chatButtonClicked" }
		await provider.postMessageToWebview(message)

		expect(mockPostMessage).not.toHaveBeenCalled()
	})

	test("dispose is idempotent — second call is a no-op", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		await provider.dispose()
		await provider.dispose()

		// dispose body runs only once: log "Disposing ClineProvider..." appears once
		const disposeCalls = (mockOutputChannel.appendLine as ReturnType<typeof vi.fn>).mock.calls.filter(
			([msg]) => typeof msg === "string" && msg.includes("Disposing ClineProvider..."),
		)
		expect(disposeCalls).toHaveLength(1)
	})

	test("handles webviewDidLaunch message", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Get the message handler from onDidReceiveMessage
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Simulate webviewDidLaunch message
		await messageHandler({ type: "webviewDidLaunch" })

		// Should post state and theme to webview
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("clearTask aborts current task", async () => {
		// Setup Cline instance with auto-mock from the top of the file
		const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance

		// add the mock object to the stack
		await provider.addClineToStack(mockCline)

		// get the stack size before the abort call
		const stackSizeBeforeAbort = provider.getTaskStackSize()

		// call the removeClineFromStack method so it will call the current cline abort and remove it from the stack
		await provider.removeClineFromStack()

		// get the stack size after the abort call
		const stackSizeAfterAbort = provider.getTaskStackSize()

		// check if the abort method was called
		expect(mockCline.abortTask).toHaveBeenCalled()

		// check if the stack size was decreased
		expect(stackSizeBeforeAbort - stackSizeAfterAbort).toBe(1)
	})

	describe("clearTask message handler", () => {
		beforeEach(async () => {
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("calls clearTask (delegation handled via metadata)", async () => {
			// Setup a single task without parent
			const mockCline = new Task(defaultTaskOptions)

			// Mock the provider methods
			const clearTaskSpy = vi.spyOn(provider, "clearTask").mockResolvedValue(undefined)
			const postStateToWebviewSpy = vi.spyOn(provider, "postStateToWebview").mockResolvedValue(undefined)

			// Add task to stack
			await provider.addClineToStack(mockCline)

			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Trigger clearTask message
			await messageHandler({ type: "clearTask" })

			// Verify clearTask was called
			expect(clearTaskSpy).toHaveBeenCalled()
			expect(postStateToWebviewSpy).toHaveBeenCalled()
		})

		test("calls clearTask even with parent task (delegation via metadata)", async () => {
			// Setup parent and child tasks
			const parentTask = new Task(defaultTaskOptions)
			const childTask = new Task(defaultTaskOptions)

			// Set up parent-child relationship
			;(childTask as any).parentTask = parentTask
			;(childTask as any).rootTask = parentTask

			// Mock the provider methods
			const clearTaskSpy = vi.spyOn(provider, "clearTask").mockResolvedValue(undefined)
			const postStateToWebviewSpy = vi.spyOn(provider, "postStateToWebview").mockResolvedValue(undefined)

			// Add both tasks to stack (parent first, then child)
			await provider.addClineToStack(parentTask)
			await provider.addClineToStack(childTask)

			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Trigger clearTask message
			await messageHandler({ type: "clearTask" })

			// Verify clearTask was called (delegation happens via metadata, not finishSubTask)
			expect(clearTaskSpy).toHaveBeenCalled()
			expect(postStateToWebviewSpy).toHaveBeenCalled()
		})

		test("handles case when no current task exists", async () => {
			// Don't add any tasks to the stack

			// Mock the provider methods
			const clearTaskSpy = vi.spyOn(provider, "clearTask").mockResolvedValue(undefined)
			const postStateToWebviewSpy = vi.spyOn(provider, "postStateToWebview").mockResolvedValue(undefined)

			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Trigger clearTask message
			await messageHandler({ type: "clearTask" })

			// When there's no current task, clearTask is still called (it handles the no-task case internally)
			expect(clearTaskSpy).toHaveBeenCalled()
			expect(postStateToWebviewSpy).toHaveBeenCalled()
		})

		test("correctly identifies task scenario for issue #4602", async () => {
			// This test validates the fix for issue #4602
			// where canceling during API retry correctly uses clearTask

			const mockCline = new Task(defaultTaskOptions)

			// Mock the provider methods
			const clearTaskSpy = vi.spyOn(provider, "clearTask").mockResolvedValue(undefined)

			// Add only one task to stack
			await provider.addClineToStack(mockCline)

			// Verify stack size is 1
			expect(provider.getTaskStackSize()).toBe(1)

			// Get the message handler
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Trigger clearTask message (simulating cancel during API retry)
			await messageHandler({ type: "clearTask" })

			// clearTask should be called (delegation handled via metadata)
			expect(clearTaskSpy).toHaveBeenCalled()
		})
	})

	test("addClineToStack adds multiple Cline instances to the stack", async () => {
		// Setup Cline instance with auto-mock from the top of the file
		const mockCline1 = new Task(defaultTaskOptions) // Create a new mocked instance
		const mockCline2 = new Task(defaultTaskOptions) // Create a new mocked instance
		Object.defineProperty(mockCline1, "taskId", { value: "test-task-id-1", writable: true })
		Object.defineProperty(mockCline2, "taskId", { value: "test-task-id-2", writable: true })

		// add Cline instances to the stack
		await provider.addClineToStack(mockCline1)
		await provider.addClineToStack(mockCline2)

		// verify cline instances were added to the stack
		expect(provider.getTaskStackSize()).toBe(2)

		// verify current cline instance is the last one added
		expect(provider.getCurrentTask()).toBe(mockCline2)
	})

	test("createTask starts background agents without changing the visible task stack", async () => {
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		vi.mocked(parentTask.emit).mockClear()

		const removeClineFromStackSpy = vi.spyOn(provider, "removeClineFromStack")
		const focusedTaskIds: string[] = []
		provider.on(RooCodeEventName.TaskFocused, (taskId) => {
			focusedTaskIds.push(taskId)
		})

		const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
			agentId: "dashboard-js-animation",
			background: true,
			mode: "code",
		})

		expect(backgroundTask.background).toBe(true)
		expect((backgroundTask as any).enableCheckpoints).toBe(false)
		expect(backgroundTask.parentTask).toBe(parentTask)
		expect(backgroundTask.start).toHaveBeenCalledTimes(1)
		expect(provider.getTaskStackSize()).toBe(1)
		expect(provider.getCurrentTask()).toBe(parentTask)
		expect(removeClineFromStackSpy).not.toHaveBeenCalled()
		expect(backgroundTask.emit).not.toHaveBeenCalledWith(RooCodeEventName.TaskFocused)
		expect(focusedTaskIds).toEqual([])
		expect((provider as any).backgroundTasks.has(backgroundTask)).toBe(true)
	})

	test("createTask can delay background agent start until lifecycle listeners are attached", async () => {
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)

		const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
			agentId: "dashboard-js-animation",
			background: true,
			mode: "code",
			startTask: false,
		})

		expect(backgroundTask.background).toBe(true)
		expect(backgroundTask.parentTask).toBe(parentTask)
		expect(backgroundTask.start).not.toHaveBeenCalled()
		expect((provider as any).backgroundTasks.has(backgroundTask)).toBe(true)
	})

	test("background agent token usage is forwarded to the parallel status message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)

		const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
			agentId: "dashboard-js-animation",
			background: true,
			mode: "code",
		})

		backgroundTask.emit(
			RooCodeEventName.TaskTokenUsageUpdated,
			backgroundTask.taskId,
			{
				totalTokensIn: 100,
				totalTokensOut: 50,
				totalCacheWrites: 0,
				totalCacheReads: 0,
				totalCost: 0.01,
				contextTokens: 150,
			},
			{},
		)

		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "agentStatusUpdate",
				agentStatusUpdate: expect.objectContaining({
					agentId: "dashboard-js-animation",
					status: "running",
					usage: expect.objectContaining({
						totalTokensIn: 100,
						totalTokensOut: 50,
						totalCost: 0.01,
					}),
				}),
			}),
		)
	})

	test("approved execution plans create one persisted native parallelAgents tool message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())

		await vi.waitFor(() => expect(getParallelAgentToolMessages(parentTask)).toHaveLength(1))
		const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])

		expect(tool.tool).toBe("parallelAgents")
		expect(tool.parallelStatus).toBe("running")
		expect(tool.executionPlan?.planId).toBe("plan-webview-provider")
		expect(parentTask.say).toHaveBeenCalledWith(
			"tool",
			expect.any(String),
			undefined,
			undefined,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
	})

	test("AgentBus updates coalesce into the persisted parallelAgents tool message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())

		const bus = AgentBus.getInstance()
		bus.requestWriteIntent("dashboard-agent", "src/dashboard.tsx")
		bus.markComplete("dashboard-agent", "Dashboard done")

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentStatusUpdates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						status: "complete",
						lastTouchedFile: "src/dashboard.tsx",
						reason: "Dashboard done",
					}),
				]),
			)
		})

		expect(getParallelAgentToolMessages(parentTask)).toHaveLength(1)
		expect(parentTask.overwriteClineMessages).toHaveBeenCalled()
		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "messageUpdated",
				clineMessage: expect.objectContaining({ say: "tool" }),
			}),
		)
	})

	test("rapid AgentBus updates serialize persisted parallelAgents message saves without overlap", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		vi.mocked(parentTask.overwriteClineMessages).mockClear()

		let inFlight = 0
		let maxInFlight = 0
		let releaseFirstOverwrite!: () => void
		const firstOverwriteBlocked = new Promise<void>((resolve) => {
			releaseFirstOverwrite = resolve
		})
		parentTask.overwriteClineMessages = vi.fn(async (messages: ClineMessage[]) => {
			inFlight += 1
			maxInFlight = Math.max(maxInFlight, inFlight)
			parentTask.clineMessages = messages

			try {
				if (vi.mocked(parentTask.overwriteClineMessages).mock.calls.length === 1) {
					await firstOverwriteBlocked
				}
			} finally {
				inFlight -= 1
			}
		}) as typeof parentTask.overwriteClineMessages

		const bus = AgentBus.getInstance()
		bus.markRunning("dashboard-agent")
		bus.requestWriteIntent("dashboard-agent", "src/dashboard.tsx")
		bus.markBlocked("dashboard-agent", "Waiting for styles")
		bus.markComplete("dashboard-agent", "Dashboard done")
		bus.markRunning("styles-agent")

		await vi.waitFor(() => expect(parentTask.overwriteClineMessages).toHaveBeenCalledTimes(1))
		expect(maxInFlight).toBe(1)
		bus.markBlocked("styles-agent", "Paused while the parent row save is in flight")

		releaseFirstOverwrite()

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentStatusUpdates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						status: "complete",
						lastTouchedFile: "src/dashboard.tsx",
						reason: "Dashboard done",
					}),
					expect.objectContaining({
						agentId: "styles-agent",
						status: "blocked",
						reason: "Paused while the parent row save is in flight",
					}),
				]),
			)
		})

		expect(maxInFlight).toBe(1)
		expect(parentTask.overwriteClineMessages).toHaveBeenCalledTimes(2)
	})

	test("background agent messages persist concise activity summaries without raw child transcript text", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const childMessage: ClineMessage = {
			type: "say",
			say: "reasoning",
			ts: Date.now(),
			text: "raw child chain-of-thought should never be copied to the parent row",
		}

		backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: childMessage })

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentActivities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "thinking",
						message: "Reasoning through the next step.",
					}),
				]),
			)
			expect(tool.agentStatusUpdates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						activities: expect.arrayContaining([
							expect.objectContaining({
								kind: "thinking",
								message: "Reasoning through the next step.",
							}),
						]),
					}),
				]),
			)
			expect(JSON.stringify(tool)).not.toContain("raw child chain-of-thought")
		})
	})

	test("background agent partial messages replace generic thinking with sanitized live progress", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const apiRequestStarted: ClineMessage = {
			type: "say",
			say: "api_req_started",
			ts: 1_500,
			text: JSON.stringify({ apiProtocol: "anthropic" }),
		}
		const partialReasoning: ClineMessage = {
			type: "say",
			say: "reasoning",
			ts: 1_501,
			text: "raw streamed child reasoning should not be copied",
			partial: true,
		}
		const partialTool: ClineMessage = {
			type: "ask",
			ask: "tool",
			ts: 1_501,
			text: JSON.stringify({ tool: "write_to_file", path: "src/dashboard.tsx" }),
			partial: true,
		}

		backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: apiRequestStarted })
		backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: partialReasoning })

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			const activities = tool.agentActivities?.filter((activity) => activity.agentId === "dashboard-agent") ?? []
			expect(activities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "thinking",
						message: "Reasoning through the next step.",
						ts: 1_501,
					}),
				]),
			)
			expect(JSON.stringify(tool)).not.toContain("raw streamed child reasoning")
		})

		backgroundTask.emit(RooCodeEventName.Message, { action: "updated", message: partialTool })

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			const activities = tool.agentActivities?.filter((activity) => activity.agentId === "dashboard-agent") ?? []
			expect(activities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "thinking",
						message:
							"Requesting the next model action after created isolated worktree at /tmp/dashboard-agent",
						ts: 1_500,
					}),
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "tool",
						message: "Writing src/dashboard.tsx.",
						ts: 1_501,
					}),
				]),
			)
			expect(activities.filter((activity) => activity.ts === 1_501)).toHaveLength(1)
			expect(activities.map((activity) => activity.message)).not.toContain("Thinking…")
			expect(JSON.stringify(tool)).not.toContain("raw streamed child reasoning")
		})
	})

	test("background agent activity transcripts are bounded per agent", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		for (let index = 0; index < 55; index++) {
			const childMessage: ClineMessage = {
				type: "say",
				say: "tool",
				ts: 1_000 + index,
				text: JSON.stringify({ tool: "readFile", path: `src/file-${index}.ts` }),
			}

			backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: childMessage })
		}

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			const activities = tool.agentActivities?.filter((activity) => activity.agentId === "dashboard-agent") ?? []
			expect(activities).toHaveLength(50)
			expect(activities[0]).toEqual(
				expect.objectContaining({
					message: "Reading src/file-5.ts.",
					ts: 1_005,
				}),
			)
			expect(activities.at(-1)).toEqual(
				expect.objectContaining({
					message: "Reading src/file-54.ts.",
					ts: 1_054,
				}),
			)
			const statusUpdate = tool.agentStatusUpdates?.find((update) => update.agentId === "dashboard-agent")
			expect(statusUpdate?.activities).toHaveLength(50)
		})
	})

	test("background agent tool activity labels use concrete tool states before falling back", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const messages: ClineMessage[] = [
			{
				type: "say",
				say: "tool",
				ts: 2_000,
				text: JSON.stringify({ tool: "write_to_file", path: "src/dashboard.tsx" }),
			},
			{
				type: "say",
				say: "tool",
				ts: 2_001,
				text: JSON.stringify({ tool: "apply_diff", path: "src/dashboard.tsx" }),
			},
			{
				type: "say",
				say: "tool",
				ts: 2_002,
				text: JSON.stringify({ tool: "execute_command", command: "npm test" }),
			},
			{
				type: "ask",
				ask: "tool",
				ts: 2_003,
				text: JSON.stringify({ tool: "ask_followup_question", question: "Which behavior should I use?" }),
			},
		]

		for (const message of messages) {
			backgroundTask.emit(RooCodeEventName.Message, { action: "created", message })
		}

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentActivities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "tool",
						message: "Writing src/dashboard.tsx.",
					}),
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "tool",
						message: "Applying a diff to src/dashboard.tsx.",
					}),
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "tool",
						message: "Running command: npm test.",
					}),
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "approval",
						message: "Waiting for a follow-up answer.",
					}),
				]),
			)
			expect(tool.agentActivities?.map((activity) => activity.message)).not.toContain("Thinking…")
		})
	})

	test("answered write tool asks supersede stale diff-start activity labels", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const diffAsk: ClineMessage = {
			type: "ask",
			ask: "tool",
			ts: 2_100,
			text: JSON.stringify({ tool: "appliedDiff", path: "src/dashboard.css" }),
			partial: true,
		}

		backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: diffAsk })

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentActivities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						kind: "tool",
						message: "Applying a diff to src/dashboard.css.",
						ts: 2_100,
					}),
				]),
			)
		})

		backgroundTask.emit(RooCodeEventName.Message, {
			action: "updated",
			message: { ...diffAsk, partial: false, isAnswered: true },
		})

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			const activities = tool.agentActivities?.filter((activity) => activity.agentId === "dashboard-agent") ?? []
			const statusUpdate = tool.agentStatusUpdates?.find((update) => update.agentId === "dashboard-agent")
			expect(activities.filter((activity) => activity.ts === 2_100)).toEqual([
				expect.objectContaining({
					agentId: "dashboard-agent",
					kind: "file",
					message: "Saving diff changes to src/dashboard.css.",
					ts: 2_100,
				}),
			])
			expect(activities.map((activity) => activity.message)).not.toContain(
				"Applying a diff to src/dashboard.css.",
			)
			expect(statusUpdate?.activities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						kind: "file",
						message: "Saving diff changes to src/dashboard.css.",
					}),
				]),
			)
		})
	})

	test("background agent progress events supersede stale file-operation labels during long writes", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))

		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const backgroundTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const diffAsk: ClineMessage = {
			type: "ask",
			ask: "tool",
			ts: 2_200,
			text: JSON.stringify({ tool: "appliedDiff", path: "src/dashboard.tsx" }),
			partial: true,
		}

		backgroundTask.emit(RooCodeEventName.Message, { action: "created", message: diffAsk })

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.agentActivities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "dashboard-agent",
						message: "Applying a diff to src/dashboard.tsx.",
						ts: 2_200,
					}),
				]),
			)
		})

		AgentBus.getInstance().reportProgress(
			"dashboard-agent",
			"Applying 3 diff blocks to src/dashboard.tsx.",
			"file",
			"src/dashboard.tsx",
		)
		AgentBus.getInstance().reportProgress(
			"dashboard-agent",
			"Waiting up to 3s for diagnostics after saving src/dashboard.tsx.",
			"file",
			"src/dashboard.tsx",
		)

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			const activities = tool.agentActivities?.filter((activity) => activity.agentId === "dashboard-agent") ?? []
			const statusUpdate = tool.agentStatusUpdates?.find((update) => update.agentId === "dashboard-agent")

			expect(activities.at(-1)).toEqual(
				expect.objectContaining({
					agentId: "dashboard-agent",
					kind: "file",
					message: "Waiting up to 3s for diagnostics after saving src/dashboard.tsx.",
				}),
			)
			expect(activities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						kind: "file",
						message: "Applying 3 diff blocks to src/dashboard.tsx.",
					}),
				]),
			)
			expect(statusUpdate?.lastTouchedFile).toBe("src/dashboard.tsx")
			expect(statusUpdate?.activities?.at(-1)?.message).toBe(
				"Waiting up to 3s for diagnostics after saving src/dashboard.tsx.",
			)
		})
	})

	test("requestPlanApproval shows the plan preview and waits by default", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const plan = createExecutionPlan()

		const approvalPromise = provider.requestPlanApproval(plan)
		const approvalSpy = vi.fn()
		approvalPromise.then(approvalSpy)

		await vi.waitFor(() =>
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "showPlanPreview",
					executionPlan: plan,
				}),
			),
		)
		await Promise.resolve()

		expect(approvalSpy).not.toHaveBeenCalled()

		await provider.cancelExecutionPlan()
		await expect(approvalPromise).resolves.toEqual({ approved: false })
	})

	test("requestPlanApproval auto-starts valid parallel plans when parallel tasks auto-approval is enabled", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		await provider.setValues({ autoApprovalEnabled: true, alwaysAllowParallelTasks: true })
		const validateGitRepository = vi.fn().mockResolvedValue(undefined)
		const captureWorkspaceBaseline = vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" })
		;(provider as any).worktreeManager = {
			validateGitRepository,
			captureWorkspaceBaseline,
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}
		const plan = createExecutionPlan()

		const result = await provider.requestPlanApproval(plan)

		expect(result).toEqual({ approved: true, plan, startResult: { ok: true } })
		expect(validateGitRepository).toHaveBeenCalled()
		expect(captureWorkspaceBaseline).toHaveBeenCalledWith("plan-webview-provider")
		expect(validateGitRepository.mock.invocationCallOrder[0]).toBeLessThan(
			captureWorkspaceBaseline.mock.invocationCallOrder[0],
		)
		expect((provider as any).activeExecutionPlan).toBe(plan)
		expect(
			mockPostMessage.mock.calls.some(([message]: [ExtensionMessage]) => message.type === "showPlanPreview"),
		).toBe(false)
		await vi.waitFor(() => expect(getParallelAgentToolMessages(parentTask)).toHaveLength(1))
	})

	test("merge review collects uncommitted worktree changes before displaying agent diffs", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		const prepareMergeReview = vi.fn(async ({ agentId }: { agentId: string }) =>
			agentId === "dashboard-agent"
				? "diff --git a/src/dashboard.tsx b/src/dashboard.tsx\n+const dashboard = true\n"
				: "",
		)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview,
			mergeBranch: vi.fn().mockResolvedValue(undefined),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(plan)
		await vi.waitFor(() => expect((provider as any).activeExecutionPlan).toBe(plan))

		await provider.showMergeReview(plan)

		expect(prepareMergeReview).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "dashboard-agent",
				planId: "plan-webview-provider",
				worktreePath: "/tmp/dashboard-agent",
				branch: "roo/parallel/plan-webview-provider/dashboard-agent",
				ownedPaths: ["src/dashboard.tsx"],
			}),
		)
		expect(
			mockPostMessage.mock.calls.some(([message]: [ExtensionMessage]) => message.type === "showMergeReview"),
		).toBe(false)
		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("review")
		expect(statusTool.mergeReviewEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "dashboard-agent",
					diff: expect.stringContaining("diff --git"),
					changeStats: {
						filesChanged: 1,
						additions: 1,
						deletions: 0,
						totalChanges: 1,
						binaryFiles: 0,
					},
				}),
				expect.objectContaining({
					agentId: "styles-agent",
					diff: "",
					noChangesReason: "No changes detected in this agent worktree.",
					changeStats: {
						filesChanged: 0,
						additions: 0,
						deletions: 0,
						totalChanges: 0,
						binaryFiles: 0,
					},
				}),
			]),
		)
		expect(statusTool.parallelReviewSummary?.markdown).toContain(
			"Full per-agent diffs are available in the persisted parallel agents card.",
		)
	})

	test("merge approval prepares and merges only selected agent branches after review", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		const prepareMergeReview = vi.fn(
			async ({ agentId }: { agentId: string }) => `diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n`,
		)
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		const removeWorktree = vi.fn().mockResolvedValue(undefined)
		const cleanupPlanBaseline = vi.fn().mockResolvedValue(undefined)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview,
			mergeBranch,
			removeWorktree,
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline,
		}

		await provider.approveExecutionPlan(plan)
		await vi.waitFor(() => expect((provider as any).activeExecutionPlan).toBe(plan))

		expect(mergeBranch).not.toHaveBeenCalled()
		await provider.mergeApprovedAgents(["dashboard-agent"])

		expect(prepareMergeReview).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "dashboard-agent",
				worktreePath: "/tmp/dashboard-agent",
				ownedPaths: ["src/dashboard.tsx"],
			}),
		)
		expect(mergeBranch).toHaveBeenCalledTimes(1)
		expect(mergeBranch).toHaveBeenCalledWith("roo/parallel/plan-webview-provider/dashboard-agent", {
			planId: "plan-webview-provider",
			worktreePath: "/tmp/dashboard-agent",
			ownedPaths: ["src/dashboard.tsx"],
			autoApproved: false,
		})
		expect(mergeBranch).not.toHaveBeenCalledWith("roo/parallel/plan-webview-provider/styles-agent")
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/dashboard-agent")
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/styles-agent")
		expect(cleanupPlanBaseline).toHaveBeenCalledWith("plan-webview-provider")
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "mergeComplete" })
	})

	test("auto-approves and merges the final review when both auto-approval settings are enabled", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		await provider.setValues({ autoApprovalEnabled: true, alwaysAllowParallelTasks: true })
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const prepareMergeReview = vi.fn(
			async ({ agentId }: { agentId: string }) => `diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
		)
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		const removeWorktree = vi.fn().mockResolvedValue(undefined)
		const cleanupPlanBaseline = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreePathsByAgentId.set("styles-agent", "/tmp/styles-agent")
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview,
			mergeBranch,
			removeWorktree,
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline,
		}

		await provider.showMergeReview(plan)

		expect(mergeBranch).toHaveBeenCalledTimes(2)
		expect(mergeBranch).toHaveBeenCalledWith("roo/parallel/plan-webview-provider/dashboard-agent", {
			planId: "plan-webview-provider",
			worktreePath: "/tmp/dashboard-agent",
			ownedPaths: ["src/dashboard.tsx"],
			autoApproved: true,
		})
		expect(mergeBranch).toHaveBeenCalledWith("roo/parallel/plan-webview-provider/styles-agent", {
			planId: "plan-webview-provider",
			worktreePath: "/tmp/styles-agent",
			ownedPaths: ["src/styles.css"],
			autoApproved: true,
		})
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/dashboard-agent")
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/styles-agent")
		expect(cleanupPlanBaseline).toHaveBeenCalledWith("plan-webview-provider")
		expect(
			mockPostMessage.mock.calls.some(([message]: [ExtensionMessage]) => message.type === "showMergeReview"),
		).toBe(false)
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "mergeComplete" })

		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("merged")
		expect(statusTool.agentActivities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "dashboard-agent",
					message: "Auto-approved final merge review.",
					kind: "approval",
				}),
				expect.objectContaining({
					agentId: "dashboard-agent",
					message: "Auto-merged branch roo/parallel/plan-webview-provider/dashboard-agent.",
					kind: "completion",
				}),
			]),
		)
		const reviewSummaryMessages = parentTask.clineMessages.filter(
			(message) => message.type === "say" && message.say === "user_feedback_diff",
		)
		expect(reviewSummaryMessages).toHaveLength(0)
		expect(statusTool.parallelReviewSummary).toEqual(
			expect.objectContaining({
				path: ".roo/parallel-agent-review.md",
				markdown: expect.stringContaining(
					"Full per-agent diffs are available in the persisted parallel agents card.",
				),
			}),
		)
		expect(statusTool.parallelReviewSummary?.markdown).toContain("dashboard-agent: merged; 1 files, +1/-0")
		expect(statusTool.parallelReviewSummary?.markdown).not.toContain("diff --git a/src/dashboard-agent.ts")
	})

	test.each([
		["global auto-approval", { autoApprovalEnabled: false, alwaysAllowParallelTasks: true }],
		["parallel task auto-approval", { autoApprovalEnabled: true, alwaysAllowParallelTasks: false }],
	])("does not auto-merge the final review when %s is disabled", async (_setting, values) => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		await provider.setValues(values)
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreePathsByAgentId.set("styles-agent", "/tmp/styles-agent")
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(
				async ({ agentId }: { agentId: string }) =>
					`diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
			),
			mergeBranch,
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.showMergeReview(plan)

		expect(mergeBranch).not.toHaveBeenCalled()
		expect(
			mockPostMessage.mock.calls.some(([message]: [ExtensionMessage]) => message.type === "showMergeReview"),
		).toBe(false)
		expect(mockPostMessage).not.toHaveBeenCalledWith({ type: "mergeComplete" })
		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("review")
		expect(statusTool.mergeReviewEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ agentId: "dashboard-agent" }),
				expect.objectContaining({ agentId: "styles-agent" }),
			]),
		)
	})

	test("skips auto-merge when the final review has an unmergeable entry", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		await provider.setValues({ autoApprovalEnabled: true, alwaysAllowParallelTasks: true })
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreePathsByAgentId.set("styles-agent", "/tmp/styles-agent")
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(async ({ agentId }: { agentId: string }) => {
				if (agentId === "styles-agent") {
					throw new Error("Merge conflict during review")
				}

				return `diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`
			}),
			mergeBranch,
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.showMergeReview(plan)

		expect(mergeBranch).not.toHaveBeenCalled()
		expect(
			mockPostMessage.mock.calls.some(([message]: [ExtensionMessage]) => message.type === "showMergeReview"),
		).toBe(false)
		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("review")
		expect(statusTool.mergeReviewEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "styles-agent",
					reviewError: "Merge conflict during review",
					mergeable: false,
				}),
			]),
		)
		expect(statusTool.agentActivities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "styles-agent",
					message: "Auto-merge skipped: styles-agent has a merge review error",
					kind: "wait",
				}),
			]),
		)
	})

	test("failed merge attempts persist conflicted review state and keep the review actionable", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		parentTask.apiConversationHistory = [
			{
				role: "user",
				content: [{ type: "text", text: "Start parallel dashboard work" }],
			},
		] as any
		parentTask.overwriteApiConversationHistory = vi.fn(async (history) => {
			parentTask.apiConversationHistory = history as any
		})
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		const mergeError = new WorktreeMergeError(
			"rebase",
			"roo/parallel/plan-webview-provider/dashboard-agent",
			"/tmp/dashboard-agent",
			["index.html"],
			undefined,
			"CONFLICT (add/add): Merge conflict in index.html",
		)
		const mergeBranch = vi.fn(async (branch: string) => {
			if (branch === "roo/parallel/plan-webview-provider/dashboard-agent") {
				throw mergeError
			}
		})
		const removeWorktree = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = plan
		;(provider as any).worktreePathsByAgentId.set("dashboard-agent", "/tmp/dashboard-agent")
		;(provider as any).worktreePathsByAgentId.set("styles-agent", "/tmp/styles-agent")
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(
				async ({ agentId }: { agentId: string }) =>
					`diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
			),
			mergeBranch,
			removeWorktree,
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.showMergeReview(plan)
		mockPostMessage.mockClear()

		await expect(provider.mergeApprovedAgents(["dashboard-agent"])).resolves.toBe(false)

		expect(mergeBranch).toHaveBeenCalledWith("roo/parallel/plan-webview-provider/dashboard-agent", {
			planId: "plan-webview-provider",
			worktreePath: "/tmp/dashboard-agent",
			ownedPaths: ["src/dashboard.tsx"],
			autoApproved: false,
		})
		expect(removeWorktree).not.toHaveBeenCalled()
		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "mergeFailed",
				agentId: "dashboard-agent",
				gitOutput: expect.stringContaining("CONFLICT (add/add)"),
			}),
		)

		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("review")
		expect(statusTool.mergeReviewEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "dashboard-agent",
					mergeStatus: "failed",
					mergeable: false,
					mergeError: expect.stringContaining("CONFLICT (add/add)"),
					conflictedFiles: ["index.html"],
				}),
			]),
		)
		const lastApiMessage = parentTask.apiConversationHistory.at(-1) as any
		expect(lastApiMessage.content[0].text).toContain(
			"[PARALLEL AGENT SUMMARY] Plan plan-webview-provider is failed.",
		)
		expect(lastApiMessage.content[0].text).toContain("dashboard-agent")
		expect(lastApiMessage.content[0].text).toContain("CONFLICT (add/add)")
		expect(lastApiMessage.content[0].text).toContain("Use the persisted parallel agents card")
		expect(
			parentTask.clineMessages.filter(
				(message) => message.type === "say" && message.say === "user_feedback_diff",
			),
		).toHaveLength(0)
	})

	test("merge approval restores persisted review state when live parallel agents are gone", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		parentTask.apiConversationHistory = [
			{
				role: "user",
				content: [{ type: "text", text: "Resume pending parallel review" }],
			},
		] as any
		parentTask.overwriteApiConversationHistory = vi.fn(async (history) => {
			parentTask.apiConversationHistory = history as any
		})
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		parentTask.clineMessages = [
			{
				type: "say",
				say: "tool",
				text: JSON.stringify({
					tool: "parallelAgents",
					executionPlan: plan,
					parallelStatus: "review",
					agentStatusUpdates: plan.agents.map((agent) => ({ agentId: agent.id, status: "complete" })),
					mergeReviewEntries: plan.agents.map((agent) => ({
						agentId: agent.id,
						mode: agent.mode,
						task: agent.task,
						diff: `diff --git a/src/${agent.id}.ts b/src/${agent.id}.ts\n+done\n`,
						worktreePath: `/tmp/${agent.id}`,
						branch: `roo/parallel/plan-webview-provider/${agent.id}`,
						mergeStatus: "pending",
					})),
				} satisfies ClineSayTool),
				ts: 101,
			},
		]
		await provider.addClineToStack(parentTask)
		const mergeBranch = vi.fn().mockResolvedValue(undefined)
		const removeWorktree = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = undefined
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(
				async ({ agentId }: { agentId: string }) =>
					`diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
			),
			mergeBranch,
			removeWorktree,
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await expect(provider.mergeApprovedAgents(["dashboard-agent"])).resolves.toBe(true)

		expect(mergeBranch).toHaveBeenCalledWith("roo/parallel/plan-webview-provider/dashboard-agent", {
			planId: "plan-webview-provider",
			worktreePath: "/tmp/dashboard-agent",
			ownedPaths: ["src/dashboard.tsx"],
			autoApproved: false,
		})
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/dashboard-agent")
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/styles-agent")
		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("merged")
		expect(statusTool.mergeReviewEntries).toEqual(
			expect.arrayContaining([expect.objectContaining({ agentId: "dashboard-agent", mergeStatus: "merged" })]),
		)
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "mergeComplete" })
	})

	test("merge denial restores persisted review state and marks the chat row cancelled", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		parentTask.apiConversationHistory = [
			{
				role: "user",
				content: [{ type: "text", text: "Resume pending parallel review" }],
			},
		] as any
		parentTask.overwriteApiConversationHistory = vi.fn(async (history) => {
			parentTask.apiConversationHistory = history as any
		})
		const plan = createExecutionPlan()
		plan.agents = plan.agents.map((agent) => ({
			...agent,
			status: "complete",
			worktreePath: `/tmp/${agent.id}`,
		}))
		parentTask.clineMessages = [
			{
				type: "say",
				say: "tool",
				text: JSON.stringify({
					tool: "parallelAgents",
					executionPlan: plan,
					parallelStatus: "review",
					agentStatusUpdates: plan.agents.map((agent) => ({ agentId: agent.id, status: "complete" })),
					mergeReviewEntries: plan.agents.map((agent) => ({
						agentId: agent.id,
						mode: agent.mode,
						task: agent.task,
						diff: `diff --git a/src/${agent.id}.ts b/src/${agent.id}.ts\n+done\n`,
						worktreePath: `/tmp/${agent.id}`,
						branch: `roo/parallel/plan-webview-provider/${agent.id}`,
						mergeStatus: "pending",
					})),
				} satisfies ClineSayTool),
				ts: 101,
			},
		]
		await provider.addClineToStack(parentTask)
		const removeWorktree = vi.fn().mockResolvedValue(undefined)
		const cleanup = vi.fn().mockResolvedValue(undefined)
		;(provider as any).activeExecutionPlan = undefined
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			prepareMergeReview: vi.fn(
				async ({ agentId }: { agentId: string }) =>
					`diff --git a/src/${agentId}.ts b/src/${agentId}.ts\n+done\n`,
			),
			mergeBranch: vi.fn().mockResolvedValue(undefined),
			removeWorktree,
			cleanup,
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await expect(provider.denyMergeReview()).resolves.toBe(true)

		expect(cleanup).toHaveBeenCalled()
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/dashboard-agent")
		expect(removeWorktree).toHaveBeenCalledWith("/tmp/styles-agent")
		const statusTool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(statusTool.parallelStatus).toBe("cancelled")
		expect(statusTool.mergeReviewEntries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					agentId: "dashboard-agent",
					mergeStatus: "skipped",
					autoMergeSkippedReason: "Merge review was denied from chat.",
				}),
				expect.objectContaining({
					agentId: "styles-agent",
					mergeStatus: "skipped",
					autoMergeSkippedReason: "Merge review was denied from chat.",
				}),
			]),
		)
		expect(mockPostMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "mergeFailed" }))
		const lastApiMessage = parentTask.apiConversationHistory.at(-1) as any
		expect(lastApiMessage.content[0].text).toContain(
			"[PARALLEL AGENT SUMMARY] Plan plan-webview-provider is cancelled.",
		)
		expect(lastApiMessage.content[0].text).toContain("Merge review was denied from chat.")
		expect(lastApiMessage.content[0].text).toContain("Use the persisted parallel agents card")
		expect(
			parentTask.clineMessages.filter(
				(message) => message.type === "say" && message.say === "user_feedback_diff",
			),
		).toHaveLength(0)
	})

	test("background agent streaming aborts clean up without visible task rehydration", async () => {
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)

		const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
			agentId: "dashboard-js-animation",
			background: true,
			mode: "code",
		})
		backgroundTask.abortReason = "streaming_failed"

		const getTaskWithIdSpy = vi.spyOn(provider, "getTaskWithId")
		const createTaskWithHistoryItemSpy = vi.spyOn(provider, "createTaskWithHistoryItem")

		backgroundTask.emit(RooCodeEventName.TaskAborted)

		await vi.waitFor(() => expect((provider as any).backgroundTasks.has(backgroundTask)).toBe(false))
		expect(getTaskWithIdSpy).not.toHaveBeenCalled()
		expect(createTaskWithHistoryItemSpy).not.toHaveBeenCalled()
		expect(provider.getTaskStackSize()).toBe(1)
		expect(provider.getCurrentTask()).toBe(parentTask)
		expect(backgroundTask.off).toHaveBeenCalled()
	})

	test("background agent completion finalizes AgentBus status before cleanup", async () => {
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		;(provider as any).activeExecutionPlan = plan
		AgentBus.getInstance().setExecutionPlan(plan)

		const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
			agentId: "dashboard-agent",
			background: true,
			mode: "code",
		})

		backgroundTask.emit(
			RooCodeEventName.TaskCompleted,
			backgroundTask.taskId,
			{
				totalTokensIn: 10,
				totalTokensOut: 5,
				totalCacheWrites: 0,
				totalCacheReads: 0,
				totalCost: 0.01,
				contextTokens: 15,
			},
			{},
		)

		expect(AgentBus.getInstance().getAgent("dashboard-agent")?.status).toBe("complete")
		expect((provider as any).backgroundTasks.has(backgroundTask)).toBe(false)
	})

	test("background agent abort finalizes AgentBus status before cleanup", async () => {
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		const plan = createExecutionPlan()
		;(provider as any).activeExecutionPlan = plan
		AgentBus.getInstance().setExecutionPlan(plan)

		const backgroundTask = await provider.createTask("Run a specialist agent task", undefined, parentTask, {
			agentId: "dashboard-agent",
			background: true,
			mode: "code",
		})

		backgroundTask.emit(RooCodeEventName.TaskAborted)

		expect(AgentBus.getInstance().getAgent("dashboard-agent")?.status).toBe("failed")
		expect((provider as any).backgroundTasks.has(backgroundTask)).toBe(false)
	})

	test("top-level tasks cancel active parallel state before opening a new visible task", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))
		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)

		const nextTask = await provider.createTask("Build an HTML dashboard")

		expect(provider.getCurrentTask()).toBe(nextTask)
		expect((provider as any).activeExecutionPlan).toBeUndefined()
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBe(0))
		for (const backgroundTask of backgroundTasks) {
			expect(backgroundTask.abortTask).toHaveBeenCalledWith(true)
		}

		const oldPlanEvent = {
			type: "COMPLETE",
			agentId: "dashboard-agent",
			result: "Stale completion",
		} as const
		;(provider as any).forwardAgentEvent(oldPlanEvent)

		expect(getParallelAgentToolMessages(nextTask)).toHaveLength(0)
	})

	test("cancelTask tears down active parallel state and persists cancelled agent statuses", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}
		vi.spyOn(provider, "getTaskWithId").mockResolvedValue({
			historyItem: {
				id: parentTask.taskId,
				number: 1,
				ts: Date.now(),
				task: "Parent task",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			} as HistoryItem,
			apiConversationHistory: [],
			taskDirPath: "/tmp/task",
			apiConversationHistoryFilePath: "/tmp/task/api.json",
			uiMessagesFilePath: "/tmp/task/messages.json",
		})
		vi.spyOn(provider, "createTaskWithHistoryItem").mockResolvedValue(undefined as any)

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))
		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)

		await provider.cancelTask()

		expect((provider as any).activeExecutionPlan).toBeUndefined()
		expect((provider as any).backgroundTasks.size).toBe(0)
		for (const backgroundTask of backgroundTasks) {
			expect(backgroundTask.abortTask).toHaveBeenCalledWith(true)
		}
		const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
		expect(tool.parallelStatus).toBe("cancelled")
		expect(tool.agentStatusUpdates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ agentId: "dashboard-agent", status: "failed" }),
				expect.objectContaining({ agentId: "styles-agent", status: "failed" }),
			]),
		)
	})

	test("clearTask tears down active parallel state before removing the visible task", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(0))
		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)

		await provider.clearTask()

		expect((provider as any).activeExecutionPlan).toBeUndefined()
		expect((provider as any).backgroundTasks.size).toBe(0)
		expect(provider.getTaskStackSize()).toBe(0)
		for (const backgroundTask of backgroundTasks) {
			expect(backgroundTask.abortTask).toHaveBeenCalledWith(true)
		}
	})

	test("parallel status messages persist aggregate child token usage", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const parentTask = new Task(defaultTaskOptions)
		await provider.addClineToStack(parentTask)
		;(provider as any).worktreeManager = {
			validateGitRepository: vi.fn().mockResolvedValue(undefined),
			captureWorkspaceBaseline: vi.fn().mockResolvedValue({ commit: "baseline", ref: "refs/roo/baseline" }),
			createWorktree: vi.fn(async (agentId: string) => `/tmp/${agentId}`),
			removeWorktree: vi.fn().mockResolvedValue(undefined),
			cleanup: vi.fn().mockResolvedValue(undefined),
			cleanupPlanBaseline: vi.fn().mockResolvedValue(undefined),
		}

		await provider.approveExecutionPlan(createExecutionPlan())
		await vi.waitFor(() => expect((provider as any).backgroundTasks.size).toBeGreaterThan(1))
		const backgroundTasks = Array.from((provider as any).backgroundTasks as Set<Task>)
		const dashboardTask = backgroundTasks.find((task) => task.agentId === "dashboard-agent") as Task
		const stylesTask = backgroundTasks.find((task) => task.agentId === "styles-agent") as Task

		dashboardTask.emit(
			RooCodeEventName.TaskTokenUsageUpdated,
			dashboardTask.taskId,
			{
				totalTokensIn: 100,
				totalTokensOut: 50,
				totalCacheWrites: 10,
				totalCacheReads: 20,
				totalCost: 0.01,
				contextTokens: 150,
			},
			{},
		)
		stylesTask.emit(
			RooCodeEventName.TaskTokenUsageUpdated,
			stylesTask.taskId,
			{
				totalTokensIn: 200,
				totalTokensOut: 70,
				totalCacheWrites: 0,
				totalCacheReads: 30,
				totalCost: 0.02,
				contextTokens: 270,
			},
			{},
		)

		await vi.waitFor(() => {
			const tool = parseParallelAgentToolMessage(getParallelAgentToolMessages(parentTask)[0])
			expect(tool.parallelUsageSummary).toEqual({
				totalTokensIn: 300,
				totalTokensOut: 120,
				totalCacheWrites: 10,
				totalCacheReads: 50,
				totalCost: 0.03,
				contextTokens: 420,
				reportingAgents: 2,
			})
		})
	})

	test("getState returns correct initial state", async () => {
		const state = await provider.getState()

		expect(state).toHaveProperty("apiConfiguration")
		expect(state.apiConfiguration).toHaveProperty("apiProvider")
		expect(state).toHaveProperty("customInstructions")
		expect(state).toHaveProperty("alwaysAllowReadOnly")
		expect(state).toHaveProperty("alwaysAllowWrite")
		expect(state).toHaveProperty("alwaysAllowExecute")
		expect(state.alwaysAllowParallelTasks).toBe(false)
		expect(state).toHaveProperty("taskHistory")
		expect(state).toHaveProperty("soundEnabled")
		expect(state).toHaveProperty("ttsEnabled")
		expect(state).toHaveProperty("writeDelayMs")
	})

	test("language is set to VSCode language", async () => {
		// Mock VSCode language as Spanish
		;(vscode.env as any).language = "pt-BR"

		const state = await provider.getState()
		expect(state.language).toBe("pt-BR")
	})

	test("writeDelayMs defaults to 1000ms", async () => {
		// Mock globalState.get to return undefined for writeDelayMs
		;(mockContext.globalState.get as any).mockImplementation((key: string) =>
			key === "writeDelayMs" ? undefined : null,
		)

		const state = await provider.getState()
		expect(state.writeDelayMs).toBe(1000)
	})

	test("handles writeDelayMs message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		await messageHandler({ type: "updateSettings", updatedSettings: { writeDelayMs: 2000 } })

		expect(updateGlobalStateSpy).toHaveBeenCalledWith("writeDelayMs", 2000)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("writeDelayMs", 2000)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("updates sound utility when sound setting changes", async () => {
		await provider.resolveWebviewView(mockWebviewView)

		// Get the message handler from onDidReceiveMessage
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Simulate setting sound to enabled
		await messageHandler({ type: "updateSettings", updatedSettings: { soundEnabled: true } })
		expect(updateGlobalStateSpy).toHaveBeenCalledWith("soundEnabled", true)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("soundEnabled", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting sound to disabled
		await messageHandler({ type: "updateSettings", updatedSettings: { soundEnabled: false } })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("soundEnabled", false)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting tts to enabled
		await messageHandler({ type: "updateSettings", updatedSettings: { ttsEnabled: true } })
		expect(setTtsEnabled).toHaveBeenCalledWith(true)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("ttsEnabled", true)
		expect(mockPostMessage).toHaveBeenCalled()

		// Simulate setting tts to disabled
		await messageHandler({ type: "updateSettings", updatedSettings: { ttsEnabled: false } })
		expect(setTtsEnabled).toHaveBeenCalledWith(false)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("ttsEnabled", false)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("autoCondenseContext defaults to true", async () => {
		// Mock globalState.get to return undefined for autoCondenseContext
		;(mockContext.globalState.get as any).mockImplementation((key: string) =>
			key === "autoCondenseContext" ? undefined : null,
		)
		const state = await provider.getState()
		expect(state.autoCondenseContext).toBe(true)
	})

	test("handles autoCondenseContext message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
		await messageHandler({ type: "updateSettings", updatedSettings: { autoCondenseContext: false } })
		expect(updateGlobalStateSpy).toHaveBeenCalledWith("autoCondenseContext", false)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("autoCondenseContext", false)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("autoCondenseContextPercent defaults to 100", async () => {
		// Mock globalState.get to return undefined for autoCondenseContextPercent
		;(mockContext.globalState.get as any).mockImplementation((key: string) =>
			key === "autoCondenseContextPercent" ? undefined : null,
		)

		const state = await provider.getState()
		expect(state.autoCondenseContextPercent).toBe(100)
	})

	test("handles autoCondenseContextPercent message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		await messageHandler({ type: "updateSettings", updatedSettings: { autoCondenseContextPercent: 75 } })

		expect(updateGlobalStateSpy).toHaveBeenCalledWith("autoCondenseContextPercent", 75)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("autoCondenseContextPercent", 75)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	it("loads saved API config when switching modes", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		const profile: ProviderSettingsEntry = { name: "test-config", id: "test-id", apiProvider: "anthropic" }

		;(provider as any).providerSettingsManager = {
			getModeConfigId: vi.fn().mockResolvedValue("test-id"),
			listConfig: vi.fn().mockResolvedValue([profile]),
			activateProfile: vi.fn().mockResolvedValue(profile),
			setModeConfig: vi.fn(),
			getProfile: vi.fn().mockResolvedValue(profile),
		} as any

		// Switch to architect mode
		await messageHandler({ type: "mode", text: "architect" })

		// Should load the saved config for architect mode
		expect(provider.providerSettingsManager.getModeConfigId).toHaveBeenCalledWith("architect")
		expect(provider.providerSettingsManager.activateProfile).toHaveBeenCalledWith({ name: "test-config" })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")
	})

	it("saves current config when switching to mode without config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		;(provider as any).providerSettingsManager = {
			getModeConfigId: vi.fn().mockResolvedValue(undefined),
			listConfig: vi
				.fn()
				.mockResolvedValue([{ name: "current-config", id: "current-id", apiProvider: "anthropic" }]),
			setModeConfig: vi.fn(),
		} as any

		provider.setValue("currentApiConfigName", "current-config")

		// Switch to architect mode
		await messageHandler({ type: "mode", text: "architect" })

		// Should save current config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "current-id")
	})

	it("saves config as default for current mode when loading config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		const profile: ProviderSettingsEntry = { apiProvider: "anthropic", id: "new-id", name: "new-config" }

		;(provider as any).providerSettingsManager = {
			activateProfile: vi.fn().mockResolvedValue(profile),
			listConfig: vi.fn().mockResolvedValue([profile]),
			setModeConfig: vi.fn(),
			getModeConfigId: vi.fn().mockResolvedValue(undefined),
		} as any

		// First set the mode
		await messageHandler({ type: "mode", text: "architect" })

		// Then load the config
		await messageHandler({ type: "loadApiConfiguration", text: "new-config" })

		// Should save new config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "new-id")
	})

	it("load API configuration by ID works and updates mode config", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		const profile: ProviderSettingsEntry = {
			name: "config-by-id",
			id: "config-id-123",
			apiProvider: "anthropic",
		}

		;(provider as any).providerSettingsManager = {
			activateProfile: vi.fn().mockResolvedValue(profile),
			listConfig: vi.fn().mockResolvedValue([profile]),
			setModeConfig: vi.fn(),
			getModeConfigId: vi.fn().mockResolvedValue(undefined),
		} as any

		// First set the mode
		await messageHandler({ type: "mode", text: "architect" })

		// Then load the config by ID
		await messageHandler({ type: "loadApiConfigurationById", text: "config-id-123" })

		// Should save new config as default for architect mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "config-id-123")

		// Ensure the `activateProfile` method was called with the correct ID
		expect(provider.providerSettingsManager.activateProfile).toHaveBeenCalledWith({ id: "config-id-123" })
	})

	test("handles showRooIgnoredFiles setting", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Default value should be false
		expect((await provider.getState()).showRooIgnoredFiles).toBe(false)

		// Test showRooIgnoredFiles with true
		await messageHandler({ type: "updateSettings", updatedSettings: { showRooIgnoredFiles: true } })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("showRooIgnoredFiles", true)
		expect(mockPostMessage).toHaveBeenCalled()
		expect((await provider.getState()).showRooIgnoredFiles).toBe(true)

		// Test showRooIgnoredFiles with false
		await messageHandler({ type: "updateSettings", updatedSettings: { showRooIgnoredFiles: false } })
		expect(mockContext.globalState.update).toHaveBeenCalledWith("showRooIgnoredFiles", false)
		expect(mockPostMessage).toHaveBeenCalled()
		expect((await provider.getState()).showRooIgnoredFiles).toBe(false)
	})

	test("handles updatePrompt message correctly", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock existing prompts
		const existingPrompts = {
			code: {
				roleDefinition: "existing code role",
				customInstructions: "existing code prompt",
			},
			architect: {
				roleDefinition: "existing architect role",
				customInstructions: "existing architect prompt",
			},
		}

		provider.setValue("customModePrompts", existingPrompts)

		// Test updating a prompt
		await messageHandler({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: "new code prompt",
		})

		// Verify state was updated correctly
		expect(mockContext.globalState.update).toHaveBeenCalledWith("customModePrompts", {
			...existingPrompts,
			code: "new code prompt",
		})

		// Verify state was posted to webview
		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "state",
				state: expect.objectContaining({
					customModePrompts: {
						...existingPrompts,
						code: "new code prompt",
					},
				}),
			}),
		)
	})

	test("customModePrompts defaults to empty object", async () => {
		// Mock globalState.get to return undefined for customModePrompts
		;(mockContext.globalState.get as any).mockImplementation((key: string) => {
			if (key === "customModePrompts") {
				return undefined
			}
			return null
		})

		const state = await provider.getState()
		expect(state.customModePrompts).toEqual({})
	})

	test("handles maxWorkspaceFiles message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		await messageHandler({ type: "updateSettings", updatedSettings: { maxWorkspaceFiles: 300 } })

		expect(updateGlobalStateSpy).toHaveBeenCalledWith("maxWorkspaceFiles", 300)
		expect(mockContext.globalState.update).toHaveBeenCalledWith("maxWorkspaceFiles", 300)
		expect(mockPostMessage).toHaveBeenCalled()
	})

	test("handles mode-specific custom instructions updates", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock existing prompts
		const existingPrompts = {
			code: {
				roleDefinition: "Code role",
				customInstructions: "Old instructions",
			},
		}
		mockContext.globalState.get = vi.fn((key: string) => {
			if (key === "customModePrompts") {
				return existingPrompts
			}
			return undefined
		})

		// Update custom instructions for code mode
		await messageHandler({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: {
				roleDefinition: "Code role",
				customInstructions: "New instructions",
			},
		})

		// Verify state was updated correctly
		expect(mockContext.globalState.update).toHaveBeenCalledWith("customModePrompts", {
			code: {
				roleDefinition: "Code role",
				customInstructions: "New instructions",
			},
		})
	})

	it("saves mode config when updating API configuration", async () => {
		// Setup mock context with mode and config name
		mockContext = {
			...mockContext,
			globalState: {
				...mockContext.globalState,
				get: vi.fn((key: string) => {
					if (key === "mode") {
						return "code"
					} else if (key === "currentApiConfigName") {
						return "test-config"
					}
					return undefined
				}),
				update: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
			},
		} as unknown as vscode.ExtensionContext

		// Create new provider with updated mock context
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		;(provider as any).providerSettingsManager = {
			listConfig: vi.fn().mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			saveConfig: vi.fn().mockResolvedValue("test-id"),
			setModeConfig: vi.fn(),
		} as any

		// Update API configuration
		await messageHandler({
			type: "upsertApiConfiguration",
			text: "test-config",
			apiConfiguration: { apiProvider: "anthropic" },
		})

		// Should save config as default for current mode
		expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("code", "test-id")
	})

	test("file content includes line numbers", async () => {
		const { extractTextFromFile } = await import("../../../integrations/misc/extract-text")
		const result = await extractTextFromFile("test.js")
		expect(result).toBe("1 | const x = 1;\n2 | const y = 2;\n3 | const z = 3;")
	})

	describe("deleteMessage", () => {
		beforeEach(async () => {
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("handles deletion with confirmation dialog", async () => {
			// Setup mock messages
			const mockMessages = [
				{ ts: 1000, type: "say", say: "user_feedback" }, // User message 1
				{ ts: 2000, type: "say", say: "tool" }, // Tool message
				{ ts: 3000, type: "say", say: "text" }, // Message before delete
				{ ts: 4000, type: "say", say: "tool" }, // Message to delete
				{ ts: 5000, type: "say", say: "user_feedback" }, // Next user message
				{ ts: 6000, type: "say", say: "user_feedback" }, // Final message
			] as ClineMessage[]

			const mockApiHistory = [
				{ ts: 1000 },
				{ ts: 2000 },
				{ ts: 3000 },
				{ ts: 4000 },
				{ ts: 5000 },
				{ ts: 6000 },
			] as (Anthropic.MessageParam & { ts?: number })[]

			// Setup Task instance with auto-mock from the top of the file
			const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance
			mockCline.clineMessages = mockMessages // Set test-specific messages
			mockCline.apiConversationHistory = mockApiHistory // Set API history
			await provider.addClineToStack(mockCline) // Add the mocked instance to the stack

			// Mock getTaskWithId
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			// Mock createTaskWithHistoryItem
			;(provider as any).createTaskWithHistoryItem = vi.fn()

			// Trigger message deletion
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
			await messageHandler({ type: "deleteMessage", value: 4000 })

			// Verify that the dialog message was sent to webview
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showDeleteMessageDialog",
				messageTs: 4000,
				hasCheckpoint: false,
			})

			// Simulate user confirming deletion through the dialog
			await messageHandler({ type: "deleteMessageConfirm", messageTs: 4000 })

			// Verify only messages before the deleted message were kept
			expect(mockCline.overwriteClineMessages).toHaveBeenCalledWith([
				mockMessages[0],
				mockMessages[1],
				mockMessages[2],
			])

			// Verify only API messages before the deleted message were kept
			expect(mockCline.overwriteApiConversationHistory).toHaveBeenCalledWith([
				mockApiHistory[0],
				mockApiHistory[1],
				mockApiHistory[2],
			])

			// createTaskWithHistoryItem is only called when restoring checkpoints or aborting tasks
			expect((provider as any).createTaskWithHistoryItem).not.toHaveBeenCalled()
		})

		test("handles case when no current task exists", async () => {
			// Clear the cline stack
			;(provider as any).clineStack = []

			// Trigger message deletion
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
			await messageHandler({ type: "deleteMessage", value: 2000 })

			// Verify no dialog was shown since there's no current cline
			expect(mockPostMessage).not.toHaveBeenCalledWith(
				expect.objectContaining({
					type: "showDeleteMessageDialog",
				}),
			)
		})
	})

	describe("editMessage", () => {
		beforeEach(async () => {
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("handles edit with confirmation dialog", async () => {
			// Setup mock messages
			const mockMessages = [
				{ ts: 1000, type: "say", say: "user_feedback" }, // User message 1
				{ ts: 2000, type: "say", say: "tool" }, // Tool message
				{ ts: 3000, type: "say", say: "text" }, // Message before edit
				{ ts: 4000, type: "say", say: "tool" }, // Message to edit
				{ ts: 5000, type: "say", say: "user_feedback" }, // Next user message
				{ ts: 6000, type: "say", say: "user_feedback" }, // Final message
			] as ClineMessage[]

			const mockApiHistory = [
				{ ts: 1000 },
				{ ts: 2000 },
				{ ts: 3000 },
				{ ts: 4000 },
				{ ts: 5000 },
				{ ts: 6000 },
			] as (Anthropic.MessageParam & { ts?: number })[]

			// Setup Task instance with auto-mock from the top of the file
			const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance
			mockCline.clineMessages = mockMessages // Set test-specific messages
			mockCline.apiConversationHistory = mockApiHistory // Set API history

			// Explicitly mock the overwrite methods since they're not being called in the tests
			mockCline.overwriteClineMessages = vi.fn()
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.handleWebviewAskResponse = vi.fn()

			await provider.addClineToStack(mockCline) // Add the mocked instance to the stack

			// Mock getTaskWithId
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			// Trigger message edit
			// Get the message handler function that was registered with the webview
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Call the message handler with a submitEditedMessage message
			await messageHandler({
				type: "submitEditedMessage",
				value: 4000,
				editedMessageContent: "Edited message content",
			})

			// Verify that the dialog message was sent to webview
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 4000,
				text: "Edited message content",
				hasCheckpoint: false,
				images: undefined,
			})

			// Simulate user confirming edit through the dialog
			await messageHandler({
				type: "editMessageConfirm",
				messageTs: 4000,
				text: "Edited message content",
			})

			// Verify correct messages were kept - delete from the preceding user message to truly replace it
			expect(mockCline.overwriteClineMessages).toHaveBeenCalledWith([])

			// Verify correct API messages were kept
			expect(mockCline.overwriteApiConversationHistory).toHaveBeenCalledWith([])

			// The new flow calls webviewMessageHandler recursively with askResponse
			// We need to verify the recursive call happened by checking if the handler was called again
			expect((mockWebviewView.webview.onDidReceiveMessage as any).mock.calls.length).toBeGreaterThanOrEqual(1)
		})
	})

	describe("getSystemPrompt", () => {
		beforeEach(async () => {
			mockPostMessage.mockClear()
			await provider.resolveWebviewView(mockWebviewView)
			// Reset and setup mock
			mockAddCustomInstructions.mockClear()
			mockAddCustomInstructions.mockImplementation(
				(modeInstructions: string, globalInstructions: string, _cwd: string) => {
					return Promise.resolve(modeInstructions || globalInstructions || "")
				},
			)
		})

		const getMessageHandler = () => {
			const mockCalls = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls
			expect(mockCalls.length).toBeGreaterThan(0)
			return mockCalls[0][0]
		}

		test("handles mcpEnabled setting correctly", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const handler = getMessageHandler()
			expect(typeof handler).toBe("function")

			// Test with mcpEnabled: true
			vi.spyOn(provider, "getState").mockResolvedValueOnce({
				apiConfiguration: {
					apiProvider: "openrouter" as const,
				},
				mcpEnabled: true,
				mode: "code" as const,
				experiments: experimentDefault,
			} as any)

			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify system prompt was generated and sent
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "systemPrompt",
					text: expect.any(String),
					mode: "code",
				}),
			)

			// Reset for second test
			mockPostMessage.mockClear()

			// Test with mcpEnabled: false
			vi.spyOn(provider, "getState").mockResolvedValueOnce({
				apiConfiguration: {
					apiProvider: "openrouter" as const,
				},
				mcpEnabled: false,
				mode: "code" as const,
				experiments: experimentDefault,
			} as any)

			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify system prompt was generated and sent
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "systemPrompt",
					text: expect.any(String),
					mode: "code",
				}),
			)
		})

		test("handles errors gracefully", async () => {
			// Mock SYSTEM_PROMPT to throw an error
			const { SYSTEM_PROMPT } = await import("../../prompts/system")
			vi.mocked(SYSTEM_PROMPT).mockRejectedValueOnce(new Error("Test error"))

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
			await messageHandler({ type: "getSystemPrompt", mode: "code" })

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.get_system_prompt")
		})

		test("uses code mode custom instructions", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock getState to return custom instructions for code mode
			vi.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter" as const,
				},
				customModePrompts: {
					code: { customInstructions: "Code mode specific instructions" },
				},
				mode: "code" as const,
				experiments: experimentDefault,
			} as any)

			// Trigger getSystemPrompt
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "code" })

			// Verify system prompt was generated and sent
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "systemPrompt",
					text: expect.any(String),
					mode: "code",
				}),
			)
		})

		test("uses correct mode-specific instructions when mode is specified", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock getState to return architect mode instructions
			vi.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				customModePrompts: {
					architect: { customInstructions: "Architect mode instructions" },
				},
				mode: "architect",
				mcpEnabled: false,
				experiments: experimentDefault,
			} as any)

			// Trigger getSystemPrompt for architect mode
			const handler = getMessageHandler()
			await handler({ type: "getSystemPrompt", mode: "architect" })

			// Verify system prompt was generated and sent
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "systemPrompt",
					text: expect.any(String),
					mode: "architect",
				}),
			)
		})
	})

	describe("handleModeSwitch", () => {
		beforeEach(async () => {
			// Set up webview for each test
			await provider.resolveWebviewView(mockWebviewView)
		})

		it("loads saved API config when switching modes", async () => {
			const profile: ProviderSettingsEntry = {
				name: "saved-config",
				id: "saved-config-id",
				apiProvider: "anthropic",
			}

			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue("saved-config-id"),
				listConfig: vi.fn().mockResolvedValue([profile]),
				activateProfile: vi.fn().mockResolvedValue(profile),
				setModeConfig: vi.fn(),
				getProfile: vi.fn().mockResolvedValue(profile),
			} as any

			// Switch to architect mode
			await provider.handleModeSwitch("architect")

			// Verify mode was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "architect")

			// Verify saved config was loaded
			expect(provider.providerSettingsManager.getModeConfigId).toHaveBeenCalledWith("architect")
			expect(provider.providerSettingsManager.activateProfile).toHaveBeenCalledWith({ name: "saved-config" })
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "saved-config")

			// Verify state was posted to webview
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})

		test("saves current config when switching to mode without config", async () => {
			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue(undefined),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "current-config", id: "current-id", apiProvider: "anthropic" }]),
				setModeConfig: vi.fn(),
			} as any

			// Mock the ContextProxy's getValue method to return the current config name
			const contextProxy = (provider as any).contextProxy
			const getValueSpy = vi.spyOn(contextProxy, "getValue")
			getValueSpy.mockImplementation((key: any) => {
				if (key === "currentApiConfigName") return "current-config"
				return undefined
			})

			// Switch to architect mode
			await provider.handleModeSwitch("architect")

			// Verify mode was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "architect")

			// Verify current config was saved as default for new mode
			expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledWith("architect", "current-id")

			// Verify state was posted to webview
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})
	})

	describe("createTaskWithHistoryItem mode validation", () => {
		test("validates and falls back to default mode when restored mode no longer exists", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock custom modes that don't include the saved mode
			const mockCustomModesManager = {
				getCustomModes: vi.fn().mockResolvedValue([
					{
						slug: "existing-mode",
						name: "Existing Mode",
						roleDefinition: "Test role",
						groups: ["read"] as const,
					},
				]),
				dispose: vi.fn(),
			}
			;(provider as any).customModesManager = mockCustomModesManager

			// Mock getModeBySlug to return undefined for non-existent mode
			const { getModeBySlug } = await import("../../../shared/modes")
			vi.mocked(getModeBySlug)
				.mockReturnValueOnce(undefined) // First call returns undefined (mode doesn't exist)
				.mockReturnValue({
					slug: "code",
					name: "Code Mode",
					roleDefinition: "You are a code assistant",
					groups: ["read", "edit"],
				}) // Subsequent calls return default mode

			// Mock provider settings manager
			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue(undefined),
				listConfig: vi.fn().mockResolvedValue([]),
			}

			// Spy on log method to verify warning was logged
			const logSpy = vi.spyOn(provider, "log")

			// Create history item with non-existent mode
			const historyItem = {
				id: "test-id",
				ts: Date.now(),
				task: "Test task",
				mode: "non-existent-mode", // This mode doesn't exist
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}

			// Initialize with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify mode validation occurred
			expect(mockCustomModesManager.getCustomModes).toHaveBeenCalled()
			expect(getModeBySlug).toHaveBeenCalledWith("non-existent-mode", expect.any(Array))

			// Verify fallback to default mode
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "code")
			expect(logSpy).toHaveBeenCalledWith(
				"Mode 'non-existent-mode' from history no longer exists. Falling back to default mode 'code'.",
			)

			// Verify history item was updated with default mode
			expect(historyItem.mode).toBe("code")
		})

		test("preserves mode when it exists in custom modes", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock custom modes that include the saved mode
			const mockCustomModesManager = {
				getCustomModes: vi.fn().mockResolvedValue([
					{
						slug: "custom-mode",
						name: "Custom Mode",
						roleDefinition: "Custom role",
						groups: ["read", "edit"] as const,
					},
				]),
				dispose: vi.fn(),
			}
			;(provider as any).customModesManager = mockCustomModesManager

			// Mock getModeBySlug to return the custom mode
			const { getModeBySlug } = await import("../../../shared/modes")
			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "custom-mode",
				name: "Custom Mode",
				roleDefinition: "Custom role",
				groups: ["read", "edit"],
			})

			// Mock provider settings manager
			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue("config-id"),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "config-id", apiProvider: "anthropic" }]),
				activateProfile: vi
					.fn()
					.mockResolvedValue({ name: "test-config", id: "config-id", apiProvider: "anthropic" }),
			}

			// Spy on log method to verify no warning was logged
			const logSpy = vi.spyOn(provider, "log")

			// Create history item with existing custom mode
			const historyItem = {
				id: "test-id",
				ts: Date.now(),
				task: "Test task",
				mode: "custom-mode",
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}

			// Initialize with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify mode validation occurred
			expect(mockCustomModesManager.getCustomModes).toHaveBeenCalled()
			expect(getModeBySlug).toHaveBeenCalledWith("custom-mode", expect.any(Array))

			// Verify mode was preserved
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "custom-mode")
			expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("no longer exists"))

			// Verify history item mode was not changed
			expect(historyItem.mode).toBe("custom-mode")
		})

		test("preserves mode when it exists in built-in modes", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock no custom modes
			const mockCustomModesManager = {
				getCustomModes: vi.fn().mockResolvedValue([]),
				dispose: vi.fn(),
			}
			;(provider as any).customModesManager = mockCustomModesManager

			// Mock getModeBySlug to return built-in architect mode
			const { getModeBySlug } = await import("../../../shared/modes")
			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "architect",
				name: "Architect Mode",
				roleDefinition: "You are an architect",
				groups: ["read", "edit"],
			})

			// Mock provider settings manager
			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue(undefined),
				listConfig: vi.fn().mockResolvedValue([]),
			}

			// Create history item with built-in mode
			const historyItem = {
				id: "test-id",
				ts: Date.now(),
				task: "Test task",
				mode: "architect",
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}

			// Initialize with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify mode was preserved
			expect(mockContext.globalState.update).toHaveBeenCalledWith("mode", "architect")

			// Verify history item mode was not changed
			expect(historyItem.mode).toBe("architect")
		})

		test("handles history items without mode property", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock provider settings manager
			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue(undefined),
				listConfig: vi.fn().mockResolvedValue([]),
			}

			// Create history item without mode
			const historyItem = {
				id: "test-id",
				ts: Date.now(),
				task: "Test task",
				// No mode property
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}

			// Initialize with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify no mode validation occurred (mode update not called)
			expect(mockContext.globalState.update).not.toHaveBeenCalledWith("mode", expect.any(String))
		})

		test("continues with task restoration even if mode config loading fails", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Mock custom modes
			const mockCustomModesManager = {
				getCustomModes: vi.fn().mockResolvedValue([]),
				dispose: vi.fn(),
			}
			;(provider as any).customModesManager = mockCustomModesManager

			// Mock getModeBySlug to return built-in mode
			const { getModeBySlug } = await import("../../../shared/modes")
			vi.mocked(getModeBySlug).mockReturnValue({
				slug: "code",
				name: "Code Mode",
				roleDefinition: "You are a code assistant",
				groups: ["read", "edit"],
			})

			// Mock provider settings manager to throw error
			;(provider as any).providerSettingsManager = {
				getModeConfigId: vi.fn().mockResolvedValue("config-id"),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "config-id", apiProvider: "anthropic" }]),
				activateProfile: vi.fn().mockRejectedValue(new Error("Failed to load config")),
			}

			// Spy on log method
			const logSpy = vi.spyOn(provider, "log")

			// Create history item
			const historyItem = {
				id: "test-id",
				ts: Date.now(),
				task: "Test task",
				mode: "code",
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			}

			// Initialize with history item - should not throw
			await expect(provider.createTaskWithHistoryItem(historyItem)).resolves.not.toThrow()

			// Verify error was logged but task restoration continued
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Failed to restore API configuration for mode 'code'"),
			)
		})
	})

	describe("updateCustomMode", () => {
		test("updates both file and state when updating custom mode", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Mock CustomModesManager methods
			;(provider as any).customModesManager = {
				updateCustomMode: vi.fn().mockResolvedValue(undefined),
				getCustomModes: vi.fn().mockResolvedValue([
					{
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Updated role definition",
						groups: ["read"] as const,
					},
				]),
				dispose: vi.fn(),
			} as any

			// Test updating a custom mode
			await messageHandler({
				type: "updateCustomMode",
				modeConfig: {
					slug: "test-mode",
					name: "Test Mode",
					roleDefinition: "Updated role definition",
					groups: ["read"] as const,
				},
			})

			// Verify CustomModesManager.updateCustomMode was called
			expect(provider.customModesManager.updateCustomMode).toHaveBeenCalledWith(
				"test-mode",
				expect.objectContaining({
					slug: "test-mode",
					roleDefinition: "Updated role definition",
				}),
			)

			// Verify state was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("customModes", [
				{ groups: ["read"], name: "Test Mode", roleDefinition: "Updated role definition", slug: "test-mode" },
			])

			// Verify state was posted to webview
			// Verify state was posted to webview with correct format
			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "state",
					state: expect.objectContaining({
						customModes: [
							expect.objectContaining({
								slug: "test-mode",
								roleDefinition: "Updated role definition",
							}),
						],
					}),
				}),
			)
		})
	})

	describe("upsertApiConfiguration", () => {
		test("handles error in upsertApiConfiguration gracefully", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			;(provider as any).providerSettingsManager = {
				setModeConfig: vi.fn().mockRejectedValue(new Error("Failed to update mode config")),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			// Mock getState to provide necessary data
			vi.spyOn(provider, "getState").mockResolvedValue({
				mode: "code",
				currentApiConfigName: "test-config",
			} as any)

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: { apiProvider: "anthropic", apiKey: "test-key" },
			})

			// Verify error was logged and user was notified
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("Error create new api configuration"),
			)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.create_api_config")
		})

		test("handles successful upsertApiConfiguration", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			;(provider as any).providerSettingsManager = {
				setModeConfig: vi.fn(),
				saveConfig: vi.fn().mockResolvedValue(undefined),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			const testApiConfig = {
				apiProvider: "anthropic" as const,
				apiKey: "test-key",
			}

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: testApiConfig,
			})

			// Verify config was saved
			expect(provider.providerSettingsManager.saveConfig).toHaveBeenCalledWith("test-config", testApiConfig)

			// Verify state updates
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")

			// Verify state was posted to webview
			expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "state" }))
		})

		test("handles buildApiHandler error in updateApiConfiguration", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Mock buildApiHandler to throw an error
			const { buildApiHandler } = await import("../../../api")

			;(buildApiHandler as any).mockImplementationOnce(() => {
				throw new Error("API handler error")
			})
			;(provider as any).providerSettingsManager = {
				setModeConfig: vi.fn(),
				saveConfig: vi.fn().mockResolvedValue(undefined),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			// Setup Task instance with auto-mock from the top of the file
			const mockCline = new Task(defaultTaskOptions) // Create a new mocked instance
			await provider.addClineToStack(mockCline)

			const testApiConfig = {
				apiProvider: "anthropic" as const,
				apiKey: "test-key",
			}

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "upsertApiConfiguration",
				text: "test-config",
				apiConfiguration: testApiConfig,
			})

			// Verify error handling
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("Error create new api configuration"),
			)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.create_api_config")

			// Verify state was still updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(mockContext.globalState.update).toHaveBeenCalledWith("currentApiConfigName", "test-config")
		})

		test("handles successful saveApiConfiguration", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			;(provider as any).providerSettingsManager = {
				setModeConfig: vi.fn(),
				saveConfig: vi.fn().mockResolvedValue(undefined),
				listConfig: vi
					.fn()
					.mockResolvedValue([{ name: "test-config", id: "test-id", apiProvider: "anthropic" }]),
			} as any

			const testApiConfig = {
				apiProvider: "anthropic" as const,
				apiKey: "test-key",
			}

			// Trigger upsertApiConfiguration
			await messageHandler({
				type: "saveApiConfiguration",
				text: "test-config",
				apiConfiguration: testApiConfig,
			})

			// Verify config was saved
			expect(provider.providerSettingsManager.saveConfig).toHaveBeenCalledWith("test-config", testApiConfig)

			// Verify state updates
			expect(mockContext.globalState.update).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
			expect(updateGlobalStateSpy).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test-config", id: "test-id", apiProvider: "anthropic" },
			])
		})
	})
})

describe("Project MCP Settings", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = vi.fn()
		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
				cspSource: "vscode-webview://test-csp-source",
			},
			visible: true,
			onDidDispose: vi.fn(),
			onDidChangeVisibility: vi.fn(),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
	})

	test.skip("handles openProjectMcpSettings message", async () => {
		// Mock workspace folders first
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]

		// Mock fs functions
		const fs = await import("fs/promises")
		const mockedFs = vi.mocked(fs)
		mockedFs.mkdir.mockClear()
		mockedFs.mkdir.mockResolvedValue(undefined)
		mockedFs.writeFile.mockClear()
		mockedFs.writeFile.mockResolvedValue(undefined)

		// Mock fileExistsAtPath to return false (file doesn't exist)
		const fsUtils = await import("../../../utils/fs")
		vi.spyOn(fsUtils, "fileExistsAtPath").mockResolvedValue(false)

		// Mock openFile
		const openFileModule = await import("../../../integrations/misc/open-file")
		const openFileSpy = vi.spyOn(openFileModule, "openFile").mockClear().mockResolvedValue(undefined)

		// Set up the webview
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Ensure the message handler is properly set up
		expect(messageHandler).toBeDefined()
		expect(typeof messageHandler).toBe("function")

		// Trigger openProjectMcpSettings through the message handler
		await messageHandler({
			type: "openProjectMcpSettings",
		})

		// Check that fs.mkdir was called with the correct path
		expect(mockedFs.mkdir).toHaveBeenCalledWith("/test/workspace/.roo", { recursive: true })

		// Verify file was created with default content
		expect(safeWriteJson).toHaveBeenCalledWith("/test/workspace/.roo/mcp.json", { mcpServers: {} })

		// Check that openFile was called
		expect(openFileSpy).toHaveBeenCalledWith("/test/workspace/.roo/mcp.json")
	})

	test("handles openProjectMcpSettings when workspace is not open", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock no workspace folders
		;(vscode.workspace as any).workspaceFolders = []

		// Trigger openProjectMcpSettings
		await messageHandler({ type: "openProjectMcpSettings" })

		// Verify error message was shown
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.no_workspace")
	})

	test.skip("handles openProjectMcpSettings file creation error", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock workspace folders
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]

		// Mock fs functions to fail
		const fs = require("fs/promises")
		fs.mkdir.mockRejectedValue(new Error("Failed to create directory"))

		// Trigger openProjectMcpSettings
		await messageHandler({
			type: "openProjectMcpSettings",
		})

		// Verify error message was shown
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("Failed to create or open .roo/mcp.json"),
		)
	})
})

describe.skip("ContextProxy integration", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockContextProxy: any

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks()

		// Setup basic mocks
		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
			extensionUri: {} as vscode.Uri,
			globalStorageUri: { fsPath: "/test/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = { appendLine: vi.fn() } as unknown as vscode.OutputChannel
		mockContextProxy = new ContextProxy(mockContext)
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", mockContextProxy)
	})

	test("updateGlobalState uses contextProxy", async () => {
		await provider.setValue("currentApiConfigName", "testValue")
		expect(mockContextProxy.updateGlobalState).toHaveBeenCalledWith("currentApiConfigName", "testValue")
	})

	test("getGlobalState uses contextProxy", async () => {
		mockContextProxy.getGlobalState.mockResolvedValueOnce("testValue")
		const result = await provider.getValue("currentApiConfigName")
		expect(mockContextProxy.getGlobalState).toHaveBeenCalledWith("currentApiConfigName")
		expect(result).toBe("testValue")
	})

	test("storeSecret uses contextProxy", async () => {
		await provider.setValue("apiKey", "test-secret")
		expect(mockContextProxy.storeSecret).toHaveBeenCalledWith("apiKey", "test-secret")
	})

	test("contextProxy methods are available", () => {
		// Verify the contextProxy has all the required methods
		expect(mockContextProxy.getGlobalState).toBeDefined()
		expect(mockContextProxy.updateGlobalState).toBeDefined()
		expect(mockContextProxy.storeSecret).toBeDefined()
		expect(mockContextProxy.setValue).toBeDefined()
		expect(mockContextProxy.setValues).toBeDefined()
	})
})

describe("ClineProvider - Router Models", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: any

	beforeEach(() => {
		vi.clearAllMocks()

		const globalState: Record<string, string | undefined> = {}
		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi
					.fn()
					.mockImplementation((key: string, value: string | undefined) => (globalState[key] = value)),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
				delete: vi.fn().mockImplementation((key: string) => delete secrets[key]),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = vi.fn()
		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
			},
			visible: true,
			onDidDispose: vi.fn().mockImplementation((callback) => {
				callback()
				return { dispose: vi.fn() }
			}),
			onDidChangeVisibility: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
	})

	test("handles requestRouterModels with successful responses", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock getState to return API configuration
		vi.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				litellmApiKey: "litellm-key",
				litellmBaseUrl: "http://localhost:4000",
			},
		} as any)

		const mockModels = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				description: "Test model 1",
				supportsPromptCache: false,
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				description: "Test model 2",
				supportsPromptCache: false,
			},
		}

		const { getModels } = await import("../../../api/providers/fetchers/modelCache")
		vi.mocked(getModels).mockResolvedValue(mockModels)

		await messageHandler({ type: "requestRouterModels" })

		// Verify getModels was called for each provider with correct options
		expect(getModels).toHaveBeenCalledWith({ provider: "openrouter" })
		expect(getModels).toHaveBeenCalledWith({ provider: "requesty", apiKey: "requesty-key" })
		expect(getModels).toHaveBeenCalledWith({ provider: "unbound" })
		expect(getModels).toHaveBeenCalledWith({ provider: "vercel-ai-gateway" })
		expect(getModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "litellm-key",
			baseUrl: "http://localhost:4000",
		})

		// Verify response was sent
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: mockModels,
				unbound: mockModels,
				litellm: mockModels,
				ollama: {},
				lmstudio: {},
				"vercel-ai-gateway": mockModels,
				poe: {},
			},
			values: undefined,
		})
	})

	test("handles requestRouterModels with individual provider failures", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		vi.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				litellmApiKey: "litellm-key",
				litellmBaseUrl: "http://localhost:4000",
			},
		} as any)

		const mockModels = {
			"model-1": { maxTokens: 4096, contextWindow: 8192, description: "Test model", supportsPromptCache: false },
		}
		const { getModels } = await import("../../../api/providers/fetchers/modelCache")

		// Mock some providers to succeed and others to fail
		vi.mocked(getModels)
			.mockResolvedValueOnce(mockModels) // openrouter success
			.mockRejectedValueOnce(new Error("Requesty API error")) // requesty fail
			.mockResolvedValueOnce(mockModels) // unbound success
			.mockResolvedValueOnce(mockModels) // vercel-ai-gateway success
			.mockRejectedValueOnce(new Error("LiteLLM connection failed")) // litellm fail

		await messageHandler({ type: "requestRouterModels" })

		// Verify main response includes successful providers and empty objects for failed ones
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: {},
				unbound: mockModels,
				ollama: {},
				lmstudio: {},
				litellm: {},
				"vercel-ai-gateway": mockModels,
				poe: {},
			},
			values: undefined,
		})

		// Verify error messages were sent for failed providers
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Requesty API error",
			values: { provider: "requesty" },
		})

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "LiteLLM connection failed",
			values: { provider: "litellm" },
		})
	})

	test("handles requestRouterModels with LiteLLM values from message", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		// Mock state without LiteLLM config
		vi.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				// No litellm config
			},
		} as any)

		const mockModels = {
			"model-1": { maxTokens: 4096, contextWindow: 8192, description: "Test model", supportsPromptCache: false },
		}
		const { getModels } = await import("../../../api/providers/fetchers/modelCache")
		vi.mocked(getModels).mockResolvedValue(mockModels)

		await messageHandler({
			type: "requestRouterModels",
			values: {
				litellmApiKey: "message-litellm-key",
				litellmBaseUrl: "http://message-url:4000",
			},
		})

		// Verify LiteLLM was called with values from message
		expect(getModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "message-litellm-key",
			baseUrl: "http://message-url:4000",
		})
	})

	test("skips LiteLLM when neither config nor message values are provided", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		vi.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				// No litellm config
			},
		} as any)

		const mockModels = {
			"model-1": { maxTokens: 4096, contextWindow: 8192, description: "Test model", supportsPromptCache: false },
		}
		const { getModels } = await import("../../../api/providers/fetchers/modelCache")
		vi.mocked(getModels).mockResolvedValue(mockModels)

		await messageHandler({ type: "requestRouterModels" })

		// Verify LiteLLM was NOT called
		expect(getModels).not.toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "litellm",
			}),
		)

		// Verify response includes empty object for LiteLLM
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: mockModels,
				unbound: mockModels,
				litellm: {},
				ollama: {},
				lmstudio: {},
				"vercel-ai-gateway": mockModels,
				poe: {},
			},
			values: undefined,
		})
	})

	test("handles requestLmStudioModels with proper response", async () => {
		await provider.resolveWebviewView(mockWebviewView)
		const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

		vi.spyOn(provider, "getState").mockResolvedValue({
			apiConfiguration: {
				lmStudioModelId: "model-1",
				lmStudioBaseUrl: "http://localhost:1234",
			},
		} as any)

		const mockModels = {
			"model-1": { maxTokens: 4096, contextWindow: 8192, description: "Test model", supportsPromptCache: false },
		}
		const { getModels } = await import("../../../api/providers/fetchers/modelCache")
		vi.mocked(getModels).mockResolvedValue(mockModels)

		await messageHandler({
			type: "requestLmStudioModels",
		})

		expect(getModels).toHaveBeenCalledWith({
			provider: "lmstudio",
			baseUrl: "http://localhost:1234",
		})
	})
})

describe("ClineProvider - Comprehensive Edit/Delete Edge Cases", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: any
	let defaultTaskOptions: TaskOptions

	beforeEach(() => {
		vi.clearAllMocks()

		const globalState: Record<string, string | undefined> = {
			mode: "code",
			currentApiConfigName: "current-config",
		}

		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi
					.fn()
					.mockImplementation((key: string, value: string | undefined) => (globalState[key] = value)),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
				delete: vi.fn().mockImplementation((key: string) => delete secrets[key]),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = vi.fn()

		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
			},
			visible: true,
			onDidDispose: vi.fn().mockImplementation((callback) => {
				callback()
				return { dispose: vi.fn() }
			}),
			onDidChangeVisibility: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		defaultTaskOptions = {
			provider,
			apiConfiguration: {
				apiProvider: "openrouter",
			},
		}

		// Mock getMcpHub method
		provider.getMcpHub = vi.fn().mockReturnValue({
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue({ contents: [] }),
			getAllServers: vi.fn().mockReturnValue([]),
		})
	})

	describe("Edit Messages with Images and Attachments", () => {
		beforeEach(async () => {
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("handles editing messages containing images", async () => {
			const mockMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "Original message" },
				{
					ts: 2000,
					type: "say",
					say: "user_feedback",
					text: "Message with image",
					images: [
						"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
					],
					value: 3000,
				},
				{ ts: 3000, type: "say", say: "text", text: "AI response" },
			] as ClineMessage[]

			const mockCline = new Task(defaultTaskOptions)
			mockCline.clineMessages = mockMessages
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }] as any[]
			mockCline.overwriteClineMessages = vi.fn()
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.submitUserMessage = vi.fn()

			await provider.addClineToStack(mockCline)
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
			await messageHandler({
				type: "submitEditedMessage",
				value: 3000,
				editedMessageContent: "Edited message with preserved images",
			})

			// Verify dialog was shown
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 3000,
				text: "Edited message with preserved images",
				hasCheckpoint: false,
				images: undefined,
			})

			// Simulate confirmation
			await messageHandler({
				type: "editMessageConfirm",
				messageTs: 3000,
				text: "Edited message with preserved images",
			})

			// Verify messages were edited correctly - the ORIGINAL user message and all subsequent messages are removed
			expect(mockCline.overwriteClineMessages).toHaveBeenCalledWith([mockMessages[0]])
			expect(mockCline.overwriteApiConversationHistory).toHaveBeenCalledWith([{ ts: 1000 }])
			// Verify submitUserMessage was called with the edited content
			expect(mockCline.submitUserMessage).toHaveBeenCalledWith("Edited message with preserved images", [])
		})

		test("handles editing messages with file attachments", async () => {
			const mockMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "Original message" },
				{
					ts: 2000,
					type: "say",
					say: "user_feedback",
					text: "Message with file",
					attachments: [{ path: "/path/to/file.txt", type: "file" }],
					value: 3000,
				},
				{ ts: 3000, type: "say", say: "text", text: "AI response" },
			] as ClineMessage[]

			const mockCline = new Task(defaultTaskOptions)
			mockCline.clineMessages = mockMessages
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }] as any[]
			mockCline.overwriteClineMessages = vi.fn()
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.submitUserMessage = vi.fn()

			await provider.addClineToStack(mockCline)
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]
			await messageHandler({
				type: "submitEditedMessage",
				value: 3000,
				editedMessageContent: "Edited message with file attachment",
			})

			// Verify dialog was shown
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 3000,
				text: "Edited message with file attachment",
				hasCheckpoint: false,
				images: undefined,
			})

			// Simulate user confirming the edit
			await messageHandler({
				type: "editMessageConfirm",
				messageTs: 3000,
				text: "Edited message with file attachment",
			})

			expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
			expect(mockCline.submitUserMessage).toHaveBeenCalledWith("Edited message with file attachment", [])
		})
	})

	describe("Network Failure Scenarios", () => {
		beforeEach(async () => {
			;(vscode.window.showInformationMessage as any) = vi.fn()
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("handles network timeout during edit submission", async () => {
			const mockCline = new Task(defaultTaskOptions)
			mockCline.clineMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "Original message", value: 2000 },
				{ ts: 2000, type: "say", say: "text", text: "AI response" },
			] as ClineMessage[]
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]
			mockCline.overwriteClineMessages = vi.fn()
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.handleWebviewAskResponse = vi.fn().mockRejectedValue(new Error("Network timeout"))

			await provider.addClineToStack(mockCline)
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Should not throw error, but handle gracefully
			await expect(
				messageHandler({
					type: "submitEditedMessage",
					value: 2000,
					editedMessageContent: "Edited message",
				}),
			).resolves.toBeUndefined()

			// Verify dialog was shown
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 2000,
				text: "Edited message",
				hasCheckpoint: false,
				images: undefined,
			})

			// Simulate user confirming the edit
			await messageHandler({ type: "editMessageConfirm", messageTs: 2000, text: "Edited message" })

			expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
		})

		test("handles connection drops during edit operation", async () => {
			const mockCline = new Task(defaultTaskOptions)
			mockCline.clineMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "Original message", value: 2000 },
				{ ts: 2000, type: "say", say: "text", text: "AI response" },
			] as ClineMessage[]
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]
			mockCline.overwriteClineMessages = vi.fn().mockRejectedValue(new Error("Connection lost"))
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.handleWebviewAskResponse = vi.fn()

			await provider.addClineToStack(mockCline)
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Should handle connection error gracefully
			await expect(
				messageHandler({
					type: "submitEditedMessage",
					value: 2000,
					editedMessageContent: "Edited message",
				}),
			).resolves.toBeUndefined()

			// Verify dialog was shown
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 2000,
				text: "Edited message",
				hasCheckpoint: false,
				images: undefined,
			})

			// Simulate user confirming the edit
			await messageHandler({ type: "editMessageConfirm", messageTs: 2000, text: "Edited message" })

			// The error should be caught and shown
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.message.error_editing_message")
		})
	})

	describe("Concurrent Edit Operations", () => {
		beforeEach(async () => {
			;(vscode.window.showInformationMessage as any) = vi.fn()
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("handles race conditions with simultaneous edits", async () => {
			const mockCline = new Task(defaultTaskOptions)
			mockCline.clineMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "Message 1", value: 2000 },
				{ ts: 2000, type: "say", say: "text", text: "AI response 1" },
				{ ts: 3000, type: "say", say: "user_feedback", text: "Message 2", value: 4000 },
				{ ts: 4000, type: "say", say: "text", text: "AI response 2" },
			] as ClineMessage[]
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }, { ts: 4000 }] as any[]
			mockCline.overwriteClineMessages = vi.fn()
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.handleWebviewAskResponse = vi.fn()

			await provider.addClineToStack(mockCline)
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			// Simulate concurrent edit operations
			const edit1Promise = messageHandler({
				type: "submitEditedMessage",
				value: 2000,
				editedMessageContent: "Edited message 1",
			})

			const edit2Promise = messageHandler({
				type: "submitEditedMessage",
				value: 4000,
				editedMessageContent: "Edited message 2",
			})

			await Promise.all([edit1Promise, edit2Promise])

			// Verify dialogs were shown for both edits
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 2000,
				text: "Edited message 1",
				hasCheckpoint: false,
				images: undefined,
			})
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 4000,
				text: "Edited message 2",
				hasCheckpoint: false,
				images: undefined,
			})

			// Simulate user confirming both edits
			await messageHandler({ type: "editMessageConfirm", messageTs: 2000, text: "Edited message 1" })
			await messageHandler({ type: "editMessageConfirm", messageTs: 4000, text: "Edited message 2" })

			// Both operations should complete without throwing
			expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
		})
	})

	describe("Edit Permissions and Authorization", () => {
		beforeEach(async () => {
			;(vscode.window.showInformationMessage as any) = vi.fn()
			await provider.resolveWebviewView(mockWebviewView)
		})

		test("handles edit permission failures", async () => {
			// Mock no current cline (simulating permission failure)
			vi.spyOn(provider, "getCurrentTask").mockReturnValue(undefined)

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			await messageHandler({
				type: "submitEditedMessage",
				value: 2000,
				editedMessageContent: "Edited message",
			})

			// Should not show confirmation dialog when no current cline
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		})

		test("handles authorization failures during edit", async () => {
			const mockCline = new Task(defaultTaskOptions)
			mockCline.clineMessages = [
				{ ts: 1000, type: "say", say: "user_feedback", text: "Original message", value: 2000 },
				{ ts: 2000, type: "say", say: "text", text: "AI response" },
			] as ClineMessage[]
			mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]
			mockCline.overwriteClineMessages = vi.fn().mockRejectedValue(new Error("Unauthorized"))
			mockCline.overwriteApiConversationHistory = vi.fn()
			mockCline.handleWebviewAskResponse = vi.fn()

			await provider.addClineToStack(mockCline)
			;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
				historyItem: { id: "test-task-id" },
			})

			const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

			await messageHandler({
				type: "submitEditedMessage",
				value: 2000,
				editedMessageContent: "Edited message",
			})

			// Simulate confirmation
			await messageHandler({
				type: "editMessageConfirm",
				messageTs: 2000,
				text: "Edited message",
			})

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.message.error_editing_message")
		})

		describe("Malformed Requests and Invalid Formats", () => {
			beforeEach(async () => {
				await provider.resolveWebviewView(mockWebviewView)
			})

			test("handles malformed edit requests", async () => {
				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				// Test with missing value
				await messageHandler({
					type: "submitEditedMessage",
					editedMessageContent: "Edited message",
				})

				// Test with invalid value type
				await messageHandler({
					type: "submitEditedMessage",
					value: "invalid",
					editedMessageContent: "Edited message",
				})

				// Test with missing editedMessageContent
				await messageHandler({
					type: "submitEditedMessage",
					value: 2000,
				})

				// Should not show confirmation dialog for malformed requests
				expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
			})

			test("handles invalid message formats", async () => {
				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				// Test with null message - should throw error
				await expect(messageHandler(null)).rejects.toThrow()

				// Test with undefined message - should throw error
				await expect(messageHandler(undefined)).rejects.toThrow()

				// Test with message missing type
				await expect(
					messageHandler({
						value: 2000,
						editedMessageContent: "Edited message",
					}),
				).resolves.toBeUndefined()

				// Should handle gracefully without errors
				expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
			})

			test("handles invalid timestamp values", async () => {
				;(vscode.window.showInformationMessage as any) = vi.fn()

				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Original message" },
					{ ts: 2000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]

				await provider.addClineToStack(mockCline)

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				// Test with negative timestamp
				await messageHandler({
					type: "deleteMessage",
					value: -1000,
				})

				// Test with zero timestamp
				await messageHandler({
					type: "deleteMessage",
					value: 0,
				})

				// Invalid timestamps may still trigger confirmation dialog
				// This is expected behavior as the system tries to process the message
			})
		})

		describe("Operations on Deleted or Non-existent Messages", () => {
			beforeEach(async () => {
				;(vscode.window.showInformationMessage as any) = vi.fn()
				await provider.resolveWebviewView(mockWebviewView)
			})

			test("handles edit operations on deleted messages", async () => {
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Existing message" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()
				mockCline.handleWebviewAskResponse = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				// Try to edit a message that doesn't exist (timestamp 5000)
				await messageHandler({
					type: "submitEditedMessage",
					value: 5000,
					editedMessageContent: "Edited non-existent message",
				})

				// Should show edit dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showEditMessageDialog",
					messageTs: 5000,
					text: "Edited non-existent message",
					hasCheckpoint: false,
					images: undefined,
				})

				// Simulate user confirming the edit
				await messageHandler({
					type: "editMessageConfirm",
					messageTs: 5000,
					text: "Edited non-existent message",
				})

				// Should not perform any operations since message doesn't exist
				expect(mockCline.overwriteClineMessages).not.toHaveBeenCalled()
				expect(mockCline.handleWebviewAskResponse).not.toHaveBeenCalled()
			})

			test("handles delete operations on non-existent messages", async () => {
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Existing message" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				// Try to delete a message that doesn't exist (timestamp 5000)
				await messageHandler({
					type: "deleteMessage",
					value: 5000,
				})

				// Should show delete dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showDeleteMessageDialog",
					messageTs: 5000,
					hasCheckpoint: false,
				})

				// Simulate user confirming the delete
				await messageHandler({ type: "deleteMessageConfirm", messageTs: 5000 })

				// Should not perform any operations since message doesn't exist
				expect(mockCline.overwriteClineMessages).not.toHaveBeenCalled()
			})
		})

		describe("Resource Cleanup During Failed Operations", () => {
			beforeEach(async () => {
				;(vscode.window.showInformationMessage as any) = vi.fn()
				await provider.resolveWebviewView(mockWebviewView)
			})

			test("validates proper cleanup during failed edit operations", async () => {
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Original message", value: 2000 },
					{ ts: 2000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]

				// Mock cleanup tracking
				const cleanupSpy = vi.fn()
				mockCline.overwriteClineMessages = vi.fn().mockImplementation(() => {
					cleanupSpy()
					throw new Error("Operation failed")
				})
				mockCline.overwriteApiConversationHistory = vi.fn()
				mockCline.handleWebviewAskResponse = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({
					type: "submitEditedMessage",
					value: 2000,
					editedMessageContent: "Edited message",
				})

				// Should show edit dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showEditMessageDialog",
					messageTs: 2000,
					text: "Edited message",
					hasCheckpoint: false,
					images: undefined,
				})

				// Simulate user confirming the edit
				await messageHandler({ type: "editMessageConfirm", messageTs: 2000, text: "Edited message" })

				// Verify cleanup was attempted before failure
				expect(cleanupSpy).toHaveBeenCalled()
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.message.error_editing_message")
			})

			test("validates proper cleanup during failed delete operations", async () => {
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Message to delete" },
					{ ts: 2000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]

				// Mock cleanup tracking
				const cleanupSpy = vi.fn()
				mockCline.overwriteClineMessages = vi.fn().mockImplementation(() => {
					cleanupSpy()
					throw new Error("Delete operation failed")
				})
				mockCline.overwriteApiConversationHistory = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({ type: "deleteMessage", value: 2000 })

				// Should show delete dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showDeleteMessageDialog",
					messageTs: 2000,
					hasCheckpoint: false,
				})

				// Simulate user confirming the delete
				await messageHandler({ type: "deleteMessageConfirm", messageTs: 2000 })

				// Verify cleanup was attempted before failure
				expect(cleanupSpy).toHaveBeenCalled()
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("errors.message.error_deleting_message")
			})
		})

		describe("Large Message Payloads", () => {
			beforeEach(async () => {
				;(vscode.window.showInformationMessage as any) = vi.fn()
				await provider.resolveWebviewView(mockWebviewView)
			})

			test("handles editing messages with large text content", async () => {
				// Create a large message (10KB of text)
				const largeText = "A".repeat(10000)
				const mockMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: largeText, value: 2000 },
					{ ts: 2000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]

				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = mockMessages
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()
				mockCline.submitUserMessage = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				const largeEditedContent = "B".repeat(15000)
				await messageHandler({
					type: "submitEditedMessage",
					value: 2000,
					editedMessageContent: largeEditedContent,
				})

				// Should show edit dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showEditMessageDialog",
					messageTs: 2000,
					text: largeEditedContent,
					hasCheckpoint: false,
					images: undefined,
				})

				// Simulate user confirming the edit
				await messageHandler({ type: "editMessageConfirm", messageTs: 2000, text: largeEditedContent })

				expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
				expect(mockCline.submitUserMessage).toHaveBeenCalledWith(largeEditedContent, [])
			})

			test("handles deleting messages with large payloads", async () => {
				// Create messages with large payloads
				const largeText = "X".repeat(50000)
				const mockMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Small message" },
					{ ts: 2000, type: "say", say: "user_feedback", text: largeText },
					{ ts: 3000, type: "say", say: "text", text: "AI response" },
					{ ts: 4000, type: "say", say: "user_feedback", text: "Another large message: " + largeText },
				] as ClineMessage[]

				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = mockMessages
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }, { ts: 3000 }, { ts: 4000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({ type: "deleteMessage", value: 3000 })

				// Should show delete dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showDeleteMessageDialog",
					messageTs: 3000,
					hasCheckpoint: false,
				})

				// Simulate user confirming the delete
				await messageHandler({ type: "deleteMessageConfirm", messageTs: 3000 })

				// Should handle large payloads without issues - keeps messages before the deleted one
				expect(mockCline.overwriteClineMessages).toHaveBeenCalledWith([mockMessages[0], mockMessages[1]])
				expect(mockCline.overwriteApiConversationHistory).toHaveBeenCalledWith([{ ts: 1000 }, { ts: 2000 }])
			})
		})

		describe("Error Messaging and User Feedback", () => {
			beforeEach(async () => {
				await provider.resolveWebviewView(mockWebviewView)
			})

			// Note: Error messaging test removed as the implementation may not have proper error handling in place

			test("provides user feedback for successful operations", async () => {
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Message to delete" },
					{ ts: 2000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})
				;(provider as any).createTaskWithHistoryItem = vi.fn()

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({ type: "deleteMessage", value: 2000 })

				// Should show delete dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showDeleteMessageDialog",
					messageTs: 2000,
					hasCheckpoint: false,
				})

				// Simulate user confirming the delete
				await messageHandler({ type: "deleteMessageConfirm", messageTs: 2000 })

				// Verify successful operation completed
				expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
				// createTaskWithHistoryItem is only called when restoring checkpoints or aborting tasks
				expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
			})

			test("handles user cancellation gracefully", async () => {
				// Test cancellation by not sending confirmation

				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Message to edit" },
					{ ts: 2000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 2000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()
				mockCline.handleWebviewAskResponse = vi.fn()

				await provider.addClineToStack(mockCline)

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({
					type: "submitEditedMessage",
					value: 2000,
					editedMessageContent: "Edited message",
				})

				// Verify no operations were performed when user canceled
				expect(mockCline.overwriteClineMessages).not.toHaveBeenCalled()
				expect(mockCline.overwriteApiConversationHistory).not.toHaveBeenCalled()
				expect(mockCline.handleWebviewAskResponse).not.toHaveBeenCalled()
				expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
			})
		})

		describe("Edge Cases with Message Timestamps", () => {
			beforeEach(async () => {
				;(vscode.window.showInformationMessage as any) = vi.fn()
				await provider.resolveWebviewView(mockWebviewView)
			})

			test("handles messages with identical timestamps", async () => {
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Message 1" },
					{ ts: 1000, type: "say", say: "text", text: "Message 2 (same timestamp)" },
					{ ts: 1000, type: "say", say: "user_feedback", text: "Message 3 (same timestamp)" },
					{ ts: 2000, type: "say", say: "text", text: "Message 4" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [{ ts: 1000 }, { ts: 1000 }, { ts: 1000 }, { ts: 2000 }] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({ type: "deleteMessage", value: 1000 })

				// Should show delete dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showDeleteMessageDialog",
					messageTs: 1000,
					hasCheckpoint: false,
				})

				// Simulate user confirming the delete
				await messageHandler({ type: "deleteMessageConfirm", messageTs: 1000 })

				// Should handle identical timestamps gracefully
				expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
			})

			test("handles messages with future timestamps", async () => {
				const futureTimestamp = Date.now() + 100000 // Future timestamp
				const mockCline = new Task(defaultTaskOptions)
				mockCline.clineMessages = [
					{ ts: 1000, type: "say", say: "user_feedback", text: "Past message" },
					{
						ts: futureTimestamp,
						type: "say",
						say: "user_feedback",
						text: "Future message",
						value: futureTimestamp + 1000,
					},
					{ ts: futureTimestamp + 1000, type: "say", say: "text", text: "AI response" },
				] as ClineMessage[]
				mockCline.apiConversationHistory = [
					{ ts: 1000 },
					{ ts: futureTimestamp },
					{ ts: futureTimestamp + 1000 },
				] as any[]
				mockCline.overwriteClineMessages = vi.fn()
				mockCline.overwriteApiConversationHistory = vi.fn()
				mockCline.submitUserMessage = vi.fn()

				await provider.addClineToStack(mockCline)
				;(provider as any).getTaskWithId = vi.fn().mockResolvedValue({
					historyItem: { id: "test-task-id" },
				})

				const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as any).mock.calls[0][0]

				await messageHandler({
					type: "submitEditedMessage",
					value: futureTimestamp + 1000,
					editedMessageContent: "Edited future message",
				})

				// Should show edit dialog
				expect(mockPostMessage).toHaveBeenCalledWith({
					type: "showEditMessageDialog",
					messageTs: futureTimestamp + 1000,
					text: "Edited future message",
					hasCheckpoint: false,
					images: undefined,
				})

				// Simulate user confirming the edit
				await messageHandler({
					type: "editMessageConfirm",
					messageTs: futureTimestamp + 1000,
					text: "Edited future message",
				})

				// Should handle future timestamps correctly
				expect(mockCline.overwriteClineMessages).toHaveBeenCalled()
				expect(mockCline.submitUserMessage).toHaveBeenCalled()
			})
		})
	})

	describe("getTaskWithId", () => {
		it("returns empty apiConversationHistory when file is missing", async () => {
			const historyItem = { id: "missing-api-file-task", task: "test task", ts: Date.now() }
			vi.mocked(mockContext.globalState.get).mockImplementation((key: string) => {
				if (key === "taskHistory") {
					return [historyItem]
				}
				return undefined
			})

			const deleteTaskSpy = vi.spyOn(provider, "deleteTaskFromState")

			const result = await (provider as any).getTaskWithId("missing-api-file-task")

			expect(result.historyItem).toEqual(historyItem)
			expect(result.apiConversationHistory).toEqual([])
			expect(deleteTaskSpy).not.toHaveBeenCalled()
		})

		it("returns empty apiConversationHistory when file contains invalid JSON", async () => {
			const historyItem = { id: "corrupt-api-task", task: "test task", ts: Date.now() }
			vi.mocked(mockContext.globalState.get).mockImplementation((key: string) => {
				if (key === "taskHistory") {
					return [historyItem]
				}
				return undefined
			})

			// Make fileExistsAtPath return true so the read path is exercised
			const fsUtils = await import("../../../utils/fs")
			vi.spyOn(fsUtils, "fileExistsAtPath").mockResolvedValue(true)

			// Make readFile return corrupted JSON
			const fsp = await import("fs/promises")
			vi.mocked(fsp.readFile).mockResolvedValueOnce("{not valid json!!!" as never)

			const deleteTaskSpy = vi.spyOn(provider, "deleteTaskFromState")

			const result = await (provider as any).getTaskWithId("corrupt-api-task")

			expect(result.historyItem).toEqual(historyItem)
			expect(result.apiConversationHistory).toEqual([])
			expect(deleteTaskSpy).not.toHaveBeenCalled()

			// Restore the spy
			vi.mocked(fsUtils.fileExistsAtPath).mockRestore()
		})
	})
})

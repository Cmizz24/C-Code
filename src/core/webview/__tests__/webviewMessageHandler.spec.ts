// npx vitest core/webview/__tests__/webviewMessageHandler.spec.ts

import type { Mock } from "vitest"

// Mock dependencies - must come before imports
vi.mock("../../../api/providers/fetchers/modelCache")

vi.mock("../../../integrations/openai-codex/oauth", () => ({
	openAiCodexOAuthManager: {
		getAccessToken: vi.fn(),
		getAccountId: vi.fn(),
	},
}))

vi.mock("../../../integrations/openai-codex/rate-limits", () => ({
	fetchOpenAiCodexRateLimitInfo: vi.fn(),
}))

vi.mock("../../../services/command/commands", () => ({
	getCommands: vi.fn(),
}))

vi.mock("@anthropic-ai/vertex-sdk", () => ({
	AnthropicVertex: vi.fn(),
}))

vi.mock("google-auth-library", () => ({
	GoogleAuth: vi.fn(),
}))

vi.mock("ollama", () => ({
	Ollama: vi.fn(),
}))

// Mock the diagnosticsHandler module
vi.mock("../diagnosticsHandler", () => ({
	generateErrorDiagnostics: vi.fn().mockResolvedValue({ success: true, filePath: "/tmp/diagnostics.json" }),
}))

import type { ModelRecord } from "@roo-code/types"
import { RooCodeEventName } from "@roo-code/types"
import EventEmitter from "events"

import { webviewMessageHandler } from "../webviewMessageHandler"
import { ClineProvider } from "../ClineProvider"
import { getModels } from "../../../api/providers/fetchers/modelCache"
import { getCommands } from "../../../services/command/commands"
import { visualBrowserInspectorService } from "../../../services/visual-browser-inspector/VisualBrowserInspectorService"
import { getCommand } from "../../../utils/commands"
const { openAiCodexOAuthManager } = await import("../../../integrations/openai-codex/oauth")
const { fetchOpenAiCodexRateLimitInfo } = await import("../../../integrations/openai-codex/rate-limits")

const mockGetModels = getModels as Mock<typeof getModels>
const mockGetCommands = vi.mocked(getCommands)
const mockGetAccessToken = vi.mocked(openAiCodexOAuthManager.getAccessToken)
const mockGetAccountId = vi.mocked(openAiCodexOAuthManager.getAccountId)
const mockFetchOpenAiCodexRateLimitInfo = vi.mocked(fetchOpenAiCodexRateLimitInfo)

// Mock ClineProvider
const mockClineProvider = {
	getState: vi.fn(),
	postMessageToWebview: vi.fn(),
	customModesManager: {
		getCustomModes: vi.fn(),
		deleteCustomMode: vi.fn(),
	},
	context: {
		extensionPath: "/mock/extension/path",
		globalStorageUri: { fsPath: "/mock/global/storage" },
	},
	contextProxy: {
		context: {
			extensionPath: "/mock/extension/path",
			globalStorageUri: { fsPath: "/mock/global/storage" },
		},
		setValue: vi.fn(),
		getValue: vi.fn(),
	},
	log: vi.fn(),
	postStateToWebview: vi.fn(),
	getCurrentTask: vi.fn(),
	getTaskWithId: vi.fn(),
	createTask: vi.fn().mockResolvedValue({ taskId: "mock-task-id" }),
	createTaskWithHistoryItem: vi.fn(),
	clearTask: vi.fn(),
	notifyAcceptedFinalParentCompletion: vi.fn(),
	notifyFinalParentCompletionUiVisible: vi.fn(),
	testSmtpSettings: vi.fn(),
	getMcpHub: vi.fn(),
	getSkillsManager: vi.fn(),
	convertToWebviewUri: vi.fn((path: string) => `vscode-resource://${path}`),
	cwd: "/mock/workspace",
} as unknown as ClineProvider

type MockCompletionTask = EventEmitter & {
	taskId: string
	handleWebviewAskResponse: ReturnType<typeof vi.fn>
}

import { t } from "../../../i18n"

vi.mock("vscode", () => {
	const showInformationMessage = vi.fn()
	const showErrorMessage = vi.fn()
	const openTextDocument = vi.fn().mockResolvedValue({})
	const showTextDocument = vi.fn().mockResolvedValue(undefined)
	const createTextEditorDecorationType = vi.fn(() => ({ dispose: vi.fn() }))
	const executeCommand = vi.fn().mockResolvedValue(undefined)

	return {
		commands: {
			executeCommand,
		},
		window: {
			showInformationMessage,
			showErrorMessage,
			showTextDocument,
			createTextEditorDecorationType,
		},
		workspace: {
			workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
			openTextDocument,
		},
	}
})

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string, args?: Record<string, any>) => {
		// For the delete confirmation with rules, we need to return the interpolated string
		if (key === "common:confirmation.delete_custom_mode_with_rules" && args) {
			return `Are you sure you want to delete this ${args.scope} mode?\n\nThis will also delete the associated rules folder at:\n${args.rulesFolderPath}`
		}
		// Return the translated value for "Yes"
		if (key === "common:answers.yes") {
			return "Yes"
		}
		// Return the translated value for "Cancel"
		if (key === "common:answers.cancel") {
			return "Cancel"
		}
		return key
	}),
}))

vi.mock("fs/promises", () => {
	const mockRm = vi.fn().mockResolvedValue(undefined)
	const mockMkdir = vi.fn().mockResolvedValue(undefined)
	const mockReadFile = vi.fn().mockResolvedValue("[]")
	const mockWriteFile = vi.fn().mockResolvedValue(undefined)

	return {
		default: {
			rm: mockRm,
			mkdir: mockMkdir,
			readFile: mockReadFile,
			writeFile: mockWriteFile,
		},
		rm: mockRm,
		mkdir: mockMkdir,
		readFile: mockReadFile,
		writeFile: mockWriteFile,
	}
})

import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as fsUtils from "../../../utils/fs"
import { getWorkspacePath } from "../../../utils/path"
import { ensureSettingsDirectoryExists } from "../../../utils/globalContext"
import { generateErrorDiagnostics } from "../diagnosticsHandler"
import type { ModeConfig } from "@roo-code/types"

vi.mock("../../../utils/fs")
vi.mock("../../../utils/path")
vi.mock("../../../utils/globalContext")

vi.mock("../../mentions/resolveImageMentions", () => ({
	resolveImageMentions: vi.fn(async ({ text, images }: { text: string; images?: string[] }) => ({
		text,
		images: [...(images ?? []), "data:image/png;base64,from-mention"],
	})),
}))

import { resolveImageMentions } from "../../mentions/resolveImageMentions"

describe("webviewMessageHandler - testSmtpSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("posts a successful SMTP test result without SMTP secrets", async () => {
		vi.mocked(mockClineProvider.testSmtpSettings).mockResolvedValue({ attempted: true, sent: true })

		await webviewMessageHandler(mockClineProvider, { type: "testSmtpSettings" } as any)

		expect(mockClineProvider.testSmtpSettings).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "smtpTestResult",
			success: true,
			text: "SMTP test email sent successfully.",
			error: undefined,
			values: {
				attempted: true,
				sent: true,
				skippedReason: undefined,
			},
		})
		expect(JSON.stringify(vi.mocked(mockClineProvider.postMessageToWebview).mock.calls)).not.toContain(
			"smtp-secret",
		)
	})

	it("posts invalid SMTP test configuration errors without accepting webview password input", async () => {
		vi.mocked(mockClineProvider.testSmtpSettings).mockResolvedValue({
			attempted: false,
			sent: false,
			skippedReason: "invalid-config",
		})

		await webviewMessageHandler(mockClineProvider, {
			type: "testSmtpSettings",
			values: { smtpPassword: "smtp-secret" },
		} as any)

		expect(mockClineProvider.testSmtpSettings).toHaveBeenCalledWith()
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "smtpTestResult",
			success: false,
			text: undefined,
			error: "SMTP settings are incomplete or invalid. Check the extension output for details.",
			values: {
				attempted: false,
				sent: false,
				skippedReason: "invalid-config",
			},
		})
		expect(JSON.stringify(vi.mocked(mockClineProvider.postMessageToWebview).mock.calls)).not.toContain(
			"smtp-secret",
		)
	})

	it("posts sanitized SMTP test send failures", async () => {
		vi.mocked(mockClineProvider.testSmtpSettings).mockResolvedValue({
			attempted: true,
			sent: false,
			error: "Authentication failed for [redacted]",
		})

		await webviewMessageHandler(mockClineProvider, { type: "testSmtpSettings" } as any)

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "smtpTestResult",
			success: false,
			text: undefined,
			error: "Authentication failed for [redacted]",
			values: {
				attempted: true,
				sent: false,
				skippedReason: undefined,
			},
		})
		expect(JSON.stringify(vi.mocked(mockClineProvider.postMessageToWebview).mock.calls)).not.toContain(
			"smtp-secret",
		)
	})
})

describe("webviewMessageHandler - taskCompletionUiVisible", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("forwards the visible completed parent task signal to the provider without accepting or clearing the task", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "taskCompletionUiVisible",
			taskId: "visible-parent-task",
			values: {
				ask: "completion_result",
				taskTs: 100,
				completionTs: 200,
			},
		} as any)

		expect(mockClineProvider.notifyFinalParentCompletionUiVisible).toHaveBeenCalledWith("visible-parent-task", {
			ask: "completion_result",
			taskTs: 100,
			completionTs: 200,
		})
		expect(mockClineProvider.notifyAcceptedFinalParentCompletion).not.toHaveBeenCalled()
		expect(mockClineProvider.clearTask).not.toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - requestLmStudioModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				lmStudioModelId: "model-1",
				lmStudioBaseUrl: "http://localhost:1234",
			},
		})
	})

	it("successfully fetches models from LMStudio", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsPromptCache: false,
				description: "Test model 2",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestLmStudioModels",
		})

		expect(mockGetModels).toHaveBeenCalledWith({ provider: "lmstudio", baseUrl: "http://localhost:1234" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "lmStudioModels",
			lmStudioModels: mockModels,
		})
	})
})

describe("webviewMessageHandler - image mentions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			maxImageFileSize: 5,
			maxTotalImageSize: 20,
		})
	})

	it("should resolve image mentions for askResponse payloads", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "See @/img.png",
			images: [],
		})

		expect(vi.mocked(resolveImageMentions)).toHaveBeenCalled()
		expect(mockHandleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "See @/img.png", [
			"data:image/png;base64,from-mention",
		])
	})
})

describe("webviewMessageHandler - acceptCompletion", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useRealTimers()
		vi.mocked(mockClineProvider.clearTask).mockResolvedValue(undefined)
		vi.mocked(mockClineProvider.postStateToWebview).mockResolvedValue(undefined)
	})

	it("accepts completion and waits for TaskCompleted before clearing the task", async () => {
		const calls: string[] = []
		let task: MockCompletionTask
		const tokenUsage = { totalTokensIn: 12, totalTokensOut: 34, totalCost: 0.12, contextTokens: 2048 }
		const toolUsage = { read_file: { attempts: 1, failures: 0 } }

		task = Object.assign(new EventEmitter(), {
			taskId: "task-accept-completion",
			handleWebviewAskResponse: vi.fn((response: string) => {
				calls.push(`askResponse:${response}`)
				setTimeout(() => task.emit(RooCodeEventName.TaskCompleted, task.taskId, tokenUsage, toolUsage), 0)
			}),
		})

		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(task as any)
		vi.mocked(mockClineProvider.notifyAcceptedFinalParentCompletion).mockImplementation(async () => {
			calls.push("notifyAcceptedFinalParentCompletion")
		})
		vi.mocked(mockClineProvider.clearTask).mockImplementation(async () => {
			calls.push("clearTask")
		})
		vi.mocked(mockClineProvider.postStateToWebview).mockImplementation(async () => {
			calls.push("postState")
		})

		await webviewMessageHandler(mockClineProvider, { type: "acceptCompletion" } as any)

		expect(task.handleWebviewAskResponse).toHaveBeenCalledWith("yesButtonClicked")
		expect(mockClineProvider.notifyAcceptedFinalParentCompletion).toHaveBeenCalledWith(task, tokenUsage, toolUsage)
		expect(mockClineProvider.clearTask).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
		expect(calls).toEqual([
			"askResponse:yesButtonClicked",
			"notifyAcceptedFinalParentCompletion",
			"clearTask",
			"postState",
		])
		expect(task.listenerCount(RooCodeEventName.TaskCompleted)).toBe(0)
	})

	it("waits for accepted final parent notification work before clearing the task", async () => {
		const calls: string[] = []
		let resolveNotification!: () => void
		const notificationPromise = new Promise<void>((resolve) => {
			resolveNotification = resolve
		})
		let task: MockCompletionTask
		const tokenUsage = { totalTokensIn: 12, totalTokensOut: 34, totalCost: 0.12, contextTokens: 2048 }
		const toolUsage = { read_file: { attempts: 1, failures: 0 } }

		task = Object.assign(new EventEmitter(), {
			taskId: "task-accept-completion-await-notification",
			handleWebviewAskResponse: vi.fn((response: string) => {
				calls.push(`askResponse:${response}`)
				setTimeout(() => task.emit(RooCodeEventName.TaskCompleted, task.taskId, tokenUsage, toolUsage), 0)
			}),
		})

		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(task as any)
		vi.mocked(mockClineProvider.notifyAcceptedFinalParentCompletion).mockImplementation(() => {
			calls.push("notifyAcceptedFinalParentCompletion:start")
			return notificationPromise as any
		})
		vi.mocked(mockClineProvider.clearTask).mockImplementation(async () => {
			calls.push("clearTask")
		})
		vi.mocked(mockClineProvider.postStateToWebview).mockImplementation(async () => {
			calls.push("postState")
		})

		const handlerPromise = webviewMessageHandler(mockClineProvider, { type: "acceptCompletion" } as any)

		await vi.waitFor(() => expect(calls).toContain("notifyAcceptedFinalParentCompletion:start"))
		expect(calls).not.toContain("clearTask")

		calls.push("notifyAcceptedFinalParentCompletion:resolved")
		resolveNotification()
		await handlerPromise

		expect(calls).toEqual([
			"askResponse:yesButtonClicked",
			"notifyAcceptedFinalParentCompletion:start",
			"notifyAcceptedFinalParentCompletion:resolved",
			"clearTask",
			"postState",
		])
		expect(task.listenerCount(RooCodeEventName.TaskCompleted)).toBe(0)
	})

	it("does not clear the task if completion is not observed", async () => {
		vi.useFakeTimers()
		const task: MockCompletionTask = Object.assign(new EventEmitter(), {
			taskId: "task-missing-completion-event",
			handleWebviewAskResponse: vi.fn(),
		})

		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(task as any)

		const handlerPromise = webviewMessageHandler(mockClineProvider, { type: "acceptCompletion" } as any)

		await vi.runAllTimersAsync()
		await handlerPromise

		expect(task.handleWebviewAskResponse).toHaveBeenCalledWith("yesButtonClicked")
		expect(mockClineProvider.notifyAcceptedFinalParentCompletion).not.toHaveBeenCalled()
		expect(mockClineProvider.clearTask).not.toHaveBeenCalled()
		expect(mockClineProvider.postStateToWebview).not.toHaveBeenCalled()
		expect(mockClineProvider.log).toHaveBeenCalledWith(
			expect.stringContaining(
				"Timed out waiting for TaskCompleted before clearing task task-missing-completion-event",
			),
		)
		expect(task.listenerCount(RooCodeEventName.TaskCompleted)).toBe(0)

		vi.useRealTimers()
	})
})

describe("webviewMessageHandler - requestOllamaModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				ollamaModelId: "model-1",
				ollamaBaseUrl: "http://localhost:1234",
			},
		})
	})

	it("successfully fetches models from Ollama", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsPromptCache: false,
				description: "Test model 2",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestOllamaModels",
		})

		expect(mockGetModels).toHaveBeenCalledWith({ provider: "ollama", baseUrl: "http://localhost:1234" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "ollamaModels",
			ollamaModels: mockModels,
		})
	})
})

describe("webviewMessageHandler - requestRouterModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				litellmApiKey: "litellm-key",
				litellmBaseUrl: "http://localhost:4000",
			},
		})
	})

	it("successfully fetches models from all providers", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsPromptCache: false,
				description: "Test model 2",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify getModels was called for each provider
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "openrouter" })
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "requesty", apiKey: "requesty-key" })
		expect(mockGetModels).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "unbound",
			}),
		)
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "vercel-ai-gateway" })
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "litellm-key",
			baseUrl: "http://localhost:4000",
		})

		// Verify response was sent
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
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

	it("handles LiteLLM models with values from message when config is missing", async () => {
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				// Missing litellm config
			},
		})

		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			values: {
				litellmApiKey: "message-litellm-key",
				litellmBaseUrl: "http://message-url:4000",
			},
		})

		// Verify LiteLLM was called with values from message
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "message-litellm-key",
			baseUrl: "http://message-url:4000",
		})
	})

	it("skips LiteLLM when both config and message values are missing", async () => {
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				// Missing litellm config
			},
		})

		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			// No values provided
		})

		// Verify LiteLLM was NOT called
		expect(mockGetModels).not.toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "litellm",
			}),
		)

		// Verify response includes empty object for LiteLLM
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
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

	it("handles individual provider failures gracefully", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
		}

		// Mock some providers to succeed and others to fail
		mockGetModels
			.mockResolvedValueOnce(mockModels) // openrouter
			.mockRejectedValueOnce(new Error("Requesty API error")) // requesty
			.mockResolvedValueOnce(mockModels) // unbound
			.mockResolvedValueOnce(mockModels) // vercel-ai-gateway
			.mockRejectedValueOnce(new Error("LiteLLM connection failed")) // litellm

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify error messages were sent for failed providers (these come first)
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Requesty API error",
			values: { provider: "requesty" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "LiteLLM connection failed",
			values: { provider: "litellm" },
		})

		// Verify final routerModels response includes successful providers and empty objects for failed ones
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: {},
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

	it("handles Error objects and string errors correctly", async () => {
		// Mock providers to fail with different error types
		mockGetModels
			.mockRejectedValueOnce(new Error("Structured error message")) // openrouter
			.mockRejectedValueOnce(new Error("Requesty API error")) // requesty
			.mockRejectedValueOnce(new Error("Unbound error")) // unbound
			.mockRejectedValueOnce(new Error("Vercel AI Gateway error")) // vercel-ai-gateway
			.mockRejectedValueOnce(new Error("LiteLLM connection failed")) // litellm

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify error handling for different error types
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Structured error message",
			values: { provider: "openrouter" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Requesty API error",
			values: { provider: "requesty" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Unbound error",
			values: { provider: "unbound" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Vercel AI Gateway error",
			values: { provider: "vercel-ai-gateway" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "LiteLLM connection failed",
			values: { provider: "litellm" },
		})
	})

	it("prefers config values over message values for LiteLLM", async () => {
		const mockModels: ModelRecord = {}
		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			values: {
				litellmApiKey: "message-key",
				litellmBaseUrl: "http://message-url",
			},
		})

		// Verify config values are used over message values
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "litellm-key", // From config
			baseUrl: "http://localhost:4000", // From config
		})
	})

	it("uses explicit message values for filtered credentialed static provider requests", async () => {
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				geminiApiKey: "saved-gemini-key",
				googleGeminiBaseUrl: "https://saved.example.com",
			},
		})

		const mockModels: ModelRecord = {
			"gemini-3.1-pro-preview": {
				maxTokens: 65_536,
				contextWindow: 1_048_576,
				supportsPromptCache: false,
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			values: {
				provider: "gemini",
				geminiApiKey: "message-gemini-key",
				googleGeminiBaseUrl: "https://message.example.com",
			},
		})

		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "gemini",
			apiKey: "message-gemini-key",
			baseUrl: "https://message.example.com",
		})
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: { gemini: mockModels },
			values: { provider: "gemini" },
		})
	})
})

describe("webviewMessageHandler - requestOpenAiCodexRateLimits", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetAccessToken.mockResolvedValue(null)
		mockGetAccountId.mockResolvedValue(null)
	})

	it("posts error when not authenticated", async () => {
		await webviewMessageHandler(mockClineProvider, { type: "requestOpenAiCodexRateLimits" } as any)

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "openAiCodexRateLimits",
			error: "Not authenticated with OpenAI Codex",
		})
	})

	it("posts values when authenticated", async () => {
		mockGetAccessToken.mockResolvedValue("token")
		mockGetAccountId.mockResolvedValue("acct_123")
		mockFetchOpenAiCodexRateLimitInfo.mockResolvedValue({
			primary: { usedPercent: 10, resetsAt: 1700000000000 },
			fetchedAt: 1700000000000,
		})

		await webviewMessageHandler(mockClineProvider, { type: "requestOpenAiCodexRateLimits" } as any)

		expect(mockFetchOpenAiCodexRateLimitInfo).toHaveBeenCalledWith("token", { accountId: "acct_123" })
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "openAiCodexRateLimits",
			values: {
				primary: { usedPercent: 10, resetsAt: 1700000000000 },
				fetchedAt: 1700000000000,
			},
		})
	})
})

describe("webviewMessageHandler - deleteCustomMode", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getWorkspacePath).mockReturnValue("/mock/workspace")
		vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined)
		vi.mocked(ensureSettingsDirectoryExists).mockResolvedValue("/mock/global/storage/.roo")
	})

	it("should delete a project mode and its rules folder", async () => {
		const slug = "test-project-mode"
		const rulesFolderPath = path.join("/mock/workspace", ".roo", `rules-${slug}`)

		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Project Mode",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "project",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		// The confirmation dialog is now handled in the webview, so we don't expect showInformationMessage to be called
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
	})

	it("should delete a global mode and its rules folder", async () => {
		const slug = "test-global-mode"
		const homeDir = os.homedir()
		const rulesFolderPath = path.join(homeDir, ".roo", `rules-${slug}`)

		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Global Mode",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "global",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		// The confirmation dialog is now handled in the webview, so we don't expect showInformationMessage to be called
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
	})

	it("should only delete the mode when rules folder does not exist", async () => {
		const slug = "test-mode-no-rules"
		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Mode No Rules",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "project",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(false)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		// The confirmation dialog is now handled in the webview, so we don't expect showInformationMessage to be called
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).not.toHaveBeenCalled()
	})

	it("should handle errors when deleting rules folder", async () => {
		const slug = "test-mode-error"
		const rulesFolderPath = path.join("/mock/workspace", ".roo", `rules-${slug}`)
		const error = new Error("Permission denied")

		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Mode Error",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "project",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)
		vi.mocked(fs.rm).mockRejectedValue(error)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
		// Verify error message is shown to the user
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			t("common:errors.delete_rules_folder_failed", {
				rulesFolderPath,
				error: error.message,
			}),
		)
		// No error response is sent anymore - we just continue with deletion
		expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - message dialog preferences", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Mock a current Cline instance
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			taskId: "test-task-id",
			apiConversationHistory: [],
			clineMessages: [],
		} as any)
		// Reset getValue mock
		vi.mocked(mockClineProvider.contextProxy.getValue).mockReturnValue(false)
	})

	describe("deleteMessage", () => {
		it("should always show dialog for delete confirmation", async () => {
			vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
				clineMessages: [],
				apiConversationHistory: [],
			} as any) // Mock current cline with proper structure

			await webviewMessageHandler(mockClineProvider, {
				type: "deleteMessage",
				value: 123456789, // Changed from messageTs to value
			})

			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "showDeleteMessageDialog",
				messageTs: 123456789,
				hasCheckpoint: false,
			})
		})
	})

	describe("submitEditedMessage", () => {
		it("should always show dialog for edit confirmation", async () => {
			vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
				clineMessages: [],
				apiConversationHistory: [],
			} as any) // Mock current cline with proper structure

			await webviewMessageHandler(mockClineProvider, {
				type: "submitEditedMessage",
				value: 123456789,
				editedMessageContent: "edited content",
			})

			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 123456789,
				text: "edited content",
				hasCheckpoint: false,
				images: undefined,
			})
		})
	})
})

describe("webviewMessageHandler - mcpEnabled", () => {
	let mockMcpHub: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Create a mock McpHub instance
		mockMcpHub = {
			handleMcpEnabledChange: vi.fn().mockResolvedValue(undefined),
		}

		// Ensure provider exposes getMcpHub and returns our mock
		;(mockClineProvider as any).getMcpHub = vi.fn().mockReturnValue(mockMcpHub)
	})

	it("delegates enable=true to McpHub and posts updated state", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { mcpEnabled: true },
		})

		expect((mockClineProvider as any).getMcpHub).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledWith(true)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
	})

	it("delegates enable=false to McpHub and posts updated state", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { mcpEnabled: false },
		})

		expect((mockClineProvider as any).getMcpHub).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledWith(false)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
	})

	it("handles missing McpHub instance gracefully and still posts state", async () => {
		;(mockClineProvider as any).getMcpHub = vi.fn().mockReturnValue(undefined)

		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { mcpEnabled: true },
		})

		expect((mockClineProvider as any).getMcpHub).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
	})
})

describe("webviewMessageHandler - requestCommands", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("includes skill slug commands and dedupes duplicate skill names while preserving first skill entry", async () => {
		mockGetCommands.mockResolvedValue([])

		const getTaskMode = vi.fn().mockResolvedValue("code")
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			getTaskMode,
		} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)

		const getSkillsForMode = vi.fn().mockReturnValue([
			{
				name: "skill-slug-entry",
				description: "Primary skill slug",
				path: "/mock/.roo/skills/skill-slug-entry/SKILL.md",
				source: "project",
				modeSlugs: ["code"],
			},
			{
				name: "skill-slug-entry",
				description: "Duplicate skill slug",
				path: "/mock/.roo/skills/duplicate-skill/SKILL.md",
				source: "global",
				modeSlugs: ["code"],
			},
			{
				name: "another-skill-slug",
				description: "Another skill-generated command",
				path: "/mock/.roo/skills/another-skill-slug/SKILL.md",
				source: "global",
				modeSlugs: ["code"],
			},
		])

		vi.mocked(mockClineProvider.getSkillsManager).mockReturnValue({
			getSkillsForMode,
		} as unknown as ReturnType<ClineProvider["getSkillsManager"]>)

		await webviewMessageHandler(mockClineProvider, { type: "requestCommands" })

		const commandMessageCall = vi
			.mocked(mockClineProvider.postMessageToWebview)
			.mock.calls.find(([postedMessage]) => postedMessage.type === "commands")
		expect(commandMessageCall).toBeDefined()

		const commandMessage = commandMessageCall?.[0]
		expect(commandMessage?.commands).toEqual(
			expect.arrayContaining([
				{
					name: "skill-slug-entry",
					source: "project",
					filePath: "/mock/.roo/skills/skill-slug-entry/SKILL.md",
					description: "Primary skill slug",
				},
				{
					name: "another-skill-slug",
					source: "global",
					filePath: "/mock/.roo/skills/another-skill-slug/SKILL.md",
					description: "Another skill-generated command",
				},
			]),
		)

		expect(commandMessage?.commands?.filter((command) => command.name === "skill-slug-entry")).toHaveLength(1)
	})

	it("adds skill-backed command entries without overriding existing command names", async () => {
		mockGetCommands.mockResolvedValue([
			{
				name: "deploy",
				content: "existing command",
				source: "project",
				filePath: "/mock/workspace/.roo/commands/deploy.md",
				description: "Deploy command",
				argumentHint: "staging | production",
			},
		])

		const getTaskMode = vi.fn().mockResolvedValue("code")
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			getTaskMode,
		} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)

		const getSkillsForMode = vi.fn().mockReturnValue([
			{
				name: "deploy",
				description: "Deploy skill",
				path: "/mock/.roo/skills/deploy/SKILL.md",
				source: "global",
				modeSlugs: ["code"],
			},
			{
				name: "skill-only",
				description: "Skill-generated command",
				path: "/mock/.roo/skills/skill-only/SKILL.md",
				source: "project",
				modeSlugs: ["code"],
			},
		])

		vi.mocked(mockClineProvider.getSkillsManager).mockReturnValue({
			getSkillsForMode,
		} as unknown as ReturnType<ClineProvider["getSkillsManager"]>)

		await webviewMessageHandler(mockClineProvider, { type: "requestCommands" })

		expect(getSkillsForMode).toHaveBeenCalledWith("code")

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "commands",
			commands: expect.arrayContaining([
				{
					name: "deploy",
					source: "project",
					filePath: "/mock/workspace/.roo/commands/deploy.md",
					description: "Deploy command",
					argumentHint: "staging | production",
				},
				{
					name: "skill-only",
					source: "project",
					filePath: "/mock/.roo/skills/skill-only/SKILL.md",
					description: "Skill-generated command",
				},
			]),
		})

		const commandMessageCall = vi
			.mocked(mockClineProvider.postMessageToWebview)
			.mock.calls.find(([postedMessage]) => postedMessage.type === "commands")
		expect(commandMessageCall).toBeDefined()

		const commandMessage = commandMessageCall?.[0]
		expect(commandMessage?.commands?.filter((command) => command.name === "deploy")).toHaveLength(1)
	})

	it("preserves existing behavior when skills manager is unavailable", async () => {
		mockGetCommands.mockResolvedValue([
			{
				name: "build",
				content: "build command",
				source: "built-in",
				filePath: "<built-in:build>",
				description: "Build command",
				argumentHint: "target",
			},
		])

		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
		} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)

		vi.mocked(mockClineProvider.getSkillsManager).mockReturnValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "requestCommands" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "commands",
			commands: [
				{
					name: "build",
					source: "built-in",
					filePath: "<built-in:build>",
					description: "Build command",
					argumentHint: "target",
				},
			],
		})
	})
})

describe("webviewMessageHandler - downloadErrorDiagnostics", () => {
	beforeEach(() => {
		vi.clearAllMocks()

		// Ensure contextProxy has a globalStorageUri for the handler
		;(mockClineProvider as any).contextProxy.globalStorageUri = { fsPath: "/mock/global/storage" }

		// Provide a current task with a stable ID
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			taskId: "test-task-id",
		} as any)
	})

	it("calls generateErrorDiagnostics with correct parameters", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "downloadErrorDiagnostics",
			values: {
				timestamp: "2025-01-01T00:00:00.000Z",
				version: "1.2.3",
				provider: "test-provider",
				model: "test-model",
				details: "Sample error details",
			},
		} as any)

		// Verify generateErrorDiagnostics was called with the correct parameters
		expect(generateErrorDiagnostics).toHaveBeenCalledTimes(1)
		expect(generateErrorDiagnostics).toHaveBeenCalledWith({
			taskId: "test-task-id",
			globalStoragePath: "/mock/global/storage",
			values: {
				timestamp: "2025-01-01T00:00:00.000Z",
				version: "1.2.3",
				provider: "test-provider",
				model: "test-model",
				details: "Sample error details",
			},
			log: expect.any(Function),
		})
	})

	it("shows error when no active task", async () => {
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(null as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "downloadErrorDiagnostics",
			values: {},
		} as any)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("No active task to generate diagnostics for")
		expect(generateErrorDiagnostics).not.toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - visualBrowserInspector", () => {
	const mockMainClineProvider = {
		...mockClineProvider,
		postMessageToWebview: vi.fn(),
		createTask: vi.fn().mockResolvedValue({ taskId: "visual-fix-task-id" }),
	} as unknown as ClineProvider

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(mockClineProvider.createTask).mockResolvedValue({ taskId: "vbi-panel-task-id" } as any)
		vi.mocked(mockMainClineProvider.createTask).mockResolvedValue({ taskId: "visual-fix-task-id" } as any)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(null as any)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("opens the VBI panel from chat tool cards and syncs focus without switching the main chat view", async () => {
		const panelState = {
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
					region: { x: 10, y: 20, width: 100, height: 120 },
					elements: [],
				},
			],
			inspections: [],
			findings: [],
			statusMessage: "Ready",
		} as any
		const getPanelStateSpy = vi.spyOn(visualBrowserInspectorService, "getPanelState").mockReturnValue(panelState)
		const postMessageToVisualBrowserInspectorPanels = vi.fn().mockResolvedValue(undefined)
		;(mockClineProvider as any).postMessageToVisualBrowserInspectorPanels =
			postMessageToVisualBrowserInspectorPanels

		try {
			await webviewMessageHandler(mockClineProvider, {
				type: "visualBrowserInspector",
				payload: {
					action: "open_panel",
					sessionId: "session-1",
					screenshotId: "shot-1",
					cropId: "crop-1",
				},
			} as any)

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(getCommand("openVisualBrowserInspector"))
			expect(postMessageToVisualBrowserInspectorPanels).toHaveBeenCalledWith({
				type: "visualBrowserInspector",
				payload: expect.objectContaining({
					state: panelState,
					source: "chat_tool",
					status: "complete",
					focus: {
						sessionId: "session-1",
						screenshotId: "shot-1",
						cropId: "crop-1",
					},
					message: "Opened Visual Browser Inspector.",
				}),
			})
			expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalledWith(
				expect.objectContaining({ type: "visualBrowserInspector" }),
			)
		} finally {
			getPanelStateSpy.mockRestore()
			delete (mockClineProvider as any).postMessageToVisualBrowserInspectorPanels
		}
	})

	it("routes a VBI follow-up code task to the main C Code provider while leaving the VBI provider in visual mode", async () => {
		const getMainProviderSpy = vi
			.spyOn(ClineProvider, "getOrOpenMainInstance")
			.mockResolvedValue(mockMainClineProvider)
		const getPanelStateSpy = vi.spyOn(visualBrowserInspectorService, "getPanelState").mockReturnValue({
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
					path: ".roo/visual-browser-inspector/session-1/screenshots/shot-1.png",
					createdAt: "2026-01-01T00:00:01.000Z",
					viewport: { name: "mobile", width: 390, height: 844 },
					pageWidth: 390,
					pageHeight: 844,
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
					generatedAt: "2026-01-01T00:00:02.000Z",
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
		} as any)
		const taskConfiguration = { apiProvider: "openrouter", currentApiConfigName: "work-profile", mode: "ask" }

		try {
			await webviewMessageHandler(mockClineProvider, {
				type: "visualBrowserInspector",
				payload: { action: "start_fix_task", scope: "all", sessionId: "session-1", screenshotId: "shot-1" },
				taskConfiguration,
			} as any)

			expect(getMainProviderSpy).toHaveBeenCalledTimes(1)
			expect(mockClineProvider.createTask).not.toHaveBeenCalled()
			expect(mockMainClineProvider.createTask).toHaveBeenCalledTimes(1)
			const createTaskCall = vi.mocked(mockMainClineProvider.createTask).mock.calls[0]
			const prompt = createTaskCall[0] as string
			expect(prompt).toContain("Fix Visual Browser Inspector findings.")
			expect(prompt).toContain("Tiny checkout button")
			expect(prompt).toContain("Do not blindly apply these recommendations")
			expect(prompt).toContain("do not upload screenshots or crops to a remote service")
			expect(prompt).toContain("webview-ui/src/components/CheckoutButton.tsx")
			expect(createTaskCall[2]).toBeUndefined()
			expect(createTaskCall[3]).toEqual({ mode: "code" })
			expect(createTaskCall[4]).toEqual({ ...taskConfiguration, mode: "code" })
			expect(mockMainClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "invoke",
				invoke: "newChat",
			})
			expect(mockMainClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "action",
				action: "switchTab",
				tab: "chat",
			})
			expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalledWith({
				type: "invoke",
				invoke: "newChat",
			})
			expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalledWith({
				type: "action",
				action: "switchTab",
				tab: "chat",
			})
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "visualBrowserInspector",
				payload: expect.objectContaining({
					message: "Started a follow-up C Code task for the selected Visual Browser Inspector findings.",
					startedTask: true,
				}),
			})
		} finally {
			getPanelStateSpy.mockRestore()
		}
	})

	it("routes a VBI custom change task to the main C Code provider with full context", async () => {
		const getMainProviderSpy = vi
			.spyOn(ClineProvider, "getOrOpenMainInstance")
			.mockResolvedValue(mockMainClineProvider)
		const getPanelStateSpy = vi.spyOn(visualBrowserInspectorService, "getPanelState").mockReturnValue({
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
					region: { x: 10, y: 20, width: 120, height: 80 },
					element: {
						tagName: "BUTTON",
						selector: "button[data-testid=checkout]",
						text: "Checkout now",
						role: "button",
						ariaLabel: "Checkout",
						attributes: { "data-testid": "checkout" },
						boundingBox: { x: 10, y: 20, width: 120, height: 80 },
						visible: true,
						sourceMapping: { component: "webview-ui/src/components/HeroCheckout.tsx" },
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
			statusMessage: "Ready",
		} as any)
		const taskConfiguration = { apiProvider: "openrouter", currentApiConfigName: "work-profile", mode: "ask" }

		try {
			await webviewMessageHandler(mockClineProvider, {
				type: "visualBrowserInspector",
				payload: {
					action: "start_change_task",
					sessionId: "session-1",
					instruction: "Make the checkout CTA more prominent",
					screenshotId: "shot-1",
					cropId: "crop-1",
					region: { x: 10, y: 20, width: 120, height: 80 },
					inspectionIndex: 0,
					includeScreenshotContext: true,
					includeCropContext: true,
					includeRegionContext: true,
					includeInspectionContext: true,
					includeFindingsContext: true,
				},
				taskConfiguration,
			} as any)

			expect(getMainProviderSpy).toHaveBeenCalledTimes(1)
			expect(mockClineProvider.createTask).not.toHaveBeenCalled()
			expect(mockMainClineProvider.createTask).toHaveBeenCalledTimes(1)
			const createTaskCall = vi.mocked(mockMainClineProvider.createTask).mock.calls[0]
			const prompt = createTaskCall[0] as string
			expect(prompt).toContain("Implement a specific Visual Browser Inspector change request.")
			expect(prompt).toContain("Make the checkout CTA more prominent")
			expect(prompt).toContain("Screenshot context: shot-1")
			expect(prompt).toContain("Crop context: crop-1")
			expect(prompt).toContain("Selected region bounds: 10,20 120×80px")
			expect(prompt).toContain("Selected element: button")
			expect(prompt).toContain("webview-ui/src/components/HeroCheckout.tsx")
			expect(prompt).toContain("Current findings/recommendations (context only")
			expect(prompt).toContain("Tiny checkout button")
			expect(prompt).toContain("Do not frame this as only fixing automatically detected findings")
			expect(prompt).toContain("Do not commit, push, merge, rebase, change branches, or build/package a VSIX")
			expect(prompt).not.toContain("secret-value")
			expect(createTaskCall[2]).toBeUndefined()
			expect(createTaskCall[3]).toEqual({ mode: "code" })
			expect(createTaskCall[4]).toEqual({ ...taskConfiguration, mode: "code" })
			expect(mockMainClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "invoke",
				invoke: "newChat",
			})
			expect(mockMainClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "action",
				action: "switchTab",
				tab: "chat",
			})
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "visualBrowserInspector",
				payload: expect.objectContaining({
					message: "Started a C Code task for the Visual Browser Inspector change request.",
					startedTask: true,
				}),
			})
		} finally {
			getPanelStateSpy.mockRestore()
		}
	})

	it("routes a VBI local-preview helper task to the main C Code provider with strict safe instructions", async () => {
		const getMainProviderSpy = vi
			.spyOn(ClineProvider, "getOrOpenMainInstance")
			.mockResolvedValue(mockMainClineProvider)
		const getPanelStateSpy = vi.spyOn(visualBrowserInspectorService, "getPanelState").mockReturnValue({
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
			statusMessage: "Ready",
		} as any)
		const taskConfiguration = { apiProvider: "openrouter", currentApiConfigName: "work-profile", mode: "ask" }

		try {
			await webviewMessageHandler(mockClineProvider, {
				type: "visualBrowserInspector",
				payload: {
					action: "start_local_preview_task",
					url: "localhost:5173?token=secret-value",
					sessionId: "session-1",
					viewport: "desktop",
				},
				taskConfiguration,
			} as any)

			expect(getMainProviderSpy).toHaveBeenCalledTimes(1)
			expect(mockClineProvider.createTask).not.toHaveBeenCalled()
			expect(mockMainClineProvider.createTask).toHaveBeenCalledTimes(1)
			const createTaskCall = vi.mocked(mockMainClineProvider.createTask).mock.calls[0]
			const prompt = createTaskCall[0] as string
			expect(prompt).toContain("Prepare a safe local preview for Visual Browser Inspector.")
			expect(prompt).toContain("Do not edit files.")
			expect(prompt).toContain("Do not install packages or modify dependencies.")
			expect(prompt).toContain("Do not run database migrations")
			expect(prompt).toContain("Do not commit, push, merge, rebase, or change branches.")
			expect(prompt).toContain("LOCAL_PREVIEW_URL=<url>")
			expect(prompt).toContain("visual_browser_open")
			expect(prompt).toContain("[redacted]")
			expect(prompt).not.toContain("secret-value")
			expect(createTaskCall[2]).toBeUndefined()
			expect(createTaskCall[3]).toEqual({ mode: "code" })
			expect(createTaskCall[4]).toEqual({ ...taskConfiguration, mode: "code" })
			expect(mockMainClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "invoke",
				invoke: "newChat",
			})
			expect(mockMainClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "action",
				action: "switchTab",
				tab: "chat",
			})
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "visualBrowserInspector",
				payload: expect.objectContaining({
					message:
						"Started a safe C Code helper task to prepare a local preview for Visual Browser Inspector.",
					startedTask: true,
				}),
			})
		} finally {
			getPanelStateSpy.mockRestore()
		}
	})

	it("keeps main-view VBI task creation on the originating main provider and ends on the chat tab", async () => {
		vi.spyOn(ClineProvider, "getOrOpenMainInstance").mockResolvedValue(mockClineProvider)
		const getPanelStateSpy = vi.spyOn(visualBrowserInspectorService, "getPanelState").mockReturnValue({
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
			screenshots: [],
			crops: [],
			inspections: [],
			findings: [
				{
					summary: "One local issue.",
					issues: [
						{
							severity: "major",
							confidence: 0.9,
							title: "Main view issue",
							visualEvidence: "Visible evidence.",
							screenshotId: "shot-1",
							cropId: null,
							selectorOrElement: "main",
							boundingBox: { x: 0, y: 0, width: 100, height: 100 },
							likelyCause: "Layout constraint.",
							suggestedFix: "Inspect and fix layout.",
							filesToInspect: [],
						},
					],
				},
			],
			statusMessage: "Ready",
		} as any)

		try {
			await webviewMessageHandler(mockClineProvider, {
				type: "visualBrowserInspector",
				payload: { action: "start_fix_task", scope: "all" },
			} as any)

			expect(mockClineProvider.createTask).toHaveBeenCalledTimes(1)
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "visualBrowserInspector",
				payload: expect.objectContaining({ startedTask: true }),
			})

			const postedMessages = vi
				.mocked(mockClineProvider.postMessageToWebview)
				.mock.calls.map(([posted]) => posted)
			expect(postedMessages[postedMessages.length - 1]).toEqual({
				type: "action",
				action: "switchTab",
				tab: "chat",
			})
		} finally {
			getPanelStateSpy.mockRestore()
		}
	})
})

describe("webviewMessageHandler - visual-only provider guard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		Object.defineProperty(mockClineProvider, "isVisualBrowserInspectorOnly", { value: true, configurable: true })
	})

	afterEach(() => {
		Object.defineProperty(mockClineProvider, "isVisualBrowserInspectorOnly", { value: false, configurable: true })
	})

	it("ignores normal new task creation in a visual-only provider", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "newTask",
			text: "Start a normal chat from the VBI panel",
		} as any)

		expect(mockClineProvider.createTask).not.toHaveBeenCalled()
		expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
		expect(mockClineProvider.log).toHaveBeenCalledWith(
			expect.stringContaining("Ignored newTask message in visual-only panel"),
		)
	})

	it("ignores normal settings and chat tab switches but still allows the VBI tab", async () => {
		await webviewMessageHandler(mockClineProvider, { type: "switchTab", tab: "settings" } as any)
		await webviewMessageHandler(mockClineProvider, { type: "switchTab", tab: "chat" } as any)

		expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalled()

		await webviewMessageHandler(mockClineProvider, { type: "switchTab", tab: "visualBrowserInspector" } as any)

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "action",
			action: "switchTab",
			tab: "visualBrowserInspector",
			values: undefined,
		})
	})

	it("ignores marketplace task creation in a visual-only provider", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "installMarketplaceMcp",
			marketplaceMcpId: "context7",
			marketplaceMcpScope: "global",
		} as any)

		expect(mockClineProvider.createTask).not.toHaveBeenCalled()
		expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
	})
})

describe("ClineProvider - main task provider routing", () => {
	const originalActiveInstances = (ClineProvider as any).activeInstances

	beforeEach(() => {
		vi.clearAllMocks()
		;(ClineProvider as any).activeInstances = new Set()
	})

	afterEach(() => {
		;(ClineProvider as any).activeInstances = originalActiveInstances
		vi.restoreAllMocks()
	})

	it("excludes visual-only VBI providers when selecting a visible main task provider", () => {
		const visibleVbiProvider = {
			isVisualBrowserInspectorOnly: true,
			view: { visible: true },
		} as any
		const hiddenMainProvider = {
			_disposed: false,
			isVisualBrowserInspectorOnly: false,
			view: { visible: false },
		} as any
		const visibleMainProvider = {
			_disposed: false,
			isVisualBrowserInspectorOnly: false,
			view: { visible: true },
		} as any

		;(ClineProvider as any).activeInstances = new Set([hiddenMainProvider, visibleVbiProvider, visibleMainProvider])

		expect(ClineProvider.getVisibleMainInstance()).toBe(visibleMainProvider)
	})

	it("opens the sidebar and returns a main provider when only the VBI provider is visible", async () => {
		const visibleVbiProvider = {
			_disposed: false,
			isVisualBrowserInspectorOnly: true,
			view: { visible: true },
		} as any
		const sidebarMainProvider = {
			_disposed: false,
			isVisualBrowserInspectorOnly: false,
			renderContext: "sidebar",
			view: { visible: false, show: vi.fn() },
		} as any

		;(ClineProvider as any).activeInstances = new Set([sidebarMainProvider, visibleVbiProvider])
		vi.mocked(vscode.commands.executeCommand).mockImplementation(async () => {
			sidebarMainProvider.view.visible = true
		})

		await expect(ClineProvider.getOrOpenMainInstance()).resolves.toBe(sidebarMainProvider)
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith("c-code.SidebarProvider.focus")
		expect(sidebarMainProvider.view.show).toHaveBeenCalledWith(false)
	})
})

describe("webviewMessageHandler - installMarketplaceMcp", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(mockClineProvider.createTask).mockResolvedValue({ taskId: "marketplace-task-id" } as any)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(null as any)
		vi.mocked(mockClineProvider.getMcpHub).mockReturnValue({
			getMcpSettingsFilePath: vi.fn().mockResolvedValue("/mock/global/mcp_settings.json"),
		} as any)
	})

	it("creates a top-level setup task in MCP Setup mode for a valid marketplace item", async () => {
		const taskConfiguration = { apiProvider: "openrouter", currentApiConfigName: "work-profile", mode: "code" }
		const message = {
			type: "installMarketplaceMcp",
			marketplaceMcpId: "github",
			marketplaceMcpScope: "global",
			taskConfiguration,
		} as any

		await webviewMessageHandler(mockClineProvider, message)

		expect(mockClineProvider.createTask).toHaveBeenCalledTimes(1)
		const createTaskCall = vi.mocked(mockClineProvider.createTask).mock.calls[0]
		const prompt = createTaskCall[0] as string
		expect(prompt).toContain('Set up the "GitHub" MCP server')
		expect(prompt).toContain("Target scope: global")
		expect(prompt).toContain("GITHUB_PERSONAL_ACCESS_TOKEN")
		expect(prompt).toContain("Optional secrets:\n- None")
		expect(prompt).toContain("/mock/global/mcp_settings.json")
		expect(prompt).toContain("dedicated MCP Setup mode")
		expect(createTaskCall[2]).toBeUndefined()
		expect(createTaskCall[3]).toEqual({ mode: "mcp-setup" })
		expect(createTaskCall[4]).toEqual({
			...taskConfiguration,
			mode: "mcp-setup",
		})
		expect((createTaskCall[4] as any).mode).not.toBe("code")
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "action",
			action: "switchTab",
			tab: "chat",
		})
	})

	it("creates setup guidance for Context7 streamable HTTP marketplace installs", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "installMarketplaceMcp",
			marketplaceMcpId: "context7",
			marketplaceMcpScope: "global",
		} as any)

		const prompt = vi.mocked(mockClineProvider.createTask).mock.calls[0][0] as string
		expect(prompt).toContain('Set up the "Context7" MCP server')
		expect(prompt).toContain("Transport type: streamable-http")
		expect(prompt).toContain("Optional secrets:\n- CONTEXT7_API_KEY")
		expect(prompt).toContain('"type": "streamable-http"')
		expect(prompt).toContain('"url": "https://mcp.context7.com/mcp"')
	})

	it("includes project scope config guidance when project is selected", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "installMarketplaceMcp",
			marketplaceMcpId: "sqlite",
			marketplaceMcpScope: "project",
		} as any)

		const prompt = vi.mocked(mockClineProvider.createTask).mock.calls[0][0] as string
		expect(prompt).toContain("Target scope: project")
		expect(prompt).toContain(".roo")
		expect(prompt).toContain("mcp.json")
		expect(prompt).toContain("sqlite")
	})

	it("rejects an unknown marketplace catalog id", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "installMarketplaceMcp",
			marketplaceMcpId: "unknown-server",
			marketplaceMcpScope: "global",
		} as any)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("Unknown MCP marketplace item"),
		)
		expect(mockClineProvider.createTask).not.toHaveBeenCalled()
	})

	it("rejects an invalid marketplace scope", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "installMarketplaceMcp",
			marketplaceMcpId: "github",
			marketplaceMcpScope: "workspace",
		} as any)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("Invalid MCP marketplace scope"),
		)
		expect(mockClineProvider.createTask).not.toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - discoverMarketplaceMcp", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(mockClineProvider.createTask).mockResolvedValue({ taskId: "marketplace-discovery-task-id" } as any)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(null as any)
		vi.mocked(mockClineProvider.getMcpHub).mockReturnValue({
			getMcpSettingsFilePath: vi.fn().mockResolvedValue("/mock/global/mcp_settings.json"),
			getAllServers: vi.fn().mockReturnValue([{ name: "context7" }, { name: "exa" }]),
		} as any)
	})

	it("creates a top-level custom discovery task in MCP Setup mode when prerequisites are installed", async () => {
		const taskConfiguration = { apiProvider: "openrouter", currentApiConfigName: "work-profile", mode: "code" }

		await webviewMessageHandler(mockClineProvider, {
			type: "discoverMarketplaceMcp",
			marketplaceMcpDiscoveryRequest: " Perplexity search MCP server ",
			taskConfiguration,
		} as any)

		expect(mockClineProvider.createTask).toHaveBeenCalledTimes(1)
		const createTaskCall = vi.mocked(mockClineProvider.createTask).mock.calls[0]
		const prompt = createTaskCall[0] as string
		expect(prompt).toContain("Find and set up the requested MCP server")
		expect(prompt).toContain("Perplexity search MCP server")
		expect(prompt).toContain("- context7")
		expect(prompt).toContain("- exa")
		expect(prompt).toContain("/mock/global/mcp_settings.json")
		expect(prompt).toMatch(/[\\/]mock[\\/]workspace[\\/]\.roo[\\/]mcp\.json/)
		expect(prompt).toContain("Use the installed Context7 MCP server")
		expect(prompt).toContain("Use an installed web search MCP server")
		expect(prompt).toContain("Verify the official source")
		expect(prompt).toContain("Propose a safe MCP config")
		expect(prompt).toContain("Do not echo, log, or store literal secret values")
		expect(prompt).toContain("Request approval before running commands")
		expect(prompt).toContain("Verify the server connects")
		expect(createTaskCall[2]).toBeUndefined()
		expect(createTaskCall[3]).toEqual({ mode: "mcp-setup" })
		expect(createTaskCall[4]).toEqual({
			...taskConfiguration,
			mode: "mcp-setup",
		})
		expect((createTaskCall[4] as any).mode).not.toBe("code")
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "action",
			action: "switchTab",
			tab: "chat",
		})
	})

	it("rejects an empty custom discovery request", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "discoverMarketplaceMcp",
			marketplaceMcpDiscoveryRequest: "  ",
		} as any)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"Enter an MCP server name or description before starting discovery.",
		)
		expect(mockClineProvider.createTask).not.toHaveBeenCalled()
	})

	it("rejects custom discovery when Context7 is missing", async () => {
		vi.mocked(mockClineProvider.getMcpHub).mockReturnValue({
			getMcpSettingsFilePath: vi.fn().mockResolvedValue("/mock/global/mcp_settings.json"),
			getAllServers: vi.fn().mockReturnValue([{ name: "exa" }]),
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "discoverMarketplaceMcp",
			marketplaceMcpDiscoveryRequest: "Perplexity search MCP server",
		} as any)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"Install Context7 and at least one web search MCP server before starting custom MCP discovery.",
		)
		expect(mockClineProvider.createTask).not.toHaveBeenCalled()
	})

	it("rejects custom discovery when a web search server is missing", async () => {
		vi.mocked(mockClineProvider.getMcpHub).mockReturnValue({
			getMcpSettingsFilePath: vi.fn().mockResolvedValue("/mock/global/mcp_settings.json"),
			getAllServers: vi.fn().mockReturnValue([{ name: "context7" }]),
		} as any)

		await webviewMessageHandler(mockClineProvider, {
			type: "discoverMarketplaceMcp",
			marketplaceMcpDiscoveryRequest: "Perplexity search MCP server",
		} as any)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"Install Context7 and at least one web search MCP server before starting custom MCP discovery.",
		)
		expect(mockClineProvider.createTask).not.toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - createMarketplaceMcpServer", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(mockClineProvider.createTask).mockResolvedValue({ taskId: "marketplace-creation-task-id" } as any)
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(null as any)
		vi.mocked(mockClineProvider.getMcpHub).mockReturnValue({
			getMcpSettingsFilePath: vi.fn().mockResolvedValue("/mock/global/mcp_settings.json"),
			getAllServers: vi.fn().mockReturnValue([{ name: "context7" }]),
		} as any)
	})

	it("creates a top-level custom creation task in MCP Setup mode without requiring web search prerequisites", async () => {
		const taskConfiguration = { apiProvider: "openrouter", currentApiConfigName: "work-profile", mode: "code" }

		await webviewMessageHandler(mockClineProvider, {
			type: "createMarketplaceMcpServer",
			marketplaceMcpCreationRequest: " Build a workspace docs lookup MCP server ",
			taskConfiguration,
		} as any)

		expect(mockClineProvider.createTask).toHaveBeenCalledTimes(1)
		const createTaskCall = vi.mocked(mockClineProvider.createTask).mock.calls[0]
		const prompt = createTaskCall[0] as string
		expect(prompt).toContain("Create a new custom MCP server")
		expect(prompt).toContain("Build a workspace docs lookup MCP server")
		expect(prompt).toContain("- context7")
		expect(prompt).toContain("/mock/global/mcp_settings.json")
		expect(prompt).toMatch(/[\\/]mock[\\/]workspace[\\/]\.roo[\\/]mcp\.json/)
		expect(prompt).toContain("Prefer a simple local TypeScript/Node MCP server")
		expect(prompt).toContain("Preserve all existing servers")
		expect(prompt).toContain("Use environment variables")
		expect(prompt).toContain("Verify the server connects")
		expect(prompt).toContain("safe, non-destructive test call")
		expect(createTaskCall[2]).toBeUndefined()
		expect(createTaskCall[3]).toEqual({ mode: "mcp-setup" })
		expect(createTaskCall[4]).toEqual({
			...taskConfiguration,
			mode: "mcp-setup",
		})
		expect((createTaskCall[4] as any).mode).not.toBe("code")
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({ type: "invoke", invoke: "newChat" })
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "action",
			action: "switchTab",
			tab: "chat",
		})
	})

	it("rejects an empty custom creation request", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "createMarketplaceMcpServer",
			marketplaceMcpCreationRequest: "  ",
		} as any)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"Enter what you want the MCP server to do before starting custom MCP server creation.",
		)
		expect(mockClineProvider.createTask).not.toHaveBeenCalled()
	})
})

// cd src && npx vitest run core/task/__tests__/Task.persistence.spec.ts

import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import type {
	ClineMessage,
	ClineSayTool,
	ExecutionPlan,
	GeneratedImageMetadata,
	GlobalState,
	ProviderSettings,
} from "@roo-code/types"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const {
	mockSaveApiMessages,
	mockSaveTaskMessages,
	mockReadApiMessages,
	mockReadTaskMessages,
	mockTaskMetadata,
	mockPWaitFor,
} = vi.hoisted(() => ({
	mockSaveApiMessages: vi.fn().mockResolvedValue(undefined),
	mockSaveTaskMessages: vi.fn().mockResolvedValue(undefined),
	mockReadApiMessages: vi.fn().mockResolvedValue([]),
	mockReadTaskMessages: vi.fn().mockResolvedValue([]),
	mockTaskMetadata: vi.fn().mockResolvedValue({
		historyItem: { id: "test-id", ts: Date.now(), task: "test" },
		tokenUsage: {
			totalTokensIn: 0,
			totalTokensOut: 0,
			totalCacheWrites: 0,
			totalCacheReads: 0,
			totalCost: 0,
			contextTokens: 0,
		},
	}),
	mockPWaitFor: vi.fn().mockResolvedValue(undefined),
}))

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	return {
		...actual,
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue("[]"),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
		default: {
			mkdir: vi.fn().mockResolvedValue(undefined),
			writeFile: vi.fn().mockResolvedValue(undefined),
			readFile: vi.fn().mockResolvedValue("[]"),
			unlink: vi.fn().mockResolvedValue(undefined),
			rmdir: vi.fn().mockResolvedValue(undefined),
		},
	}
})

vi.mock("p-wait-for", () => ({
	default: mockPWaitFor,
}))

vi.mock("../../task-persistence", () => ({
	saveApiMessages: mockSaveApiMessages,
	saveTaskMessages: mockSaveTaskMessages,
	readApiMessages: mockReadApiMessages,
	readTaskMessages: mockReadTaskMessages,
	taskMetadata: mockTaskMetadata,
	TaskHistoryStore: vi.fn().mockImplementation(() => ({
		initialize: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn(),
		get: vi.fn(),
		getAll: vi.fn().mockReturnValue([]),
		upsert: vi.fn().mockResolvedValue([]),
		delete: vi.fn().mockResolvedValue(undefined),
		deleteMany: vi.fn().mockResolvedValue(undefined),
		reconcile: vi.fn().mockResolvedValue(undefined),
		initialized: Promise.resolve(),
	})),
}))

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = { event: vi.fn(), fire: vi.fn() }
	const mockTextDocument = { uri: { fsPath: "/mock/workspace/path/file.ts" } }
	const mockTextEditor = { document: mockTextDocument }
	const mockTab = { input: { uri: { fsPath: "/mock/workspace/path/file.ts" } } }
	const mockTabGroup = { tabs: [mockTab] }

	return {
		TabInputTextDiff: vi.fn(),
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		window: {
			createTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			visibleTextEditors: [mockTextEditor],
			tabGroups: {
				all: [mockTabGroup],
				close: vi.fn(),
				onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
			},
			showErrorMessage: vi.fn(),
		},
		workspace: {
			workspaceFolders: [
				{
					uri: { fsPath: "/mock/workspace/path" },
					name: "mock-workspace",
					index: 0,
				},
			],
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => mockDisposable),
				onDidDelete: vi.fn(() => mockDisposable),
				onDidChange: vi.fn(() => mockDisposable),
				dispose: vi.fn(),
			})),
			fs: {
				stat: vi.fn().mockResolvedValue({ type: 1 }),
			},
			onDidSaveTextDocument: vi.fn(() => mockDisposable),
			getConfiguration: vi.fn(() => ({ get: (_key: string, defaultValue: unknown) => defaultValue })),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
		Disposable: {
			from: vi.fn(),
		},
		TabInputText: vi.fn(),
	}
})

vi.mock("../../mentions", () => ({
	parseMentions: vi.fn().mockImplementation((text) => {
		return Promise.resolve({ text: `processed: ${text}`, mode: undefined, contentBlocks: [] })
	}),
	openMention: vi.fn(),
	getLatestTerminalOutput: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("../../condense", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>
	return {
		...actual,
		summarizeConversation: vi.fn().mockResolvedValue({
			messages: [{ role: "user", content: [{ type: "text", text: "continued" }], ts: Date.now() }],
			summary: "summary",
			cost: 0,
			newContextTokens: 1,
		}),
	}
})

vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
	getSettingsDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockReturnValue(false),
}))

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("Task persistence", () => {
	let mockProvider: ClineProvider & Record<string, any>
	let mockApiConfig: ProviderSettings
	let mockOutputChannel: vscode.OutputChannel
	let mockExtensionContext: vscode.ExtensionContext

	beforeEach(() => {
		vi.clearAllMocks()

		const storageUri = { fsPath: path.join(os.tmpdir(), "test-storage") }

		mockExtensionContext = {
			globalState: {
				get: vi.fn().mockImplementation((_key: keyof GlobalState) => undefined),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: storageUri,
			workspaceState: {
				get: vi.fn().mockImplementation((_key) => undefined),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn().mockImplementation((_key) => Promise.resolve(undefined)),
				store: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				delete: vi.fn().mockImplementation((_key) => Promise.resolve()),
			},
			extensionUri: { fsPath: "/mock/extension/path" },
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			append: vi.fn(),
			clear: vi.fn(),
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockProvider = new ClineProvider(
			mockExtensionContext,
			mockOutputChannel,
			"sidebar",
			new ContextProxy(mockExtensionContext),
		) as ClineProvider & Record<string, any>

		mockApiConfig = {
			apiProvider: "anthropic",
			apiModelId: "claude-3-5-sonnet-20241022",
			apiKey: "test-api-key",
		}

		mockProvider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
		mockProvider.updateTaskHistory = vi.fn().mockResolvedValue(undefined)
	})

	// ── saveApiConversationHistory (via retrySaveApiConversationHistory) ──

	describe("saveApiConversationHistory", () => {
		it("returns true on success", async () => {
			mockSaveApiMessages.mockResolvedValueOnce(undefined)

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			task.apiConversationHistory.push({
				role: "user",
				content: [{ type: "text", text: "hello" }],
			})

			const result = await task.retrySaveApiConversationHistory()
			expect(result).toBe(true)
		})

		it("returns false on failure", async () => {
			vi.useFakeTimers()

			// All 3 retry attempts must fail for retrySaveApiConversationHistory to return false
			mockSaveApiMessages
				.mockRejectedValueOnce(new Error("fail 1"))
				.mockRejectedValueOnce(new Error("fail 2"))
				.mockRejectedValueOnce(new Error("fail 3"))

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			const promise = task.retrySaveApiConversationHistory()
			await vi.runAllTimersAsync()
			const result = await promise

			expect(result).toBe(false)
			expect(mockSaveApiMessages).toHaveBeenCalledTimes(3)

			vi.useRealTimers()
		})

		it("succeeds on 2nd retry attempt", async () => {
			vi.useFakeTimers()

			mockSaveApiMessages.mockRejectedValueOnce(new Error("fail 1")).mockResolvedValueOnce(undefined) // succeeds on 2nd try

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			const promise = task.retrySaveApiConversationHistory()
			await vi.runAllTimersAsync()
			const result = await promise

			expect(result).toBe(true)
			expect(mockSaveApiMessages).toHaveBeenCalledTimes(2)

			vi.useRealTimers()
		})

		it("snapshots the array before passing to saveApiMessages", async () => {
			mockSaveApiMessages.mockResolvedValueOnce(undefined)

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			const originalMsg = {
				role: "user" as const,
				content: [{ type: "text" as const, text: "snapshot test" }],
			}
			task.apiConversationHistory.push(originalMsg)

			await task.retrySaveApiConversationHistory()

			expect(mockSaveApiMessages).toHaveBeenCalledTimes(1)

			const callArgs = mockSaveApiMessages.mock.calls[0][0]
			// The messages passed should be a COPY, not the live reference
			expect(callArgs.messages).not.toBe(task.apiConversationHistory)
			// But the content should be the same
			expect(callArgs.messages).toEqual(task.apiConversationHistory)
		})
	})

	// ── saveClineMessages ────────────────────────────────────────────────

	describe("saveClineMessages", () => {
		it("returns true on success", async () => {
			mockSaveTaskMessages.mockResolvedValueOnce(undefined)

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			const result = await (task as Record<string, any>).saveClineMessages()
			expect(result).toBe(true)
		})

		it("returns false on failure", async () => {
			mockSaveTaskMessages.mockRejectedValueOnce(new Error("write error"))

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			const result = await (task as Record<string, any>).saveClineMessages()
			expect(result).toBe(false)
		})

		it("snapshots the array before passing to saveTaskMessages", async () => {
			mockSaveTaskMessages.mockResolvedValueOnce(undefined)

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			task.clineMessages.push({
				type: "say",
				say: "text",
				text: "snapshot test",
				ts: Date.now(),
			})

			await (task as Record<string, any>).saveClineMessages()

			expect(mockSaveTaskMessages).toHaveBeenCalledTimes(1)

			const callArgs = mockSaveTaskMessages.mock.calls[0][0]
			// The messages passed should be a COPY, not the live reference
			expect(callArgs.messages).not.toBe(task.clineMessages)
			// But the content should be the same
			expect(callArgs.messages).toEqual(task.clineMessages)
		})

		it("serializes concurrent saves to avoid overlapping ui_messages writes", async () => {
			let inFlight = 0
			let maxInFlight = 0
			let releaseFirstSave!: () => void
			const firstSaveBlocked = new Promise<void>((resolve) => {
				releaseFirstSave = resolve
			})

			mockSaveTaskMessages.mockImplementation(async () => {
				inFlight += 1
				maxInFlight = Math.max(maxInFlight, inFlight)

				try {
					if (mockSaveTaskMessages.mock.calls.length === 1) {
						await firstSaveBlocked
					}
				} finally {
					inFlight -= 1
				}
			})

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			task.clineMessages.push({
				type: "say",
				say: "text",
				text: "serialize saves",
				ts: Date.now(),
			})

			const firstSave = (task as Record<string, any>).saveClineMessages()
			const secondSave = (task as Record<string, any>).saveClineMessages()

			await vi.waitFor(() => expect(mockSaveTaskMessages).toHaveBeenCalledTimes(1))
			expect(maxInFlight).toBe(1)

			releaseFirstSave()
			await expect(Promise.all([firstSave, secondSave])).resolves.toEqual([true, true])

			expect(mockSaveTaskMessages).toHaveBeenCalledTimes(2)
			expect(maxInFlight).toBe(1)
		})
	})

	describe("image generation message updates", () => {
		it("coalesces an image-generation approval row into a persisted say/tool update", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})
			vi.mocked(mockProvider.postMessageToWebview).mockClear()
			mockSaveTaskMessages.mockClear()

			const pendingMetadata: GeneratedImageMetadata = {
				status: "pending",
				prompt: "Draw a fox",
				path: "images/fox.png",
			}
			const approvalTool: ClineSayTool = {
				tool: "generateImage",
				path: "images/fox.png",
				content: "Draw a fox",
				imageGeneration: pendingMetadata,
			}

			task.clineMessages.push({
				type: "ask",
				ask: "tool",
				ts: 123,
				text: JSON.stringify(approvalTool),
			})

			const completedMetadata: GeneratedImageMetadata = {
				status: "completed",
				prompt: "Draw a fox",
				originalPrompt: "Draw a fox",
				outputPath: "images/fox.png",
				usage: { cost: 0.01, currency: "USD" },
			}

			const didUpdate = await task.updateImageGenerationMessage({
				metadata: completedMetadata,
				path: "images/fox.png",
				content: "Draw a fox",
				imageUri: "vscode-resource://fox.png?t=1",
				imagePath: "/mock/workspace/path/images/fox.png",
			})

			expect(didUpdate).toBe(true)
			expect(task.clineMessages).toHaveLength(1)
			const updatedMessage = task.clineMessages[0]
			expect(updatedMessage).toMatchObject({
				type: "say",
				say: "tool",
				ts: 123,
				isAnswered: true,
			})
			expect(updatedMessage.ask).toBeUndefined()

			const updatedTool = JSON.parse(updatedMessage.text!) as ClineSayTool
			expect(updatedTool).toMatchObject({
				tool: "generateImage",
				path: "images/fox.png",
				content: "Draw a fox",
				imageUri: "vscode-resource://fox.png?t=1",
				imagePath: "/mock/workspace/path/images/fox.png",
				imageGeneration: expect.objectContaining({
					status: "completed",
					outputPath: "images/fox.png",
				}),
			})
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "messageUpdated",
					clineMessage: updatedMessage,
				}),
			)
			expect(mockSaveTaskMessages).toHaveBeenCalledTimes(1)
		})

		it("returns false without persisting when there is no image-generation row to update", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})
			vi.mocked(mockProvider.postMessageToWebview).mockClear()
			mockSaveTaskMessages.mockClear()

			task.clineMessages.push({
				type: "say",
				say: "text",
				text: "ordinary message",
				ts: 456,
			})

			const didUpdate = await task.updateImageGenerationMessage({
				metadata: {
					status: "running",
					prompt: "Draw a fox",
				},
			})

			expect(didUpdate).toBe(false)
			expect(task.clineMessages[0]).toMatchObject({
				type: "say",
				say: "text",
				text: "ordinary message",
			})
			expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
			expect(mockSaveTaskMessages).not.toHaveBeenCalled()
		})
	})

	describe("visual browser inspector message updates", () => {
		it("coalesces a running VBI row into a persisted say/tool update by toolCallId", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})
			vi.mocked(mockProvider.postMessageToWebview).mockClear()
			mockSaveTaskMessages.mockClear()

			const runningTool: ClineSayTool = {
				tool: "visualBrowserInspector",
				action: "visual_browser_capture",
				visualBrowserStatus: "running",
				sessionId: "session-1",
				toolCallId: "tool-call-1",
			}

			task.clineMessages.push({
				type: "ask",
				ask: "tool",
				ts: 789,
				text: JSON.stringify(runningTool),
			})

			const visualBrowserResult = {
				action: "visual_browser_capture",
				session: { sessionId: "session-1", status: "active", url: "http://localhost:3000" },
				message: "Captured screenshot.",
			} as any

			const didUpdate = await task.updateVisualBrowserInspectorMessage({
				tool: "visualBrowserInspector",
				action: "visual_browser_capture",
				visualBrowserStatus: "complete",
				visualBrowserResult,
				sessionId: "session-1",
				url: "http://localhost:3000",
				screenshotId: "shot-1",
				toolCallId: "tool-call-1",
				message: "Captured screenshot.",
			})

			expect(didUpdate).toBe(true)
			expect(task.clineMessages).toHaveLength(1)
			const updatedMessage = task.clineMessages[0]
			expect(updatedMessage).toMatchObject({
				type: "say",
				say: "tool",
				ts: 789,
				isAnswered: true,
			})
			expect(updatedMessage.ask).toBeUndefined()

			const updatedTool = JSON.parse(updatedMessage.text!) as ClineSayTool
			expect(updatedTool).toMatchObject({
				tool: "visualBrowserInspector",
				action: "visual_browser_capture",
				visualBrowserStatus: "complete",
				visualBrowserResult,
				sessionId: "session-1",
				url: "http://localhost:3000",
				screenshotId: "shot-1",
				toolCallId: "tool-call-1",
				message: "Captured screenshot.",
			})
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "messageUpdated",
					clineMessage: updatedMessage,
				}),
			)
			expect(mockSaveTaskMessages).toHaveBeenCalledTimes(1)
		})

		it("updates the latest running VBI row when completed payload has no toolCallId", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})
			vi.mocked(mockProvider.postMessageToWebview).mockClear()
			mockSaveTaskMessages.mockClear()

			task.clineMessages.push(
				{
					type: "ask",
					ask: "tool",
					ts: 1,
					text: JSON.stringify({
						tool: "visualBrowserInspector",
						visualBrowserStatus: "complete",
						message: "Older completed row.",
					} satisfies ClineSayTool),
				},
				{
					type: "ask",
					ask: "tool",
					ts: 2,
					text: JSON.stringify({
						tool: "visualBrowserInspector",
						action: "visual_browser_open",
						visualBrowserStatus: "running",
						sessionId: "session-2",
					} satisfies ClineSayTool),
				},
			)

			const didUpdate = await task.updateVisualBrowserInspectorMessage({
				tool: "visualBrowserInspector",
				action: "visual_browser_open",
				visualBrowserStatus: "complete",
				sessionId: "session-2",
				message: "Opened local preview.",
			})

			expect(didUpdate).toBe(true)
			expect(task.clineMessages[0].type).toBe("ask")
			const updatedMessage = task.clineMessages[1]
			expect(updatedMessage).toMatchObject({
				type: "say",
				say: "tool",
				ts: 2,
				isAnswered: true,
			})
			const updatedTool = JSON.parse(updatedMessage.text!) as ClineSayTool
			expect(updatedTool).toMatchObject({
				tool: "visualBrowserInspector",
				visualBrowserStatus: "complete",
				sessionId: "session-2",
				message: "Opened local preview.",
			})
			expect(mockSaveTaskMessages).toHaveBeenCalledTimes(1)
		})

		it("returns false without persisting when there is no VBI row to update", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})
			vi.mocked(mockProvider.postMessageToWebview).mockClear()
			mockSaveTaskMessages.mockClear()

			task.clineMessages.push({
				type: "say",
				say: "text",
				text: "ordinary message",
				ts: 456,
			})

			const didUpdate = await task.updateVisualBrowserInspectorMessage({
				tool: "visualBrowserInspector",
				action: "visual_browser_capture",
				visualBrowserStatus: "complete",
				toolCallId: "missing-tool-call",
			})

			expect(didUpdate).toBe(false)
			expect(task.clineMessages[0]).toMatchObject({
				type: "say",
				say: "text",
				text: "ordinary message",
			})
			expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
			expect(mockSaveTaskMessages).not.toHaveBeenCalled()
		})
	})

	describe("parallel agent reload recovery", () => {
		const createPlan = (): ExecutionPlan => ({
			planId: "plan-1",
			sharedContext: "shared",
			sharedContract: "",
			fileOwnershipMap: { "src/a.ts": "agent-a" },
			createdAt: 1,
			agents: [
				{
					id: "agent-a",
					mode: "code",
					task: "Build A",
					owns: [{ path: "src/a.ts", mode: "exclusive" }],
					mustNotTouch: [],
					dependsOn: [],
					worktreePath: "",
					status: "complete",
					signals: [],
				},
				{
					id: "agent-b",
					mode: "code",
					task: "Build B",
					owns: [],
					mustNotTouch: [],
					dependsOn: [],
					worktreePath: "",
					status: "running",
					signals: [],
				},
			],
		})

		it("marks persisted running parallel agent rows as interrupted while preserving review rows", async () => {
			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})
			const plan = createPlan()
			const runningTool: ClineSayTool = {
				tool: "parallelAgents",
				executionPlan: plan,
				parallelStatus: "running",
				agentStatusUpdates: [
					{ agentId: "agent-a", status: "complete", reason: "done" },
					{ agentId: "agent-b", status: "running" },
				],
				agentActivities: [{ agentId: "agent-b", kind: "status", message: "Started running.", ts: 1 }],
			}
			const reviewTool: ClineSayTool = {
				tool: "parallelAgents",
				executionPlan: { ...plan, planId: "plan-review" },
				parallelStatus: "review",
				mergeReviewEntries: [
					{
						agentId: "agent-a",
						mode: "code",
						task: "Build A",
						diff: "diff --git a/src/a.ts b/src/a.ts",
						worktreePath: "worktree-a",
						branch: "parallel/agent-a",
					},
				],
			}

			const messages: ClineMessage[] = [
				{ type: "say", say: "tool", text: JSON.stringify(runningTool), ts: 1 },
				{ type: "say", say: "tool", text: JSON.stringify(reviewTool), ts: 2 },
			]

			expect((task as Record<string, any>).markInterruptedParallelAgentMessages(messages)).toBe(true)

			const interrupted = JSON.parse(messages[0].text!) as ClineSayTool
			const preservedReview = JSON.parse(messages[1].text!) as ClineSayTool

			expect(interrupted.parallelStatus).toBe("failed")
			expect(interrupted.agentStatusUpdates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ agentId: "agent-a", status: "complete" }),
					expect.objectContaining({
						agentId: "agent-b",
						status: "failed",
						reason: "Parallel execution was interrupted before it could be resumed.",
					}),
				]),
			)
			expect(interrupted.agentActivities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						agentId: "agent-b",
						kind: "error",
						message: "Parallel execution was interrupted before it could be resumed.",
					}),
				]),
			)
			expect(preservedReview.parallelStatus).toBe("review")
			expect(preservedReview.mergeReviewEntries).toEqual(reviewTool.mergeReviewEntries)
		})
	})

	// ── flushPendingToolResultsToHistory — save failure/success ───────────

	describe("flushPendingToolResultsToHistory persistence", () => {
		it("retains userMessageContent on save failure", async () => {
			mockSaveApiMessages.mockRejectedValueOnce(new Error("disk full"))

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			// Skip waiting for assistant message
			task.assistantMessageSavedToHistory = true

			task.userMessageContent = [
				{
					type: "tool_result",
					tool_use_id: "tool-fail",
					content: "Result that should be retained",
				},
			]

			const saved = await task.flushPendingToolResultsToHistory()

			expect(saved).toBe(false)
			// userMessageContent should NOT be cleared on failure
			expect(task.userMessageContent.length).toBeGreaterThan(0)
			expect(task.userMessageContent[0]).toMatchObject({
				type: "tool_result",
				tool_use_id: "tool-fail",
			})
		})

		it("clears userMessageContent on save success", async () => {
			mockSaveApiMessages.mockResolvedValueOnce(undefined)

			const task = new Task({
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			// Skip waiting for assistant message
			task.assistantMessageSavedToHistory = true

			task.userMessageContent = [
				{
					type: "tool_result",
					tool_use_id: "tool-ok",
					content: "Result that should be cleared",
				},
			]

			const saved = await task.flushPendingToolResultsToHistory()

			expect(saved).toBe(true)
			// userMessageContent should be cleared on success
			expect(task.userMessageContent).toEqual([])
		})
	})
})

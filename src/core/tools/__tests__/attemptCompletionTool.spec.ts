import { RooCodeEventName, TodoItem } from "@roo-code/types"

import { AttemptCompletionToolUse } from "../../../shared/tools"

// Mock the formatResponse module before importing the tool
vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Error: ${msg}`),
		toolResult: vi.fn((msg: string) => `Result: ${msg}`),
		toolDenied: vi.fn(() => "Denied"),
	},
}))

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
		})),
	},
}))

// Mock Package module
vi.mock("../../../shared/package", () => ({
	Package: {
		name: "roo-cline",
	},
}))

import { attemptCompletionTool, AttemptCompletionCallbacks } from "../AttemptCompletionTool"
import { verifyCompletionAgainstTask } from "../AttemptCompletionTool"
import { Task } from "../../task/Task"
import * as vscode from "vscode"

describe("attemptCompletionTool", () => {
	let mockTask: Partial<Task>
	let mockPushToolResult: ReturnType<typeof vi.fn>
	let mockAskApproval: ReturnType<typeof vi.fn>
	let mockHandleError: ReturnType<typeof vi.fn>
	let mockToolDescription: ReturnType<typeof vi.fn>
	let mockAskFinishSubTaskApproval: ReturnType<typeof vi.fn>
	let mockGetConfiguration: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockPushToolResult = vi.fn()
		mockAskApproval = vi.fn()
		mockHandleError = vi.fn()
		mockToolDescription = vi.fn()
		mockAskFinishSubTaskApproval = vi.fn()
		mockGetConfiguration = vi.fn(() => ({
			get: vi.fn((key: string, defaultValue: any) => {
				if (key === "preventCompletionWithOpenTodos") {
					return defaultValue // Default to false unless overridden in test
				}
				if (key === "enableCompletionVerification") {
					return false // Default to false for existing tests; verification tests override to true
				}
				return defaultValue
			}),
		}))

		// Setup vscode mock
		vi.mocked(vscode.workspace.getConfiguration).mockImplementation(mockGetConfiguration)

		mockTask = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			todoList: undefined,
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] }),
			cleanupControlledBrowserSessions: vi.fn().mockResolvedValue(undefined),
			emitFinalTokenUsageUpdate: vi.fn(),
			emit: vi.fn(),
			getTokenUsage: vi.fn().mockReturnValue({}),
			markAgentTerminal: vi.fn(),
			cancelCurrentRequest: vi.fn(),
			toolUsage: {},
			taskId: "task_1",
			metadata: { task: "Fix the login bug and update the documentation" },
			apiConfiguration: { apiProvider: "test" } as any,
			api: { getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }) } as any,
			getAgentCompletionCoordinationGate: vi.fn(() => ({
				approved: true,
				blockers: [],
				unanswerableQuestions: [],
			})),
		}
	})

	describe("todo list validation", () => {
		it("should allow completion when there is no todo list", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			mockTask.todoList = undefined

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should not call pushToolResult with an error for empty todo list
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
		})

		it("should allow completion when todo list is empty", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			mockTask.todoList = []

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
		})

		it("should allow completion when all todos are completed", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const completedTodos: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "completed" },
			]

			mockTask.todoList = completedTodos

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
		})

		it("should prevent completion when there are pending todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithPending: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
			]

			mockTask.todoList = todosWithPending

			// Enable the setting to prevent completion with open todos
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should prevent completion when there are in-progress todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithInProgress: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "in_progress" },
			]

			mockTask.todoList = todosWithInProgress

			// Enable the setting to prevent completion with open todos
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should prevent completion when there are mixed incomplete todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const mixedTodos: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
				{ id: "3", content: "Third task", status: "in_progress" },
			]

			mockTask.todoList = mixedTodos

			// Enable the setting to prevent completion with open todos
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should allow completion when setting is disabled even with incomplete todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithPending: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
			]

			mockTask.todoList = todosWithPending

			// Ensure the setting is disabled (default behavior)
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return false // Setting is disabled
					}
					if (key === "enableCompletionVerification") {
						return false
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should not prevent completion when setting is disabled
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should prevent completion when setting is enabled with incomplete todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithPending: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
			]

			mockTask.todoList = todosWithPending

			// Enable the setting
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should prevent completion when setting is enabled and there are incomplete todos
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should allow completion when setting is enabled but all todos are completed", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const completedTodos: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "completed" },
			]

			mockTask.todoList = completedTodos

			// Enable the setting
			mockGetConfiguration.mockReturnValue({
				get: vi.fn((key: string, defaultValue: any) => {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					if (key === "enableCompletionVerification") {
						return false
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should allow completion when setting is enabled but all todos are completed
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		describe("tool failure guardrail", () => {
			it("should prevent completion when a previous tool failed in the current turn", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Task completed successfully" },
					nativeArgs: { result: "Task completed successfully" },
					partial: false,
				}

				mockTask.todoList = undefined
				mockTask.didToolFailInCurrentTurn = true

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				const mockSay = vi.fn()
				mockTask.say = mockSay

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockSay).toHaveBeenCalledWith(
					"error",
					expect.stringContaining("errors.attempt_completion_tool_failed"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("errors.attempt_completion_tool_failed"),
				)
			})

			it("swallows aborted task say failures when a previous tool failed", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Task completed successfully" },
					nativeArgs: { result: "Task completed successfully" },
					partial: false,
				}

				mockTask.todoList = undefined
				mockTask.didToolFailInCurrentTurn = true
				mockTask.abort = true
				Object.defineProperty(mockTask, "instanceId", { value: "instance_1", configurable: true })
				mockTask.say = vi.fn().mockRejectedValue(new Error("[RooCode#say] task task_1.instance_1 aborted"))

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await expect(attemptCompletionTool.handle(mockTask as Task, block, callbacks)).resolves.toBeUndefined()
				expect(mockHandleError).not.toHaveBeenCalled()
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("errors.attempt_completion_tool_failed"),
				)
			})

			it("should allow completion when no tools failed", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Task completed successfully" },
					nativeArgs: { result: "Task completed successfully" },
					partial: false,
				}

				mockTask.todoList = undefined
				mockTask.didToolFailInCurrentTurn = false

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.consecutiveMistakeCount).toBe(0)
				expect(mockTask.recordToolError).not.toHaveBeenCalled()
			})
		})

		describe("completion lifecycle", () => {
			it("emits TaskCompleted only when completion is accepted", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "2" },
					nativeArgs: { result: "2" },
					partial: false,
				}

				mockTask.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] })

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockHandleError).not.toHaveBeenCalled()
				const cleanupControlledBrowserSessions = mockTask.cleanupControlledBrowserSessions as ReturnType<
					typeof vi.fn
				>
				const emit = mockTask.emit as ReturnType<typeof vi.fn>
				const emitFinalTokenUsageUpdate = mockTask.emitFinalTokenUsageUpdate as ReturnType<typeof vi.fn>
				expect(cleanupControlledBrowserSessions).toHaveBeenCalledWith("task completion")
				expect(cleanupControlledBrowserSessions.mock.invocationCallOrder[0]).toBeLessThan(
					emit.mock.invocationCallOrder[0],
				)
				expect(cleanupControlledBrowserSessions.mock.invocationCallOrder[0]).toBeLessThan(
					emitFinalTokenUsageUpdate.mock.invocationCallOrder[0],
				)
				expect(mockTask.emit).toHaveBeenCalledWith(
					RooCodeEventName.TaskCompleted,
					"task_1",
					expect.anything(),
					expect.anything(),
				)
			})

			it("blocks parallel agent completion while live coordination questions are unresolved", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Agent finished" },
					nativeArgs: { result: "Agent finished" },
					partial: false,
				}
				const parallelTask = mockTask as any
				parallelTask.parentTaskId = "parent-task"
				parallelTask.agentId = "ui-agent"
				parallelTask.agentBus = {} as any
				parallelTask.getAgentCompletionCoordinationGate = vi.fn(() => ({
					approved: false,
					blockers: [
						{
							type: "incoming-question",
							question: {
								id: "coord-open",
								agentId: "styles-agent",
								targetAgentId: "ui-agent",
								kind: "question",
								message: "Which selector should styles target?",
								ts: 1,
							},
						},
					],
					unanswerableQuestions: [],
				}))

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(parallelTask.getAgentCompletionCoordinationGate).toHaveBeenCalledWith({ recordAttempt: true })
				expect(mockTask.say).not.toHaveBeenCalledWith("completion_result", expect.anything(), undefined, false)
				expect(mockTask.emit).not.toHaveBeenCalledWith(
					RooCodeEventName.TaskCompleted,
					expect.anything(),
					expect.anything(),
					expect.anything(),
				)
				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					"Open parallel-agent coordination questions are unresolved.",
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining(
						"Cannot complete yet because live parallel-agent coordination is unresolved.",
					),
				)
			})

			it("blocks parallel agent completion until a shared contract is acknowledged", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Agent finished" },
					nativeArgs: { result: "Agent finished" },
					partial: false,
				}
				const parallelTask = mockTask as any
				parallelTask.parentTaskId = "parent-task"
				parallelTask.agentId = "ui-agent"
				parallelTask.agentBus = {} as any
				parallelTask.getAgentCompletionCoordinationGate = vi.fn(() => ({
					approved: false,
					blockers: [
						{
							type: "shared-contract-unacknowledged",
							sharedContract:
								"Use #dashboard-root, data-testid=dashboard-root, and .dashboard-card for cards.",
						},
					],
					unanswerableQuestions: [],
				}))

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				} as AttemptCompletionCallbacks

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(parallelTask.getAgentCompletionCoordinationGate).toHaveBeenCalledWith({ recordAttempt: true })
				expect(mockTask.say).not.toHaveBeenCalledWith("completion_result", expect.anything(), undefined, false)
				expect(mockTask.emit).not.toHaveBeenCalledWith(
					RooCodeEventName.TaskCompleted,
					expect.anything(),
					expect.anything(),
					expect.anything(),
				)
				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					"Open parallel-agent coordination questions are unresolved.",
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("Shared contract acknowledgement is required before completion:"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining(
						"Apply and acknowledge shared contract: Use #dashboard-root, data-testid=dashboard-root, and .dashboard-card for cards.",
					),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("coordinate_agents with action='acknowledge_contract'"),
				)
			})

			it("lets parallel agent children complete without visible approval or Boomerang delegation", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Agent finished" },
					nativeArgs: { result: "Agent finished" },
					partial: false,
				}
				const provider = {
					getTaskWithId: vi.fn().mockResolvedValue({ historyItem: { status: undefined } }),
					reopenParentFromDelegation: vi.fn(),
				}
				const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

				const parallelTask = mockTask as any
				parallelTask.parentTaskId = "parent-task"
				parallelTask.agentId = "ui-agent"
				parallelTask.agentBus = {} as any
				parallelTask.providerRef = { deref: () => provider } as any
				parallelTask.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] })

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				try {
					await attemptCompletionTool.handle(mockTask as Task, block, callbacks)
				} finally {
					consoleError.mockRestore()
				}

				expect(provider.getTaskWithId).not.toHaveBeenCalled()
				expect(parallelTask.ask).not.toHaveBeenCalled()
				expect(mockAskFinishSubTaskApproval).not.toHaveBeenCalled()
				expect(provider.reopenParentFromDelegation).not.toHaveBeenCalled()
				expect(consoleError).not.toHaveBeenCalled()
				expect(parallelTask.markAgentTerminal).toHaveBeenCalledTimes(1)
				expect(parallelTask.cancelCurrentRequest).toHaveBeenCalledTimes(1)
				expect(parallelTask.cleanupControlledBrowserSessions).toHaveBeenCalledWith("task completion")
				expect(parallelTask.cleanupControlledBrowserSessions.mock.invocationCallOrder[0]).toBeLessThan(
					parallelTask.emit.mock.invocationCallOrder[0],
				)
				expect(mockTask.emit).toHaveBeenCalledWith(
					RooCodeEventName.TaskCompleted,
					"task_1",
					expect.anything(),
					expect.anything(),
				)
			})

			it("does not emit TaskCompleted when user provides follow-up feedback", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "2" },
					nativeArgs: { result: "2" },
					partial: false,
				}

				mockTask.ask = vi.fn().mockResolvedValue({
					response: "messageResponse",
					text: "Different question now: what is 3+3?",
					images: [],
				})

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockHandleError).not.toHaveBeenCalled()
				expect(mockTask.emit).not.toHaveBeenCalledWith(
					RooCodeEventName.TaskCompleted,
					expect.anything(),
					expect.anything(),
					expect.anything(),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("<user_message>"))
			})

			describe("completion verification", () => {
				it("should block completion when result is too brief", async () => {
					const block: AttemptCompletionToolUse = {
						type: "tool_use",
						name: "attempt_completion",
						params: { result: "Done" },
						nativeArgs: { result: "Done" },
						partial: false,
					}

					;(mockTask as any).metadata = {
						task: "Create a full-stack application with authentication, database, and REST API endpoints",
					}
					mockGetConfiguration.mockReturnValue({
						get: vi.fn((key: string, defaultValue: any) => {
							if (key === "enableCompletionVerification") {
								return true
							}
							return defaultValue
						}),
					})

					const callbacks: AttemptCompletionCallbacks = {
						askApproval: mockAskApproval,
						handleError: mockHandleError,
						pushToolResult: mockPushToolResult,
						askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
						toolDescription: mockToolDescription,
					}

					await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

					expect(mockTask.consecutiveMistakeCount).toBe(1)
					expect(mockTask.recordToolError).toHaveBeenCalledWith(
						"attempt_completion",
						"Completion verification failed.",
					)
					expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("too brief"))
				})

				it("should block completion when result doesn't address the original task", async () => {
					const block: AttemptCompletionToolUse = {
						type: "tool_use",
						name: "attempt_completion",
						params: {
							result: "I have successfully updated the configuration file with the new settings for the application.",
						},
						nativeArgs: {
							result: "I have successfully updated the configuration file with the new settings for the application.",
						},
						partial: false,
					}

					;(mockTask as any).metadata = {
						task: "Refactor the authentication module to use OAuth2 and add comprehensive unit tests for the payment processing pipeline",
					}
					mockGetConfiguration.mockReturnValue({
						get: vi.fn((key: string, defaultValue: any) => {
							if (key === "enableCompletionVerification") {
								return true
							}
							return defaultValue
						}),
					})

					const callbacks: AttemptCompletionCallbacks = {
						askApproval: mockAskApproval,
						handleError: mockHandleError,
						pushToolResult: mockPushToolResult,
						askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
						toolDescription: mockToolDescription,
					}

					await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

					expect(mockTask.consecutiveMistakeCount).toBe(1)
					expect(mockTask.recordToolError).toHaveBeenCalledWith(
						"attempt_completion",
						"Completion verification failed.",
					)
					expect(mockPushToolResult).toHaveBeenCalledWith(
						expect.stringContaining("does not appear to address"),
					)
				})

				it("should allow completion when result addresses the original task", async () => {
					const block: AttemptCompletionToolUse = {
						type: "tool_use",
						name: "attempt_completion",
						params: {
							result: "I have refactored the authentication module to use OAuth2 and added comprehensive unit tests for the payment processing pipeline.",
						},
						nativeArgs: {
							result: "I have refactored the authentication module to use OAuth2 and added comprehensive unit tests for the payment processing pipeline.",
						},
						partial: false,
					}

					;(mockTask as any).metadata = {
						task: "Refactor the authentication module to use OAuth2 and add comprehensive unit tests for the payment processing pipeline",
					}
					mockGetConfiguration.mockReturnValue({
						get: vi.fn((key: string, defaultValue: any) => {
							if (key === "enableCompletionVerification") {
								return true
							}
							return defaultValue
						}),
					})

					const callbacks: AttemptCompletionCallbacks = {
						askApproval: mockAskApproval,
						handleError: mockHandleError,
						pushToolResult: mockPushToolResult,
						askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
						toolDescription: mockToolDescription,
					}

					await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

					expect(mockTask.consecutiveMistakeCount).toBe(0)
					expect(mockTask.recordToolError).not.toHaveBeenCalled()
				})

				it("should skip verification when enableCompletionVerification is disabled", async () => {
					const block: AttemptCompletionToolUse = {
						type: "tool_use",
						name: "attempt_completion",
						params: { result: "Done" },
						nativeArgs: { result: "Done" },
						partial: false,
					}

					;(mockTask as any).metadata = {
						task: "Create a full-stack application with authentication, database, and REST API endpoints",
					}
					mockGetConfiguration.mockReturnValue({
						get: vi.fn((key: string, defaultValue: any) => {
							if (key === "enableCompletionVerification") {
								return true
							}
							return defaultValue
						}),
					})

					mockGetConfiguration.mockReturnValue({
						get: vi.fn((key: string, defaultValue: any) => {
							if (key === "enableCompletionVerification") {
								return false
							}
							return defaultValue
						}),
					})

					const callbacks: AttemptCompletionCallbacks = {
						askApproval: mockAskApproval,
						handleError: mockHandleError,
						pushToolResult: mockPushToolResult,
						askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
						toolDescription: mockToolDescription,
					}

					await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

					expect(mockPushToolResult).not.toHaveBeenCalledWith(expect.stringContaining("too brief"))
				})

				it("should bypass verification after 3 consecutive failures", async () => {
					const block: AttemptCompletionToolUse = {
						type: "tool_use",
						name: "attempt_completion",
						params: { result: "Done" },
						nativeArgs: { result: "Done" },
						partial: false,
					}

					;(mockTask as any).metadata = {
						task: "Create a full-stack application with authentication, database, and REST API endpoints",
					}
					mockGetConfiguration.mockReturnValue({
						get: vi.fn((key: string, defaultValue: any) => {
							if (key === "enableCompletionVerification") {
								return true
							}
							return defaultValue
						}),
					})

					const callbacks: AttemptCompletionCallbacks = {
						askApproval: mockAskApproval,
						handleError: mockHandleError,
						pushToolResult: mockPushToolResult,
						askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
						toolDescription: mockToolDescription,
					}

					for (let i = 0; i < 3; i++) {
						await attemptCompletionTool.handle(mockTask as Task, block, callbacks)
						mockTask.consecutiveMistakeCount = 0
						mockPushToolResult.mockClear()
						mockTask.recordToolError = vi.fn()
					}

					mockPushToolResult.mockClear()
					mockTask.recordToolError = vi.fn()
					await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

					expect(mockPushToolResult).not.toHaveBeenCalledWith(expect.stringContaining("too brief"))
					expect(mockPushToolResult).not.toHaveBeenCalledWith(
						expect.stringContaining("does not appear to address"),
					)
				})

				it("should skip verification when original task is empty", async () => {
					const block: AttemptCompletionToolUse = {
						type: "tool_use",
						name: "attempt_completion",
						params: { result: "Done" },
						nativeArgs: { result: "Done" },
						partial: false,
					}

					;(mockTask as any).metadata = { task: "" }

					const callbacks: AttemptCompletionCallbacks = {
						askApproval: mockAskApproval,
						handleError: mockHandleError,
						pushToolResult: mockPushToolResult,
						askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
						toolDescription: mockToolDescription,
					}

					await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

					expect(mockTask.recordToolError).not.toHaveBeenCalledWith(
						"attempt_completion",
						"Completion verification failed.",
					)
				})

				it("should skip verification when original task is undefined", async () => {
					const block: AttemptCompletionToolUse = {
						type: "tool_use",
						name: "attempt_completion",
						params: { result: "Done" },
						nativeArgs: { result: "Done" },
						partial: false,
					}

					;(mockTask as any).metadata = {}

					const callbacks: AttemptCompletionCallbacks = {
						askApproval: mockAskApproval,
						handleError: mockHandleError,
						pushToolResult: mockPushToolResult,
						askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
						toolDescription: mockToolDescription,
					}

					await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

					expect(mockTask.recordToolError).not.toHaveBeenCalledWith(
						"attempt_completion",
						"Completion verification failed.",
					)
				})
			})

			describe("verifyCompletionAgainstTask (unit)", () => {
				it("should return undefined for empty original task", () => {
					expect(verifyCompletionAgainstTask("", "I completed the work.")).toBeUndefined()
				})

				it("should return undefined for very short original task", () => {
					expect(verifyCompletionAgainstTask("Hi", "Done.")).toBeUndefined()
				})

				it("should return error for very short result", () => {
					const error = verifyCompletionAgainstTask("Fix the login bug in the authentication system", "Done")
					expect(error).toBeDefined()
					expect(error).toContain("too brief")
				})

				it("should return error when result has no keyword overlap with task", () => {
					const error = verifyCompletionAgainstTask(
						"Implement OAuth2 authentication for the payment processing API with comprehensive unit tests",
						"I have successfully updated the configuration file with the new settings for the application deployment pipeline.",
					)
					expect(error).toBeDefined()
					expect(error).toContain("does not appear to address")
				})

				it("should return undefined when result has good keyword overlap", () => {
					const result = verifyCompletionAgainstTask(
						"Implement OAuth2 authentication for the payment processing API",
						"I have implemented OAuth2 authentication for the payment processing API with full test coverage.",
					)
					expect(result).toBeUndefined()
				})

				it("should return undefined when result has keyword overlap", () => {
					const result = verifyCompletionAgainstTask(
						"Fix the CSS styling on the homepage",
						"I have fixed the CSS styling on the homepage and everything looks great.",
					)
					expect(result).toBeUndefined()
				})
			})
		})
	})
})

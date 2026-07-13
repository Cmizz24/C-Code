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

import {
	attemptCompletionTool,
	AttemptCompletionCallbacks,
	verifyCompletionAgainstTask,
	verifyCompletion,
	extractRequirements,
	extractSignificantWords,
} from "../AttemptCompletionTool"
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
				const toolResult = mockPushToolResult.mock.calls[0][0] as string
				expect(toolResult).toContain("Cannot complete: unresolved parallel-agent coordination.")
				expect(toolResult).toContain("Answer incoming questions:")
				expect(toolResult).toContain("coordinate_agents action='publish' kind='answer' replyToId='coord-open'")
				expect(toolResult).toContain("Next: coordinate_agents action='read'")
				expect(toolResult).not.toContain(
					"Cannot complete yet because live parallel-agent coordination is unresolved.",
				)
				expect(toolResult.length).toBeLessThan(600)
			})

			it("blocks parallel agent completion while targeted outgoing questions are unresolved", async () => {
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
							type: "outgoing-question",
							question: {
								id: "coord-out",
								agentId: "ui-agent",
								targetAgentId: "styles-agent",
								kind: "question",
								message: "Can I change the dashboard selector?",
								relatedFiles: ["src/App.tsx"],
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
				const toolResult = mockPushToolResult.mock.calls[0][0] as string
				expect(toolResult).toContain("Cannot complete: unresolved parallel-agent coordination.")
				expect(toolResult).toContain("Wait or escalate targeted questions:")
				expect(toolResult).toContain(
					"waiting for answer to coord-out (from ui-agent, to styles-agent) [src/App.tsx]: Can I change the dashboard selector?",
				)
				expect(toolResult).toContain("wait for targeted replies or escalate")
				expect(toolResult).not.toContain("local assumption")
				expect(toolResult.length).toBeLessThan(450)
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
				const toolResult = mockPushToolResult.mock.calls[0][0] as string
				expect(toolResult).toContain("Cannot complete: unresolved parallel-agent coordination.")
				expect(toolResult).toContain("Acknowledge shared contract before retrying:")
				expect(toolResult).toContain(
					"coordinate_agents action='acknowledge_contract': Use #dashboard-root, data-testid=dashboard-root, and .dashboard-card for cards.",
				)
				expect(toolResult).not.toContain("Shared contract acknowledgement is required before completion:")
				expect(toolResult).not.toContain("Apply and acknowledge shared contract:")
				expect(toolResult.length).toBeLessThan(500)
			})

			it("blocks parallel agent completion while the runtime status is blocked", async () => {
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
					blockers: [{ type: "agent-blocked", status: "blocked" }],
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
				const toolResult = mockPushToolResult.mock.calls[0][0] as string
				expect(toolResult).toContain("Cannot complete: unresolved parallel-agent coordination.")
				expect(toolResult).toContain("Resolve current blocked agent status before retrying:")
				expect(toolResult).toContain("Current agent status is 'blocked'")
				expect(toolResult).toContain("resolve blocked status")
				expect(toolResult.length).toBeLessThan(450)
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

	describe("extractSignificantWords", () => {
		it("should filter out stop words and short words", () => {
			const words = extractSignificantWords("The quick brown fox jumps over the lazy dog")
			expect(words.has("the")).toBe(false) // stop word
			expect(words.has("over")).toBe(false) // stop word
			expect(words.has("quick")).toBe(true)
			expect(words.has("brown")).toBe(true)
			expect(words.has("fox")).toBe(true)
			expect(words.has("jumps")).toBe(true)
			expect(words.has("lazy")).toBe(true)
			expect(words.has("dog")).toBe(true)
		})

		it("should handle punctuation and mixed case", () => {
			const words = extractSignificantWords("Hello, World! This IS a Test.")
			expect(words.has("hello")).toBe(true)
			expect(words.has("world")).toBe(true)
			expect(words.has("test")).toBe(true)
			expect(words.has("this")).toBe(false) // stop word
		})

		it("should return empty set for stop-word-only text", () => {
			const words = extractSignificantWords("the a an is are")
			expect(words.size).toBe(0)
		})
	})

	describe("extractRequirements", () => {
		it("should return empty array for very short text", () => {
			const reqs = extractRequirements("Hi")
			expect(reqs).toEqual([])
		})

		it("should extract a single requirement from unstructured text", () => {
			const reqs = extractRequirements("Fix the login bug in the authentication system")
			expect(reqs.length).toBe(1)
			expect(reqs[0].text).toBe("Fix the login bug in the authentication system")
		})

		it("should extract numbered list requirements", () => {
			const task =
				"Please complete these tasks:\n1. Fix the login bug\n2. Update the documentation\n3. Add unit tests"
			const reqs = extractRequirements(task)
			expect(reqs.length).toBe(3)
			expect(reqs[0].text).toContain("Fix the login bug")
			expect(reqs[1].text).toContain("Update the documentation")
			expect(reqs[2].text).toContain("Add unit tests")
		})

		it("should extract bullet-point requirements", () => {
			const task = "Requirements:\n- Fix the login bug\n- Update the documentation\n- Add unit tests"
			const reqs = extractRequirements(task)
			expect(reqs.length).toBe(3)
			expect(reqs[0].text).toContain("Fix the login bug")
			expect(reqs[1].text).toContain("Update the documentation")
			expect(reqs[2].text).toContain("Add unit tests")
		})

		it("should extract requirements split by 'and'", () => {
			const task = "Fix the login bug and add comprehensive unit tests for the payment system"
			const reqs = extractRequirements(task)
			expect(reqs.length).toBe(2)
			expect(reqs[0].text).toContain("Fix the login bug")
			expect(reqs[1].text).toContain("comprehensive unit tests")
		})

		it("should extract requirements split by 'also'", () => {
			const task = "Update the database schema also refactor the authentication module"
			const reqs = extractRequirements(task)
			expect(reqs.length).toBe(2)
		})

		it("should extract requirements split by 'additionally'", () => {
			const task = "Create the API endpoint additionally add error handling for invalid requests"
			const reqs = extractRequirements(task)
			expect(reqs.length).toBe(2)
		})

		it("should not split conjunctions when one segment is too short", () => {
			// "and" with one very short segment should not split
			const task = "Fix the login bug and the"
			const reqs = extractRequirements(task)
			expect(reqs.length).toBe(1)
		})

		it("should split on 'and' when both segments are substantial", () => {
			const task = "Fix the login and the dashboard layout"
			const reqs = extractRequirements(task)
			expect(reqs.length).toBe(2)
		})
	})

	describe("verifyCompletion (structured)", () => {
		it("should return no error and completed requirements for well-addressed multi-requirement task", () => {
			const task = "Fix the authentication bug and add unit tests for the payment module"
			const result =
				"I have fixed the authentication bug in the login flow and added comprehensive unit tests for the payment module."
			const verification = verifyCompletion(task, result)
			expect(verification.error).toBeUndefined()
			expect(verification.requirements.length).toBe(2)
			expect(verification.requirementsCompleted.length).toBe(2)
		})

		it("should return specific error listing unmet requirements", () => {
			const task = "Fix the authentication bug and add unit tests for the payment module"
			const result = "I have fixed the authentication bug in the login flow. Everything is working correctly now."
			const verification = verifyCompletion(task, result)
			expect(verification.error).toBeDefined()
			expect(verification.error).toContain("not clearly addressed")
			expect(verification.requirements.length).toBe(2)
			expect(verification.requirementsCompleted.length).toBe(1)
		})

		it("should handle numbered list requirements", () => {
			const task =
				"Complete the following:\n1. Fix the authentication bug\n2. Update the documentation\n3. Add unit tests"
			const result =
				"I fixed the authentication bug and updated the documentation. The unit tests have also been added with full coverage."
			const verification = verifyCompletion(task, result)
			expect(verification.error).toBeUndefined()
			expect(verification.requirements.length).toBe(3)
			expect(verification.requirementsCompleted.length).toBe(3)
		})

		it("should flag missing requirements in numbered list", () => {
			const task =
				"Complete the following:\n1. Fix the authentication bug\n2. Update the documentation\n3. Add unit tests"
			const result = "I fixed the authentication bug and everything is working correctly now."
			const verification = verifyCompletion(task, result)
			expect(verification.error).toBeDefined()
			expect(verification.requirementsCompleted.length).toBeLessThan(3)
		})

		it("should return empty requirements for empty task", () => {
			const verification = verifyCompletion("", "Done with everything.")
			expect(verification.error).toBeUndefined()
			expect(verification.requirements.length).toBe(0)
			expect(verification.requirementsCompleted.length).toBe(0)
		})

		it("should return error for too-brief result with multiple requirements", () => {
			const task = "Fix the login bug and update the documentation"
			const verification = verifyCompletion(task, "Done")
			expect(verification.error).toBeDefined()
			expect(verification.error).toContain("too brief")
			expect(verification.requirements.length).toBeGreaterThan(0)
			expect(verification.requirementsCompleted.length).toBe(0)
		})

		it("should pass single-requirement task with good keyword overlap", () => {
			const task = "Fix the CSS styling on the homepage"
			const result = "I have fixed the CSS styling on the homepage and everything looks great."
			const verification = verifyCompletion(task, result)
			expect(verification.error).toBeUndefined()
			expect(verification.requirements.length).toBe(1)
			expect(verification.requirementsCompleted.length).toBe(1)
		})

		it("should fail single-requirement task with no keyword overlap", () => {
			const task =
				"Refactor the authentication module to use OAuth2 and add comprehensive unit tests for the payment processing pipeline"
			const result =
				"I have successfully updated the configuration file with the new settings for the application deployment pipeline."
			const verification = verifyCompletion(task, result)
			expect(verification.error).toBeDefined()
			expect(verification.error).toContain("does not appear to address")
		})

		it("should handle conjunction-split requirements where only some are met", () => {
			const task = "Create the REST API and add database migrations and write integration tests"
			const result =
				"I have created the REST API with full CRUD endpoints. The database migrations are also in place."
			const verification = verifyCompletion(task, result)
			expect(verification.requirements.length).toBe(3)
			// The result mentions "REST API" and "database migrations" but not "integration tests"
			const metCount = verification.requirementsCompleted.length
			expect(metCount).toBeLessThan(3)
		})

		it("should not be overly strict when most keywords match", () => {
			const task = "Implement user registration with email verification and password reset functionality"
			const result =
				"I implemented the user registration flow including email verification and password reset functionality. All features are tested and working."
			const verification = verifyCompletion(task, result)
			expect(verification.error).toBeUndefined()
		})

		it("should track requirementsCompleted indexes correctly", () => {
			const task = "Fix the authentication bug and update the documentation and write comprehensive tests"
			const result = "I fixed the authentication bug and added comprehensive tests for the module."
			const verification = verifyCompletion(task, result)
			// First requirement (authentication bug) and third (comprehensive tests) should be met
			expect(verification.requirementsCompleted).toContain(0)
			expect(verification.requirementsCompleted).toContain(2)
			// Documentation requirement should not be met
			expect(verification.requirementsCompleted).not.toContain(1)
		})
	})
})

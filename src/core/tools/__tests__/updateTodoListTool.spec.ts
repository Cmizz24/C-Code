import { describe, it, expect, beforeEach, vi } from "vitest"
import { parseMarkdownChecklist, setPendingTodoList, UpdateTodoListTool } from "../UpdateTodoListTool"
import { TodoItem } from "@roo-code/types"

function createTask(taskId: string) {
	return {
		taskId,
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		recordToolError: vi.fn(),
		say: vi.fn().mockResolvedValue(undefined),
		todoList: [],
		clineMessages: [],
	} as any
}

function createCallbacks(askApproval: ReturnType<typeof vi.fn>) {
	return {
		askApproval,
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
	}
}

function createDeferredApproval() {
	let resolve!: (approved: boolean) => void
	const promise = new Promise<boolean>((promiseResolve) => {
		resolve = promiseResolve
	})

	return { promise, resolve }
}

describe("UpdateTodoListTool", () => {
	it("does not emit a user edit row when overlapping approvals belong to different tasks", async () => {
		const tool = new UpdateTodoListTool()
		const firstTask = createTask("task-a")
		const secondTask = createTask("task-b")
		const firstApproval = createDeferredApproval()
		const firstCallbacks = createCallbacks(vi.fn(() => firstApproval.promise))
		const secondCallbacks = createCallbacks(vi.fn().mockResolvedValue(true))

		const firstExecute = tool.execute({ todos: "[ ] First task todo" }, firstTask, firstCallbacks)
		await vi.waitFor(() => expect(firstCallbacks.askApproval).toHaveBeenCalled())

		await tool.execute({ todos: "[ ] Second task todo" }, secondTask, secondCallbacks)

		firstApproval.resolve(true)
		await firstExecute

		expect(firstTask.say).not.toHaveBeenCalledWith("user_edit_todos", expect.anything())
		expect(secondTask.say).not.toHaveBeenCalledWith("user_edit_todos", expect.anything())
		expect(firstTask.todoList.map((todo: TodoItem) => todo.content)).toEqual(["First task todo"])
		expect(secondTask.todoList.map((todo: TodoItem) => todo.content)).toEqual(["Second task todo"])
	})

	it("records a visible todo edit only for pending edits on the same task", async () => {
		const tool = new UpdateTodoListTool()
		const task = createTask("task-edit")
		const callbacks = createCallbacks(
			vi.fn(async (_type, text: string) => {
				const payload = JSON.parse(text)
				setPendingTodoList(
					[
						{
							...payload.todos[0],
							content: "Edited todo",
						},
					],
					task,
				)
				return true
			}),
		)

		await tool.execute({ todos: "[ ] Original todo" }, task, callbacks)

		expect(task.say).toHaveBeenCalledWith("user_edit_todos", expect.stringContaining("Edited todo"))
		expect(task.todoList.map((todo: TodoItem) => todo.content)).toEqual(["Edited todo"])
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("User edits todo"))
	})
})

describe("parseMarkdownChecklist", () => {
	describe("standard checkbox format (without dash prefix)", () => {
		it("should parse pending tasks", () => {
			const md = `[ ] Task 1
[ ] Task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Task 1")
			expect(result[0].status).toBe("pending")
			expect(result[1].content).toBe("Task 2")
			expect(result[1].status).toBe("pending")
		})

		it("should parse completed tasks with lowercase x", () => {
			const md = `[x] Completed task 1
[x] Completed task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Completed task 1")
			expect(result[0].status).toBe("completed")
			expect(result[1].content).toBe("Completed task 2")
			expect(result[1].status).toBe("completed")
		})

		it("should parse completed tasks with uppercase X", () => {
			const md = `[X] Completed task 1
[X] Completed task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Completed task 1")
			expect(result[0].status).toBe("completed")
			expect(result[1].content).toBe("Completed task 2")
			expect(result[1].status).toBe("completed")
		})

		it("should parse in-progress tasks with dash", () => {
			const md = `[-] In progress task 1
[-] In progress task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("In progress task 1")
			expect(result[0].status).toBe("in_progress")
			expect(result[1].content).toBe("In progress task 2")
			expect(result[1].status).toBe("in_progress")
		})

		it("should parse in-progress tasks with tilde", () => {
			const md = `[~] In progress task 1
[~] In progress task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("In progress task 1")
			expect(result[0].status).toBe("in_progress")
			expect(result[1].content).toBe("In progress task 2")
			expect(result[1].status).toBe("in_progress")
		})
	})

	describe("dash-prefixed checkbox format", () => {
		it("should parse pending tasks with dash prefix", () => {
			const md = `- [ ] Task 1
- [ ] Task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Task 1")
			expect(result[0].status).toBe("pending")
			expect(result[1].content).toBe("Task 2")
			expect(result[1].status).toBe("pending")
		})

		it("should parse completed tasks with dash prefix and lowercase x", () => {
			const md = `- [x] Completed task 1
- [x] Completed task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Completed task 1")
			expect(result[0].status).toBe("completed")
			expect(result[1].content).toBe("Completed task 2")
			expect(result[1].status).toBe("completed")
		})

		it("should parse completed tasks with dash prefix and uppercase X", () => {
			const md = `- [X] Completed task 1
- [X] Completed task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Completed task 1")
			expect(result[0].status).toBe("completed")
			expect(result[1].content).toBe("Completed task 2")
			expect(result[1].status).toBe("completed")
		})

		it("should parse in-progress tasks with dash prefix and dash marker", () => {
			const md = `- [-] In progress task 1
- [-] In progress task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("In progress task 1")
			expect(result[0].status).toBe("in_progress")
			expect(result[1].content).toBe("In progress task 2")
			expect(result[1].status).toBe("in_progress")
		})

		it("should parse in-progress tasks with dash prefix and tilde marker", () => {
			const md = `- [~] In progress task 1
- [~] In progress task 2`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("In progress task 1")
			expect(result[0].status).toBe("in_progress")
			expect(result[1].content).toBe("In progress task 2")
			expect(result[1].status).toBe("in_progress")
		})
	})

	describe("mixed formats", () => {
		it("should parse mixed formats correctly", () => {
			const md = `[ ] Task without dash
- [ ] Task with dash
[x] Completed without dash
- [X] Completed with dash
[-] In progress without dash
- [~] In progress with dash`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(6)

			expect(result[0].content).toBe("Task without dash")
			expect(result[0].status).toBe("pending")

			expect(result[1].content).toBe("Task with dash")
			expect(result[1].status).toBe("pending")

			expect(result[2].content).toBe("Completed without dash")
			expect(result[2].status).toBe("completed")

			expect(result[3].content).toBe("Completed with dash")
			expect(result[3].status).toBe("completed")

			expect(result[4].content).toBe("In progress without dash")
			expect(result[4].status).toBe("in_progress")

			expect(result[5].content).toBe("In progress with dash")
			expect(result[5].status).toBe("in_progress")
		})
	})

	describe("edge cases", () => {
		it("should handle empty strings", () => {
			const result = parseMarkdownChecklist("")
			expect(result).toEqual([])
		})

		it("should handle non-string input", () => {
			const result = parseMarkdownChecklist(null as any)
			expect(result).toEqual([])
		})

		it("should handle undefined input", () => {
			const result = parseMarkdownChecklist(undefined as any)
			expect(result).toEqual([])
		})

		it("should ignore non-checklist lines", () => {
			const md = `This is not a checklist
[ ] Valid task
Just some text
- Not a checklist item
- [x] Valid completed task
[not valid] Invalid format`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(2)
			expect(result[0].content).toBe("Valid task")
			expect(result[0].status).toBe("pending")
			expect(result[1].content).toBe("Valid completed task")
			expect(result[1].status).toBe("completed")
		})

		it("should handle extra spaces", () => {
			const md = `  [ ]   Task with spaces  
-  [ ]  Task with dash and spaces
  [x]  Completed with spaces
-   [X]   Completed with dash and spaces`
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(4)
			expect(result[0].content).toBe("Task with spaces")
			expect(result[1].content).toBe("Task with dash and spaces")
			expect(result[2].content).toBe("Completed with spaces")
			expect(result[3].content).toBe("Completed with dash and spaces")
		})

		it("should handle Windows line endings", () => {
			const md = "[ ] Task 1\r\n- [x] Task 2\r\n[-] Task 3"
			const result = parseMarkdownChecklist(md)
			expect(result).toHaveLength(3)
			expect(result[0].content).toBe("Task 1")
			expect(result[0].status).toBe("pending")
			expect(result[1].content).toBe("Task 2")
			expect(result[1].status).toBe("completed")
			expect(result[2].content).toBe("Task 3")
			expect(result[2].status).toBe("in_progress")
		})
	})

	describe("ID generation", () => {
		it("should generate consistent IDs for the same content and status", () => {
			const md1 = `[ ] Task 1
[x] Task 2`
			const md2 = `[ ] Task 1
[x] Task 2`
			const result1 = parseMarkdownChecklist(md1)
			const result2 = parseMarkdownChecklist(md2)

			expect(result1[0].id).toBe(result2[0].id)
			expect(result1[1].id).toBe(result2[1].id)
		})

		it("should generate different IDs for different content", () => {
			const md = `[ ] Task 1
[ ] Task 2`
			const result = parseMarkdownChecklist(md)
			expect(result[0].id).not.toBe(result[1].id)
		})

		it("should generate different IDs for same content but different status", () => {
			const md = `[ ] Task 1
[x] Task 1`
			const result = parseMarkdownChecklist(md)
			expect(result[0].id).not.toBe(result[1].id)
		})

		it("should generate same IDs regardless of dash prefix", () => {
			const md1 = `[ ] Task 1`
			const md2 = `- [ ] Task 1`
			const result1 = parseMarkdownChecklist(md1)
			const result2 = parseMarkdownChecklist(md2)
			expect(result1[0].id).toBe(result2[0].id)
		})
	})
})

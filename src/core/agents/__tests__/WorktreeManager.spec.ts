import { exec } from "child_process"

import { WorktreeManager } from "../WorktreeManager"

vi.mock("child_process", () => ({
	exec: vi.fn(),
}))

const execMock = vi.mocked(exec)

type ExecCallback = (error: Error | null | undefined, stdout: string, stderr: string) => void

function mockExecImplementation(handler: (command: string) => { stdout?: string; stderr?: string; error?: Error }) {
	execMock.mockImplementation(((command: string, _options: unknown, callback: ExecCallback) => {
		const result = handler(command)
		callback(result.error, result.stdout ?? "", result.stderr ?? "")
		return {} as ReturnType<typeof exec>
	}) as typeof exec)
}

describe("WorktreeManager", () => {
	beforeEach(() => {
		execMock.mockReset()
	})

	it("validates the workspace with rev-parse before adding a worktree", async () => {
		const manager = new WorktreeManager("C:/repo")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}

			return { stdout: "" }
		})

		await manager.createWorktree("ui-ux", "plan-test")

		expect(execMock).toHaveBeenNthCalledWith(
			1,
			"git rev-parse --show-toplevel",
			expect.objectContaining({ cwd: "C:/repo" }),
			expect.any(Function),
		)
		expect(execMock).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining("git worktree add -B"),
			expect.objectContaining({ cwd: "C:/repo" }),
			expect.any(Function),
		)
	})

	it("returns a clear error and does not call git worktree add outside a git repository", async () => {
		const manager = new WorktreeManager("C:/Users/clayton/Desktop/test")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { error: new Error("fatal: not a git repository") }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await expect(manager.createWorktree("ui-ux", "plan-test")).rejects.toThrow(
			"Parallel worktrees require a Git repository",
		)
		expect(execMock).toHaveBeenCalledTimes(1)
		expect(execMock.mock.calls[0][0]).toBe("git rev-parse --show-toplevel")
	})
})

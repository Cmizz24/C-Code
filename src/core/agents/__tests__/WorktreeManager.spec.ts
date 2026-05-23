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
			if (command === "git rev-parse --verify HEAD") {
				return { stdout: "abc123\n" }
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
			"git rev-parse --verify HEAD",
			expect.objectContaining({ cwd: "C:/repo" }),
			expect.any(Function),
		)
		expect(execMock).toHaveBeenNthCalledWith(
			3,
			expect.stringContaining("git worktree add -B"),
			expect.objectContaining({ cwd: "C:/repo" }),
			expect.any(Function),
		)
	})

	it("returns a clear error and does not call git worktree add when HEAD is missing", async () => {
		const manager = new WorktreeManager("C:/repo")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (command === "git rev-parse --verify HEAD") {
				return { error: new Error("fatal: Needed a single revision") }
			}

			return { stdout: "" }
		})

		await expect(manager.createWorktree("ui", "plan-test")).rejects.toThrow(
			"Parallel agents require a Git repository with at least one commit.",
		)
		expect(execMock).not.toHaveBeenCalledWith(
			expect.stringContaining("git worktree add"),
			expect.anything(),
			expect.anything(),
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

	it("removes worktrees from the resolved git root instead of the workspace subfolder", async () => {
		const manager = new WorktreeManager("C:/repo/packages/extension")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}

			return { stdout: "" }
		})

		await manager.removeWorktree("C:/repo/packages/extension/.roo/parallel-worktrees/plan/ui")

		expect(execMock).toHaveBeenNthCalledWith(
			1,
			"git rev-parse --show-toplevel",
			expect.objectContaining({ cwd: "C:/repo/packages/extension" }),
			expect.any(Function),
		)
		expect(execMock).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining("git worktree remove --force"),
			expect.objectContaining({ cwd: "C:/repo" }),
			expect.any(Function),
		)
	})

	it("commits pending tracked and new worktree files before generating merge review diff", async () => {
		const manager = new WorktreeManager("C:/repo")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}

			if (command === "git add -A -- .") {
				return { stdout: "" }
			}

			if (command === "git diff --cached --quiet --exit-code") {
				return { error: Object.assign(new Error("changes staged"), { code: 1 }) }
			}

			if (command.includes("commit --no-verify")) {
				return { stdout: "[roo/parallel/plan/agent abc123] changes\n" }
			}

			if (command === 'git diff --binary HEAD..."roo/parallel/plan/agent"') {
				return { stdout: "diff --git a/src/a.ts b/src/a.ts\nnew file mode 100644\n" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		const diff = await manager.prepareMergeReview({
			agentId: "agent",
			planId: "plan",
			worktreePath: "C:/repo/.roo/parallel-worktrees/plan/agent",
			branch: "roo/parallel/plan/agent",
		})

		expect(diff).toContain("new file mode 100644")
		expect(execMock).toHaveBeenNthCalledWith(
			1,
			"git add -A -- .",
			expect.objectContaining({ cwd: "C:/repo/.roo/parallel-worktrees/plan/agent" }),
			expect.any(Function),
		)
		expect(execMock).toHaveBeenNthCalledWith(
			2,
			"git diff --cached --quiet --exit-code",
			expect.objectContaining({ cwd: "C:/repo/.roo/parallel-worktrees/plan/agent" }),
			expect.any(Function),
		)
		expect(execMock).toHaveBeenNthCalledWith(
			3,
			expect.stringContaining('git -c user.name="Roo Parallel Agent"'),
			expect.objectContaining({ cwd: "C:/repo/.roo/parallel-worktrees/plan/agent" }),
			expect.any(Function),
		)
		expect(execMock).toHaveBeenNthCalledWith(
			5,
			'git diff --binary HEAD..."roo/parallel/plan/agent"',
			expect.objectContaining({ cwd: "C:/repo", maxBuffer: 50 * 1024 * 1024 }),
			expect.any(Function),
		)
	})

	it("limits merge review staging and diffs to owned paths when provided", async () => {
		const manager = new WorktreeManager("C:/repo")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}

			if (command === 'git add -A -- "src/owned.ts" "src/owned-dir"') {
				return { stdout: "" }
			}

			if (command === "git diff --cached --quiet --exit-code") {
				return { error: Object.assign(new Error("changes staged"), { code: 1 }) }
			}

			if (command.includes("commit --no-verify")) {
				return { stdout: "[roo/parallel/plan/agent abc123] changes\n" }
			}

			if (command === 'git diff --binary HEAD..."roo/parallel/plan/agent" -- "src/owned.ts" "src/owned-dir"') {
				return { stdout: "diff --git a/src/owned.ts b/src/owned.ts\n" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		const diff = await manager.prepareMergeReview({
			agentId: "agent",
			planId: "plan",
			worktreePath: "C:/repo/.roo/parallel-worktrees/plan/agent",
			branch: "roo/parallel/plan/agent",
			ownedPaths: ["./src/owned.ts", "src/owned-dir/"],
		})

		expect(diff).toContain("src/owned.ts")
		expect(execMock).toHaveBeenNthCalledWith(
			1,
			'git add -A -- "src/owned.ts" "src/owned-dir"',
			expect.objectContaining({ cwd: "C:/repo/.roo/parallel-worktrees/plan/agent" }),
			expect.any(Function),
		)
		expect(execMock).toHaveBeenNthCalledWith(
			5,
			'git diff --binary HEAD..."roo/parallel/plan/agent" -- "src/owned.ts" "src/owned-dir"',
			expect.objectContaining({ cwd: "C:/repo", maxBuffer: 50 * 1024 * 1024 }),
			expect.any(Function),
		)
	})

	it("does not create an agent commit when auto-approved writes leave no staged changes", async () => {
		const manager = new WorktreeManager("C:/repo")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}

			if (command === "git add -A -- .") {
				return { stdout: "" }
			}

			if (command === "git diff --cached --quiet --exit-code") {
				return { stdout: "" }
			}

			if (command === 'git diff --binary HEAD..."roo/parallel/plan/agent"') {
				return { stdout: "" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		const diff = await manager.prepareMergeReview({
			agentId: "agent",
			planId: "plan",
			worktreePath: "C:/repo/.roo/parallel-worktrees/plan/agent",
			branch: "roo/parallel/plan/agent",
		})

		expect(diff).toBe("")
		expect(execMock.mock.calls.some(([command]) => String(command).includes("commit --no-verify"))).toBe(false)
	})
})

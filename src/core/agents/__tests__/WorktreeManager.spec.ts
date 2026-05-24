import { exec } from "child_process"
import fs from "fs/promises"

import { WorktreeManager } from "../WorktreeManager"

vi.mock("child_process", () => ({
	exec: vi.fn(),
}))

vi.mock("fs/promises", () => ({
	default: {
		mkdtemp: vi.fn().mockResolvedValue("C:/tmp/roo-parallel-baseline-1"),
		rm: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })),
	},
	mkdtemp: vi.fn().mockResolvedValue("C:/tmp/roo-parallel-baseline-1"),
	rm: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })),
}))

const execMock = vi.mocked(exec)
const fsMock = vi.mocked(fs)

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
		fsMock.mkdtemp.mockResolvedValue("C:/tmp/roo-parallel-baseline-1")
		fsMock.rm.mockResolvedValue(undefined)
		fsMock.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }))
	})

	it("captures the current workspace state before adding a worktree from the synthetic baseline", async () => {
		const manager = new WorktreeManager("C:/repo")
		fsMock.readFile.mockResolvedValue("secret/**\n")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (command === "git rev-parse --verify HEAD") {
				return { stdout: "abc123\n" }
			}
			if (command === "git read-tree HEAD") {
				return { stdout: "" }
			}
			if (command === "git diff --name-only -z HEAD --") {
				return { stdout: "src/edited.ts\0src/deleted.ts\0" }
			}
			if (command === "git ls-files --others --exclude-standard -z") {
				return {
					stdout: "src/new.ts\0.env.local\0.roo/parallel-worktrees/plan/agent/generated.ts\0secret/token.txt\0",
				}
			}
			if (command === 'git add -A -- "src/edited.ts" "src/deleted.ts" "src/new.ts"') {
				return { stdout: "" }
			}
			if (command === "git ls-files -z") {
				return { stdout: "src/edited.ts\0src/deleted.ts\0src/new.ts\0.env\0.rooignore\0" }
			}
			if (command === 'git rm --cached --ignore-unmatch -- ".env" ".rooignore"') {
				return { stdout: "" }
			}
			if (command === "git write-tree") {
				return { stdout: "tree123\n" }
			}
			if (command.includes("commit-tree tree123 -p HEAD")) {
				return { stdout: "baseline123\n" }
			}
			if (command === 'git update-ref "refs/roo/parallel-baselines/plan-test" baseline123') {
				return { stdout: "" }
			}
			if (
				command.startsWith('git worktree add -B "roo/parallel/plan-test/ui-ux" ') &&
				command.endsWith(" baseline123")
			) {
				return { stdout: "" }
			}

			throw new Error(`Unexpected command: ${command}`)
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
			"git read-tree HEAD",
			expect.objectContaining({
				cwd: "C:/repo",
				env: expect.objectContaining({ GIT_INDEX_FILE: expect.any(String) }),
			}),
			expect.any(Function),
		)
		expect(execMock).toHaveBeenCalledWith(
			'git add -A -- "src/edited.ts" "src/deleted.ts" "src/new.ts"',
			expect.objectContaining({
				cwd: "C:/repo",
				env: expect.objectContaining({ GIT_INDEX_FILE: expect.any(String) }),
			}),
			expect.any(Function),
		)
		expect(execMock).toHaveBeenCalledWith(
			'git rm --cached --ignore-unmatch -- ".env" ".rooignore"',
			expect.objectContaining({
				cwd: "C:/repo",
				env: expect.objectContaining({ GIT_INDEX_FILE: expect.any(String) }),
			}),
			expect.any(Function),
		)
		expect(execMock).toHaveBeenCalledWith(
			expect.stringMatching(/^git worktree add -B "roo\/parallel\/plan-test\/ui-ux" .+ baseline123$/),
			expect.objectContaining({ cwd: "C:/repo" }),
			expect.any(Function),
		)
		expect(fsMock.rm).toHaveBeenCalledWith("C:/tmp/roo-parallel-baseline-1", { recursive: true, force: true })
	})

	it("reuses a captured workspace baseline for later worktrees in the same plan", async () => {
		const manager = new WorktreeManager("C:/repo")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (command === "git rev-parse --verify HEAD") {
				return { stdout: "abc123\n" }
			}
			if (command === "git read-tree HEAD") {
				return { stdout: "" }
			}
			if (command === "git diff --name-only -z HEAD --") {
				return { stdout: "src/edited.ts\0" }
			}
			if (command === "git ls-files --others --exclude-standard -z") {
				return { stdout: "" }
			}
			if (command === 'git add -A -- "src/edited.ts"') {
				return { stdout: "" }
			}
			if (command === "git ls-files -z") {
				return { stdout: "src/edited.ts\0" }
			}
			if (command === "git write-tree") {
				return { stdout: "tree123\n" }
			}
			if (command.includes("commit-tree tree123 -p HEAD")) {
				return { stdout: "baseline123\n" }
			}
			if (command === 'git update-ref "refs/roo/parallel-baselines/plan-test" baseline123') {
				return { stdout: "" }
			}
			if (command.startsWith('git worktree add -B "roo/parallel/plan-test/')) {
				return { stdout: "" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await manager.createWorktree("agent-a", "plan-test")
		await manager.createWorktree("agent-b", "plan-test")

		expect(execMock.mock.calls.filter(([command]) => command === "git read-tree HEAD")).toHaveLength(1)
		expect(execMock.mock.calls.filter(([command]) => String(command).includes("commit-tree tree123"))).toHaveLength(
			1,
		)
		expect(execMock.mock.calls.filter(([command]) => String(command).includes("git worktree add -B"))).toHaveLength(
			2,
		)
	})

	it("calculates merge review diffs relative to the captured workspace baseline", async () => {
		const manager = new WorktreeManager("C:/repo")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (command === "git rev-parse --verify HEAD") {
				return { stdout: "abc123\n" }
			}
			if (command === "git read-tree HEAD") {
				return { stdout: "" }
			}
			if (command === "git diff --name-only -z HEAD --") {
				return { stdout: "src/existing.ts\0" }
			}
			if (command === "git ls-files --others --exclude-standard -z") {
				return { stdout: "src/new.ts\0" }
			}
			if (command === 'git add -A -- "src/existing.ts" "src/new.ts"') {
				return { stdout: "" }
			}
			if (command === "git ls-files -z") {
				return { stdout: "src/existing.ts\0src/new.ts\0" }
			}
			if (command === "git write-tree") {
				return { stdout: "tree123\n" }
			}
			if (command.includes("commit-tree tree123 -p HEAD")) {
				return { stdout: "baseline123\n" }
			}
			if (command === 'git update-ref "refs/roo/parallel-baselines/plan" baseline123') {
				return { stdout: "" }
			}
			if (command === "git add -A -- .") {
				return { stdout: "" }
			}
			if (command === "git diff --cached --quiet --exit-code") {
				return { stdout: "" }
			}
			if (command === 'git diff --binary baseline123..."roo/parallel/plan/agent"') {
				return { stdout: "diff --git a/src/agent.ts b/src/agent.ts\n" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await manager.captureWorkspaceBaseline("plan")
		execMock.mockClear()

		const diff = await manager.prepareMergeReview({
			agentId: "agent",
			planId: "plan",
			worktreePath: "C:/repo/.roo/parallel-worktrees/plan/agent",
			branch: "roo/parallel/plan/agent",
		})

		expect(diff).toContain("src/agent.ts")
		expect(execMock).toHaveBeenCalledWith(
			'git diff --binary baseline123..."roo/parallel/plan/agent"',
			expect.objectContaining({ cwd: "C:/repo", maxBuffer: 50 * 1024 * 1024 }),
			expect.any(Function),
		)
		expect(execMock.mock.calls.some(([command]) => String(command).includes("HEAD..."))).toBe(false)
	})

	it("cleans up temporary baseline refs after a plan finishes", async () => {
		const manager = new WorktreeManager("C:/repo")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (command === "git rev-parse --verify HEAD") {
				return { stdout: "abc123\n" }
			}
			if (command === "git read-tree HEAD") {
				return { stdout: "" }
			}
			if (command === "git diff --name-only -z HEAD --") {
				return { stdout: "" }
			}
			if (command === "git ls-files --others --exclude-standard -z") {
				return { stdout: "" }
			}
			if (command === "git ls-files -z") {
				return { stdout: "" }
			}
			if (command === "git write-tree") {
				return { stdout: "tree123\n" }
			}
			if (command.includes("commit-tree tree123 -p HEAD")) {
				return { stdout: "baseline123\n" }
			}
			if (command === 'git update-ref "refs/roo/parallel-baselines/plan" baseline123') {
				return { stdout: "" }
			}
			if (command === 'git update-ref -d "refs/roo/parallel-baselines/plan"') {
				return { stdout: "" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await manager.captureWorkspaceBaseline("plan")
		execMock.mockClear()

		await manager.cleanupPlanBaseline("plan")
		await manager.cleanupPlanBaseline("plan")

		expect(execMock).toHaveBeenCalledTimes(1)
		expect(execMock).toHaveBeenCalledWith(
			'git update-ref -d "refs/roo/parallel-baselines/plan"',
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

	it("aborts an in-progress rebase when rebasing a baseline-derived agent branch fails", async () => {
		const manager = new WorktreeManager("C:/repo")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (command === "git rev-parse --verify HEAD") {
				return { stdout: "abc123\n" }
			}
			if (command === "git read-tree HEAD") {
				return { stdout: "" }
			}
			if (command === "git diff --name-only -z HEAD --") {
				return { stdout: "" }
			}
			if (command === "git ls-files --others --exclude-standard -z") {
				return { stdout: "" }
			}
			if (command === "git ls-files -z") {
				return { stdout: "" }
			}
			if (command === "git write-tree") {
				return { stdout: "tree123\n" }
			}
			if (command.includes("commit-tree tree123 -p HEAD")) {
				return { stdout: "baseline123\n" }
			}
			if (command === 'git update-ref "refs/roo/parallel-baselines/plan" baseline123') {
				return { stdout: "" }
			}
			if (command === "git rev-parse HEAD") {
				return { stdout: "current123\n" }
			}
			if (command === "git rev-list --count baseline123..roo/parallel/plan/agent") {
				return { stdout: "1\n" }
			}
			if (command === "git rebase --onto current123 baseline123") {
				return {
					error: Object.assign(new Error("Command failed: git rebase --onto current123 baseline123"), {
						stderr: "CONFLICT (add/add): Merge conflict in index.html",
					}),
				}
			}
			if (command === "git diff --name-only --diff-filter=U -z") {
				return { stdout: "index.html\0" }
			}
			if (command === "git rebase --abort") {
				return { stdout: "" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await manager.captureWorkspaceBaseline("plan")
		execMock.mockClear()

		const merge = manager.mergeBranch("roo/parallel/plan/agent", {
			planId: "plan",
			worktreePath: "C:/repo/.roo/parallel-worktrees/plan/agent",
		})

		await expect(merge).rejects.toThrow(
			/Failed to rebase parallel agent branch roo\/parallel\/plan\/agent[\s\S]*index\.html/,
		)

		expect(execMock).toHaveBeenCalledWith(
			"git rebase --abort",
			expect.objectContaining({ cwd: "C:/repo/.roo/parallel-worktrees/plan/agent" }),
			expect.any(Function),
		)
		expect(execMock.mock.calls.some(([command]) => String(command).startsWith("git merge --no-edit"))).toBe(false)
	})

	it("aborts an in-progress workspace merge when merging an agent branch fails", async () => {
		const manager = new WorktreeManager("C:/repo")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (command === "git rev-parse --verify HEAD") {
				return { stdout: "abc123\n" }
			}
			if (command === "git read-tree HEAD") {
				return { stdout: "" }
			}
			if (command === "git diff --name-only -z HEAD --") {
				return { stdout: "" }
			}
			if (command === "git ls-files --others --exclude-standard -z") {
				return { stdout: "" }
			}
			if (command === "git ls-files -z") {
				return { stdout: "" }
			}
			if (command === "git write-tree") {
				return { stdout: "tree123\n" }
			}
			if (command.includes("commit-tree tree123 -p HEAD")) {
				return { stdout: "baseline123\n" }
			}
			if (command === 'git update-ref "refs/roo/parallel-baselines/plan" baseline123') {
				return { stdout: "" }
			}
			if (command === "git rev-parse HEAD") {
				return { stdout: "current123\n" }
			}
			if (command === "git rev-list --count baseline123..roo/parallel/plan/agent") {
				return { stdout: "1\n" }
			}
			if (command === "git rebase --onto current123 baseline123") {
				return { stdout: "" }
			}
			if (command === 'git merge --no-edit "roo/parallel/plan/agent"') {
				return {
					error: Object.assign(new Error('Command failed: git merge --no-edit "roo/parallel/plan/agent"'), {
						stderr: "CONFLICT (add/add): Merge conflict in index.html",
					}),
				}
			}
			if (command === "git diff --name-only --diff-filter=U -z") {
				return { stdout: "index.html\0" }
			}
			if (command === "git merge --abort") {
				return { stdout: "" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await manager.captureWorkspaceBaseline("plan")
		execMock.mockClear()

		await expect(
			manager.mergeBranch("roo/parallel/plan/agent", {
				planId: "plan",
				worktreePath: "C:/repo/.roo/parallel-worktrees/plan/agent",
			}),
		).rejects.toThrow(/Failed to merge parallel agent branch roo\/parallel\/plan\/agent/)

		expect(execMock).toHaveBeenCalledWith(
			"git merge --abort",
			expect.objectContaining({ cwd: "C:/repo" }),
			expect.any(Function),
		)
	})
})

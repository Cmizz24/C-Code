import { exec } from "child_process"
import fs from "fs/promises"
import path from "path"

import { WorktreeManager, WorktreeManagerGitUnavailableError } from "../WorktreeManager"

vi.mock("child_process", () => ({
	exec: vi.fn(),
}))

vi.mock("fs/promises", () => ({
	default: {
		mkdtemp: vi.fn().mockResolvedValue("C:/tmp/roo-parallel-baseline-1"),
		rm: vi.fn().mockResolvedValue(undefined),
		stat: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })),
		readFile: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })),
		writeFile: vi.fn().mockResolvedValue(undefined),
	},
	mkdtemp: vi.fn().mockResolvedValue("C:/tmp/roo-parallel-baseline-1"),
	rm: vi.fn().mockResolvedValue(undefined),
	stat: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })),
	readFile: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })),
	writeFile: vi.fn().mockResolvedValue(undefined),
}))

const execMock = vi.mocked(exec)
const fsMock = vi.mocked(fs)
const retainedGitCommonDir = "/repo/.git"
const mergePatchDir = "C:/tmp/roo-parallel-merge-patch-1"
const mergePatchPath = path.join(mergePatchDir, "agent.diff")
const quotedMergePatchPath = `"${mergePatchPath.replace(/"/g, '\\"')}"`

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
		fsMock.stat.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }))
		fsMock.rm.mockClear()
		fsMock.writeFile.mockClear()
		fsMock.writeFile.mockResolvedValue(undefined)
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

		const worktreePath = await manager.createWorktree("ui-ux", "plan-test")

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
		const worktreeAddCall = execMock.mock.calls.find(([command]) =>
			String(command).startsWith('git worktree add -B "roo/parallel/plan-test/ui-ux" '),
		)
		expect(worktreeAddCall).toBeDefined()
		const worktreeAddCommand = String(worktreeAddCall?.[0]).replace(/\\/g, "/")
		const normalizedWorktreePath = worktreePath.replace(/\\/g, "/")
		expect(worktreeAddCommand).toMatch(/^git worktree add -B "roo\/parallel\/plan-test\/ui-ux" .+ baseline123$/)
		expect(worktreeAddCommand).toContain(normalizedWorktreePath)
		expect(normalizedWorktreePath).toContain("/.roo/parallel-worktrees/")
		expect(normalizedWorktreePath).toContain("/plan-test/ui-ux")
		expect(normalizedWorktreePath).not.toContain("C:/repo/.roo/parallel-worktrees")
		expect(manager.getCreatedWorktrees()).toEqual([worktreePath])
		expect(worktreeAddCall?.[1]).toEqual(expect.objectContaining({ cwd: "C:/repo" }))
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

	it("classifies missing git executable failures before repository validation fallback", async () => {
		const manager = new WorktreeManager("C:/repo")
		const enoent = Object.assign(new Error("spawn C:\\Program Files\\Git\\cmd\\git.exe ENOENT"), {
			code: "ENOENT",
		})
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { error: enoent }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await expect(manager.validateGitRepository()).rejects.toThrow(WorktreeManagerGitUnavailableError)
		await expect(manager.validateGitRepository()).rejects.toThrow("Git executable unavailable")
		await expect(manager.validateGitRepository()).rejects.toThrow("Git: Path")
		expect(execMock).toHaveBeenCalledWith(
			"git rev-parse --show-toplevel",
			expect.objectContaining({ cwd: "C:/repo" }),
			expect.any(Function),
		)
	})

	it("marks retained worktree inspection non-retryable when git executable is missing", async () => {
		const manager = new WorktreeManager("C:/repo")
		const enoent = Object.assign(new Error("spawn C:\\Program Files\\Git\\cmd\\git.exe ENOENT"), {
			code: "ENOENT",
		})
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { error: enoent }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await expect(
			manager.inspectReusableWorktree({ worktreePath: "C:/worktrees/ui", branch: "roo/parallel/old/ui" }),
		).resolves.toEqual(
			expect.objectContaining({
				reusable: false,
				reason: expect.stringContaining("Git executable unavailable"),
				nonRetryable: true,
			}),
		)
	})

	it("inspects a clean retained worktree as reusable", async () => {
		const manager = new WorktreeManager("C:/repo")
		fsMock.stat.mockResolvedValue({} as any)
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (command === "git rev-parse --verify HEAD") {
				return { stdout: "head123\n" }
			}
			if (command === "git rev-parse --git-common-dir") {
				return { stdout: `${retainedGitCommonDir}\n` }
			}
			if (command === "git rev-parse --abbrev-ref HEAD") {
				return { stdout: "roo/parallel/old/ui\n" }
			}
			if (command === "git status --porcelain=v1 --untracked-files=all") {
				return { stdout: "" }
			}
			if (command === "git rev-parse HEAD") {
				return { stdout: "head123\n" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await expect(
			manager.inspectReusableWorktree({
				worktreePath: "C:/worktrees/ui",
				branch: "roo/parallel/old/ui",
				expectedRepositoryRoot: "C:/repo",
			}),
		).resolves.toEqual(
			expect.objectContaining({
				reusable: true,
				worktreePath: "C:/worktrees/ui",
				branch: "roo/parallel/old/ui",
				resetRequired: false,
			}),
		)
	})

	it("rejects reusable inspection for dirty retained worktrees without throwing", async () => {
		const manager = new WorktreeManager("C:/repo")
		fsMock.stat.mockResolvedValue({} as any)
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") return { stdout: "C:/repo\n" }
			if (command === "git rev-parse --verify HEAD") return { stdout: "head123\n" }
			if (command === "git rev-parse --git-common-dir") return { stdout: `${retainedGitCommonDir}\n` }
			if (command === "git rev-parse --abbrev-ref HEAD") return { stdout: "roo/parallel/old/ui\n" }
			if (command === "git status --porcelain=v1 --untracked-files=all") return { stdout: " M src/ui.tsx\n" }
			throw new Error(`Unexpected command: ${command}`)
		})

		await expect(
			manager.inspectReusableWorktree({ worktreePath: "C:/worktrees/ui", branch: "roo/parallel/old/ui" }),
		).resolves.toEqual(
			expect.objectContaining({
				reusable: false,
				reason: "retained worktree has uncommitted or untracked changes",
			}),
		)
	})

	it("rejects reusable inspection for missing retained worktree paths", async () => {
		const manager = new WorktreeManager("C:/repo")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") return { stdout: "C:/repo\n" }
			if (command === "git rev-parse --verify HEAD") return { stdout: "head123\n" }
			throw new Error(`Unexpected command: ${command}`)
		})

		await expect(
			manager.inspectReusableWorktree({ worktreePath: "C:/worktrees/missing", branch: "roo/parallel/old/ui" }),
		).resolves.toEqual(expect.objectContaining({ reusable: false, reason: "retained worktree path is missing" }))
	})

	it("rejects reusable inspection when retained worktree branch differs", async () => {
		const manager = new WorktreeManager("C:/repo")
		fsMock.stat.mockResolvedValue({} as any)
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") return { stdout: "C:/repo\n" }
			if (command === "git rev-parse --verify HEAD") return { stdout: "head123\n" }
			if (command === "git rev-parse --git-common-dir") return { stdout: `${retainedGitCommonDir}\n` }
			if (command === "git rev-parse --abbrev-ref HEAD") return { stdout: "other-branch\n" }
			throw new Error(`Unexpected command: ${command}`)
		})

		await expect(
			manager.inspectReusableWorktree({ worktreePath: "C:/worktrees/ui", branch: "roo/parallel/old/ui" }),
		).resolves.toEqual(
			expect.objectContaining({
				reusable: false,
				reason: "retained worktree is on branch other-branch instead of roo/parallel/old/ui",
			}),
		)
	})

	it("falls back from reusable inspection on git failures without throwing", async () => {
		const manager = new WorktreeManager("C:/repo")
		fsMock.stat.mockResolvedValue({} as any)
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") return { stdout: "C:/repo\n" }
			if (command === "git rev-parse --verify HEAD") return { stdout: "head123\n" }
			if (command === "git rev-parse --git-common-dir") return { error: new Error("git failed") }
			throw new Error(`Unexpected command: ${command}`)
		})

		await expect(
			manager.inspectReusableWorktree({ worktreePath: "C:/worktrees/ui", branch: "roo/parallel/old/ui" }),
		).resolves.toEqual(expect.objectContaining({ reusable: false, reason: expect.stringContaining("git failed") }))
	})

	it("reports invalid retained worktree repositories without a retryable git-unavailable flag", async () => {
		const manager = new WorktreeManager("C:/repo")
		fsMock.stat.mockResolvedValue({} as any)
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") return { stdout: "C:/repo\n" }
			if (command === "git rev-parse --verify HEAD") return { stdout: "head123\n" }
			if (command === "git rev-parse --git-common-dir") {
				return { error: new Error("Repository not initialized") }
			}
			throw new Error(`Unexpected command: ${command}`)
		})

		await expect(
			manager.inspectReusableWorktree({ worktreePath: "C:/worktrees/invalid", branch: "roo/parallel/old/ui" }),
		).resolves.toEqual(
			expect.objectContaining({
				reusable: false,
				reason: expect.stringContaining("Repository not initialized"),
				nonRetryable: false,
			}),
		)
	})

	it("reuses a clean retained worktree by resetting it onto a new branch", async () => {
		const manager = new WorktreeManager("C:/repo")
		fsMock.stat.mockResolvedValue({} as any)
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") return { stdout: "C:/repo\n" }
			if (command === "git rev-parse --verify HEAD") return { stdout: "head123\n" }
			if (command === "git rev-parse --git-common-dir") return { stdout: `${retainedGitCommonDir}\n` }
			if (command === "git rev-parse --abbrev-ref HEAD") return { stdout: "roo/parallel/old/ui\n" }
			if (command === "git status --porcelain=v1 --untracked-files=all") return { stdout: "" }
			if (command === "git rev-parse HEAD") return { stdout: "head123\n" }
			if (command === 'git checkout -B "roo/parallel/new/ui" head123') return { stdout: "" }
			if (command === "git reset --hard head123") return { stdout: "" }
			if (command === "git clean -fd") return { stdout: "" }
			throw new Error(`Unexpected command: ${command}`)
		})

		await expect(
			manager.reuseWorktree({
				worktreePath: "C:/worktrees/ui",
				sourceBranch: "roo/parallel/old/ui",
				newBranch: "roo/parallel/new/ui",
			}),
		).resolves.toEqual(
			expect.objectContaining({
				worktreePath: "C:/worktrees/ui",
				branch: "roo/parallel/new/ui",
				resetToCurrentBaseline: false,
			}),
		)
		expect(manager.getCreatedWorktrees()).toEqual(["C:/worktrees/ui"])
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

			if (command === 'git diff --name-only -z HEAD -- "src/owned.ts" "src/owned-dir"') {
				return { stdout: "src/owned.ts\0src/owned-dir/nested.ts\0src/unowned.ts\0" }
			}

			if (command === 'git ls-files --others --exclude-standard -z -- "src/owned.ts" "src/owned-dir"') {
				return { stdout: "src/owned-dir/new.ts\0" }
			}

			if (command === 'git add -A -- "src/owned.ts" "src/owned-dir/nested.ts" "src/owned-dir/new.ts"') {
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
			'git diff --name-only -z HEAD -- "src/owned.ts" "src/owned-dir"',
			expect.objectContaining({ cwd: "C:/repo/.roo/parallel-worktrees/plan/agent" }),
			expect.any(Function),
		)
		expect(execMock).toHaveBeenNthCalledWith(
			7,
			'git diff --binary HEAD..."roo/parallel/plan/agent" -- "src/owned.ts" "src/owned-dir"',
			expect.objectContaining({ cwd: "C:/repo", maxBuffer: 50 * 1024 * 1024 }),
			expect.any(Function),
		)
	})

	it("does not stage raw missing owned pathspecs during merge review", async () => {
		const manager = new WorktreeManager("C:/repo")
		const diagnostics = vi.fn()
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}

			if (command === 'git diff --name-only -z HEAD -- "index.html" "styles.css" "app.js"') {
				return { stdout: "" }
			}

			if (command === 'git ls-files --others --exclude-standard -z -- "index.html" "styles.css" "app.js"') {
				return { stdout: "" }
			}

			if (
				command === 'git diff --binary HEAD..."roo/parallel/plan/agent" -- "index.html" "styles.css" "app.js"'
			) {
				return { stdout: "" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		const diff = await manager.prepareMergeReview({
			agentId: "agent",
			planId: "plan",
			worktreePath: "C:/repo/.roo/parallel-worktrees/plan/agent",
			branch: "roo/parallel/plan/agent",
			ownedPaths: ["index.html", "styles.css", "app.js"],
			onDiagnostics: diagnostics,
		})

		expect(diff).toBe("")
		expect(
			execMock.mock.calls.some(([command]) => command === 'git add -A -- "index.html" "styles.css" "app.js"'),
		).toBe(false)
		expect(diagnostics).toHaveBeenCalledWith(
			expect.objectContaining({
				planId: "plan",
				agentId: "agent",
				originalOwnedPaths: ["index.html", "styles.css", "app.js"],
				normalizedOwnedPaths: ["index.html", "styles.css", "app.js"],
				trackedChangedPaths: [],
				untrackedChangedPaths: [],
				stagedPaths: [],
				result: "no-owned-worktree-changes",
			}),
		)
	})

	it("records merge-review path diagnostics without exposing file contents", async () => {
		const manager = new WorktreeManager("C:/repo")
		const diagnostics = vi.fn()
		fsMock.stat.mockImplementation(async (filePath) => {
			if (String(filePath).replace(/\\/g, "/").endsWith("index.html")) {
				return {} as Awaited<ReturnType<typeof fs.stat>>
			}

			throw Object.assign(new Error("missing"), { code: "ENOENT" })
		})
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}

			if (command === 'git diff --name-only -z HEAD -- "index.html" "styles.css"') {
				return { stdout: "index.html\0" }
			}

			if (command === 'git ls-files --others --exclude-standard -z -- "index.html" "styles.css"') {
				return { stdout: "" }
			}

			if (command === 'git add -A -- "index.html"') {
				return { stdout: "" }
			}

			if (command === "git diff --cached --quiet --exit-code") {
				return { error: Object.assign(new Error("changes staged"), { code: 1 }) }
			}

			if (command.includes("commit --no-verify")) {
				return { stdout: "[roo/parallel/plan/agent abc123] changes\n" }
			}

			if (command === 'git diff --binary HEAD..."roo/parallel/plan/agent" -- "index.html" "styles.css"') {
				return { stdout: "diff --git a/index.html b/index.html\n" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await manager.prepareMergeReview({
			agentId: "agent",
			planId: "plan",
			worktreePath: "C:/repo/.roo/parallel-worktrees/plan/agent",
			branch: "roo/parallel/plan/agent",
			ownedPaths: ["./index.html", "styles.css"],
			onDiagnostics: diagnostics,
		})

		expect(diagnostics).toHaveBeenCalledWith(
			expect.objectContaining({
				pathDiagnostics: [
					expect.objectContaining({
						originalPath: "./index.html",
						workspaceRelativePath: "index.html",
						existsInWorktree: true,
						existsInRootWorkspace: true,
					}),
					expect.objectContaining({
						originalPath: "styles.css",
						workspaceRelativePath: "styles.css",
						existsInWorktree: false,
						existsInRootWorkspace: false,
					}),
				],
				stagedPaths: ["index.html"],
				commitCreated: true,
				result: "committed",
			}),
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

	it("applies owned branch diffs directly without rebasing safe single-owner files", async () => {
		const manager = new WorktreeManager("C:/repo")
		;(manager as any).workspaceBaselines.set("plan-test", {
			planId: "plan-test",
			commit: "baseline123",
			ref: "refs/roo/parallel-baselines/plan-test",
		})
		fsMock.mkdtemp
			.mockResolvedValueOnce("C:/tmp/roo-parallel-current-snapshot-1")
			.mockResolvedValueOnce(mergePatchDir)
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (command === 'git diff --binary baseline123..."roo/parallel/plan-test/ui-agent" -- "src/index.html"') {
				return { stdout: "diff --git a/src/index.html b/src/index.html\n+<main />\n" }
			}
			if (command === "git read-tree baseline123") {
				return { stdout: "" }
			}
			if (command === 'git ls-files -z -- "src/index.html"') {
				return { stdout: "src/index.html\0" }
			}
			if (command === 'git ls-files --others --exclude-standard -z -- "src/index.html"') {
				return { stdout: "" }
			}
			if (command === 'git add -A -- "src/index.html"') {
				return { stdout: "" }
			}
			if (command === 'git diff --cached --name-only -z baseline123 -- "src/index.html"') {
				return { stdout: "" }
			}
			if (command === `git apply --binary --3way --check ${quotedMergePatchPath}`) {
				return { stdout: "" }
			}
			if (command === `git apply --binary --3way ${quotedMergePatchPath}`) {
				return { stdout: "" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await manager.mergeBranch("roo/parallel/plan-test/ui-agent", {
			planId: "plan-test",
			worktreePath: "C:/worktrees/ui-agent",
			ownedPaths: ["src/index.html"],
		})

		expect(execMock.mock.calls.some(([command]) => String(command).includes("git rebase"))).toBe(false)
		expect(execMock.mock.calls.some(([command]) => String(command).includes("git merge --no-edit"))).toBe(false)
		expect(fsMock.writeFile).toHaveBeenCalledWith(
			mergePatchPath,
			"diff --git a/src/index.html b/src/index.html\n+<main />\n",
			"utf8",
		)
	})

	it("does not run git add on absent owned paths before applying a new-file branch diff", async () => {
		const manager = new WorktreeManager("C:/repo")
		;(manager as any).workspaceBaselines.set("plan-test", {
			planId: "plan-test",
			commit: "baseline123",
			ref: "refs/roo/parallel-baselines/plan-test",
		})
		fsMock.mkdtemp
			.mockResolvedValueOnce("C:/tmp/roo-parallel-current-snapshot-1")
			.mockResolvedValueOnce(mergePatchDir)
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (command === 'git diff --binary baseline123..."roo/parallel/plan-test/ui-agent" -- "index.html"') {
				return {
					stdout:
						"diff --git a/index.html b/index.html\n" +
						"new file mode 100644\n" +
						"index 0000000..166ef26\n" +
						"--- /dev/null\n" +
						"+++ b/index.html\n" +
						"@@ -0,0 +1 @@\n" +
						"+<main />\n",
				}
			}
			if (command === "git read-tree baseline123") {
				return { stdout: "" }
			}
			if (command === 'git ls-files -z -- "index.html"') {
				return { stdout: "" }
			}
			if (command === 'git ls-files --others --exclude-standard -z -- "index.html"') {
				return { stdout: "" }
			}
			if (command === 'git diff --cached --name-only -z baseline123 -- "index.html"') {
				return { stdout: "" }
			}
			if (command === `git apply --binary --3way --check ${quotedMergePatchPath}`) {
				return { stdout: "" }
			}
			if (command === `git apply --binary --3way ${quotedMergePatchPath}`) {
				return { stdout: "" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await manager.mergeBranch("roo/parallel/plan-test/ui-agent", {
			planId: "plan-test",
			worktreePath: "C:/worktrees/ui-agent",
			ownedPaths: ["index.html"],
		})

		expect(execMock.mock.calls.some(([command]) => command === 'git add -A -- "index.html"')).toBe(false)
		expect(fsMock.writeFile).toHaveBeenCalledWith(
			mergePatchPath,
			expect.stringContaining("new file mode 100644"),
			"utf8",
		)
	})

	it("materializes auto-approved owned file changes from the agent branch without patch safety checks", async () => {
		const manager = new WorktreeManager("C:/repo")
		;(manager as any).workspaceBaselines.set("plan-test", {
			planId: "plan-test",
			commit: "baseline123",
			ref: "refs/roo/parallel-baselines/plan-test",
		})
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (
				command ===
				'git diff --name-only -z --no-renames baseline123..."roo/parallel/plan-test/ui-agent" -- "index.html"'
			) {
				return { stdout: "index.html\0src/not-owned.ts\0" }
			}
			if (command === 'git cat-file -e "roo/parallel/plan-test/ui-agent:index.html"') {
				return { stdout: "" }
			}
			if (command === 'git checkout -f "roo/parallel/plan-test/ui-agent" -- "index.html"') {
				return { stdout: "" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await manager.mergeBranch("roo/parallel/plan-test/ui-agent", {
			planId: "plan-test",
			worktreePath: "C:/worktrees/ui-agent",
			ownedPaths: ["index.html"],
			autoApproved: true,
		})

		expect(execMock).toHaveBeenCalledWith(
			'git checkout -f "roo/parallel/plan-test/ui-agent" -- "index.html"',
			expect.objectContaining({ cwd: "C:/repo", maxBuffer: 50 * 1024 * 1024 }),
			expect.any(Function),
		)
		expect(execMock.mock.calls.some(([command]) => String(command).includes("src/not-owned.ts"))).toBe(false)
		expect(execMock.mock.calls.some(([command]) => String(command).startsWith("git read-tree"))).toBe(false)
		expect(execMock.mock.calls.some(([command]) => String(command).startsWith("git apply"))).toBe(false)
		expect(fsMock.writeFile).not.toHaveBeenCalled()
	})

	it("materializes auto-approved owned deletions from the agent branch", async () => {
		const manager = new WorktreeManager("C:/repo")
		;(manager as any).workspaceBaselines.set("plan-test", {
			planId: "plan-test",
			commit: "baseline123",
			ref: "refs/roo/parallel-baselines/plan-test",
		})
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (
				command ===
				'git diff --name-only -z --no-renames baseline123..."roo/parallel/plan-test/ui-agent" -- "obsolete.html"'
			) {
				return { stdout: "obsolete.html\0" }
			}
			if (command === 'git cat-file -e "roo/parallel/plan-test/ui-agent:obsolete.html"') {
				return { error: new Error("fatal: path does not exist in branch") }
			}
			if (command === 'git rm -f --ignore-unmatch -- "obsolete.html"') {
				return { stdout: "" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await manager.mergeBranch("roo/parallel/plan-test/ui-agent", {
			planId: "plan-test",
			worktreePath: "C:/worktrees/ui-agent",
			ownedPaths: ["obsolete.html"],
			autoApproved: true,
		})

		expect(execMock).toHaveBeenCalledWith(
			'git rm -f --ignore-unmatch -- "obsolete.html"',
			expect.objectContaining({ cwd: "C:/repo", maxBuffer: 50 * 1024 * 1024 }),
			expect.any(Function),
		)
		expect(fsMock.rm).toHaveBeenCalledWith(expect.stringContaining("obsolete.html"), {
			recursive: true,
			force: true,
		})
		expect(execMock.mock.calls.some(([command]) => String(command).startsWith("git apply"))).toBe(false)
		expect(fsMock.writeFile).not.toHaveBeenCalled()
	})

	it("blocks owned branch apply when the current workspace changed since the baseline", async () => {
		const manager = new WorktreeManager("C:/repo")
		;(manager as any).workspaceBaselines.set("plan-test", {
			planId: "plan-test",
			commit: "baseline123",
			ref: "refs/roo/parallel-baselines/plan-test",
		})
		fsMock.mkdtemp.mockResolvedValue("C:/tmp/roo-parallel-current-snapshot-1")
		mockExecImplementation((command) => {
			if (command === "git rev-parse --show-toplevel") {
				return { stdout: "C:/repo\n" }
			}
			if (command === 'git diff --binary baseline123..."roo/parallel/plan-test/ui-agent" -- "src/index.html"') {
				return { stdout: "diff --git a/src/index.html b/src/index.html\n+<main />\n" }
			}
			if (command === "git read-tree baseline123") {
				return { stdout: "" }
			}
			if (command === 'git ls-files -z -- "src/index.html"') {
				return { stdout: "src/index.html\0" }
			}
			if (command === 'git ls-files --others --exclude-standard -z -- "src/index.html"') {
				return { stdout: "" }
			}
			if (command === 'git add -A -- "src/index.html"') {
				return { stdout: "" }
			}
			if (command === 'git diff --cached --name-only -z baseline123 -- "src/index.html"') {
				return { stdout: "src/index.html\0" }
			}

			throw new Error(`Unexpected command: ${command}`)
		})

		await expect(
			manager.mergeBranch("roo/parallel/plan-test/ui-agent", {
				planId: "plan-test",
				worktreePath: "C:/worktrees/ui-agent",
				ownedPaths: ["src/index.html"],
			}),
		).rejects.toThrow("Current workspace content changed since the parallel baseline")

		expect(fsMock.writeFile).not.toHaveBeenCalled()
		expect(execMock.mock.calls.some(([command]) => String(command).includes("git apply"))).toBe(false)
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

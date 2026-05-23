import path from "path"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export class WorktreeManagerError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "WorktreeManagerError"
	}
}

export function getWorktreeManagerErrorMessage(error: unknown): string {
	if (error instanceof WorktreeManagerError) {
		return error.message
	}

	if (error instanceof Error && error.message) {
		return error.message
	}

	return String(error)
}

function shellQuote(value: string): string {
	return `"${value.replace(/"/g, '\\"')}"`
}

function sanitizeBranchComponent(value: string): string {
	return value
		.trim()
		.replace(/[^a-zA-Z0-9._/-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80)
}

function normalizeGitPath(filePath: string): string {
	return filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "")
}

export class WorktreeManager {
	private readonly createdWorktrees = new Set<string>()
	private gitRoot: string | undefined
	private hasValidatedHead = false

	constructor(private readonly repoRoot: string) {}

	public getCreatedWorktrees(): string[] {
		return Array.from(this.createdWorktrees)
	}

	public async validateGitRepository(): Promise<string> {
		const gitRoot = await this.resolveGitRoot()
		await this.validateHead(gitRoot)
		return gitRoot
	}

	public async createWorktree(agentId: string, planId: string): Promise<string> {
		const gitRoot = await this.validateGitRepository()
		const safePlanId = sanitizeBranchComponent(planId) || "plan"
		const safeAgentId = sanitizeBranchComponent(agentId) || "agent"
		const branchName = `roo/parallel/${safePlanId}/${safeAgentId}`
		const worktreePath = path.join(this.repoRoot, ".roo", "parallel-worktrees", safePlanId, safeAgentId)

		await execAsync(`git worktree add -B ${shellQuote(branchName)} ${shellQuote(worktreePath)} HEAD`, {
			cwd: gitRoot,
		})

		this.createdWorktrees.add(worktreePath)
		return worktreePath
	}

	public async removeWorktree(worktreePath: string): Promise<void> {
		try {
			const gitRoot = await this.resolveGitRoot()
			await execAsync(`git worktree remove --force ${shellQuote(worktreePath)}`, { cwd: gitRoot })
		} finally {
			this.createdWorktrees.delete(worktreePath)
		}
	}

	public async cleanup(): Promise<void> {
		const worktrees = this.getCreatedWorktrees()
		await Promise.allSettled(worktrees.map((worktreePath) => this.removeWorktree(worktreePath)))
	}

	public async prepareMergeReview(params: {
		agentId: string
		planId: string
		worktreePath: string
		branch: string
		ownedPaths?: string[]
	}): Promise<string> {
		const ownedPaths = params.ownedPaths?.map(normalizeGitPath).filter(Boolean)

		if (params.ownedPaths && ownedPaths?.length === 0) {
			return ""
		}

		await this.commitPendingWorktreeChanges({ ...params, ownedPaths })
		return this.getBranchDiff(params.branch, ownedPaths)
	}

	public async mergeBranch(branch: string): Promise<void> {
		const gitRoot = await this.resolveGitRoot()
		await execAsync(`git merge --no-edit ${shellQuote(branch)}`, { cwd: gitRoot })
	}

	private async commitPendingWorktreeChanges(params: {
		agentId: string
		planId: string
		worktreePath: string
		branch: string
		ownedPaths?: string[]
	}): Promise<void> {
		const pathspec = this.formatPathspec(params.ownedPaths)
		const addCommand = pathspec ? `git add -A -- ${pathspec}` : "git add -A -- ."
		await execAsync(addCommand, { cwd: params.worktreePath })

		if (!(await this.hasStagedChanges(params.worktreePath))) {
			return
		}

		const commitMessage = `Parallel agent ${params.agentId} changes for ${params.planId}`
		await execAsync(
			`git -c user.name="Roo Parallel Agent" -c user.email="roo-parallel-agent@localhost" commit --no-verify -m ${shellQuote(commitMessage)}`,
			{ cwd: params.worktreePath },
		)
	}

	private async hasStagedChanges(worktreePath: string): Promise<boolean> {
		try {
			await execAsync("git diff --cached --quiet --exit-code", { cwd: worktreePath })
			return false
		} catch (error) {
			if (error && typeof error === "object" && (error as { code?: number }).code === 1) {
				return true
			}

			throw error
		}
	}

	private async getBranchDiff(branch: string, ownedPaths?: string[]): Promise<string> {
		const gitRoot = await this.resolveGitRoot()
		const pathspec = this.formatPathspec(ownedPaths)
		const pathspecArgs = pathspec ? ` -- ${pathspec}` : ""
		const result = await execAsync(`git diff --binary HEAD...${shellQuote(branch)}${pathspecArgs}`, {
			cwd: gitRoot,
			maxBuffer: 50 * 1024 * 1024,
		})
		const stdout = typeof result === "string" ? result : result.stdout
		return stdout
	}

	private formatPathspec(paths: string[] | undefined): string {
		return paths?.map(shellQuote).join(" ") ?? ""
	}

	private async resolveGitRoot(): Promise<string> {
		if (this.gitRoot) {
			return this.gitRoot
		}

		try {
			const result = await execAsync("git rev-parse --show-toplevel", { cwd: this.repoRoot })
			const stdout = typeof result === "string" ? result : result.stdout
			const gitRoot = stdout.trim()

			if (!gitRoot) {
				throw new WorktreeManagerError(
					`Parallel worktrees require a Git repository. The active workspace (${this.repoRoot}) did not report a Git repository root. Open a Git-backed workspace or initialize Git before approving a parallel plan.`,
				)
			}

			this.gitRoot = gitRoot
			return gitRoot
		} catch (error) {
			if (error instanceof WorktreeManagerError) {
				throw error
			}

			throw new WorktreeManagerError(
				`Parallel worktrees require a Git repository. The active workspace (${this.repoRoot}) is not inside a Git repository. Open a Git-backed workspace or initialize Git before approving a parallel plan.`,
			)
		}
	}

	private async validateHead(gitRoot: string): Promise<void> {
		if (this.hasValidatedHead) {
			return
		}

		try {
			await execAsync("git rev-parse --verify HEAD", { cwd: gitRoot })
			this.hasValidatedHead = true
		} catch {
			throw new WorktreeManagerError(
				"Parallel agents require a Git repository with at least one commit. Commit your current project first, then approve the plan again.",
			)
		}
	}
}

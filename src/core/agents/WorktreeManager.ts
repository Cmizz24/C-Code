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

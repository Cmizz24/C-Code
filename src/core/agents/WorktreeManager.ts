import path from "path"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

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

	constructor(private readonly repoRoot: string) {}

	public getCreatedWorktrees(): string[] {
		return Array.from(this.createdWorktrees)
	}

	public async createWorktree(agentId: string, planId: string): Promise<string> {
		const safePlanId = sanitizeBranchComponent(planId) || "plan"
		const safeAgentId = sanitizeBranchComponent(agentId) || "agent"
		const branchName = `roo/parallel/${safePlanId}/${safeAgentId}`
		const worktreePath = path.join(this.repoRoot, ".roo", "parallel-worktrees", safePlanId, safeAgentId)

		await execAsync(`git worktree add -B ${shellQuote(branchName)} ${shellQuote(worktreePath)} HEAD`, {
			cwd: this.repoRoot,
		})

		this.createdWorktrees.add(worktreePath)
		return worktreePath
	}

	public async removeWorktree(worktreePath: string): Promise<void> {
		try {
			await execAsync(`git worktree remove --force ${shellQuote(worktreePath)}`, { cwd: this.repoRoot })
		} finally {
			this.createdWorktrees.delete(worktreePath)
		}
	}

	public async cleanup(): Promise<void> {
		const worktrees = this.getCreatedWorktrees()
		await Promise.allSettled(worktrees.map((worktreePath) => this.removeWorktree(worktreePath)))
	}
}

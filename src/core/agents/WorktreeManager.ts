import path from "path"
import { exec } from "child_process"
import fs from "fs/promises"
import os from "os"
import { promisify } from "util"
import ignore, { type Ignore } from "ignore"

const execAsync = promisify(exec)

export type WorkspaceBaseline = {
	planId: string
	ref: string
	commit: string
}

export class WorktreeManagerError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "WorktreeManagerError"
	}
}

export type WorktreeMergeFailureStage = "rebase" | "merge"

export class WorktreeMergeError extends WorktreeManagerError {
	constructor(
		readonly stage: WorktreeMergeFailureStage,
		readonly branch: string,
		readonly cwd: string,
		readonly conflictedFiles: string[],
		readonly abortError: string | undefined,
		readonly originalError: string,
	) {
		super(formatMergeFailureMessage(stage, branch, conflictedFiles, abortError, originalError))
		this.name = "WorktreeMergeError"
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

function formatGitFailure(error: unknown): string {
	if (error && typeof error === "object") {
		const maybeOutput = error as { stdout?: string; stderr?: string; message?: string }
		return [maybeOutput.stdout, maybeOutput.stderr, maybeOutput.message].filter(Boolean).join("\n")
	}

	return String(error)
}

function formatMergeFailureMessage(
	stage: WorktreeMergeFailureStage,
	branch: string,
	conflictedFiles: string[],
	abortError: string | undefined,
	originalError: string,
): string {
	const action = stage === "rebase" ? "rebase" : "merge"
	const target = stage === "rebase" ? "onto the current workspace HEAD" : "into the workspace"
	const cleanupMessage = abortError
		? `Roo attempted to abort the in-progress ${action}, but Git returned:\n${abortError}`
		: `Roo aborted the in-progress ${action} so the repository/worktree is ready for manual review.`
	const conflictMessage = conflictedFiles.length > 0 ? `\nConflicted files:\n- ${conflictedFiles.join("\n- ")}` : ""
	const gitMessage = originalError ? `\n\nGit output:\n${originalError}` : ""

	return `Failed to ${action} parallel agent branch ${branch} ${target}.${conflictMessage}\n${cleanupMessage}${gitMessage}`
}

export class WorktreeManager {
	private readonly createdWorktrees = new Set<string>()
	private readonly workspaceBaselines = new Map<string, WorkspaceBaseline>()
	private readonly workspaceBaselineCaptures = new Map<string, Promise<WorkspaceBaseline>>()
	private rooIgnoreMatcher: Ignore | undefined
	private hasLoadedRooIgnoreMatcher = false
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

	public async captureWorkspaceBaseline(planId: string): Promise<WorkspaceBaseline> {
		const existing = this.workspaceBaselines.get(planId)
		if (existing) {
			return existing
		}

		const pending = this.workspaceBaselineCaptures.get(planId)
		if (pending) {
			return pending
		}

		const capture = this.createWorkspaceBaseline(planId)
		this.workspaceBaselineCaptures.set(planId, capture)

		try {
			const baseline = await capture
			this.workspaceBaselines.set(planId, baseline)
			return baseline
		} finally {
			this.workspaceBaselineCaptures.delete(planId)
		}
	}

	public async createWorktree(agentId: string, planId: string): Promise<string> {
		const gitRoot = await this.validateGitRepository()
		const baseline = await this.captureWorkspaceBaseline(planId)
		const safePlanId = sanitizeBranchComponent(planId) || "plan"
		const safeAgentId = sanitizeBranchComponent(agentId) || "agent"
		const branchName = `roo/parallel/${safePlanId}/${safeAgentId}`
		const worktreePath = path.join(this.repoRoot, ".roo", "parallel-worktrees", safePlanId, safeAgentId)

		await execAsync(
			`git worktree add -B ${shellQuote(branchName)} ${shellQuote(worktreePath)} ${baseline.commit}`,
			{
				cwd: gitRoot,
			},
		)

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
		await Promise.allSettled(
			Array.from(this.workspaceBaselines.values()).map((baseline) => this.deleteBaselineRef(baseline.ref)),
		)
		this.workspaceBaselines.clear()
		this.workspaceBaselineCaptures.clear()
	}

	public async cleanupPlanBaseline(planId: string): Promise<void> {
		const baseline = this.workspaceBaselines.get(planId)
		if (!baseline) {
			return
		}

		try {
			await this.deleteBaselineRef(baseline.ref).catch(() => undefined)
		} finally {
			this.workspaceBaselines.delete(planId)
			this.workspaceBaselineCaptures.delete(planId)
		}
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
		return this.getBranchDiff(params.branch, ownedPaths, this.workspaceBaselines.get(params.planId)?.commit)
	}

	public async mergeBranch(branch: string, params: { planId?: string; worktreePath?: string } = {}): Promise<void> {
		const gitRoot = await this.resolveGitRoot()
		const baseline = params.planId ? this.workspaceBaselines.get(params.planId) : undefined

		if (baseline && params.worktreePath) {
			const currentHead = await this.getCurrentHead(gitRoot)
			const branchCommitCount = await this.getCommitCount(params.worktreePath, `${baseline.commit}..${branch}`)

			if (branchCommitCount === 0) {
				await execAsync(`git reset --hard ${currentHead}`, { cwd: params.worktreePath })
			} else {
				try {
					await execAsync(`git rebase --onto ${currentHead} ${baseline.commit}`, { cwd: params.worktreePath })
				} catch (error) {
					const conflictedFiles = await this.getConflictedFiles(params.worktreePath)
					const abortError = await this.abortGitOperation(params.worktreePath, "rebase")
					throw new WorktreeMergeError(
						"rebase",
						branch,
						params.worktreePath,
						conflictedFiles,
						abortError,
						formatGitFailure(error),
					)
				}
			}
		}

		try {
			await execAsync(`git merge --no-edit ${shellQuote(branch)}`, { cwd: gitRoot })
		} catch (error) {
			const conflictedFiles = await this.getConflictedFiles(gitRoot)
			const abortError = await this.abortGitOperation(gitRoot, "merge")
			throw new WorktreeMergeError("merge", branch, gitRoot, conflictedFiles, abortError, formatGitFailure(error))
		}
	}

	private async abortGitOperation(cwd: string, operation: WorktreeMergeFailureStage): Promise<string | undefined> {
		try {
			await execAsync(`git ${operation} --abort`, { cwd })
			return undefined
		} catch (error) {
			return formatGitFailure(error)
		}
	}

	private async createWorkspaceBaseline(planId: string): Promise<WorkspaceBaseline> {
		const gitRoot = await this.validateGitRepository()
		const safePlanId = sanitizeBranchComponent(planId) || "plan"
		const ref = `refs/roo/parallel-baselines/${safePlanId}`
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-parallel-baseline-"))
		const tempIndexPath = path.join(tempDir, "index")
		const tempIndexEnv = { ...process.env, GIT_INDEX_FILE: tempIndexPath }

		try {
			await execAsync("git read-tree HEAD", { cwd: gitRoot, env: tempIndexEnv })

			const candidatePaths = await this.getBaselineCandidatePaths(gitRoot)
			const allowedPaths = await this.filterAllowedBaselinePaths(gitRoot, candidatePaths)
			await this.stageBaselinePaths(gitRoot, allowedPaths, tempIndexEnv)

			const trackedPaths = await this.getNullSeparatedGitOutput("git ls-files -z", gitRoot, tempIndexEnv)
			const excludedTrackedPaths = await this.filterExcludedBaselinePaths(gitRoot, trackedPaths)
			await this.removeBaselinePaths(gitRoot, excludedTrackedPaths, tempIndexEnv)

			const treeResult = await execAsync("git write-tree", { cwd: gitRoot, env: tempIndexEnv })
			const tree = (typeof treeResult === "string" ? treeResult : treeResult.stdout).trim()
			const commitMessage = `Roo parallel workspace baseline for ${planId}`
			const commitResult = await execAsync(
				`git -c user.name="Roo Parallel Agent" -c user.email="roo-parallel-agent@localhost" commit-tree ${tree} -p HEAD -m ${shellQuote(commitMessage)}`,
				{ cwd: gitRoot },
			)
			const commit = (typeof commitResult === "string" ? commitResult : commitResult.stdout).trim()

			await execAsync(`git update-ref ${shellQuote(ref)} ${commit}`, { cwd: gitRoot })

			return { planId, ref, commit }
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	}

	private async getBaselineCandidatePaths(gitRoot: string): Promise<string[]> {
		const trackedChanges = await this.getNullSeparatedGitOutput("git diff --name-only -z HEAD --", gitRoot)
		const untrackedFiles = await this.getNullSeparatedGitOutput(
			"git ls-files --others --exclude-standard -z",
			gitRoot,
		)
		const uniquePaths = new Set<string>()

		for (const filePath of [...trackedChanges, ...untrackedFiles]) {
			const normalizedPath = normalizeGitPath(filePath)
			if (normalizedPath) {
				uniquePaths.add(normalizedPath)
			}
		}

		return Array.from(uniquePaths)
	}

	private async filterAllowedBaselinePaths(gitRoot: string, filePaths: string[]): Promise<string[]> {
		const allowedPaths: string[] = []

		for (const filePath of filePaths) {
			if (!(await this.shouldExcludeFromBaseline(gitRoot, filePath))) {
				allowedPaths.push(filePath)
			}
		}

		return allowedPaths
	}

	private async filterExcludedBaselinePaths(gitRoot: string, filePaths: string[]): Promise<string[]> {
		const excludedPaths: string[] = []

		for (const filePath of filePaths) {
			if (await this.shouldExcludeFromBaseline(gitRoot, filePath)) {
				excludedPaths.push(filePath)
			}
		}

		return excludedPaths
	}

	private async shouldExcludeFromBaseline(gitRoot: string, filePath: string): Promise<boolean> {
		const normalizedPath = normalizeGitPath(filePath)
		if (!normalizedPath) {
			return true
		}

		if (
			normalizedPath === ".roo/parallel-worktrees" ||
			normalizedPath.startsWith(".roo/parallel-worktrees/") ||
			normalizedPath.includes("/.roo/parallel-worktrees/")
		) {
			return true
		}

		const basename = path.posix.basename(normalizedPath)
		if (normalizedPath === ".rooignore" || basename === ".rooignore") {
			return true
		}

		if (
			normalizedPath === ".env" ||
			normalizedPath.startsWith(".env/") ||
			normalizedPath.includes("/.env/") ||
			basename.startsWith(".env")
		) {
			return true
		}

		const rooIgnoreMatcher = await this.loadRooIgnoreMatcher(gitRoot)
		return rooIgnoreMatcher?.ignores(normalizedPath) ?? false
	}

	private async loadRooIgnoreMatcher(gitRoot: string): Promise<Ignore | undefined> {
		if (this.hasLoadedRooIgnoreMatcher) {
			return this.rooIgnoreMatcher
		}

		this.hasLoadedRooIgnoreMatcher = true

		try {
			const content = await fs.readFile(path.join(gitRoot, ".rooignore"), "utf8")
			this.rooIgnoreMatcher = ignore().add(content)
		} catch (error) {
			if (error && typeof error === "object" && (error as { code?: string }).code !== "ENOENT") {
				throw error
			}
		}

		return this.rooIgnoreMatcher
	}

	private async stageBaselinePaths(gitRoot: string, filePaths: string[], env: NodeJS.ProcessEnv): Promise<void> {
		for (const chunk of this.chunkPathspecs(filePaths)) {
			await execAsync(`git add -A -- ${this.formatPathspec(chunk)}`, { cwd: gitRoot, env })
		}
	}

	private async removeBaselinePaths(gitRoot: string, filePaths: string[], env: NodeJS.ProcessEnv): Promise<void> {
		for (const chunk of this.chunkPathspecs(filePaths)) {
			await execAsync(`git rm --cached --ignore-unmatch -- ${this.formatPathspec(chunk)}`, { cwd: gitRoot, env })
		}
	}

	private chunkPathspecs(filePaths: string[]): string[][] {
		const chunkSize = 100
		const chunks: string[][] = []

		for (let index = 0; index < filePaths.length; index += chunkSize) {
			chunks.push(filePaths.slice(index, index + chunkSize))
		}

		return chunks
	}

	private async getNullSeparatedGitOutput(command: string, cwd: string, env?: NodeJS.ProcessEnv): Promise<string[]> {
		const result = await execAsync(command, { cwd, env, maxBuffer: 50 * 1024 * 1024 })
		const stdout = typeof result === "string" ? result : result.stdout
		return stdout
			.split("\0")
			.map((value) => normalizeGitPath(value))
			.filter(Boolean)
	}

	private async getCommitCount(cwd: string, revisionRange: string): Promise<number> {
		const result = await execAsync(`git rev-list --count ${revisionRange}`, { cwd })
		const stdout = typeof result === "string" ? result : result.stdout
		return Number(stdout.trim()) || 0
	}

	private async getConflictedFiles(cwd: string): Promise<string[]> {
		try {
			return await this.getNullSeparatedGitOutput("git diff --name-only --diff-filter=U -z", cwd)
		} catch {
			return []
		}
	}

	private async getCurrentHead(gitRoot: string): Promise<string> {
		const result = await execAsync("git rev-parse HEAD", { cwd: gitRoot })
		const stdout = typeof result === "string" ? result : result.stdout
		return stdout.trim()
	}

	private async deleteBaselineRef(ref: string): Promise<void> {
		const gitRoot = await this.resolveGitRoot()
		await execAsync(`git update-ref -d ${shellQuote(ref)}`, { cwd: gitRoot })
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

	private async getBranchDiff(branch: string, ownedPaths?: string[], baseRef = "HEAD"): Promise<string> {
		const gitRoot = await this.resolveGitRoot()
		const pathspec = this.formatPathspec(ownedPaths)
		const pathspecArgs = pathspec ? ` -- ${pathspec}` : ""
		const result = await execAsync(`git diff --binary ${baseRef}...${shellQuote(branch)}${pathspecArgs}`, {
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

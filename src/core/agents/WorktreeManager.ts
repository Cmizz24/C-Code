import path from "path"
import { exec } from "child_process"
import { createHash } from "crypto"
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

export type WorktreeMergeReviewPathDiagnostic = {
	originalPath: string
	workspaceRelativePath: string
	worktreePath: string
	rootWorkspacePath?: string
	existsInWorktree: boolean
	existsInRootWorkspace?: boolean
}

export type WorktreeMergeReviewDiagnostics = {
	planId: string
	agentId: string
	branch: string
	worktreePath: string
	originalOwnedPaths?: string[]
	normalizedOwnedPaths?: string[]
	pathDiagnostics?: WorktreeMergeReviewPathDiagnostic[]
	trackedChangedPaths?: string[]
	untrackedChangedPaths?: string[]
	stagedPaths?: string[]
	commitCreated?: boolean
	result:
		| "all-worktree-changes-staged"
		| "owned-changes-staged"
		| "no-owned-worktree-changes"
		| "no-staged-changes"
		| "committed"
}

export type WorktreeMergeReviewDiagnosticsCallback = (diagnostics: WorktreeMergeReviewDiagnostics) => void

type WorktreeChangedPathSet = {
	trackedChangedPaths: string[]
	untrackedChangedPaths: string[]
	changedPaths: string[]
}

export type ReusableWorktreeInspection =
	| {
			reusable: true
			worktreePath: string
			branch: string
			repositoryRoot: string
			gitCommonDir: string
			currentHead: string
			worktreeHead: string
			resetRequired: boolean
	  }
	| {
			reusable: false
			reason: string
			worktreePath?: string
			branch?: string
			repositoryRoot?: string
			nonRetryable?: boolean
	  }

export type ReusedWorktreeResult = {
	worktreePath: string
	branch: string
	repositoryRoot: string
	resetToCurrentBaseline: boolean
}

export class WorktreeManagerError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "WorktreeManagerError"
	}
}

export class WorktreeManagerGitUnavailableError extends WorktreeManagerError {
	constructor(message: string) {
		super(message)
		this.name = "WorktreeManagerGitUnavailableError"
	}
}

export type WorktreeMergeFailureStage = "rebase" | "merge" | "apply"

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

export function isWorktreeManagerGitUnavailableError(error: unknown): boolean {
	return error instanceof WorktreeManagerGitUnavailableError || isGitExecutableUnavailableError(error)
}

function getErrorCode(error: unknown): string | number | undefined {
	if (!error || typeof error !== "object") {
		return undefined
	}

	return (error as { code?: string | number }).code
}

function isGitExecutableUnavailableError(error: unknown): boolean {
	const code = getErrorCode(error)
	const message = formatGitFailure(error)

	return code === "ENOENT" || code === "ENOTDIR" || isGitExecutableUnavailableMessage(message)
}

function isGitExecutableUnavailableMessage(message: string): boolean {
	return (
		/\bgit(?:\.exe)?\b[\s\S]*\bENOENT\b/i.test(message) ||
		/\bENOENT\b[\s\S]*\bgit(?:\.exe)?\b/i.test(message) ||
		/'git' is not recognized as an internal or external command/i.test(message) ||
		/\bgit: command not found\b/i.test(message) ||
		/\bcommand not found: git\b/i.test(message) ||
		/\bunable to find git executable\b/i.test(message)
	)
}

function formatGitUnavailableMessage(error: unknown, cwd: string): string {
	const details = formatGitFailure(error).trim()
	return `Git executable unavailable while preparing parallel worktrees from ${cwd}. Ensure Git is installed and available on PATH, or update VS Code's Git: Path setting to an existing git executable.${details ? `\n${details}` : ""}`
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

export function getParallelAgentBranchName(planId: string, agentId: string): string {
	return `roo/parallel/${sanitizeBranchComponent(planId) || "plan"}/${sanitizeBranchComponent(agentId) || "agent"}`
}

function sanitizePathComponent(value: string): string {
	return sanitizeBranchComponent(value)
		.replace(/[\\/]+/g, "-")
		.replace(/^-+|-+$/g, "")
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
	const action = stage === "rebase" ? "rebase" : stage === "apply" ? "apply" : "merge"
	const target =
		stage === "rebase"
			? "onto the current workspace HEAD"
			: stage === "apply"
				? "to the workspace"
				: "into the workspace"
	const cleanupMessage =
		stage === "apply"
			? abortError
				? `Roo attempted to clean up the failed patch application, but Git returned:\n${abortError}`
				: "Roo stopped before applying unsafe patch changes so the workspace is ready for manual review."
			: abortError
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

	public async restoreWorkspaceBaseline(planId: string): Promise<WorkspaceBaseline | undefined> {
		const existing = this.workspaceBaselines.get(planId)
		if (existing) {
			return existing
		}

		const gitRoot = await this.validateGitRepository()
		const safePlanId = sanitizeBranchComponent(planId) || "plan"
		const ref = `refs/roo/parallel-baselines/${safePlanId}`

		try {
			const result = await execAsync(`git rev-parse --verify ${shellQuote(ref)}`, { cwd: gitRoot })
			const commit = (typeof result === "string" ? result : result.stdout).trim()
			const baseline = { planId, ref, commit }
			this.workspaceBaselines.set(planId, baseline)
			return baseline
		} catch {
			return undefined
		}
	}

	public async createWorktree(agentId: string, planId: string): Promise<string> {
		const gitRoot = await this.validateGitRepository()
		const baseline = await this.captureWorkspaceBaseline(planId)
		const safePlanId = sanitizeBranchComponent(planId) || "plan"
		const safeAgentId = sanitizeBranchComponent(agentId) || "agent"
		const branchName = getParallelAgentBranchName(planId, agentId)
		const worktreePath = this.getParallelWorktreePath(gitRoot, safePlanId, safeAgentId)

		await this.removeExistingWorktreeAtPath(gitRoot, worktreePath)

		try {
			await execAsync(
				`git worktree add -B ${shellQuote(branchName)} ${shellQuote(worktreePath)} ${baseline.commit}`,
				{
					cwd: gitRoot,
				},
			)
		} catch (error) {
			if (isGitExecutableUnavailableError(error)) {
				throw new WorktreeManagerGitUnavailableError(formatGitUnavailableMessage(error, gitRoot))
			}

			throw error
		}

		this.createdWorktrees.add(worktreePath)
		return worktreePath
	}

	public async inspectReusableWorktree(params: {
		worktreePath: string
		branch: string
		expectedRepositoryRoot?: string
	}): Promise<ReusableWorktreeInspection> {
		const worktreePath = params.worktreePath
		const branch = params.branch

		if (!worktreePath || !branch) {
			return { reusable: false, reason: "missing reusable worktree path or branch", worktreePath, branch }
		}

		let gitRoot: string
		try {
			gitRoot = await this.validateGitRepository()
		} catch (error) {
			return {
				reusable: false,
				reason: getWorktreeManagerErrorMessage(error),
				worktreePath,
				branch,
				nonRetryable: isWorktreeManagerGitUnavailableError(error),
			}
		}

		if (params.expectedRepositoryRoot && !this.areComparablePathsEqual(params.expectedRepositoryRoot, gitRoot)) {
			return {
				reusable: false,
				reason: "repository root changed since the prior parallel-agent run",
				worktreePath,
				branch,
				repositoryRoot: gitRoot,
			}
		}

		try {
			await fs.stat(worktreePath)
		} catch {
			return {
				reusable: false,
				reason: "retained worktree path is missing",
				worktreePath,
				branch,
				repositoryRoot: gitRoot,
			}
		}

		try {
			const rootCommonDir = await this.getGitCommonDir(gitRoot)
			const worktreeCommonDir = await this.getGitCommonDir(worktreePath)
			if (!this.areComparablePathsEqual(rootCommonDir, worktreeCommonDir)) {
				return {
					reusable: false,
					reason: "retained worktree belongs to a different Git repository",
					worktreePath,
					branch,
					repositoryRoot: gitRoot,
				}
			}

			const currentBranchResult = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: worktreePath })
			const currentBranch = (
				typeof currentBranchResult === "string" ? currentBranchResult : currentBranchResult.stdout
			).trim()
			if (currentBranch !== branch) {
				return {
					reusable: false,
					reason: `retained worktree is on branch ${currentBranch || "unknown"} instead of ${branch}`,
					worktreePath,
					branch,
					repositoryRoot: gitRoot,
				}
			}

			const statusResult = await execAsync("git status --porcelain=v1 --untracked-files=all", {
				cwd: worktreePath,
			})
			const status = (typeof statusResult === "string" ? statusResult : statusResult.stdout).trim()
			if (status) {
				return {
					reusable: false,
					reason: "retained worktree has uncommitted or untracked changes",
					worktreePath,
					branch,
					repositoryRoot: gitRoot,
				}
			}

			const currentHead = await this.getCurrentHead(gitRoot)
			const worktreeHead = await this.getCurrentHead(worktreePath)

			return {
				reusable: true,
				worktreePath,
				branch,
				repositoryRoot: gitRoot,
				gitCommonDir: rootCommonDir,
				currentHead,
				worktreeHead,
				resetRequired: currentHead !== worktreeHead,
			}
		} catch (error) {
			return {
				reusable: false,
				reason: getWorktreeManagerErrorMessage(error),
				worktreePath,
				branch,
				repositoryRoot: gitRoot,
				nonRetryable: isWorktreeManagerGitUnavailableError(error),
			}
		}
	}

	public async reuseWorktree(params: {
		worktreePath: string
		sourceBranch: string
		newBranch: string
	}): Promise<ReusedWorktreeResult> {
		const inspection = await this.inspectReusableWorktree({
			worktreePath: params.worktreePath,
			branch: params.sourceBranch,
		})

		if (!inspection.reusable) {
			const message = `Cannot reuse retained worktree: ${inspection.reason}.`
			if (inspection.nonRetryable) {
				throw new WorktreeManagerGitUnavailableError(message)
			}

			throw new WorktreeManagerError(message)
		}

		try {
			await execAsync(`git checkout -B ${shellQuote(params.newBranch)} ${inspection.currentHead}`, {
				cwd: params.worktreePath,
			})
			await execAsync(`git reset --hard ${inspection.currentHead}`, { cwd: params.worktreePath })
			await execAsync("git clean -fd", { cwd: params.worktreePath })
		} catch (error) {
			if (isGitExecutableUnavailableError(error)) {
				throw new WorktreeManagerGitUnavailableError(formatGitUnavailableMessage(error, params.worktreePath))
			}

			throw error
		}

		this.createdWorktrees.add(params.worktreePath)

		return {
			worktreePath: params.worktreePath,
			branch: params.newBranch,
			repositoryRoot: inspection.repositoryRoot,
			resetToCurrentBaseline: inspection.resetRequired,
		}
	}

	private getParallelWorktreePath(gitRoot: string, safePlanId: string, safeAgentId: string): string {
		const resolvedGitRoot = path.resolve(gitRoot)
		const repoName = sanitizePathComponent(path.basename(resolvedGitRoot)) || "repo"
		const repoHash = createHash("sha1").update(resolvedGitRoot.toLowerCase()).digest("hex").slice(0, 12)

		return path.join(
			os.homedir(),
			".roo",
			"parallel-worktrees",
			`${repoName}-${repoHash}`,
			sanitizePathComponent(safePlanId) || "plan",
			sanitizePathComponent(safeAgentId) || "agent",
		)
	}

	public async removeWorktree(worktreePath: string): Promise<void> {
		try {
			const gitRoot = await this.resolveGitRoot()
			try {
				await execAsync(`git worktree remove --force ${shellQuote(worktreePath)}`, { cwd: gitRoot })
			} catch (error) {
				if (isGitExecutableUnavailableError(error)) {
					throw new WorktreeManagerGitUnavailableError(formatGitUnavailableMessage(error, gitRoot))
				}

				throw error
			}
		} finally {
			this.createdWorktrees.delete(worktreePath)
		}
	}

	public forgetWorktree(worktreePath: string): void {
		this.createdWorktrees.delete(worktreePath)
	}

	private async removeExistingWorktreeAtPath(gitRoot: string, worktreePath: string): Promise<void> {
		try {
			await fs.stat(worktreePath)
		} catch {
			return
		}

		try {
			await execAsync(`git worktree remove --force ${shellQuote(worktreePath)}`, { cwd: gitRoot })
		} catch {
			await fs.rm(worktreePath, { recursive: true, force: true })
		}

		this.createdWorktrees.delete(worktreePath)
	}

	public async cleanup(options: { retainWorktreePaths?: string[] } = {}): Promise<void> {
		const retainedWorktrees = new Set(
			(options.retainWorktreePaths ?? []).map((worktreePath) => this.normalizeComparablePath(worktreePath)),
		)
		const worktrees = this.getCreatedWorktrees()
		await Promise.allSettled(
			worktrees.map((worktreePath) => {
				if (retainedWorktrees.has(this.normalizeComparablePath(worktreePath))) {
					this.forgetWorktree(worktreePath)
					return Promise.resolve()
				}

				return this.removeWorktree(worktreePath)
			}),
		)
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
		onDiagnostics?: WorktreeMergeReviewDiagnosticsCallback
	}): Promise<string> {
		const ownedPaths = params.ownedPaths?.map(normalizeGitPath).filter(Boolean)

		if (params.ownedPaths && ownedPaths?.length === 0) {
			return ""
		}

		await this.commitPendingWorktreeChanges({ ...params, originalOwnedPaths: params.ownedPaths, ownedPaths })
		return this.getBranchDiff(params.branch, ownedPaths, this.workspaceBaselines.get(params.planId)?.commit)
	}

	public async mergeBranch(
		branch: string,
		params: { planId?: string; worktreePath?: string; ownedPaths?: string[]; autoApproved?: boolean } = {},
	): Promise<void> {
		const gitRoot = await this.resolveGitRoot()
		const baseline = params.planId ? this.workspaceBaselines.get(params.planId) : undefined
		const ownedPaths = params.ownedPaths?.map(normalizeGitPath).filter(Boolean)

		if (baseline && ownedPaths?.length) {
			if (params.autoApproved) {
				await this.materializeOwnedBranchChanges(branch, {
					gitRoot,
					baselineCommit: baseline.commit,
					ownedPaths,
				})
			} else {
				await this.applyOwnedBranchDiff(branch, {
					gitRoot,
					baselineCommit: baseline.commit,
					ownedPaths,
				})
			}

			return
		}

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

	private async materializeOwnedBranchChanges(
		branch: string,
		params: { gitRoot: string; baselineCommit: string; ownedPaths: string[] },
	): Promise<void> {
		let changedPaths = params.ownedPaths

		try {
			changedPaths = await this.getOwnedBranchChangedPaths(
				params.gitRoot,
				branch,
				params.baselineCommit,
				params.ownedPaths,
			)

			if (changedPaths.length === 0) {
				return
			}

			const pathsToCheckout: string[] = []
			const pathsToRemove: string[] = []

			for (const filePath of changedPaths) {
				if (await this.branchPathExists(params.gitRoot, branch, filePath)) {
					pathsToCheckout.push(filePath)
				} else {
					pathsToRemove.push(filePath)
				}
			}

			await this.checkoutOwnedPathsFromBranch(params.gitRoot, branch, pathsToCheckout)
			await this.removeOwnedPaths(params.gitRoot, pathsToRemove)
		} catch (error) {
			throw new WorktreeMergeError(
				"apply",
				branch,
				params.gitRoot,
				changedPaths.length > 0 ? changedPaths : params.ownedPaths,
				undefined,
				formatGitFailure(error),
			)
		}
	}

	private async getOwnedBranchChangedPaths(
		gitRoot: string,
		branch: string,
		baselineCommit: string,
		ownedPaths: string[],
	): Promise<string[]> {
		const pathspec = this.formatPathspec(ownedPaths)
		const pathspecArgs = pathspec ? ` -- ${pathspec}` : ""
		const changedPaths = await this.getNullSeparatedGitOutput(
			`git diff --name-only -z --no-renames ${baselineCommit}...${shellQuote(branch)}${pathspecArgs}`,
			gitRoot,
		)
		const uniqueChangedPaths = new Set<string>()

		for (const changedPath of changedPaths) {
			if (this.isPathWithinOwnedPaths(changedPath, ownedPaths)) {
				uniqueChangedPaths.add(changedPath)
			}
		}

		return Array.from(uniqueChangedPaths)
	}

	private isPathWithinOwnedPaths(filePath: string, ownedPaths: string[]): boolean {
		const normalizedFilePath = normalizeGitPath(filePath)

		return ownedPaths.some((ownedPath) => {
			const normalizedOwnedPath = normalizeGitPath(ownedPath)
			return (
				normalizedOwnedPath === "." ||
				normalizedFilePath === normalizedOwnedPath ||
				normalizedFilePath.startsWith(`${normalizedOwnedPath}/`)
			)
		})
	}

	private async branchPathExists(gitRoot: string, branch: string, filePath: string): Promise<boolean> {
		try {
			await execAsync(`git cat-file -e ${shellQuote(`${branch}:${filePath}`)}`, { cwd: gitRoot })
			return true
		} catch {
			return false
		}
	}

	private async checkoutOwnedPathsFromBranch(gitRoot: string, branch: string, filePaths: string[]): Promise<void> {
		for (const chunk of this.chunkPathspecs(filePaths)) {
			const checkoutCommand = `git checkout -f ${shellQuote(branch)} -- ${this.formatPathspec(chunk)}`

			try {
				await execAsync(checkoutCommand, { cwd: gitRoot, maxBuffer: 50 * 1024 * 1024 })
			} catch {
				await Promise.all(
					chunk.map((filePath) => fs.rm(path.join(gitRoot, filePath), { recursive: true, force: true })),
				)
				await execAsync(checkoutCommand, { cwd: gitRoot, maxBuffer: 50 * 1024 * 1024 })
			}
		}
	}

	private async removeOwnedPaths(gitRoot: string, filePaths: string[]): Promise<void> {
		for (const chunk of this.chunkPathspecs(filePaths)) {
			await execAsync(`git rm -f --ignore-unmatch -- ${this.formatPathspec(chunk)}`, {
				cwd: gitRoot,
				maxBuffer: 50 * 1024 * 1024,
			})
			await Promise.all(
				chunk.map((filePath) => fs.rm(path.join(gitRoot, filePath), { recursive: true, force: true })),
			)
		}
	}

	private async applyOwnedBranchDiff(
		branch: string,
		params: { gitRoot: string; baselineCommit: string; ownedPaths: string[] },
	): Promise<void> {
		const diff = await this.getBranchDiff(branch, params.ownedPaths, params.baselineCommit)
		if (!diff.trim()) {
			return
		}

		const changedPaths = await this.getWorkspaceChangesSinceBaseline(
			params.gitRoot,
			params.baselineCommit,
			params.ownedPaths,
		)
		if (changedPaths.length > 0) {
			throw new WorktreeMergeError(
				"apply",
				branch,
				params.gitRoot,
				changedPaths,
				undefined,
				`Current workspace content changed since the parallel baseline for owned paths:\n- ${changedPaths.join("\n- ")}`,
			)
		}

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-parallel-merge-patch-"))
		const patchPath = path.join(tempDir, "agent.diff")

		try {
			await fs.writeFile(patchPath, diff, "utf8")
			await execAsync(`git apply --binary --3way --check ${shellQuote(patchPath)}`, {
				cwd: params.gitRoot,
				maxBuffer: 50 * 1024 * 1024,
			})
			await execAsync(`git apply --binary --3way ${shellQuote(patchPath)}`, {
				cwd: params.gitRoot,
				maxBuffer: 50 * 1024 * 1024,
			})
		} catch (error) {
			const conflictedFiles = await this.getConflictedFiles(params.gitRoot)
			throw new WorktreeMergeError(
				"apply",
				branch,
				params.gitRoot,
				conflictedFiles.length > 0 ? conflictedFiles : params.ownedPaths,
				undefined,
				formatGitFailure(error),
			)
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	}

	private async getWorkspaceChangesSinceBaseline(
		gitRoot: string,
		baselineCommit: string,
		ownedPaths: string[],
	): Promise<string[]> {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-parallel-current-snapshot-"))
		const tempIndexPath = path.join(tempDir, "index")
		const tempIndexEnv = { ...process.env, GIT_INDEX_FILE: tempIndexPath }

		try {
			await execAsync(`git read-tree ${baselineCommit}`, { cwd: gitRoot, env: tempIndexEnv })
			const currentSnapshotPaths = await this.getCurrentSnapshotPaths(gitRoot, ownedPaths, tempIndexEnv)

			for (const chunk of this.chunkPathspecs(currentSnapshotPaths)) {
				await execAsync(`git add -A -- ${this.formatPathspec(chunk)}`, { cwd: gitRoot, env: tempIndexEnv })
			}

			const pathspec = this.formatPathspec(ownedPaths)
			const pathspecArgs = pathspec ? ` -- ${pathspec}` : ""
			return await this.getNullSeparatedGitOutput(
				`git diff --cached --name-only -z ${baselineCommit}${pathspecArgs}`,
				gitRoot,
				tempIndexEnv,
			)
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	}

	private async getCurrentSnapshotPaths(
		gitRoot: string,
		ownedPaths: string[],
		env: NodeJS.ProcessEnv,
	): Promise<string[]> {
		const currentSnapshotPaths = new Set<string>()

		for (const chunk of this.chunkPathspecs(ownedPaths)) {
			const pathspec = this.formatPathspec(chunk)
			const baselinePaths = await this.getNullSeparatedGitOutput(`git ls-files -z -- ${pathspec}`, gitRoot, env)
			const untrackedPaths = await this.getNullSeparatedGitOutput(
				`git ls-files --others --exclude-standard -z -- ${pathspec}`,
				gitRoot,
				env,
			)

			for (const filePath of [...baselinePaths, ...untrackedPaths]) {
				currentSnapshotPaths.add(filePath)
			}
		}

		return Array.from(currentSnapshotPaths)
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

	private async getGitCommonDir(cwd: string): Promise<string> {
		const result = await execAsync("git rev-parse --git-common-dir", { cwd })
		const stdout = typeof result === "string" ? result : result.stdout
		const commonDir = stdout.trim()
		return path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir)
	}

	private normalizeComparablePath(filePath: string): string {
		const normalized = path.resolve(filePath).replace(/\\/g, "/").replace(/\/+$/g, "")
		return process.platform === "win32" ? normalized.toLowerCase() : normalized
	}

	private areComparablePathsEqual(left: string, right: string): boolean {
		return this.normalizeComparablePath(left) === this.normalizeComparablePath(right)
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
		originalOwnedPaths?: string[]
		ownedPaths?: string[]
		onDiagnostics?: WorktreeMergeReviewDiagnosticsCallback
	}): Promise<void> {
		let pathDiagnostics: WorktreeMergeReviewPathDiagnostic[] | undefined
		let trackedChangedPaths: string[] | undefined
		let untrackedChangedPaths: string[] | undefined
		let stagedPaths: string[] | undefined
		let commitCreated = false

		const emitDiagnostics = (result: WorktreeMergeReviewDiagnostics["result"]): void => {
			params.onDiagnostics?.({
				planId: params.planId,
				agentId: params.agentId,
				branch: params.branch,
				worktreePath: params.worktreePath,
				originalOwnedPaths: params.originalOwnedPaths,
				normalizedOwnedPaths: params.ownedPaths,
				pathDiagnostics,
				trackedChangedPaths,
				untrackedChangedPaths,
				stagedPaths,
				commitCreated,
				result,
			})
		}

		if (params.ownedPaths?.length) {
			pathDiagnostics = params.onDiagnostics
				? await this.getMergeReviewPathDiagnostics(
						params.worktreePath,
						params.ownedPaths,
						params.originalOwnedPaths,
					)
				: undefined

			const changedPathSet = await this.getOwnedWorktreeChangedPaths(params.worktreePath, params.ownedPaths)
			trackedChangedPaths = changedPathSet.trackedChangedPaths
			untrackedChangedPaths = changedPathSet.untrackedChangedPaths
			stagedPaths = changedPathSet.changedPaths

			if (stagedPaths.length === 0) {
				emitDiagnostics("no-owned-worktree-changes")
				return
			}

			for (const chunk of this.chunkPathspecs(stagedPaths)) {
				await execAsync(`git add -A -- ${this.formatPathspec(chunk)}`, { cwd: params.worktreePath })
			}
		} else {
			await execAsync("git add -A -- .", { cwd: params.worktreePath })
		}

		if (!(await this.hasStagedChanges(params.worktreePath))) {
			emitDiagnostics("no-staged-changes")
			return
		}

		const commitMessage = `Parallel agent ${params.agentId} changes for ${params.planId}`
		await execAsync(
			`git -c user.name="Roo Parallel Agent" -c user.email="roo-parallel-agent@localhost" commit --no-verify -m ${shellQuote(commitMessage)}`,
			{ cwd: params.worktreePath },
		)
		commitCreated = true
		emitDiagnostics("committed")
	}

	private async getOwnedWorktreeChangedPaths(
		worktreePath: string,
		ownedPaths: string[],
	): Promise<WorktreeChangedPathSet> {
		const trackedChangedPaths = new Set<string>()
		const untrackedChangedPaths = new Set<string>()

		for (const chunk of this.chunkPathspecs(ownedPaths)) {
			const pathspec = this.formatPathspec(chunk)
			const trackedPaths = await this.getNullSeparatedGitOutput(
				`git diff --name-only -z HEAD -- ${pathspec}`,
				worktreePath,
			)
			const untrackedPaths = await this.getNullSeparatedGitOutput(
				`git ls-files --others --exclude-standard -z -- ${pathspec}`,
				worktreePath,
			)

			for (const filePath of trackedPaths) {
				if (this.isPathWithinOwnedPaths(filePath, ownedPaths)) {
					trackedChangedPaths.add(filePath)
				}
			}

			for (const filePath of untrackedPaths) {
				if (this.isPathWithinOwnedPaths(filePath, ownedPaths)) {
					untrackedChangedPaths.add(filePath)
				}
			}
		}

		const changedPaths = Array.from(new Set([...trackedChangedPaths, ...untrackedChangedPaths]))
		return {
			trackedChangedPaths: Array.from(trackedChangedPaths),
			untrackedChangedPaths: Array.from(untrackedChangedPaths),
			changedPaths,
		}
	}

	private async getMergeReviewPathDiagnostics(
		worktreePath: string,
		ownedPaths: string[],
		originalOwnedPaths: string[] | undefined,
	): Promise<WorktreeMergeReviewPathDiagnostic[]> {
		const gitRoot = await this.resolveGitRoot().catch(() => undefined)

		return Promise.all(
			ownedPaths.map(async (workspaceRelativePath, index) => {
				const originalPath = originalOwnedPaths?.[index] ?? workspaceRelativePath
				const resolvedWorktreePath = path.join(worktreePath, workspaceRelativePath)
				const rootWorkspacePath = gitRoot ? path.join(gitRoot, workspaceRelativePath) : undefined

				return {
					originalPath,
					workspaceRelativePath,
					worktreePath: resolvedWorktreePath,
					rootWorkspacePath,
					existsInWorktree: await this.pathExists(resolvedWorktreePath),
					existsInRootWorkspace: rootWorkspacePath ? await this.pathExists(rootWorkspacePath) : undefined,
				}
			}),
		)
	}

	private async pathExists(filePath: string): Promise<boolean> {
		try {
			await fs.stat(filePath)
			return true
		} catch {
			return false
		}
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

			if (isGitExecutableUnavailableError(error)) {
				throw new WorktreeManagerGitUnavailableError(formatGitUnavailableMessage(error, this.repoRoot))
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
		} catch (error) {
			if (isGitExecutableUnavailableError(error)) {
				throw new WorktreeManagerGitUnavailableError(formatGitUnavailableMessage(error, gitRoot))
			}

			throw new WorktreeManagerError(
				"Parallel agents require a Git repository with at least one commit. Commit your current project first, then approve the plan again.",
			)
		}
	}
}

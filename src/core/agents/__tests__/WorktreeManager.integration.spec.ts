import { execFile } from "child_process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { promisify } from "util"

import { WorktreeManager } from "../WorktreeManager"

const execFileAsync = promisify(execFile)

async function git(repoRoot: string, args: string[]) {
	return execFileAsync("git", args, { cwd: repoRoot, maxBuffer: 50 * 1024 * 1024 })
}

async function initializeRepository(repoRoot: string): Promise<void> {
	await git(repoRoot, ["init"])
	await git(repoRoot, ["config", "user.name", "Roo Test"])
	await git(repoRoot, ["config", "user.email", "roo-test@example.com"])
	await fs.writeFile(path.join(repoRoot, "README.md"), "baseline\n", "utf8")
	await git(repoRoot, ["add", "README.md"])
	await git(repoRoot, ["commit", "-m", "baseline"])
}

describe("WorktreeManager integration", () => {
	let repoRoot: string | undefined
	let manager: WorktreeManager | undefined

	afterEach(async () => {
		await manager?.cleanup().catch(() => undefined)
		manager = undefined

		if (repoRoot) {
			await fs.rm(repoRoot, { recursive: true, force: true })
			repoRoot = undefined
		}
	})

	it("applies owned new files that were absent from the captured baseline", async () => {
		repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roo-worktree-manager-new-file-"))
		await initializeRepository(repoRoot)

		manager = new WorktreeManager(repoRoot)
		const worktreePath = await manager.createWorktree("agent", "plan")
		await fs.writeFile(path.join(worktreePath, "index.html"), "<main>Hello</main>\n", "utf8")

		const diff = await manager.prepareMergeReview({
			agentId: "agent",
			planId: "plan",
			worktreePath,
			branch: "roo/parallel/plan/agent",
			ownedPaths: ["index.html"],
		})

		expect(diff).toContain("new file mode 100644")

		await manager.mergeBranch("roo/parallel/plan/agent", {
			planId: "plan",
			worktreePath,
			ownedPaths: ["index.html"],
		})

		await expect(fs.readFile(path.join(repoRoot, "index.html"), "utf8")).resolves.toMatch(
			/^<main>Hello<\/main>\r?\n$/,
		)
	})

	it("blocks owned new-file apply when the main workspace created the same path since baseline", async () => {
		repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roo-worktree-manager-new-file-conflict-"))
		await initializeRepository(repoRoot)

		manager = new WorktreeManager(repoRoot)
		const worktreePath = await manager.createWorktree("agent", "plan")
		await fs.writeFile(path.join(worktreePath, "index.html"), "<main>Agent</main>\n", "utf8")
		await manager.prepareMergeReview({
			agentId: "agent",
			planId: "plan",
			worktreePath,
			branch: "roo/parallel/plan/agent",
			ownedPaths: ["index.html"],
		})

		await fs.writeFile(path.join(repoRoot, "index.html"), "<main>Local</main>\n", "utf8")

		await expect(
			manager.mergeBranch("roo/parallel/plan/agent", {
				planId: "plan",
				worktreePath,
				ownedPaths: ["index.html"],
			}),
		).rejects.toThrow(/Current workspace content changed since the parallel baseline[\s\S]*index\.html/)
		await expect(fs.readFile(path.join(repoRoot, "index.html"), "utf8")).resolves.toBe("<main>Local</main>\n")
	})
})

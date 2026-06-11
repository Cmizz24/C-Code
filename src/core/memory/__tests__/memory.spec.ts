import * as fs from "fs/promises"
import * as os from "os"
import path from "path"

import type { MemoryEntry, ModelInfo } from "@roo-code/types"

import { buildMemoryPromptForRequest } from "../inject"
import { createMistakeMemoryCandidate } from "../mistakes"
import { appendMemoryPromptToLastUserMessage, formatMemoryPrompt } from "../prompt"
import { rankMemories } from "../ranking"
import { sanitizeMemoryText } from "../redaction"
import { extractPathHintsFromText, retrieveMemories } from "../retrieval"
import { isMemoryEnabledForModel, resolveMemorySettings } from "../settings"
import { MemoryStorage } from "../storage"
import { hashWorkspaceIdentifier } from "../workspace"

function modelInfo(contextWindow: number, maxTokens = 8_192): ModelInfo {
	return {
		contextWindow,
		maxTokens,
		supportsImages: false,
		supportsPromptCache: false,
	}
}

function memory(overrides: Partial<MemoryEntry>): MemoryEntry {
	const now = Date.now()
	return {
		id: overrides.id ?? `mem-${Math.random()}`,
		scope: overrides.scope ?? "global",
		workspaceHash: overrides.workspaceHash,
		kind: overrides.kind ?? "lesson",
		status: overrides.status ?? "active",
		source: overrides.source ?? "manual",
		title: overrides.title,
		lesson: overrides.lesson ?? "Default lesson",
		tags: overrides.tags ?? [],
		pathTags: overrides.pathTags ?? [],
		mode: overrides.mode,
		toolName: overrides.toolName,
		mistakeSignature: overrides.mistakeSignature,
		confidence: overrides.confidence ?? 0.7,
		reuseCount: overrides.reuseCount ?? 0,
		successCount: overrides.successCount ?? 0,
		failureCount: overrides.failureCount ?? 0,
		createdAt: overrides.createdAt ?? now,
		updatedAt: overrides.updatedAt ?? now,
		lastUsedAt: overrides.lastUsedAt,
		supersedes: overrides.supersedes,
		supersededBy: overrides.supersededBy,
		originTaskId: overrides.originTaskId,
	}
}

describe("memory settings", () => {
	it("auto-enables memory below 1M context and disables it at or above 1M unless manually overridden", () => {
		const automatic = resolveMemorySettings()

		expect(automatic.memoryAutoApproveMistakeMemory).toBe(false)
		expect(resolveMemorySettings({ memoryAutoApproveMistakeMemory: true }).memoryAutoApproveMistakeMemory).toBe(
			true,
		)
		expect(isMemoryEnabledForModel(automatic, modelInfo(999_999))).toBe(true)
		expect(isMemoryEnabledForModel(automatic, modelInfo(1_000_000))).toBe(false)
		expect(isMemoryEnabledForModel(resolveMemorySettings({ memoryEnabled: true }), modelInfo(2_000_000))).toBe(true)
		expect(isMemoryEnabledForModel(resolveMemorySettings({ memoryEnabled: false }), modelInfo(128_000))).toBe(false)
		expect(isMemoryEnabledForModel(resolveMemorySettings({ memoryMaxCharacters: 0 }), modelInfo(128_000))).toBe(
			false,
		)
	})
})

describe("memory redaction", () => {
	it("redacts common secret formats before storage", () => {
		const redacted = sanitizeMemoryText(
			"Use api_key=sk-1234567890abcdefghijklmnopqrstuvwxyz and token: ghp_1234567890abcdefghijklmnopqrstuv",
		)

		expect(redacted).toContain("api_key=[REDACTED_SECRET]")
		expect(redacted).toContain("token=[REDACTED_SECRET]")
		expect(redacted).not.toContain("sk-1234567890")
		expect(redacted).not.toContain("ghp_1234567890")
	})
})

describe("memory storage", () => {
	let tempDir: string
	let workspacePath: string
	let storage: MemoryStorage

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-memory-"))
		workspacePath = path.join(tempDir, "workspace")
		storage = new MemoryStorage({ globalStoragePath: tempDir, workspacePath })
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("stores workspace memories with a workspace hash instead of an absolute path", async () => {
		const stored = await storage.createMemory({
			scope: "workspace",
			kind: "lesson",
			status: "active",
			source: "manual",
			lesson: "Prefer small focused edits.",
			pathTags: ["src/core/task/Task.ts", "./src/core/task/Task.ts"],
			workspacePath,
		})

		expect(stored.workspaceHash).toBe(hashWorkspaceIdentifier(workspacePath))
		expect(JSON.stringify(stored)).not.toContain(workspacePath)
		expect(stored.pathTags).toEqual(["src/core/task/Task.ts"])
	})

	it("supports pending mistake-memory approval and archive lifecycle", async () => {
		const { memory: pending } = await createMistakeMemoryCandidate({
			storage,
			lesson: "When a patch fails, re-read the target file before retrying.",
			error: "Patch context not found",
			toolName: "apply_patch",
			workspacePath,
		})

		expect(pending.status).toBe("pending")
		expect((await storage.readStore("workspace", workspacePath)).candidates).toHaveLength(1)

		const approved = await storage.updateMemoryStatus(pending.id, "active", { scope: "workspace", workspacePath })
		expect(approved?.status).toBe("active")
		expect((await storage.readStore("workspace", workspacePath)).candidates[0].status).toBe("approved")

		const archived = await storage.updateMemoryStatus(pending.id, "archived", { scope: "workspace", workspacePath })
		expect(archived?.status).toBe("archived")
		expect((await storage.readStore("workspace", workspacePath)).candidates[0].status).toBe("rejected")
	})

	it("creates active mistake memories without pending candidates when approved", async () => {
		const { memory: approved, candidate } = await createMistakeMemoryCandidate({
			storage,
			lesson: "When validation output changes, re-check the failing assertion before editing again.",
			error: "Assertion changed",
			toolName: "execute_command",
			workspacePath,
			approved: true,
		})

		expect(approved.status).toBe("active")
		expect(candidate).toBeUndefined()
		const store = await storage.readStore("workspace", workspacePath)
		expect(store.memories.find((entry) => entry.id === approved.id)?.status).toBe("active")
		expect(store.candidates).toHaveLength(0)
	})

	it("prunes older pending candidates when the pending candidate limit is reached", async () => {
		const first = await createMistakeMemoryCandidate({
			storage,
			lesson: "First lesson",
			error: "first error",
			toolName: "read_file",
			workspacePath,
			pendingCandidateLimit: 1,
		})
		const second = await createMistakeMemoryCandidate({
			storage,
			lesson: "Second lesson",
			error: "second error",
			toolName: "read_file",
			workspacePath,
			pendingCandidateLimit: 1,
		})

		const store = await storage.readStore("workspace", workspacePath)
		expect(store.candidates.find((candidate) => candidate.memoryId === first.memory.id)?.status).toBe("rejected")
		expect(store.candidates.find((candidate) => candidate.memoryId === second.memory.id)?.status).toBe("pending")
		expect(store.memories.find((entry) => entry.id === first.memory.id)?.status).toBe("archived")
		expect(store.memories.find((entry) => entry.id === second.memory.id)?.status).toBe("pending")
	})

	it("deletes individual memories across statuses without stale candidates or relationships", async () => {
		const { memory: pending } = await createMistakeMemoryCandidate({
			storage,
			lesson: "Pending lesson to remove.",
			error: "pending error",
			toolName: "read_file",
			workspacePath,
		})
		const active = await storage.createMemory({
			scope: "workspace",
			kind: "lesson",
			status: "active",
			source: "manual",
			lesson: "Active lesson to remove.",
			workspacePath,
		})
		const stale = await storage.createMemory({
			scope: "workspace",
			kind: "lesson",
			status: "stale",
			source: "manual",
			lesson: "Stale lesson to remove.",
			workspacePath,
		})
		const archived = await storage.createMemory({
			scope: "workspace",
			kind: "lesson",
			status: "archived",
			source: "manual",
			lesson: "Archived lesson to remove.",
			workspacePath,
		})
		const superseded = await storage.createMemory({
			scope: "workspace",
			kind: "lesson",
			status: "superseded",
			source: "manual",
			lesson: "Superseded lesson to remove.",
			workspacePath,
		})
		const replacement = await storage.createMemory({
			scope: "workspace",
			kind: "lesson",
			status: "active",
			source: "manual",
			lesson: "Replacement lesson should stay.",
			workspacePath,
		})

		const storeWithRelationships = await storage.readStore("workspace", workspacePath)
		storeWithRelationships.memories = storeWithRelationships.memories.map((entry) => {
			if (entry.id === superseded.id) {
				return { ...entry, supersededBy: pending.id }
			}
			if (entry.id === replacement.id) {
				return { ...entry, supersedes: pending.id }
			}
			return entry
		})
		await storage.writeStore("workspace", storeWithRelationships, workspacePath)

		for (const entry of [pending, active, stale, archived, superseded]) {
			expect(await storage.deleteMemory(entry.id, { scope: "workspace", workspacePath })).toBe(true)
		}

		const store = await storage.readStore("workspace", workspacePath)
		const remainingIds = store.memories.map((entry) => entry.id)
		expect(remainingIds).toEqual([replacement.id])
		expect(store.candidates.find((candidate) => candidate.memoryId === pending.id)).toBeUndefined()
		expect(store.memories[0].supersedes).toBeUndefined()
		expect(store.memories[0].supersededBy).toBeUndefined()
	})
})

describe("memory retrieval and ranking", () => {
	let tempDir: string
	let workspacePath: string
	let storage: MemoryStorage

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-memory-retrieval-"))
		workspacePath = path.join(tempDir, "workspace")
		storage = new MemoryStorage({ globalStoragePath: tempDir, workspacePath })
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("extracts path hints from request text for path-overlap ranking", () => {
		expect(extractPathHintsFromText("Fix src/core/task/Task.ts and webview-ui/src/App.tsx next.")).toEqual([
			"src/core/task/Task.ts",
			"webview-ui/src/App.tsx",
		])
	})

	it("ranks lexical, path, mode, workspace, recency, reuse, confidence, and mistake signature signals", () => {
		const workspaceHash = hashWorkspaceIdentifier("c:/repo")
		const preferred = memory({
			id: "preferred",
			scope: "workspace",
			workspaceHash,
			lesson: "When editing Task.ts, preserve memory prompt injection.",
			pathTags: ["src/core/task/Task.ts"],
			mode: "code",
			confidence: 0.95,
			reuseCount: 2,
			successCount: 2,
			mistakeSignature: "mistake:task",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		})
		const fallback = memory({
			id: "fallback",
			scope: "global",
			lesson: "General reminder about documentation.",
			confidence: 0.2,
			createdAt: Date.now() - 1000 * 60 * 60 * 24 * 60,
			updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 60,
		})

		const results = rankMemories([fallback, preferred], {
			query: "Update Task.ts memory prompt injection",
			pathHints: ["src/core/task/Task.ts"],
			mode: "code",
			workspaceHash,
			mistakeSignature: "mistake:task",
		})

		expect(results[0].memory.id).toBe("preferred")
		expect(results[0].breakdown.pathOverlap).toBeGreaterThan(0)
		expect(results[0].breakdown.modeMatch).toBeGreaterThan(0)
		expect(results[0].breakdown.scopePreference).toBeGreaterThan(0)
		expect(results[0].breakdown.mistakeSignature).toBeGreaterThan(0)
	})

	it("filters ignored path-tagged memories before ranking", async () => {
		await storage.createMemory({
			scope: "workspace",
			kind: "lesson",
			status: "active",
			source: "manual",
			lesson: "Do not use ignored secrets.",
			pathTags: [".env"],
			workspacePath,
		})
		await storage.createMemory({
			scope: "workspace",
			kind: "lesson",
			status: "active",
			source: "manual",
			lesson: "Use settings memory controls.",
			pathTags: ["webview-ui/src/components/settings/MemorySettings.tsx"],
			workspacePath,
		})

		const results = await retrieveMemories({
			storage,
			query: "settings memory",
			workspacePath,
			includeWorkspace: true,
			includeGlobal: false,
			maxEntries: 5,
			rooIgnoreController: {
				filterPaths: (paths: string[]) => paths.filter((entry) => entry !== ".env"),
			} as any,
		})

		expect(results).toHaveLength(1)
		expect(results[0].memory.pathTags).toEqual(["webview-ui/src/components/settings/MemorySettings.tsx"])
	})

	it("excludes deleted active memories from retrieval and injection", async () => {
		const kept = await storage.createMemory({
			scope: "workspace",
			kind: "lesson",
			status: "active",
			source: "manual",
			lesson: "Use settings memory controls.",
			workspacePath,
		})
		const deleted = await storage.createMemory({
			scope: "workspace",
			kind: "lesson",
			status: "active",
			source: "manual",
			lesson: "Deleted settings memory should not appear.",
			workspacePath,
		})

		expect(await storage.deleteMemory(deleted.id, { scope: "workspace", workspacePath })).toBe(true)

		const results = await retrieveMemories({
			storage,
			query: "settings memory controls",
			workspacePath,
			includeWorkspace: true,
			includeGlobal: false,
			maxEntries: 5,
		})

		expect(results.map((result) => result.memory.id)).toContain(kept.id)
		expect(results.map((result) => result.memory.id)).not.toContain(deleted.id)

		const prompt = await buildMemoryPromptForRequest({
			globalStoragePath: tempDir,
			workspacePath,
			modelInfo: modelInfo(10_000, 1_000),
			modelId: "test-model",
			apiConfiguration: {},
			settings: {
				memoryEnabled: true,
				memoryWorkspaceEnabled: true,
				memoryGlobalEnabled: false,
				memoryMaxCharacters: 2_400,
				memoryMaxEntries: 5,
			},
			requestMessages: [{ role: "user", content: "settings memory controls" }],
			contextTokens: 100,
		})

		expect(prompt).toContain(kept.lesson)
		expect(prompt).not.toContain(deleted.lesson)
	})
})

describe("memory prompt formatting and injection", () => {
	it("formats compact advisory memory context within a strict character budget", () => {
		const prompt = formatMemoryPrompt(
			[
				{
					memory: memory({
						lesson: "Keep memory advisory and never persist injected memory into task history.",
					}),
					score: 42,
					breakdown: {
						lexicalSimilarity: 1,
						pathOverlap: 0,
						modeMatch: 0,
						scopePreference: 0,
						recency: 0,
						reuse: 0,
						confidence: 0,
						mistakeSignature: 0,
					},
				},
			],
			{ maxCharacters: 300 },
		)

		expect(prompt).toContain("<memory_context>")
		expect(prompt?.length).toBeLessThanOrEqual(300)
	})

	it("appends memory only to cloned request messages without mutating persisted history", () => {
		const persisted = [{ role: "user", content: "Implement memory." }]
		const request = appendMemoryPromptToLastUserMessage(
			persisted,
			"<memory_context>Remember tests.</memory_context>",
		)

		expect(request).not.toBe(persisted)
		expect(request[0]).not.toBe(persisted[0])
		expect((request[0] as any).content).toEqual([
			{ type: "text", text: "Implement memory." },
			{ type: "text", text: "<memory_context>Remember tests.</memory_context>" },
		])
		expect(persisted[0].content).toBe("Implement memory.")
	})

	it("skips memory under high context pressure and trims it near pressure", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-memory-inject-"))
		const workspacePath = path.join(tempDir, "workspace")
		const storage = new MemoryStorage({ globalStoragePath: tempDir, workspacePath })

		try {
			await storage.createMemory({
				scope: "workspace",
				kind: "lesson",
				status: "active",
				source: "manual",
				lesson: "A".repeat(1_500),
				workspacePath,
			})

			const common = {
				globalStoragePath: tempDir,
				workspacePath,
				modelInfo: modelInfo(10_000, 1_000),
				modelId: "test-model",
				apiConfiguration: {},
				settings: {
					memoryEnabled: true,
					memoryWorkspaceEnabled: true,
					memoryGlobalEnabled: false,
					memoryMaxCharacters: 2_400,
				},
				requestMessages: [{ role: "user", content: "Remember the A lesson" }],
			}

			const trimmedPrompt = await buildMemoryPromptForRequest({ ...common, contextTokens: 7_700 })
			expect(trimmedPrompt).toBeDefined()
			expect(trimmedPrompt?.length).toBeLessThanOrEqual(800)
			expect(await buildMemoryPromptForRequest({ ...common, contextTokens: 8_300 })).toBeUndefined()
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})
})

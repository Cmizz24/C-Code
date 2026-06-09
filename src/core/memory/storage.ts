import crypto from "crypto"
import * as fs from "fs/promises"
import path from "path"

import type {
	MemoryEntry,
	MemoryScope,
	MemoryStatus,
	MemoryStore,
	MemorySummary,
	MistakeMemoryCandidate,
} from "@roo-code/types"
import { memoryStoreSchema } from "@roo-code/types"

import { safeWriteJson } from "../../utils/safeWriteJson"
import { getStorageBasePath } from "../../utils/storage"
import {
	DEFAULT_MEMORY_PENDING_CANDIDATE_LIMIT,
	GLOBAL_MEMORY_FILE_NAME,
	MEMORY_DIRECTORY_NAME,
	MEMORY_STORE_VERSION,
	WORKSPACE_MEMORY_DIRECTORY_NAME,
} from "./constants"
import { sanitizeMemoryTags, sanitizeMemoryText } from "./redaction"
import { hashWorkspaceIdentifier, uniqueNormalizedPaths } from "./workspace"

export interface MemoryStorageOptions {
	globalStoragePath: string
	workspacePath?: string
}

export interface CreateMemoryInput {
	scope: MemoryScope
	kind: MemoryEntry["kind"]
	status: MemoryStatus
	source: MemoryEntry["source"]
	lesson: string
	title?: string
	tags?: string[]
	pathTags?: string[]
	mode?: string
	toolName?: string
	mistakeSignature?: string
	confidence?: number
	originTaskId?: string
	workspacePath?: string
}

export interface ListMemoryOptions {
	scopes?: MemoryScope[]
	statuses?: MemoryStatus[]
	workspacePath?: string
}

export class MemoryStorage {
	private readonly globalStoragePath: string
	private readonly workspacePath?: string

	constructor(options: MemoryStorageOptions) {
		this.globalStoragePath = options.globalStoragePath
		this.workspacePath = options.workspacePath
	}

	async getWorkspaceHash(workspacePath: string | undefined = this.workspacePath): Promise<string | undefined> {
		return workspacePath ? hashWorkspaceIdentifier(workspacePath) : undefined
	}

	private async getMemoryRoot(): Promise<string> {
		const basePath = await getStorageBasePath(this.globalStoragePath)
		return path.join(basePath, MEMORY_DIRECTORY_NAME)
	}

	private async getStorePath(scope: MemoryScope, workspacePath?: string): Promise<string> {
		const root = await this.getMemoryRoot()
		if (scope === "global") {
			return path.join(root, GLOBAL_MEMORY_FILE_NAME)
		}

		const workspaceHash = await this.getWorkspaceHash(workspacePath)
		if (!workspaceHash) {
			throw new Error("Workspace memory requires a workspace path")
		}

		return path.join(root, WORKSPACE_MEMORY_DIRECTORY_NAME, `${workspaceHash}.json`)
	}

	private createEmptyStore(workspaceHash?: string): MemoryStore {
		return {
			version: MEMORY_STORE_VERSION,
			workspaceHash,
			memories: [],
			candidates: [],
		}
	}

	async readStore(scope: MemoryScope, workspacePath?: string): Promise<MemoryStore> {
		const workspaceHash = scope === "workspace" ? await this.getWorkspaceHash(workspacePath) : undefined
		const storePath = await this.getStorePath(scope, workspacePath)

		try {
			const raw = await fs.readFile(storePath, "utf8")
			return memoryStoreSchema.parse(JSON.parse(raw))
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				console.warn(`Failed to read memory store at ${storePath}:`, error)
			}
			return this.createEmptyStore(workspaceHash)
		}
	}

	async writeStore(scope: MemoryScope, store: MemoryStore, workspacePath?: string): Promise<void> {
		const storePath = await this.getStorePath(scope, workspacePath)
		const sortedStore: MemoryStore = {
			...store,
			version: MEMORY_STORE_VERSION,
			memories: [...store.memories].sort((left, right) => left.id.localeCompare(right.id)),
			candidates: [...(store.candidates ?? [])].sort((left, right) => left.id.localeCompare(right.id)),
		}
		await safeWriteJson(storePath, sortedStore, { prettyPrint: true })
	}

	private summarizeStore(store: MemoryStore): MemorySummary[MemoryScope] {
		const active = store.memories.filter((memory) => memory.status === "active").length
		const pending = store.memories.filter((memory) => memory.status === "pending").length
		const archived = store.memories.filter((memory) => memory.status === "archived").length

		return {
			active,
			pending,
			archived,
			total: store.memories.length,
		}
	}

	async getSummary(workspacePath: string | undefined = this.workspacePath): Promise<MemorySummary> {
		const globalStore = await this.readStore("global")
		const workspaceHash = await this.getWorkspaceHash(workspacePath)
		const workspaceStore = workspaceHash
			? await this.readStore("workspace", workspacePath)
			: this.createEmptyStore()

		return {
			workspaceHash,
			global: this.summarizeStore(globalStore),
			workspace: this.summarizeStore(workspaceStore),
		}
	}

	async listMemories(options: ListMemoryOptions = {}): Promise<MemoryEntry[]> {
		const scopes = options.scopes ?? ["workspace", "global"]
		const statuses = new Set<MemoryStatus>(options.statuses ?? ["active"])
		const memories: MemoryEntry[] = []

		for (const scope of scopes) {
			if (scope === "workspace" && !(options.workspacePath ?? this.workspacePath)) {
				continue
			}

			const store = await this.readStore(scope, options.workspacePath)
			memories.push(...store.memories.filter((memory) => statuses.has(memory.status)))
		}

		return memories
	}

	async createMemory(input: CreateMemoryInput): Promise<MemoryEntry> {
		const now = Date.now()
		const workspaceHash = input.scope === "workspace" ? await this.getWorkspaceHash(input.workspacePath) : undefined
		const memory: MemoryEntry = {
			id: `mem_${crypto.randomUUID()}`,
			scope: input.scope,
			workspaceHash,
			kind: input.kind,
			status: input.status,
			source: input.source,
			title: input.title ? sanitizeMemoryText(input.title, 160) : undefined,
			lesson: sanitizeMemoryText(input.lesson, 2_000),
			tags: sanitizeMemoryTags(input.tags),
			pathTags: uniqueNormalizedPaths(input.pathTags).slice(0, 24),
			mode: input.mode?.slice(0, 80),
			toolName: input.toolName?.slice(0, 120),
			mistakeSignature: input.mistakeSignature?.slice(0, 160),
			confidence: Math.min(1, Math.max(0, input.confidence ?? 0.7)),
			reuseCount: 0,
			successCount: 0,
			failureCount: 0,
			createdAt: now,
			updatedAt: now,
			originTaskId: input.originTaskId,
		}

		const store = await this.readStore(input.scope, input.workspacePath)
		store.memories = [memory, ...store.memories]
		await this.writeStore(input.scope, store, input.workspacePath)
		return memory
	}

	async upsertMemory(memory: MemoryEntry, workspacePath?: string): Promise<MemoryEntry> {
		const store = await this.readStore(memory.scope, workspacePath)
		const index = store.memories.findIndex((entry) => entry.id === memory.id)
		if (index >= 0) {
			store.memories[index] = { ...memory, updatedAt: Date.now() }
		} else {
			store.memories.push(memory)
		}
		await this.writeStore(memory.scope, store, workspacePath)
		return index >= 0 ? store.memories[index] : memory
	}

	async updateMemoryStatus(
		id: string,
		status: MemoryStatus,
		options: { scope?: MemoryScope; workspacePath?: string; reason?: string } = {},
	): Promise<MemoryEntry | undefined> {
		const scopes: MemoryScope[] = options.scope ? [options.scope] : ["workspace", "global"]
		for (const scope of scopes) {
			if (scope === "workspace" && !(options.workspacePath ?? this.workspacePath)) {
				continue
			}

			const store = await this.readStore(scope, options.workspacePath)
			const memory = store.memories.find((entry) => entry.id === id)
			if (!memory) {
				continue
			}

			memory.status = status
			memory.updatedAt = Date.now()
			const candidate = store.candidates.find((entry) => entry.memoryId === id)
			if (candidate) {
				candidate.updatedAt = memory.updatedAt
				candidate.reason = options.reason ? sanitizeMemoryText(options.reason, 500) : candidate.reason
				if (status === "active") {
					candidate.status = "approved"
					candidate.approvedAt = memory.updatedAt
				} else if (status === "archived") {
					candidate.status = "rejected"
					candidate.rejectedAt = memory.updatedAt
				}
			}

			await this.writeStore(scope, store, options.workspacePath)
			return memory
		}

		return undefined
	}

	async updatePendingMemoriesStatus(
		scope: MemoryScope,
		status: Extract<MemoryStatus, "active" | "archived">,
		options: { workspacePath?: string; reason?: string } = {},
	): Promise<number> {
		if (scope === "workspace" && !(options.workspacePath ?? this.workspacePath)) {
			return 0
		}

		const store = await this.readStore(scope, options.workspacePath)
		const now = Date.now()
		let updated = 0

		for (const memory of store.memories) {
			if (memory.status !== "pending") {
				continue
			}

			memory.status = status
			memory.updatedAt = now
			updated += 1

			const candidate = store.candidates.find((entry) => entry.memoryId === memory.id)
			if (candidate) {
				candidate.updatedAt = now
				candidate.reason = options.reason ? sanitizeMemoryText(options.reason, 500) : candidate.reason
				if (status === "active") {
					candidate.status = "approved"
					candidate.approvedAt = now
				} else {
					candidate.status = "rejected"
					candidate.rejectedAt = now
				}
			}
		}

		if (updated > 0) {
			await this.writeStore(scope, store, options.workspacePath)
		}

		return updated
	}

	async archiveScope(scope: MemoryScope, workspacePath?: string): Promise<number> {
		if (scope === "workspace" && !(workspacePath ?? this.workspacePath)) {
			return 0
		}

		const store = await this.readStore(scope, workspacePath)
		const now = Date.now()
		let archived = 0

		for (const memory of store.memories) {
			if (memory.status === "archived") {
				continue
			}

			memory.status = "archived"
			memory.updatedAt = now
			archived += 1
		}

		for (const candidate of store.candidates) {
			if (candidate.status === "pending") {
				candidate.status = "rejected"
				candidate.rejectedAt = now
				candidate.updatedAt = now
			}
		}

		if (archived > 0) {
			await this.writeStore(scope, store, workspacePath)
		}

		return archived
	}

	async deleteMemory(id: string, options: { scope?: MemoryScope; workspacePath?: string } = {}): Promise<boolean> {
		let deleted = false
		const scopes: MemoryScope[] = options.scope ? [options.scope] : ["workspace", "global"]

		for (const scope of scopes) {
			if (scope === "workspace" && !(options.workspacePath ?? this.workspacePath)) {
				continue
			}

			const store = await this.readStore(scope, options.workspacePath)
			const nextMemories = store.memories.filter((entry) => entry.id !== id)
			const nextCandidates = store.candidates.filter((entry) => entry.memoryId !== id)
			if (nextMemories.length !== store.memories.length || nextCandidates.length !== store.candidates.length) {
				deleted = true
				await this.writeStore(
					scope,
					{ ...store, memories: nextMemories, candidates: nextCandidates },
					options.workspacePath,
				)
			}
		}

		return deleted
	}

	async addCandidate(
		candidate: MistakeMemoryCandidate,
		scope: MemoryScope,
		workspacePath?: string,
		pendingCandidateLimit = DEFAULT_MEMORY_PENDING_CANDIDATE_LIMIT,
	): Promise<void> {
		const store = await this.readStore(scope, workspacePath)
		store.candidates = [candidate, ...store.candidates.filter((entry) => entry.id !== candidate.id)]

		const pendingLimit = Math.max(0, Math.floor(pendingCandidateLimit))
		const pendingCandidates = store.candidates
			.filter((entry) => entry.status === "pending")
			.sort((left, right) => right.createdAt - left.createdAt)
		const prunedCandidates = pendingCandidates.slice(pendingLimit)

		if (prunedCandidates.length > 0) {
			const now = Date.now()
			const prunedMemoryIds = new Set(prunedCandidates.map((entry) => entry.memoryId))

			for (const prunedCandidate of prunedCandidates) {
				prunedCandidate.status = "rejected"
				prunedCandidate.rejectedAt = now
				prunedCandidate.updatedAt = now
				prunedCandidate.reason =
					prunedCandidate.reason ?? "Pruned after pending mistake-memory limit was reached"
			}

			for (const memory of store.memories) {
				if (memory.status === "pending" && prunedMemoryIds.has(memory.id)) {
					memory.status = "archived"
					memory.updatedAt = now
				}
			}
		}

		await this.writeStore(scope, store, workspacePath)
	}

	async findByMistakeSignature(
		mistakeSignature: string,
		options: { scope?: MemoryScope; workspacePath?: string; statuses?: MemoryStatus[] } = {},
	): Promise<MemoryEntry | undefined> {
		const memories = await this.listMemories({
			scopes: options.scope ? [options.scope] : ["workspace", "global"],
			statuses: options.statuses ?? ["active", "pending"],
			workspacePath: options.workspacePath,
		})

		return memories.find((memory) => memory.mistakeSignature === mistakeSignature)
	}

	async recordMemoryUse(ids: readonly string[], workspacePath?: string): Promise<void> {
		if (!ids.length) {
			return
		}

		const idSet = new Set(ids)
		for (const scope of ["workspace", "global"] as const) {
			if (scope === "workspace" && !(workspacePath ?? this.workspacePath)) {
				continue
			}

			const store = await this.readStore(scope, workspacePath)
			let changed = false
			for (const memory of store.memories) {
				if (idSet.has(memory.id)) {
					memory.reuseCount += 1
					memory.lastUsedAt = Date.now()
					memory.updatedAt = memory.lastUsedAt
					changed = true
				}
			}
			if (changed) {
				await this.writeStore(scope, store, workspacePath)
			}
		}
	}

	async clearWorkspaceMemory(workspacePath: string | undefined = this.workspacePath): Promise<void> {
		const workspaceHash = await this.getWorkspaceHash(workspacePath)
		await this.writeStore("workspace", this.createEmptyStore(workspaceHash), workspacePath)
	}

	async clearGlobalMemory(): Promise<void> {
		await this.writeStore("global", this.createEmptyStore())
	}
}

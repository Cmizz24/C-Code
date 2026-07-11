import { describe, expect, it } from "vitest"

import {
	ContextCacheBudgetCoordinator,
	type ContextCacheBudgetCoordinatorManager,
	type ContextCacheBudgetEvictionCandidate,
	type ContextCacheBudgetManagerSnapshot,
	estimateHotContextChunkBytes,
} from "../ContextCacheBudgetCoordinator"
import type { ContextChunk } from "../ContextChunk"

function createChunk(input: Partial<ContextChunk> & Pick<ContextChunk, "id" | "bytes">): ContextChunk {
	return {
		id: input.id,
		type: input.type ?? "file_content",
		content: input.content ?? input.id,
		tokens: input.tokens ?? 1,
		bytes: input.bytes,
		priority: input.priority ?? 1,
		createdAt: input.createdAt ?? 1,
		lastAccessedAt: input.lastAccessedAt ?? 1,
		metadata: input.metadata,
	}
}

class TestBudgetManager implements ContextCacheBudgetCoordinatorManager {
	readonly contextCacheBudgetManagerId: string
	readonly isBackground: boolean
	readonly isActive: boolean
	readonly taskId?: string
	readonly instanceId?: string
	readonly mode?: string
	readonly agentId?: string
	readonly hotChunks = new Map<string, ContextChunk>()
	readonly coldChunks = new Map<string, ContextChunk>()
	hotEvictions: number
	coldEvictions: number

	constructor(options: {
		managerId: string
		isBackground?: boolean
		isActive?: boolean
		taskId?: string
		instanceId?: string
		mode?: string
		agentId?: string
		hotEvictions?: number
		coldEvictions?: number
		hotChunks?: ContextChunk[]
		coldChunks?: ContextChunk[]
	}) {
		this.contextCacheBudgetManagerId = options.managerId
		this.isBackground = options.isBackground ?? false
		this.isActive = options.isActive ?? false
		this.taskId = options.taskId
		this.instanceId = options.instanceId
		this.mode = options.mode
		this.agentId = options.agentId
		this.hotEvictions = options.hotEvictions ?? 0
		this.coldEvictions = options.coldEvictions ?? 0
		for (const chunk of options.hotChunks ?? []) {
			this.hotChunks.set(chunk.id, chunk)
		}
		for (const chunk of options.coldChunks ?? []) {
			this.coldChunks.set(chunk.id, chunk)
		}
	}

	getContextCacheBudgetSnapshot(): ContextCacheBudgetManagerSnapshot {
		return {
			managerId: this.contextCacheBudgetManagerId,
			hotBytes: [...this.hotChunks.values()].reduce(
				(total, chunk) => total + estimateHotContextChunkBytes(chunk),
				0,
			),
			coldBytes: [...this.coldChunks.values()].reduce((total, chunk) => total + chunk.bytes, 0),
			hotChunks: this.hotChunks.size,
			coldChunks: this.coldChunks.size,
			isBackground: this.isBackground,
			isActive: this.isActive,
			taskId: this.taskId,
			instanceId: this.instanceId,
			mode: this.mode,
			agentId: this.agentId,
			hotEvictions: this.hotEvictions,
			coldEvictions: this.coldEvictions,
		}
	}

	getColdCacheEvictionCandidates(
		protectedChunkIds: ReadonlySet<string> = new Set(),
	): ContextCacheBudgetEvictionCandidate[] {
		return [...this.coldChunks.values()]
			.filter((chunk) => !protectedChunkIds.has(chunk.id))
			.map((chunk) => this.toEvictionCandidate("cold", chunk, chunk.bytes))
	}

	getHotCacheEvictionCandidates(
		protectedChunkIds: ReadonlySet<string> = new Set(),
	): ContextCacheBudgetEvictionCandidate[] {
		return [...this.hotChunks.values()]
			.filter((chunk) => !protectedChunkIds.has(chunk.id))
			.map((chunk) => this.toEvictionCandidate("hot", chunk, estimateHotContextChunkBytes(chunk)))
	}

	evictColdCacheChunk(chunkId: string): ContextChunk | undefined {
		const chunk = this.coldChunks.get(chunkId)
		if (this.coldChunks.delete(chunkId)) {
			this.coldEvictions++
		}
		return chunk
	}

	evictHotCacheChunk(chunkId: string): ContextChunk | undefined {
		const chunk = this.hotChunks.get(chunkId)
		if (this.hotChunks.delete(chunkId)) {
			this.hotEvictions++
		}
		return chunk
	}

	private toEvictionCandidate(
		cacheKind: "hot" | "cold",
		chunk: ContextChunk,
		bytes: number,
	): ContextCacheBudgetEvictionCandidate {
		return {
			managerId: this.contextCacheBudgetManagerId,
			cacheKind,
			chunk,
			bytes,
			isBackground: this.isBackground,
			isActive: this.isActive,
		}
	}
}

describe("ContextCacheBudgetCoordinator", () => {
	it("accounts for hot and cold bytes across registered managers", () => {
		const coordinator = new ContextCacheBudgetCoordinator({ budgetBytes: 10_000 })
		const first = new TestBudgetManager({
			managerId: "first",
			hotChunks: [createChunk({ id: "first-hot", bytes: 100, tokens: 50 })],
			coldChunks: [createChunk({ id: "first-cold", bytes: 200 })],
		})
		const second = new TestBudgetManager({
			managerId: "second",
			coldChunks: [createChunk({ id: "second-cold", bytes: 300 })],
		})

		coordinator.register(first)
		coordinator.register(second)

		expect(coordinator.getUsage()).toMatchObject({
			budgetBytes: 10_000,
			usedBytes: 700,
			hotBytes: 200,
			coldBytes: 500,
			hotChunks: 1,
			coldChunks: 2,
			managerCount: 2,
		})

		expect(coordinator.getDiagnostics()).toMatchObject({
			ramUsedMb: 0,
			ramBudgetMb: 0.01,
			hotCacheRamMb: 0,
			coldCacheRamMb: 0,
			hotCacheChunks: 1,
			coldCacheChunks: 2,
			managerCount: 2,
			evictions: { hot: 0, cold: 0, total: 0 },
		})
	})

	it("reports privacy-safe contributor diagnostics ordered by combined usage", () => {
		const coordinator = new ContextCacheBudgetCoordinator({ budgetBytes: 10_000 })
		const foreground = new TestBudgetManager({
			managerId: "manager-foreground",
			isActive: true,
			taskId: "task-foreground\nwith hidden prompt text",
			instanceId: "instance-foreground",
			mode: "code",
			hotEvictions: 1,
			coldEvictions: 2,
			hotChunks: [createChunk({ id: "foreground-hot", bytes: 900, tokens: 300 })],
		})
		const background = new TestBudgetManager({
			managerId: "manager-background",
			isBackground: true,
			taskId: "task-background",
			instanceId: "instance-background",
			mode: "ask",
			agentId: "agent-a",
			coldEvictions: 3,
			coldChunks: [createChunk({ id: "background-cold", bytes: 2_000 })],
		})

		coordinator.register(foreground)
		coordinator.register(background)

		const diagnostics = coordinator.getDiagnostics()

		expect(diagnostics.evictions).toEqual({ hot: 1, cold: 5, total: 6 })
		expect(diagnostics.contributors).toEqual([
			expect.objectContaining({
				id: "context-cache-contributor-1",
				label: "Background agent 1 (ask)",
				mode: "ask",
				isBackground: true,
				isActive: false,
				coldCacheChunks: 1,
				evictions: { hot: 0, cold: 3, total: 3 },
			}),
			expect.objectContaining({
				id: "context-cache-contributor-2",
				label: "Foreground task 2 (code)",
				mode: "code",
				isBackground: false,
				isActive: true,
				hotCacheChunks: 1,
				evictions: { hot: 1, cold: 2, total: 3 },
			}),
		])
		expect(diagnostics.contributors[0]).not.toHaveProperty("taskId")
		expect(diagnostics.contributors[0]).not.toHaveProperty("instanceId")
		expect(diagnostics.contributors[0]).not.toHaveProperty("agentId")
		expect(JSON.stringify(diagnostics.contributors)).not.toContain("manager-background")
		expect(JSON.stringify(diagnostics.contributors)).not.toContain("manager-foreground")
		expect(JSON.stringify(diagnostics.contributors)).not.toContain("task-background")
		expect(JSON.stringify(diagnostics.contributors)).not.toContain("task-foreground")
		expect(JSON.stringify(diagnostics.contributors)).not.toContain("instance-background")
		expect(JSON.stringify(diagnostics.contributors)).not.toContain("instance-foreground")
		expect(JSON.stringify(diagnostics.contributors)).not.toContain("agent-a")
		expect(JSON.stringify(diagnostics.contributors)).not.toContain("hidden prompt text")
		expect(JSON.stringify(diagnostics.contributors)).not.toContain("foreground-hot")
		expect(JSON.stringify(diagnostics.contributors)).not.toContain("background-cold")
	})

	it("evicts cold chunks globally before hot chunks", () => {
		const coordinator = new ContextCacheBudgetCoordinator({ budgetBytes: 500 })
		const manager = new TestBudgetManager({
			managerId: "manager",
			hotChunks: [createChunk({ id: "hot", bytes: 400, tokens: 100, priority: 1 })],
			coldChunks: [createChunk({ id: "cold", bytes: 400, priority: 10 })],
		})

		coordinator.register(manager)

		expect(manager.coldChunks.has("cold")).toBe(false)
		expect(manager.hotChunks.has("hot")).toBe(true)
		expect(coordinator.getUsage().usedBytes).toBe(400)
		expect(coordinator.getDiagnostics().evictions).toEqual({ hot: 0, cold: 1, total: 1 })
	})

	it("evicts low-priority oldest chunks across managers", () => {
		const coordinator = new ContextCacheBudgetCoordinator({ budgetBytes: 700 })
		const first = new TestBudgetManager({
			managerId: "first",
			coldChunks: [createChunk({ id: "newer", bytes: 600, priority: 1, lastAccessedAt: 200, createdAt: 200 })],
		})
		const second = new TestBudgetManager({
			managerId: "second",
			coldChunks: [createChunk({ id: "older", bytes: 600, priority: 1, lastAccessedAt: 100, createdAt: 100 })],
		})

		coordinator.register(first)
		coordinator.register(second)

		expect(first.coldChunks.has("newer")).toBe(true)
		expect(second.coldChunks.has("older")).toBe(false)

		const contributors = coordinator.getDiagnostics().contributors

		expect(contributors).toEqual([
			expect.objectContaining({
				id: "context-cache-contributor-1",
				coldCacheChunks: 1,
				evictions: { hot: 0, cold: 0, total: 0 },
			}),
			expect.objectContaining({
				id: "context-cache-contributor-2",
				coldCacheChunks: 0,
				evictions: { hot: 0, cold: 1, total: 1 },
			}),
		])
		expect(JSON.stringify(contributors)).not.toContain("first")
		expect(JSON.stringify(contributors)).not.toContain("second")
	})

	it("prefers background-agent chunks over the active foreground task when candidates are otherwise equivalent", () => {
		const coordinator = new ContextCacheBudgetCoordinator({ budgetBytes: 700 })
		const foreground = new TestBudgetManager({
			managerId: "foreground",
			isActive: true,
			coldChunks: [createChunk({ id: "foreground-cold", bytes: 600 })],
		})
		const background = new TestBudgetManager({
			managerId: "background",
			isBackground: true,
			coldChunks: [createChunk({ id: "background-cold", bytes: 600 })],
		})

		coordinator.register(foreground)
		coordinator.register(background)

		expect(foreground.coldChunks.has("foreground-cold")).toBe(true)
		expect(background.coldChunks.has("background-cold")).toBe(false)
	})

	it("keeps protected chunks even when the budget remains exceeded", () => {
		const coordinator = new ContextCacheBudgetCoordinator({ budgetBytes: 500 })
		const manager = new TestBudgetManager({
			managerId: "manager",
		})

		coordinator.register(manager)
		manager.coldChunks.set("protected", createChunk({ id: "protected", bytes: 700 }))
		const result = coordinator.enforceBudget({ protectedChunkIds: ["protected"] })

		expect(result.overBudget).toBe(true)
		expect(result.evicted).toEqual([])
		expect(manager.coldChunks.has("protected")).toBe(true)
	})

	it("releases accounting when a manager unregisters", () => {
		const coordinator = new ContextCacheBudgetCoordinator({ budgetBytes: 10_000 })
		const manager = new TestBudgetManager({
			managerId: "manager",
			coldChunks: [createChunk({ id: "cold", bytes: 600 })],
		})

		const unregister = coordinator.register(manager)
		expect(coordinator.getUsage()).toMatchObject({ usedBytes: 600, managerCount: 1 })

		unregister()

		expect(coordinator.getUsage()).toMatchObject({ usedBytes: 0, managerCount: 0 })
	})

	it("uses cross-window pressure as an effective local budget for enforcement", () => {
		const coordinator = new ContextCacheBudgetCoordinator({ budgetBytes: 1_000 })
		const manager = new TestBudgetManager({
			managerId: "manager",
			coldChunks: [
				createChunk({ id: "evict-first", bytes: 300, priority: 0, lastAccessedAt: 1 }),
				createChunk({ id: "keep", bytes: 600, priority: 10, lastAccessedAt: 2 }),
			],
		})

		coordinator.register(manager)
		const result = coordinator.updateCrossWindowPressure({
			schemaVersion: 1,
			instanceId: "local-window",
			namespaceId: "workspace-test",
			localUsedBytes: 900,
			localBudgetBytes: 1_000,
			peerUsedBytes: 300,
			peerBudgetBytes: 1_000,
			globalBudgetBytes: 1_000,
			effectiveLocalBudgetBytes: 700,
			livePeerCount: 1,
			windowCount: 2,
			lastUpdatedAt: 1_000,
		})

		expect(result.budgetBytes).toBe(700)
		expect(result.evicted).toEqual([
			expect.objectContaining({ managerId: "manager", cacheKind: "cold", chunkId: "evict-first", bytes: 300 }),
		])
		expect(manager.coldChunks.has("evict-first")).toBe(false)
		expect(manager.coldChunks.has("keep")).toBe(true)
		expect(coordinator.getUsage()).toMatchObject({
			configuredBudgetBytes: 1_000,
			budgetBytes: 700,
			usedBytes: 600,
		})
	})

	it("exposes cross-window diagnostics without peer identities or content", () => {
		const coordinator = new ContextCacheBudgetCoordinator({ budgetBytes: 1024 * 1024 })
		coordinator.updateCrossWindowPressure({
			schemaVersion: 1,
			instanceId: "local-window",
			namespaceId: "workspace-test",
			localUsedBytes: 256 * 1024,
			localBudgetBytes: 1024 * 1024,
			peerUsedBytes: 512 * 1024,
			peerBudgetBytes: 1024 * 1024,
			globalBudgetBytes: 1024 * 1024,
			effectiveLocalBudgetBytes: 512 * 1024,
			livePeerCount: 2,
			windowCount: 3,
			localActiveTaskCount: 1,
			peerBackgroundTaskCount: 2,
			staleHeartbeatsCleaned: 1,
			lastUpdatedAt: 1_000,
		})

		const diagnostics = coordinator.getDiagnostics()

		expect(diagnostics.ramBudgetMb).toBe(0.5)
		expect(diagnostics.configuredRamBudgetMb).toBe(1)
		expect(diagnostics.crossWindow).toEqual(
			expect.objectContaining({
				schemaVersion: 1,
				livePeerCount: 2,
				windowCount: 3,
				localUsageRamMb: 0.25,
				peerUsageRamMb: 0.5,
				globalBudgetRamMb: 1,
				effectiveLocalBudgetRamMb: 0.5,
				localActiveTaskCount: 1,
				peerBackgroundTaskCount: 2,
				staleHeartbeatsCleaned: 1,
			}),
		)
		expect(JSON.stringify(diagnostics.crossWindow)).not.toContain("peer-window")
		expect(JSON.stringify(diagnostics.crossWindow)).not.toContain("secret")
	})
})

import { describe, expect, it, vi } from "vitest"

import type { ContextCacheBudgetCrossWindowPressure } from "../ContextCacheBudgetCoordinator"
import {
	CROSS_WINDOW_CONTEXT_CACHE_SCHEMA_VERSION,
	CrossWindowContextCacheCoordinator,
	calculateCrossWindowEffectiveBudgetBytes,
	createContextCacheNamespaceId,
	type CrossWindowContextCacheHeartbeat,
	type CrossWindowContextCacheHeartbeatReadResult,
	type CrossWindowContextCacheStorage,
} from "../CrossWindowContextCacheCoordinator"

class MemoryCrossWindowContextCacheStorage implements CrossWindowContextCacheStorage {
	readonly heartbeats = new Map<string, Map<string, CrossWindowContextCacheHeartbeat>>()
	readonly malformed = new Map<string, Set<string>>()
	readonly deleted: Array<{ namespaceId: string; instanceId: string }> = []

	async writeHeartbeat(
		namespaceId: string,
		instanceId: string,
		heartbeat: CrossWindowContextCacheHeartbeat,
	): Promise<void> {
		const namespace = this.getNamespace(namespaceId)
		namespace.set(instanceId, heartbeat)
	}

	async readHeartbeats(namespaceId: string): Promise<CrossWindowContextCacheHeartbeatReadResult[]> {
		const results: CrossWindowContextCacheHeartbeatReadResult[] = []
		for (const [instanceId, heartbeat] of this.heartbeats.get(namespaceId) ?? []) {
			results.push({ instanceId, heartbeat })
		}
		for (const instanceId of this.malformed.get(namespaceId) ?? []) {
			results.push({ instanceId, malformed: true })
		}
		return results
	}

	async deleteHeartbeat(namespaceId: string, instanceId: string): Promise<void> {
		this.heartbeats.get(namespaceId)?.delete(instanceId)
		this.malformed.get(namespaceId)?.delete(instanceId)
		this.deleted.push({ namespaceId, instanceId })
	}

	setHeartbeat(namespaceId: string, instanceId: string, heartbeat: CrossWindowContextCacheHeartbeat): void {
		this.getNamespace(namespaceId).set(instanceId, heartbeat)
	}

	setMalformed(namespaceId: string, instanceId: string): void {
		const namespace = this.malformed.get(namespaceId) ?? new Set<string>()
		namespace.add(instanceId)
		this.malformed.set(namespaceId, namespace)
	}

	getHeartbeat(namespaceId: string, instanceId: string): CrossWindowContextCacheHeartbeat | undefined {
		return this.heartbeats.get(namespaceId)?.get(instanceId)
	}

	private getNamespace(namespaceId: string): Map<string, CrossWindowContextCacheHeartbeat> {
		const namespace = this.heartbeats.get(namespaceId) ?? new Map<string, CrossWindowContextCacheHeartbeat>()
		this.heartbeats.set(namespaceId, namespace)
		return namespace
	}
}

function heartbeat(
	input: Partial<CrossWindowContextCacheHeartbeat> & { instanceId: string },
): CrossWindowContextCacheHeartbeat {
	return {
		schemaVersion: CROSS_WINDOW_CONTEXT_CACHE_SCHEMA_VERSION,
		instanceId: input.instanceId,
		namespaceId: input.namespaceId ?? "workspace-test",
		localCacheUsedBytes: input.localCacheUsedBytes ?? 0,
		localBudgetBytes: input.localBudgetBytes ?? 0,
		managerCount: input.managerCount,
		activeTaskCount: input.activeTaskCount,
		backgroundTaskCount: input.backgroundTaskCount,
		updatedAt: input.updatedAt ?? 1_000,
	}
}

describe("CrossWindowContextCacheCoordinator", () => {
	it("derives a stable namespace without exposing the workspace path", () => {
		const first = createContextCacheNamespaceId("C:/Users/alice/project")
		const second = createContextCacheNamespaceId("c:/users/alice/project/")

		expect(first).toBe(second)
		expect(first).toMatch(/^workspace-[a-f0-9]{24}$/)
		expect(first).not.toContain("alice")
		expect(first).not.toContain("project")
	})

	it("publishes only aggregate heartbeat data and omits content-like fields", async () => {
		const storage = new MemoryCrossWindowContextCacheStorage()
		const coordinator = new CrossWindowContextCacheCoordinator({
			storage,
			instanceId: "local-window",
			namespaceId: "workspace-test",
			now: () => 2_000,
		})

		await coordinator.updateLocalUsage({
			usedBytes: 123,
			budgetBytes: 1_000,
			managerCount: 2,
			activeTaskCount: 1,
			backgroundTaskCount: 1,
			prompt: "secret prompt",
			fileExcerpt: "secret file excerpt",
			taskText: "secret task text",
			chunks: [{ content: "secret chunk" }],
		} as any)

		const written = storage.getHeartbeat("workspace-test", "local-window")
		expect(written).toEqual({
			schemaVersion: CROSS_WINDOW_CONTEXT_CACHE_SCHEMA_VERSION,
			instanceId: "local-window",
			namespaceId: "workspace-test",
			localCacheUsedBytes: 123,
			localBudgetBytes: 1_000,
			managerCount: 2,
			activeTaskCount: 1,
			backgroundTaskCount: 1,
			updatedAt: 2_000,
		})
		expect(JSON.stringify(written)).not.toContain("secret")

		await coordinator.dispose()
	})

	it("reads live peer heartbeats and cleans stale or malformed entries", async () => {
		const storage = new MemoryCrossWindowContextCacheStorage()
		storage.setHeartbeat(
			"workspace-test",
			"peer-live",
			heartbeat({
				instanceId: "peer-live",
				localCacheUsedBytes: 500,
				localBudgetBytes: 1_000,
				activeTaskCount: 1,
				updatedAt: 1_900,
			}),
		)
		storage.setHeartbeat(
			"workspace-test",
			"peer-stale",
			heartbeat({ instanceId: "peer-stale", localCacheUsedBytes: 900, updatedAt: 1_000 }),
		)
		storage.setMalformed("workspace-test", "peer-partial-write")
		const onPressureChange = vi.fn()
		const coordinator = new CrossWindowContextCacheCoordinator({
			storage,
			instanceId: "local-window",
			namespaceId: "workspace-test",
			heartbeatTtlMs: 500,
			now: () => 2_000,
			onPressureChange,
		})

		const pressure = await coordinator.updateLocalUsage({ usedBytes: 250, budgetBytes: 1_000, activeTaskCount: 1 })

		expect(pressure).toMatchObject({
			livePeerCount: 1,
			windowCount: 2,
			localUsedBytes: 250,
			peerUsedBytes: 500,
			peerBudgetBytes: 1_000,
			localActiveTaskCount: 1,
			peerActiveTaskCount: 1,
			staleHeartbeatCount: 2,
			staleHeartbeatsCleaned: 2,
			staleHeartbeatCleanupFailures: 0,
		})
		expect(storage.getHeartbeat("workspace-test", "peer-stale")).toBeUndefined()
		expect(storage.malformed.get("workspace-test")?.has("peer-partial-write")).toBe(false)
		expect(onPressureChange).toHaveBeenCalledWith(pressure)

		await coordinator.dispose()
	})

	it("calculates a soft effective budget with a safe floor", () => {
		expect(
			calculateCrossWindowEffectiveBudgetBytes({
				localBudgetBytes: 1_000,
				peerUsedBytes: 300,
				minimumEffectiveBudgetRatio: 0.25,
			}),
		).toBe(700)
		expect(
			calculateCrossWindowEffectiveBudgetBytes({
				localBudgetBytes: 1_000,
				peerUsedBytes: 2_000,
				minimumEffectiveBudgetRatio: 0.25,
			}),
		).toBe(250)
		expect(
			calculateCrossWindowEffectiveBudgetBytes({
				localBudgetBytes: 1_000,
				peerUsedBytes: 0,
				minimumEffectiveBudgetRatio: 0.25,
			}),
		).toBe(1_000)
	})

	it("removes its heartbeat on dispose", async () => {
		const storage = new MemoryCrossWindowContextCacheStorage()
		const coordinator = new CrossWindowContextCacheCoordinator({
			storage,
			instanceId: "local-window",
			namespaceId: "workspace-test",
			now: () => 2_000,
		})

		await coordinator.updateLocalUsage({ usedBytes: 123, budgetBytes: 1_000 })
		expect(storage.getHeartbeat("workspace-test", "local-window")).toBeDefined()

		await coordinator.dispose()

		expect(storage.getHeartbeat("workspace-test", "local-window")).toBeUndefined()
		expect(storage.deleted).toContainEqual({ namespaceId: "workspace-test", instanceId: "local-window" })
	})
})

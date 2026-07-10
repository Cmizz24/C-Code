import { createHash, randomUUID } from "crypto"
import * as path from "path"
import fs from "fs/promises"

import { safeWriteJson } from "../../utils/safeWriteJson"
import type { ContextCacheBudgetCrossWindowPressure } from "./ContextCacheBudgetCoordinator"

export const CROSS_WINDOW_CONTEXT_CACHE_SCHEMA_VERSION = 1

const DEFAULT_HEARTBEAT_TTL_MS = 45_000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000
const DEFAULT_MIN_EFFECTIVE_BUDGET_RATIO = 0.25
const HEARTBEAT_FILE_EXTENSION = ".json"

export interface CrossWindowContextCacheLocalUsage {
	usedBytes: number
	budgetBytes: number
	managerCount?: number
	activeTaskCount?: number
	backgroundTaskCount?: number
}

export interface CrossWindowContextCacheHeartbeat {
	schemaVersion: typeof CROSS_WINDOW_CONTEXT_CACHE_SCHEMA_VERSION
	instanceId: string
	namespaceId: string
	localCacheUsedBytes: number
	localBudgetBytes: number
	managerCount?: number
	activeTaskCount?: number
	backgroundTaskCount?: number
	updatedAt: number
}

export interface CrossWindowContextCacheHeartbeatReadResult {
	instanceId: string
	heartbeat?: CrossWindowContextCacheHeartbeat
	malformed?: boolean
}

export interface CrossWindowContextCacheStorage {
	writeHeartbeat(namespaceId: string, instanceId: string, heartbeat: CrossWindowContextCacheHeartbeat): Promise<void>
	readHeartbeats(namespaceId: string): Promise<CrossWindowContextCacheHeartbeatReadResult[]>
	deleteHeartbeat(namespaceId: string, instanceId: string): Promise<void>
}

export interface CrossWindowContextCacheCoordinatorOptions {
	storage?: CrossWindowContextCacheStorage
	storageDirectory?: string
	instanceId?: string
	namespaceId?: string
	workspacePath?: string
	heartbeatTtlMs?: number
	heartbeatIntervalMs?: number
	minimumEffectiveBudgetRatio?: number
	now?: () => number
	autoStart?: boolean
	onPressureChange?: (pressure: ContextCacheBudgetCrossWindowPressure) => void
	onError?: (error: unknown) => void
}

function normalizeNonNegativeInteger(value: unknown): number {
	const numeric = typeof value === "number" ? value : Number(value)
	return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0
}

function normalizeOptionalCount(value: unknown): number | undefined {
	const normalized = normalizeNonNegativeInteger(value)
	return normalized > 0 ? normalized : undefined
}

function sanitizeFileSegment(value: string): string {
	const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
	return sanitized.length > 0 ? sanitized.slice(0, 120) : "unknown"
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeLocalUsage(usage: CrossWindowContextCacheLocalUsage): CrossWindowContextCacheLocalUsage {
	return {
		usedBytes: normalizeNonNegativeInteger(usage.usedBytes),
		budgetBytes: normalizeNonNegativeInteger(usage.budgetBytes),
		managerCount: normalizeOptionalCount(usage.managerCount),
		activeTaskCount: normalizeOptionalCount(usage.activeTaskCount),
		backgroundTaskCount: normalizeOptionalCount(usage.backgroundTaskCount),
	}
}

function createHeartbeat(
	namespaceId: string,
	instanceId: string,
	usage: CrossWindowContextCacheLocalUsage,
	updatedAt: number,
): CrossWindowContextCacheHeartbeat {
	const normalized = normalizeLocalUsage(usage)
	return {
		schemaVersion: CROSS_WINDOW_CONTEXT_CACHE_SCHEMA_VERSION,
		instanceId,
		namespaceId,
		localCacheUsedBytes: normalized.usedBytes,
		localBudgetBytes: normalized.budgetBytes,
		managerCount: normalized.managerCount,
		activeTaskCount: normalized.activeTaskCount,
		backgroundTaskCount: normalized.backgroundTaskCount,
		updatedAt: normalizeNonNegativeInteger(updatedAt),
	}
}

function parseHeartbeat(value: unknown): CrossWindowContextCacheHeartbeat | undefined {
	if (!isObject(value)) {
		return undefined
	}

	if (value.schemaVersion !== CROSS_WINDOW_CONTEXT_CACHE_SCHEMA_VERSION) {
		return undefined
	}

	if (typeof value.instanceId !== "string" || typeof value.namespaceId !== "string") {
		return undefined
	}

	const updatedAt = normalizeNonNegativeInteger(value.updatedAt)
	if (updatedAt <= 0) {
		return undefined
	}

	return {
		schemaVersion: CROSS_WINDOW_CONTEXT_CACHE_SCHEMA_VERSION,
		instanceId: value.instanceId,
		namespaceId: value.namespaceId,
		localCacheUsedBytes: normalizeNonNegativeInteger(value.localCacheUsedBytes),
		localBudgetBytes: normalizeNonNegativeInteger(value.localBudgetBytes),
		managerCount: normalizeOptionalCount(value.managerCount),
		activeTaskCount: normalizeOptionalCount(value.activeTaskCount),
		backgroundTaskCount: normalizeOptionalCount(value.backgroundTaskCount),
		updatedAt,
	}
}

export function createContextCacheNamespaceId(workspacePath: string | undefined): string {
	const normalizedWorkspacePath = (workspacePath ?? "global")
		.trim()
		.replace(/\\/g, "/")
		.replace(/\/+$/g, "")
		.toLowerCase()
	const source = normalizedWorkspacePath.length > 0 ? normalizedWorkspacePath : "global"
	const digest = createHash("sha256").update(source).digest("hex").slice(0, 24)
	return `workspace-${digest}`
}

export function calculateCrossWindowEffectiveBudgetBytes(options: {
	localBudgetBytes: number
	peerUsedBytes: number
	minimumEffectiveBudgetRatio?: number
}): number {
	const localBudgetBytes = normalizeNonNegativeInteger(options.localBudgetBytes)
	if (localBudgetBytes <= 0) {
		return 0
	}

	const peerUsedBytes = normalizeNonNegativeInteger(options.peerUsedBytes)
	const ratio =
		typeof options.minimumEffectiveBudgetRatio === "number" &&
		Number.isFinite(options.minimumEffectiveBudgetRatio) &&
		options.minimumEffectiveBudgetRatio > 0
			? Math.min(1, options.minimumEffectiveBudgetRatio)
			: DEFAULT_MIN_EFFECTIVE_BUDGET_RATIO
	const floorBytes = Math.max(1, Math.floor(localBudgetBytes * ratio))
	return Math.min(localBudgetBytes, Math.max(floorBytes, localBudgetBytes - peerUsedBytes))
}

export class FileCrossWindowContextCacheStorage implements CrossWindowContextCacheStorage {
	constructor(private readonly rootDirectory: string) {}

	async writeHeartbeat(
		namespaceId: string,
		instanceId: string,
		heartbeat: CrossWindowContextCacheHeartbeat,
	): Promise<void> {
		await safeWriteJson(this.getHeartbeatPath(namespaceId, instanceId), heartbeat)
	}

	async readHeartbeats(namespaceId: string): Promise<CrossWindowContextCacheHeartbeatReadResult[]> {
		let fileNames: string[]
		try {
			fileNames = await fs.readdir(this.getNamespaceDirectory(namespaceId))
		} catch (error: any) {
			if (error?.code === "ENOENT") {
				return []
			}
			throw error
		}

		const results: CrossWindowContextCacheHeartbeatReadResult[] = []
		for (const fileName of fileNames) {
			if (!fileName.endsWith(HEARTBEAT_FILE_EXTENSION)) {
				continue
			}

			const instanceId = fileName.slice(0, -HEARTBEAT_FILE_EXTENSION.length)
			try {
				const raw = await fs.readFile(path.join(this.getNamespaceDirectory(namespaceId), fileName), "utf8")
				const heartbeat = parseHeartbeat(JSON.parse(raw))
				results.push(heartbeat ? { instanceId, heartbeat } : { instanceId, malformed: true })
			} catch {
				results.push({ instanceId, malformed: true })
			}
		}

		return results
	}

	async deleteHeartbeat(namespaceId: string, instanceId: string): Promise<void> {
		try {
			await fs.unlink(this.getHeartbeatPath(namespaceId, instanceId))
		} catch (error: any) {
			if (error?.code !== "ENOENT") {
				throw error
			}
		}
	}

	private getNamespaceDirectory(namespaceId: string): string {
		return path.join(this.rootDirectory, sanitizeFileSegment(namespaceId))
	}

	private getHeartbeatPath(namespaceId: string, instanceId: string): string {
		return path.join(
			this.getNamespaceDirectory(namespaceId),
			`${sanitizeFileSegment(instanceId)}${HEARTBEAT_FILE_EXTENSION}`,
		)
	}
}

export class CrossWindowContextCacheCoordinator {
	readonly instanceId: string
	readonly namespaceId: string

	private readonly storage: CrossWindowContextCacheStorage
	private readonly heartbeatTtlMs: number
	private readonly heartbeatIntervalMs: number
	private readonly minimumEffectiveBudgetRatio: number
	private readonly now: () => number
	private readonly onPressureChange?: (pressure: ContextCacheBudgetCrossWindowPressure) => void
	private readonly onError?: (error: unknown) => void
	private heartbeatTimer: ReturnType<typeof setInterval> | undefined
	private disposed = false
	private hasLocalUsage = false
	private localUsage: CrossWindowContextCacheLocalUsage = { usedBytes: 0, budgetBytes: 0 }
	private pressure: ContextCacheBudgetCrossWindowPressure

	constructor(options: CrossWindowContextCacheCoordinatorOptions = {}) {
		this.instanceId = options.instanceId ?? randomUUID()
		this.namespaceId = options.namespaceId ?? createContextCacheNamespaceId(options.workspacePath)
		this.storage =
			options.storage ??
			new FileCrossWindowContextCacheStorage(options.storageDirectory ?? path.join("context-cache-heartbeats"))
		this.heartbeatTtlMs = normalizeNonNegativeInteger(options.heartbeatTtlMs) || DEFAULT_HEARTBEAT_TTL_MS
		this.heartbeatIntervalMs =
			normalizeNonNegativeInteger(options.heartbeatIntervalMs) || DEFAULT_HEARTBEAT_INTERVAL_MS
		this.minimumEffectiveBudgetRatio =
			typeof options.minimumEffectiveBudgetRatio === "number" &&
			Number.isFinite(options.minimumEffectiveBudgetRatio)
				? options.minimumEffectiveBudgetRatio
				: DEFAULT_MIN_EFFECTIVE_BUDGET_RATIO
		this.now = options.now ?? Date.now
		this.onPressureChange = options.onPressureChange
		this.onError = options.onError
		this.pressure = this.createEmptyPressure(this.now())

		if (options.autoStart === true) {
			this.start()
		}
	}

	start(): void {
		if (this.heartbeatTimer || this.disposed) {
			return
		}

		this.heartbeatTimer = setInterval(() => {
			if (!this.hasLocalUsage) {
				return
			}

			void this.updateLocalUsage(this.localUsage).catch((error) => this.onError?.(error))
		}, this.heartbeatIntervalMs)
		this.heartbeatTimer.unref?.()
	}

	async updateLocalUsage(usage: CrossWindowContextCacheLocalUsage): Promise<ContextCacheBudgetCrossWindowPressure> {
		if (this.disposed) {
			return this.pressure
		}

		this.start()
		this.localUsage = normalizeLocalUsage(usage)
		this.hasLocalUsage = true
		const heartbeat = createHeartbeat(this.namespaceId, this.instanceId, this.localUsage, this.now())
		await this.storage.writeHeartbeat(this.namespaceId, this.instanceId, heartbeat)
		return this.refresh()
	}

	async refresh(): Promise<ContextCacheBudgetCrossWindowPressure> {
		if (this.disposed) {
			return this.pressure
		}

		const now = this.now()
		const entries = await this.storage.readHeartbeats(this.namespaceId)
		const livePeers: CrossWindowContextCacheHeartbeat[] = []
		let staleHeartbeatCount = 0
		let staleHeartbeatsCleaned = 0
		let staleHeartbeatCleanupFailures = 0

		for (const entry of entries) {
			const heartbeat = entry.heartbeat
			const shouldDiscard =
				entry.malformed === true ||
				!heartbeat ||
				heartbeat.schemaVersion !== CROSS_WINDOW_CONTEXT_CACHE_SCHEMA_VERSION ||
				heartbeat.namespaceId !== this.namespaceId ||
				heartbeat.instanceId !== entry.instanceId ||
				this.isStale(heartbeat, now)

			if (shouldDiscard) {
				staleHeartbeatCount++
				try {
					await this.storage.deleteHeartbeat(this.namespaceId, entry.instanceId)
					staleHeartbeatsCleaned++
				} catch {
					staleHeartbeatCleanupFailures++
				}
				continue
			}

			if (heartbeat.instanceId !== this.instanceId) {
				livePeers.push(heartbeat)
			}
		}

		this.pressure = this.createPressure(now, livePeers, {
			staleHeartbeatCount,
			staleHeartbeatsCleaned,
			staleHeartbeatCleanupFailures,
		})
		this.onPressureChange?.(this.pressure)
		return this.pressure
	}

	getPressure(): ContextCacheBudgetCrossWindowPressure {
		return this.pressure
	}

	async dispose(): Promise<void> {
		if (this.disposed) {
			return
		}

		this.disposed = true
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer)
			this.heartbeatTimer = undefined
		}

		try {
			await this.storage.deleteHeartbeat(this.namespaceId, this.instanceId)
		} catch (error) {
			this.onError?.(error)
		}
	}

	private isStale(heartbeat: CrossWindowContextCacheHeartbeat, now: number): boolean {
		const ageMs = now - heartbeat.updatedAt
		return ageMs > this.heartbeatTtlMs || ageMs < -this.heartbeatTtlMs
	}

	private createEmptyPressure(now: number): ContextCacheBudgetCrossWindowPressure {
		return {
			schemaVersion: CROSS_WINDOW_CONTEXT_CACHE_SCHEMA_VERSION,
			instanceId: this.instanceId,
			namespaceId: this.namespaceId,
			localUsedBytes: 0,
			localBudgetBytes: 0,
			peerUsedBytes: 0,
			peerBudgetBytes: 0,
			globalBudgetBytes: 0,
			effectiveLocalBudgetBytes: 0,
			livePeerCount: 0,
			windowCount: 1,
			localActiveTaskCount: 0,
			localBackgroundTaskCount: 0,
			peerActiveTaskCount: 0,
			peerBackgroundTaskCount: 0,
			staleHeartbeatCount: 0,
			staleHeartbeatsCleaned: 0,
			staleHeartbeatCleanupFailures: 0,
			lastUpdatedAt: now,
		}
	}

	private createPressure(
		now: number,
		livePeers: CrossWindowContextCacheHeartbeat[],
		cleanup: Pick<
			ContextCacheBudgetCrossWindowPressure,
			"staleHeartbeatCount" | "staleHeartbeatsCleaned" | "staleHeartbeatCleanupFailures"
		>,
	): ContextCacheBudgetCrossWindowPressure {
		const localUsedBytes = normalizeNonNegativeInteger(this.localUsage.usedBytes)
		const localBudgetBytes = normalizeNonNegativeInteger(this.localUsage.budgetBytes)
		const peerUsedBytes = livePeers.reduce((total, peer) => total + peer.localCacheUsedBytes, 0)
		const peerBudgetBytes = livePeers.reduce((total, peer) => total + peer.localBudgetBytes, 0)
		const effectiveLocalBudgetBytes = calculateCrossWindowEffectiveBudgetBytes({
			localBudgetBytes,
			peerUsedBytes,
			minimumEffectiveBudgetRatio: this.minimumEffectiveBudgetRatio,
		})

		return {
			schemaVersion: CROSS_WINDOW_CONTEXT_CACHE_SCHEMA_VERSION,
			instanceId: this.instanceId,
			namespaceId: this.namespaceId,
			localUsedBytes,
			localBudgetBytes,
			peerUsedBytes,
			peerBudgetBytes,
			globalBudgetBytes: localBudgetBytes,
			effectiveLocalBudgetBytes,
			livePeerCount: livePeers.length,
			windowCount: livePeers.length + 1,
			localActiveTaskCount: normalizeNonNegativeInteger(this.localUsage.activeTaskCount),
			localBackgroundTaskCount: normalizeNonNegativeInteger(this.localUsage.backgroundTaskCount),
			peerActiveTaskCount: livePeers.reduce(
				(total, peer) => total + normalizeNonNegativeInteger(peer.activeTaskCount),
				0,
			),
			peerBackgroundTaskCount: livePeers.reduce(
				(total, peer) => total + normalizeNonNegativeInteger(peer.backgroundTaskCount),
				0,
			),
			...cleanup,
			lastUpdatedAt: now,
		}
	}
}

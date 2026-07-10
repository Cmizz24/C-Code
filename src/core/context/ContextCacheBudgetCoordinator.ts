import type {
	ContextCacheCombinedBudgetStats,
	ContextCacheCrossWindowStats,
	ContextCacheContributorStats,
	ContextCacheEvictionTotals,
} from "@roo-code/types"

import type { ContextChunk } from "./ContextChunk"

const BYTES_PER_MB = 1024 * 1024
const DEFAULT_COMBINED_CONTEXT_CACHE_BUDGET_MB = 1024

export const DEFAULT_HOT_CACHE_MEMORY_ESTIMATE_BYTES_PER_TOKEN = 4

export type ContextCacheBudgetCacheKind = "hot" | "cold"

export interface ContextCacheBudgetManagerSnapshot {
	managerId: string
	hotBytes: number
	coldBytes: number
	hotChunks: number
	coldChunks: number
	isBackground: boolean
	isActive: boolean
	taskId?: string
	instanceId?: string
	mode?: string
	agentId?: string
	hotEvictions?: number
	coldEvictions?: number
}

export interface ContextCacheBudgetEvictionCandidate {
	managerId: string
	cacheKind: ContextCacheBudgetCacheKind
	chunk: ContextChunk
	bytes: number
	isBackground: boolean
	isActive: boolean
}

export interface ContextCacheBudgetCoordinatorManager {
	readonly contextCacheBudgetManagerId: string
	getContextCacheBudgetSnapshot(): ContextCacheBudgetManagerSnapshot
	getColdCacheEvictionCandidates(protectedChunkIds?: ReadonlySet<string>): ContextCacheBudgetEvictionCandidate[]
	getHotCacheEvictionCandidates(protectedChunkIds?: ReadonlySet<string>): ContextCacheBudgetEvictionCandidate[]
	evictColdCacheChunk(chunkId: string): ContextChunk | undefined
	evictHotCacheChunk(chunkId: string): ContextChunk | undefined
}

export interface ContextCacheBudgetUsage {
	configuredBudgetBytes: number
	budgetBytes: number
	usedBytes: number
	hotBytes: number
	coldBytes: number
	hotChunks: number
	coldChunks: number
	managerCount: number
	activeManagerCount: number
	backgroundManagerCount: number
	configuredRamBudgetMb: number
	ramUsedMb: number
	ramBudgetMb: number
}

export type ContextCacheBudgetDiagnostics = ContextCacheCombinedBudgetStats

export interface ContextCacheBudgetEnforcementOptions {
	protectedChunkIds?: Iterable<string>
}

export interface ContextCacheBudgetEviction {
	managerId: string
	cacheKind: ContextCacheBudgetCacheKind
	chunkId: string
	bytes: number
}

export interface ContextCacheBudgetEnforcementResult {
	budgetBytes: number
	usedBytes: number
	overBudget: boolean
	evicted: ContextCacheBudgetEviction[]
}

export interface ContextCacheBudgetCoordinatorOptions {
	budgetBytes?: number
	budgetMb?: number
}

export interface ContextCacheBudgetCrossWindowPressure {
	schemaVersion: number
	instanceId: string
	namespaceId: string
	localUsedBytes: number
	localBudgetBytes: number
	peerUsedBytes: number
	peerBudgetBytes: number
	globalBudgetBytes: number
	effectiveLocalBudgetBytes: number
	livePeerCount: number
	windowCount: number
	localActiveTaskCount?: number
	localBackgroundTaskCount?: number
	peerActiveTaskCount?: number
	peerBackgroundTaskCount?: number
	staleHeartbeatCount?: number
	staleHeartbeatsCleaned?: number
	staleHeartbeatCleanupFailures?: number
	lastUpdatedAt?: number
}

export function contextCacheBudgetMbToBytes(valueMb: number): number {
	return normalizeBudgetBytes(valueMb * BYTES_PER_MB)
}

export function contextCacheBudgetBytesToMb(valueBytes: number): number {
	return Number((Math.max(0, valueBytes) / BYTES_PER_MB).toFixed(2))
}

export function estimateHotContextChunkBytes(chunk: ContextChunk): number {
	return Math.max(
		0,
		Math.ceil(Math.max(chunk.bytes, chunk.tokens * DEFAULT_HOT_CACHE_MEMORY_ESTIMATE_BYTES_PER_TOKEN)),
	)
}

function normalizeBudgetBytes(value: unknown): number {
	const numeric = typeof value === "number" ? value : Number(value)
	return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0
}

function getCandidateAttemptKey(candidate: ContextCacheBudgetEvictionCandidate): string {
	return `${candidate.cacheKind}:${candidate.managerId}:${candidate.chunk.id}`
}

function normalizeDiagnosticText(value: string | undefined, maxLength = 80): string | undefined {
	if (!value) {
		return undefined
	}

	const normalized = value
		.replace(/[\r\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
	if (!normalized) {
		return undefined
	}

	return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized
}

function getSnapshotUsedBytes(snapshot: ContextCacheBudgetManagerSnapshot): number {
	return snapshot.hotBytes + snapshot.coldBytes
}

function getPositiveInteger(value: unknown): number | undefined {
	const numeric = typeof value === "number" ? value : Number(value)
	return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : undefined
}

function toCrossWindowStats(pressure: ContextCacheBudgetCrossWindowPressure): ContextCacheCrossWindowStats {
	return {
		schemaVersion: pressure.schemaVersion,
		livePeerCount: pressure.livePeerCount,
		windowCount: pressure.windowCount,
		localUsageRamMb: contextCacheBudgetBytesToMb(pressure.localUsedBytes),
		localBudgetRamMb: contextCacheBudgetBytesToMb(pressure.localBudgetBytes),
		peerUsageRamMb: contextCacheBudgetBytesToMb(pressure.peerUsedBytes),
		peerBudgetRamMb: contextCacheBudgetBytesToMb(pressure.peerBudgetBytes),
		globalBudgetRamMb: contextCacheBudgetBytesToMb(pressure.globalBudgetBytes),
		effectiveLocalBudgetRamMb: contextCacheBudgetBytesToMb(pressure.effectiveLocalBudgetBytes),
		localActiveTaskCount: getPositiveInteger(pressure.localActiveTaskCount),
		localBackgroundTaskCount: getPositiveInteger(pressure.localBackgroundTaskCount),
		peerActiveTaskCount: getPositiveInteger(pressure.peerActiveTaskCount),
		peerBackgroundTaskCount: getPositiveInteger(pressure.peerBackgroundTaskCount),
		staleHeartbeatCount: getPositiveInteger(pressure.staleHeartbeatCount),
		staleHeartbeatsCleaned: getPositiveInteger(pressure.staleHeartbeatsCleaned),
		staleHeartbeatCleanupFailures: getPositiveInteger(pressure.staleHeartbeatCleanupFailures),
		lastUpdatedAt: getPositiveInteger(pressure.lastUpdatedAt),
	}
}

function getEvictionTotal(value: number | undefined): number {
	return Number.isFinite(value) && value !== undefined ? Math.max(0, Math.floor(value)) : 0
}

function getSnapshotEvictions(snapshot: ContextCacheBudgetManagerSnapshot): ContextCacheEvictionTotals {
	const hot = getEvictionTotal(snapshot.hotEvictions)
	const cold = getEvictionTotal(snapshot.coldEvictions)
	return { hot, cold, total: hot + cold }
}

function getContributorLabel(snapshot: ContextCacheBudgetManagerSnapshot): string {
	const agentId = normalizeDiagnosticText(snapshot.agentId)
	const taskId = normalizeDiagnosticText(snapshot.taskId)
	const instanceId = normalizeDiagnosticText(snapshot.instanceId)
	const mode = normalizeDiagnosticText(snapshot.mode)
	const identifier = agentId ?? taskId ?? instanceId ?? normalizeDiagnosticText(snapshot.managerId) ?? "unknown"
	const role = snapshot.isBackground
		? agentId
			? "Background agent"
			: "Background task"
		: snapshot.isActive
			? "Foreground task"
			: "Task"
	const suffix = mode ? ` (${mode})` : ""

	return `${role} ${identifier}${suffix}`
}

function compareContributorSnapshots(
	left: ContextCacheBudgetManagerSnapshot,
	right: ContextCacheBudgetManagerSnapshot,
): number {
	const usedDiff = getSnapshotUsedBytes(right) - getSnapshotUsedBytes(left)
	if (usedDiff !== 0) {
		return usedDiff
	}

	if (left.isActive !== right.isActive) {
		return left.isActive ? -1 : 1
	}

	if (left.isBackground !== right.isBackground) {
		return left.isBackground ? 1 : -1
	}

	const labelDiff = getContributorLabel(left).localeCompare(getContributorLabel(right))
	return labelDiff !== 0 ? labelDiff : left.managerId.localeCompare(right.managerId)
}

function toContributorStats(snapshot: ContextCacheBudgetManagerSnapshot): ContextCacheContributorStats {
	return {
		id: snapshot.managerId,
		label: getContributorLabel(snapshot),
		taskId: normalizeDiagnosticText(snapshot.taskId),
		instanceId: normalizeDiagnosticText(snapshot.instanceId),
		mode: normalizeDiagnosticText(snapshot.mode),
		agentId: normalizeDiagnosticText(snapshot.agentId),
		isBackground: snapshot.isBackground,
		isActive: snapshot.isActive,
		hotCacheChunks: snapshot.hotChunks,
		coldCacheChunks: snapshot.coldChunks,
		hotCacheRamMb: contextCacheBudgetBytesToMb(snapshot.hotBytes),
		coldCacheRamMb: contextCacheBudgetBytesToMb(snapshot.coldBytes),
		ramUsedMb: contextCacheBudgetBytesToMb(getSnapshotUsedBytes(snapshot)),
		evictions: getSnapshotEvictions(snapshot),
	}
}

function compareEvictionCandidates(
	left: ContextCacheBudgetEvictionCandidate,
	right: ContextCacheBudgetEvictionCandidate,
): number {
	if (left.chunk.priority !== right.chunk.priority) {
		return left.chunk.priority - right.chunk.priority
	}
	if (left.chunk.lastAccessedAt !== right.chunk.lastAccessedAt) {
		return left.chunk.lastAccessedAt - right.chunk.lastAccessedAt
	}
	if (left.chunk.createdAt !== right.chunk.createdAt) {
		return left.chunk.createdAt - right.chunk.createdAt
	}
	if (left.isActive !== right.isActive) {
		return left.isActive ? 1 : -1
	}
	if (left.isBackground !== right.isBackground) {
		return left.isBackground ? -1 : 1
	}
	if (left.managerId !== right.managerId) {
		return left.managerId.localeCompare(right.managerId)
	}
	return left.chunk.id.localeCompare(right.chunk.id)
}

export class ContextCacheBudgetCoordinator {
	private readonly managers = new Map<string, ContextCacheBudgetCoordinatorManager>()
	private budgetBytes: number
	private crossWindowPressure: ContextCacheBudgetCrossWindowPressure | undefined

	constructor(options: ContextCacheBudgetCoordinatorOptions = {}) {
		this.budgetBytes = normalizeBudgetBytes(
			options.budgetBytes ??
				contextCacheBudgetMbToBytes(options.budgetMb ?? DEFAULT_COMBINED_CONTEXT_CACHE_BUDGET_MB),
		)
	}

	register(manager: ContextCacheBudgetCoordinatorManager): () => void {
		this.managers.set(manager.contextCacheBudgetManagerId, manager)
		this.enforceBudget()

		return () => this.unregister(manager)
	}

	unregister(managerOrId: ContextCacheBudgetCoordinatorManager | string): void {
		const managerId = typeof managerOrId === "string" ? managerOrId : managerOrId.contextCacheBudgetManagerId
		this.managers.delete(managerId)
	}

	updateBudgetBytes(budgetBytes: number): ContextCacheBudgetEnforcementResult {
		this.budgetBytes = normalizeBudgetBytes(budgetBytes)
		return this.enforceBudget()
	}

	updateCrossWindowPressure(
		pressure: ContextCacheBudgetCrossWindowPressure | undefined,
	): ContextCacheBudgetEnforcementResult {
		this.crossWindowPressure = pressure
		return this.enforceBudget()
	}

	updateBudgetMb(budgetMb: number): ContextCacheBudgetEnforcementResult {
		return this.updateBudgetBytes(contextCacheBudgetMbToBytes(budgetMb))
	}

	getBudgetBytes(): number {
		return this.budgetBytes
	}

	getEffectiveBudgetBytes(): number {
		const effectiveBudgetBytes = normalizeBudgetBytes(this.crossWindowPressure?.effectiveLocalBudgetBytes)
		return effectiveBudgetBytes > 0 ? Math.min(this.budgetBytes, effectiveBudgetBytes) : this.budgetBytes
	}

	getUsage(): ContextCacheBudgetUsage {
		const snapshots = this.getSnapshots()
		const hotBytes = snapshots.reduce((total, snapshot) => total + snapshot.hotBytes, 0)
		const coldBytes = snapshots.reduce((total, snapshot) => total + snapshot.coldBytes, 0)
		const hotChunks = snapshots.reduce((total, snapshot) => total + snapshot.hotChunks, 0)
		const coldChunks = snapshots.reduce((total, snapshot) => total + snapshot.coldChunks, 0)
		const activeManagerCount = snapshots.filter((snapshot) => snapshot.isActive).length
		const backgroundManagerCount = snapshots.filter((snapshot) => snapshot.isBackground).length
		const usedBytes = hotBytes + coldBytes
		const effectiveBudgetBytes = this.getEffectiveBudgetBytes()

		return {
			configuredBudgetBytes: this.budgetBytes,
			budgetBytes: effectiveBudgetBytes,
			usedBytes,
			hotBytes,
			coldBytes,
			hotChunks,
			coldChunks,
			managerCount: snapshots.length,
			activeManagerCount,
			backgroundManagerCount,
			configuredRamBudgetMb: contextCacheBudgetBytesToMb(this.budgetBytes),
			ramUsedMb: contextCacheBudgetBytesToMb(usedBytes),
			ramBudgetMb: contextCacheBudgetBytesToMb(effectiveBudgetBytes),
		}
	}

	getDiagnostics(): ContextCacheBudgetDiagnostics {
		const snapshots = this.getSnapshots()
		const usage = this.getUsage()
		const contributors = snapshots.sort(compareContributorSnapshots).map(toContributorStats)
		const evictions = contributors.reduce<ContextCacheEvictionTotals>(
			(totals, contributor) => {
				const contributorEvictions = contributor.evictions ?? { hot: 0, cold: 0, total: 0 }
				return {
					hot: totals.hot + contributorEvictions.hot,
					cold: totals.cold + contributorEvictions.cold,
					total: totals.total + contributorEvictions.total,
				}
			},
			{ hot: 0, cold: 0, total: 0 },
		)

		return {
			ramUsedMb: usage.ramUsedMb,
			ramBudgetMb: usage.ramBudgetMb,
			configuredRamBudgetMb: usage.configuredRamBudgetMb,
			hotCacheRamMb: contextCacheBudgetBytesToMb(usage.hotBytes),
			coldCacheRamMb: contextCacheBudgetBytesToMb(usage.coldBytes),
			hotCacheChunks: usage.hotChunks,
			coldCacheChunks: usage.coldChunks,
			managerCount: usage.managerCount,
			evictions,
			contributors,
			crossWindow: this.crossWindowPressure ? toCrossWindowStats(this.crossWindowPressure) : undefined,
		}
	}

	enforceBudget(options: ContextCacheBudgetEnforcementOptions = {}): ContextCacheBudgetEnforcementResult {
		const protectedChunkIds = new Set(options.protectedChunkIds ?? [])
		const evicted: ContextCacheBudgetEviction[] = []
		const attempted = new Set<string>()
		let usage = this.getUsage()

		const effectiveBudgetBytes = this.getEffectiveBudgetBytes()

		while (usage.usedBytes > effectiveBudgetBytes) {
			const candidate = this.getNextEvictionCandidate(protectedChunkIds, attempted)
			if (!candidate) {
				break
			}

			attempted.add(getCandidateAttemptKey(candidate))
			const removed = this.evictCandidate(candidate)
			if (removed) {
				evicted.push(removed)
			}

			const nextUsage = this.getUsage()
			if (nextUsage.usedBytes >= usage.usedBytes && !removed) {
				usage = nextUsage
				continue
			}
			usage = nextUsage
		}

		return {
			budgetBytes: effectiveBudgetBytes,
			usedBytes: usage.usedBytes,
			overBudget: usage.usedBytes > effectiveBudgetBytes,
			evicted,
		}
	}

	private getNextEvictionCandidate(
		protectedChunkIds: ReadonlySet<string>,
		attempted: ReadonlySet<string>,
	): ContextCacheBudgetEvictionCandidate | undefined {
		const coldCandidate = this.getSortedCandidates("cold", protectedChunkIds).find(
			(candidate) => !attempted.has(getCandidateAttemptKey(candidate)),
		)
		if (coldCandidate) {
			return coldCandidate
		}

		return this.getSortedCandidates("hot", protectedChunkIds).find(
			(candidate) => !attempted.has(getCandidateAttemptKey(candidate)),
		)
	}

	private getSortedCandidates(
		cacheKind: ContextCacheBudgetCacheKind,
		protectedChunkIds: ReadonlySet<string>,
	): ContextCacheBudgetEvictionCandidate[] {
		return [...this.managers.values()]
			.flatMap((manager) =>
				cacheKind === "cold"
					? manager.getColdCacheEvictionCandidates(protectedChunkIds)
					: manager.getHotCacheEvictionCandidates(protectedChunkIds),
			)
			.sort(compareEvictionCandidates)
	}

	private getSnapshots(): ContextCacheBudgetManagerSnapshot[] {
		return [...this.managers.values()].map((manager) => manager.getContextCacheBudgetSnapshot())
	}

	private evictCandidate(candidate: ContextCacheBudgetEvictionCandidate): ContextCacheBudgetEviction | undefined {
		const manager = this.managers.get(candidate.managerId)
		if (!manager) {
			return undefined
		}

		const removed =
			candidate.cacheKind === "cold"
				? manager.evictColdCacheChunk(candidate.chunk.id)
				: manager.evictHotCacheChunk(candidate.chunk.id)

		if (!removed) {
			return undefined
		}

		return {
			managerId: candidate.managerId,
			cacheKind: candidate.cacheKind,
			chunkId: removed.id,
			bytes: candidate.bytes,
		}
	}
}

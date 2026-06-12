import type { ContextCacheSearchResult, ContextCacheStats } from "@roo-code/types"

import { ColdCache } from "./ColdCache"
import { ContextChunk, ContextChunkSearchResult, RegisterContextChunkInput, createContextChunk } from "./ContextChunk"
import { HotCache } from "./HotCache"

export const DEFAULT_COLD_CACHE_RAM_BUDGET_MB = 512
export const CONTEXT_CACHE_FULL_WARNING = "Cold cache full — falling back to condensing"

export interface ContextWindowManagerOptions {
	hotTokenBudget: number
	coldCacheRamBudgetMb?: number
}

export interface ContextPressureOptions {
	totalTokens: number
	allowedTokens: number
	protectedMessageTimestamps?: number[]
}

export interface ContextPressureResult {
	handled: boolean
	movedChunks: number
	movedTokens: number
	warning?: string
}

export function normalizeColdCacheRamBudgetMb(value: unknown): number {
	const numeric = typeof value === "number" ? value : Number(value)
	if (!Number.isFinite(numeric)) {
		return DEFAULT_COLD_CACHE_RAM_BUDGET_MB
	}

	if (numeric <= 256) {
		return 256
	}
	if (numeric <= 512) {
		return 512
	}
	if (numeric <= 1024) {
		return 1024
	}
	return 2048
}

export function coldCacheRamBudgetMbToBytes(value: unknown = DEFAULT_COLD_CACHE_RAM_BUDGET_MB): number {
	return normalizeColdCacheRamBudgetMb(value) * 1024 * 1024
}

function toSearchResult(result: ContextChunkSearchResult): ContextCacheSearchResult {
	return {
		id: result.chunk.id,
		type: result.chunk.type,
		content: result.chunk.content,
		filePath: result.chunk.metadata?.filePath,
		tokens: result.chunk.tokens,
		score: Number(result.score.toFixed(4)),
		breakdown: result.breakdown,
	}
}

export class ContextWindowManager {
	private readonly hotCache: HotCache
	private readonly coldCache: ColdCache
	private readonly hiddenMessageTimestamps = new Set<number>()
	private warning: string | undefined
	private swapsThisSession = 0
	private condensingAvoided = 0

	constructor(options: ContextWindowManagerOptions) {
		this.hotCache = new HotCache(Math.max(1, Math.floor(options.hotTokenBudget)))
		this.coldCache = new ColdCache(coldCacheRamBudgetMbToBytes(options.coldCacheRamBudgetMb))
	}

	updateOptions(options: Partial<ContextWindowManagerOptions>): void {
		if (options.hotTokenBudget !== undefined) {
			const evicted = this.hotCache.updateBudget(options.hotTokenBudget)
			this.moveChunksToCold(evicted)
		}

		if (options.coldCacheRamBudgetMb !== undefined) {
			const result = this.coldCache.updateBudget(coldCacheRamBudgetMbToBytes(options.coldCacheRamBudgetMb))
			for (const evictedChunk of result.evicted) {
				this.unhideMessageTimestamps(evictedChunk)
			}
			if (!result.accepted) {
				this.warning = CONTEXT_CACHE_FULL_WARNING
			}
		}
	}

	registerChunk(input: RegisterContextChunkInput): ContextChunk | undefined {
		const chunk = createContextChunk(input)
		if (!chunk) {
			return undefined
		}

		const evicted = this.hotCache.add(chunk)
		this.moveChunksToCold(evicted)
		return chunk
	}

	handlePressure(options: ContextPressureOptions): ContextPressureResult {
		const targetReduction = Math.max(1, Math.ceil(options.totalTokens - options.allowedTokens))
		const protectedMessageTimestamps = new Set(options.protectedMessageTimestamps ?? [])
		const evicted = this.hotCache.evictForPressure(targetReduction, {
			canEvict: (chunk) => this.canEvictForRequestPressure(chunk, protectedMessageTimestamps),
		})

		if (evicted.length === 0) {
			return { handled: false, movedChunks: 0, movedTokens: 0, warning: this.warning }
		}

		const moved = this.moveChunksToCold(evicted)
		if (!moved.accepted) {
			this.warning = CONTEXT_CACHE_FULL_WARNING
			return {
				handled: false,
				movedChunks: moved.movedChunks,
				movedTokens: moved.movedTokens,
				warning: this.warning,
			}
		}

		if (moved.movedTokens < targetReduction) {
			return {
				handled: false,
				movedChunks: moved.movedChunks,
				movedTokens: moved.movedTokens,
				warning: this.warning,
			}
		}

		this.condensingAvoided++
		return {
			handled: true,
			movedChunks: moved.movedChunks,
			movedTokens: moved.movedTokens,
			warning: this.warning,
		}
	}

	askForContext(query: string, options: { filePath?: string; limit?: number } = {}): ContextCacheSearchResult[] {
		const results = this.coldCache.search(query, { filePath: options.filePath, limit: options.limit ?? 3 })

		for (const result of results) {
			const chunk = this.coldCache.remove(result.chunk.id)
			if (!chunk) {
				continue
			}

			this.unhideMessageTimestamps(chunk)
			const evicted = this.hotCache.add(chunk, { protectedIds: new Set([chunk.id]) })
			this.moveChunksToCold(evicted)
			this.swapsThisSession++
		}

		return results.map(toSearchResult)
	}

	getStats(): ContextCacheStats {
		const hotStats = this.hotCache.getStats()
		const coldStats = this.coldCache.getStats()

		return {
			hotCacheTokens: hotStats.tokens,
			coldCacheChunks: coldStats.chunks,
			ramUsedMb: coldStats.ramUsedMb,
			swapsThisSession: this.swapsThisSession,
			condensingAvoided: this.condensingAvoided,
		}
	}

	getWarning(): string | undefined {
		return this.warning
	}

	clearWarning(): void {
		this.warning = undefined
	}

	getHiddenMessageTimestamps(): Set<number> {
		return new Set(this.hiddenMessageTimestamps)
	}

	hasChunks(): boolean {
		return this.hotCache.getStats().chunks > 0 || this.coldCache.getStats().chunks > 0
	}

	private canEvictForRequestPressure(chunk: ContextChunk, protectedMessageTimestamps: Set<number>): boolean {
		if (chunk.type !== "conversation_turn") {
			return false
		}

		const messageTimestamps = chunk.metadata?.messageTimestamps ?? []
		return (
			messageTimestamps.length > 0 &&
			messageTimestamps.every((timestamp) => !protectedMessageTimestamps.has(timestamp))
		)
	}

	private moveChunksToCold(chunks: ContextChunk[]): { accepted: boolean; movedChunks: number; movedTokens: number } {
		let accepted = true
		let movedChunks = 0
		let movedTokens = 0

		for (const chunk of chunks) {
			const result = this.coldCache.add(chunk)
			for (const evictedChunk of result.evicted) {
				this.unhideMessageTimestamps(evictedChunk)
			}
			if (!result.accepted) {
				accepted = false
				this.warning = CONTEXT_CACHE_FULL_WARNING
				continue
			}

			movedChunks++
			movedTokens += chunk.tokens
			this.hideMessageTimestamps(chunk)
			this.swapsThisSession++
		}

		return { accepted, movedChunks, movedTokens }
	}

	private hideMessageTimestamps(chunk: ContextChunk): void {
		for (const timestamp of chunk.metadata?.messageTimestamps ?? []) {
			this.hiddenMessageTimestamps.add(timestamp)
		}
	}

	private unhideMessageTimestamps(chunk: ContextChunk): void {
		for (const timestamp of chunk.metadata?.messageTimestamps ?? []) {
			this.hiddenMessageTimestamps.delete(timestamp)
		}
	}
}

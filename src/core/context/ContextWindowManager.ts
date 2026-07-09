import type {
	ContextCacheBudgetOption,
	ContextCacheEvent,
	ContextCacheSearchResult,
	ContextCacheStats,
} from "@roo-code/types"

import { ColdCache } from "./ColdCache"
import { ContextChunk, ContextChunkSearchResult, RegisterContextChunkInput, createContextChunk } from "./ContextChunk"
import { HotCache } from "./HotCache"

export const DEFAULT_COLD_CACHE_RAM_BUDGET_MB = 1024
export const CONTEXT_CACHE_FULL_WARNING = "Cold cache full — falling back to condensing"

const BYTES_PER_MB = 1024 * 1024
const FALLBACK_SYSTEM_RAM_BYTES = 8 * 1024 * BYTES_PER_MB
const MIN_COLD_CACHE_RAM_BUDGET_MB = 1024
const CONTEXT_CACHE_MAX_RAM_RATIO = 0.25
const CONTEXT_CACHE_RAM_HEADROOM_MB = 2 * 1024
const MAX_COLD_CACHE_RAM_BUDGET_MB = 32 * 1024
const CONTEXT_CACHE_EVENT_QUEUE_LIMIT = 20
const DEFAULT_CONTEXT_CACHE_RECALL_HINT_MAX_CHUNKS = 5
const DEFAULT_CONTEXT_CACHE_RECALL_HINT_MAX_CHARACTERS = 900
const CONTEXT_CACHE_RECALL_HINT_HEADER =
	"Cold context cache hint: some earlier task context has been swapped out of the active prompt to stay within the model window."
const CONTEXT_CACHE_RECALL_HINT_FOOTER =
	"Use ask_for_context with a focused query and optional filePath before relying on details that may have been swapped out."

export interface ContextWindowManagerOptions {
	hotTokenBudget: number
	coldCacheRamBudgetMb?: number
	coldCacheBudgetOptions?: readonly ContextCacheBudgetOption[]
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

export interface ContextCacheRecallHintOptions {
	maxChunks?: number
	maxCharacters?: number
}

export interface ContextChunkRegistrationOptions {
	recordEvents?: boolean
	countSwaps?: boolean
}

function getSafeContextCacheBudgetLimitMb(totalMemoryBytes: number): number {
	const totalMb =
		Number.isFinite(totalMemoryBytes) && totalMemoryBytes > 0
			? Math.floor(totalMemoryBytes / BYTES_PER_MB)
			: Math.floor(FALLBACK_SYSTEM_RAM_BYTES / BYTES_PER_MB)
	const ratioLimit = Math.floor(totalMb * CONTEXT_CACHE_MAX_RAM_RATIO)
	const headroomLimit = totalMb - CONTEXT_CACHE_RAM_HEADROOM_MB

	return Math.max(MIN_COLD_CACHE_RAM_BUDGET_MB, Math.min(ratioLimit, headroomLimit, MAX_COLD_CACHE_RAM_BUDGET_MB))
}

export function getContextCacheBudgetOptions(
	totalMemoryBytes: number = FALLBACK_SYSTEM_RAM_BYTES,
): ContextCacheBudgetOption[] {
	const safeLimitMb = getSafeContextCacheBudgetLimitMb(totalMemoryBytes)
	const values: number[] = []

	for (let value = 1024; value <= Math.min(safeLimitMb, 6144); value += 1024) {
		values.push(value)
	}

	for (let value = 8192; value <= safeLimitMb; value += 2048) {
		values.push(value)
	}

	return values
		.filter((value) => value <= safeLimitMb)
		.map((valueMb) => ({
			valueMb,
			recommended: valueMb === DEFAULT_COLD_CACHE_RAM_BUDGET_MB,
		}))
}

function getColdCacheBudgetOptionValues(options?: readonly ContextCacheBudgetOption[]): number[] {
	const optionValues = (options?.length ? options : getContextCacheBudgetOptions())
		.map((option) => option.valueMb)
		.filter((value) => Number.isFinite(value) && value > 0)
		.map((value) => Math.floor(value))
		.sort((left, right) => left - right)

	return [...new Set(optionValues)].length > 0 ? [...new Set(optionValues)] : [DEFAULT_COLD_CACHE_RAM_BUDGET_MB]
}

export function normalizeColdCacheRamBudgetMb(
	value: unknown,
	budgetOptions?: readonly ContextCacheBudgetOption[],
): number {
	const optionValues = getColdCacheBudgetOptionValues(budgetOptions)
	const defaultValue = optionValues.includes(DEFAULT_COLD_CACHE_RAM_BUDGET_MB)
		? DEFAULT_COLD_CACHE_RAM_BUDGET_MB
		: (optionValues[0] ?? DEFAULT_COLD_CACHE_RAM_BUDGET_MB)
	const numeric = typeof value === "number" ? value : Number(value)
	if (!Number.isFinite(numeric)) {
		return defaultValue
	}

	for (const optionValue of optionValues) {
		if (numeric <= optionValue) {
			return optionValue
		}
	}

	return optionValues.at(-1) ?? defaultValue
}

export function coldCacheRamBudgetMbToBytes(
	value: unknown = DEFAULT_COLD_CACHE_RAM_BUDGET_MB,
	budgetOptions?: readonly ContextCacheBudgetOption[],
): number {
	return normalizeColdCacheRamBudgetMb(value, budgetOptions) * BYTES_PER_MB
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
	private coldCacheBudgetOptions: readonly ContextCacheBudgetOption[]
	private coldCacheRamBudgetMb: number
	private readonly hiddenMessageTimestamps = new Set<number>()
	private readonly contextCacheEvents: ContextCacheEvent[] = []
	private warning: string | undefined
	private swapsThisSession = 0
	private condensingAvoided = 0
	private contextCacheEventSequence = 0

	constructor(options: ContextWindowManagerOptions) {
		this.coldCacheBudgetOptions = options.coldCacheBudgetOptions ?? getContextCacheBudgetOptions()
		this.coldCacheRamBudgetMb = normalizeColdCacheRamBudgetMb(
			options.coldCacheRamBudgetMb,
			this.coldCacheBudgetOptions,
		)
		this.hotCache = new HotCache(Math.max(1, Math.floor(options.hotTokenBudget)))
		this.coldCache = new ColdCache(
			coldCacheRamBudgetMbToBytes(this.coldCacheRamBudgetMb, this.coldCacheBudgetOptions),
		)
	}

	updateOptions(options: Partial<ContextWindowManagerOptions>): void {
		if (options.hotTokenBudget !== undefined) {
			const evicted = this.hotCache.updateBudget(options.hotTokenBudget)
			this.moveChunksToCold(evicted)
		}

		if (options.coldCacheBudgetOptions !== undefined) {
			this.coldCacheBudgetOptions = options.coldCacheBudgetOptions
		}

		if (options.coldCacheRamBudgetMb !== undefined || options.coldCacheBudgetOptions !== undefined) {
			this.coldCacheRamBudgetMb = normalizeColdCacheRamBudgetMb(
				options.coldCacheRamBudgetMb ?? this.coldCacheRamBudgetMb,
				this.coldCacheBudgetOptions,
			)
			const result = this.coldCache.updateBudget(
				coldCacheRamBudgetMbToBytes(this.coldCacheRamBudgetMb, this.coldCacheBudgetOptions),
			)
			for (const evictedChunk of result.evicted) {
				this.unhideMessageTimestamps(evictedChunk)
			}
			if (!result.accepted) {
				this.warning = CONTEXT_CACHE_FULL_WARNING
			}
		}
	}

	registerChunk(
		input: RegisterContextChunkInput,
		options: ContextChunkRegistrationOptions = {},
	): ContextChunk | undefined {
		const chunk = createContextChunk(input)
		if (!chunk) {
			return undefined
		}

		const evicted = this.hotCache.add(chunk)
		this.moveChunksToCold(evicted, options)
		return chunk
	}

	clearCachedChunks(): void {
		this.hotCache.clear()
		this.coldCache.clear()
		this.hiddenMessageTimestamps.clear()
		this.warning = undefined
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
		this.recordContextCacheEvent({
			type: "condensing_avoided",
			chunkCount: moved.movedChunks,
			tokenCount: moved.movedTokens,
		})
		return {
			handled: true,
			movedChunks: moved.movedChunks,
			movedTokens: moved.movedTokens,
			warning: this.warning,
		}
	}

	askForContext(query: string, options: { filePath?: string; limit?: number } = {}): ContextCacheSearchResult[] {
		const results = this.coldCache.search(query, { filePath: options.filePath, limit: options.limit ?? 3 })
		let pulledChunks = 0
		let pulledTokens = 0

		for (const result of results) {
			const chunk = this.coldCache.remove(result.chunk.id)
			if (!chunk) {
				continue
			}

			this.unhideMessageTimestamps(chunk)
			const evicted = this.hotCache.add(chunk, { protectedIds: new Set([chunk.id]) })
			this.moveChunksToCold(evicted)
			this.swapsThisSession++
			pulledChunks++
			pulledTokens += chunk.tokens
		}

		if (pulledChunks > 0) {
			this.recordContextCacheEvent({
				type: "chunks_pulled_from_cold",
				chunkCount: pulledChunks,
				tokenCount: pulledTokens,
				query,
				filePath: options.filePath,
			})
		}

		return results.map(toSearchResult)
	}

	getRecallHint(options: ContextCacheRecallHintOptions = {}): string | undefined {
		const maxCharacters = Math.max(
			0,
			Math.floor(options.maxCharacters ?? DEFAULT_CONTEXT_CACHE_RECALL_HINT_MAX_CHARACTERS),
		)
		if (maxCharacters === 0) {
			return undefined
		}

		const maxChunks = Math.max(1, Math.floor(options.maxChunks ?? DEFAULT_CONTEXT_CACHE_RECALL_HINT_MAX_CHUNKS))
		const coldChunks = this.coldCache.values().sort((left, right) => {
			if (left.priority !== right.priority) {
				return right.priority - left.priority
			}
			return right.lastAccessedAt - left.lastAccessedAt
		})

		if (coldChunks.length === 0) {
			return undefined
		}

		const lines: string[] = []
		for (const chunk of coldChunks.slice(0, maxChunks)) {
			const line = this.formatRecallHintChunk(chunk)
			const candidate = [CONTEXT_CACHE_RECALL_HINT_HEADER, ...lines, line, CONTEXT_CACHE_RECALL_HINT_FOOTER].join(
				"\n",
			)
			if (candidate.length > maxCharacters) {
				break
			}
			lines.push(line)
		}

		if (lines.length === 0) {
			const fallback = [CONTEXT_CACHE_RECALL_HINT_HEADER, CONTEXT_CACHE_RECALL_HINT_FOOTER].join("\n")
			return fallback.length <= maxCharacters ? fallback : undefined
		}

		return [CONTEXT_CACHE_RECALL_HINT_HEADER, ...lines, CONTEXT_CACHE_RECALL_HINT_FOOTER].join("\n")
	}

	getStats(): ContextCacheStats {
		const hotStats = this.hotCache.getStats()
		const coldStats = this.coldCache.getStats()

		return {
			hotCacheTokens: hotStats.tokens,
			hotCacheChunks: hotStats.chunks,
			coldCacheChunks: coldStats.chunks,
			ramUsedMb: coldStats.ramUsedMb,
			ramBudgetMb: this.coldCacheRamBudgetMb,
			swapsThisSession: this.swapsThisSession,
			condensingAvoided: this.condensingAvoided,
		}
	}

	drainEvents(): ContextCacheEvent[] {
		const events = [...this.contextCacheEvents]
		this.contextCacheEvents.length = 0
		return events
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

	private formatRecallHintChunk(chunk: ContextChunk): string {
		const metadata = chunk.metadata
		const labels: string[] = [chunk.type]
		if (metadata?.filePath) {
			labels.push(`file=${metadata.filePath}`)
		}
		if (metadata?.title) {
			labels.push(`title=${metadata.title}`)
		}
		if (metadata?.toolName) {
			labels.push(`tool=${metadata.toolName}`)
		}

		const normalizedContent = chunk.content.replace(/\s+/g, " ").trim()
		const excerpt =
			normalizedContent.length > 160 ? `${normalizedContent.slice(0, 157).trimEnd()}...` : normalizedContent

		return `- ${labels.join(" ")} (${chunk.tokens} tokens): ${excerpt}`
	}

	private moveChunksToCold(
		chunks: ContextChunk[],
		options: ContextChunkRegistrationOptions = {},
	): { accepted: boolean; movedChunks: number; movedTokens: number } {
		const recordEvents = options.recordEvents ?? true
		const countSwaps = options.countSwaps ?? true
		let accepted = true
		let movedChunks = 0
		let movedTokens = 0
		let rejectedChunks = 0
		let rejectedTokens = 0

		for (const chunk of chunks) {
			const result = this.coldCache.add(chunk)
			for (const evictedChunk of result.evicted) {
				this.unhideMessageTimestamps(evictedChunk)
			}
			if (!result.accepted) {
				accepted = false
				this.warning = CONTEXT_CACHE_FULL_WARNING
				rejectedChunks++
				rejectedTokens += chunk.tokens
				continue
			}

			movedChunks++
			movedTokens += chunk.tokens
			this.hideMessageTimestamps(chunk)
			if (countSwaps) {
				this.swapsThisSession++
			}
		}

		if (recordEvents && movedChunks > 0) {
			this.recordContextCacheEvent({
				type: "chunks_moved_to_cold",
				chunkCount: movedChunks,
				tokenCount: movedTokens,
			})
		}

		if (recordEvents && rejectedChunks > 0) {
			this.recordContextCacheEvent({
				type: "cold_cache_full",
				chunkCount: rejectedChunks,
				tokenCount: rejectedTokens,
				warning: CONTEXT_CACHE_FULL_WARNING,
			})
		}

		return { accepted, movedChunks, movedTokens }
	}

	private recordContextCacheEvent(event: Omit<ContextCacheEvent, "id" | "createdAt">): void {
		const createdAt = Date.now()
		const coldStats = this.coldCache.getStats()
		this.contextCacheEvents.push({
			id: `${createdAt}-${this.contextCacheEventSequence++}`,
			createdAt,
			ramUsedMb: coldStats.ramUsedMb,
			ramBudgetMb: this.coldCacheRamBudgetMb,
			...event,
		})

		if (this.contextCacheEvents.length > CONTEXT_CACHE_EVENT_QUEUE_LIMIT) {
			this.contextCacheEvents.splice(0, this.contextCacheEvents.length - CONTEXT_CACHE_EVENT_QUEUE_LIMIT)
		}
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

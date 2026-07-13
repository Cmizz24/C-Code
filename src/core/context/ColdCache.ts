import {
	ContextChunk,
	ContextChunkSearchResult,
	getContextChunkDedupeKey,
	mergeContextChunks,
	touchContextChunk,
} from "./ContextChunk"

export interface ColdCacheAddResult {
	accepted: boolean
	evicted: ContextChunk[]
	chunk?: ContextChunk
	merged?: boolean
}

export interface ColdCacheStats {
	chunks: number
	bytes: number
	ramUsedMb: number
}

function tokenize(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9_./-]+/i)
		.map((term) => term.trim())
		.filter((term) => term.length >= 2)
}

function uniqueTerms(value: string): string[] {
	return [...new Set(tokenize(value))]
}

export class ColdCache {
	private readonly chunks = new Map<string, ContextChunk>()
	private readonly chunkIdsByDedupeKey = new Map<string, string>()
	private byteCount = 0

	constructor(private budgetBytes: number) {}

	updateBudget(budgetBytes: number): ColdCacheAddResult {
		this.budgetBytes = Math.max(0, Math.floor(budgetBytes))
		return this.enforceBudget()
	}

	add(chunk: ContextChunk): ColdCacheAddResult {
		const dedupeKey = getContextChunkDedupeKey(chunk)
		const existing = this.chunks.get(chunk.id)
		const existingDuplicateId = this.chunkIdsByDedupeKey.get(dedupeKey)
		const existingDuplicate = existingDuplicateId ? this.chunks.get(existingDuplicateId) : undefined

		if (existingDuplicate) {
			if (existing && existing.id !== existingDuplicate.id) {
				this.remove(existing.id)
			}

			this.byteCount -= existingDuplicate.bytes
			const merged = mergeContextChunks(existingDuplicate, chunk)
			this.chunks.set(merged.id, merged)
			this.chunkIdsByDedupeKey.set(dedupeKey, merged.id)
			this.byteCount += merged.bytes

			const result = this.enforceBudget(new Set([merged.id]))
			return { ...result, chunk: this.chunks.get(merged.id) ?? merged, merged: true }
		}

		if (chunk.bytes > this.budgetBytes) {
			return { accepted: false, evicted: [] }
		}

		if (existing) {
			this.remove(existing.id)
		}

		const touched = touchContextChunk(chunk)
		this.chunks.set(touched.id, touched)
		this.chunkIdsByDedupeKey.set(getContextChunkDedupeKey(touched), touched.id)
		this.byteCount += touched.bytes

		const result = this.enforceBudget(new Set([touched.id]))
		return { ...result, chunk: this.chunks.get(touched.id) ?? touched, merged: false }
	}

	remove(id: string): ContextChunk | undefined {
		const existing = this.chunks.get(id)
		if (!existing) {
			return undefined
		}

		this.chunks.delete(id)
		this.chunkIdsByDedupeKey.delete(getContextChunkDedupeKey(existing))
		this.byteCount -= existing.bytes
		return existing
	}

	clear(): void {
		this.chunks.clear()
		this.chunkIdsByDedupeKey.clear()
		this.byteCount = 0
	}

	get(id: string): ContextChunk | undefined {
		const chunk = this.chunks.get(id)
		if (!chunk) {
			return undefined
		}

		const touched = touchContextChunk(chunk)
		this.chunks.set(id, touched)
		return touched
	}

	values(): ContextChunk[] {
		return [...this.chunks.values()]
	}

	search(query: string, options: { filePath?: string; limit?: number } = {}): ContextChunkSearchResult[] {
		const terms = uniqueTerms(query)
		const normalizedFilePath = options.filePath?.toLowerCase()
		const limit = Math.max(1, options.limit ?? 3)

		return this.values()
			.map((chunk) => this.scoreChunk(chunk, terms, normalizedFilePath))
			.filter((result) => result.breakdown.queryMatches > 0 || result.breakdown.filePathMatch)
			.sort((left, right) => right.score - left.score || right.chunk.lastAccessedAt - left.chunk.lastAccessedAt)
			.slice(0, limit)
	}

	getStats(): ColdCacheStats {
		return {
			chunks: this.chunks.size,
			bytes: this.byteCount,
			ramUsedMb: Number((this.byteCount / 1024 / 1024).toFixed(2)),
		}
	}

	private enforceBudget(protectedIds: Set<string> = new Set()): ColdCacheAddResult {
		const evicted: ContextChunk[] = []

		while (this.byteCount > this.budgetBytes && this.chunks.size > protectedIds.size) {
			const candidate = this.getEvictionCandidate(protectedIds)
			if (!candidate) {
				break
			}

			const removed = this.remove(candidate.id)
			if (!removed) {
				break
			}

			evicted.push(removed)
		}

		return { accepted: this.byteCount <= this.budgetBytes, evicted }
	}

	private getEvictionCandidate(protectedIds: Set<string>): ContextChunk | undefined {
		return this.values()
			.filter((chunk) => !protectedIds.has(chunk.id))
			.sort((left, right) => {
				if (left.priority !== right.priority) {
					return left.priority - right.priority
				}
				if (left.lastAccessedAt !== right.lastAccessedAt) {
					return left.lastAccessedAt - right.lastAccessedAt
				}
				return left.createdAt - right.createdAt
			})[0]
	}

	private scoreChunk(
		chunk: ContextChunk,
		terms: string[],
		normalizedFilePath: string | undefined,
	): ContextChunkSearchResult {
		const haystack = [
			chunk.content,
			chunk.type,
			chunk.metadata?.filePath,
			chunk.metadata?.title,
			chunk.metadata?.toolName,
		]
			.filter(Boolean)
			.join("\n")
			.toLowerCase()

		const queryMatches = terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0)
		const filePath = chunk.metadata?.filePath?.toLowerCase()
		const filePathMatch = Boolean(
			normalizedFilePath &&
				filePath &&
				(filePath === normalizedFilePath || filePath.includes(normalizedFilePath)),
		)
		const typeBoost = chunk.type === "file_content" || chunk.type === "diff" ? 0.15 : 0
		const recencyBoost = Math.max(0, 0.1 - (Date.now() - chunk.lastAccessedAt) / (1000 * 60 * 60 * 24 * 100))
		const score = queryMatches + (filePathMatch ? 3 : 0) + typeBoost + recencyBoost

		return {
			chunk,
			score,
			breakdown: {
				queryMatches,
				filePathMatch,
				typeBoost,
				recencyBoost,
			},
		}
	}
}

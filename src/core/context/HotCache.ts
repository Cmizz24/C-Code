import { ContextChunk, touchContextChunk } from "./ContextChunk"

export interface HotCacheStats {
	tokens: number
	chunks: number
}

export class HotCache {
	private readonly chunks = new Map<string, ContextChunk>()
	private tokenCount = 0

	constructor(private maxTokens: number) {}

	updateBudget(maxTokens: number): ContextChunk[] {
		this.maxTokens = Math.max(1, Math.floor(maxTokens))
		return this.trimToBudget()
	}

	add(chunk: ContextChunk, options: { protectedIds?: Set<string> } = {}): ContextChunk[] {
		const existing = this.chunks.get(chunk.id)
		if (existing) {
			this.tokenCount -= existing.tokens
		}

		const touched = touchContextChunk(chunk)
		this.chunks.set(touched.id, touched)
		this.tokenCount += touched.tokens

		return this.trimToBudget(options.protectedIds ?? new Set([touched.id]))
	}

	remove(id: string): ContextChunk | undefined {
		const existing = this.chunks.get(id)
		if (!existing) {
			return undefined
		}

		this.chunks.delete(id)
		this.tokenCount -= existing.tokens
		return existing
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

	has(id: string): boolean {
		return this.chunks.has(id)
	}

	values(): ContextChunk[] {
		return [...this.chunks.values()]
	}

	replaceAll(chunks: ContextChunk[]): ContextChunk[] {
		this.chunks.clear()
		this.tokenCount = 0

		for (const chunk of chunks) {
			this.chunks.set(chunk.id, chunk)
			this.tokenCount += chunk.tokens
		}

		return this.trimToBudget()
	}

	getTokenCount(): number {
		return this.tokenCount
	}

	getStats(): HotCacheStats {
		return {
			tokens: this.tokenCount,
			chunks: this.chunks.size,
		}
	}

	evictForPressure(
		targetReductionTokens: number,
		options: { canEvict?: (chunk: ContextChunk) => boolean } = {},
	): ContextChunk[] {
		const evicted: ContextChunk[] = []
		let reduced = 0

		while (this.chunks.size > 0 && reduced < targetReductionTokens) {
			const candidate = this.getEvictionCandidate(new Set(), options.canEvict)
			if (!candidate) {
				break
			}

			const removed = this.remove(candidate.id)
			if (!removed) {
				break
			}

			evicted.push(removed)
			reduced += removed.tokens
		}

		return evicted
	}

	private trimToBudget(protectedIds: Set<string> = new Set()): ContextChunk[] {
		const evicted: ContextChunk[] = []

		while (this.tokenCount > this.maxTokens && this.chunks.size > protectedIds.size) {
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

		return evicted
	}

	private getEvictionCandidate(
		protectedIds: Set<string> = new Set(),
		canEvict?: (chunk: ContextChunk) => boolean,
	): ContextChunk | undefined {
		return this.values()
			.filter((chunk) => !protectedIds.has(chunk.id))
			.filter((chunk) => canEvict?.(chunk) ?? true)
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
}

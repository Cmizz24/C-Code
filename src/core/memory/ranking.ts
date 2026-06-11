import type { MemoryEntry, MemoryRankBreakdown, MemoryRetrievalResult } from "@roo-code/types"

import { normalizeMemoryPath } from "./workspace"

export interface RankMemoriesOptions {
	query: string
	pathHints?: string[]
	mode?: string
	workspaceHash?: string
	mistakeSignature?: string
	now?: number
}

const TOKEN_PATTERN = /[\p{L}\p{N}_-]{3,}/gu

function tokenize(value: string | undefined): Set<string> {
	const tokens = new Set<string>()
	if (!value) {
		return tokens
	}

	for (const match of value.toLowerCase().matchAll(TOKEN_PATTERN)) {
		tokens.add(match[0])
	}

	return tokens
}

function lexicalSimilarity(query: string, memory: MemoryEntry): number {
	const queryTokens = tokenize(query)
	if (queryTokens.size === 0) {
		return 0
	}

	const memoryTokens = tokenize(
		[memory.title, memory.lesson, memory.tags.join(" "), memory.pathTags.join(" "), memory.toolName]
			.filter(Boolean)
			.join(" "),
	)

	let matches = 0
	for (const token of queryTokens) {
		if (memoryTokens.has(token)) {
			matches += 1
		}
	}

	return matches / queryTokens.size
}

function computePathOverlap(memory: MemoryEntry, pathHints: readonly string[] | undefined): number {
	if (!pathHints?.length || memory.pathTags.length === 0) {
		return 0
	}

	const hints = pathHints.map(normalizeMemoryPath)
	let best = 0

	for (const memoryPath of memory.pathTags.map(normalizeMemoryPath)) {
		for (const hint of hints) {
			if (memoryPath === hint) {
				best = Math.max(best, 1)
			} else if (memoryPath.startsWith(`${hint}/`) || hint.startsWith(`${memoryPath}/`)) {
				best = Math.max(best, 0.75)
			} else if (memoryPath.includes(hint) || hint.includes(memoryPath)) {
				best = Math.max(best, 0.45)
			}
		}
	}

	return best
}

function computeRecency(memory: MemoryEntry, now: number): number {
	const timestamp = memory.lastUsedAt ?? memory.updatedAt ?? memory.createdAt
	const ageDays = Math.max(0, (now - timestamp) / 86_400_000)
	return Math.max(0, 1 - ageDays / 30)
}

export function scoreMemory(memory: MemoryEntry, options: RankMemoriesOptions): MemoryRetrievalResult {
	const now = options.now ?? Date.now()
	const breakdown: MemoryRankBreakdown = {
		lexicalSimilarity: lexicalSimilarity(options.query, memory) * 35,
		pathOverlap: computePathOverlap(memory, options.pathHints) * 20,
		modeMatch: options.mode && memory.mode === options.mode ? 10 : 0,
		scopePreference: memory.scope === "workspace" && memory.workspaceHash === options.workspaceHash ? 8 : 0,
		recency: computeRecency(memory, now) * 10,
		reuse: Math.min(6, memory.reuseCount + memory.successCount * 1.5),
		confidence: memory.confidence * 8,
		mistakeSignature:
			options.mistakeSignature && memory.mistakeSignature === options.mistakeSignature
				? 20
				: options.mistakeSignature && memory.mistakeSignature?.includes(options.mistakeSignature)
					? 8
					: 0,
	}

	const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0)
	return { memory, score, breakdown }
}

export function rankMemories(memories: readonly MemoryEntry[], options: RankMemoriesOptions): MemoryRetrievalResult[] {
	return memories
		.map((memory) => scoreMemory(memory, options))
		.sort((left, right) => {
			const scoreDelta = right.score - left.score
			if (scoreDelta !== 0) {
				return scoreDelta
			}

			if (left.memory.scope !== right.memory.scope) {
				return left.memory.scope === "workspace" ? -1 : 1
			}

			const updatedDelta = right.memory.updatedAt - left.memory.updatedAt
			if (updatedDelta !== 0) {
				return updatedDelta
			}

			return left.memory.id.localeCompare(right.memory.id)
		})
}

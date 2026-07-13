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

const GENERIC_RELEVANCE_TOKENS = new Set([
	"about",
	"active",
	"advisory",
	"after",
	"again",
	"avoid",
	"before",
	"code",
	"coding",
	"constraints",
	"current",
	"default",
	"error",
	"errors",
	"failure",
	"failures",
	"file",
	"files",
	"fix",
	"from",
	"global",
	"implement",
	"issue",
	"lesson",
	"lessons",
	"like",
	"memory",
	"mode",
	"normal",
	"parameters",
	"prompt",
	"prompts",
	"recent",
	"repeating",
	"repository",
	"request",
	"retrying",
	"state",
	"task",
	"that",
	"this",
	"tool",
	"tools",
	"update",
	"using",
	"verify",
	"when",
	"will",
	"with",
	"workspace",
])

const TECHNICAL_SHORT_TOKENS = new Set(["api", "cli", "css", "diff", "git", "mcp", "npm", "pnpm", "ssh", "tsx"])

function addToken(tokens: Set<string>, token: string): void {
	if (token.length >= 3) {
		tokens.add(token)
	}
}

function tokenize(value: string | undefined): Set<string> {
	const tokens = new Set<string>()
	if (!value) {
		return tokens
	}

	for (const match of value.toLowerCase().matchAll(TOKEN_PATTERN)) {
		const token = match[0]
		addToken(tokens, token)
		for (const part of token.split(/[_-]+/)) {
			addToken(tokens, part)
		}
	}

	return tokens
}

function getMemorySearchText(memory: MemoryEntry): string {
	return [
		memory.title,
		memory.lesson,
		memory.tags.join(" "),
		memory.pathTags.join(" "),
		memory.toolName,
		memory.mistakeCause,
		memory.mistakeCategory,
	]
		.filter(Boolean)
		.join(" ")
}

function isDistinctiveRelevanceToken(token: string): boolean {
	return !GENERIC_RELEVANCE_TOKENS.has(token) && (token.length >= 5 || TECHNICAL_SHORT_TOKENS.has(token))
}

function getLexicalMatches(query: string, memory: MemoryEntry): string[] {
	const queryTokens = tokenize(query)
	if (queryTokens.size === 0) {
		return []
	}

	const memoryTokens = tokenize(getMemorySearchText(memory))
	return [...queryTokens].filter((token) => memoryTokens.has(token))
}

function hasToolNameMatch(memory: MemoryEntry, query: string): boolean {
	if (!memory.toolName) {
		return false
	}

	const queryTokens = tokenize(query)
	const normalizedToolName = memory.toolName.toLowerCase()
	if (queryTokens.has(normalizedToolName)) {
		return true
	}

	const toolNameParts = normalizedToolName.split(/[_\s-]+/).filter((part) => part.length >= 3)
	return toolNameParts.length >= 2 && toolNameParts.every((part) => queryTokens.has(part))
}

function lexicalSimilarity(query: string, memory: MemoryEntry): number {
	const queryTokens = tokenize(query)
	if (queryTokens.size === 0) {
		return 0
	}

	const memoryTokens = tokenize(getMemorySearchText(memory))

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

function computeMistakeSignature(memory: MemoryEntry, mistakeSignature: string | undefined): number {
	if (!mistakeSignature) {
		return 0
	}

	if (memory.mistakeSignature === mistakeSignature) {
		return 20
	}

	return memory.mistakeSignature?.includes(mistakeSignature) ? 8 : 0
}

export function isMemoryRelevantForRetrieval(memory: MemoryEntry, options: RankMemoriesOptions): boolean {
	if (computePathOverlap(memory, options.pathHints) > 0) {
		return true
	}

	if (computeMistakeSignature(memory, options.mistakeSignature) > 0) {
		return true
	}

	if (hasToolNameMatch(memory, options.query)) {
		return true
	}

	const distinctiveMatches = getLexicalMatches(options.query, memory).filter(isDistinctiveRelevanceToken)
	if (distinctiveMatches.some((token) => token.length >= 5 && !TECHNICAL_SHORT_TOKENS.has(token))) {
		return true
	}

	return distinctiveMatches.length >= 2
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
		mistakeSignature: computeMistakeSignature(memory, options.mistakeSignature),
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

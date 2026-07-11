import crypto from "crypto"

export const CONTEXT_CHUNK_TYPES = [
	"system_prompt",
	"tool_definitions",
	"file_content",
	"conversation_turn",
	"task_output",
	"diff",
	"error_log",
] as const

export type ContextChunkType = (typeof CONTEXT_CHUNK_TYPES)[number]

export const DEFAULT_CONTEXT_CHUNK_MAX_TOKENS = 2_000

const ESTIMATED_CHARS_PER_TOKEN = 4
const MIN_CONTEXT_CHUNK_BREAK_RATIO = 0.5

export interface ContextChunkMetadata {
	filePath?: string
	taskId?: string
	role?: string
	source?: string
	title?: string
	toolName?: string
	createdBy?: string
	messageTimestamps?: number[]
	subchunkIndex?: number
	subchunkCount?: number
}

export interface ContextChunk {
	id: string
	type: ContextChunkType
	content: string
	tokens: number
	bytes: number
	priority: number
	createdAt: number
	lastAccessedAt: number
	metadata?: ContextChunkMetadata
}

export interface RegisterContextChunkInput {
	type: ContextChunkType
	content: string
	tokens?: number
	priority?: number
	metadata?: ContextChunkMetadata
}

export interface ContextChunkSearchResult {
	chunk: ContextChunk
	score: number
	breakdown: {
		queryMatches: number
		filePathMatch: boolean
		typeBoost: number
		recencyBoost: number
	}
}

export function estimateContextChunkTokens(content: string): number {
	const normalized = content.trim()
	if (!normalized) {
		return 0
	}

	return Math.max(1, Math.ceil(normalized.length / 4))
}

export function estimateContextChunkBytes(content: string): number {
	return Buffer.byteLength(content, "utf8")
}

export function getDefaultContextChunkPriority(type: ContextChunkType): number {
	switch (type) {
		case "system_prompt":
			return 100
		case "tool_definitions":
			return 90
		case "file_content":
			return 75
		case "diff":
			return 70
		case "error_log":
			return 65
		case "conversation_turn":
			return 55
		case "task_output":
			return 45
	}
}

function splitContextChunkContent(content: string, maxCharacters: number): string[] {
	if (content.length <= maxCharacters) {
		return [content]
	}

	const parts: string[] = []
	let start = 0

	while (start < content.length) {
		let end = Math.min(content.length, start + maxCharacters)

		if (end < content.length) {
			const window = content.slice(start, end)
			const minimumBreakIndex = Math.floor(maxCharacters * MIN_CONTEXT_CHUNK_BREAK_RATIO)
			const breakpoints = [
				window.lastIndexOf("\n\n"),
				window.lastIndexOf("\n"),
				window.lastIndexOf(". "),
				window.lastIndexOf(" "),
			]
			const breakpoint = breakpoints.find((index) => index >= minimumBreakIndex)
			if (breakpoint !== undefined && breakpoint > 0) {
				end = start + breakpoint + 1
			}
		}

		const part = content.slice(start, end).trim()
		if (part) {
			parts.push(part)
		}
		start = Math.max(end, start + 1)
	}

	return parts
}

function createSingleContextChunk(input: RegisterContextChunkInput, content: string, tokens: number): ContextChunk {
	const now = Date.now()
	return {
		id: crypto.randomUUID(),
		type: input.type,
		content,
		tokens,
		bytes: estimateContextChunkBytes(content),
		priority: input.priority ?? getDefaultContextChunkPriority(input.type),
		createdAt: now,
		lastAccessedAt: now,
		metadata: input.metadata,
	}
}

function sanitizeContextChunkTokenCount(tokens: number): number {
	const normalized = Math.floor(tokens)
	if (!Number.isFinite(normalized) || normalized <= 0) {
		return 1
	}

	return Math.min(normalized, DEFAULT_CONTEXT_CHUNK_MAX_TOKENS)
}

function getExplicitContextChunkTokenCount(tokens: number | undefined): number | undefined {
	if (tokens === undefined) {
		return undefined
	}

	const normalized = Math.floor(tokens)
	return Number.isFinite(normalized) && normalized > 0 ? normalized : undefined
}

export function createContextChunks(input: RegisterContextChunkInput): ContextChunk[] {
	const content = input.content.trim()
	if (!content) {
		return []
	}

	const maxCharacters = DEFAULT_CONTEXT_CHUNK_MAX_TOKENS * ESTIMATED_CHARS_PER_TOKEN
	const parts = splitContextChunkContent(content, maxCharacters)
	const estimatedTotalTokens = estimateContextChunkTokens(content)
	const explicitTotalTokens = getExplicitContextChunkTokenCount(input.tokens)
	const boundedTotalTokens = Math.min(
		explicitTotalTokens ?? estimatedTotalTokens,
		parts.length * DEFAULT_CONTEXT_CHUNK_MAX_TOKENS,
	)

	return parts.map((part, index) => {
		const tokens = sanitizeContextChunkTokenCount(
			explicitTotalTokens === undefined
				? estimateContextChunkTokens(part)
				: Math.ceil((boundedTotalTokens * part.length) / content.length),
		)

		return createSingleContextChunk(
			{
				...input,
				content: part,
				metadata:
					parts.length > 1
						? {
								...input.metadata,
								subchunkIndex: index + 1,
								subchunkCount: parts.length,
							}
						: input.metadata,
			},
			part,
			tokens,
		)
	})
}

export function createContextChunk(input: RegisterContextChunkInput): ContextChunk | undefined {
	return createContextChunks(input)[0]
}

export function touchContextChunk(chunk: ContextChunk, now = Date.now()): ContextChunk {
	return { ...chunk, lastAccessedAt: now }
}

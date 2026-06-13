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

export interface ContextChunkMetadata {
	filePath?: string
	taskId?: string
	role?: string
	source?: string
	title?: string
	toolName?: string
	createdBy?: string
	messageTimestamps?: number[]
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

export function createContextChunk(input: RegisterContextChunkInput): ContextChunk | undefined {
	const content = input.content.trim()
	if (!content) {
		return undefined
	}

	const now = Date.now()
	return {
		id: crypto.randomUUID(),
		type: input.type,
		content,
		tokens: input.tokens ?? estimateContextChunkTokens(content),
		bytes: estimateContextChunkBytes(content),
		priority: input.priority ?? getDefaultContextChunkPriority(input.type),
		createdAt: now,
		lastAccessedAt: now,
		metadata: input.metadata,
	}
}

export function touchContextChunk(chunk: ContextChunk, now = Date.now()): ContextChunk {
	return { ...chunk, lastAccessedAt: now }
}

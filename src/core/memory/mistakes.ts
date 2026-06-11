import crypto from "crypto"

import type { MemoryEntry, MemoryScope, MistakeMemoryCandidate, ToolName } from "@roo-code/types"

import { DEFAULT_MEMORY_PENDING_CANDIDATE_LIMIT } from "./constants"

import { sanitizeMemoryTags, sanitizeMemoryText } from "./redaction"
import { MemoryStorage } from "./storage"

export interface CreateMistakeMemoryCandidateOptions {
	storage: MemoryStorage
	lesson: string
	correction?: string
	error?: string
	toolName?: ToolName | string
	filePaths?: string[]
	tags?: string[]
	scope?: MemoryScope
	source?: MemoryEntry["source"]
	approved?: boolean
	pendingCandidateLimit?: number
	workspacePath?: string
	mode?: string
	originTaskId?: string
	confidence?: number
}

export function buildMistakeSignature(input: { toolName?: string; error?: string; lesson?: string }): string {
	const text = sanitizeMemoryText([input.toolName, input.error, input.lesson].filter(Boolean).join("\n"), 1_000)
		.toLowerCase()
		.replace(/\d+/g, "#")
		.replace(/\s+/g, " ")
		.trim()
	return `mistake:${crypto.createHash("sha256").update(text).digest("hex").slice(0, 32)}`
}

export function buildToolErrorLesson(toolName: ToolName | string, error: string): string {
	const sanitizedError = sanitizeMemoryText(error, 500)
	return `Avoid repeating ${toolName} failures like this: ${sanitizedError}. Verify parameters, current repository state, and tool constraints before retrying.`
}

export async function createMistakeMemoryCandidate(
	options: CreateMistakeMemoryCandidateOptions,
): Promise<{ memory: MemoryEntry; candidate?: MistakeMemoryCandidate; reusedExisting: boolean }> {
	const lessonParts = [options.lesson]
	if (options.correction) {
		lessonParts.push(`Correction: ${options.correction}`)
	}

	const lesson = sanitizeMemoryText(lessonParts.join("\n"), 2_000)
	const mistakeSignature = buildMistakeSignature({ toolName: options.toolName, error: options.error, lesson })
	const scope = options.scope ?? "workspace"
	const existing = await options.storage.findByMistakeSignature(mistakeSignature, {
		scope,
		workspacePath: options.workspacePath,
		statuses: ["active", "pending"],
	})

	if (existing) {
		const updated = await options.storage.upsertMemory(
			{
				...existing,
				lesson: existing.lesson.length >= lesson.length ? existing.lesson : lesson,
				updatedAt: Date.now(),
			},
			options.workspacePath,
		)
		return { memory: updated, reusedExisting: true }
	}

	const memory = await options.storage.createMemory({
		scope,
		kind: "mistake",
		status: options.approved ? "active" : "pending",
		source: options.source ?? "mistake_tool",
		lesson,
		title: options.toolName ? `Mistake lesson for ${options.toolName}` : "Mistake lesson",
		tags: sanitizeMemoryTags([...(options.tags ?? []), "mistake"]),
		pathTags: options.filePaths,
		mode: options.mode,
		toolName: options.toolName,
		mistakeSignature,
		confidence: options.confidence ?? 0.75,
		originTaskId: options.originTaskId,
		workspacePath: options.workspacePath,
	})

	if (options.approved) {
		return { memory, reusedExisting: false }
	}

	const now = Date.now()
	const candidate: MistakeMemoryCandidate = {
		id: `cand_${crypto.randomUUID()}`,
		memoryId: memory.id,
		status: "pending",
		createdAt: now,
		updatedAt: now,
	}
	await options.storage.addCandidate(
		candidate,
		scope,
		options.workspacePath,
		options.pendingCandidateLimit ?? DEFAULT_MEMORY_PENDING_CANDIDATE_LIMIT,
	)
	return { memory, candidate, reusedExisting: false }
}

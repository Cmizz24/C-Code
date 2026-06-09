import { z } from "zod"

export const MEMORY_CONTEXT_WINDOW_AUTO_THRESHOLD = 1_000_000
export const DEFAULT_MEMORY_MAX_CHARACTERS = 2_400
export const DEFAULT_MEMORY_MAX_ENTRIES = 8
export const DEFAULT_MEMORY_PENDING_CANDIDATE_LIMIT = 100

export const memoryScopeSchema = z.enum(["workspace", "global"])
export type MemoryScope = z.infer<typeof memoryScopeSchema>

export const memoryStatusSchema = z.enum(["active", "pending", "stale", "superseded", "archived"])
export type MemoryStatus = z.infer<typeof memoryStatusSchema>

export const memoryKindSchema = z.enum(["lesson", "mistake"])
export type MemoryKind = z.infer<typeof memoryKindSchema>

export const memorySourceSchema = z.enum([
	"manual",
	"tool",
	"mistake_tool",
	"tool_error",
	"validation_error",
	"user_correction",
])
export type MemorySource = z.infer<typeof memorySourceSchema>

export const memoryGlobalSettingsSchema = z.object({
	/** Undefined means automatic model-gated behavior based on context window metadata. */
	memoryEnabled: z.boolean().optional(),
	memoryWorkspaceEnabled: z.boolean().optional(),
	memoryGlobalEnabled: z.boolean().optional(),
	memoryMistakeMemoryEnabled: z.boolean().optional(),
	memoryAutoApproveMistakeMemory: z.boolean().optional(),
	memoryMaxCharacters: z.number().int().min(0).max(20_000).optional(),
	memoryMaxEntries: z.number().int().min(0).max(50).optional(),
	memoryPendingCandidateLimit: z.number().int().min(0).max(1_000).optional(),
})
export type MemoryGlobalSettings = z.infer<typeof memoryGlobalSettingsSchema>

export const resolvedMemorySettingsSchema = z.object({
	memoryEnabled: z.boolean().optional(),
	memoryWorkspaceEnabled: z.boolean(),
	memoryGlobalEnabled: z.boolean(),
	memoryMistakeMemoryEnabled: z.boolean(),
	memoryAutoApproveMistakeMemory: z.boolean(),
	memoryMaxCharacters: z.number().int().min(0).max(20_000),
	memoryMaxEntries: z.number().int().min(0).max(50),
	memoryPendingCandidateLimit: z.number().int().min(0).max(1_000),
})
export type ResolvedMemorySettings = z.infer<typeof resolvedMemorySettingsSchema>

const pathTagSchema = z.string().min(1).max(512)
const tagSchema = z.string().min(1).max(64)

export const memoryEntrySchema = z.object({
	id: z.string().min(1),
	scope: memoryScopeSchema,
	workspaceHash: z.string().optional(),
	kind: memoryKindSchema,
	status: memoryStatusSchema,
	source: memorySourceSchema,
	title: z.string().max(160).optional(),
	lesson: z.string().min(1).max(2_000),
	tags: z.array(tagSchema).default([]),
	pathTags: z.array(pathTagSchema).default([]),
	mode: z.string().max(80).optional(),
	toolName: z.string().max(120).optional(),
	mistakeSignature: z.string().max(160).optional(),
	confidence: z.number().min(0).max(1).default(0.7),
	reuseCount: z.number().int().min(0).default(0),
	successCount: z.number().int().min(0).default(0),
	failureCount: z.number().int().min(0).default(0),
	createdAt: z.number().int().min(0),
	updatedAt: z.number().int().min(0),
	lastUsedAt: z.number().int().min(0).optional(),
	supersedes: z.string().optional(),
	supersededBy: z.string().optional(),
	originTaskId: z.string().optional(),
})
export type MemoryEntry = z.infer<typeof memoryEntrySchema>

export const mistakeMemoryCandidateStatusSchema = z.enum(["pending", "approved", "rejected"])
export type MistakeMemoryCandidateStatus = z.infer<typeof mistakeMemoryCandidateStatusSchema>

export const mistakeMemoryCandidateSchema = z.object({
	id: z.string().min(1),
	memoryId: z.string().min(1),
	status: mistakeMemoryCandidateStatusSchema,
	createdAt: z.number().int().min(0),
	updatedAt: z.number().int().min(0),
	approvedAt: z.number().int().min(0).optional(),
	rejectedAt: z.number().int().min(0).optional(),
	reason: z.string().max(500).optional(),
})
export type MistakeMemoryCandidate = z.infer<typeof mistakeMemoryCandidateSchema>

export const memoryStoreSchema = z.object({
	version: z.literal(1).default(1),
	workspaceHash: z.string().optional(),
	memories: z.array(memoryEntrySchema).default([]),
	candidates: z.array(mistakeMemoryCandidateSchema).default([]),
})
export type MemoryStore = z.infer<typeof memoryStoreSchema>

export const memoryRankBreakdownSchema = z.object({
	lexicalSimilarity: z.number(),
	pathOverlap: z.number(),
	modeMatch: z.number(),
	scopePreference: z.number(),
	recency: z.number(),
	reuse: z.number(),
	confidence: z.number(),
	mistakeSignature: z.number(),
})
export type MemoryRankBreakdown = z.infer<typeof memoryRankBreakdownSchema>

export const memoryRetrievalResultSchema = z.object({
	memory: memoryEntrySchema,
	score: z.number(),
	breakdown: memoryRankBreakdownSchema,
})
export type MemoryRetrievalResult = z.infer<typeof memoryRetrievalResultSchema>

export const memorySummarySchema = z.object({
	workspaceHash: z.string().optional(),
	global: z.object({
		active: z.number().int().min(0),
		pending: z.number().int().min(0),
		archived: z.number().int().min(0),
		total: z.number().int().min(0),
	}),
	workspace: z.object({
		active: z.number().int().min(0),
		pending: z.number().int().min(0),
		archived: z.number().int().min(0),
		total: z.number().int().min(0),
	}),
})
export type MemorySummary = z.infer<typeof memorySummarySchema>

export interface MemorySearchToolParams {
	query: string
	scope?: MemoryScope | "all"
	status?: MemoryStatus | "all"
	limit?: number
	includePending?: boolean
}

export interface MistakeMemoryToolParams {
	lesson: string
	correction?: string
	error?: string
	tool_name?: string
	file_paths?: string[]
	tags?: string[]
	scope?: MemoryScope
	approve?: boolean
}

import type { MemoryRetrievalResult, MemoryScope, MemoryStatus } from "@roo-code/types"

import type { RooIgnoreController } from "../ignore/RooIgnoreController"
import { MemoryStorage } from "./storage"
import { rankMemories } from "./ranking"
import { hashWorkspaceIdentifier, uniqueNormalizedPaths } from "./workspace"

export interface RetrieveMemoriesOptions {
	storage: MemoryStorage
	query: string
	workspacePath?: string
	includeWorkspace?: boolean
	includeGlobal?: boolean
	statuses?: MemoryStatus[]
	pathHints?: string[]
	mode?: string
	mistakeSignature?: string
	maxEntries: number
	rooIgnoreController?: RooIgnoreController
}

function filterIgnoredPathTags(
	pathTags: readonly string[],
	rooIgnoreController: RooIgnoreController | undefined,
): string[] {
	const normalized = uniqueNormalizedPaths(pathTags)
	if (!rooIgnoreController || normalized.length === 0) {
		return normalized
	}

	return rooIgnoreController.filterPaths(normalized)
}

export async function retrieveMemories(options: RetrieveMemoriesOptions): Promise<MemoryRetrievalResult[]> {
	if (options.maxEntries <= 0) {
		return []
	}

	const scopes: MemoryScope[] = []
	if (options.includeWorkspace !== false && options.workspacePath) {
		scopes.push("workspace")
	}
	if (options.includeGlobal !== false) {
		scopes.push("global")
	}

	if (scopes.length === 0) {
		return []
	}

	const statuses = options.statuses ?? ["active"]
	const workspaceHash = options.workspacePath ? hashWorkspaceIdentifier(options.workspacePath) : undefined
	const memories = await options.storage.listMemories({ scopes, statuses, workspacePath: options.workspacePath })
	const filtered = memories.flatMap((memory) => {
		const allowedPathTags = filterIgnoredPathTags(memory.pathTags, options.rooIgnoreController)
		if (memory.pathTags.length > 0 && allowedPathTags.length === 0) {
			return []
		}
		return [{ ...memory, pathTags: allowedPathTags }]
	})

	return rankMemories(filtered, {
		query: options.query,
		pathHints: options.pathHints,
		mode: options.mode,
		workspaceHash,
		mistakeSignature: options.mistakeSignature,
	}).slice(0, options.maxEntries)
}

const PATH_HINT_PATTERN =
	/(?:^|[\s"'`(])((?:\.{1,2}[\\/])?[\p{L}\p{N}@._-]+(?:[\\/][\p{L}\p{N}@._-]+)+(?:\.[\p{L}\p{N}_-]+)?)/gu

export function extractPathHintsFromText(text: string, maxHints = 24): string[] {
	const hints: string[] = []

	for (const match of text.matchAll(PATH_HINT_PATTERN)) {
		const hint = match[1]
		if (!hint || /^https?:/i.test(hint)) {
			continue
		}

		hints.push(hint)
	}

	return uniqueNormalizedPaths(hints).slice(0, maxHints)
}

export function extractTextFromRequestMessages(messages: readonly unknown[], maxCharacters = 6_000): string {
	const chunks: string[] = []

	for (const message of messages.slice(-8)) {
		if (!message || typeof message !== "object") {
			continue
		}

		const content = (message as { content?: unknown }).content
		if (typeof content === "string") {
			chunks.push(content)
		} else if (Array.isArray(content)) {
			for (const block of content) {
				if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
					const text = (block as { text?: unknown }).text
					if (typeof text === "string" && !text.trim().startsWith("<environment_details>")) {
						chunks.push(text)
					}
				}
			}
		}
	}

	return chunks.join("\n").slice(-maxCharacters)
}

import type { MemoryGlobalSettings, MemoryRecallChatResult, MemoryRetrievalResult, ModelInfo } from "@roo-code/types"

import { getModelMaxOutputTokens } from "../../shared/api"
import type { ProviderSettings } from "@roo-code/types"
import type { RooIgnoreController } from "../ignore/RooIgnoreController"
import { appendMemoryPromptToLastUserMessage, formatMemoryPrompt, selectMemoryPromptResults } from "./prompt"
import { extractPathHintsFromText, extractTextFromRequestMessages, retrieveMemories } from "./retrieval"
import { resolveMemorySettings, isMemoryEnabledForModel } from "./settings"
import { MemoryStorage } from "./storage"

export interface BuildMemoryPromptForRequestOptions {
	globalStoragePath: string
	workspacePath: string
	modelInfo: ModelInfo
	modelId: string
	apiConfiguration: ProviderSettings
	settings?: MemoryGlobalSettings
	mode?: string
	requestMessages: readonly unknown[]
	pathHints?: string[]
	rooIgnoreController?: RooIgnoreController
	contextTokens?: number
}

export interface BuildMemoryPromptForRequestResult {
	prompt?: string
	recalledMemories: MemoryRecallChatResult[]
	totalRecallCount: number
}

const MAX_CHAT_RECALL_RESULTS = 5

function toMemoryRecallChatResult(result: MemoryRetrievalResult): MemoryRecallChatResult {
	const { memory } = result
	return {
		id: memory.id,
		scope: memory.scope,
		kind: memory.kind,
		status: memory.status,
		title: memory.title,
		tags: memory.tags,
		pathTags: memory.pathTags,
		mode: memory.mode,
		toolName: memory.toolName,
		confidence: memory.confidence,
		score: result.score,
	}
}

export async function buildMemoryPromptForRequest(
	options: BuildMemoryPromptForRequestOptions,
): Promise<string | undefined> {
	return (await buildMemoryPromptForRequestWithMetadata(options)).prompt
}

export async function buildMemoryPromptForRequestWithMetadata(
	options: BuildMemoryPromptForRequestOptions,
): Promise<BuildMemoryPromptForRequestResult> {
	const settings = resolveMemorySettings(options.settings)
	if (!isMemoryEnabledForModel(settings, options.modelInfo)) {
		return { recalledMemories: [], totalRecallCount: 0 }
	}

	const maxOutputTokens =
		getModelMaxOutputTokens({
			modelId: options.modelId,
			model: options.modelInfo,
			settings: options.apiConfiguration,
		}) ?? 0
	let maxCharacters = settings.memoryMaxCharacters

	if (options.contextTokens && options.modelInfo.contextWindow > 0) {
		const availableInputWindow = Math.max(1, options.modelInfo.contextWindow - maxOutputTokens)
		const pressure = options.contextTokens / availableInputWindow
		if (pressure >= 0.92) {
			return { recalledMemories: [], totalRecallCount: 0 }
		}
		if (pressure >= 0.85) {
			maxCharacters = Math.min(maxCharacters, 800)
		}
	}

	const storage = new MemoryStorage({
		globalStoragePath: options.globalStoragePath,
		workspacePath: options.workspacePath,
	})
	const query = extractTextFromRequestMessages(options.requestMessages)
	const results = await retrieveMemories({
		storage,
		query,
		workspacePath: options.workspacePath,
		includeWorkspace: settings.memoryWorkspaceEnabled,
		includeGlobal: settings.memoryGlobalEnabled,
		pathHints: options.pathHints ?? extractPathHintsFromText(query),
		mode: options.mode,
		maxEntries: settings.memoryMaxEntries,
		rooIgnoreController: options.rooIgnoreController,
	})
	const promptResults = selectMemoryPromptResults(results, { maxCharacters })
	const prompt = formatMemoryPrompt(promptResults, { maxCharacters })

	if (prompt) {
		await storage.recordMemoryUse(
			promptResults.map((result) => result.memory.id),
			options.workspacePath,
		)
	}

	return {
		prompt,
		recalledMemories: promptResults.slice(0, MAX_CHAT_RECALL_RESULTS).map(toMemoryRecallChatResult),
		totalRecallCount: promptResults.length,
	}
}

export { appendMemoryPromptToLastUserMessage }

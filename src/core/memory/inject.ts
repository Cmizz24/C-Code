import type { MemoryGlobalSettings, ModelInfo } from "@roo-code/types"

import { getModelMaxOutputTokens } from "../../shared/api"
import type { ProviderSettings } from "@roo-code/types"
import type { RooIgnoreController } from "../ignore/RooIgnoreController"
import { appendMemoryPromptToLastUserMessage, formatMemoryPrompt } from "./prompt"
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

export async function buildMemoryPromptForRequest(
	options: BuildMemoryPromptForRequestOptions,
): Promise<string | undefined> {
	const settings = resolveMemorySettings(options.settings)
	if (!isMemoryEnabledForModel(settings, options.modelInfo)) {
		return undefined
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
			return undefined
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
	const prompt = formatMemoryPrompt(results, { maxCharacters })

	if (prompt) {
		await storage.recordMemoryUse(
			results.map((result) => result.memory.id),
			options.workspacePath,
		)
	}

	return prompt
}

export { appendMemoryPromptToLastUserMessage }

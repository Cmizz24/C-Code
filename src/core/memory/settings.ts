import type { MemoryGlobalSettings, ModelInfo, ResolvedMemorySettings } from "@roo-code/types"

import {
	DEFAULT_MEMORY_MAX_CHARACTERS,
	DEFAULT_MEMORY_MAX_ENTRIES,
	DEFAULT_MEMORY_PENDING_CANDIDATE_LIMIT,
	MEMORY_CONTEXT_WINDOW_AUTO_THRESHOLD,
} from "./constants"

export function resolveMemorySettings(settings?: MemoryGlobalSettings): ResolvedMemorySettings {
	return {
		memoryEnabled: settings?.memoryEnabled,
		memoryWorkspaceEnabled: settings?.memoryWorkspaceEnabled ?? true,
		memoryGlobalEnabled: settings?.memoryGlobalEnabled ?? true,
		memoryMistakeMemoryEnabled: settings?.memoryMistakeMemoryEnabled ?? true,
		memoryAutoApproveMistakeMemory: settings?.memoryAutoApproveMistakeMemory ?? false,
		memoryMaxCharacters: settings?.memoryMaxCharacters ?? DEFAULT_MEMORY_MAX_CHARACTERS,
		memoryMaxEntries: settings?.memoryMaxEntries ?? DEFAULT_MEMORY_MAX_ENTRIES,
		memoryPendingCandidateLimit: settings?.memoryPendingCandidateLimit ?? DEFAULT_MEMORY_PENDING_CANDIDATE_LIMIT,
	}
}

export function isMemoryEnabledForModel(settings: ResolvedMemorySettings, modelInfo: ModelInfo): boolean {
	if (settings.memoryMaxCharacters <= 0 || settings.memoryMaxEntries <= 0) {
		return false
	}

	if (settings.memoryEnabled !== undefined) {
		return settings.memoryEnabled
	}

	return modelInfo.contextWindow < MEMORY_CONTEXT_WINDOW_AUTO_THRESHOLD
}

import { ProviderSettings, ClineMessage } from "@roo-code/types"
import { supportPrompt } from "../../shared/support-prompt"
import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { ProviderSettingsManager } from "../config/ProviderSettingsManager"

const MAX_CONTEXT_FILE_PATHS = 10
const MAX_CONTEXT_PATH_LENGTH = 200

export interface MessageEnhancerOptions {
	text: string
	apiConfiguration: ProviderSettings
	customSupportPrompts?: Record<string, any>
	listApiConfigMeta: Array<{ id: string; name?: string }>
	enhancementApiConfigId?: string
	includeTaskHistoryInEnhance?: boolean
	currentClineMessages?: ClineMessage[]
	currentTaskMode?: string
	currentWorkingDirectory?: string
	filesReadByRoo?: string[]
	providerSettingsManager: ProviderSettingsManager
}

export interface MessageEnhancerResult {
	success: boolean
	enhancedText?: string
	error?: string
}

/**
 * Enhances a message prompt using AI, optionally including task history for context
 */
export class MessageEnhancer {
	/**
	 * Enhances a message prompt using the configured AI provider
	 * @param options Configuration options for message enhancement
	 * @returns Enhanced message result with success status
	 */
	static async enhanceMessage(options: MessageEnhancerOptions): Promise<MessageEnhancerResult> {
		try {
			const {
				text,
				apiConfiguration,
				customSupportPrompts,
				listApiConfigMeta,
				enhancementApiConfigId,
				includeTaskHistoryInEnhance,
				currentClineMessages,
				currentTaskMode,
				currentWorkingDirectory,
				filesReadByRoo,
				providerSettingsManager,
			} = options

			// Determine which API configuration to use
			let configToUse: ProviderSettings = apiConfiguration

			// Try to get enhancement config first, fall back to current config
			if (enhancementApiConfigId && listApiConfigMeta.find(({ id }) => id === enhancementApiConfigId)) {
				const { name: _, ...providerSettings } = await providerSettingsManager.getProfile({
					id: enhancementApiConfigId,
				})

				if (providerSettings.apiProvider) {
					configToUse = providerSettings
				}
			}

			// Prepare the prompt to enhance
			let promptToEnhance = text
			const contextBlocks: string[] = []

			const currentTaskContext = this.extractCurrentTaskContext({
				currentTaskMode,
				currentWorkingDirectory,
				filesReadByRoo,
			})

			if (currentTaskContext) {
				contextBlocks.push(`Use the following current task context as needed:\n${currentTaskContext}`)
			}

			// Include task history if enabled and available
			if (includeTaskHistoryInEnhance && currentClineMessages && currentClineMessages.length > 0) {
				const taskHistory = this.extractTaskHistory(currentClineMessages)
				if (taskHistory) {
					contextBlocks.push(`Use the following previous conversation context as needed:\n${taskHistory}`)
				}
			}

			if (contextBlocks.length > 0) {
				promptToEnhance = `${text}\n\n${contextBlocks.join("\n\n")}`
			}

			// Create the enhancement prompt using the support prompt system
			const enhancementPrompt = supportPrompt.create(
				"ENHANCE",
				{ userInput: promptToEnhance },
				customSupportPrompts,
			)

			// Call the single completion handler to get the enhanced prompt
			const enhancedText = await singleCompletionHandler(configToUse, enhancementPrompt)

			return {
				success: true,
				enhancedText,
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Extracts relevant task history from Cline messages for context
	 * @param messages Array of Cline messages
	 * @returns Formatted task history string
	 */
	private static extractTaskHistory(messages: ClineMessage[]): string {
		try {
			const relevantMessages = messages
				.filter((msg) => {
					// Include user messages (type: "ask" with text) and assistant messages (type: "say" with say: "text")
					if (msg.type === "ask" && msg.text) {
						return true
					}
					if (msg.type === "say" && msg.say === "text" && msg.text) {
						return true
					}
					return false
				})
				.slice(-10) // Limit to last 10 messages to avoid context explosion

			return relevantMessages
				.map((msg) => {
					const role = msg.type === "ask" ? "User" : "Assistant"
					const content = msg.text || ""
					// Truncate long messages
					return `${role}: ${content.slice(0, 500)}${content.length > 500 ? "..." : ""}`
				})
				.join("\n")
		} catch (error) {
			// Log error but don't fail the enhancement
			console.error("Failed to extract task history:", error)
			return ""
		}
	}

	/**
	 * Extracts concise, safe current task context for prompt enhancement.
	 * This intentionally includes metadata only (mode, workspace, and already-tracked file paths), not file contents.
	 */
	private static extractCurrentTaskContext({
		currentTaskMode,
		currentWorkingDirectory,
		filesReadByRoo,
	}: Pick<MessageEnhancerOptions, "currentTaskMode" | "currentWorkingDirectory" | "filesReadByRoo">): string {
		try {
			const contextLines: string[] = []
			const normalizedMode = this.normalizeContextValue(currentTaskMode, 80)
			const normalizedWorkingDirectory = this.normalizeContextValue(
				currentWorkingDirectory,
				MAX_CONTEXT_PATH_LENGTH,
			)
			const normalizedFiles = this.extractFileContext(filesReadByRoo)

			if (normalizedMode) {
				contextLines.push(`- Current mode: ${normalizedMode}`)
			}

			if (normalizedWorkingDirectory) {
				contextLines.push(`- Workspace: ${normalizedWorkingDirectory}`)
			}

			if (normalizedFiles) {
				contextLines.push(`- Files already referenced in this task:\n${normalizedFiles}`)
			}

			return contextLines.join("\n")
		} catch (error) {
			console.error("Failed to extract current task context:", error)
			return ""
		}
	}

	private static extractFileContext(filesReadByRoo?: string[]): string {
		if (!Array.isArray(filesReadByRoo) || filesReadByRoo.length === 0) {
			return ""
		}

		const normalizedPaths = Array.from(
			new Set(
				filesReadByRoo
					.map((filePath) => this.normalizeContextValue(filePath, MAX_CONTEXT_PATH_LENGTH))
					.filter((filePath): filePath is string => Boolean(filePath)),
			),
		)

		const selectedPaths = normalizedPaths.slice(0, MAX_CONTEXT_FILE_PATHS)
		const remainingCount = normalizedPaths.length - selectedPaths.length
		const fileLines = selectedPaths.map((filePath) => `  - ${filePath}`)

		if (remainingCount > 0) {
			fileLines.push(`  - ...and ${remainingCount} more`)
		}

		return fileLines.join("\n")
	}

	private static normalizeContextValue(value: unknown, maxLength: number): string {
		if (typeof value !== "string") {
			return ""
		}

		const normalized = value.trim().replace(/\s+/g, " ")

		if (!normalized) {
			return ""
		}

		return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
	}
}

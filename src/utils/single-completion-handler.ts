import type { ProviderSettings } from "@roo-code/types"

import { buildApiHandler } from "../api"
import type { SingleCompletionHandler } from "../api"

type BuiltApiHandler = ReturnType<typeof buildApiHandler>

function hasCompletePrompt(handler: BuiltApiHandler): handler is BuiltApiHandler & SingleCompletionHandler {
	const candidate = handler as Partial<SingleCompletionHandler>
	return typeof candidate.completePrompt === "function"
}

async function completePromptViaCreateMessage(handler: BuiltApiHandler, promptText: string): Promise<string> {
	let completion = ""

	for await (const chunk of handler.createMessage("", [{ role: "user" as const, content: promptText }])) {
		if (chunk.type === "text") {
			completion += chunk.text
		} else if (chunk.type === "error") {
			throw new Error(chunk.message || chunk.error || "Prompt enhancement failed")
		}
	}

	return completion
}

/**
 * Enhances a prompt using the configured API without creating a full Cline instance or task history.
 * This is a lightweight alternative that only uses the API's completion functionality.
 */
export async function singleCompletionHandler(apiConfiguration: ProviderSettings, promptText: string): Promise<string> {
	if (!promptText) {
		throw new Error("No prompt text provided")
	}
	if (!apiConfiguration || !apiConfiguration.apiProvider) {
		throw new Error("No valid API configuration provided")
	}

	const handler = buildApiHandler(apiConfiguration)

	if (hasCompletePrompt(handler)) {
		return handler.completePrompt(promptText)
	}

	return completePromptViaCreateMessage(handler, promptText)
}

import type OpenAI from "openai"

const ASK_FOR_CONTEXT_DESCRIPTION = `Search Roo's in-memory cold context cache for information that was previously swapped out of the active context window. This returns up to three matching context chunks verbatim and promotes those chunks back into hot context.

Use this when you need details that may have been evicted from the current prompt, such as earlier file contents, command output, diffs, error logs, or conversation turns. This searches only the current task's RAM cache; it does not read files from disk or search long-term memory.

Parameters:
- query: (required) Natural language query describing the context to retrieve.
- filePath: optional workspace-relative file path to boost matches for a specific file.`

export default {
	type: "function",
	function: {
		name: "ask_for_context",
		description: ASK_FOR_CONTEXT_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Natural language query for cold context chunks to retrieve",
				},
				filePath: {
					type: ["string", "null"],
					description: "Optional workspace-relative file path to boost file-specific cold context matches",
				},
			},
			required: ["query", "filePath"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

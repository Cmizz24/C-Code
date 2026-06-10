import type OpenAI from "openai"

const MEMORY_WIPE_DESCRIPTION = `Clear Roo's stored long-term memory after explicit user selection and final approval. This is destructive and must never be used silently.

Use this only after the user has chosen exactly which memory scope to clear. For all-memory wipes, require an explicit confirmation phrase before calling the tool.

Parameters:
- scope: (required) workspace, global, or all.
- confirmation: required only when scope is all. It must be exactly "WIPE ALL MEMORY". For workspace or global, use null unless the user supplied additional confirmation.

The tool will ask the user for final approval in chat before deleting anything. If the user rejects the approval, no memory is wiped.`

export default {
	type: "function",
	function: {
		name: "memory_wipe",
		description: MEMORY_WIPE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				scope: {
					type: "string",
					enum: ["workspace", "global", "all"],
					description: "Memory scope to wipe",
				},
				confirmation: {
					type: ["string", "null"],
					description: "Required exact phrase WIPE ALL MEMORY when scope is all; otherwise null",
				},
			},
			required: ["scope", "confirmation"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

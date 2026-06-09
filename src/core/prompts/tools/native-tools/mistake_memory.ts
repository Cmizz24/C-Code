import type OpenAI from "openai"

const MISTAKE_MEMORY_DESCRIPTION = `Create a concise mistake-memory lesson so Roo can avoid repeating a correction, tool failure, validation failure, or bad action pattern. Store the lesson, not raw transcripts or file contents.

By default this creates a pending memory candidate. If the user has enabled automatic mistake-memory approval, the lesson can be saved as active immediately after redaction and safety filtering. Set approve to true only when the user has explicitly approved saving this lesson as active memory in the current flow; when automatic approval is off, Roo will still ask for approval before activating it.

Parameters:
- lesson: (required) Concise reusable lesson to remember.
- correction: optional user correction or preferred behavior.
- error: optional error or validation failure text.
- tool_name: optional related tool name.
- file_paths: optional related workspace-relative paths; ignored/protected paths must not be included.
- tags: optional short tags.
- scope: workspace or global. Defaults to workspace.
- approve: optional boolean. False creates a pending candidate unless the user-enabled auto-approve setting is on; true requests user approval to activate when auto-approve is off.`

export default {
	type: "function",
	function: {
		name: "mistake_memory",
		description: MISTAKE_MEMORY_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				lesson: {
					type: "string",
					description: "Concise reusable lesson to remember",
				},
				correction: {
					type: ["string", "null"],
					description: "Optional correction or preferred behavior",
				},
				error: {
					type: ["string", "null"],
					description: "Optional error or validation failure text",
				},
				tool_name: {
					type: ["string", "null"],
					description: "Optional related tool name",
				},
				file_paths: {
					type: ["array", "null"],
					items: { type: "string" },
					description: "Optional workspace-relative file paths related to the lesson",
				},
				tags: {
					type: ["array", "null"],
					items: { type: "string" },
					description: "Optional short tags",
				},
				scope: {
					type: ["string", "null"],
					enum: ["workspace", "global", null],
					description: "Memory scope; defaults to workspace",
				},
				approve: {
					type: ["boolean", "null"],
					description: "Request active memory approval instead of creating a pending candidate",
				},
			},
			required: ["lesson", "correction", "error", "tool_name", "file_paths", "tags", "scope", "approve"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

import type OpenAI from "openai"

const MEMORY_SEARCH_DESCRIPTION = `Search Roo's long-term memory for concise lessons relevant to the current task. This is read-only and returns only stored memory summaries, never raw task transcripts.

Use this when you need to check whether Roo has remembered prior preferences, repository-specific lessons, or past mistakes. Treat results as advisory: current user instructions, repository evidence, and tool results override memory.

Parameters:
- query: (required) Natural language search query.
- scope: workspace, global, or all. Use all to search workspace and global memory.
- status: active, pending, stale, superseded, archived, or all. Use active unless another status is needed.
- limit: optional maximum number of results. Defaults to 8 and is capped by the tool.
- includePending: optional boolean to include pending mistake-memory candidates alongside active memories.`

export default {
	type: "function",
	function: {
		name: "memory_search",
		description: MEMORY_SEARCH_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Natural language memory search query",
				},
				scope: {
					type: "string",
					enum: ["workspace", "global", "all"],
					description: "Memory scope to search; use all to search workspace and global memory",
				},
				status: {
					type: "string",
					enum: ["active", "pending", "stale", "superseded", "archived", "all"],
					description: "Memory status to search; defaults to active",
				},
				limit: {
					type: ["number", "null"],
					description: "Maximum number of memory results to return",
				},
				includePending: {
					type: ["boolean", "null"],
					description: "Whether to include pending mistake-memory candidates with active memories",
				},
			},
			required: ["query", "scope", "status", "limit", "includePending"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

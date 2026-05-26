import type OpenAI from "openai"

const COORDINATE_AGENTS_DESCRIPTION =
	"Background parallel-agent team chat. Use only to publish or read short plain-language coordination messages for sibling agents. Write like a basic read-only team chat: ask direct questions, answer another agent, share selectors/classes/hooks/filenames/variables you are using, and confirm practical decisions. Do not include emojis, raw reasoning, chain-of-thought, private analysis, credentials, profile details, or user secrets. This tool cannot edit files, run commands, spawn tasks, or change modes."

const coordinationKindValues = ["note", "question", "answer", "decision", "blocker"] as const

const coordinateAgentsTool: OpenAI.Chat.ChatCompletionTool = {
	type: "function",
	function: {
		name: "coordinate_agents",
		description: COORDINATE_AGENTS_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["publish", "read"],
					description:
						"Use 'publish' to add one operational message to the shared coordination feed. Use 'read' to retrieve recent relevant messages from other agents.",
				},
				kind: {
					type: "string",
					enum: coordinationKindValues,
					description:
						"Message kind for publish. Use note for short updates, question/answer for direct team chat, decision for settled choices, and blocker for actionable impediments.",
				},
				message: {
					type: "string",
					description:
						"Concise team-chat message to publish. Required for action='publish'. Ask, answer, share selectors/classes/hooks/filenames/variables, or confirm a decision. Do not include emojis, private reasoning, or chain-of-thought.",
				},
				targetAgentId: {
					type: "string",
					description:
						"Optional sibling agent id that should receive the message. Omit to broadcast to all sibling agents.",
				},
				relatedFiles: {
					type: "array",
					items: { type: "string" },
					description:
						"Optional relevant workspace-relative file paths, hooks, selectors, or identifiers. Keep this short and operational.",
				},
				replyToId: {
					type: "string",
					description: "Optional coordination message id being answered or updated.",
				},
				limit: {
					type: "integer",
					description: "Maximum number of recent relevant messages to return. Defaults to 8 and is bounded.",
				},
			},
			required: ["action"],
			additionalProperties: false,
		},
	},
}

export default coordinateAgentsTool

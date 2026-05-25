import type OpenAI from "openai"

const COORDINATE_AGENTS_DESCRIPTION =
	"Background parallel-agent coordination bridge. Use only to publish or read concise operational coordination messages for sibling agents. Do not include raw reasoning, chain-of-thought, private analysis, credentials, profile details, or user secrets. Allowed content: contracts, decisions, questions, answers, blockers, file paths, hooks, selectors, and handoff notes. This tool cannot edit files, run commands, spawn tasks, or change modes."

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
						"Operational message kind for publish. Use note for handoffs/contracts, question/answer for direct coordination, decision for settled choices, and blocker for actionable impediments.",
				},
				message: {
					type: "string",
					description:
						"Concise operational message to publish. Required for action='publish'. Do not include private reasoning or chain-of-thought.",
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

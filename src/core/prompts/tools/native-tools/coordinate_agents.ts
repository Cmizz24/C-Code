import type OpenAI from "openai"

import {
	AGENT_COORDINATION_MESSAGE_MAX_LENGTH,
	AGENT_COORDINATION_PATH_MAX_LENGTH,
	AGENT_COORDINATION_READ_LIMIT,
	AGENT_COORDINATION_READ_LIMIT_MAX,
	AGENT_COORDINATION_RELATED_FILES_LIMIT,
} from "../../../agents/AgentBus"

const COORDINATE_AGENTS_DESCRIPTION =
	'Background parallel-agent team chat. Use only to publish or read short plain-language coordination messages for sibling agents. For reads, use the minimal payload {"action":"read","limit":8}; do not include kind, message, targetAgentId, replyToId, or relatedFiles when reading. For publishing, use {"action":"publish","kind":"note","message":"..."} and include targetAgentId, relatedFiles, or replyToId only when needed. Omit targetAgentId, or use "" or "all", to broadcast. Omit replyToId, or use "" or "none", when not replying. Write like a basic read-only team chat: ask direct questions, answer another agent, share selectors/classes/hooks/filenames/variables you are using, and confirm practical decisions. Do not include emojis, raw reasoning, chain-of-thought, private analysis, credentials, profile details, or user secrets. This tool cannot edit files, run commands, spawn tasks, or change modes.'

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
						"Message kind for publish only. Use note for short updates, question/answer for direct team chat, decision for settled choices, and blocker for actionable impediments. Omit on read.",
				},
				message: {
					type: "string",
					maxLength: AGENT_COORDINATION_MESSAGE_MAX_LENGTH,
					description: `Concise team-chat message to publish. Required for action='publish'. Keep at most ${AGENT_COORDINATION_MESSAGE_MAX_LENGTH} characters. Ask, answer, share selectors/classes/hooks/filenames/variables, or confirm a decision. Do not include emojis, private reasoning, or chain-of-thought. Omit on read.`,
				},
				targetAgentId: {
					type: "string",
					description:
						"Optional sibling agent id that should receive a publish message. Omit to broadcast to all sibling agents; empty string and 'all' are also treated as broadcast/no target. Omit on read.",
				},
				relatedFiles: {
					type: "array",
					maxItems: AGENT_COORDINATION_RELATED_FILES_LIMIT,
					items: { type: "string", maxLength: AGENT_COORDINATION_PATH_MAX_LENGTH },
					description: `Optional relevant workspace-relative file paths, hooks, selectors, or identifiers for publish. Include at most ${AGENT_COORDINATION_RELATED_FILES_LIMIT} entries and keep each at most ${AGENT_COORDINATION_PATH_MAX_LENGTH} characters. Omit on read.`,
				},
				replyToId: {
					type: "string",
					description:
						"Optional coordination message id being answered or updated. Empty string and 'none' are treated as no reply. Omit on read.",
				},
				limit: {
					type: "integer",
					minimum: 1,
					maximum: AGENT_COORDINATION_READ_LIMIT_MAX,
					description: `Maximum number of recent relevant messages to return. Defaults to ${AGENT_COORDINATION_READ_LIMIT} and is bounded to ${AGENT_COORDINATION_READ_LIMIT_MAX}.`,
				},
			},
			required: ["action"],
			additionalProperties: false,
		},
	},
}

export default coordinateAgentsTool

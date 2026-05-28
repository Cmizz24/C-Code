import type OpenAI from "openai"

import {
	AGENT_COORDINATION_MESSAGE_MAX_LENGTH,
	AGENT_COORDINATION_PATH_MAX_LENGTH,
	AGENT_COORDINATION_READ_LIMIT,
	AGENT_COORDINATION_READ_LIMIT_MAX,
	AGENT_COORDINATION_RELATED_FILES_LIMIT,
} from "../../../agents/AgentBus"

const COORDINATE_AGENTS_DESCRIPTION = `Background parallel-agent team chat for real model-published question/answer coordination only. Use action=read when you need recent team chat, need to answer open questions for you, or need to check whether an answer to your own question arrived. For reads, use the minimal payload {"action":"read","limit":8}; do not include kind, message, targetAgentId, replyToId, or relatedFiles when reading. For publishing, use {"action":"publish","kind":"question","message":"...","targetAgentId":"agent-id"} to ask one targeted shared-contract question when a detail is missing, ambiguous, or likely to affect another agent's work, or {"action":"publish","kind":"answer","message":"...","replyToId":"...","targetAgentId":"agent-id"} to answer an open question. Do not publish ownership introductions, status notes, kickoff messages, pre-planned/basic questions, or statements such as "I own <file>", "Agent <id> owns <file>", "I can read <file>", or "I am working on <file>". Publish only a genuine question or answer. Ask the specific relevant agent for one missing UI/CSS/component interface, DOM structure, class name, selector, ID, data attribute, API shape, hook, variable, public function, file path, file contract, user-facing name, or timing detail at a time when that detail is missing, ambiguous, or likely to affect safe integration. Do not guess shared contracts that another agent can answer. Questions should include targetAgentId whenever a specific sibling can answer. Answers must reply to a question: include replyToId from the read result whenever possible; if replyToId is unavailable, include targetAgentId and relatedFiles so the answer can be matched to the question. Answers should include only the key hook, selector, variable, data attribute, file, DOM hook, class, API shape, timing, or decision needed. After reading an answer to your own question, adapt your files, selectors, variables, hooks, DOM structure, API usage, or completion result around that answer before finishing. Avoid manifest-style dumps that list many selectors, classes, variables, hooks, files, or implementation details in one message. If many details are truly needed, split them into multiple short messages. Include targetAgentId when asking a specific sibling. Include replyToId when answering an open question. Omit targetAgentId, or use "" or "all", only when a broadcast question is truly needed. Omit replyToId, or use "" or "none", when not replying to a specific question. If you are complete or otherwise terminal, do not publish new chat except a concise answer to a running agent who asked you a targeted open question. Final evidence belongs in structured completion status, not team chat.`

const coordinationKindValues = ["question", "answer"] as const

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
						"Message kind for publish only. Use question to ask one targeted integration question, or answer to reply to an open question. Ownership/status notes are not allowed. Omit on read.",
				},
				message: {
					type: "string",
					maxLength: AGENT_COORDINATION_MESSAGE_MAX_LENGTH,
					description: `Short team-chat question or answer to publish. Required for action='publish'. Keep at most ${AGENT_COORDINATION_MESSAGE_MAX_LENGTH} characters, and prefer under 140. Ask or answer one practical shared-contract detail: UI/CSS/component interface, DOM structure, class name, selector, ID, data attribute, API shape, hook, variable, public function, file path, file contract, user-facing name, timing, or decision. Do not post ownership introductions like 'I own <file>' or status-only updates. Split long details into multiple short messages. Do not include emojis, private reasoning, or chain-of-thought. Omit on read.`,
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
					description: `Optional relevant workspace-relative file paths, hooks, selectors, or identifiers for publish. Keep this secondary and include only the few items needed for the short message. Include at most ${AGENT_COORDINATION_RELATED_FILES_LIMIT} entries and keep each at most ${AGENT_COORDINATION_PATH_MAX_LENGTH} characters. Omit on read.`,
				},
				replyToId: {
					type: "string",
					description:
						"Coordination question id being answered. Required for kind='answer' whenever available. Empty string and 'none' are treated as no reply for questions only. Omit on read.",
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

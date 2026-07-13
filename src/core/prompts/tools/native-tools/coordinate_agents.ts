import type OpenAI from "openai"

import {
	AGENT_COORDINATION_MESSAGE_MAX_LENGTH,
	AGENT_COORDINATION_PATH_MAX_LENGTH,
	AGENT_COORDINATION_READ_LIMIT,
	AGENT_COORDINATION_READ_LIMIT_MAX,
	AGENT_COORDINATION_RELATED_FILES_LIMIT,
	AGENT_COORDINATION_WAIT_TIMEOUT_MS,
	AGENT_COORDINATION_WAIT_TIMEOUT_MS_MAX,
	AGENT_COORDINATION_WAIT_TIMEOUT_MS_MIN,
} from "../../../agents/AgentBus"

const COORDINATE_AGENTS_DESCRIPTION = `Background parallel-agent team chat for real model-published coordination. Use action=read before editing shared files, before completing, when you need recent team chat, when you need to answer open questions for you, or when you need to check whether an answer to your own question arrived. For reads, use the minimal payload {"action":"read","limit":8}; do not include kind, message, targetAgentId, replyToId, or relatedFiles when reading. Use {"action":"acknowledge_contract","limit":8} after you have read, applied, and are ready to be held to the sharedContract injected into your task; do not include kind, message, targetAgentId, replyToId, or relatedFiles for acknowledgement. For publishing, use {"action":"publish","kind":"question","message":"...","targetAgentId":"agent-id"} to ask one targeted shared-contract question when a detail is missing, ambiguous, or likely to affect another agent's work; {"action":"publish","kind":"answer","message":"...","replyToId":"...","targetAgentId":"agent-id"} to answer an open question; {"action":"publish","kind":"decision","message":"...","relatedFiles":["..."]} to publish a concise integration decision or shared contract that peers need; {"action":"publish","kind":"note","message":"...","relatedFiles":["..."]} to publish a concise assumption or discovered contract that peers must know; or {"action":"publish","kind":"blocker","message":"...","targetAgentId":"agent-id"} to surface a blocking integration issue. Do not publish ownership introductions, generic status notes, kickoff messages, pre-planned/basic questions, or statements such as "I own <file>", "Agent <id> owns <file>", "I can read <file>", or "I am working on <file>". Ask the specific relevant agent for one missing UI/CSS/component interface, DOM structure, class name, selector, ID, data attribute, API shape, hook, variable, public function, file path, file contract, user-facing name, or timing detail at a time when that detail is missing, ambiguous, or likely to affect safe integration. Do not guess shared contracts that another agent can answer. Questions should include targetAgentId whenever a specific sibling can answer. Answers must reply to a question: include replyToId from the read result whenever possible; if replyToId is unavailable, include targetAgentId and relatedFiles so the answer can be matched to the question. Decisions/notes/blockers should be short, concrete, and actionable for integration, not progress updates. After reading an answer to your own question or a peer decision/note/blocker, adapt your files, selectors, variables, hooks, DOM structure, API usage, or completion result accordingly. Terminal agents may only answer targeted open questions; use attempt_completion for final evidence.`

const coordinationKindValues = ["question", "answer", "decision", "note", "blocker"] as const

const coordinateAgentsTool: OpenAI.Chat.ChatCompletionTool = {
	type: "function",
	function: {
		name: "coordinate_agents",
		description: `${COORDINATE_AGENTS_DESCRIPTION} Targeted questions with an exact targetAgentId default to waiting until answered, cancelled, or timed out; waitForAnswer=true requires one concrete exact active targetAgentId and cannot be used for broadcast/no-target questions. Role/display labels such as integration or security are invalid unless they exactly match an agent ID. A timeout leaves the question pending and completion-blocking until answered or explicitly escalated. Do not replace a missing answer with a local assumption.`,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["publish", "read", "acknowledge_contract"],
					description:
						"Use 'publish' to add one operational message to the shared coordination feed. Use 'read' to retrieve recent relevant messages from other agents. Use 'acknowledge_contract' after applying the injected sharedContract so completion can proceed.",
				},
				kind: {
					type: "string",
					enum: coordinationKindValues,
					description:
						"Message kind for publish only. Use question to ask one targeted integration question, answer to reply to an open question, decision to publish a shared contract, note to publish a concrete integration assumption/discovery, or blocker to surface a blocking integration issue. Ownership/status notes are not allowed. Omit on read.",
				},
				message: {
					type: "string",
					maxLength: AGENT_COORDINATION_MESSAGE_MAX_LENGTH,
					description: `Short team-chat message to publish. Required for action='publish'. Keep at most ${AGENT_COORDINATION_MESSAGE_MAX_LENGTH} characters, and prefer under 140. Ask, answer, decide, note, or block on one practical shared-contract detail: UI/CSS/component interface, DOM structure, class name, selector, ID, data attribute, API shape, hook, variable, public function, file path, file contract, user-facing name, timing, or decision. Do not post ownership introductions like 'I own <file>' or status-only updates. Split long details into multiple short messages. Do not include emojis, private reasoning, or chain-of-thought. Omit on read.`,
				},
				targetAgentId: {
					type: "string",
					description:
						"Optional exact active plan agent ID that should receive a publish message. Omit to broadcast to all sibling agents; empty string, 'all', and 'none' are treated as broadcast/no target. Role/display labels such as 'integration' or 'security' are invalid unless they exactly match an agent ID. Omit on read.",
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
				waitForAnswer: {
					type: "boolean",
					description:
						"Publish-question option only. Targeted questions with an exact targetAgentId default to waiting until answered, cancelled, or timed out. waitForAnswer=true requires one concrete exact active targetAgentId; broadcast/no-target questions cannot wait for an answer. A timeout or wait opt-out leaves a targeted question pending and completion-blocking until answered or explicitly escalated. Do not proceed with a local assumption for a missing answer. Omit on read and acknowledgement.",
				},
				timeoutMs: {
					type: "integer",
					minimum: AGENT_COORDINATION_WAIT_TIMEOUT_MS_MIN,
					maximum: AGENT_COORDINATION_WAIT_TIMEOUT_MS_MAX,
					description: `Optional bounded wait timeout for waitForAnswer in milliseconds. Defaults to ${AGENT_COORDINATION_WAIT_TIMEOUT_MS}; min ${AGENT_COORDINATION_WAIT_TIMEOUT_MS_MIN}, max ${AGENT_COORDINATION_WAIT_TIMEOUT_MS_MAX}. Omit on read and acknowledgement.`,
				},
			},
			required: ["action"],
			additionalProperties: false,
		},
	},
}

export default coordinateAgentsTool

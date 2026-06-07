import type OpenAI from "openai"

const SWITCH_MODE_DESCRIPTION = `Request to switch to a different mode. Use this when the user's task should continue in the current conversation but requires a capability or tool group that the current mode does not have, rather than refusing or telling the user to do it manually. Examples: switch to Code for implementation or file edits, Debug for troubleshooting commands, CLI Tools for pure command-line work when available, a visual-inspection mode for visual_browser_inspector, or an image-capable mode for image_generation. The user must approve the mode switch.`

const MODE_SLUG_PARAMETER_DESCRIPTION = `Slug of the mode to switch to (e.g., code, ask, architect)`

const REASON_PARAMETER_DESCRIPTION = `Explanation for why the mode switch is needed`

export default {
	type: "function",
	function: {
		name: "switch_mode",
		description: SWITCH_MODE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				mode_slug: {
					type: "string",
					description: MODE_SLUG_PARAMETER_DESCRIPTION,
				},
				reason: {
					type: "string",
					description: REASON_PARAMETER_DESCRIPTION,
				},
			},
			required: ["mode_slug", "reason"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

import OpenAI from "openai"

const CACHE_CONTROL = { type: "ephemeral" }

export function addCacheBreakpoints(systemPrompt: string, messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
	messages[0] = {
		role: "system",
		// @ts-ignore-next-line
		content: [{ type: "text", text: systemPrompt, cache_control: CACHE_CONTROL }],
	}

	// Ensure all user messages have content in array format first
	for (const msg of messages) {
		if (msg.role === "user" && typeof msg.content === "string") {
			msg.content = [{ type: "text", text: msg.content }]
		}
	}

	// Add `cache_control: ephemeral` to the last two user messages.
	// (Note: this works because we only ever add one user message at a
	// time, but if we added multiple we'd need to mark the user message
	// before the last assistant message.)
	messages
		.filter((msg) => msg.role === "user")
		.slice(-2)
		.forEach((msg) => {
			if (Array.isArray(msg.content)) {
				const lastTextPart = msg.content
					.filter(
						(part: { type: string; text?: unknown }) =>
							part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
					)
					.pop()

				if (!lastTextPart) {
					return
				}

				// @ts-ignore-next-line
				lastTextPart["cache_control"] = CACHE_CONTROL
			}
		})
}

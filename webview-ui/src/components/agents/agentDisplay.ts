import type { ModeConfig } from "@roo-code/types"

import { getModeBySlug } from "@roo/modes"

const leadingEmojiPattern = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\s]+/u

export function getAgentModeLabel(mode: string | undefined, customModes?: ModeConfig[]): string {
	const fallback = mode?.trim() || "Agent"
	const modeName = mode ? getModeBySlug(mode, customModes)?.name : undefined
	const label = (modeName ?? fallback).replace(leadingEmojiPattern, "").trim()

	return label || fallback
}

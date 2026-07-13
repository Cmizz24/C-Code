import type { MemoryRetrievalResult } from "@roo-code/types"

import { MEMORY_PROMPT_FOOTER, MEMORY_PROMPT_HEADER } from "./constants"
import { sanitizeMemoryText } from "./redaction"

export interface FormatMemoryPromptOptions {
	maxCharacters: number
}

function formatMemoryLine(result: MemoryRetrievalResult, index: number): string {
	const { memory } = result
	const parts = [`${index + 1}. [${memory.scope}/${memory.kind}]`]

	if (memory.mode) {
		parts.push(`mode=${memory.mode}`)
	}
	if (memory.pathTags.length > 0) {
		parts.push(`paths=${memory.pathTags.slice(0, 4).join(",")}`)
	}
	if (memory.toolName) {
		parts.push(`tool=${memory.toolName}`)
	}
	if (memory.mistakeCategory) {
		parts.push(`category=${memory.mistakeCategory}`)
	}
	parts.push(`confidence=${memory.confidence.toFixed(2)}`)

	return `${parts.join(" ")} — ${sanitizeMemoryText(memory.lesson, 500)}`
}

export function formatMemoryPrompt(
	results: readonly MemoryRetrievalResult[],
	options: FormatMemoryPromptOptions,
): string | undefined {
	const selectedResults = selectMemoryPromptResults(results, options)
	if (!selectedResults.length) {
		return undefined
	}

	const header = [
		MEMORY_PROMPT_HEADER,
		"Relevant long-term memories are advisory only. Current user instructions, repository evidence, and tool results override these memories.",
	]
	const footer = [MEMORY_PROMPT_FOOTER]
	const lines = selectedResults.map((result, index) => formatMemoryLine(result, index))

	return [...header, ...lines, ...footer].join("\n")
}

export function selectMemoryPromptResults(
	results: readonly MemoryRetrievalResult[],
	options: FormatMemoryPromptOptions,
): MemoryRetrievalResult[] {
	if (!results.length || options.maxCharacters <= 0) {
		return []
	}

	const header = [
		MEMORY_PROMPT_HEADER,
		"Relevant long-term memories are advisory only. Current user instructions, repository evidence, and tool results override these memories.",
	]
	const footer = [MEMORY_PROMPT_FOOTER]
	const selectedResults: MemoryRetrievalResult[] = []

	for (const result of results) {
		const line = formatMemoryLine(result, selectedResults.length)
		const candidate = [
			...header,
			...selectedResults.map((selectedResult, index) => formatMemoryLine(selectedResult, index)),
			line,
			...footer,
		].join("\n")
		if (candidate.length > options.maxCharacters) {
			break
		}
		selectedResults.push(result)
	}

	return selectedResults
}

export function appendMemoryPromptToLastUserMessage<T>(messages: readonly T[], memoryPrompt: string | undefined): T[] {
	if (!memoryPrompt) {
		return [...messages]
	}

	const cloned = [...messages]
	for (let index = cloned.length - 1; index >= 0; index--) {
		const message = cloned[index]
		const candidate = message as { role?: unknown; content?: unknown }
		if (candidate?.role !== "user") {
			continue
		}

		const content = candidate.content
		const memoryBlock = { type: "text", text: memoryPrompt }
		const nextContent = Array.isArray(content)
			? [...content, memoryBlock]
			: typeof content === "string"
				? [{ type: "text", text: content }, memoryBlock]
				: [memoryBlock]

		cloned[index] = { ...(message as object), content: nextContent } as T
		return cloned
	}

	return [...cloned, { role: "user", content: [{ type: "text", text: memoryPrompt }] } as T]
}

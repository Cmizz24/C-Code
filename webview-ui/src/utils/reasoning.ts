const BOLD_CHUNK_EMPTY_COMMENT_SEPARATOR = /(\*\*[^*\n][^\n]*?\*\*)[ \t]*<!--\s*-->[ \t]*(?=\*\*)/g
const EMPTY_HTML_COMMENT_SEPARATOR = /[ \t]*<!--\s*-->[ \t]*/g

export function normalizeReasoningContent(content: string): string {
	if (!content) {
		return ""
	}

	return content
		.replace(BOLD_CHUNK_EMPTY_COMMENT_SEPARATOR, "$1\n\n")
		.replace(EMPTY_HTML_COMMENT_SEPARATOR, " ")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim()
}

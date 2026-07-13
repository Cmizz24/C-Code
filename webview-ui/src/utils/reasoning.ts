const BOLD_CHUNK_EMPTY_COMMENT_SEPARATOR = /(\*\*[^*\n][^\n]*?\*\*)[ \t]*<!--\s*-->[ \t]*(?=\*\*)/g
const EMPTY_HTML_COMMENT_SEPARATOR = /[ \t]*<!--\s*-->[ \t]*/g
const CLOSED_HTML_COMMENT = /[ \t]*<!--([\s\S]*?)-->[ \t]*/g
const OPEN_HTML_COMMENT = /[ \t]*<!--([\s\S]*)$/g
const STRAY_HTML_COMMENT_CLOSE = /[ \t]*-->[ \t]*/g

const SUMMARY_HEADING_PREFIXES = new Set([
	"analysing",
	"analyzing",
	"assessing",
	"building",
	"checking",
	"choosing",
	"comparing",
	"confirming",
	"considering",
	"creating",
	"debugging",
	"designing",
	"drafting",
	"evaluating",
	"examining",
	"exploring",
	"identifying",
	"implementing",
	"inspecting",
	"investigating",
	"mapping",
	"organizing",
	"outlining",
	"planning",
	"preparing",
	"refining",
	"reviewing",
	"scoping",
	"selecting",
	"summarising",
	"summarizing",
	"testing",
	"tracing",
	"updating",
	"validating",
	"verifying",
])

function getPlainCommentText(text: string): string {
	return text
		.replace(/<!--/g, "")
		.replace(/-->/g, "")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/\*\*([^*\n]+)\*\*/g, "$1")
		.replace(/__([^_\n]+)__/g, "$1")
		.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
		.replace(/\s+/g, " ")
		.trim()
}

function isLikelySummaryHeading(text: string): boolean {
	const plainText = getPlainCommentText(text)
	if (!plainText || plainText.length > 120 || /[.!?;:]/.test(plainText)) {
		return false
	}

	if (
		/\b(I|we|because|therefore|selected|decided|found|need|needs|should|must|will|would|could|can|cannot|is|are|was|were|has|have|had)\b/i.test(
			plainText,
		)
	) {
		return false
	}

	const firstWord = plainText.match(/^[A-Za-z]+/)?.[0]?.toLowerCase()
	return !!firstWord && SUMMARY_HEADING_PREFIXES.has(firstWord)
}

function normalizeCommentFragment(_match: string, inner: string): string {
	const text = inner.replace(/<!--|-->/g, "").trim()
	if (!text || isLikelySummaryHeading(text)) {
		return " "
	}

	return ` ${text} `
}

export function normalizeReasoningContent(content: string): string {
	if (!content) {
		return ""
	}

	return content
		.replace(BOLD_CHUNK_EMPTY_COMMENT_SEPARATOR, "$1\n\n")
		.replace(EMPTY_HTML_COMMENT_SEPARATOR, " ")
		.replace(CLOSED_HTML_COMMENT, normalizeCommentFragment)
		.replace(OPEN_HTML_COMMENT, normalizeCommentFragment)
		.replace(STRAY_HTML_COMMENT_CLOSE, " ")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim()
}

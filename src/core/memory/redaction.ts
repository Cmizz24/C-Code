const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
	{
		pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
		replacement: "[REDACTED_PRIVATE_KEY]",
	},
	{ pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED_API_KEY]" },
	{ pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
	{ pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, replacement: "[REDACTED_SLACK_TOKEN]" },
	{ pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED_AWS_ACCESS_KEY]" },
	{ pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: "[REDACTED_JWT]" },
	{
		pattern:
			/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b\s*[:=]\s*['\"]?[^'\"\s,;]+/gi,
		replacement: "$1=[REDACTED_SECRET]",
	},
]

export function redactMemoryText(value: string): string {
	let redacted = value.replace(/\r\n/g, "\n")

	for (const { pattern, replacement } of REDACTION_PATTERNS) {
		redacted = redacted.replace(pattern, replacement)
	}

	return redacted.trim()
}

export function truncateMemoryText(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value
	}

	return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function sanitizeMemoryText(value: string, maxLength: number = 2_000): string {
	return truncateMemoryText(redactMemoryText(value), maxLength)
}

export function sanitizeMemoryTags(values: readonly string[] | undefined, maxTags = 12): string[] {
	if (!values?.length) {
		return []
	}

	const seen = new Set<string>()
	const tags: string[] = []

	for (const value of values) {
		const tag = redactMemoryText(value)
			.toLowerCase()
			.replace(/[^a-z0-9_.:/-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 64)
		if (!tag || seen.has(tag)) {
			continue
		}
		seen.add(tag)
		tags.push(tag)
		if (tags.length >= maxTags) {
			break
		}
	}

	return tags
}

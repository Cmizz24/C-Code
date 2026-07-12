import type { MemoryEntry, MemoryMistakeCategory, MemoryMistakeCause } from "@roo-code/types"

export interface MistakeMemoryClassification {
	mistakeCause: MemoryMistakeCause
	mistakeCategory: MemoryMistakeCategory
}

export interface ClassifyMistakeMemoryOptions {
	source?: MemoryEntry["source"]
	lesson?: string
	error?: string
	toolName?: string
	tags?: readonly string[]
}

export const UNKNOWN_LEGACY_MISTAKE_CLASSIFICATION: MistakeMemoryClassification = {
	mistakeCause: "unknown",
	mistakeCategory: "unknown_legacy",
}

const MODEL_ACTIONABLE_PATTERN =
	/\b(ignored? instructions?|failed to use (?:the )?(?:relevant )?(?:memory|skill)|wrong strategy|bad plan|repeated (?:a )?bad plan|model chose|assistant chose|should have asked|should have used|forgot to|missed (?:the )?user request|despite (?:the )?context)\b/i

const PARALLEL_AGENT_PATTERN =
	/\b(parallel[- ]agents?|parallel execution|worktree cleanup|worktree loss|lost worktree|agent coordination|coordination contract|agent cleanup|parallel task)\b/i

const PROVIDER_INFRASTRUCTURE_PATTERN =
	/\b(provider|context cache|prompt cache|cache key|openai|anthropic|codex|rate limit|usage limit|quota|429|insufficient_quota|too many requests|api request|streaming|context window|token budget)\b/i

const ENVIRONMENT_SETUP_PATTERN =
	/\b(git dubious ownership|dubious ownership|safe\.directory|shell|powershell|cmd\.exe|command not found|environment setup|missing dependency|pnpm install|npm install|node_modules|permission denied|eacces|path not found|working directory|cwd|windows|linux|macos)\b/i

const VALIDATION_INFRASTRUCTURE_PATTERN =
	/\b(validation infrastructure|test infrastructure|test runner|vitest|jest|playwright (?:browser|install|dependency|config)|lint infrastructure|tsconfig|eslint config|stylelint config|coverage)\b/i

const EXTENSION_BUG_PATTERN =
	/\b(extension bug|roo bug|webview|contextproxy|clineprovider|internal error|uncaught|stack trace|cannot read propert(?:y|ies)|undefined is not|null is not|serialization|deserialization)\b/i

const TOOL_CONSTRAINT_PATTERN =
	/\b(tool constraints?|tool parameters?|missing required|invalid parameter|not allowed in .+ mode|can only edit files matching pattern|exact[- ]match|search\/replace|patch context|context not found|apply_diff|read_file|write_to_file|edit_file|execute_command|replace_in_file|list_files|search_files|matching\/edit tools?)\b/i

function buildClassificationText(options: ClassifyMistakeMemoryOptions): string {
	return [options.source, options.toolName, options.error, options.lesson, ...(options.tags ?? [])]
		.filter(Boolean)
		.join("\n")
}

export function classifyMistakeMemory(options: ClassifyMistakeMemoryOptions): MistakeMemoryClassification {
	const text = buildClassificationText(options)

	if (MODEL_ACTIONABLE_PATTERN.test(text)) {
		return { mistakeCause: "model", mistakeCategory: "model_actionable" }
	}

	if (PARALLEL_AGENT_PATTERN.test(text)) {
		return { mistakeCause: "parallel_agents", mistakeCategory: "parallel_agent_cleanup" }
	}

	if (PROVIDER_INFRASTRUCTURE_PATTERN.test(text)) {
		return { mistakeCause: "provider", mistakeCategory: "provider_infrastructure" }
	}

	if (ENVIRONMENT_SETUP_PATTERN.test(text)) {
		return { mistakeCause: "environment", mistakeCategory: "environment_setup" }
	}

	if (VALIDATION_INFRASTRUCTURE_PATTERN.test(text)) {
		return { mistakeCause: "validation", mistakeCategory: "validation_infrastructure" }
	}

	if (EXTENSION_BUG_PATTERN.test(text)) {
		return { mistakeCause: "extension", mistakeCategory: "extension_bug" }
	}

	if (
		TOOL_CONSTRAINT_PATTERN.test(text) ||
		options.source === "tool_error" ||
		options.source === "validation_error"
	) {
		return { mistakeCause: "tool", mistakeCategory: "tool_constraint" }
	}

	if (options.source === "mistake_tool" || options.source === "user_correction") {
		return { mistakeCause: "model", mistakeCategory: "model_actionable" }
	}

	return UNKNOWN_LEGACY_MISTAKE_CLASSIFICATION
}

export function resolveMemoryMistakeClassification(memory: MemoryEntry): MistakeMemoryClassification | undefined {
	if (memory.kind !== "mistake") {
		return undefined
	}

	if (memory.mistakeCause && memory.mistakeCategory) {
		return {
			mistakeCause: memory.mistakeCause,
			mistakeCategory: memory.mistakeCategory,
		}
	}

	return UNKNOWN_LEGACY_MISTAKE_CLASSIFICATION
}

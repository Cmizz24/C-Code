import type { DiffViewProgressEvent } from "../../integrations/editor/DiffViewProvider"
import type { Task } from "../task/Task"

type FileProgressTask = Pick<Task, "reportAgentProgress">
type DiffStats = { added: number; removed: number } | undefined

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return count === 1 ? singular : plural
}

export function formatDiffBlockProgress(diffContent: string): string {
	const searchReplaceBlockCount = (diffContent.match(/^<{7} SEARCH/gm) ?? []).length
	if (searchReplaceBlockCount > 0) {
		return `${searchReplaceBlockCount} diff ${pluralize(searchReplaceBlockCount, "block")}`
	}

	const unifiedHunkCount = (diffContent.match(/^@@(?:\s|$)/gm) ?? []).length
	if (unifiedHunkCount > 0) {
		return `${unifiedHunkCount} diff ${pluralize(unifiedHunkCount, "hunk")}`
	}

	return "a diff"
}

export function formatChangeSummary(diffStats: DiffStats): string {
	if (!diffStats) {
		return ""
	}

	const parts: string[] = []
	if (diffStats.added > 0) {
		parts.push(`+${diffStats.added}`)
	}
	if (diffStats.removed > 0) {
		parts.push(`-${diffStats.removed}`)
	}

	return parts.length > 0 ? ` (${parts.join("/")})` : ""
}

function formatDelay(delayMs: number | undefined): string {
	const safeDelayMs = Math.max(0, delayMs ?? 0)
	if (safeDelayMs < 1000) {
		return `${safeDelayMs}ms`
	}

	const seconds = safeDelayMs / 1000
	return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`
}

export function reportFileProgress(task: FileProgressTask, relPath: string, message: string): void {
	task.reportAgentProgress(message, "file", relPath)
}

export function createDiffViewProgressReporter(
	task: FileProgressTask,
	relPath: string,
	options: { saveMessage: string },
): (event: DiffViewProgressEvent) => void {
	return (event) => {
		switch (event.phase) {
			case "saving":
				reportFileProgress(task, relPath, options.saveMessage)
				break
			case "diagnostics-wait":
				reportFileProgress(
					task,
					relPath,
					`Waiting up to ${formatDelay(event.delayMs)} for diagnostics after saving ${relPath}.`,
				)
				break
			case "diagnostics-check":
				reportFileProgress(task, relPath, `Checking diagnostics for ${relPath}.`)
				break
		}
	}
}

import type { ToolName } from "@roo-code/types"

export const BACKGROUND_AGENT_DISABLED_TOOLS = [
	"new_task",
	"plan_parallel_tasks",
] as const satisfies readonly ToolName[]

export type BackgroundAgentToolRestrictionState = {
	background?: boolean
	agentId?: string
}

export function isBackgroundAgentToolRestrictedTask(task: BackgroundAgentToolRestrictionState): boolean {
	return task.background === true && Boolean(task.agentId)
}

export function withBackgroundAgentDisabledTools(
	disabledTools: readonly string[] | undefined,
	task: BackgroundAgentToolRestrictionState,
): string[] | undefined {
	if (!isBackgroundAgentToolRestrictedTask(task)) {
		return disabledTools ? [...disabledTools] : undefined
	}

	return Array.from(new Set([...(disabledTools ?? []), ...BACKGROUND_AGENT_DISABLED_TOOLS]))
}

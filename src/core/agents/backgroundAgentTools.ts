import type { ToolName } from "@roo-code/types"

// Background children run their assigned specialist task directly. Only nested
// delegation/orchestration tools are structurally withheld; ordinary mode tools
// remain governed by the selected mode, experiments, and user disabled-tools settings.
export const BACKGROUND_AGENT_DISABLED_TOOLS = [
	"new_task",
	"plan_parallel_tasks",
] as const satisfies readonly ToolName[]

export const BACKGROUND_AGENT_ONLY_TOOLS = ["coordinate_agents"] as const satisfies readonly ToolName[]

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

export function getBackgroundAgentToolRequirements(task: BackgroundAgentToolRestrictionState): Record<string, boolean> {
	const isBackgroundAgent = isBackgroundAgentToolRestrictedTask(task)

	return BACKGROUND_AGENT_ONLY_TOOLS.reduce<Record<string, boolean>>((requirements, toolName) => {
		requirements[toolName] = isBackgroundAgent
		return requirements
	}, {})
}

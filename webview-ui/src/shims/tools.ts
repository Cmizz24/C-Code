import type { ToolGroup, ToolName } from "@roo-code/types"

export type ToolGroupConfig = {
	tools: readonly ToolName[]
	alwaysAvailable?: boolean
	customTools?: readonly ToolName[]
}

export const TOOL_GROUPS: Record<ToolGroup, ToolGroupConfig> = {
	read: {
		tools: ["read_file", "search_files", "list_files", "codebase_search"],
	},
	edit: {
		tools: ["apply_diff", "write_to_file", "edit", "search_replace", "edit_file", "apply_patch"],
	},
	command: {
		tools: ["execute_command", "read_command_output"],
	},
	visual_browser_inspector: {
		tools: ["visual_browser_inspector"],
	},
	image_generation: {
		tools: ["generate_image"],
	},
	mcp: {
		tools: ["use_mcp_tool", "access_mcp_resource"],
	},
	memory: {
		tools: ["ask_for_context", "memory_search", "mistake_memory", "memory_wipe"],
	},
	modes: {
		tools: ["switch_mode", "new_task"],
		alwaysAvailable: true,
	},
	orchestrator: {
		tools: ["plan_parallel_tasks"],
	},
}

export const ALWAYS_AVAILABLE_TOOLS: ToolName[] = [
	"ask_followup_question",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"coordinate_agents",
	"ask_for_context",
	"memory_search",
	"mistake_memory",
	"memory_wipe",
	"update_todo_list",
	"run_slash_command",
	"skill",
] as const

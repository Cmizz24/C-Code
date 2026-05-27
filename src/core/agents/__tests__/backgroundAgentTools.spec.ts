import {
	BACKGROUND_AGENT_DISABLED_TOOLS,
	BACKGROUND_AGENT_ONLY_TOOLS,
	getBackgroundAgentToolRequirements,
	withBackgroundAgentDisabledTools,
} from "../backgroundAgentTools"

describe("backgroundAgentTools", () => {
	it("does not change disabled tools for foreground tasks", () => {
		expect(withBackgroundAgentDisabledTools(["read_file"], { background: false, agentId: "ui" })).toEqual([
			"read_file",
		])
		expect(withBackgroundAgentDisabledTools(undefined, { background: true })).toBeUndefined()
	})

	it("disables only structural nested orchestration tools for background agent tasks", () => {
		expect(
			withBackgroundAgentDisabledTools(["read_file", "new_task"], { background: true, agentId: "ui" }),
		).toEqual(["read_file", ...BACKGROUND_AGENT_DISABLED_TOOLS])
		expect(BACKGROUND_AGENT_DISABLED_TOOLS).toEqual(["new_task", "plan_parallel_tasks"])
		expect(BACKGROUND_AGENT_DISABLED_TOOLS).not.toEqual(
			expect.arrayContaining(["execute_command", "switch_mode", "run_slash_command"]),
		)
	})

	it("requires background agent context for background-only coordination tools", () => {
		expect(BACKGROUND_AGENT_ONLY_TOOLS).toEqual(["coordinate_agents"])
		expect(getBackgroundAgentToolRequirements({ background: false, agentId: "ui" })).toEqual({
			coordinate_agents: false,
		})
		expect(getBackgroundAgentToolRequirements({ background: true })).toEqual({ coordinate_agents: false })
		expect(getBackgroundAgentToolRequirements({ background: true, agentId: "ui" })).toEqual({
			coordinate_agents: true,
		})
	})
})

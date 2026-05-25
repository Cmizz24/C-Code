import { BACKGROUND_AGENT_DISABLED_TOOLS, withBackgroundAgentDisabledTools } from "../backgroundAgentTools"

describe("backgroundAgentTools", () => {
	it("does not change disabled tools for foreground tasks", () => {
		expect(withBackgroundAgentDisabledTools(["read_file"], { background: false, agentId: "ui" })).toEqual([
			"read_file",
		])
		expect(withBackgroundAgentDisabledTools(undefined, { background: true })).toBeUndefined()
	})

	it("disables visible orchestration tools for background agent tasks", () => {
		expect(
			withBackgroundAgentDisabledTools(["read_file", "new_task"], { background: true, agentId: "ui" }),
		).toEqual(["read_file", ...BACKGROUND_AGENT_DISABLED_TOOLS])
		expect(BACKGROUND_AGENT_DISABLED_TOOLS).toEqual(
			expect.arrayContaining(["new_task", "plan_parallel_tasks", "switch_mode", "run_slash_command"]),
		)
	})
})

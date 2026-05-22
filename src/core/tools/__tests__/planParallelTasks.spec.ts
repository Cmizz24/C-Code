import { AgentBus } from "../../agents/AgentBus"
import { handlePlanParallelTasks } from "../planParallelTasks"

describe("handlePlanParallelTasks", () => {
	beforeEach(() => {
		AgentBus.reset()
	})

	afterEach(() => {
		AgentBus.reset()
	})

	it("rejects conflicting exclusive file ownership", () => {
		const result = handlePlanParallelTasks(
			{
				goal: "Split implementation work",
				agents: [
					{
						id: "agent-a",
						task: "Edit shared file first",
						owns: [{ path: "src/shared.ts", mode: "exclusive" }],
					},
					{
						id: "agent-b",
						task: "Edit shared file second",
						owns: [{ path: "./src/shared.ts", mode: "exclusive" }],
					},
				],
			},
			"/repo",
		)

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.errors).toContain("Ownership conflict for src/shared.ts between agent-a and agent-b.")
		}
	})

	it("allows shared ownership without conflict", () => {
		const result = handlePlanParallelTasks(
			{
				goal: "Split read-only review work",
				agents: [
					{
						id: "agent-a",
						task: "Review shared file first",
						owns: [{ path: "src/shared.ts", mode: "shared" }],
					},
					{
						id: "agent-b",
						task: "Review shared file second",
						owns: [{ path: "src/shared.ts", mode: "shared" }],
					},
				],
			},
			"/repo",
		)

		expect(result.ok).toBe(true)
	})

	it("rejects dependency cycles", () => {
		const result = handlePlanParallelTasks(
			{
				goal: "Split cyclic work",
				agents: [
					{
						id: "agent-a",
						task: "Wait for B",
						dependsOn: [{ agentId: "agent-b", waitFor: "complete" }],
					},
					{
						id: "agent-b",
						task: "Wait for A",
						dependsOn: [{ agentId: "agent-a", waitFor: "complete" }],
					},
				],
			},
			"/repo",
		)

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.errors).toContain("Dependency cycle detected: agent-a -> agent-b -> agent-a.")
		}
	})
})

import { AgentBus } from "../../agents/AgentBus"
import { handlePlanParallelTasks } from "../planParallelTasks"

describe("handlePlanParallelTasks", () => {
	beforeEach(() => {
		AgentBus.reset()
	})

	afterEach(() => {
		AgentBus.reset()
	})

	it("returns validation errors instead of throwing when the payload is missing", () => {
		expect(() => handlePlanParallelTasks(undefined, "/repo")).not.toThrow()

		const result = handlePlanParallelTasks(undefined, "/repo")

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.errors).toContain("A plan payload object is required.")
		}
	})

	it("returns validation errors instead of throwing when agents is malformed", () => {
		expect(() =>
			handlePlanParallelTasks(
				{
					goal: "Split implementation work",
					agents: "agent-a",
				},
				"/repo",
			),
		).not.toThrow()

		const result = handlePlanParallelTasks(
			{
				goal: "Split implementation work",
				agents: "agent-a",
			},
			"/repo",
		)

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.errors).toContain("At least one agent must be provided.")
		}
	})

	it("rejects plans with more agents than the configured maximum", () => {
		const result = handlePlanParallelTasks(
			{
				goal: "Split implementation work",
				agents: Array.from({ length: 3 }, (_, index) => ({
					id: `agent-${index + 1}`,
					mode: "code",
					task: `Implement file ${index + 1}`,
					owns: [{ path: `src/file-${index + 1}.ts`, mode: "exclusive" as const }],
				})),
			},
			"/repo",
			{ maxAgents: 2 },
		)

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.errors).toContain(
				"Parallel task plan includes 3 agents, but maximum parallel agents is configured to 2. Reduce the plan to 2 agents or fewer.",
			)
		}
	})

	it("rejects conflicting exclusive file ownership", () => {
		const result = handlePlanParallelTasks(
			{
				goal: "Split implementation work",
				agents: [
					{
						id: "agent-a",
						mode: "component",
						task: "Edit shared file first",
						owns: [{ path: "src/shared.ts", mode: "exclusive" }],
					},
					{
						id: "agent-b",
						mode: "api",
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
						mode: "review",
						task: "Review shared file first",
						owns: [{ path: "src/shared.ts", mode: "shared" }],
					},
					{
						id: "agent-b",
						mode: "review",
						task: "Review shared file second",
						owns: [{ path: "src/shared.ts", mode: "shared" }],
					},
				],
			},
			"/repo",
		)

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.plan.agents[0].mode).toBe("review")
		}
	})

	it("rejects dependency cycles", () => {
		const result = handlePlanParallelTasks(
			{
				goal: "Split cyclic work",
				agents: [
					{
						id: "agent-a",
						mode: "test",
						task: "Wait for B",
						dependsOn: [{ agentId: "agent-b", waitFor: "complete" }],
					},
					{
						id: "agent-b",
						mode: "test",
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

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

	it("keeps independent agents pending when shared contracts avoid completion dependencies", () => {
		const result = handlePlanParallelTasks(
			{
				goal: "Build a dashboard from agreed UI and styling contracts",
				sharedContext:
					"UI owns src/Dashboard.tsx. Styles owns src/dashboard.css. Use data-testid=dashboard-root and CSS variables documented here as the interface contract.",
				agents: [
					{
						id: "ui-agent",
						mode: "ui-ux",
						task: "Implement dashboard markup using the shared data-testid and class contract.",
						owns: [{ path: "src/Dashboard.tsx", mode: "exclusive" }],
					},
					{
						id: "styles-agent",
						mode: "css-styling",
						task: "Implement dashboard styles against the shared class and CSS variable contract.",
						owns: [{ path: "src/dashboard.css", mode: "exclusive" }],
					},
				],
			},
			"/repo",
		)

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.plan.sharedContext).toContain("interface contract")
			expect(result.plan.agents.map((agent) => [agent.id, agent.status])).toEqual([
				["ui-agent", "pending"],
				["styles-agent", "pending"],
			])
			expect(result.warnings).not.toEqual(expect.arrayContaining([expect.stringContaining("waits for")]))
		}
	})

	it("removes README and onboarding dependencies from independent implementation agents", () => {
		const result = handlePlanParallelTasks(
			{
				goal: "Implement the feature while documenting onboarding steps",
				sharedContext:
					"Implementation agents can use the API, DOM, README, and onboarding contracts described here without waiting for docs work to complete.",
				agents: [
					{
						id: "readme-agent",
						mode: "onboarding",
						task: "Update README and contributor onboarding documentation.",
						owns: [{ path: "README.md", mode: "exclusive" }],
					},
					{
						id: "feature-agent",
						mode: "code",
						task: "Implement the feature using the shared README and onboarding contract.",
						owns: [{ path: "src/feature.ts", mode: "exclusive" }],
						dependsOn: [{ agentId: "readme-agent", waitFor: "complete" }],
					},
				],
			},
			"/repo",
		)

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.plan.agents.find((agent) => agent.id === "feature-agent")?.status).toBe("pending")
			expect(result.plan.agents.find((agent) => agent.id === "feature-agent")?.dependsOn).toEqual([])
			expect(result.plan.sharedContext).toContain("README")
			expect(result.warnings).toEqual(
				expect.arrayContaining([
					expect.stringContaining(
						"dependency on documentation/onboarding agent readme-agent was removed so independent implementation work can start in parallel",
					),
				]),
			)
		}
	})

	it("warns when a completion dependency blocks agents with non-conflicting ownership", () => {
		const result = handlePlanParallelTasks(
			{
				goal: "Build a dashboard from agreed UI and styling contracts",
				sharedContext: "Use the planned DOM and CSS contract instead of waiting for full UI completion.",
				agents: [
					{
						id: "ui-agent",
						mode: "ui-ux",
						task: "Implement dashboard markup.",
						owns: [{ path: "src/Dashboard.tsx", mode: "exclusive" }],
					},
					{
						id: "styles-agent",
						mode: "css-styling",
						task: "Implement dashboard styles.",
						owns: [{ path: "src/dashboard.css", mode: "exclusive" }],
						dependsOn: [{ agentId: "ui-agent", waitFor: "complete" }],
					},
				],
			},
			"/repo",
		)

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.plan.agents.find((agent) => agent.id === "styles-agent")?.status).toBe("blocked")
			expect(result.warnings).toContain(
				"Agent styles-agent waits for ui-agent to complete despite non-conflicting ownership. If this is only an interface or DOM/API contract, move that contract into sharedContext or the agent task and remove the dependency so both agents can run in parallel. Use a signal dependency for a narrow handoff instead of waiting for full completion.",
			)
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

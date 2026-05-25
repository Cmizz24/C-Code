import type { ExecutionPlan } from "@roo-code/types"

import { AgentBus } from "../AgentBus"

function createPlan(): ExecutionPlan {
	return {
		planId: "plan-test",
		sharedContext: "shared context",
		fileOwnershipMap: {
			"src/a.ts": "agent-a",
			"src/b.ts": "agent-b",
		},
		agents: [
			{
				id: "agent-a",
				mode: "component",
				task: "Edit A",
				owns: [{ path: "src/a.ts", mode: "exclusive" }],
				mustNotTouch: ["src/forbidden.ts"],
				dependsOn: [],
				worktreePath: "/tmp/agent-a",
				status: "pending",
				signals: [],
			},
			{
				id: "agent-b",
				mode: "api",
				task: "Edit B",
				owns: [{ path: "src/b.ts", mode: "exclusive" }],
				mustNotTouch: [],
				dependsOn: [],
				worktreePath: "/tmp/agent-b",
				status: "pending",
				signals: [],
			},
			{
				id: "agent-c",
				mode: "review",
				task: "Read C",
				owns: [{ path: "src/c.ts", mode: "read-only" }],
				mustNotTouch: [],
				dependsOn: [],
				worktreePath: "/tmp/agent-c",
				status: "pending",
				signals: [],
			},
		],
		createdAt: 1,
	}
}

describe("AgentBus", () => {
	let bus: AgentBus

	beforeEach(() => {
		AgentBus.reset()
		bus = AgentBus.getInstance()
		bus.setExecutionPlan(createPlan())
	})

	afterEach(() => {
		AgentBus.reset()
	})

	it("approves writes to an exclusively owned file and releases the lock", () => {
		const events = vi.fn()
		bus.on("event", events)

		const permission = bus.requestWriteIntent("agent-a", "src/a.ts")

		expect(permission).toEqual({ approved: true })

		bus.releaseWriteIntent("agent-a", "src/a.ts")

		expect(events).toHaveBeenCalledWith({ type: "INTENT_CLEARED", agentId: "agent-a", path: "src/a.ts" })

		expect(bus.requestWriteIntent("agent-a", "src/a.ts")).toEqual({ approved: true })
	})

	it("denies a write while another agent holds the active write lock", () => {
		expect(bus.requestWriteIntent("agent-a", "src/unowned.ts").approved).toBe(true)

		const permission = bus.requestWriteIntent("agent-b", "src/unowned.ts")

		expect(permission.approved).toBe(false)
		expect(permission.suggestWait).toBe(true)
		expect(permission.reason).toContain("locked by agent-a")
	})

	it("denies writes to paths owned by another agent", () => {
		const permission = bus.requestWriteIntent("agent-a", "src/b.ts")

		expect(permission.approved).toBe(false)
		expect(permission.suggestWait).toBe(true)
		expect(permission.reason).toContain("owned by agent-b")
	})

	it("allows unowned writes with a warning", () => {
		const permission = bus.requestWriteIntent("agent-a", "src/unowned.ts")

		expect(permission.approved).toBe(true)
		expect(permission.unownedWarning).toContain("not declared")
	})

	it("denies read-only and must-not-touch writes", () => {
		expect(bus.requestWriteIntent("agent-c", "src/c.ts").approved).toBe(false)
		expect(bus.requestWriteIntent("agent-a", "src/forbidden.ts").approved).toBe(false)
	})

	it("unblocks agents when completion dependencies are satisfied", () => {
		const plan = createPlan()
		plan.agents[1].dependsOn = [{ agentId: "agent-a", waitFor: "complete" }]
		bus.setExecutionPlan(plan)

		const unblocked = vi.fn()
		bus.on("agentUnblocked", unblocked)

		expect(bus.getAgent("agent-b")?.status).toBe("blocked")

		bus.markComplete("agent-a", "done")

		expect(unblocked).toHaveBeenCalledWith(expect.objectContaining({ id: "agent-b", status: "pending" }))
		expect(bus.getAgent("agent-b")?.status).toBe("pending")
	})

	it("treats already-complete agents as satisfied when setting a plan", () => {
		const plan = createPlan()
		plan.agents[0].status = "complete"
		plan.agents[1].status = "blocked"
		plan.agents[1].dependsOn = [{ agentId: "agent-a", waitFor: "complete" }]

		bus.setExecutionPlan(plan)

		expect(bus.getAgent("agent-a")?.status).toBe("complete")
		expect(bus.getAgent("agent-b")?.status).toBe("pending")
	})

	it("unblocks an agent immediately when newly marked blocked on an already-complete dependency", () => {
		bus.markComplete("agent-a", "done")

		const unblocked = vi.fn()
		const events = vi.fn()
		bus.on("agentUnblocked", unblocked)
		bus.on("event", events)

		bus.markBlocked("agent-b", "Waiting for UI contract", [{ agentId: "agent-a", waitFor: "complete" }])

		expect(bus.getAgent("agent-b")?.status).toBe("pending")
		expect(unblocked).toHaveBeenCalledWith(expect.objectContaining({ id: "agent-b", status: "pending" }))
		expect(events).toHaveBeenCalledWith({ type: "STATUS", agentId: "agent-b", status: "pending" })
	})

	it("unblocks agents when signal dependencies are satisfied", () => {
		const plan = createPlan()
		plan.agents[1].dependsOn = [{ agentId: "agent-a", waitFor: "signal", signal: "types-ready" }]
		bus.setExecutionPlan(plan)

		const unblocked = vi.fn()
		bus.on("agentUnblocked", unblocked)

		bus.emitSignal("agent-a", "types-ready")

		expect(unblocked).toHaveBeenCalledWith(expect.objectContaining({ id: "agent-b", status: "pending" }))
	})

	it("clears active write locks when an agent fails", () => {
		const events = vi.fn()
		bus.on("event", events)

		expect(bus.requestWriteIntent("agent-a", "src/unowned.ts").approved).toBe(true)
		bus.markFailed("agent-a", "Cancelled")

		expect(events).toHaveBeenCalledWith({ type: "INTENT_CLEARED", agentId: "agent-a", path: "src/unowned.ts" })
		expect(bus.requestWriteIntent("agent-b", "src/unowned.ts").approved).toBe(true)
	})

	it("emits allTerminal when all agents have either completed or failed", () => {
		const allTerminal = vi.fn()
		const allComplete = vi.fn()
		bus.on("allTerminal", allTerminal)
		bus.on("allComplete", allComplete)

		bus.markComplete("agent-a")
		bus.markFailed("agent-b", "Agent failed")
		expect(allTerminal).not.toHaveBeenCalled()

		bus.markComplete("agent-c")

		expect(allTerminal).toHaveBeenCalledWith(expect.objectContaining({ planId: "plan-test" }))
		expect(allComplete).not.toHaveBeenCalled()
	})

	it("fails blocked dependents when their dependency fails", () => {
		const plan = createPlan()
		plan.agents[1].dependsOn = [{ agentId: "agent-a", waitFor: "complete" }]
		bus.setExecutionPlan(plan)
		const events = vi.fn()
		bus.on("event", events)

		bus.markFailed("agent-a", "Agent failed")

		expect(bus.getAgent("agent-b")?.status).toBe("failed")
		expect(events).toHaveBeenCalledWith({
			type: "FAILED",
			agentId: "agent-b",
			reason: "Dependency agent-a failed: Agent failed",
		})
	})
})

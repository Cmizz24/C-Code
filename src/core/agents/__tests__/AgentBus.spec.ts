import type { ExecutionPlan } from "@roo-code/types"

import { AGENT_COORDINATION_EVENT_LIMIT, AGENT_COORDINATION_MESSAGE_MAX_LENGTH, AgentBus } from "../AgentBus"

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

	it("seeds operational plan coordination messages when a plan starts", () => {
		const messages = bus.getCoordinationEvents("agent-a", { includeSelf: true, limit: 20 })

		expect(messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "plan-test:shared-context",
					kind: "shared-context",
					source: "system",
					message: "Shared context is in each agent task.",
				}),
				expect.objectContaining({
					id: "plan-test:team-kickoff",
					kind: "note",
					source: "system",
					message: "Team chat open for plan plan-test. Keep messages short.",
				}),
				expect.objectContaining({
					id: "plan-test:intro:agent-a",
					agentId: "agent-a",
					kind: "note",
					source: "system",
					message: "Agent agent-a: I own src/a.ts.",
				}),
			]),
		)
		expect(messages.find((message) => message.id === "plan-test:ownership:agent-a")).toBeUndefined()
		expect(messages.every((message) => message.message.length <= 90)).toBe(true)
		expect(messages.map((message) => message.message).join(" ")).not.toMatch(
			/selectors, classes, CSS variables|DOM hooks, IDs|public functions|file contracts/,
		)
		expect(messages.map((message) => message.message).join(" ")).not.toMatch(/\p{Extended_Pictographic}/u)
	})

	it("tracks read and publish coordination state per agent", () => {
		expect(bus.hasAgentReadCoordination("agent-a")).toBe(false)
		expect(bus.hasAgentPublishedCoordination("agent-a")).toBe(false)
		expect(bus.hasAgentCoordinated("agent-a")).toBe(false)

		bus.getCoordinationEvents("agent-a")

		expect(bus.hasAgentReadCoordination("agent-a")).toBe(true)
		expect(bus.hasAgentPublishedCoordination("agent-a")).toBe(false)
		expect(bus.hasAgentCoordinated("agent-a")).toBe(false)

		bus.publishCoordination("agent-a", { kind: "note", message: "Using src/a.ts for the exported hook." })

		expect(bus.hasAgentPublishedCoordination("agent-a")).toBe(true)
		expect(bus.hasAgentCoordinated("agent-a")).toBe(true)
	})

	it("performs safe coordination preflight before an agent's first write", () => {
		const events = vi.fn()
		bus.on("event", events)

		expect(bus.hasAgentCoordinated("agent-a")).toBe(false)

		const permission = bus.requestWriteIntent("agent-a", "src/a.ts")

		expect(permission).toEqual({ approved: true })
		expect(bus.hasAgentCoordinated("agent-a")).toBe(true)
		const coordinationCall = events.mock.calls.find(([event]) => event.type === "COORDINATION")
		expect(coordinationCall?.[0]).toEqual(
			expect.objectContaining({
				type: "COORDINATION",
				event: expect.objectContaining({
					id: "plan-test:preflight:agent-a",
					agentId: "agent-a",
					kind: "note",
					source: "system",
					message: "Agent agent-a: I'm about to edit src/a.ts. Any hooks I need?",
					relatedFiles: ["src/a.ts"],
				}),
			}),
		)
		expect(coordinationCall?.[0].event.message.length).toBeLessThanOrEqual(80)
		expect(coordinationCall?.[0].event.message).not.toMatch(/\p{Extended_Pictographic}/u)
		expect(events.mock.calls.at(-1)?.[0]).toEqual({
			type: "INTENT_WRITE",
			agentId: "agent-a",
			path: "src/a.ts",
			permission: { approved: true },
		})
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

	it("emits per-agent completion packets with ownership evidence when an agent completes", () => {
		const events = vi.fn()
		bus.on("event", events)

		expect(bus.requestWriteIntent("agent-a", "src/unowned.ts").approved).toBe(true)
		expect(bus.requestWriteIntent("agent-a", "src/b.ts").approved).toBe(false)

		bus.markComplete("agent-a", "A done")

		const packet = bus.getAgentCompletionPacket("agent-a")
		expect(packet).toEqual(
			expect.objectContaining({
				planId: "plan-test",
				agentId: "agent-a",
				mode: "component",
				status: "complete",
				completionResult: "A done",
			}),
		)
		expect(packet?.ownership.status).toBe("violation")
		expect(packet?.ownership.attemptedOutOfScopeWrites).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "src/unowned.ts", approved: true }),
				expect.objectContaining({ path: "src/b.ts", approved: false, ownerAgentId: "agent-b" }),
			]),
		)
		expect(packet?.validation).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "agent-terminal-status", status: "passed" }),
				expect.objectContaining({ name: "ownership-compliance", status: "failed" }),
			]),
		)
		expect(events).toHaveBeenCalledWith({ type: "COMPLETION_PACKET", agentId: "agent-a", packet })
	})

	it("aggregates plan-level completion packets across completed and failed agents", () => {
		const events = vi.fn()
		bus.on("event", events)

		bus.markComplete("agent-a", "A done")
		bus.markFailed("agent-b", "B failed")

		const planPacket = bus.getPlanCompletionPacket()
		expect(planPacket).toEqual(
			expect.objectContaining({
				planId: "plan-test",
				status: "partially-complete",
				agentCount: 3,
				completedAgentCount: 1,
				failedAgentCount: 1,
				packetCount: 2,
			}),
		)
		expect(planPacket?.agentPacketRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ agentId: "agent-a", status: "complete" }),
				expect.objectContaining({ agentId: "agent-b", status: "failed" }),
			]),
		)
		expect(planPacket?.failedAgents).toEqual([
			expect.objectContaining({ agentId: "agent-b", status: "failed", reason: "B failed" }),
		])
		expect(events).toHaveBeenCalledWith({ type: "PLAN_COMPLETION_PACKET", packet: planPacket })
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

	it("publishes sanitized bounded coordination messages and emits them", () => {
		const events = vi.fn()
		bus.on("event", events)

		const event = bus.publishCoordination("agent-a", {
			kind: "decision",
			message: [
				"Decision: use selector data-testid=save-button. 🚀",
				"<thinking>private chain-of-thought should not leak</thinking>",
				"Next: styles-agent can wire styles.",
			].join("\n"),
			targetAgentId: "agent-b",
			relatedFiles: [
				".\\src\\a.ts",
				"src/a.ts",
				"src/b.ts",
				"src/c.ts",
				"src/d.ts",
				"src/e.ts",
				"src/f.ts",
				"src/g.ts",
				"src/h.ts",
				"src/i.ts",
			],
			replyToId: "question-1",
		})

		expect(event).toBeDefined()
		if (!event) {
			throw new Error("Expected non-terminal publish to create a coordination event.")
		}

		expect(event).toEqual(
			expect.objectContaining({
				agentId: "agent-a",
				targetAgentId: "agent-b",
				kind: "decision",
				source: "agent",
				replyToId: "question-1",
			}),
		)
		expect(event.message).toContain("Decision: use selector")
		expect(event.message).toContain("[redacted private reasoning]")
		expect(event.message).not.toContain("🚀")
		expect(event.message).not.toMatch(/\p{Extended_Pictographic}/u)
		expect(event.message).not.toContain("private chain-of-thought should not leak")
		expect(event.relatedFiles).toEqual([
			"src/a.ts",
			"src/b.ts",
			"src/c.ts",
			"src/d.ts",
			"src/e.ts",
			"src/f.ts",
			"src/g.ts",
			"src/h.ts",
		])
		expect(events).toHaveBeenCalledWith({ type: "COORDINATION", event })
	})

	it("suppresses terminal-agent coordination publishes while preserving read access and completion packets", () => {
		const inbound = bus.publishCoordination("agent-b", {
			kind: "answer",
			message: "Use data-testid=save-button.",
			targetAgentId: "agent-a",
		})
		expect(inbound).toBeDefined()

		bus.markComplete("agent-a", "A done")
		const events = vi.fn()
		bus.on("event", events)

		const before = bus.getCoordinationEvents("agent-a", { includeSelf: true, limit: 20 })
		const suppressed = bus.publishCoordination("agent-a", {
			kind: "note",
			message: "Completion accepted; README.md is done.",
		})
		const after = bus.getCoordinationEvents("agent-a", { includeSelf: true, limit: 20 })

		expect(suppressed).toBeUndefined()
		expect(after).toEqual(before)
		expect(after).toEqual(
			expect.arrayContaining([expect.objectContaining({ message: "Use data-testid=save-button." })]),
		)
		expect(bus.getAgentCompletionPacket("agent-a")).toEqual(
			expect.objectContaining({ agentId: "agent-a", status: "complete", completionResult: "A done" }),
		)
		expect(events.mock.calls.some(([event]) => event.type === "COORDINATION")).toBe(false)
		expect(bus.hasAgentPublishedCoordination("agent-a")).toBe(false)
		expect(bus.hasAgentReadCoordination("agent-a")).toBe(true)
	})

	it("suppresses failed-agent coordination publishes without changing existing chat", () => {
		bus.publishCoordination("agent-b", { kind: "note", message: "Broadcast before failure." })
		bus.markFailed("agent-a", "Cancelled")
		const before = bus.getCoordinationEvents("agent-a", { includeSelf: true, limit: 20 })

		const suppressed = bus.publishCoordination("agent-a", {
			kind: "blocker",
			message: "Interrupted after cancellation.",
		})

		expect(suppressed).toBeUndefined()
		expect(bus.getCoordinationEvents("agent-a", { includeSelf: true, limit: 20 })).toEqual(before)
		expect(bus.getAgentCompletionPacket("agent-a")).toEqual(
			expect.objectContaining({ agentId: "agent-a", status: "failed", completionResult: "Cancelled" }),
		)
	})

	it("treats broadcast and no-reply coordination sentinels as absent", () => {
		const event = bus.publishCoordination("agent-a", {
			kind: "note",
			message: "Broadcast update.",
			targetAgentId: "all",
			replyToId: "none",
		})

		expect(event).toBeDefined()
		if (!event) {
			throw new Error("Expected non-terminal publish to create a coordination event.")
		}

		expect(event.targetAgentId).toBeUndefined()
		expect(event.replyToId).toBeUndefined()
	})

	it("returns only recent relevant coordination messages for each agent", () => {
		const broadcast = bus.publishCoordination("agent-a", { kind: "note", message: "Broadcast note" })
		const targetedToB = bus.publishCoordination("agent-a", {
			kind: "question",
			message: "Question for B",
			targetAgentId: "agent-b",
		})
		expect(broadcast).toBeDefined()
		expect(targetedToB).toBeDefined()
		if (!broadcast || !targetedToB) {
			throw new Error("Expected non-terminal publishes to create coordination events.")
		}
		bus.publishCoordination("agent-b", {
			kind: "answer",
			message: "Answer for A",
			targetAgentId: "agent-a",
			replyToId: targetedToB.id,
		})
		bus.publishCoordination("agent-c", {
			kind: "blocker",
			message: "Private blocker for C",
			targetAgentId: "agent-c",
		})

		expect(
			bus
				.getCoordinationEvents("agent-b")
				.filter((event) => event.source === "agent")
				.map((event) => event.message),
		).toEqual([broadcast.message, targetedToB.message])
		expect(
			bus
				.getCoordinationEvents("agent-a")
				.filter((event) => event.source === "agent")
				.map((event) => event.message),
		).toEqual(["Answer for A"])
		expect(
			bus
				.getCoordinationEvents("agent-a", { includeSelf: true })
				.filter((event) => event.source === "agent")
				.map((event) => event.message),
		).toEqual(["Broadcast note", "Question for B", "Answer for A"])
	})

	it("bounds stored and read coordination messages and resets them with a new plan", () => {
		for (let index = 0; index < AGENT_COORDINATION_EVENT_LIMIT + 5; index++) {
			bus.publishCoordination("agent-a", {
				kind: "note",
				message: `Message ${index} ${"x".repeat(AGENT_COORDINATION_MESSAGE_MAX_LENGTH + 20)}`,
			})
		}

		const recent = bus.getCoordinationEvents("agent-b", { limit: 100 })
		expect(recent).toHaveLength(20)
		expect(recent.at(0)?.message).toContain(`Message ${AGENT_COORDINATION_EVENT_LIMIT - 15}`)
		expect(recent.at(-1)?.message).toContain(`Message ${AGENT_COORDINATION_EVENT_LIMIT + 4}`)
		expect(recent.at(-1)?.message.length).toBe(AGENT_COORDINATION_MESSAGE_MAX_LENGTH)

		bus.setExecutionPlan(createPlan())

		const resetEvents = bus.getCoordinationEvents("agent-b", { includeSelf: true, limit: 20 })
		expect(resetEvents).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "plan-test:team-kickoff", source: "system" })]),
		)
		expect(resetEvents.map((event) => event.message).join(" ")).not.toContain("Message")
	})
})

import { RooCodeEventName, type ExecutionPlan, type TaskLike, type TaskProviderLike } from "@roo-code/types"

import { AgentBus } from "../../agents/AgentBus"
import { OrchestratorEventLoop } from "../OrchestratorEventLoop"

type TestProvider = TaskProviderLike & {
	createAgentWorktree: ReturnType<typeof vi.fn>
	requestPlanApproval: ReturnType<typeof vi.fn>
}

function createPlan(): ExecutionPlan {
	return {
		planId: "plan-test",
		sharedContext: "Build the dashboard",
		fileOwnershipMap: { "src/Dashboard.tsx": "ui" },
		agents: [
			{
				id: "ui",
				mode: "ui-ux",
				task: "Build the dashboard UI",
				owns: [{ path: "src/Dashboard.tsx", mode: "exclusive" }],
				mustNotTouch: [],
				dependsOn: [],
				worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/ui",
				status: "pending",
				signals: [],
			},
		],
		createdAt: 1,
	}
}

function createTask(): TaskLike {
	return {
		taskId: "task-id",
		metadata: {},
		taskStatus: "running" as TaskLike["taskStatus"],
		taskAsk: undefined,
		queuedMessages: [],
		tokenUsage: undefined,
		on: vi.fn().mockReturnThis(),
		off: vi.fn().mockReturnThis(),
		approveAsk: vi.fn(),
		denyAsk: vi.fn(),
		submitUserMessage: vi.fn(),
		abortTask: vi.fn(),
	} as unknown as TaskLike
}

function createProvider(overrides: Partial<TestProvider> = {}): TestProvider {
	return {
		cwd: "C:/repo",
		getCurrentTask: vi.fn(() => undefined),
		getRecentTasks: vi.fn(() => []),
		createTask: vi.fn(async () => createTask()),
		cancelTask: vi.fn(),
		clearTask: vi.fn(),
		resumeTask: vi.fn(),
		getModes: vi.fn(),
		getMode: vi.fn(),
		setMode: vi.fn(),
		getProviderProfiles: vi.fn(),
		getProviderProfile: vi.fn(),
		setProviderProfile: vi.fn(),
		on: vi.fn().mockReturnThis(),
		off: vi.fn().mockReturnThis(),
		postStateToWebview: vi.fn(async () => undefined),
		createAgentWorktree: vi.fn(async (_agentId: string, planId: string) => `C:/repo/.roo/${planId}/ui`),
		requestPlanApproval: vi.fn(async (plan: ExecutionPlan) => plan),
		...overrides,
	} as unknown as TestProvider
}

describe("OrchestratorEventLoop", () => {
	beforeEach(() => {
		AgentBus.reset()
	})

	afterEach(() => {
		AgentBus.reset()
	})

	it("does not create worktrees or tasks before the plan is approved", async () => {
		let approvePlan: (plan: ExecutionPlan | undefined) => void = () => {}
		const approval = new Promise<ExecutionPlan | undefined>((resolve) => {
			approvePlan = resolve
		})
		const provider = createProvider({
			requestPlanApproval: vi.fn(() => approval),
		})
		const plan = createPlan()

		new OrchestratorEventLoop(provider, AgentBus.getInstance()).start(plan)
		await Promise.resolve()

		expect(provider.requestPlanApproval).toHaveBeenCalledWith(plan)
		expect(provider.createAgentWorktree).not.toHaveBeenCalled()
		expect(provider.createTask).not.toHaveBeenCalled()

		approvePlan(plan)

		await vi.waitFor(() => expect(provider.createAgentWorktree).toHaveBeenCalledWith("ui", "plan-test"))
		expect(provider.createTask).toHaveBeenCalledTimes(1)
	})

	it("does not create worktrees or tasks when approval is canceled", async () => {
		const provider = createProvider({
			requestPlanApproval: vi.fn(async () => undefined),
		})

		new OrchestratorEventLoop(provider, AgentBus.getInstance()).start(createPlan())
		await Promise.resolve()

		expect(provider.createAgentWorktree).not.toHaveBeenCalled()
		expect(provider.createTask).not.toHaveBeenCalled()
	})

	it("marks the agent failed instead of leaving a rejected worktree promise", async () => {
		const provider = createProvider({
			createAgentWorktree: vi.fn(async () => {
				throw new Error("Parallel worktrees require a Git repository.")
			}),
		})
		const failedEvents: unknown[] = []
		AgentBus.getInstance().on("event", (event) => {
			if (event.type === "FAILED") {
				failedEvents.push(event)
			}
		})

		new OrchestratorEventLoop(provider, AgentBus.getInstance()).start(createPlan())

		await vi.waitFor(() =>
			expect(failedEvents).toContainEqual({
				type: "FAILED",
				agentId: "ui",
				reason: "Parallel worktrees require a Git repository.",
			}),
		)
		expect(provider.createTask).not.toHaveBeenCalled()
	})
})

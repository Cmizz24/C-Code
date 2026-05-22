import { RooCodeEventName, type ExecutionPlan, type TaskLike, type TaskProviderLike } from "@roo-code/types"

import { AgentBus } from "../../agents/AgentBus"
import { OrchestratorEventLoop } from "../OrchestratorEventLoop"

type TestProvider = TaskProviderLike & {
	createAgentWorktree: ReturnType<typeof vi.fn>
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

	it("starts approved parallel agents programmatically without invoking the new_task tool path", async () => {
		const provider = createProvider()
		const plan = createPlan()

		expect(provider.createTask).not.toHaveBeenCalled()

		new OrchestratorEventLoop(provider, AgentBus.getInstance()).start(plan)

		await vi.waitFor(() => expect(provider.createAgentWorktree).toHaveBeenCalledWith("ui", "plan-test"))
		expect(provider.createTask).toHaveBeenCalledTimes(1)
		const [message, images, parentTask, options] = vi.mocked(provider.createTask).mock.calls[0]

		expect(message).toContain("You are parallel agent ui running in ui-ux mode.")
		expect(message).toContain("Shared context:\nBuild the dashboard")
		expect(message).toContain("Task:\nBuild the dashboard UI")
		expect(message).not.toContain("new_task")
		expect(images).toBeUndefined()
		expect(parentTask).toBeUndefined()
		expect(options).toMatchObject({
			mode: "ui-ux",
			agentId: "ui",
			workspacePath: "C:/repo/.roo/plan-test/ui",
		})
		expect(options?.systemPromptSuffix).toContain("Parallel agent coordination rules:")
		expect(options?.systemPromptSuffix).toContain("- Agent id: ui")
		expect(options?.systemPromptSuffix).toContain("- Execution plan: plan-test")
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

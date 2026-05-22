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

function createTwoAgentPlan(): ExecutionPlan {
	const plan = createPlan()
	return {
		...plan,
		fileOwnershipMap: {
			"src/Dashboard.tsx": "ui",
			"src/dashboard.css": "styles",
		},
		agents: [
			plan.agents[0],
			{
				id: "styles",
				mode: "code",
				task: "Implement dashboard styles",
				owns: [{ path: "src/dashboard.css", mode: "exclusive" }],
				mustNotTouch: ["src/Dashboard.tsx"],
				dependsOn: [],
				worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/styles",
				status: "pending",
				signals: [],
			},
		],
	}
}

function createTask(taskId = "task-id"): TaskLike {
	return {
		taskId,
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
		createAgentWorktree: vi.fn(async (agentId: string, planId: string) => `C:/repo/.roo/${planId}/${agentId}`),
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

		expect(message).toContain("You are agent ui, running a normal single ui-ux specialist task.")
		expect(message).toContain("Shared context:\nBuild the dashboard")
		expect(message).toContain("Task:\nBuild the dashboard UI")
		expect(message).toContain("Your single ownership scope")
		expect(message).toContain("Use normal sequential tool calls")
		expect(message).toContain("Never combine multiple tool argument JSON objects into one tool call")
		expect(message).not.toContain("new_task")
		expect(images).toBeUndefined()
		expect(parentTask).toBeUndefined()
		expect(options).toMatchObject({
			mode: "ui-ux",
			agentId: "ui",
			workspacePath: "C:/repo/.roo/plan-test/ui",
		})
		expect(options?.systemPromptSuffix).toContain("Single-agent task guidance:")
		expect(options?.systemPromptSuffix).toContain("- Agent id: ui")
		expect(options?.systemPromptSuffix).toContain("- Execution plan: plan-test")
		expect(options?.systemPromptSuffix).toContain("Use normal sequential tool calls")
		expect(options?.systemPromptSuffix).toContain("Never concatenate multiple tool argument JSON objects")
	})

	it("builds isolated single-scope prompts for each child agent", async () => {
		const provider = createProvider()
		const plan = createTwoAgentPlan()

		new OrchestratorEventLoop(provider, AgentBus.getInstance()).start(plan)

		await vi.waitFor(() => expect(provider.createTask).toHaveBeenCalledTimes(2))
		const calls = vi.mocked(provider.createTask).mock.calls
		const uiCall = calls.find(([, , , options]) => options?.agentId === "ui")
		const stylesCall = calls.find(([, , , options]) => options?.agentId === "styles")

		expect(uiCall).toBeDefined()
		expect(stylesCall).toBeDefined()
		const [uiMessage, , , uiOptions] = uiCall!
		const [stylesMessage, , , stylesOptions] = stylesCall!

		expect(uiMessage).toContain("Task:\nBuild the dashboard UI")
		expect(uiMessage).toContain("- src/Dashboard.tsx (exclusive)")
		expect(uiMessage).not.toContain("Implement dashboard styles")
		expect(uiMessage).not.toContain("- src/dashboard.css (exclusive)")

		expect(stylesMessage).toContain("Task:\nImplement dashboard styles")
		expect(stylesMessage).toContain("- src/dashboard.css (exclusive)")
		expect(stylesMessage).toContain("Must not touch:\n- src/Dashboard.tsx")
		expect(stylesMessage).not.toContain("Build the dashboard UI")

		for (const options of [uiOptions, stylesOptions]) {
			expect(options?.systemPromptSuffix).toContain("Treat this as one normal specialist task")
			expect(options?.systemPromptSuffix).toContain("use one tool call at a time")
			expect(options?.systemPromptSuffix).toContain(
				"each native tool call must have exactly one JSON argument object",
			)
		}
	})

	it("uses the original orchestrator task as the parent for every spawned agent", async () => {
		const orchestratorTask = createTask("orchestrator-task")
		let currentTask: TaskLike | undefined = orchestratorTask
		const provider = createProvider({
			getCurrentTask: vi.fn(() => currentTask),
			createTask: vi.fn(async (_message, _images, _parentTask, options) => {
				const childTask = createTask(`child-${options?.agentId}`)
				currentTask = childTask
				return childTask
			}),
		})
		const plan = createTwoAgentPlan()

		new OrchestratorEventLoop(provider, AgentBus.getInstance()).start(plan)

		await vi.waitFor(() => expect(provider.createTask).toHaveBeenCalledTimes(2))
		expect(provider.getCurrentTask).toHaveBeenCalledTimes(1)
		for (const call of vi.mocked(provider.createTask).mock.calls) {
			expect(call[2]).toBe(orchestratorTask)
		}
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

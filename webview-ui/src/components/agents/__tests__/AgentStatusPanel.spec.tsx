import type { ClineSayTool, ExecutionPlan, ExtensionMessage } from "@roo-code/types"

import { act, fireEvent, render, screen, within } from "@/utils/test-utils"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { TranslationContext } from "@/i18n/TranslationContext"

import { AgentStatusPanel } from "../AgentStatusPanel"

vi.mock("@/utils/format", () => ({
	formatLargeNumber: vi.fn((num: number) => (num >= 1000 ? `${(num / 1000).toFixed(1)}K` : num.toString())),
}))

const translations: Record<string, string> = {
	"chat:parallelAgents.details.task": "Task",
	"chat:parallelAgents.details.ownedFiles": "Owned files",
	"chat:parallelAgents.details.mustNotTouch": "Must not touch",
	"chat:parallelAgents.details.status": "Status",
	"chat:parallelAgents.details.waiting": "Waiting",
	"chat:parallelAgents.details.lastTouched": "Last touched",
	"chat:parallelAgents.details.usage": "Usage",
	"chat:parallelAgents.details.worktree": "Worktree",
	"chat:parallelAgents.details.activity": "Activity",
	"chat:parallelAgents.details.conflicts": "Conflicts",
	"chat:parallelAgents.details.none": "None",
	"chat:parallelAgents.details.ready": "Ready",
	"chat:parallelAgents.details.waitingOn": "Waiting on {{agents}}",
	"chat:parallelAgents.details.noFileWrites": "No file writes yet",
	"chat:parallelAgents.details.noUsage": "No usage reported yet",
	"chat:parallelAgents.details.noActivity": "No activity reported yet",
	"chat:parallelAgents.details.noConflicts": "No conflicts",
}

const t = (key: string, options?: Record<string, unknown>) => {
	const value = translations[key] ?? key
	return value.replace(/{{(\w+)}}/g, (_, placeholder) => String(options?.[placeholder] ?? ""))
}

function createPlan(): ExecutionPlan {
	return {
		planId: "plan-test",
		sharedContext: "Build dashboard",
		fileOwnershipMap: {
			"src/Dashboard.tsx": "ui-agent",
			"src/dashboard.css": "styles-agent",
		},
		agents: [
			{
				id: "ui-agent",
				mode: "ui-ux",
				task: "Build dashboard UI",
				owns: [{ path: "src/Dashboard.tsx", mode: "exclusive" }],
				mustNotTouch: [],
				dependsOn: [],
				worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/ui-agent",
				status: "running",
				signals: [],
			},
			{
				id: "styles-agent",
				mode: "code",
				task: "Implement compact styles",
				owns: [{ path: "src/dashboard.css", mode: "exclusive" }],
				mustNotTouch: ["src/Dashboard.tsx"],
				dependsOn: [],
				worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/styles-agent",
				status: "pending",
				signals: [],
			},
		],
		createdAt: 1,
	}
}

function renderWithExtensionState(ui: React.ReactElement, plan: ExecutionPlan | undefined = createPlan()) {
	return render(
		<TranslationContext.Provider value={{ t, i18n: {} as any }}>
			<ExtensionStateContext.Provider value={{ activeExecutionPlan: plan, customModes: [] } as any}>
				{ui}
			</ExtensionStateContext.Provider>
		</TranslationContext.Provider>,
	)
}

describe("AgentStatusPanel", () => {
	it("renders as a compact chat tool entry instead of bulky agent cards", () => {
		const { container } = renderWithExtensionState(<AgentStatusPanel />)

		const panel = screen.getByTestId("agent-status-chat-card")
		expect(panel).toHaveAttribute("data-variant", "compact-chat-tool")
		expect(panel).not.toHaveClass("p-3")
		expect(panel).not.toHaveClass("shadow-sm")
		expect(panel.querySelector(".codicon-type-hierarchy-sub")).toBeInTheDocument()
		expect(screen.getAllByTestId("agent-status-row")).toHaveLength(2)
		expect(container.querySelectorAll("article")).toHaveLength(0)
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})

	it("expands and collapses agent rows with detailed task ownership and activity", () => {
		const plan = createPlan()
		plan.agents[0] = {
			...plan.agents[0],
			task: "Build dashboard UI with long copy that should only be fully readable in the expanded detail panel.",
			owns: [
				{ path: "src/Dashboard.tsx", mode: "exclusive" },
				{ path: "src/shared/theme.ts", mode: "shared" },
			],
			mustNotTouch: ["src/dashboard.css"],
		}
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "running",
			agentStatusUpdates: [
				{
					agentId: "ui-agent",
					status: "running",
					lastTouchedFile: "src/Dashboard.tsx",
					usage: {
						totalTokensIn: 1200,
						totalTokensOut: 340,
						totalCacheWrites: 0,
						totalCacheReads: 0,
						totalCost: 0.02,
						contextTokens: 1540,
					},
				},
			],
			agentActivities: [
				{
					agentId: "ui-agent",
					message: "Edited Dashboard component layout.",
					ts: 2,
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)

		expect(screen.queryByTestId("agent-details")).not.toBeInTheDocument()

		const firstToggle = screen.getAllByTestId("agent-status-toggle")[0]
		fireEvent.click(firstToggle)

		expect(firstToggle).toHaveAttribute("aria-expanded", "true")
		const details = screen.getByTestId("agent-details")
		expect(within(details).getByTestId("agent-details-task")).toHaveTextContent("Build dashboard UI with long copy")
		expect(within(details).getByTestId("agent-owned-files")).toHaveTextContent("src/Dashboard.tsx")
		expect(within(details).getByTestId("agent-owned-files")).toHaveTextContent("src/shared/theme.ts")
		expect(within(details).getByTestId("agent-must-not-touch")).toHaveTextContent("src/dashboard.css")
		expect(within(details).getByTestId("agent-last-touched")).toHaveTextContent("src/Dashboard.tsx")
		expect(within(details).getByTestId("agent-details-activity")).toHaveTextContent(
			"Edited Dashboard component layout.",
		)
		expect(within(details).getByTestId("agent-details-usage")).toHaveTextContent("↑ 1.2K · ↓ 340 · $0.02")
		expect(within(details).getByTestId("agent-worktree")).toHaveTextContent(
			"C:/repo/.roo/parallel-worktrees/plan-test/ui-agent",
		)
		expect(within(details).getByTestId("agent-details-conflicts")).toHaveTextContent("No conflicts")

		fireEvent.click(firstToggle)

		expect(firstToggle).toHaveAttribute("aria-expanded", "false")
		expect(screen.queryByTestId("agent-details")).not.toBeInTheDocument()
	})

	it("shows per-agent conflict information in expanded details", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "running",
			writeIntentConflicts: [
				{
					agentId: "styles-agent",
					filePath: "src/Dashboard.tsx",
					ownerTask: "ui-agent",
					reason: "exclusive ownership",
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)

		fireEvent.click(screen.getAllByTestId("agent-status-toggle")[1])

		const details = screen.getByTestId("agent-details")
		expect(within(details).getByTestId("agent-details-conflicts")).toHaveTextContent("src/Dashboard.tsx")
		expect(within(details).getByTestId("agent-details-conflicts")).toHaveTextContent("ui-agent")
		expect(within(details).getByTestId("agent-details-conflicts")).toHaveTextContent("exclusive ownership")
	})

	it("shows running progress and live agent status updates with real usage metadata only when emitted", () => {
		renderWithExtensionState(<AgentStatusPanel />)

		expect(screen.getByTestId("agent-status-summary")).toHaveTextContent("0/2 complete")
		expect(screen.queryByTestId("agent-usage")).not.toBeInTheDocument()

		const update: ExtensionMessage = {
			type: "agentStatusUpdate",
			agentStatusUpdate: {
				agentId: "ui-agent",
				status: "running",
				lastTouchedFile: "src/Dashboard.tsx",
				usage: {
					totalTokensIn: 1200,
					totalTokensOut: 340,
					totalCacheWrites: 0,
					totalCacheReads: 0,
					totalCost: 0.02,
					contextTokens: 1540,
				},
			},
		}

		act(() => {
			window.dispatchEvent(new MessageEvent("message", { data: update }))
		})

		expect(screen.getByTestId("agent-usage-summary")).toHaveTextContent("1/2 reporting usage")
		expect(screen.getByTestId("agent-usage")).toHaveTextContent("↑ 1.2K · ↓ 340 · $0.02")
	})

	it("renders a completed plan as a concise completed tool-style summary", () => {
		const completePlan = createPlan()
		completePlan.agents = completePlan.agents.map((agent) => ({ ...agent, status: "complete" }))

		renderWithExtensionState(<AgentStatusPanel />, completePlan)

		expect(screen.getByTestId("agent-status-summary")).toHaveTextContent("2/2 complete")
		expect(screen.getAllByText("complete").length).toBeGreaterThan(0)
		expect(screen.getAllByTestId("agent-status-row")).toHaveLength(2)
	})

	it("renders from a persisted parallelAgents tool payload without active extension state", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "review",
			agentStatusUpdates: [
				{
					agentId: "styles-agent",
					status: "complete",
					lastTouchedFile: "src/dashboard.css",
				},
			],
			agentActivities: [
				{
					agentId: "styles-agent",
					kind: "tool",
					message: "Applying a diff to src/dashboard.css.",
					ts: 2,
				},
				{
					agentId: "styles-agent",
					kind: "completion",
					message: "Reported completion.",
					ts: 3,
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)

		expect(screen.getByTestId("agent-status-summary")).toHaveTextContent("1/2 complete")
		expect(screen.getAllByText("review ready")).not.toHaveLength(0)
		expect(screen.getByTestId("agent-activity")).toHaveTextContent("Reported completion.")

		fireEvent.click(screen.getAllByTestId("agent-status-toggle")[1])
		expect(screen.getAllByTestId("agent-activity-event")).toHaveLength(2)
	})

	it("renders aggregate persisted child token usage in the tool header", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "running",
			parallelUsageSummary: {
				totalTokensIn: 1200,
				totalTokensOut: 340,
				totalCacheWrites: 0,
				totalCacheReads: 300,
				totalCost: 0.02,
				contextTokens: 1540,
				reportingAgents: 2,
			},
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)

		expect(screen.getByTestId("agent-usage-summary")).toHaveTextContent("2/2 reporting · ↑ 1.5K · ↓ 340 · $0.02")
	})

	it("reopens persisted merge review entries from a saved parallelAgents row", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "review",
			mergeReviewEntries: [
				{
					agentId: "ui-agent",
					mode: "ui-ux",
					task: "Build dashboard UI",
					diff: "diff --git a/src/Dashboard.tsx b/src/Dashboard.tsx\n+const title = 'Dashboard'",
					worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/ui-agent",
					branch: "parallel/plan-test/ui-agent",
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)

		expect(screen.queryByTestId("merge-review-inline")).not.toBeInTheDocument()
		fireEvent.click(screen.getByTestId("merge-review-toggle"))

		const review = screen.getByTestId("merge-review-inline")
		expect(screen.getByTestId("merge-review-toggle")).toHaveTextContent("Merge review saved")
		expect(review).toHaveTextContent("Build dashboard UI")
		expect(review).toHaveTextContent("parallel/plan-test/ui-agent")
		expect(review).toHaveTextContent("diff --git a/src/Dashboard.tsx b/src/Dashboard.tsx")
	})

	it("keeps an expanded agent row open when the same plan receives refreshed status props", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "running",
			agentStatusUpdates: [
				{
					agentId: "ui-agent",
					status: "running",
					lastTouchedFile: "src/Dashboard.tsx",
				},
			],
			agentActivities: [
				{
					agentId: "ui-agent",
					kind: "tool",
					message: "Reading src/Dashboard.tsx.",
					ts: 2,
				},
			],
		}

		const { rerender } = renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)

		const firstToggle = screen.getAllByTestId("agent-status-toggle")[0]
		fireEvent.click(firstToggle)
		expect(firstToggle).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByTestId("agent-details")).toBeInTheDocument()

		rerender(
			<TranslationContext.Provider value={{ t, i18n: {} as any }}>
				<ExtensionStateContext.Provider value={{ activeExecutionPlan: undefined, customModes: [] } as any}>
					<AgentStatusPanel
						tool={{
							...tool,
							agentStatusUpdates: [
								{
									agentId: "ui-agent",
									status: "running",
									lastTouchedFile: "src/shared/theme.ts",
								},
							],
							agentActivities: [
								...(tool.agentActivities ?? []),
								{
									agentId: "ui-agent",
									kind: "tool",
									message: "Applying a diff to src/shared/theme.ts.",
									ts: 3,
								},
							],
						}}
					/>
				</ExtensionStateContext.Provider>
			</TranslationContext.Provider>,
		)

		expect(screen.getAllByTestId("agent-status-toggle")[0]).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByTestId("agent-details")).toBeInTheDocument()
		expect(screen.getByTestId("agent-last-touched")).toHaveTextContent("src/shared/theme.ts")
	})

	it("shows a concise activity timeline by filtering thinking noise and grouping repeated events", () => {
		const plan = createPlan()
		const noisyActivities: NonNullable<ClineSayTool["agentActivities"]> = [
			{
				agentId: "ui-agent",
				kind: "thinking",
				message: "Thinking…",
				ts: 1,
			},
			{
				agentId: "ui-agent",
				kind: "thinking",
				message: "Reasoning through the next step.",
				ts: 2,
			},
			{
				agentId: "ui-agent",
				kind: "approval",
				message: "Tool approval resolved.",
				ts: 3,
			},
			{
				agentId: "ui-agent",
				kind: "tool",
				message: "Reading src/Dashboard.tsx.",
				ts: 4,
			},
			{
				agentId: "ui-agent",
				kind: "tool",
				message: "Reading src/Dashboard.tsx.",
				ts: 5,
			},
			{
				agentId: "ui-agent",
				kind: "tool",
				message: "Applying a diff to src/Dashboard.tsx.",
				ts: 6,
			},
			{
				agentId: "ui-agent",
				kind: "completion",
				message: "Reported completion.",
				ts: 7,
			},
		]

		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "running",
			agentActivities: noisyActivities,
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)
		fireEvent.click(screen.getAllByTestId("agent-status-toggle")[0])

		const details = screen.getByTestId("agent-details")
		expect(within(details).queryByText("Thinking…")).not.toBeInTheDocument()
		expect(within(details).queryByText("Reasoning through the next step.")).not.toBeInTheDocument()
		expect(within(details).queryByText("Tool approval resolved.")).not.toBeInTheDocument()
		expect(within(details).getAllByTestId("agent-activity-event")).toHaveLength(3)
		expect(within(details).getByText("Reading src/Dashboard.tsx.")).toBeInTheDocument()
		expect(within(details).getByTestId("agent-activity-repeat-count")).toHaveTextContent("×2")
		expect(within(details).getByText("Applying a diff to src/Dashboard.tsx.")).toBeInTheDocument()
		expect(within(details).getByText("Reported completion.")).toBeInTheDocument()
	})

	it("limits expanded activity to recent meaningful entries with an older count", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "running",
			agentActivities: Array.from({ length: 14 }, (_, index) => ({
				agentId: "ui-agent",
				kind: "tool" as const,
				message: `Reading src/file-${index}.ts.`,
				ts: index + 1,
			})),
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)
		fireEvent.click(screen.getAllByTestId("agent-status-toggle")[0])

		const details = screen.getByTestId("agent-details")
		expect(within(details).getAllByTestId("agent-activity-event")).toHaveLength(12)
		expect(within(details).getByTestId("agent-activity-hidden-count")).toHaveTextContent(
			"2 older activity events hidden",
		)
		expect(within(details).queryByText("Reading src/file-0.ts.")).not.toBeInTheDocument()
		expect(within(details).getByText("Reading src/file-13.ts.")).toBeInTheDocument()
	})

	it("renders cancelled persisted rows as terminal even if an old agent status says running", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "cancelled",
			agentStatusUpdates: [
				{
					agentId: "ui-agent",
					status: "running",
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)

		expect(screen.getByTestId("agent-status-summary")).toHaveTextContent("0/2 complete · 0 running")
		expect(screen.getAllByText("cancelled").length).toBeGreaterThan(0)
		expect(screen.getByTestId("agent-status-chat-card").querySelector(".codicon-loading")).not.toBeInTheDocument()
	})
})

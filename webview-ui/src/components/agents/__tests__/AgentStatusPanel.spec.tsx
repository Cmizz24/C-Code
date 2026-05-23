import type { ClineSayTool, ExecutionPlan, ExtensionMessage } from "@roo-code/types"

import { act, render, screen } from "@/utils/test-utils"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"

import { AgentStatusPanel } from "../AgentStatusPanel"

vi.mock("@/utils/format", () => ({
	formatLargeNumber: vi.fn((num: number) => (num >= 1000 ? `${(num / 1000).toFixed(1)}K` : num.toString())),
}))

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
		<ExtensionStateContext.Provider value={{ activeExecutionPlan: plan, customModes: [] } as any}>
			{ui}
		</ExtensionStateContext.Provider>,
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
					message: "Applying a diff to src/dashboard.css.",
					ts: 2,
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)

		expect(screen.getByTestId("agent-status-summary")).toHaveTextContent("1/2 complete")
		expect(screen.getAllByText("review ready")).not.toHaveLength(0)
		expect(screen.getByTestId("agent-activity")).toHaveTextContent("Applying a diff to src/dashboard.css.")
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
})

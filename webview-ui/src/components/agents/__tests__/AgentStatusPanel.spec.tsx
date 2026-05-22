import type { ExecutionPlan } from "@roo-code/types"

import { render, screen } from "@/utils/test-utils"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"

import { AgentStatusPanel } from "../AgentStatusPanel"

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

function renderWithExtensionState(ui: React.ReactElement, plan = createPlan()) {
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
		expect(screen.getAllByTestId("agent-status-row")).toHaveLength(2)
		expect(container.querySelectorAll("article")).toHaveLength(0)
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})
})

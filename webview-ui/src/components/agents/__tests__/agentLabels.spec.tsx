import type { ExecutionPlan, MergeReviewEntry } from "@roo-code/types"

import { fireEvent, render, screen } from "@/utils/test-utils"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"

import { PlanPreviewModal } from "../PlanPreviewModal"
import { MergeReviewPanel } from "../MergeReviewPanel"

const extensionState = {
	customModes: [],
}

function renderWithExtensionState(ui: React.ReactElement) {
	return render(<ExtensionStateContext.Provider value={extensionState as any}>{ui}</ExtensionStateContext.Provider>)
}

function createPlan(): ExecutionPlan {
	return {
		planId: "plan-test",
		sharedContext: "Shared context",
		fileOwnershipMap: { "src/App.tsx": "ui-agent" },
		agents: [
			{
				id: "ui-agent",
				mode: "ui-ux",
				task: "Review the dashboard flow",
				owns: [{ path: "src/App.tsx", mode: "exclusive" }],
				mustNotTouch: [],
				dependsOn: [],
				worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/ui-agent",
				status: "pending",
				signals: [],
			},
		],
		createdAt: 1,
	}
}

describe("parallel agent labels", () => {
	it("shows assigned mode labels instead of generic agent numbers in the plan preview", () => {
		renderWithExtensionState(<PlanPreviewModal plan={createPlan()} onClose={vi.fn()} />)

		expect(screen.getByText("UI/UX")).toBeInTheDocument()
		expect(screen.queryByText("Agent 1")).not.toBeInTheDocument()
		expect(screen.getByText("ui-agent")).toBeInTheDocument()
	})

	it("renders plan preview as a collapsible non-dialog panel", () => {
		renderWithExtensionState(<PlanPreviewModal plan={createPlan()} onClose={vi.fn()} />)

		expect(screen.getByTestId("plan-preview-panel")).toBeInTheDocument()
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		expect(screen.getAllByText("Shared context").length).toBeGreaterThan(0)

		fireEvent.click(screen.getByRole("button", { name: "Collapse" }))

		expect(screen.queryAllByText("Shared context")).toHaveLength(0)
		expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Approve plan" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
	})

	it("shows assigned mode labels in merge review entries", () => {
		const entries: MergeReviewEntry[] = [
			{
				agentId: "code-agent",
				mode: "code",
				task: "Implement the API call",
				diff: "",
				worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/code-agent",
				branch: "roo/parallel/plan-test/code-agent",
			},
		]

		renderWithExtensionState(<MergeReviewPanel entries={entries} onClose={vi.fn()} />)

		expect(screen.getByText("Code")).toBeInTheDocument()
		expect(screen.getByText("Implement the API call")).toBeInTheDocument()
		expect(screen.getByText("code-agent")).toBeInTheDocument()
	})

	it("shows a clear no-change reason when merge review diffs are empty", () => {
		const entries: MergeReviewEntry[] = [
			{
				agentId: "code-agent",
				mode: "code",
				task: "Check no-op formatting",
				diff: "",
				noChangesReason: "No changes detected in this agent worktree.",
				worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/code-agent",
				branch: "roo/parallel/plan-test/code-agent",
			},
		]

		renderWithExtensionState(<MergeReviewPanel entries={entries} onClose={vi.fn()} />)

		expect(screen.getByText("No changes detected in this agent worktree.")).toBeInTheDocument()
		expect(screen.queryByText("No diff available for this agent.")).not.toBeInTheDocument()
	})
})

import type { ExecutionPlan, MergeReviewEntry } from "@roo-code/types"

import { fireEvent, render, screen } from "@/utils/test-utils"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { TranslationContext } from "@/i18n/TranslationContext"

import { PlanPreviewModal } from "../PlanPreviewModal"
import { MergeReviewPanel } from "../MergeReviewPanel"

const extensionState = {
	customModes: [],
}

const t = (key: string, options?: Record<string, unknown>) => {
	const count = Number(options?.count)

	switch (key) {
		case "chat:parallelAgents.mergeReview.stats.files":
			return `${count} ${count === 1 ? "file" : "files"}`
		case "chat:parallelAgents.mergeReview.stats.lines":
			return `${count} ${count === 1 ? "line" : "lines"}`
		case "chat:parallelAgents.mergeReview.stats.binaryFiles":
			return `${count} ${count === 1 ? "binary file" : "binary files"}`
		case "chat:parallelAgents.mergeReview.showDiff":
			return "Show diff"
		case "chat:parallelAgents.mergeReview.hideDiff":
			return "Hide diff"
		default:
			return key
	}
}

function renderWithExtensionState(ui: React.ReactElement) {
	return render(
		<TranslationContext.Provider value={{ t, i18n: {} as any }}>
			<ExtensionStateContext.Provider value={extensionState as any}>{ui}</ExtensionStateContext.Provider>
		</TranslationContext.Provider>,
	)
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

	it("shows compact merge review stats and collapses diffs until expanded", () => {
		const entries: MergeReviewEntry[] = [
			{
				agentId: "code-agent",
				mode: "code",
				task: "Implement the API call",
				diff: [
					"diff --git a/src/api.ts b/src/api.ts",
					"--- a/src/api.ts",
					"+++ b/src/api.ts",
					"-export const oldApi = false",
					"+export const api = true",
					"+export const ready = true",
					"diff --git a/assets/logo.png b/assets/logo.png",
					"Binary files a/assets/logo.png and b/assets/logo.png differ",
				].join("\n"),
				worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/code-agent",
				branch: "roo/parallel/plan-test/code-agent",
			},
		]

		renderWithExtensionState(<MergeReviewPanel entries={entries} onClose={vi.fn()} />)

		const stats = screen.getByTestId("merge-review-stats-code-agent")
		expect(stats).toHaveTextContent("2 files")
		expect(stats).toHaveTextContent("3 lines")
		expect(stats).toHaveTextContent("+2")
		expect(stats).toHaveTextContent("-1")
		expect(stats).toHaveTextContent("1 binary file")
		expect(screen.queryByTestId("merge-review-diff-code-agent")).not.toBeInTheDocument()

		const diffToggle = screen.getByTestId("merge-review-diff-toggle-code-agent")
		expect(diffToggle).toHaveAttribute("aria-expanded", "false")
		expect(diffToggle).toHaveTextContent("Show diff")

		fireEvent.click(diffToggle)

		expect(diffToggle).toHaveAttribute("aria-expanded", "true")
		expect(diffToggle).toHaveTextContent("Hide diff")
		expect(screen.getByTestId("merge-review-diff-code-agent")).toBeInTheDocument()
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

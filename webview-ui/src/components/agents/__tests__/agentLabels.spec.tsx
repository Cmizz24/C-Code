const { mockPostMessage } = vi.hoisted(() => ({
	mockPostMessage: vi.fn(),
}))

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: mockPostMessage,
	},
}))

import type { ClineSayTool, ExecutionPlan, MergeReviewEntry } from "@roo-code/types"

import { fireEvent, render, screen } from "@/utils/test-utils"
import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { TranslationContext } from "@src/i18n/TranslationContext"

import { PlanPreviewModal } from "../PlanPreviewModal"
import { AgentStatusPanel } from "../AgentStatusPanel"

const extensionState = {
	customModes: [],
}

const t = (key: string, options?: Record<string, unknown>) => {
	const count = Number(options?.count)

	switch (key) {
		case "chat:parallelAgents.planPreview.title":
			return "Review parallel agent plan"
		case "chat:parallelAgents.planPreview.setupTitle":
			return "Git setup required for parallel agents"
		case "chat:parallelAgents.planPreview.description":
			return "Review each agent's assignment before C starts worktrees."
		case "chat:parallelAgents.planPreview.setupDescription":
			return "Fix the Git setup issue, then retry the preserved plan without rebuilding it."
		case "chat:parallelAgents.planPreview.expand":
			return "Expand"
		case "chat:parallelAgents.planPreview.collapse":
			return "Collapse"
		case "chat:parallelAgents.planPreview.setupRequired":
			return `Setup required: ${options?.reason}`
		case "chat:parallelAgents.planPreview.setupReasons.not-git-repo":
			return "not a Git repository"
		case "chat:parallelAgents.planPreview.setupReasons.no-initial-commit":
			return "no initial commit"
		case "chat:parallelAgents.planPreview.setupReasons.git-unavailable":
			return "Git unavailable"
		case "chat:parallelAgents.planPreview.pathPrivacyNote":
			return "Workspace and Git paths are hidden here to keep diagnostics safe."
		case "chat:parallelAgents.planPreview.sharedContext":
			return "Shared context"
		case "chat:parallelAgents.planPreview.taskDescription":
			return "Task description"
		case "chat:parallelAgents.planPreview.ownedFiles":
			return "Owned files"
		case "chat:parallelAgents.planPreview.noOwnedFiles":
			return "No owned files"
		case "chat:parallelAgents.planPreview.removeOwnedFile":
			return `Remove ${options?.path} from owned files`
		case "chat:parallelAgents.planPreview.dependencies":
			return "Dependencies"
		case "chat:parallelAgents.planPreview.noDependencies":
			return "No dependencies"
		case "chat:parallelAgents.planPreview.setupFooter":
			return "Your approved plan is preserved. Fix Git setup, then retry it."
		case "chat:parallelAgents.planPreview.footer":
			return "Review ownership boundaries before approving the plan."
		case "chat:parallelAgents.planPreview.cancel":
			return "Cancel"
		case "chat:parallelAgents.planPreview.retry":
			return "Retry preserved plan"
		case "chat:parallelAgents.planPreview.approve":
			return "Approve plan"
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

function renderSavedMergeReview(entries: MergeReviewEntry[], plan: ExecutionPlan = createPlan()) {
	const tool: ClineSayTool = {
		tool: "parallelAgents",
		executionPlan: plan,
		parallelStatus: "review",
		mergeReviewEntries: entries,
	}

	renderWithExtensionState(<AgentStatusPanel tool={tool} />)
	fireEvent.click(screen.getByTestId("merge-review-toggle"))
}

function createPlan(): ExecutionPlan {
	return {
		planId: "plan-test",
		sharedContext: "Shared context",
		sharedContract: "",
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
	beforeEach(() => {
		mockPostMessage.mockClear()
	})

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

	it("shows Git setup guidance and retries the preserved plan", () => {
		const onClose = vi.fn()
		renderWithExtensionState(
			<PlanPreviewModal
				plan={createPlan()}
				setupRequired={{
					reason: "no_initial_commit",
					message: "Parallel agents require a Git repository with at least one commit.",
					guidance: "Create the repository's first commit. No GitHub remote is required for local worktrees.",
					gitRoot: "C:/repo",
				}}
				onClose={onClose}
			/>,
		)

		expect(screen.getByText("Git setup required for parallel agents")).toBeInTheDocument()
		expect(screen.getByTestId("worktree-setup-required")).toHaveTextContent("no initial commit")
		expect(screen.getByTestId("worktree-setup-required")).toHaveTextContent("No GitHub remote is required")
		expect(screen.getByTestId("worktree-setup-required")).toHaveTextContent(
			"Workspace and Git paths are hidden here to keep diagnostics safe.",
		)
		expect(screen.queryByText(/C:\/repo/)).not.toBeInTheDocument()
		expect(screen.getByDisplayValue("Review the dashboard flow")).toBeDisabled()
		expect(screen.queryByRole("button", { name: "Approve plan" })).not.toBeInTheDocument()

		fireEvent.click(screen.getByRole("button", { name: "Retry preserved plan" }))

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "retryPlan" })
		expect(onClose).not.toHaveBeenCalled()
	})

	it("shows assigned mode labels in saved merge review entries", () => {
		const entries: MergeReviewEntry[] = [
			{
				agentId: "ui-agent",
				mode: "ui-ux",
				task: "Review the dashboard flow",
				diff: "",
				worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/ui-agent",
				branch: "roo/parallel/plan-test/ui-agent",
			},
		]

		renderSavedMergeReview(entries)

		expect(screen.getAllByText("UI/UX").length).toBeGreaterThan(0)
		expect(screen.getAllByText("Review the dashboard flow").length).toBeGreaterThan(0)
		expect(screen.getByText("roo/parallel/plan-test/ui-agent")).toBeInTheDocument()
	})

	it("shows compact saved merge review stats and collapses diffs until expanded", () => {
		const entries: MergeReviewEntry[] = [
			{
				agentId: "ui-agent",
				mode: "ui-ux",
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
				worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/ui-agent",
				branch: "roo/parallel/plan-test/ui-agent",
			},
		]

		renderSavedMergeReview(entries)

		const stats = screen.getByTestId("merge-review-inline-stats-ui-agent")
		expect(stats).toHaveTextContent("2 files")
		expect(stats).toHaveTextContent("3 lines")
		expect(stats).toHaveTextContent("+2")
		expect(stats).toHaveTextContent("-1")
		expect(stats).toHaveTextContent("1 binary file")
		expect(screen.queryByTestId("merge-review-inline-diff-ui-agent")).not.toBeInTheDocument()

		const diffToggle = screen.getByTestId("merge-review-inline-diff-toggle-ui-agent")
		expect(diffToggle).toHaveAttribute("aria-expanded", "false")
		expect(diffToggle).toHaveTextContent("Show diff")

		fireEvent.click(diffToggle)

		expect(diffToggle).toHaveAttribute("aria-expanded", "true")
		expect(diffToggle).toHaveTextContent("Hide diff")
		expect(screen.getByTestId("merge-review-inline-diff-ui-agent")).toBeInTheDocument()
	})

	it("shows a clear no-change reason when saved merge review diffs are empty", () => {
		const entries: MergeReviewEntry[] = [
			{
				agentId: "ui-agent",
				mode: "ui-ux",
				task: "Check no-op formatting",
				diff: "",
				noChangesReason: "No changes detected in this agent worktree.",
				worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/ui-agent",
				branch: "roo/parallel/plan-test/ui-agent",
			},
		]

		renderSavedMergeReview(entries)

		expect(screen.getByText("No changes detected in this agent worktree.")).toBeInTheDocument()
		expect(screen.queryByText("No diff available for this agent.")).not.toBeInTheDocument()
	})
})

import type { ClineSayTool, ExecutionPlan, ExtensionMessage } from "@roo-code/types"

import { act, fireEvent, render, screen, within } from "@/utils/test-utils"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { TranslationContext } from "@/i18n/TranslationContext"

import { AgentStatusPanel } from "../AgentStatusPanel"

vi.mock("@/utils/format", () => ({
	formatLargeNumber: vi.fn((num: number) => (num >= 1000 ? `${(num / 1000).toFixed(1)}K` : num.toString())),
}))

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
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
	"chat:parallelAgents.mergeReview.approved": "Approved",
	"chat:parallelAgents.mergeReview.approveAndMerge": "Approve & Merge",
	"chat:parallelAgents.mergeReview.mergeAllApproved": "Merge All Approved",
	"chat:parallelAgents.mergeReview.showDiff": "Show diff",
	"chat:parallelAgents.mergeReview.hideDiff": "Hide diff",
	"chat:parallelAgents.mergeReview.noChangesReported": "No changes reported.",
}

const t = (key: string, options?: Record<string, unknown>) => {
	const count = Number(options?.count)

	if (key === "chat:parallelAgents.mergeReview.stats.files") {
		return `${count} ${count === 1 ? "file" : "files"}`
	}

	if (key === "chat:parallelAgents.mergeReview.stats.lines") {
		return `${count} ${count === 1 ? "line" : "lines"}`
	}

	if (key === "chat:parallelAgents.mergeReview.stats.binaryFiles") {
		return `${count} ${count === 1 ? "binary file" : "binary files"}`
	}

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

const expectNoEmoji = (element: HTMLElement) => {
	expect(element.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u)
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

	it("renders persisted coordination as a read-only team chat with plan context de-emphasized", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "running",
			agentCoordinationEvents: [
				{
					kind: "shared-context",
					source: "system",
					message: "Shared plan context was provided to all agents.",
					ts: 1,
				},
				{
					agentId: "ui-agent",
					kind: "ownership",
					source: "system",
					message: "Agent ui-agent owns src/Dashboard.tsx.",
					ts: 2,
				},
				{
					agentId: "styles-agent",
					kind: "dependency",
					source: "system",
					message: "Agent styles-agent waits for ui-agent to signal dom-ready.",
					ts: 3,
				},
				{
					id: "coord-1",
					agentId: "ui-agent",
					targetAgentId: "styles-agent",
					kind: "question",
					source: "agent",
					message: "Do you need a wrapper class in src/Dashboard.tsx for the compact card styles?",
					relatedFiles: ["src/Dashboard.tsx"],
					ts: 1_700_000_000_000,
				},
				{
					id: "coord-2",
					agentId: "styles-agent",
					targetAgentId: "ui-agent",
					kind: "answer",
					source: "agent",
					message:
						'Please add className="dashboard-card"; CSS will target .dashboard-card and --dashboard-gap.',
					relatedFiles: ["src/dashboard.css"],
					replyToId: "coord-1",
					ts: 1_700_000_000_500,
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)

		const feed = screen.getByTestId("agent-coordination-feed")
		expect(feed).toHaveTextContent("Coordination")
		expect(feed).toHaveTextContent("Team chat · read-only · latest 8")
		expect(screen.getAllByTestId("agent-coordination-message")).toHaveLength(2)
		expect(screen.getByTestId("agent-coordination-context")).toHaveTextContent("Plan context")

		const chatMessages = screen.getAllByTestId("agent-coordination-message")
		const mainChat = chatMessages.map((message) => message.textContent ?? "").join(" ")
		expect(mainChat).toContain("UI/UX")
		expect(mainChat).toContain("Code")
		expect(mainChat).toContain("running")
		expect(mainChat).toContain("pending")
		expect(mainChat).toContain("Do you need a wrapper class")
		expect(mainChat).toContain("dashboard-card")
		expect(mainChat).toContain("--dashboard-gap")
		expect(mainChat).toContain("src/Dashboard.tsx")
		expect(mainChat).toContain("src/dashboard.css")
		expect(mainChat).not.toContain("Shared plan context was provided")
		expect(mainChat).not.toContain("owns")
		expect(mainChat).not.toContain("waits for")
		expect(mainChat).not.toContain("question")
		expect(mainChat).not.toContain("answer")
		expect(mainChat).not.toContain("to Code")
		expect(mainChat).not.toContain("coord-1")
		expect(mainChat).not.toContain("coord-2")
		expect(feed).not.toHaveTextContent("contract")
		expect(screen.getAllByTestId("agent-coordination-related-file")).toHaveLength(2)
		expectNoEmoji(feed)
		expect(within(feed).queryByRole("button")).not.toBeInTheDocument()
		expect(within(feed).queryByRole("textbox")).not.toBeInTheDocument()
	})

	it("shows setup coordination in the team chat when no agent-authored messages exist", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "running",
			agentCoordinationEvents: [
				{
					id: "plan-test:team-kickoff",
					kind: "note",
					source: "system",
					message:
						"Team coordination started for plan plan-test: align filenames, selectors, classes, CSS variables, DOM hooks, IDs, data attributes, public functions, and responsibilities before writing shared integration points.",
					ts: 1,
				},
				{
					id: "plan-test:intro:ui-agent",
					agentId: "ui-agent",
					kind: "note",
					source: "system",
					message: "Agent ui-agent starts ui-ux scope: Build dashboard UI Scope paths: src/Dashboard.tsx.",
					relatedFiles: ["src/Dashboard.tsx"],
					ts: 2,
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)

		const feed = screen.getByTestId("agent-coordination-feed")
		expect(screen.queryByTestId("agent-coordination-empty")).not.toBeInTheDocument()
		expect(screen.getAllByTestId("agent-coordination-message")).toHaveLength(2)
		expect(feed).toHaveTextContent("Team coordination started for plan plan-test")
		expect(feed).toHaveTextContent("Agent ui-agent starts ui-ux scope")
		expect(feed).toHaveTextContent("CSS variables")
		expect(feed).toHaveTextContent("src/Dashboard.tsx")
		expectNoEmoji(feed)
	})

	it("renders live coordination updates as bounded chat messages without event-log labels", () => {
		renderWithExtensionState(<AgentStatusPanel />)

		for (let index = 0; index < 10; index++) {
			const update: ExtensionMessage = {
				type: "agentCoordinationUpdate",
				agentCoordinationEvent: {
					id: `coord-${index}`,
					agentId: index === 9 ? "ui-agent" : "styles-agent",
					targetAgentId: index === 9 ? "styles-agent" : undefined,
					kind: index === 9 ? "question" : "note",
					source: "agent",
					message: index === 9 ? "Can you confirm the dashboard selector?" : `Coordination ${index}`,
					relatedFiles: index === 9 ? ["src/Dashboard.tsx", "src/dashboard.css"] : undefined,
					replyToId: index === 9 ? "coord-7" : undefined,
					ts: 1_700_000_000_000 + index,
				},
			}

			act(() => {
				window.dispatchEvent(new MessageEvent("message", { data: update }))
			})
		}

		const feed = screen.getByTestId("agent-coordination-feed")
		expect(feed).toHaveTextContent("Team chat · read-only · latest 8")
		expect(feed).not.toHaveTextContent("Coordination 0")
		expect(feed).not.toHaveTextContent("Coordination 1")
		expect(feed).toHaveTextContent("Can you confirm the dashboard selector?")
		expect(feed).not.toHaveTextContent("question")
		expect(feed).not.toHaveTextContent("note")
		expect(feed).toHaveTextContent("UI/UX")
		expect(feed).toHaveTextContent("running")
		expect(feed).not.toHaveTextContent("to Code")
		expect(feed).not.toHaveTextContent("reply coord-7")
		expect(feed).not.toHaveTextContent("coord-7")
		expect(feed).not.toHaveTextContent("ownership")
		expect(feed).not.toHaveTextContent("dependency")
		expect(feed).not.toHaveTextContent("contract")
		expect(screen.getAllByTestId("agent-coordination-message")).toHaveLength(8)
		expect(screen.getAllByTestId("agent-coordination-related-file")).toHaveLength(2)
		expect(feed).toHaveTextContent("src/Dashboard.tsx")
		expect(feed).toHaveTextContent("src/dashboard.css")
		expectNoEmoji(feed)
		expect(within(feed).queryByRole("button")).not.toBeInTheDocument()
		expect(within(feed).queryByRole("textbox")).not.toBeInTheDocument()
	})

	it("ignores live coordination updates outside the active plan", () => {
		renderWithExtensionState(<AgentStatusPanel />)

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "agentCoordinationUpdate",
						agentCoordinationEvent: {
							agentId: "unrelated-agent",
							kind: "note",
							message: "This should not render.",
							ts: 1_700_000_000_000,
						},
					} satisfies ExtensionMessage,
				}),
			)
		})

		expect(screen.queryByTestId("agent-coordination-feed")).not.toBeInTheDocument()
	})

	it("renders the serialized parallel review summary inside the tool card", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "review",
			parallelReviewSummary: {
				path: ".roo/parallel-agent-review.md",
				markdown: [
					"# Parallel agent review for plan-test",
					"",
					"Full per-agent diffs are available in the persisted parallel agents card.",
					"- ui-agent: pending; 1 files, +1/-1",
				].join("\n"),
			},
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)

		const summary = screen.getByTestId("parallel-agent-review-summary")
		expect(summary).toHaveTextContent("Parallel agent review summary")
		expect(summary).toHaveTextContent("Full per-agent diffs are available in the persisted parallel agents card.")
		expect(summary).not.toHaveTextContent("User Edits")
		expect(summary).not.toHaveTextContent("User Edit")
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
					diff: [
						"diff --git a/src/Dashboard.tsx b/src/Dashboard.tsx",
						"--- a/src/Dashboard.tsx",
						"+++ b/src/Dashboard.tsx",
						"-const title = 'Old dashboard'",
						"+const title = 'Dashboard'",
					].join("\n"),
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

		const stats = screen.getByTestId("merge-review-inline-stats-ui-agent")
		expect(stats).toHaveTextContent("1 file")
		expect(stats).toHaveTextContent("2 lines")
		expect(stats).toHaveTextContent("+1")
		expect(stats).toHaveTextContent("-1")
		expect(screen.queryByTestId("merge-review-inline-diff-ui-agent")).not.toBeInTheDocument()

		const diffToggle = screen.getByTestId("merge-review-inline-diff-toggle-ui-agent")
		expect(diffToggle).toHaveAttribute("aria-expanded", "false")
		expect(diffToggle).toHaveTextContent("Show diff")

		fireEvent.click(diffToggle)

		expect(diffToggle).toHaveAttribute("aria-expanded", "true")
		expect(diffToggle).toHaveTextContent("Hide diff")
		expect(screen.getByTestId("merge-review-inline-diff-ui-agent")).toBeInTheDocument()
	})

	it("renders persisted merge review statuses without inline approval controls", () => {
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
					diff: [
						"diff --git a/src/Dashboard.tsx b/src/Dashboard.tsx",
						"--- a/src/Dashboard.tsx",
						"+++ b/src/Dashboard.tsx",
						"-const title = 'Old dashboard'",
						"+const title = 'Dashboard'",
					].join("\n"),
					worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/ui-agent",
					branch: "parallel/plan-test/ui-agent",
					mergeStatus: "pending",
				},
				{
					agentId: "styles-agent",
					mode: "code",
					task: "Implement compact styles",
					diff: "",
					noChangesReason: "No changes detected.",
					worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/styles-agent",
					branch: "parallel/plan-test/styles-agent",
					mergeStatus: "merged",
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)
		fireEvent.click(screen.getByTestId("merge-review-toggle"))

		expect(screen.getByTestId("merge-review-inline-status-ui-agent")).toHaveTextContent("pending")
		expect(screen.getByTestId("merge-review-inline-status-styles-agent")).toHaveTextContent("merged")
		expect(screen.queryByTestId("merge-review-inline-merge-approved")).not.toBeInTheDocument()
		expect(screen.queryByTestId("merge-review-inline-approval-ui-agent")).not.toBeInTheDocument()
		expect(screen.queryByTestId("merge-review-inline-approval-styles-agent")).not.toBeInTheDocument()
	})

	it("shows failed merge details and skipped auto-merge reasons", () => {
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
					diff: "",
					worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/ui-agent",
					branch: "parallel/plan-test/ui-agent",
					mergeStatus: "failed",
					mergeError: "CONFLICT (add/add): Merge conflict in index.html",
					conflictedFiles: ["index.html"],
					mergeable: false,
				},
				{
					agentId: "styles-agent",
					mode: "code",
					task: "Implement compact styles",
					diff: "",
					worktreePath: "C:/repo/.roo/parallel-worktrees/plan-test/styles-agent",
					branch: "parallel/plan-test/styles-agent",
					mergeStatus: "skipped",
					autoMergeSkippedReason: "styles-agent still has a write conflict for src/Dashboard.tsx",
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)
		fireEvent.click(screen.getByTestId("merge-review-toggle"))

		expect(screen.getByTestId("merge-review-inline-status-ui-agent")).toHaveTextContent("failed")
		expect(screen.getByTestId("merge-review-inline-merge-error-ui-agent")).toHaveTextContent("CONFLICT (add/add)")
		expect(screen.getByTestId("merge-review-inline-conflicts-ui-agent")).toHaveTextContent("index.html")
		expect(screen.queryByTestId("merge-review-inline-approval-ui-agent")).not.toBeInTheDocument()

		expect(screen.getByTestId("merge-review-inline-status-styles-agent")).toHaveTextContent("skipped")
		expect(screen.getByTestId("merge-review-inline-auto-skip-styles-agent")).toHaveTextContent(
			"styles-agent still has a write conflict",
		)
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

	it("renders assistant and child message activity rows with the clearer message label", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "running",
			agentActivities: [
				{
					agentId: "ui-agent",
					kind: "assistant",
					message: "Said: I am wiring the dashboard shell.",
					ts: 1,
				},
				{
					agentId: "ui-agent",
					kind: "message",
					message: "Said: I finished the dashboard shell.",
					ts: 2,
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)
		fireEvent.click(screen.getAllByTestId("agent-status-toggle")[0])

		const details = screen.getByTestId("agent-details")
		const activityLabels = within(details).getAllByTestId("agent-activity-kind")

		expect(activityLabels).toHaveLength(2)
		expect(activityLabels.map((label) => label.textContent)).toEqual(["message", "message"])
		expect(activityLabels.map((label) => label.textContent)).not.toContain("assistant")
	})

	it("shows only the latest thinking state when an agent is currently thinking", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "running",
			agentActivities: [
				{
					agentId: "ui-agent",
					kind: "tool",
					message: "Reading src/Dashboard.tsx.",
					ts: 1,
				},
				{
					agentId: "ui-agent",
					kind: "thinking",
					message: "Thinking…",
					ts: 2,
				},
				{
					agentId: "ui-agent",
					kind: "thinking",
					message: "Reasoning through the next step.",
					ts: 3,
				},
				{
					agentId: "ui-agent",
					kind: "thinking",
					message: "Thinking…",
					ts: 4,
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)
		fireEvent.click(screen.getAllByTestId("agent-status-toggle")[0])

		const details = screen.getByTestId("agent-details")
		expect(within(details).getAllByTestId("agent-activity-event")).toHaveLength(2)
		expect(within(details).getByText("Reading src/Dashboard.tsx.")).toBeInTheDocument()
		expect(within(details).getAllByText("Thinking…")).toHaveLength(1)
		expect(within(details).queryByText("Reasoning through the next step.")).not.toBeInTheDocument()
		expect(within(details).queryByTestId("agent-activity-repeat-count")).not.toBeInTheDocument()
	})

	it("uses latest hidden current activity instead of a stale diff-start label", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "running",
			agentActivities: [
				{
					agentId: "ui-agent",
					kind: "tool",
					message: "Applying a diff to src/Dashboard.tsx.",
					ts: 1,
				},
				{
					agentId: "ui-agent",
					kind: "approval",
					message: "Tool approval resolved.",
					ts: 2,
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)
		fireEvent.click(screen.getAllByTestId("agent-status-toggle")[0])

		expect(screen.getByTestId("agent-activity")).toHaveTextContent("Tool approval resolved.")
		const details = screen.getByTestId("agent-details")
		expect(within(details).queryByText("Tool approval resolved.")).not.toBeInTheDocument()
		expect(within(details).getByText("Applying a diff to src/Dashboard.tsx.")).toBeInTheDocument()
	})

	it("uses a safe running fallback instead of a stale diff-start current activity", () => {
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
					message: "Applying a diff to src/Dashboard.tsx.",
					ts: 1,
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)
		fireEvent.click(screen.getAllByTestId("agent-status-toggle")[0])

		expect(screen.getByTestId("agent-activity")).toHaveTextContent("Continuing work after diff request.")
		expect(screen.getByTestId("agent-activity")).not.toHaveTextContent("src/Dashboard.tsx")
		expect(screen.getByTestId("agent-activity")).not.toHaveTextContent("Applying a diff")
		expect(
			within(screen.getByTestId("agent-details")).getByText("Applying a diff to src/Dashboard.tsx."),
		).toBeInTheDocument()
	})

	it("shows elapsed timing for live current activity without exposing hidden reasoning noise", () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"))

		try {
			const plan = createPlan()
			const tool: ClineSayTool = {
				tool: "parallelAgents",
				executionPlan: plan,
				parallelStatus: "running",
				agentActivities: [
					{
						agentId: "ui-agent",
						kind: "thinking",
						message: "Reasoning through the next step.",
						ts: Date.now() - 120_000,
					},
					{
						agentId: "ui-agent",
						kind: "wait",
						message: "Waiting for the provider rate limit.",
						ts: Date.now() - 90_000,
					},
				],
			}

			renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)
			fireEvent.click(screen.getAllByTestId("agent-status-toggle")[0])

			expect(screen.getByTestId("agent-activity")).toHaveTextContent("Waiting for the provider rate limit.")
			expect(screen.getByTestId("agent-activity-elapsed")).toHaveTextContent("1m ago")

			const details = screen.getByTestId("agent-details")
			expect(within(details).queryByText("Reasoning through the next step.")).not.toBeInTheDocument()
			expect(within(details).getByTestId("agent-activity-timestamp")).toHaveTextContent("1m ago")
		} finally {
			vi.useRealTimers()
		}
	})

	it("uses terminal status instead of a stale tool-start label", () => {
		const plan = createPlan()
		const tool: ClineSayTool = {
			tool: "parallelAgents",
			executionPlan: plan,
			parallelStatus: "review",
			agentStatusUpdates: [
				{
					agentId: "ui-agent",
					status: "complete",
					lastTouchedFile: "src/Dashboard.tsx",
				},
			],
			agentActivities: [
				{
					agentId: "ui-agent",
					kind: "tool",
					message: "Applying a diff to src/Dashboard.tsx.",
					ts: 1,
				},
			],
		}

		renderWithExtensionState(<AgentStatusPanel tool={tool} />, undefined)

		expect(screen.getByTestId("agent-activity")).toHaveTextContent("Completed.")
		expect(screen.getByTestId("agent-activity")).not.toHaveTextContent("Applying a diff")
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

import React from "react"
import { cleanup, fireEvent, render, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"
import type { ClineMessage, ClineSayTool } from "@roo-code/types"

const { getStateMock, postMessageMock, setStateMock } = vi.hoisted(() => ({
	getStateMock: vi.fn(() => undefined),
	postMessageMock: vi.fn(),
	setStateMock: vi.fn((state) => state),
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		getState: getStateMock,
		postMessage: postMessageMock,
		setState: setStateMock,
	},
}))

vi.mock("@src/components/agents/AgentStatusPanel", () => ({
	AgentStatusPanel: ({ tool }: { tool: ClineSayTool }) => (
		<section data-testid="agent-status-panel">{tool.executionPlan?.planId}</section>
	),
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { exists: () => true },
	}),
	Trans: ({ i18nKey }: { i18nKey?: string }) => <>{i18nKey}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

function renderChatRow(message: ClineMessage) {
	const queryClient = new QueryClient()

	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={message}
					isExpanded={false}
					isLast={false}
					isStreaming={false}
					onToggleExpand={() => {}}
					onSuggestionClick={() => {}}
					onBatchFileResponse={() => {}}
					onFollowUpUnmount={() => {}}
					isFollowUpAnswered={false}
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatRow - memory tools", () => {
	beforeEach(() => {
		getStateMock.mockClear()
		postMessageMock.mockClear()
		setStateMock.mockClear()
	})

	afterEach(() => {
		cleanup()
	})

	it("renders pending mistake memory cards and posts direct approval/archive actions", () => {
		const message: ClineMessage = {
			type: "say",
			say: "tool",
			ts: 123456,
			text: JSON.stringify({
				tool: "mistakeMemory",
				content: "Read terminal output before retrying failed commands.",
				memoryId: "mem_123",
				candidateId: "cand_123",
				scope: "workspace",
				status: "pending",
				title: "Mistake lesson for execute_command",
				tags: ["validation", "mistake"],
				pathTags: ["src/core/task/Task.ts"],
				mode: "code",
				toolName: "execute_command",
				mistakeSignature: "mistake:abc123",
				message: "Saved pending mistake-memory candidate for user review.",
			} satisfies ClineSayTool),
		}

		renderChatRow(message)

		expect(screen.getByText("chat:mistakeMemory.savedPending")).toBeInTheDocument()
		expect(screen.getAllByText("Mistake lesson for execute_command").length).toBeGreaterThan(0)
		expect(screen.getByText("Read terminal output before retrying failed commands.")).toBeInTheDocument()
		expect(screen.getByText("Saved pending mistake-memory candidate for user review.")).toBeInTheDocument()
		expect(screen.getAllByText("chat:memory.scopes.workspace").length).toBeGreaterThan(0)
		expect(screen.getAllByText("chat:memory.statuses.pending").length).toBeGreaterThan(0)
		expect(screen.getAllByText("validation").length).toBeGreaterThan(0)
		expect(screen.getAllByText("src/core/task/Task.ts").length).toBeGreaterThan(0)
		expect(screen.getAllByText("code").length).toBeGreaterThan(0)
		expect(screen.getAllByText("execute_command").length).toBeGreaterThan(0)
		expect(screen.getByText("mistake:abc123")).toBeInTheDocument()

		postMessageMock.mockClear()
		fireEvent.click(screen.getByRole("button", { name: "chat:mistakeMemory.approveAction" }))

		expect(postMessageMock).toHaveBeenCalledWith({
			type: "memoryAction",
			memoryAction: "approveMemory",
			memoryId: "mem_123",
			memoryScope: "workspace",
			messageTs: 123456,
		})

		postMessageMock.mockClear()
		fireEvent.click(screen.getByRole("button", { name: "chat:mistakeMemory.archiveAction" }))

		expect(postMessageMock).toHaveBeenCalledWith({
			type: "memoryAction",
			memoryAction: "archiveMemory",
			memoryId: "mem_123",
			memoryScope: "workspace",
			messageTs: 123456,
		})
	})

	it("renders active mistake memory confirmations without pending actions", () => {
		const message: ClineMessage = {
			type: "say",
			say: "tool",
			ts: 987654,
			text: JSON.stringify({
				tool: "mistakeMemory",
				content: "Prefer cached settings state until Save is clicked.",
				memoryId: "mem_active",
				scope: "global",
				status: "active",
				title: "Saved settings lesson",
				autoApproved: true,
				reusedExisting: true,
				message: "Saved auto-approved active mistake memory.",
			} satisfies ClineSayTool),
		}

		renderChatRow(message)

		expect(screen.getByText("chat:mistakeMemory.savedActive")).toBeInTheDocument()
		expect(screen.getAllByText("Saved settings lesson").length).toBeGreaterThan(0)
		expect(screen.getByText("Saved auto-approved active mistake memory.")).toBeInTheDocument()
		expect(screen.getByText("chat:mistakeMemory.autoApproved")).toBeInTheDocument()
		expect(screen.getByText("chat:mistakeMemory.reusedExisting")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "chat:mistakeMemory.approveAction" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "chat:mistakeMemory.archiveAction" })).not.toBeInTheDocument()
	})

	it("renders memory search results with rich result metadata", () => {
		const message: ClineMessage = {
			type: "say",
			say: "tool",
			ts: 111222,
			text: JSON.stringify({
				tool: "memorySearch",
				query: "cached settings",
				scope: "all",
				status: "all",
				memoryResults: [
					{
						id: "mem_result",
						scope: "workspace",
						kind: "lesson",
						status: "active",
						title: "Settings cached-state lesson",
						lesson: "Settings inputs must bind to cached state.",
						tags: ["settings"],
						pathTags: ["webview-ui/src/components/settings/SettingsView.tsx"],
						mode: "code",
						toolName: "apply_patch",
						mistakeSignature: "mistake:def456",
						score: 0.8754,
					},
				],
			} satisfies ClineSayTool),
		}

		renderChatRow(message)

		expect(screen.getByText("chat:memorySearch.wantsToSearch")).toBeInTheDocument()
		expect(screen.getByText("chat:memorySearch.resultsFound")).toBeInTheDocument()
		expect(screen.getAllByText("Settings cached-state lesson").length).toBeGreaterThan(0)
		expect(screen.getByText("Settings inputs must bind to cached state.")).toBeInTheDocument()
		expect(screen.getAllByText("chat:memory.scopes.workspace").length).toBeGreaterThan(0)
		expect(screen.getAllByText("chat:memory.statuses.active").length).toBeGreaterThan(0)
		expect(screen.getAllByText("settings").length).toBeGreaterThan(0)
		expect(screen.getAllByText("webview-ui/src/components/settings/SettingsView.tsx").length).toBeGreaterThan(0)
		expect(screen.getAllByText("apply_patch").length).toBeGreaterThan(0)
		expect(screen.getByText("mistake:def456")).toBeInTheDocument()
		expect(
			screen.getByText((_, element) => element?.textContent === "chat:memory.fields.score: 0.8754"),
		).toBeInTheDocument()
	})

	it("renders pending memory wipe approval cards", () => {
		const message: ClineMessage = {
			type: "ask",
			ask: "tool",
			ts: 333444,
			text: JSON.stringify({
				tool: "memoryWipe",
				scope: "all",
				memoryWipeStatus: "pending",
				message: "Roo wants to wipe workspace and global memory. This cannot be undone.",
			} satisfies ClineSayTool),
		}

		renderChatRow(message)

		expect(screen.getByText("chat:memoryWipe.statusTitle.pending")).toBeInTheDocument()
		expect(
			screen.getByText("Roo wants to wipe workspace and global memory. This cannot be undone."),
		).toBeInTheDocument()
		expect(screen.getAllByText("chat:memory.scopes.all").length).toBeGreaterThan(0)
		expect(screen.getAllByText("chat:memoryWipe.status.pending").length).toBeGreaterThan(0)
		expect(screen.getByText("chat:memoryWipe.fields.scope")).toBeInTheDocument()
		expect(screen.getByText("chat:memoryWipe.fields.status")).toBeInTheDocument()
	})

	it("renders completed memory wipe cards with deleted scopes", () => {
		const message: ClineMessage = {
			type: "say",
			say: "tool",
			ts: 444555,
			text: JSON.stringify({
				tool: "memoryWipe",
				scope: "all",
				memoryWipeStatus: "completed",
				deletedScopes: ["workspace", "global"],
				message: "Wiped workspace and global memory.",
			} satisfies ClineSayTool),
		}

		renderChatRow(message)

		expect(screen.getByText("chat:memoryWipe.statusTitle.completed")).toBeInTheDocument()
		expect(screen.getByText("Wiped workspace and global memory.")).toBeInTheDocument()
		expect(screen.getAllByText("chat:memoryWipe.status.completed").length).toBeGreaterThan(0)
		expect(screen.getByText("chat:memoryWipe.fields.deletedScopes")).toBeInTheDocument()
		expect(screen.getByText("chat:memory.scopes.workspace, chat:memory.scopes.global")).toBeInTheDocument()
	})

	it("renders cancelled memory wipe cards", () => {
		const message: ClineMessage = {
			type: "say",
			say: "tool",
			ts: 555666,
			text: JSON.stringify({
				tool: "memoryWipe",
				scope: "global",
				memoryWipeStatus: "cancelled",
				message: "Memory wipe cancelled. No memories were deleted.",
			} satisfies ClineSayTool),
		}

		renderChatRow(message)

		expect(screen.getByText("chat:memoryWipe.statusTitle.cancelled")).toBeInTheDocument()
		expect(screen.getByText("Memory wipe cancelled. No memories were deleted.")).toBeInTheDocument()
		expect(screen.getAllByText("chat:memory.scopes.global").length).toBeGreaterThan(0)
		expect(screen.getAllByText("chat:memoryWipe.status.cancelled").length).toBeGreaterThan(0)
	})
})

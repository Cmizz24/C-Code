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
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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

describe("ChatRow - Visual Browser Inspector tool", () => {
	beforeEach(() => {
		getStateMock.mockClear()
		postMessageMock.mockClear()
		setStateMock.mockClear()
	})

	afterEach(() => {
		cleanup()
	})

	it("renders running native VBI ask tool rows with safe local artifact context", () => {
		const message: ClineMessage = {
			type: "ask",
			ask: "tool",
			ts: Date.now(),
			partial: true,
			text: JSON.stringify({
				tool: "visualBrowserInspector",
				action: "visual_browser_capture",
				visualBrowserStatus: "running",
				sessionId: "session-1",
				url: "http://localhost:3000",
				screenshotId: "shot-1",
				toolCallId: "tool-call-1",
			}),
		}

		renderChatRow(message)

		expect(screen.getByText("Visual Browser Inspector Running")).toBeInTheDocument()
		expect(screen.getAllByText("Capture screenshot").length).toBeGreaterThan(0)
		expect(screen.getByText("session-1")).toBeInTheDocument()
		expect(screen.getByText("http://localhost:3000")).toBeInTheDocument()
		expect(screen.getByText(".roo/visual-browser-inspector")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Open Visual Browser Inspector/ })).toBeInTheDocument()
	})

	it("renders completed VBI say tool rows and sends an open-panel focus request", () => {
		const message: ClineMessage = {
			type: "say",
			say: "tool",
			ts: Date.now(),
			text: JSON.stringify({
				tool: "visualBrowserInspector",
				action: "visual_browser_analyze_crop",
				visualBrowserStatus: "complete",
				visualBrowserResult: {
					action: "visual_browser_analyze_crop",
					message: "Analyzed crop.",
					session: {
						sessionId: "session-1",
						url: "http://localhost:3000",
					},
					crop: {
						cropId: "crop-1",
						screenshotId: "shot-1",
					},
					analysis: {
						summary: "One accessibility issue found.",
						recommendationSummary: "Increase contrast before shipping.",
						issues: [{ title: "Low contrast" }],
					},
				},
				toolCallId: "tool-call-1",
			}),
		}

		renderChatRow(message)

		expect(screen.getByText("Visual Browser Inspector Completed")).toBeInTheDocument()
		expect(screen.getByText("One accessibility issue found.")).toBeInTheDocument()
		expect(screen.getByText("shot-1")).toBeInTheDocument()
		expect(screen.getByText("crop-1")).toBeInTheDocument()

		postMessageMock.mockClear()
		fireEvent.click(screen.getByRole("button", { name: /Open Visual Browser Inspector/ }))

		expect(postMessageMock).toHaveBeenCalledWith({
			type: "visualBrowserInspector",
			payload: {
				action: "open_panel",
				sessionId: "session-1",
				screenshotId: "shot-1",
				cropId: "crop-1",
			},
		})
	})
})

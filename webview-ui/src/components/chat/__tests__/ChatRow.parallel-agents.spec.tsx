import React from "react"
import { render, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"
import type { ClineMessage, ClineSayTool } from "@roo-code/types"

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

const queryClient = new QueryClient()

function renderChatRow(message: ClineMessage) {
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

describe("ChatRow - parallelAgents tool", () => {
	it("renders persisted parallelAgents say tool messages with AgentStatusPanel", () => {
		const message: ClineMessage = {
			type: "say",
			say: "tool",
			ts: Date.now(),
			text: JSON.stringify({
				tool: "parallelAgents",
				executionPlan: {
					planId: "plan-chat-row",
					sharedContext: "shared",
					fileOwnershipMap: {},
					createdAt: 12345,
					agents: [
						{
							id: "agent-1",
							mode: "code",
							task: "Build UI",
							owns: [{ path: "src/ui.tsx", mode: "exclusive" }],
							mustNotTouch: [],
							dependsOn: [],
							worktreePath: "",
							status: "running",
							signals: [],
						},
					],
				},
				parallelStatus: "running",
			}),
		}

		renderChatRow(message)

		expect(screen.getByTestId("agent-status-panel")).toHaveTextContent("plan-chat-row")
	})
})

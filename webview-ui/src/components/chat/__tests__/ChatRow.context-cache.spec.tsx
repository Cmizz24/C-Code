import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { ClineMessage, ContextCacheEvent } from "@roo-code/types"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"

import { ChatRowContent } from "../ChatRow"

const { getStateMock, postMessageMock, setStateMock } = vi.hoisted(() => ({
	getStateMock: vi.fn(),
	postMessageMock: vi.fn(),
	setStateMock: vi.fn(),
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		getState: getStateMock,
		postMessage: postMessageMock,
		setState: setStateMock,
	},
}))

vi.mock("@src/components/agents/AgentStatusPanel", () => ({
	AgentStatusPanel: () => <div data-testid="agent-status-panel" />,
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => {
			if (key === "chat:contextManagement.contextCache.summary.chunks") {
				return `${options?.count} chunks`
			}
			if (key === "chat:contextManagement.tokens") {
				return "tokens"
			}
			return key
		},
		i18n: { exists: () => true },
	}),
	Trans: ({ children, i18nKey }: { children?: React.ReactNode; i18nKey?: string }) => <>{children ?? i18nKey}</>,
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

function contextCacheMessage(event: ContextCacheEvent): ClineMessage {
	return {
		type: "say",
		say: "context_cache_event",
		ts: 111222,
		contextCacheEvent: event,
	}
}

describe("ChatRow - context cache events", () => {
	beforeEach(() => {
		getStateMock.mockReturnValue({})
		postMessageMock.mockClear()
		setStateMock.mockClear()
	})

	it.each(["chunks_moved_to_cold", "chunks_pulled_from_cold", "condensing_avoided", "cold_cache_full"] as const)(
		"renders %s context cache event rows",
		(type) => {
			renderChatRow(
				contextCacheMessage({
					id: `${type}-event`,
					createdAt: 123,
					type,
					chunkCount: 2,
					tokenCount: 400,
					ramUsedMb: 1024,
					ramBudgetMb: 2048,
				}),
			)

			const row = screen.getByTestId("context-cache-event-row")
			expect(row).toBeInTheDocument()
			expect(screen.getByText(`chat:contextManagement.contextCache.titles.${type}`)).toBeInTheDocument()
			expect(row).toHaveTextContent("2 chunks · 400 tokens")
		},
	)

	it("expands context cache event details", () => {
		renderChatRow(
			contextCacheMessage({
				id: "pull-event",
				createdAt: 123,
				type: "chunks_pulled_from_cold",
				chunkCount: 1,
				tokenCount: 200,
				ramUsedMb: 512,
				ramBudgetMb: 2048,
				query: "beta feature",
				filePath: "src/example.ts",
				warning: "Cold cache full — falling back to condensing",
			}),
		)

		fireEvent.click(screen.getByText("chat:contextManagement.contextCache.titles.chunks_pulled_from_cold"))

		expect(
			screen.getByText("chat:contextManagement.contextCache.descriptions.chunks_pulled_from_cold"),
		).toBeInTheDocument()
		expect(screen.getByText("chat:contextManagement.contextCache.details.chunks")).toBeInTheDocument()
		expect(screen.getByText("chat:contextManagement.contextCache.details.tokens")).toBeInTheDocument()
		expect(screen.getByText("chat:contextManagement.contextCache.details.ram")).toBeInTheDocument()
		expect(screen.getByText("512MB / 2GB")).toBeInTheDocument()
		expect(screen.getByText("beta feature")).toBeInTheDocument()
		expect(screen.getByText("src/example.ts")).toBeInTheDocument()
		expect(screen.getByText("Cold cache full — falling back to condensing")).toBeInTheDocument()
	})
})

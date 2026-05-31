import { act, cleanup, render, screen } from "@testing-library/react"

import AppWithProviders from "../App"

vi.mock("@src/components/chat/ChatView", () => ({
	__esModule: true,
	default: function ChatView({ isHidden }: { isHidden: boolean }) {
		return (
			<div data-testid="chat-view" data-hidden={isHidden}>
				Chat View
			</div>
		)
	},
}))

vi.mock("@src/components/history/HistoryView", () => ({
	__esModule: true,
	default: function HistoryView() {
		return <div data-testid="history-view">History View</div>
	},
}))

vi.mock("@src/components/settings/SettingsView", () => ({
	__esModule: true,
	default: function SettingsView() {
		return <div data-testid="settings-view">Settings View</div>
	},
}))

vi.mock("@src/components/welcome/WelcomeViewProvider", () => ({
	__esModule: true,
	default: function WelcomeViewProvider() {
		return <div data-testid="welcome-view">Welcome View</div>
	},
}))

vi.mock("@src/components/chat/CheckpointRestoreDialog", () => ({
	CheckpointRestoreDialog: () => null,
}))

vi.mock("@src/components/chat/MessageModificationConfirmationDialog", () => ({
	DeleteMessageDialog: () => null,
	EditMessageDialog: () => null,
}))

vi.mock("@src/components/agents/PlanPreviewModal", () => ({
	PlanPreviewModal: () => null,
}))

vi.mock("@src/utils/sourceMapInitializer", () => ({
	initializeSourceMaps: vi.fn(),
	exposeSourceMapsForDebugging: vi.fn(),
}))

describe("App provider composition", () => {
	afterEach(() => {
		cleanup()
	})

	it("mounts TranslationProvider inside the live ExtensionStateContextProvider during startup", async () => {
		render(<AppWithProviders />)

		expect(
			screen.queryByText(/useExtensionState must be used within an ExtensionStateContextProvider/),
		).not.toBeInTheDocument()
		expect(screen.queryByText("errorBoundary.title")).not.toBeInTheDocument()

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "state",
						state: {
							apiConfiguration: {
								apiProvider: "anthropic",
								apiKey: "test-api-key",
							},
							version: "test-version",
							clineMessages: [],
							taskHistory: [],
							shouldShowAnnouncement: false,
							language: "en",
						},
					},
				}),
			)
		})

		expect(await screen.findByTestId("chat-view")).toBeInTheDocument()
		expect(
			screen.queryByText(/useExtensionState must be used within an ExtensionStateContextProvider/),
		).not.toBeInTheDocument()
	})
})

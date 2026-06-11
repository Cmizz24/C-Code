import { act, cleanup, render, screen } from "@testing-library/react"

import AppWithProviders from "../App"

const postMessageMock = vi.hoisted(() => vi.fn())

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: postMessageMock,
	},
}))

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: postMessageMock,
	},
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		i18n: {
			t: (key: string, options?: Record<string, unknown>) => {
				if (typeof options?.count === "number") {
					return `${key}:${options.count}`
				}

				return key
			},
			changeLanguage: vi.fn(),
		},
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => <>{children || i18nKey}</>,
	withTranslation: () => (Component: React.ComponentType<any>) => {
		const WrappedComponent = (props: any) => <Component {...props} t={(key: string) => key} />
		WrappedComponent.displayName = `withTranslation(${Component.displayName || Component.name || "Component"})`

		return WrappedComponent
	},
}))

vi.mock("@src/i18n/setup", () => ({
	default: {
		language: "en",
		t: (key: string) => key,
		changeLanguage: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
	},
	loadTranslations: vi.fn(),
}))

vi.mock("@src/utils/sourceMapInitializer", () => ({
	initializeSourceMaps: vi.fn(),
	exposeSourceMapsForDebugging: vi.fn(),
}))

vi.mock("use-sound", () => ({
	default: () => [vi.fn()],
}))

vi.mock("@src/components/history/HistoryView", () => ({
	__esModule: true,
	default: () => <div data-testid="history-view" />,
}))

vi.mock("@src/components/settings/SettingsView", () => ({
	__esModule: true,
	default: () => <div data-testid="settings-view" />,
}))

vi.mock("@src/components/welcome/WelcomeViewProvider", () => ({
	__esModule: true,
	default: () => <div data-testid="welcome-view" />,
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

vi.mock("@src/components/chat/ChatRow", () => ({
	__esModule: true,
	default: ({ message }: { message: unknown }) => <div data-testid="chat-row">{JSON.stringify(message)}</div>,
}))

vi.mock("react-virtuoso", () => ({
	Virtuoso: ({
		data = [],
		itemContent,
	}: {
		data?: unknown[]
		itemContent: (index: number, item: unknown) => React.ReactNode
	}) => (
		<div data-testid="virtuoso-item-list">
			{data.map((item, index) => (
				<div key={index} data-testid={`virtuoso-item-${index}`}>
					{itemContent(index, item)}
				</div>
			))}
		</div>
	),
}))

vi.mock("@src/components/common/VersionIndicator", () => ({
	__esModule: true,
	default: () => null,
}))

vi.mock("@src/components/chat/Announcement", () => ({
	__esModule: true,
	default: () => <div data-testid="announcement-modal" />,
}))

vi.mock("@src/components/common/DismissibleUpsell", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <div data-testid="dismissible-upsell">{children}</div>,
}))

vi.mock("@src/components/chat/QueuedMessages", () => ({
	QueuedMessages: () => null,
}))

vi.mock("@src/components/welcome/RooTips", () => ({
	__esModule: true,
	default: () => <div data-testid="roo-tips" />,
}))

vi.mock("@src/components/welcome/RooHero", () => ({
	__esModule: true,
	default: () => <div data-testid="roo-hero" />,
}))

vi.mock("@src/components/chat/ApiConfigSelector", () => ({
	ApiConfigSelector: () => <div data-testid="api-config-selector" />,
}))

vi.mock("@src/components/chat/ContextMenu", () => ({
	__esModule: true,
	default: () => null,
}))

vi.mock("@src/components/chat/IndexingStatusBadge", () => ({
	IndexingStatusBadge: () => <div data-testid="indexing-status-badge" />,
}))

vi.mock("@src/components/chat/ModeSelector", () => ({
	ModeSelector: () => <div data-testid="mode-selector" />,
}))

vi.mock("@src/components/common/Thumbnails", () => ({
	__esModule: true,
	default: () => <div data-testid="thumbnails" />,
}))

const hydrateStartupState = () => {
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
}

describe("App startup auto-approval path", () => {
	beforeEach(() => {
		const portalContainer = document.createElement("div")
		portalContainer.id = "roo-portal"
		document.body.appendChild(portalContainer)
	})

	afterEach(() => {
		cleanup()
		document.getElementById("roo-portal")?.remove()
		postMessageMock.mockClear()
	})

	it("hydrates through App, ChatView, ChatTextArea, AutoApproveDropdown, and useAutoApprovalToggles", async () => {
		render(<AppWithProviders />)

		hydrateStartupState()

		expect(await screen.findByTestId("auto-approve-dropdown-trigger")).toBeInTheDocument()
		expect(
			screen.queryByText(/useExtensionState must be used within an ExtensionStateContextProvider/),
		).not.toBeInTheDocument()
		expect(screen.queryByText("errorBoundary.title")).not.toBeInTheDocument()
	})
})

import { cleanup, render, screen } from "@testing-library/react"

import { defaultModeSlug } from "@roo/modes"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import TranslationProvider from "@src/i18n/TranslationContext"
import { TooltipProvider } from "@src/components/ui"

import { ChatTextArea } from "../ChatTextArea"

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
}))

vi.mock("@src/i18n/setup", () => ({
	default: {
		t: (key: string) => key,
		changeLanguage: vi.fn(),
	},
	loadTranslations: vi.fn(),
}))

vi.mock("../ApiConfigSelector", () => ({
	ApiConfigSelector: () => <div data-testid="api-config-selector" />,
}))

vi.mock("../ContextMenu", () => ({
	default: () => null,
}))

vi.mock("../ChatView", () => ({
	MAX_IMAGES_PER_MESSAGE: 20,
}))

vi.mock("../IndexingStatusBadge", () => ({
	IndexingStatusBadge: () => <div data-testid="indexing-status-badge" />,
}))

vi.mock("../ModeSelector", () => ({
	ModeSelector: () => <div data-testid="mode-selector" />,
}))

vi.mock("../../common/Thumbnails", () => ({
	default: () => <div data-testid="thumbnails" />,
}))

const defaultProps = {
	inputValue: "",
	setInputValue: vi.fn(),
	onSend: vi.fn(),
	sendingDisabled: false,
	selectApiConfigDisabled: false,
	onSelectImages: vi.fn(),
	shouldDisableImages: false,
	placeholderText: "Type a message...",
	selectedImages: [] as string[],
	setSelectedImages: vi.fn(),
	onHeightChange: vi.fn(),
	mode: defaultModeSlug,
	setMode: vi.fn(),
	modeShortcutText: "(⌘. for next mode)",
}

const renderWithStartupProviders = () => {
	const portalContainer = document.createElement("div")
	portalContainer.id = "roo-portal"
	document.body.appendChild(portalContainer)

	return render(
		<ExtensionStateContextProvider>
			<TranslationProvider>
				<TooltipProvider>
					<ChatTextArea {...defaultProps} />
				</TooltipProvider>
			</TranslationProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatTextArea provider composition", () => {
	afterEach(() => {
		cleanup()
		document.getElementById("roo-portal")?.remove()
		postMessageMock.mockClear()
	})

	it("renders the real AutoApproveDropdown path under the live ExtensionStateContextProvider", () => {
		expect(() => renderWithStartupProviders()).not.toThrow(
			"useExtensionState must be used within an ExtensionStateContextProvider",
		)

		expect(screen.getByTestId("auto-approve-dropdown-trigger")).toBeInTheDocument()
	})
})

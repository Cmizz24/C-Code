// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/ChatView.spec.tsx

import React from "react"
import { render, waitFor, act, fireEvent, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import ChatView, { ChatViewProps } from "../ChatView"

// Define minimal types needed for testing
interface ClineMessage {
	type: "say" | "ask"
	say?: string
	ask?: string
	ts: number
	text?: string
	partial?: boolean
}

interface ExtensionState {
	version: string
	clineMessages: ClineMessage[]
	taskHistory: any[]
	shouldShowAnnouncement: boolean
	allowedCommands: string[]
	alwaysAllowExecute: boolean
	[key: string]: any
}

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock use-sound hook
const mockPlayFunction = vi.fn()
vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => {
		return [mockPlayFunction]
	}),
}))

// Mock components that use ESM dependencies
vi.mock("../ChatRow", () => ({
	default: function MockChatRow({ message }: { message: ClineMessage }) {
		if (message.type === "say" && message.say === "tool" && message.text) {
			try {
				const tool = JSON.parse(message.text)

				if (tool.tool === "parallelAgents") {
					return <section data-testid="agent-status-chat-card">Parallel agents status</section>
				}
			} catch {
				// Fall through to the generic chat row mock for malformed tool payloads.
			}
		}

		return <div data-testid="chat-row">{JSON.stringify(message)}</div>
	},
}))

vi.mock("@src/components/agents/AgentStatusPanel", () => ({
	AgentStatusPanel: function MockAgentStatusPanel() {
		return <section data-testid="agent-status-chat-card">Parallel agents status</section>
	},
}))

vi.mock("../AutoApproveMenu", () => ({
	default: () => null,
}))

// Mock react-virtuoso to render items directly without virtualization
// This allows tests to verify items rendered in the chat list
vi.mock("react-virtuoso", () => ({
	Virtuoso: function MockVirtuoso({
		data,
		itemContent,
	}: {
		data: ClineMessage[]
		itemContent: (index: number, item: ClineMessage) => React.ReactNode
	}) {
		return (
			<div data-testid="virtuoso-item-list">
				{data.map((item, index) => (
					<div key={item.ts} data-testid={`virtuoso-item-${index}`}>
						{itemContent(index, item)}
					</div>
				))}
			</div>
		)
	},
}))

// Mock VersionIndicator - returns null by default to prevent rendering in tests
vi.mock("../../common/VersionIndicator", () => ({
	default: vi.fn(() => null),
}))

// Get the mock function after the module is mocked
const mockVersionIndicator = vi.mocked((await import("../../common/VersionIndicator")).default)

vi.mock("../Announcement", () => ({
	default: function MockAnnouncement({ hideAnnouncement }: { hideAnnouncement: () => void }) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const React = require("react")
		return React.createElement(
			"div",
			{ "data-testid": "announcement-modal" },
			React.createElement("div", null, "What's New"),
			React.createElement("button", { onClick: hideAnnouncement }, "Close"),
		)
	},
}))

// Mock DismissibleUpsell component
vi.mock("@/components/common/DismissibleUpsell", () => ({
	default: function MockDismissibleUpsell({ children }: { children: React.ReactNode }) {
		return <div data-testid="dismissible-upsell">{children}</div>
	},
}))

// Mock QueuedMessages component
vi.mock("../QueuedMessages", () => ({
	QueuedMessages: function MockQueuedMessages({
		queue = [],
		onRemove,
	}: {
		queue?: Array<{ id: string; text: string; images?: string[] }>
		onRemove?: (index: number) => void
		onUpdate?: (index: number, newText: string) => void
	}) {
		if (!queue || queue.length === 0) {
			return null
		}
		return (
			<div data-testid="queued-messages">
				{queue.map((msg, index) => (
					<div key={msg.id}>
						<span>{msg.text}</span>
						<button aria-label="Remove message" onClick={() => onRemove?.(index)}>
							Remove
						</button>
					</div>
				))}
			</div>
		)
	},
}))

// Mock RooTips component
vi.mock("@src/components/welcome/RooTips", () => ({
	default: function MockRooTips() {
		return <div data-testid="roo-tips">Tips content</div>
	},
}))

// Mock RooHero component
vi.mock("@src/components/welcome/RooHero", () => ({
	default: function MockRooHero() {
		return <div data-testid="roo-hero">Hero content</div>
	},
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: any) => {
			if (key === "chat:versionIndicator.ariaLabel" && options?.version) {
				return `Version ${options.version}`
			}
			return key
		},
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => {
		return <>{children || i18nKey}</>
	},
}))

interface ChatTextAreaProps {
	onSend: () => void
	onStop?: () => void
	inputValue?: string
	setInputValue?: (value: string) => void
	sendingDisabled?: boolean
	placeholderText?: string
	selectedImages?: string[]
	shouldDisableImages?: boolean
	isStreaming?: boolean
}

const mockInputRef = React.createRef<HTMLInputElement>()
const mockFocus = vi.fn()

vi.mock("../ChatTextArea", () => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const mockReact = require("react")

	const ChatTextAreaComponent = mockReact.forwardRef(function MockChatTextArea(
		props: ChatTextAreaProps,
		ref: React.ForwardedRef<{ focus: () => void }>,
	) {
		// Use useImperativeHandle to expose the mock focus method
		mockReact.useImperativeHandle(ref, () => ({
			focus: mockFocus,
		}))

		return (
			<div data-testid="chat-textarea">
				<button
					type="button"
					data-testid="chat-textarea-send-stop"
					onClick={props.isStreaming ? props.onStop : props.onSend}>
					{props.isStreaming ? "stop" : "send"}
				</button>
				<input
					ref={mockInputRef}
					type="text"
					value={props.inputValue || ""}
					onChange={(e) => {
						// Use parent's setInputValue if available
						if (props.setInputValue) {
							props.setInputValue(e.target.value)
						}
					}}
					onKeyDown={(e) => {
						// Only call onSend when Enter is pressed (simulating real behavior)
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault()
							props.onSend()
						}
					}}
					data-sending-disabled={props.sendingDisabled}
				/>
			</div>
		)
	})

	return {
		default: ChatTextAreaComponent,
		ChatTextArea: ChatTextAreaComponent, // Export as named export too
	}
})

// Mock VSCode components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: function MockVSCodeButton({
		children,
		onClick,
		appearance,
	}: {
		children: React.ReactNode
		onClick?: () => void
		appearance?: string
	}) {
		return (
			<button onClick={onClick} data-appearance={appearance}>
				{children}
			</button>
		)
	},
	VSCodeTextField: function MockVSCodeTextField({
		value,
		onInput,
		placeholder,
	}: {
		value?: string
		onInput?: (e: { target: { value: string } }) => void
		placeholder?: string
	}) {
		return (
			<input
				type="text"
				value={value}
				onChange={(e) => onInput?.({ target: { value: e.target.value } })}
				placeholder={placeholder}
			/>
		)
	},
	VSCodeLink: function MockVSCodeLink({ children, href }: { children: React.ReactNode; href?: string }) {
		return <a href={href}>{children}</a>
	},
}))

// Mock window.postMessage to trigger state hydration
const mockPostMessage = (state: Partial<ExtensionState>) => {
	window.postMessage(
		{
			type: "state",
			state: {
				version: "1.0.0",
				clineMessages: [],
				taskHistory: [],
				shouldShowAnnouncement: false,
				allowedCommands: [],
				alwaysAllowExecute: false,
				cloudIsAuthenticated: false,
				...state,
			},
		},
		"*",
	)
}

const defaultProps: ChatViewProps = {
	isHidden: false,
	showAnnouncement: false,
	hideAnnouncement: () => {},
}

const queryClient = new QueryClient()

const renderChatView = (props: Partial<ChatViewProps> = {}) => {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatView {...defaultProps} {...props} />
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatView - Sound Playing Tests", () => {
	beforeEach(() => vi.clearAllMocks())

	it("plays celebration sound for completion results", async () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Add completion result
		mockPostMessage({
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "completion_result",
					ts: Date.now(),
					text: "Task completed successfully",
					partial: false, // Ensure it's not partial
				},
			],
		})

		// Wait for sound to be played
		await waitFor(() => {
			expect(mockPlayFunction).toHaveBeenCalled()
		})
	})

	it("plays progress_loop sound for api failures", async () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Add API failure
		mockPostMessage({
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "api_req_failed",
					ts: Date.now(),
					text: "API request failed",
					partial: false, // Ensure it's not partial
				},
			],
		})

		// Wait for sound to be played
		await waitFor(() => {
			expect(mockPlayFunction).toHaveBeenCalled()
		})
	})

	it("does not play sound when resuming a task from history", () => {
		renderChatView()

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Hydrate state with a task that has a resumeTaskId (indicating it's resumed from history)
		mockPostMessage({
			resumeTaskId: "task-123",
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Resumed task",
				},
				{
					type: "ask",
					ask: "tool",
					ts: Date.now(),
					text: JSON.stringify({ tool: "readFile", path: "test.txt" }),
				},
			],
		})

		// Should not play sound when resuming from history
		expect(mockPlayFunction).not.toHaveBeenCalled()
	})

	it("does not play sound when resuming a completed task from history", () => {
		renderChatView()

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Hydrate state with a completed task that has a resumeTaskId
		mockPostMessage({
			resumeTaskId: "task-123",
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Resumed task",
				},
				{
					type: "ask",
					ask: "completion_result",
					ts: Date.now(),
					text: "Task completed",
				},
			],
		})

		// Should not play sound for completion when resuming from history
		expect(mockPlayFunction).not.toHaveBeenCalled()
	})
})

describe("ChatView - Focus Grabbing Tests", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does not grab focus when follow-up question presented", async () => {
		const { getByTestId } = renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Wait for the component to fully render and settle before clearing mocks
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Wait for the debounced focus effect to fire (50ms debounce + buffer for CI variability)
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100))
		})

		// Clear any initial calls after state has settled
		mockFocus.mockClear()

		// Add follow-up question
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "followup",
					ts: Date.now(),
					text: "Should I continue?",
				},
			],
		})

		// Wait for state update to complete
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Should not grab focus for follow-up questions
		expect(mockFocus).not.toHaveBeenCalled()
	})
})

describe("ChatView - Completion Acceptance Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("notifies the backend once when the live parent completion Start New Task UI becomes visible", async () => {
		renderChatView()

		const taskTs = Date.now() - 2000
		const completionTs = Date.now()
		const completedState = {
			currentTaskItem: { id: "visible-parent-task" },
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: taskTs,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "completion_result",
					ts: completionTs,
					text: "Task complete",
					partial: false,
				},
			],
		} satisfies Partial<ExtensionState>

		act(() => {
			mockPostMessage(completedState)
		})

		await screen.findByRole("button", { name: "chat:startNewTask.title" })
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "taskCompletionUiVisible",
				taskId: "visible-parent-task",
				values: {
					ask: "completion_result",
					taskTs,
					completionTs,
				},
			})
		})

		const visibleNotificationCalls = vi
			.mocked(vscode.postMessage)
			.mock.calls.filter(([message]) => message.type === "taskCompletionUiVisible")

		act(() => {
			mockPostMessage(completedState)
		})

		expect(
			vi.mocked(vscode.postMessage).mock.calls.filter(([message]) => message.type === "taskCompletionUiVisible"),
		).toHaveLength(visibleNotificationCalls.length)
	})

	it("does not notify the backend for completed child task Start New Task UI", async () => {
		renderChatView()

		act(() => {
			mockPostMessage({
				currentTaskItem: { id: "child-task", parentTaskId: "parent-task" },
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial child task",
					},
					{
						type: "ask",
						ask: "completion_result",
						ts: Date.now(),
						text: "Child task complete",
						partial: false,
					},
				],
			})
		})

		await screen.findByRole("button", { name: "chat:startNewTask.title" })
		expect(vscode.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "taskCompletionUiVisible" }),
		)
	})

	it("does not notify the backend when reopening completed task history", async () => {
		renderChatView()

		act(() => {
			mockPostMessage({
				currentTaskItem: { id: "historical-completed-task" },
				clineMessages: [
					{
						type: "ask",
						ask: "resume_completed_task",
						ts: Date.now(),
						text: "Task complete",
					},
				],
			})
		})

		await screen.findByRole("button", { name: "chat:startNewTask.title" })
		expect(vscode.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "taskCompletionUiVisible" }),
		)
	})

	it("accepts a completion before starting a new task", async () => {
		renderChatView()

		act(() => {
			mockPostMessage({
				clineMessages: [
					{
						type: "ask",
						ask: "completion_result",
						ts: Date.now(),
						text: "Task complete",
					},
				],
			})
		})

		const startNewTaskButton = await screen.findByRole("button", { name: "chat:startNewTask.title" })

		fireEvent.click(startNewTaskButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "acceptCompletion" })
		expect(vscode.postMessage).not.toHaveBeenCalledWith({ type: "clearTask" })
	})

	it("clears a resumed completed task without re-accepting completion", async () => {
		renderChatView()

		act(() => {
			mockPostMessage({
				clineMessages: [
					{
						type: "ask",
						ask: "resume_completed_task",
						ts: Date.now(),
						text: "Task complete",
					},
				],
			})
		})

		const startNewTaskButton = await screen.findByRole("button", { name: "chat:startNewTask.title" })

		fireEvent.click(startNewTaskButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "clearTask" })
		expect(vscode.postMessage).not.toHaveBeenCalledWith({ type: "acceptCompletion" })
	})
})

describe("ChatView - Version Indicator Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Reset the mock to return null by default
		mockVersionIndicator.mockReturnValue(null)
	})

	it("displays version indicator button", () => {
		// Mock VersionIndicator to return a button
		mockVersionIndicator.mockReturnValue(
			React.createElement("button", {
				"data-testid": "version-indicator",
				"aria-label": "Version 1.0.0",
				className: "version-indicator-button",
			}),
		)

		const { getByTestId } = renderChatView()

		// Hydrate state with no active task
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		// Should display version indicator
		expect(getByTestId("version-indicator")).toBeInTheDocument()
	})

	it("opens announcement modal when version indicator is clicked", async () => {
		// Mock VersionIndicator to return a button with onClick
		mockVersionIndicator.mockImplementation(({ onClick }: { onClick?: () => void }) =>
			React.createElement("button", {
				"data-testid": "version-indicator",
				onClick,
			}),
		)

		const { getByTestId, queryByTestId } = renderChatView({ showAnnouncement: false })

		// Hydrate state
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		// Wait for component to render
		await waitFor(() => {
			expect(getByTestId("version-indicator")).toBeInTheDocument()
		})

		// Click version indicator
		const versionIndicator = getByTestId("version-indicator")
		act(() => {
			versionIndicator.click()
		})

		// Wait for announcement modal to appear
		await waitFor(() => {
			expect(queryByTestId("announcement-modal")).toBeInTheDocument()
		})
	})

	it("version indicator has correct styling classes", () => {
		// Mock VersionIndicator to return a button with specific classes
		mockVersionIndicator.mockReturnValue(
			React.createElement("button", {
				"data-testid": "version-indicator",
				className: "version-indicator-button absolute top-2 right-2",
			}),
		)

		const { getByTestId } = renderChatView()

		// Hydrate state
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		const versionIndicator = getByTestId("version-indicator")
		expect(versionIndicator.className).toContain("version-indicator-button")
		expect(versionIndicator.className).toContain("absolute")
		expect(versionIndicator.className).toContain("top-2")
		expect(versionIndicator.className).toContain("right-2")
	})

	it("version indicator has proper accessibility attributes", () => {
		// Mock VersionIndicator to return a button with aria-label
		mockVersionIndicator.mockReturnValue(
			React.createElement("button", {
				"data-testid": "version-indicator",
				"aria-label": "Version 1.0.0",
				role: "button",
			}),
		)

		const { getByTestId } = renderChatView()

		// Hydrate state
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		const versionIndicator = getByTestId("version-indicator")
		expect(versionIndicator.getAttribute("aria-label")).toBe("Version 1.0.0")
		expect(versionIndicator.getAttribute("role")).toBe("button")
	})

	it("does not display version indicator when there is an active task", () => {
		// Mock VersionIndicator to return null (simulating hidden state)
		mockVersionIndicator.mockReturnValue(null)

		const { queryByTestId } = renderChatView()

		// Hydrate state with active task
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now(),
					text: "Active task",
				},
			],
		})

		// Should not display version indicator during active task
		expect(queryByTestId("version-indicator")).not.toBeInTheDocument()
	})

	it("displays version indicator only on welcome screen (no task)", () => {
		// Mock VersionIndicator to return a button
		mockVersionIndicator.mockReturnValue(React.createElement("button", { "data-testid": "version-indicator" }))

		const { queryByTestId } = renderChatView()

		// Hydrate state with no active task
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		// Should display version indicator on welcome screen
		expect(queryByTestId("version-indicator")).toBeInTheDocument()
	})
})

describe("ChatView - Welcome Content Display Tests", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does not show removed cloud upsell for returning users", () => {
		const { queryByTestId } = renderChatView()

		mockPostMessage({
			taskHistory: [
				{ id: "1", ts: Date.now() - 3000 },
				{ id: "2", ts: Date.now() - 2000 },
				{ id: "3", ts: Date.now() - 1000 },
				{ id: "4", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		expect(queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
	})

	it("shows RooTips when user has only run 3 tasks in their history", () => {
		const { queryByTestId } = renderChatView()

		mockPostMessage({
			taskHistory: [
				{ id: "1", ts: Date.now() - 2000 },
				{ id: "2", ts: Date.now() - 1000 },
				{ id: "3", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		expect(queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
		expect(queryByTestId("roo-tips")).toBeInTheDocument()
	})

	it("does not show removed cloud upsell when user has run 6 or more tasks", async () => {
		const { queryByTestId } = renderChatView()

		mockPostMessage({
			taskHistory: [
				{ id: "1", ts: Date.now() - 6000 },
				{ id: "2", ts: Date.now() - 5000 },
				{ id: "3", ts: Date.now() - 4000 },
				{ id: "4", ts: Date.now() - 3000 },
				{ id: "5", ts: Date.now() - 2000 },
				{ id: "6", ts: Date.now() - 1000 },
				{ id: "7", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		await waitFor(() => {
			expect(queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
			expect(queryByTestId("roo-tips")).not.toBeInTheDocument()
			expect(queryByTestId("roo-hero")).toBeInTheDocument()
		})
	})

	it("does not show welcome content when there is an active task", async () => {
		const { queryByTestId } = renderChatView()

		mockPostMessage({
			taskHistory: [
				{ id: "1", ts: Date.now() - 3000 },
				{ id: "2", ts: Date.now() - 2000 },
				{ id: "3", ts: Date.now() - 1000 },
				{ id: "4", ts: Date.now() },
			],
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now(),
					text: "Active task",
				},
			],
		})

		await waitFor(() => {
			expect(queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
			expect(queryByTestId("roo-tips")).not.toBeInTheDocument()
			expect(queryByTestId("roo-hero")).not.toBeInTheDocument()
		})
	})

	it("shows RooTips for newer users", () => {
		const { queryByTestId, getByTestId } = renderChatView()

		mockPostMessage({
			taskHistory: [
				{ id: "1", ts: Date.now() - 3000 },
				{ id: "2", ts: Date.now() - 2000 },
				{ id: "3", ts: Date.now() - 1000 },
				{ id: "4", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		expect(queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
		expect(getByTestId("roo-tips")).toBeInTheDocument()
	})

	it("shows RooTips when user has fewer than 6 tasks", () => {
		const { queryByTestId, getByTestId } = renderChatView()

		mockPostMessage({
			taskHistory: [
				{ id: "1", ts: Date.now() - 2000 },
				{ id: "2", ts: Date.now() - 1000 },
				{ id: "3", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		expect(queryByTestId("dismissible-upsell")).not.toBeInTheDocument()
		expect(getByTestId("roo-tips")).toBeInTheDocument()
	})
})

describe("ChatView - Message Queueing Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Reset the mock to clear any initial calls
		vi.mocked(vscode.postMessage).mockClear()
	})

	it("shows sending is disabled when task is active", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with active task that should disable sending
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 1000,
					text: "Task in progress",
				},
				{
					type: "ask",
					ask: "tool",
					ts: Date.now(),
					text: JSON.stringify({ tool: "readFile", path: "test.txt" }),
					partial: true, // Partial messages disable sending
				},
			],
		})

		// Wait for state to be updated and check that sending is disabled
		await waitFor(() => {
			const chatTextArea = getByTestId("chat-textarea")
			const input = chatTextArea.querySelector("input")!
			expect(input.getAttribute("data-sending-disabled")).toBe("true")
		})
	})

	it("shows sending is enabled when no task is active", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with completed task
		mockPostMessage({
			clineMessages: [
				{
					type: "ask",
					ask: "completion_result",
					ts: Date.now(),
					text: "Task completed",
					partial: false,
				},
			],
		})

		// Wait for state to be updated
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Check that sending is enabled
		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")!
		expect(input.getAttribute("data-sending-disabled")).toBe("false")
	})

	it("queues messages when API request is in progress (spinner visible)", async () => {
		const { getByTestId } = renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		vi.mocked(vscode.postMessage).mockClear()

		// Add api_req_started without cost (spinner state - API request in progress)
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now(),
					text: JSON.stringify({ apiProtocol: "anthropic" }), // No cost = still streaming
				},
			],
		})

		// Wait for state to be updated
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Clear message calls before simulating user input
		vi.mocked(vscode.postMessage).mockClear()

		// Simulate user typing and sending a message during the spinner
		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		// Trigger message send by simulating typing and Enter key press
		await act(async () => {
			// Use fireEvent to properly trigger React's onChange handler
			fireEvent.change(input, { target: { value: "follow-up question during spinner" } })

			// Simulate pressing Enter to send
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		// Verify that the message was queued, not sent as askResponse
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "queueMessage",
				text: "follow-up question during spinner",
				images: [],
			})
		})

		// Verify it was NOT sent as a direct askResponse (which would get lost)
		expect(vscode.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({
				type: "askResponse",
				askResponse: "messageResponse",
			}),
		)
	})

	it("sends messages normally when API request is complete (cost present)", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with completed API request (cost present)
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now(),
					text: JSON.stringify({
						apiProtocol: "anthropic",
						cost: 0.05, // Cost present = streaming complete
						tokensIn: 100,
						tokensOut: 50,
					}),
				},
				{
					type: "say",
					say: "text",
					ts: Date.now(),
					text: "Response from API",
				},
			],
		})

		// Wait for state to be updated
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Clear message calls before simulating user input
		vi.mocked(vscode.postMessage).mockClear()

		// Simulate user sending a message when API is done
		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			// Use fireEvent to properly trigger React's onChange handler
			fireEvent.change(input, { target: { value: "follow-up after completion" } })

			// Simulate pressing Enter to send
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		// Verify that the message was sent as askResponse, not queued
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: "follow-up after completion",
				images: [],
			})
		})

		// Verify it was NOT queued
		expect(vscode.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({
				type: "queueMessage",
			}),
		)
	})

	it("preserves message order when messages sent during queue drain", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with API request in progress and existing queue
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now(),
					text: JSON.stringify({ apiProtocol: "anthropic" }), // No cost = still streaming
				},
			],
			messageQueue: [
				{ id: "msg1", text: "queued message 1", images: [] },
				{ id: "msg2", text: "queued message 2", images: [] },
			],
		})

		// Wait for state to be updated
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Clear message calls before simulating user input
		vi.mocked(vscode.postMessage).mockClear()

		// Simulate user sending a new message while queue has items
		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			fireEvent.change(input, { target: { value: "message during queue drain" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		// Verify that the new message was queued (not sent directly) to preserve order
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "queueMessage",
				text: "message during queue drain",
				images: [],
			})
		})

		// Verify it was NOT sent as askResponse (which would break ordering)
		expect(vscode.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({
				type: "askResponse",
				askResponse: "messageResponse",
			}),
		)
	})

	it("queues messages during command_output state instead of losing them", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with command_output ask (Proceed While Running state)
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "command_output",
					ts: Date.now(),
					text: "",
					partial: false, // Non-partial so buttons are enabled
				},
			],
		})

		// Wait for state to be updated - need to allow time for React effects to propagate
		// (clineAsk state update -> clineAskRef.current update)
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Allow React effects to complete (clineAsk -> clineAskRef sync)
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50))
		})

		// Clear message calls before simulating user input
		vi.mocked(vscode.postMessage).mockClear()

		// Simulate user typing and sending a message during command execution
		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")! as HTMLInputElement

		await act(async () => {
			fireEvent.change(input, { target: { value: "message during command execution" } })
			fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
		})

		// Verify that the message was queued (not lost via terminalOperation)
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "queueMessage",
				text: "message during command execution",
				images: [],
			})
		})

		// Verify it was NOT sent as terminalOperation (which would lose the message)
		expect(vscode.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({
				type: "terminalOperation",
			}),
		)
	})
})

describe("ChatView - Context Condensing Indicator Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should add a condensing message to groupedMessages when isCondensing is true", async () => {
		// This test verifies that when the condenseTaskContextStarted message is received,
		// the isCondensing state is set to true and a synthetic condensing message is added
		// to the grouped messages list
		const { getByTestId, container } = renderChatView()

		// First hydrate state with an active task
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now() - 1000,
					text: JSON.stringify({ apiProtocol: "anthropic" }),
				},
			],
		})

		// Wait for component to render
		await waitFor(() => {
			expect(getByTestId("chat-view")).toBeInTheDocument()
		})

		// Allow time for useEvent hook to register message listener
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10))
		})

		// Dispatch a MessageEvent directly to trigger the message handler
		// This simulates the VSCode extension sending a message to the webview
		await act(async () => {
			const event = new MessageEvent("message", {
				data: {
					type: "condenseTaskContextStarted",
					text: "test-task-id",
				},
			})
			window.dispatchEvent(event)
			// Wait for React state updates
			await new Promise((resolve) => setTimeout(resolve, 0))
		})

		// Check that groupedMessages now includes a condensing message
		// With Virtuoso mocked, items render directly and we can find the ChatRow with partial condense_context message
		await waitFor(
			() => {
				const rows = container.querySelectorAll('[data-testid="chat-row"]')
				// Check for the actual message structure: partial condense_context message
				const condensingRow = Array.from(rows).find((row) => {
					const text = row.textContent || ""
					return text.includes('"say":"condense_context"') && text.includes('"partial":true')
				})
				expect(condensingRow).toBeTruthy()
			},
			{ timeout: 2000 },
		)
	})
})

describe("ChatView - Parallel Agent Status Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	const createExecutionPlan = () => ({
		planId: "plan-chat-flow",
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
			{
				id: "agent-2",
				mode: "code",
				task: "Build styles",
				owns: [{ path: "src/styles.css", mode: "exclusive" }],
				mustNotTouch: [],
				dependsOn: [],
				worktreePath: "",
				status: "complete",
				signals: [],
			},
		],
	})

	const createParallelReviewMessage = (toolOverrides: Record<string, any> = {}, ts = Date.now()): ClineMessage => ({
		type: "say",
		say: "tool",
		ts,
		text: JSON.stringify({
			tool: "parallelAgents",
			executionPlan: createExecutionPlan(),
			parallelStatus: "review",
			mergeReviewEntries: [
				{
					agentId: "agent-1",
					mode: "code",
					task: "Build UI",
					diff: "diff --git a/src/ui.tsx b/src/ui.tsx\n+done\n",
					worktreePath: "/tmp/agent-1",
					branch: "roo/parallel/plan-chat-flow/agent-1",
					mergeStatus: "pending",
				},
				{
					agentId: "agent-2",
					mode: "code",
					task: "Build styles",
					diff: "diff --git a/src/styles.css b/src/styles.css\n+done\n",
					worktreePath: "/tmp/agent-2",
					branch: "roo/parallel/plan-chat-flow/agent-2",
					mergeStatus: "merged",
				},
			],
			...toolOverrides,
		}),
	})

	it("renders persisted parallel agent status as a native scrollable tool row", async () => {
		const { getByTestId, queryByTestId } = renderChatView()
		const executionPlan = createExecutionPlan()

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "text",
					ts: Date.now() - 1000,
					text: "Working on parallel plan",
				},
				{
					type: "say",
					say: "tool",
					ts: Date.now(),
					text: JSON.stringify({
						tool: "parallelAgents",
						executionPlan,
						parallelStatus: "running",
					}),
				},
			],
		})

		await waitFor(() => {
			expect(getByTestId("agent-status-chat-card")).toBeInTheDocument()
		})

		const list = getByTestId("virtuoso-item-list")
		expect(list).toContainElement(getByTestId("agent-status-chat-card"))
		expect(queryByTestId("chat-textarea")).toBeInTheDocument()
	})

	it("does not append a synthetic parallel status row from active extension state alone", async () => {
		const { queryByTestId } = renderChatView()

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "text",
					ts: Date.now() - 1000,
					text: "Working on parallel plan",
				},
			],
			activeExecutionPlan: createExecutionPlan(),
		})

		await waitFor(() => {
			expect(queryByTestId("chat-textarea")).toBeInTheDocument()
		})

		expect(queryByTestId("agent-status-chat-card")).not.toBeInTheDocument()
	})

	it("uses the standard chat stop button to cancel an active parallel execution plan", async () => {
		renderChatView()

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "text",
					ts: Date.now() - 1000,
					text: "Working on parallel plan",
				},
			],
			activeExecutionPlan: createExecutionPlan(),
		})

		await waitFor(() => expect(screen.getByTestId("chat-textarea-send-stop")).toHaveTextContent("stop"))
		fireEvent.click(screen.getByTestId("chat-textarea-send-stop"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "cancelTask" })
	})

	it("uses bottom chat controls to approve selectable persisted merge review entries", async () => {
		renderChatView()

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				createParallelReviewMessage({}, Date.now()),
			],
		})

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "chat:parallelAgents.mergeReview.mergeAllApproved" }),
			).toBeInTheDocument()
		})

		vi.mocked(vscode.postMessage).mockClear()
		fireEvent.click(screen.getByRole("button", { name: "chat:parallelAgents.mergeReview.mergeAllApproved" }))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "mergeApprovedAgents", ids: ["agent-1"] })
	})

	it("uses bottom chat controls to deny a persisted merge review even while a parallel plan is active", async () => {
		const executionPlan = createExecutionPlan()
		renderChatView()

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				createParallelReviewMessage({ executionPlan }, Date.now()),
			],
			activeExecutionPlan: executionPlan,
		})

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "chat:reject.title" })).toBeInTheDocument()
		})

		vi.mocked(vscode.postMessage).mockClear()
		fireEvent.click(screen.getByRole("button", { name: "chat:reject.title" }))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "mergeDeniedAgents", ids: ["agent-1"] })
		expect(vscode.postMessage).not.toHaveBeenCalledWith({ type: "cancelTask" })
	})

	it("clears bottom merge review controls when the latest persisted parallelAgents row is terminal", async () => {
		renderChatView()

		const taskMessage: ClineMessage = {
			type: "say",
			say: "task",
			ts: Date.now() - 3000,
			text: "Initial task",
		}
		mockPostMessage({
			clineMessages: [taskMessage, createParallelReviewMessage({}, Date.now() - 2000)],
		})

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "chat:parallelAgents.mergeReview.mergeAllApproved" }),
			).toBeInTheDocument()
		})

		mockPostMessage({
			clineMessages: [
				taskMessage,
				createParallelReviewMessage(
					{
						parallelStatus: "merged",
						mergeReviewEntries: [],
					},
					Date.now(),
				),
			],
		})

		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: "chat:parallelAgents.mergeReview.mergeAllApproved" }),
			).not.toBeInTheDocument()
			expect(screen.queryByRole("button", { name: "chat:reject.title" })).not.toBeInTheDocument()
		})
	})

	it("does not re-enable stale merge review controls after newer parent activity", async () => {
		renderChatView()

		const now = Date.now()
		const taskMessage: ClineMessage = {
			type: "say",
			say: "task",
			ts: now - 3000,
			text: "Initial task",
		}
		const staleReview = createParallelReviewMessage(
			{
				mergeReviewEntries: [
					{
						agentId: "agent-1",
						mode: "code",
						task: "Build UI",
						diff: "",
						worktreePath: "/tmp/agent-1",
						branch: "roo/parallel/plan-chat-flow/agent-1",
						mergeStatus: "failed",
						mergeable: false,
						mergeError: "CONFLICT",
					},
				],
			},
			now - 2000,
		)

		mockPostMessage({
			clineMessages: [taskMessage, staleReview],
		})

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "chat:reject.title" })).toBeInTheDocument()
		})

		mockPostMessage({
			clineMessages: [
				taskMessage,
				staleReview,
				{
					type: "say",
					say: "api_req_started",
					ts: now - 1000,
				},
			],
		})

		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "chat:reject.title" })).not.toBeInTheDocument()
			expect(
				screen.queryByRole("button", { name: "chat:parallelAgents.mergeReview.mergeAllApproved" }),
			).not.toBeInTheDocument()
		})
	})

	it("keeps newer real tool approval controls when they supersede an older merge review", async () => {
		renderChatView()

		const now = Date.now()
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: now - 3000,
					text: "Initial task",
				},
				createParallelReviewMessage({}, now - 2000),
				{
					type: "ask",
					ask: "tool",
					ts: now - 1000,
					text: JSON.stringify({
						tool: "readFile",
						batchFiles: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
					}),
				},
			],
		})

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "chat:read-batch.approve.title" })).toBeInTheDocument()
			expect(screen.getByRole("button", { name: "chat:read-batch.deny.title" })).toBeInTheDocument()
		})
		expect(screen.queryByRole("button", { name: "chat:reject.title" })).not.toBeInTheDocument()
	})

	it("keeps denial available without showing an approval button when no review entries are selectable", async () => {
		renderChatView()

		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				createParallelReviewMessage(
					{
						mergeReviewEntries: [
							{
								agentId: "agent-1",
								mode: "code",
								task: "Build UI",
								diff: "",
								worktreePath: "/tmp/agent-1",
								branch: "roo/parallel/plan-chat-flow/agent-1",
								mergeStatus: "failed",
								mergeable: false,
								mergeError: "CONFLICT",
							},
						],
					},
					Date.now(),
				),
			],
		})

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "chat:reject.title" })).toBeInTheDocument()
		})

		expect(
			screen.queryByRole("button", { name: "chat:parallelAgents.mergeReview.mergeAllApproved" }),
		).not.toBeInTheDocument()

		vi.mocked(vscode.postMessage).mockClear()
		fireEvent.click(screen.getByRole("button", { name: "chat:reject.title" }))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "mergeDeniedAgents", ids: [] })
	})
})

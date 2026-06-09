// pnpm --filter @roo-code/vscode-webview test src/components/settings/__tests__/SettingsView.spec.tsx

import { render, screen, fireEvent, within, act } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { vscode } from "@/utils/vscode"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import TranslationProvider from "@src/i18n/TranslationContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"

import SettingsView from "../SettingsView"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("../ApiConfigManager", () => ({
	__esModule: true,
	default: function MockApiConfigManager({ currentApiConfigName }: any) {
		const { t } = useAppTranslation()

		return (
			<div data-testid="api-config-management">
				<span>{t("settings:providers.configProfile")}</span>
				<span>Current config: {currentApiConfigName}</span>
			</div>
		)
	},
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick, appearance, "data-testid": dataTestId }: any) =>
		appearance === "icon" ? (
			<button
				onClick={onClick}
				className="codicon codicon-close"
				aria-label="Remove command"
				data-testid={dataTestId}>
				<span className="codicon codicon-close" />
			</button>
		) : (
			<button onClick={onClick} data-appearance={appearance} data-testid={dataTestId}>
				{children}
			</button>
		),
	VSCodeCheckbox: ({ children, onChange, checked, "data-testid": dataTestId }: any) => (
		<label>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange({ target: { checked: e.target.checked } })}
				aria-label={typeof children === "string" ? children : undefined}
				data-testid={dataTestId}
			/>
			{children}
		</label>
	),
	VSCodeTextField: ({ value, onInput, placeholder, type, "data-testid": dataTestId }: any) => (
		<input
			type={type ?? "text"}
			value={value}
			onChange={(e) => onInput({ target: { value: e.target.value } })}
			placeholder={placeholder}
			data-testid={dataTestId}
		/>
	),
	VSCodeDropdown: ({ children, value, onChange, disabled, "data-testid": dataTestId }: any) => (
		<select
			value={value}
			onChange={(e) => onChange({ target: { value: e.target.value } })}
			disabled={disabled}
			data-testid={dataTestId}>
			{children}
		</select>
	),
	VSCodeOption: ({ children, value }: any) => <option value={value}>{children}</option>,
	VSCodeLink: ({ children, href }: any) => <a href={href || "#"}>{children}</a>,
	VSCodeRadio: ({ value, checked, onChange }: any) => (
		<input type="radio" value={value} checked={checked} onChange={onChange} />
	),
	VSCodeRadioGroup: ({ children, onChange }: any) => <div onChange={onChange}>{children}</div>,
	VSCodeTextArea: ({ value, onChange, rows, className, "data-testid": dataTestId }: any) => (
		<textarea
			value={value}
			onChange={onChange}
			rows={rows}
			className={className}
			data-testid={dataTestId}
			role="textbox"
		/>
	),
}))

vi.mock("../../../components/common/Tab", () => ({
	...vi.importActual("../../../components/common/Tab"),
	Tab: ({ children }: any) => <div data-testid="tab-container">{children}</div>,
	TabHeader: ({ children }: any) => <div data-testid="tab-header">{children}</div>,
	TabContent: ({ children, "data-testid": dataTestId }: any) => (
		<div data-testid={dataTestId || "tab-content"}>{children}</div>
	),
	TabList: ({ children, value, onValueChange, "data-testid": dataTestId }: any) => {
		// Store onValueChange in a global variable so TabTrigger can access it
		;(window as any).__onValueChange = onValueChange
		return (
			<div data-testid={dataTestId} data-value={value}>
				{children}
			</div>
		)
	},
	TabTrigger: ({ children, value, "data-testid": dataTestId, onClick, isSelected }: any) => {
		// This function simulates clicking on a tab and making its content visible
		const handleClick = () => {
			if (onClick) onClick()
			// Access onValueChange from the global variable
			const onValueChange = (window as any).__onValueChange
			if (onValueChange) onValueChange(value)
			// Make all tab contents invisible
			document.querySelectorAll("[data-tab-content]").forEach((el) => {
				;(el as HTMLElement).style.display = "none"
			})
			// Make this tab's content visible
			const tabContent = document.querySelector(`[data-tab-content="${value}"]`)
			if (tabContent) {
				;(tabContent as HTMLElement).style.display = "block"
			}
		}

		return (
			<button data-testid={dataTestId} data-value={value} data-selected={isSelected} onClick={handleClick}>
				{children}
			</button>
		)
	},
}))

vi.mock("@/components/ui", () => ({
	...vi.importActual("@/components/ui"),
	ToggleSwitch: ({ checked, onChange, "aria-label": ariaLabel, "data-testid": dataTestId }: any) => (
		<button role="switch" aria-checked={checked} aria-label={ariaLabel} data-testid={dataTestId} onClick={onChange}>
			Toggle
		</button>
	),
	Checkbox: ({ checked, onCheckedChange, id, className, ...props }: any) => (
		<input
			type="checkbox"
			checked={checked}
			onChange={(e) => onCheckedChange?.(e.target.checked)}
			id={id}
			className={className}
			{...props}
		/>
	),
	Textarea: ({ value, onChange, placeholder, id, className, ...props }: any) => (
		<textarea
			value={value}
			onChange={onChange}
			placeholder={placeholder}
			id={id}
			className={className}
			{...props}
		/>
	),
	Popover: ({ children }: any) => <div data-testid="popover">{children}</div>,
	PopoverTrigger: ({ children }: any) => <div data-testid="popover-trigger">{children}</div>,
	PopoverContent: ({ children }: any) => <div data-testid="popover-content">{children}</div>,
	Command: ({ children }: any) => <div data-testid="command">{children}</div>,
	CommandInput: ({ value, onValueChange }: any) => (
		<input data-testid="command-input" value={value} onChange={(e) => onValueChange(e.target.value)} />
	),
	CommandGroup: ({ children }: any) => <div data-testid="command-group">{children}</div>,
	CommandItem: ({ children, onSelect }: any) => (
		<div data-testid="command-item" onClick={onSelect}>
			{children}
		</div>
	),
	CommandList: ({ children }: any) => <div data-testid="command-list">{children}</div>,
	CommandEmpty: ({ children }: any) => <div data-testid="command-empty">{children}</div>,
	Slider: ({ value, onValueChange, "data-testid": dataTestId }: any) => (
		<input
			type="range"
			value={value?.[0] ?? 0}
			onChange={(e) => onValueChange?.([parseFloat(e.target.value)])}
			data-testid={dataTestId}
		/>
	),
	Button: ({ children, onClick, variant, className, disabled, type, "data-testid": dataTestId, ...props }: any) => (
		<button
			type={type}
			onClick={onClick}
			disabled={disabled}
			data-variant={variant}
			className={className}
			data-testid={dataTestId}
			{...props}>
			{children}
		</button>
	),
	StandardTooltip: ({ children, content }: any) => <div title={content}>{children}</div>,
	Input: ({ value, onChange, placeholder, type, "data-testid": dataTestId, ...props }: any) => (
		<input
			type={type ?? "text"}
			value={value}
			onChange={onChange}
			placeholder={placeholder}
			data-testid={dataTestId}
			{...props}
		/>
	),
	Select: ({ children, value, onValueChange }: any) => (
		<div data-testid="select" data-value={value}>
			<button onClick={() => onValueChange && onValueChange("test-change")}>{value}</button>
			{children}
		</div>
	),
	SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
	SelectGroup: ({ children }: any) => <div data-testid="select-group">{children}</div>,
	SelectItem: ({ children, value }: any) => (
		<div data-testid={`select-item-${value}`} data-value={value}>
			{children}
		</div>
	),
	SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
	SelectValue: ({ placeholder }: any) => <div data-testid="select-value">{placeholder}</div>,
	SearchableSelect: ({ value, onValueChange, options, placeholder }: any) => (
		<select value={value} onChange={(e) => onValueChange(e.target.value)} data-testid="searchable-select">
			{placeholder && <option value="">{placeholder}</option>}
			{options?.map((opt: any) => (
				<option key={opt.value} value={opt.value}>
					{opt.label}
				</option>
			))}
		</select>
	),
	AlertDialog: ({ children, open }: any) => (
		<div data-testid="alert-dialog" data-open={open}>
			{children}
		</div>
	),
	AlertDialogContent: ({ children }: any) => <div data-testid="alert-dialog-content">{children}</div>,
	AlertDialogHeader: ({ children }: any) => <div data-testid="alert-dialog-header">{children}</div>,
	AlertDialogTitle: ({ children }: any) => <div data-testid="alert-dialog-title">{children}</div>,
	AlertDialogDescription: ({ children }: any) => <div data-testid="alert-dialog-description">{children}</div>,
	AlertDialogFooter: ({ children }: any) => <div data-testid="alert-dialog-footer">{children}</div>,
	AlertDialogAction: ({ children, onClick }: any) => (
		<button data-testid="alert-dialog-action" onClick={onClick}>
			{children}
		</button>
	),
	AlertDialogCancel: ({ children, onClick }: any) => (
		<button data-testid="alert-dialog-cancel" onClick={onClick}>
			{children}
		</button>
	),
	// Add Collapsible components
	Collapsible: ({ children, open }: any) => (
		<div className="collapsible-mock" data-open={open}>
			{children}
		</div>
	),
	CollapsibleTrigger: ({ children, className, onClick }: any) => (
		<div className={`collapsible-trigger-mock ${className || ""}`} onClick={onClick}>
			{children}
		</div>
	),
	CollapsibleContent: ({ children, className }: any) => (
		<div className={`collapsible-content-mock ${className || ""}`}>{children}</div>
	),
	Dialog: ({ children, ...props }: any) => (
		<div data-testid="dialog" {...props}>
			{children}
		</div>
	),
	DialogContent: ({ children, ...props }: any) => (
		<div data-testid="dialog-content" {...props}>
			{children}
		</div>
	),
	DialogHeader: ({ children, ...props }: any) => (
		<div data-testid="dialog-header" {...props}>
			{children}
		</div>
	),
	DialogTitle: ({ children, ...props }: any) => (
		<div data-testid="dialog-title" {...props}>
			{children}
		</div>
	),
	DialogDescription: ({ children, ...props }: any) => (
		<div data-testid="dialog-description" {...props}>
			{children}
		</div>
	),
	DialogFooter: ({ children, ...props }: any) => (
		<div data-testid="dialog-footer" {...props}>
			{children}
		</div>
	),
}))

// Mock window.postMessage to trigger state hydration
const mockPostMessage = (state: any) => {
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "state",
					state: {
						version: "1.0.0",
						clineMessages: [],
						taskHistory: [],
						shouldShowAnnouncement: false,
						allowedCommands: [],
						alwaysAllowExecute: false,
						ttsEnabled: false,
						ttsSpeed: 1,
						soundEnabled: false,
						soundVolume: 0.5,
						...state,
					},
				},
			}),
		)
	})
}

const renderSettingsView = (initialState: Record<string, any> = {}) => {
	const onDone = vi.fn()
	const queryClient = new QueryClient()
	const renderTree = (targetSection?: string) => (
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				{targetSection ? (
					<SettingsView onDone={onDone} targetSection={targetSection} />
				) : (
					<SettingsView onDone={onDone} />
				)}
			</QueryClientProvider>
		</ExtensionStateContextProvider>
	)

	const result = render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>{null}</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)

	// Hydrate initial state before SettingsView initializes its local cachedState.
	mockPostMessage(initialState)
	result.rerender(renderTree())

	// Helper function to activate a tab and ensure its content is visible
	const activateTab = (tabId: string) => {
		// Skip trying to find and click the tab, just directly render with the target section
		// This bypasses the actual tab clicking mechanism but ensures the content is shown
		result.rerender(renderTree(tabId))
	}

	// Helper to get elements within the settings content (not the indexing container)
	const getSettingsContent = () => screen.getByTestId("settings-content")

	return { onDone, activateTab, getSettingsContent }
}

const renderSettingsViewWithTranslations = (initialState: Record<string, any> = {}) => {
	const onDone = vi.fn()
	const queryClient = new QueryClient()

	const renderTree = (targetSection?: string) => (
		<ExtensionStateContextProvider>
			<TranslationProvider>
				<QueryClientProvider client={queryClient}>
					{targetSection ? (
						<SettingsView onDone={onDone} targetSection={targetSection} />
					) : (
						<SettingsView onDone={onDone} />
					)}
				</QueryClientProvider>
			</TranslationProvider>
		</ExtensionStateContextProvider>
	)

	const result = render(
		<ExtensionStateContextProvider>
			<TranslationProvider>
				<QueryClientProvider client={queryClient}>{null}</QueryClientProvider>
			</TranslationProvider>
		</ExtensionStateContextProvider>,
	)

	// Hydrate extension state before SettingsView initializes its local cachedState and TranslationProvider reads language.
	mockPostMessage({ language: "en", ...initialState })
	result.rerender(renderTree())

	const activateTab = (tabId: string) => {
		result.rerender(renderTree(tabId))
	}

	return { ...result, onDone, activateTab }
}

describe("SettingsView - Localization", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders settings labels through the real i18n provider without raw settings keys", () => {
		const { container } = renderSettingsViewWithTranslations()

		expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument()
		expect(screen.getByTestId("save-button")).toHaveTextContent("Save")
		expect(screen.getByText("Notifications")).toBeInTheDocument()
		expect(within(screen.getByTestId("settings-content")).getByText("Providers")).toBeInTheDocument()
		expect(within(screen.getByTestId("settings-content")).getByText("Configuration Profile")).toBeInTheDocument()
		expect(within(screen.getByTestId("settings-content")).getByText("API Provider")).toBeInTheDocument()

		expect(container).not.toHaveTextContent("settings:header.title")
		expect(container).not.toHaveTextContent("settings:common.save")
		expect(container).not.toHaveTextContent("settings:sections.providers")
		expect(container).not.toHaveTextContent("settings:providers.configProfile")
		expect(container).not.toHaveTextContent("settings:providers.apiProvider")
	})

	it("renders OpenAI Codex Settings labels through the real i18n provider without raw settings keys", async () => {
		const { container } = renderSettingsViewWithTranslations({
			openAiCodexIsAuthenticated: true,
			apiConfiguration: {
				apiProvider: "openai-codex",
				apiModelId: "gpt-5.5",
				openAiCodexFastMode: true,
			},
		})

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "openAiCodexRateLimits",
						values: {
							planType: "Plus",
							primary: {
								usedPercent: 10,
								windowMinutes: 300,
								resetsAt: Date.now() + 60_000,
							},
						},
					},
				}),
			)
		})

		expect(await screen.findByText("Enable Fast mode")).toBeInTheDocument()
		expect(await screen.findByText("Usage Limits for Codex (Plus)")).toBeInTheDocument()

		expect(container).not.toHaveTextContent("settings:providers.openAiCodexFastMode.label")
		expect(container).not.toHaveTextContent("settings:providers.openAiCodexRateLimits.title")
	})

	it("renders the Visual Browser Inspector auto-approve option with an explicit label", () => {
		const { activateTab } = renderSettingsViewWithTranslations()

		activateTab("autoApprove")

		const content = screen.getByTestId("settings-content")
		const visualBrowserInspectorToggle = within(content).getByTestId("always-allow-visual-browser-inspector-toggle")

		expect(visualBrowserInspectorToggle).toBeInTheDocument()
		expect(visualBrowserInspectorToggle).toHaveTextContent("Visual Browser Inspector")
		expect(visualBrowserInspectorToggle).toHaveAttribute("aria-label", "Visual Browser Inspector")
	})
})

describe("SettingsView - Sound Settings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("initializes with tts disabled by default", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		const content = getSettingsContent()
		const ttsCheckbox = within(content).getByTestId("tts-enabled-checkbox")
		expect(ttsCheckbox).not.toBeChecked()

		// Speed slider should not be visible when tts is disabled
		expect(within(content).queryByTestId("tts-speed-slider")).not.toBeInTheDocument()
	})

	it("initializes with sound disabled by default", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		const content = getSettingsContent()
		const soundCheckbox = within(content).getByTestId("sound-enabled-checkbox")
		expect(soundCheckbox).not.toBeChecked()

		// Volume slider should not be visible when sound is disabled
		expect(within(content).queryByTestId("sound-volume-slider")).not.toBeInTheDocument()
	})

	it("toggles tts setting and sends message to VSCode", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		const content = getSettingsContent()
		const ttsCheckbox = within(content).getByTestId("tts-enabled-checkbox")

		// Enable tts
		fireEvent.click(ttsCheckbox)
		expect(ttsCheckbox).toBeChecked()

		// Click Save to save settings
		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "updateSettings",
				updatedSettings: expect.objectContaining({
					ttsEnabled: true,
				}),
			}),
		)
	})

	it("toggles sound setting and sends message to VSCode", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		const content = getSettingsContent()
		const soundCheckbox = within(content).getByTestId("sound-enabled-checkbox")

		// Enable sound
		fireEvent.click(soundCheckbox)
		expect(soundCheckbox).toBeChecked()

		// Click Save to save settings
		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "updateSettings",
				updatedSettings: expect.objectContaining({
					soundEnabled: true,
				}),
			}),
		)
	})

	it("shows tts slider when sound is enabled", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		const content = getSettingsContent()
		// Enable tts
		const ttsCheckbox = within(content).getByTestId("tts-enabled-checkbox")
		fireEvent.click(ttsCheckbox)

		// Speed slider should be visible
		const speedSlider = within(content).getByTestId("tts-speed-slider")
		expect(speedSlider).toBeInTheDocument()
		expect(speedSlider).toHaveValue("1")
	})

	it("shows volume slider when sound is enabled", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		const content = getSettingsContent()
		// Enable sound
		const soundCheckbox = within(content).getByTestId("sound-enabled-checkbox")
		fireEvent.click(soundCheckbox)

		// Volume slider should be visible
		const volumeSlider = within(content).getByTestId("sound-volume-slider")
		expect(volumeSlider).toBeInTheDocument()
		expect(volumeSlider).toHaveValue("0.5")
	})

	it("updates speed and sends message to VSCode when slider changes", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		const content = getSettingsContent()
		// Enable tts
		const ttsCheckbox = within(content).getByTestId("tts-enabled-checkbox")
		fireEvent.click(ttsCheckbox)

		// Change speed
		const speedSlider = within(content).getByTestId("tts-speed-slider")
		fireEvent.change(speedSlider, { target: { value: "0.75" } })

		// Click Save to save settings
		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		// Verify message sent to VSCode
		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "updateSettings",
				updatedSettings: expect.objectContaining({
					ttsSpeed: 0.75,
				}),
			}),
		)
	})

	it("updates volume and sends message to VSCode when slider changes", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the notifications tab
		activateTab("notifications")

		const content = getSettingsContent()
		// Enable sound
		const soundCheckbox = within(content).getByTestId("sound-enabled-checkbox")
		fireEvent.click(soundCheckbox)

		// Change volume
		const volumeSlider = within(content).getByTestId("sound-volume-slider")
		fireEvent.change(volumeSlider, { target: { value: "0.75" } })

		// Click Save to save settings
		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		// Verify message sent to VSCode
		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "updateSettings",
				updatedSettings: expect.objectContaining({
					soundVolume: 0.75,
				}),
			}),
		)
	})
})

describe("SettingsView - Email Notification Settings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	const getUpdateSettingsMessage = () => {
		const call = vi.mocked(vscode.postMessage).mock.calls.find(([message]) => message.type === "updateSettings")
		return call?.[0]
	}

	const savedSmtpSettings = {
		emailNotificationsEnabled: true,
		smtpHost: "smtp.example.com",
		smtpPort: 587,
		smtpUsername: "smtp-user",
		smtpPasswordConfigured: true,
		smtpFromAddress: "C Code <roo@example.com>",
		smtpRecipients: ["dev@example.com"],
	}

	const expectTestSmtpBlockedForUnsavedChanges = (content: HTMLElement) => {
		fireEvent.click(within(content).getByTestId("test-smtp-button"))

		expect(vscode.postMessage).not.toHaveBeenCalledWith({ type: "testSmtpSettings" })
		expect(within(content).getByTestId("smtp-test-unsaved-warning")).toBeInTheDocument()
		expect(within(content).getByTestId("smtp-test-result")).toHaveTextContent(
			"settings:notifications.email.test.unsavedChanges",
		)
	}

	it("saves SMTP settings with recipients as an array and omits blank passwords", () => {
		const { activateTab, getSettingsContent } = renderSettingsView()

		activateTab("notifications")

		const content = getSettingsContent()
		fireEvent.click(within(content).getByTestId("email-notifications-enabled-checkbox"))
		fireEvent.click(within(content).getByTestId("email-notify-failure-checkbox"))
		fireEvent.change(within(content).getByTestId("smtp-host-input"), { target: { value: "smtp.example.com" } })
		fireEvent.change(within(content).getByTestId("smtp-port-input"), { target: { value: "70000" } })
		fireEvent.click(within(content).getByTestId("smtp-secure-checkbox"))
		fireEvent.click(within(content).getByTestId("smtp-require-tls-checkbox"))
		fireEvent.change(within(content).getByTestId("smtp-username-input"), { target: { value: "smtp-user" } })
		fireEvent.change(within(content).getByTestId("smtp-from-input"), {
			target: { value: "C Code <roo@example.com>" },
		})
		fireEvent.change(within(content).getByTestId("smtp-recipients-input"), {
			target: { value: "dev@example.com, ops@example.com\nteam@example.com" },
		})
		fireEvent.change(within(content).getByTestId("smtp-subject-input"), {
			target: { value: "C task {{outcome}}" },
		})

		fireEvent.click(screen.getByTestId("save-button"))

		const updateSettingsMessage = getUpdateSettingsMessage()
		expect(updateSettingsMessage).toEqual(
			expect.objectContaining({
				type: "updateSettings",
				updatedSettings: expect.objectContaining({
					emailNotificationsEnabled: true,
					emailNotifyOnSuccess: true,
					emailNotifyOnFailure: true,
					smtpHost: "smtp.example.com",
					smtpPort: 65535,
					smtpSecure: true,
					smtpRequireTls: true,
					smtpUsername: "smtp-user",
					smtpFromAddress: "C Code <roo@example.com>",
					smtpRecipients: ["dev@example.com", "ops@example.com", "team@example.com"],
					smtpSubjectTemplate: "C task {{outcome}}",
				}),
			}),
		)
		expect(updateSettingsMessage?.updatedSettings).not.toHaveProperty("smtpPassword")
	})

	it("shows saved password state and sends smtpPassword only when a replacement is entered", () => {
		const { activateTab, getSettingsContent } = renderSettingsView({
			emailNotificationsEnabled: true,
			smtpPasswordConfigured: true,
			smtpRecipients: ["saved@example.com"],
		})

		activateTab("notifications")

		const content = getSettingsContent()
		const passwordInput = within(content).getByTestId("smtp-password-input")
		expect(passwordInput.getAttribute("placeholder")).toMatch(/configuredPlaceholder|saved password/)
		expect(within(content).getByText(/configuredDescription|password is already saved/)).toBeInTheDocument()
		expect(within(content).getByTestId("smtp-recipients-input")).toHaveValue("saved@example.com")

		fireEvent.change(passwordInput, { target: { value: "new-smtp-secret" } })
		fireEvent.click(screen.getByTestId("save-button"))

		const updateSettingsMessage = getUpdateSettingsMessage()
		expect(updateSettingsMessage?.updatedSettings).toEqual(
			expect.objectContaining({
				smtpPassword: "new-smtp-secret",
			}),
		)
	})

	it("posts Test SMTP requests with saved settings and no SMTP password payload", () => {
		const { activateTab, getSettingsContent } = renderSettingsView(savedSmtpSettings)

		activateTab("notifications")
		vi.mocked(vscode.postMessage).mockClear()

		fireEvent.click(within(getSettingsContent()).getByTestId("test-smtp-button"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "testSmtpSettings" })
		expect(JSON.stringify(vi.mocked(vscode.postMessage).mock.calls)).not.toContain("smtpPassword")
		expect(JSON.stringify(vi.mocked(vscode.postMessage).mock.calls)).not.toContain("smtp-secret")
		expect(within(getSettingsContent()).getByTestId("test-smtp-button")).toBeDisabled()
	})

	it("blocks Test SMTP while SMTP edits or a replacement password are unsaved", () => {
		const { activateTab, getSettingsContent } = renderSettingsView(savedSmtpSettings)

		activateTab("notifications")
		const content = getSettingsContent()
		vi.mocked(vscode.postMessage).mockClear()

		fireEvent.change(within(content).getByTestId("smtp-password-input"), { target: { value: "new-smtp-secret" } })

		expectTestSmtpBlockedForUnsavedChanges(content)
	})

	it("blocks Test SMTP while email notification enablement is unsaved", () => {
		const { activateTab, getSettingsContent } = renderSettingsView({
			...savedSmtpSettings,
			emailNotificationsEnabled: false,
		})

		activateTab("notifications")
		let content = getSettingsContent()
		vi.mocked(vscode.postMessage).mockClear()

		fireEvent.click(within(content).getByTestId("email-notifications-enabled-checkbox"))
		content = getSettingsContent()

		expectTestSmtpBlockedForUnsavedChanges(content)
	})

	const unsavedNotificationSettingCases: Array<[string, (content: HTMLElement) => void]> = [
		[
			"success notification preference",
			(content) => fireEvent.click(within(content).getByTestId("email-notify-success-checkbox")),
		],
		[
			"failure notification preference",
			(content) => fireEvent.click(within(content).getByTestId("email-notify-failure-checkbox")),
		],
		[
			"subject template",
			(content) =>
				fireEvent.change(within(content).getByTestId("smtp-subject-input"), {
					target: { value: "C task {{outcome}}" },
				}),
		],
	]

	it.each(unsavedNotificationSettingCases)("blocks Test SMTP while %s is unsaved", (_settingName, updateSetting) => {
		const { activateTab, getSettingsContent } = renderSettingsView(savedSmtpSettings)

		activateTab("notifications")
		const content = getSettingsContent()
		vi.mocked(vscode.postMessage).mockClear()

		updateSetting(content)

		expectTestSmtpBlockedForUnsavedChanges(content)
	})

	it("renders SMTP test success and invalid-configuration results from the extension host", () => {
		const { activateTab, getSettingsContent } = renderSettingsView({
			emailNotificationsEnabled: true,
			smtpHost: "smtp.example.com",
			smtpPasswordConfigured: true,
			smtpFromAddress: "C Code <roo@example.com>",
			smtpRecipients: ["dev@example.com"],
		})

		activateTab("notifications")
		const content = getSettingsContent()

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "smtpTestResult", success: true, text: "SMTP test email sent successfully." },
				}),
			)
		})

		expect(within(content).getByTestId("smtp-test-result")).toHaveTextContent("SMTP test email sent successfully.")

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "smtpTestResult",
						success: false,
						error: "Backend error should be replaced for invalid config",
						values: { skippedReason: "invalid-config" },
					},
				}),
			)
		})

		expect(within(content).getByTestId("smtp-test-result")).toHaveTextContent(
			"settings:notifications.email.test.invalidConfig",
		)
		expect(within(content).getByTestId("smtp-test-result")).not.toHaveTextContent("smtp-secret")
	})
})

describe("SettingsView - API Configuration", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders ApiConfigManagement with correct props", () => {
		renderSettingsView()

		expect(screen.getByTestId("api-config-management")).toBeInTheDocument()
	})
})

describe("SettingsView - Image Generation Settings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("saves image generation settings from cached state", () => {
		const { activateTab, getSettingsContent } = renderSettingsView({
			experiments: { imageGeneration: true },
			imageGenerationProvider: "openrouter",
			openRouterImageApiKey: "saved-openrouter-key",
			openRouterImageBaseUrl: "https://openrouter.ai/api/v1",
			openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
			openRouterImageGenerationApiMethod: "chat_completions",
		})

		activateTab("imageGeneration")

		const content = getSettingsContent()
		const apiKeyInput = within(content).getByPlaceholderText("settings:imageGeneration.apiKeyPlaceholder")
		fireEvent.change(apiKeyInput, { target: { value: "updated-openrouter-key" } })

		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "updateSettings",
				updatedSettings: expect.objectContaining({
					experiments: expect.objectContaining({ imageGeneration: true }),
					imageGenerationProvider: "openrouter",
					openRouterImageApiKey: "updated-openrouter-key",
					openRouterImageBaseUrl: "https://openrouter.ai/api/v1",
					openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
					openRouterImageGenerationApiMethod: "chat_completions",
				}),
			}),
		)
	})

	it("keeps image generation settings independent from the active chat provider profile", () => {
		const { activateTab, getSettingsContent } = renderSettingsView({
			experiments: { imageGeneration: true },
			apiConfiguration: {
				apiProvider: "anthropic",
				apiKey: "anthropic-chat-key",
				apiModelId: "claude-sonnet-4-5",
			},
			imageGenerationProvider: "openai",
			openAiImageApiKey: "openai-image-key",
			openAiImageBaseUrl: "https://api.openai.com/v1",
			openAiImageGenerationSelectedModel: "custom-image-model",
			openAiImageGenerationApiMethod: "chat_completions",
		})

		activateTab("imageGeneration")

		const content = getSettingsContent()
		const baseUrlInput = within(content).getByPlaceholderText("settings:imageGeneration.baseUrlPlaceholder")
		fireEvent.change(baseUrlInput, { target: { value: "https://compatible.example/v1" } })

		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "updateSettings",
				updatedSettings: expect.objectContaining({
					imageGenerationProvider: "openai",
					openAiImageApiKey: "openai-image-key",
					openAiImageBaseUrl: "https://compatible.example/v1",
					openAiImageGenerationSelectedModel: "custom-image-model",
					openAiImageGenerationApiMethod: "chat_completions",
				}),
			}),
		)
		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "upsertApiConfiguration",
				apiConfiguration: expect.objectContaining({
					apiProvider: "anthropic",
					apiModelId: "claude-sonnet-4-5",
				}),
			}),
		)
	})
})

describe("SettingsView - Memory Settings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders memory settings and summary values", () => {
		const { activateTab, getSettingsContent } = renderSettingsView({
			memoryEnabled: undefined,
			memoryWorkspaceEnabled: true,
			memoryGlobalEnabled: false,
			memoryMistakeMemoryEnabled: true,
			memoryMaxCharacters: 3200,
			memoryMaxEntries: 6,
			memoryPendingCandidateLimit: 24,
			memorySummary: {
				workspace: { active: 3, pending: 2, archived: 1, total: 6 },
				global: { active: 4, pending: 1, archived: 0, total: 5 },
			},
		})

		activateTab("memory")

		const content = getSettingsContent()
		expect(within(content).getByTestId("memory-workspace-enabled-checkbox")).toBeChecked()
		expect(within(content).getByTestId("memory-global-enabled-checkbox")).not.toBeChecked()
		expect(within(content).getByTestId("memory-mistake-enabled-checkbox")).toBeChecked()
		expect(within(content).getByTestId("memory-max-characters-input")).toHaveValue(3200)
		expect(within(content).getByTestId("memory-max-entries-input")).toHaveValue(6)
		expect(within(content).getByTestId("memory-pending-limit-input")).toHaveValue(24)
		expect(within(content).getByText("3")).toBeInTheDocument()
		expect(within(content).getByText("6")).toBeInTheDocument()
		expect(within(content).getByText("5")).toBeInTheDocument()
	})

	it("saves memory settings from cached state", () => {
		const { activateTab, getSettingsContent } = renderSettingsView({
			memoryEnabled: true,
			memoryWorkspaceEnabled: true,
			memoryGlobalEnabled: true,
			memoryMistakeMemoryEnabled: true,
			memoryMaxCharacters: 2400,
			memoryMaxEntries: 8,
			memoryPendingCandidateLimit: 100,
		})

		activateTab("memory")

		const content = getSettingsContent()
		fireEvent.click(within(content).getByTestId("memory-workspace-enabled-checkbox"))
		fireEvent.click(within(content).getByTestId("memory-global-enabled-checkbox"))
		fireEvent.click(within(content).getByTestId("memory-mistake-enabled-checkbox"))
		fireEvent.change(within(content).getByTestId("memory-max-characters-input"), { target: { value: "4200" } })
		fireEvent.change(within(content).getByTestId("memory-max-entries-input"), { target: { value: "12" } })
		fireEvent.change(within(content).getByTestId("memory-pending-limit-input"), { target: { value: "75" } })

		fireEvent.click(screen.getByTestId("save-button"))

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "updateSettings",
				updatedSettings: expect.objectContaining({
					memoryEnabled: true,
					memoryWorkspaceEnabled: false,
					memoryGlobalEnabled: false,
					memoryMistakeMemoryEnabled: false,
					memoryMaxCharacters: 4200,
					memoryMaxEntries: 12,
					memoryPendingCandidateLimit: 75,
				}),
			}),
		)
	})

	it("posts non-destructive memory management actions immediately", () => {
		const { activateTab, getSettingsContent } = renderSettingsView()

		activateTab("memory")

		const content = getSettingsContent()
		fireEvent.click(within(content).getByTestId("memory-refresh-button"))
		fireEvent.click(within(content).getByTestId("memory-approve-workspace-pending-button"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "memoryAction", memoryAction: "refresh" })
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "memoryAction",
			memoryAction: "approveWorkspacePending",
		})
	})

	it("requires confirmation before posting destructive memory actions", () => {
		const { activateTab, getSettingsContent } = renderSettingsView()

		activateTab("memory")

		const content = getSettingsContent()
		const dialog = within(content).getByTestId("alert-dialog")
		expect(dialog).toHaveAttribute("data-open", "false")

		fireEvent.click(within(content).getByTestId("memory-clear-workspace-button"))

		expect(dialog).toHaveAttribute("data-open", "true")
		expect(vscode.postMessage).not.toHaveBeenCalledWith({ type: "memoryAction", memoryAction: "clearWorkspace" })

		fireEvent.click(within(content).getByTestId("alert-dialog-action"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "memoryAction", memoryAction: "clearWorkspace" })
		expect(dialog).toHaveAttribute("data-open", "false")
	})
})

describe("SettingsView - Auto Approve Parallel Tasks", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("saves the parallel tasks auto-approval toggle from cached state", () => {
		const { activateTab, getSettingsContent } = renderSettingsView()

		activateTab("autoApprove")

		const content = getSettingsContent()
		const parallelTasksToggle = within(content).getByTestId("always-allow-parallel-tasks-toggle")
		fireEvent.click(parallelTasksToggle)

		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "updateSettings",
				updatedSettings: expect.objectContaining({
					alwaysAllowParallelTasks: true,
				}),
			}),
		)
	})

	it("hides max concurrent parallel tasks while parallel tasks auto-approval is disabled", () => {
		const { activateTab, getSettingsContent } = renderSettingsView()

		activateTab("autoApprove")

		const content = getSettingsContent()
		expect(within(content).queryByTestId("parallel-tasks-settings-section")).not.toBeInTheDocument()
		expect(within(content).queryByTestId("max-concurrent-parallel-tasks-input")).not.toBeInTheDocument()
	})

	it("shows max concurrent parallel tasks nested in the parallel tasks section when enabled", () => {
		const { activateTab, getSettingsContent } = renderSettingsView()

		activateTab("autoApprove")

		const content = getSettingsContent()
		const parallelTasksToggle = within(content).getByTestId("always-allow-parallel-tasks-toggle")
		fireEvent.click(parallelTasksToggle)

		const parallelTasksSection = within(content).getByTestId("parallel-tasks-settings-section")
		expect(parallelTasksSection).toHaveClass("pl-3", "border-l-2", "border-vscode-button-background")
		expect(within(parallelTasksSection).getByTestId("max-concurrent-parallel-tasks-input")).toBeInTheDocument()
	})

	it("saves max concurrent parallel tasks from cached state", () => {
		const { activateTab, getSettingsContent } = renderSettingsView()

		activateTab("autoApprove")

		const content = getSettingsContent()
		const parallelTasksToggle = within(content).getByTestId("always-allow-parallel-tasks-toggle")
		fireEvent.click(parallelTasksToggle)

		const parallelTasksSection = within(content).getByTestId("parallel-tasks-settings-section")
		const maxConcurrentInput = within(parallelTasksSection).getByTestId("max-concurrent-parallel-tasks-input")
		fireEvent.change(maxConcurrentInput, { target: { value: "5" } })

		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "updateSettings",
				updatedSettings: expect.objectContaining({
					maxConcurrentParallelTasks: 5,
				}),
			}),
		)
	})
})

describe("SettingsView - Auto Approve Visual Browser Inspector", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("saves the Visual Browser Inspector auto-approval toggle from cached state", () => {
		const { activateTab, getSettingsContent } = renderSettingsView()

		activateTab("autoApprove")

		const content = getSettingsContent()
		const visualBrowserInspectorToggle = within(content).getByTestId("always-allow-visual-browser-inspector-toggle")
		expect(visualBrowserInspectorToggle).toHaveAttribute("aria-pressed", "false")

		fireEvent.click(visualBrowserInspectorToggle)

		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "updateSettings",
				updatedSettings: expect.objectContaining({
					alwaysAllowVisualBrowserInspector: true,
				}),
			}),
		)
	})
})

describe("SettingsView - Allowed Commands", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("shows allowed commands section when alwaysAllowExecute is enabled", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the autoApprove tab
		activateTab("autoApprove")

		const content = getSettingsContent()
		// Enable always allow execute
		const executeCheckbox = within(content).getByTestId("always-allow-execute-toggle")
		fireEvent.click(executeCheckbox)
		// Verify allowed commands section appears
		expect(within(content).getByTestId("allowed-commands-heading")).toBeInTheDocument()
		expect(within(content).getByTestId("command-input")).toBeInTheDocument()
	})

	it("adds new command to the list", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the autoApprove tab
		activateTab("autoApprove")

		const content = getSettingsContent()
		// Enable always allow execute
		const executeCheckbox = within(content).getByTestId("always-allow-execute-toggle")
		fireEvent.click(executeCheckbox)

		// Add a new command
		const input = within(content).getByTestId("command-input")
		fireEvent.change(input, { target: { value: "npm test" } })

		const addButton = within(content).getByTestId("add-command-button")
		fireEvent.click(addButton)

		// Verify command was added
		expect(within(content).getByText("npm test")).toBeInTheDocument()

		// Verify VSCode message was sent
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				allowedCommands: ["npm test"],
			},
		})
	})

	it("removes command from the list", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the autoApprove tab
		activateTab("autoApprove")

		const content = getSettingsContent()
		// Enable always allow execute
		const executeCheckbox = within(content).getByTestId("always-allow-execute-toggle")
		fireEvent.click(executeCheckbox)

		// Add a command
		const input = within(content).getByTestId("command-input")
		fireEvent.change(input, { target: { value: "npm test" } })
		const addButton = within(content).getByTestId("add-command-button")
		fireEvent.click(addButton)

		// Remove the command
		const removeButton = within(content).getByTestId("remove-command-0")
		fireEvent.click(removeButton)

		// Verify command was removed
		expect(within(content).queryByText("npm test")).not.toBeInTheDocument()

		// Verify VSCode message was sent
		expect(vscode.postMessage).toHaveBeenLastCalledWith({
			type: "updateSettings",
			updatedSettings: {
				allowedCommands: [],
			},
		})
	})

	describe("SettingsView - Tab Navigation", () => {
		beforeEach(() => {
			vi.clearAllMocks()
		})

		it("renders with providers tab active by default", () => {
			renderSettingsView()

			// Check that the tab list is rendered
			const tabList = screen.getByTestId("settings-tab-list")
			expect(tabList).toBeInTheDocument()

			// Check that providers content is visible
			expect(screen.getByTestId("api-config-management")).toBeInTheDocument()
		})

		it("shows unsaved changes dialog when clicking Done with unsaved changes", () => {
			// Render once and get the activateTab helper
			const { activateTab, getSettingsContent } = renderSettingsView()

			// Activate the notifications tab
			activateTab("notifications")

			const content = getSettingsContent()
			// Make a change to create unsaved changes
			const soundCheckbox = within(content).getByTestId("sound-enabled-checkbox")
			fireEvent.click(soundCheckbox)

			// Click the Done button
			const doneButton = screen.getByText("settings:common.done")
			fireEvent.click(doneButton)

			// Check that unsaved changes dialog is shown
			expect(screen.getByText("settings:unsavedChangesDialog.title")).toBeInTheDocument()
		})
	})
})

describe("SettingsView - Duplicate Commands", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("prevents duplicate commands", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the autoApprove tab
		activateTab("autoApprove")

		const content = getSettingsContent()
		// Enable always allow execute
		const executeCheckbox = within(content).getByTestId("always-allow-execute-toggle")
		fireEvent.click(executeCheckbox)

		// Add a command twice
		const input = within(content).getByTestId("command-input")
		const addButton = within(content).getByTestId("add-command-button")

		// First addition
		fireEvent.change(input, { target: { value: "npm test" } })
		fireEvent.click(addButton)

		// Second addition attempt
		fireEvent.change(input, { target: { value: "npm test" } })
		fireEvent.click(addButton)

		// Verify command appears only once in active tab
		const commands = within(content).getAllByText("npm test")
		expect(commands).toHaveLength(1)
	})

	it("saves allowed commands when clicking Save", () => {
		// Render once and get the activateTab helper
		const { activateTab, getSettingsContent } = renderSettingsView()

		// Activate the autoApprove tab
		activateTab("autoApprove")

		const content = getSettingsContent()
		// Enable always allow execute
		const executeCheckbox = within(content).getByTestId("always-allow-execute-toggle")
		fireEvent.click(executeCheckbox)

		// Add a command
		const input = within(content).getByTestId("command-input")
		fireEvent.change(input, { target: { value: "npm test" } })
		const addButton = within(content).getByTestId("add-command-button")
		fireEvent.click(addButton)

		// Click Save
		const saveButton = screen.getByTestId("save-button")
		fireEvent.click(saveButton)

		// Verify VSCode messages were sent
		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "updateSettings",
				updatedSettings: expect.objectContaining({
					allowedCommands: ["npm test"],
				}),
			}),
		)
	})
})

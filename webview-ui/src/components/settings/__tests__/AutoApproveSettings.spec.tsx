import { render, screen, fireEvent } from "@/utils/test-utils"

import { AutoApproveSettings } from "../AutoApproveSettings"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ checked, onChange, children, "data-testid": dataTestId, "aria-label": ariaLabel }: any) => (
		<label data-testid={dataTestId}>
			<input
				type="checkbox"
				checked={!!checked}
				aria-label={ariaLabel}
				onChange={(e) => onChange?.({ target: { checked: e.target.checked } })}
			/>
			{children}
		</label>
	),
}))

vi.mock("@/components/ui", () => ({
	Button: ({ children, onClick, variant, ...props }: any) => (
		<button onClick={onClick} data-variant={variant} {...props}>
			{children}
		</button>
	),
	Input: ({ value, onChange, ...props }: any) => <input value={value} onChange={onChange} {...props} />,
	Slider: ({ value, onValueChange, "data-testid": dataTestId }: any) => (
		<input
			type="range"
			value={value?.[0] ?? 0}
			onChange={(e) => onValueChange?.([parseFloat(e.target.value)])}
			data-testid={dataTestId}
		/>
	),
	StandardTooltip: ({ children, content }: any) => <div title={content}>{children}</div>,
}))

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		autoApprovalEnabled: true,
		setAutoApprovalEnabled: vi.fn(),
	}),
}))

vi.mock("../Section", () => ({
	Section: ({ children }: any) => <div>{children}</div>,
}))

vi.mock("../SectionHeader", () => ({
	SectionHeader: ({ children }: any) => <div>{children}</div>,
}))

vi.mock("../SearchableSetting", () => ({
	SearchableSetting: ({ children }: any) => <div>{children}</div>,
}))

vi.mock("../MaxLimitInputs", () => ({
	MaxLimitInputs: () => <div data-testid="max-limit-inputs" />,
}))

describe("AutoApproveSettings", () => {
	const defaultProps = {
		alwaysAllowReadOnly: false,
		alwaysAllowReadOnlyOutsideWorkspace: false,
		alwaysAllowWrite: false,
		alwaysAllowWriteOutsideWorkspace: false,
		alwaysAllowWriteProtected: false,
		alwaysAllowMcp: false,
		alwaysAllowModeSwitch: false,
		alwaysAllowSubtasks: false,
		alwaysAllowParallelTasks: false,
		alwaysAllowVisualBrowserInspector: false,
		alwaysAllowExecute: false,
		alwaysAllowFollowupQuestions: false,
		allowedCommands: [],
		deniedCommands: [],
		setCachedStateField: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("writes the Visual Browser Inspector toggle through the cached settings setter", () => {
		const setCachedStateField = vi.fn()

		render(<AutoApproveSettings {...defaultProps} setCachedStateField={setCachedStateField} />)

		fireEvent.click(screen.getByTestId("always-allow-visual-browser-inspector-toggle"))

		expect(setCachedStateField).toHaveBeenCalledWith("alwaysAllowVisualBrowserInspector", true)
	})

	it("reflects the cached Visual Browser Inspector setting in the toggle state", () => {
		const { rerender } = render(<AutoApproveSettings {...defaultProps} />)

		expect(screen.getByTestId("always-allow-visual-browser-inspector-toggle")).toHaveAttribute(
			"aria-pressed",
			"false",
		)

		rerender(<AutoApproveSettings {...defaultProps} alwaysAllowVisualBrowserInspector={true} />)

		expect(screen.getByTestId("always-allow-visual-browser-inspector-toggle")).toHaveAttribute(
			"aria-pressed",
			"true",
		)
	})
})

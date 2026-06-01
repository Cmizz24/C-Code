import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import type { ProviderSettings } from "@roo-code/types"

import { OpenAICodex } from "../OpenAICodex"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ children, checked, onChange, "data-testid": dataTestId }: any) => (
		<label data-testid={dataTestId ?? "openai-codex-fast-mode-checkbox"}>
			<input
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange({ target: { checked: event.target.checked } })}
				data-testid={`${dataTestId ?? "openai-codex-fast-mode-checkbox"}-input`}
			/>
			{children}
		</label>
	),
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/components/ui", () => ({
	Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("../../ModelPicker", () => ({
	ModelPicker: () => <div data-testid="model-picker">Model Picker</div>,
}))

vi.mock("../OpenAICodexRateLimitDashboard", () => ({
	OpenAICodexRateLimitDashboard: () => <div data-testid="openai-codex-rate-limit-dashboard" />,
}))

describe("OpenAICodex", () => {
	const mockSetApiConfigurationField = vi.fn()

	const renderOpenAICodex = (apiConfiguration: Partial<ProviderSettings> = {}) =>
		render(
			<OpenAICodex
				apiConfiguration={apiConfiguration as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
			/>,
		)

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the Fast mode checkbox and credit warning copy", () => {
		renderOpenAICodex()

		expect(screen.getByText("settings:providers.openAiCodexFastMode.label")).toBeInTheDocument()
		expect(screen.getByText("settings:providers.openAiCodexFastMode.description")).toBeInTheDocument()
	})

	it("defaults Fast mode to unchecked when cached apiConfiguration omits the setting", () => {
		renderOpenAICodex()

		expect(screen.getByTestId("openai-codex-fast-mode-checkbox-input")).not.toBeChecked()
	})

	it("checks Fast mode when cached apiConfiguration enables it", () => {
		renderOpenAICodex({ openAiCodexFastMode: true })

		expect(screen.getByTestId("openai-codex-fast-mode-checkbox-input")).toBeChecked()
	})

	it.each([
		[false, true],
		[true, false],
	])("writes Fast mode changes from %s to %s in cached apiConfiguration", (initialValue, expectedValue) => {
		renderOpenAICodex({ openAiCodexFastMode: initialValue })

		fireEvent.click(screen.getByTestId("openai-codex-fast-mode-checkbox-input"))

		expect(mockSetApiConfigurationField).toHaveBeenCalledWith("openAiCodexFastMode", expectedValue)
	})

	it("updates checkbox state when cached apiConfiguration changes", () => {
		const { rerender } = render(
			<OpenAICodex
				apiConfiguration={{ openAiCodexFastMode: false } as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
			/>,
		)

		expect(screen.getByTestId("openai-codex-fast-mode-checkbox-input")).not.toBeChecked()

		rerender(
			<OpenAICodex
				apiConfiguration={{ openAiCodexFastMode: true } as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
			/>,
		)

		expect(screen.getByTestId("openai-codex-fast-mode-checkbox-input")).toBeChecked()
	})
})

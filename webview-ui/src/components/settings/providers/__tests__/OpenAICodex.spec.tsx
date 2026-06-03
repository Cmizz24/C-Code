import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import type { OpenAiCodexFastStatus, ProviderSettings } from "@roo-code/types"

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
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, any>) => (options?.modelId ? `${key}:${options.modelId}` : key),
	}),
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

	const renderOpenAICodex = (
		apiConfiguration: Partial<ProviderSettings> = {},
		props: { openAiCodexIsAuthenticated?: boolean; openAiCodexFastStatus?: OpenAiCodexFastStatus } = {},
	) =>
		render(
			<OpenAICodex
				apiConfiguration={apiConfiguration as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
				openAiCodexIsAuthenticated={props.openAiCodexIsAuthenticated}
				openAiCodexFastStatus={props.openAiCodexFastStatus}
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

	it("shows Fast mode as requested when enabled for a supported authenticated model without provider confirmation", () => {
		renderOpenAICodex({ apiModelId: "gpt-5.5", openAiCodexFastMode: true }, { openAiCodexIsAuthenticated: true })

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"settings:providers.openAiCodexFastMode.status.requested:gpt-5.5",
		)
	})

	it("shows Fast mode as confirmed when the provider echoes the requested priority tier", () => {
		renderOpenAICodex(
			{ apiModelId: "gpt-5.5", openAiCodexFastMode: true },
			{
				openAiCodexIsAuthenticated: true,
				openAiCodexFastStatus: {
					state: "confirmed",
					modelId: "gpt-5.5",
					requestedServiceTier: "priority",
					observedServiceTier: "priority",
				},
			},
		)

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"settings:providers.openAiCodexFastMode.status.confirmed:gpt-5.5",
		)
	})

	it("shows Fast mode as rejected when the provider returns a different service tier", () => {
		renderOpenAICodex(
			{ apiModelId: "gpt-5.5", openAiCodexFastMode: true },
			{
				openAiCodexIsAuthenticated: true,
				openAiCodexFastStatus: {
					state: "rejected",
					modelId: "gpt-5.5",
					requestedServiceTier: "priority",
					observedServiceTier: "default",
				},
			},
		)

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"settings:providers.openAiCodexFastMode.status.rejected:gpt-5.5",
		)
	})

	it("ignores stale Fast status from a different selected model", () => {
		renderOpenAICodex(
			{ apiModelId: "gpt-5.5", openAiCodexFastMode: true },
			{
				openAiCodexIsAuthenticated: true,
				openAiCodexFastStatus: {
					state: "confirmed",
					modelId: "gpt-5.4",
					requestedServiceTier: "priority",
					observedServiceTier: "priority",
				},
			},
		)

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"settings:providers.openAiCodexFastMode.status.requested:gpt-5.5",
		)
	})

	it("shows Fast mode as disabled when the supported model can use it but the toggle is off", () => {
		renderOpenAICodex({ apiModelId: "gpt-5.4", openAiCodexFastMode: false }, { openAiCodexIsAuthenticated: true })

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"settings:providers.openAiCodexFastMode.status.disabled:gpt-5.4",
		)
	})

	it("shows Fast mode as unsupported for models that cannot use the priority tier", () => {
		renderOpenAICodex(
			{ apiModelId: "gpt-5.4-mini", openAiCodexFastMode: true },
			{ openAiCodexIsAuthenticated: true },
		)

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"settings:providers.openAiCodexFastMode.status.unsupported:gpt-5.4-mini",
		)
	})

	it("shows sign-in required when Fast mode is enabled but OpenAI Codex is not authenticated", () => {
		renderOpenAICodex({ apiModelId: "gpt-5.5", openAiCodexFastMode: true })

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"settings:providers.openAiCodexFastMode.status.signInRequired:gpt-5.5",
		)
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
				openAiCodexIsAuthenticated={false}
			/>,
		)

		expect(screen.getByTestId("openai-codex-fast-mode-checkbox-input")).not.toBeChecked()

		rerender(
			<OpenAICodex
				apiConfiguration={{ openAiCodexFastMode: true } as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
				openAiCodexIsAuthenticated={false}
			/>,
		)

		expect(screen.getByTestId("openai-codex-fast-mode-checkbox-input")).toBeChecked()
	})
})

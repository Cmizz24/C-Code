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
		t: (key: string, options?: Record<string, any>) => {
			const translations: Record<string, string> = {
				"settings:providers.openAiCodexFastMode.status.disabled": "Fast mode is off for {{modelId}}.",
				"settings:providers.openAiCodexFastMode.status.unsupported":
					"Fast mode is not available for {{modelId}}.",
				"settings:providers.openAiCodexFastMode.status.signInRequired":
					"Fast mode is on for {{modelId}}, but you need to sign in before Codex can use it.",
				"settings:providers.openAiCodexFastMode.status.active":
					"Fast mode is on for {{modelId}} and will use Codex Fast routing on supported requests.",
				"settings:providers.openAiCodexFastMode.status.confirmed":
					"Fast mode is on for {{modelId}}; OpenAI reported the Fast service tier for the last request.",
				"settings:providers.openAiCodexFastMode.status.rejected":
					"Fast mode was requested for {{modelId}}, but OpenAI reported the {{observedServiceTier}} service tier.",
			}

			return (translations[key] ?? key).replace(/{{(\w+)}}/g, (_, name) => String(options?.[name] ?? ""))
		},
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

	const expectFastModeIndicator = (severity: "green" | "amber" | "red", className: string) => {
		const indicator = screen.getByTestId("openai-codex-fast-mode-indicator")
		expect(indicator).toHaveAttribute("data-severity", severity)
		expect(indicator).toHaveClass(className)
	}

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

	it("shows Fast mode as active with a green indicator when enabled without provider confirmation", () => {
		renderOpenAICodex({ apiModelId: "gpt-5.5", openAiCodexFastMode: true }, { openAiCodexIsAuthenticated: true })

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"Fast mode is on for gpt-5.5 and will use Codex Fast routing on supported requests.",
		)
		expect(screen.getByTestId("openai-codex-fast-mode-status")).not.toHaveTextContent(
			"OpenAI has not confirmed the priority tier yet",
		)
		expectFastModeIndicator("green", "bg-vscode-charts-green")
	})

	it("shows Fast mode as active with a green indicator while the provider request is still pending", () => {
		renderOpenAICodex(
			{ apiModelId: "gpt-5.5", openAiCodexFastMode: true },
			{
				openAiCodexIsAuthenticated: true,
				openAiCodexFastStatus: {
					state: "requested",
					modelId: "gpt-5.5",
					requestedServiceTier: "priority",
				},
			},
		)

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"Fast mode is on for gpt-5.5 and will use Codex Fast routing on supported requests.",
		)
		expectFastModeIndicator("green", "bg-vscode-charts-green")
	})

	it("keeps Fast mode green when an active request transitions back to idle while the toggle remains enabled", () => {
		const { rerender } = render(
			<OpenAICodex
				apiConfiguration={{ apiModelId: "gpt-5.5", openAiCodexFastMode: true } as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
				openAiCodexIsAuthenticated={true}
				openAiCodexFastStatus={{
					state: "requested",
					modelId: "gpt-5.5",
					requestedServiceTier: "priority",
				}}
			/>,
		)

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"Fast mode is on for gpt-5.5 and will use Codex Fast routing on supported requests.",
		)
		expectFastModeIndicator("green", "bg-vscode-charts-green")

		rerender(
			<OpenAICodex
				apiConfiguration={{ apiModelId: "gpt-5.5", openAiCodexFastMode: true } as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
				openAiCodexIsAuthenticated={true}
				openAiCodexFastStatus={{
					state: "off",
					modelId: "gpt-5.5",
				}}
			/>,
		)

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"Fast mode is on for gpt-5.5 and will use Codex Fast routing on supported requests.",
		)
		expectFastModeIndicator("green", "bg-vscode-charts-green")

		rerender(
			<OpenAICodex
				apiConfiguration={{ apiModelId: "gpt-5.5", openAiCodexFastMode: true } as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
				openAiCodexIsAuthenticated={true}
			/>,
		)

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"Fast mode is on for gpt-5.5 and will use Codex Fast routing on supported requests.",
		)
		expectFastModeIndicator("green", "bg-vscode-charts-green")
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
			"Fast mode is on for gpt-5.5; OpenAI reported the Fast service tier for the last request.",
		)
		expectFastModeIndicator("green", "bg-vscode-charts-green")
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
			"Fast mode was requested for gpt-5.5, but OpenAI reported the default service tier.",
		)
		expectFastModeIndicator("red", "bg-vscode-errorForeground")
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
			"Fast mode is on for gpt-5.5 and will use Codex Fast routing on supported requests.",
		)
		expectFastModeIndicator("green", "bg-vscode-charts-green")
	})

	it("shows Fast mode as disabled when the supported model can use it but the toggle is off", () => {
		renderOpenAICodex({ apiModelId: "gpt-5.4", openAiCodexFastMode: false }, { openAiCodexIsAuthenticated: true })

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent("Fast mode is off for gpt-5.4.")
		expectFastModeIndicator("red", "bg-vscode-errorForeground")
	})

	it("shows Fast mode as unsupported for models that cannot use the priority tier", () => {
		renderOpenAICodex(
			{ apiModelId: "gpt-5.4-mini", openAiCodexFastMode: true },
			{ openAiCodexIsAuthenticated: true },
		)

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"Fast mode is not available for gpt-5.4-mini.",
		)
		expectFastModeIndicator("red", "bg-vscode-errorForeground")
	})

	it("shows sign-in required when Fast mode is enabled but OpenAI Codex is not authenticated", () => {
		renderOpenAICodex({ apiModelId: "gpt-5.5", openAiCodexFastMode: true })

		expect(screen.getByTestId("openai-codex-fast-mode-status")).toHaveTextContent(
			"Fast mode is on for gpt-5.5, but you need to sign in before Codex can use it.",
		)
		expectFastModeIndicator("amber", "bg-vscode-charts-yellow")
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

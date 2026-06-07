import { fireEvent, render, screen } from "@testing-library/react"

import { ImageGenerationSettings } from "../ImageGenerationSettings"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ children, checked, onChange }: any) => (
		<label>
			<input type="checkbox" checked={checked} onChange={(event) => onChange(event)} />
			{children}
		</label>
	),
	VSCodeDropdown: ({ children, value, onChange, disabled, className }: any) => (
		<select value={value} onChange={(event) => onChange(event)} disabled={disabled} className={className}>
			{children}
		</select>
	),
	VSCodeOption: ({ children, value }: any) => <option value={value}>{children}</option>,
	VSCodeTextField: ({ value, onInput, placeholder, type, className }: any) => (
		<input
			value={value}
			onChange={(event) => onInput(event)}
			placeholder={placeholder}
			type={type ?? "text"}
			className={className}
		/>
	),
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, string>) => {
			if (!options) {
				return key
			}

			const renderedOptions = Object.entries(options)
				.map(([optionKey, optionValue]) => `${optionKey}=${optionValue}`)
				.join(",")

			return `${key}(${renderedOptions})`
		},
	}),
}))

describe("ImageGenerationSettings", () => {
	const mockSetImageGenerationSetting = vi.fn()
	const mockOnChange = vi.fn()

	const defaultProps = {
		enabled: false,
		onChange: mockOnChange,
		imageGenerationSettings: {},
		setImageGenerationSetting: mockSetImageGenerationSetting,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Initial Mount Behavior", () => {
		it("should not call setter functions on initial mount with empty configuration", () => {
			render(<ImageGenerationSettings {...defaultProps} />)

			expect(mockSetImageGenerationSetting).not.toHaveBeenCalled()
		})

		it("should not call setter functions on initial mount with existing configuration", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationSettings={{
						imageGenerationProvider: "openrouter",
						openRouterImageApiKey: "existing-key",
						openRouterImageBaseUrl: "https://openrouter.example/api/v1",
						openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
						openRouterImageGenerationApiMethod: "chat_completions",
					}}
				/>,
			)

			expect(mockSetImageGenerationSetting).not.toHaveBeenCalled()
		})
	})

	describe("User Interaction Behavior", () => {
		it("should call onChange when the image generation experiment is toggled", () => {
			render(<ImageGenerationSettings {...defaultProps} />)

			fireEvent.click(screen.getByRole("checkbox"))

			expect(mockOnChange).toHaveBeenCalledWith(true)
			expect(mockSetImageGenerationSetting).not.toHaveBeenCalled()
		})

		it("should update the provider-specific API key when user changes the OpenRouter API key", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationSettings={{ imageGenerationProvider: "openrouter" }}
				/>,
			)

			fireEvent.change(
				screen.getByPlaceholderText(
					"settings:experimental.IMAGE_GENERATION.apiKeyPlaceholder(provider=OpenRouter)",
				),
				{ target: { value: "new-openrouter-key" } },
			)

			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith("openRouterImageApiKey", "new-openrouter-key")
		})

		it("should update imageGenerationProvider when user changes providers", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationSettings={{ imageGenerationProvider: "openrouter" }}
				/>,
			)

			fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "openai" } })

			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith("imageGenerationProvider", "openai")
		})

		it("should update OpenAI-compatible provider-specific fields", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationSettings={{
						imageGenerationProvider: "openai",
						openAiImageApiKey: "existing-openai-key",
						openAiImageBaseUrl: "https://api.openai.com/v1",
						openAiImageGenerationSelectedModel: "custom-image-model",
						openAiImageGenerationApiMethod: "chat_completions",
					}}
				/>,
			)

			fireEvent.change(
				screen.getByPlaceholderText(
					"settings:experimental.IMAGE_GENERATION.apiKeyPlaceholder(provider=OpenAI / OpenAI Compatible)",
				),
				{ target: { value: "updated-openai-key" } },
			)
			fireEvent.change(
				screen.getByPlaceholderText(
					"settings:experimental.IMAGE_GENERATION.baseUrlPlaceholder(url=https://api.openai.com/v1)",
				),
				{ target: { value: "https://compatible.example/v1" } },
			)
			fireEvent.change(screen.getByDisplayValue("custom-image-model"), {
				target: { value: "updated-custom-model" },
			})
			fireEvent.change(
				screen.getByDisplayValue("settings:experimental.IMAGE_GENERATION.apiMethodLabels.chat_completions"),
				{
					target: { value: "images_api" },
				},
			)

			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith("openAiImageApiKey", "updated-openai-key")
			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith(
				"openAiImageBaseUrl",
				"https://compatible.example/v1",
			)
			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith(
				"openAiImageGenerationSelectedModel",
				"updated-custom-model",
			)
			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith("openAiImageGenerationApiMethod", "images_api")
		})
	})

	describe("Conditional Rendering", () => {
		it("should render provider-specific fields when enabled is true and provider is OpenRouter", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationSettings={{ imageGenerationProvider: "openrouter" }}
				/>,
			)

			expect(
				screen.getByPlaceholderText(
					"settings:experimental.IMAGE_GENERATION.apiKeyPlaceholder(provider=OpenRouter)",
				),
			).toBeInTheDocument()
			expect(
				screen.getByPlaceholderText(
					"settings:experimental.IMAGE_GENERATION.baseUrlPlaceholder(url=https://openrouter.ai/api/v1)",
				),
			).toBeInTheDocument()
			expect(screen.getAllByRole("combobox")).toHaveLength(3)
			expect(
				screen.getByText("settings:experimental.IMAGE_GENERATION.warningMissingApiKey(provider=OpenRouter)"),
			).toBeInTheDocument()
		})

		it("should render custom model and unlocked API method fields for OpenAI-compatible image generation", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationSettings={{
						imageGenerationProvider: "openai",
						openAiImageApiKey: "openai-key",
						openAiImageGenerationSelectedModel: "custom-image-model",
						openAiImageGenerationApiMethod: "chat_completions",
					}}
				/>,
			)

			expect(
				screen.getByPlaceholderText(
					"settings:experimental.IMAGE_GENERATION.apiKeyPlaceholder(provider=OpenAI / OpenAI Compatible)",
				),
			).toBeInTheDocument()
			expect(screen.getByDisplayValue("custom-image-model")).toBeInTheDocument()
			expect(
				screen.getByDisplayValue("settings:experimental.IMAGE_GENERATION.apiMethodLabels.chat_completions"),
			).toBeEnabled()
			expect(
				screen.getByText(
					"settings:experimental.IMAGE_GENERATION.successConfigured(provider=OpenAI / OpenAI Compatible)",
				),
			).toBeInTheDocument()
		})

		it("should render optional API key and missing-model warning for local providers", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationSettings={{ imageGenerationProvider: "ollama" }}
				/>,
			)

			expect(
				screen.getByText("settings:experimental.IMAGE_GENERATION.optionalApiKeyLabel(provider=Ollama)"),
			).toBeInTheDocument()
			expect(
				screen.getByPlaceholderText("settings:experimental.IMAGE_GENERATION.customModelIdPlaceholder"),
			).toBeInTheDocument()
			expect(
				screen.getByText("settings:experimental.IMAGE_GENERATION.warningMissingModel(provider=Ollama)"),
			).toBeInTheDocument()
		})

		it("should not render provider configuration fields when disabled", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={false}
					imageGenerationSettings={{ imageGenerationProvider: "openrouter" }}
				/>,
			)

			expect(
				screen.queryByPlaceholderText(
					"settings:experimental.IMAGE_GENERATION.apiKeyPlaceholder(provider=OpenRouter)",
				),
			).not.toBeInTheDocument()
			expect(screen.queryByText("settings:experimental.IMAGE_GENERATION.providerLabel")).not.toBeInTheDocument()
		})
	})
})

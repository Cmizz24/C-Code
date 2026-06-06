import { fireEvent, render, screen, within } from "@testing-library/react"

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

		it("should update ComfyUI provider-specific fields", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationSettings={{
						imageGenerationProvider: "comfyui",
						comfyUiImageApiKey: "existing-comfyui-key",
						comfyUiImageBaseUrl: "http://127.0.0.1:8188",
						comfyUiImageGenerationSelectedModel: "sdxl.safetensors",
						comfyUiImageGenerationNegativePrompt: "blurry",
					}}
				/>,
			)

			fireEvent.change(
				screen.getByPlaceholderText(
					"settings:experimental.IMAGE_GENERATION.apiKeyPlaceholder(provider=ComfyUI)",
				),
				{ target: { value: "updated-comfyui-key" } },
			)
			fireEvent.change(
				screen.getByPlaceholderText(
					"settings:experimental.IMAGE_GENERATION.baseUrlPlaceholder(url=http://127.0.0.1:8188)",
				),
				{ target: { value: "http://localhost:8188" } },
			)
			fireEvent.change(screen.getByDisplayValue("sdxl.safetensors"), {
				target: { value: "juggernaut.safetensors" },
			})
			fireEvent.change(
				screen.getByPlaceholderText("settings:experimental.IMAGE_GENERATION.negativePromptPlaceholder"),
				{
					target: { value: "low quality" },
				},
			)

			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith("comfyUiImageApiKey", "updated-comfyui-key")
			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith("comfyUiImageBaseUrl", "http://localhost:8188")
			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith(
				"comfyUiImageGenerationSelectedModel",
				"juggernaut.safetensors",
			)
			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith(
				"comfyUiImageGenerationNegativePrompt",
				"low quality",
			)
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

		it("should render active provider choices only and normalize legacy local providers to OpenRouter", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationSettings={{ imageGenerationProvider: "ollama" }}
				/>,
			)

			const providerSelect = screen.getAllByRole("combobox")[0]
			expect(providerSelect).toHaveValue("openrouter")
			expect(
				within(providerSelect)
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual(["OpenRouter", "OpenAI / OpenAI Compatible", "ComfyUI", "Automatic1111"])
			expect(within(providerSelect).queryByRole("option", { name: "Ollama" })).not.toBeInTheDocument()
			expect(within(providerSelect).queryByRole("option", { name: "LM Studio" })).not.toBeInTheDocument()
			expect(screen.getByText("settings:experimental.IMAGE_GENERATION.localProviderNote")).toBeInTheDocument()
			expect(
				screen.getByPlaceholderText(
					"settings:experimental.IMAGE_GENERATION.apiKeyPlaceholder(provider=OpenRouter)",
				),
			).toBeInTheDocument()
			expect(
				screen.queryByText("settings:experimental.IMAGE_GENERATION.optionalApiKeyLabel(provider=Ollama)"),
			).not.toBeInTheDocument()
		})

		it("should render required local ComfyUI fields and missing-model warning", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationSettings={{ imageGenerationProvider: "comfyui" }}
				/>,
			)

			expect(
				screen.getByText("settings:experimental.IMAGE_GENERATION.optionalApiKeyLabel(provider=ComfyUI)"),
			).toBeInTheDocument()
			expect(
				screen.getByPlaceholderText(
					"settings:experimental.IMAGE_GENERATION.baseUrlPlaceholder(url=http://127.0.0.1:8188)",
				),
			).toBeInTheDocument()
			expect(
				screen.getByPlaceholderText("settings:experimental.IMAGE_GENERATION.customModelIdPlaceholder"),
			).toBeInTheDocument()
			expect(screen.getByText("settings:experimental.IMAGE_GENERATION.negativePromptLabel")).toBeInTheDocument()
			expect(
				screen.getByPlaceholderText("settings:experimental.IMAGE_GENERATION.negativePromptPlaceholder"),
			).toBeInTheDocument()
			expect(
				screen.getByDisplayValue("settings:experimental.IMAGE_GENERATION.apiMethodLabels.comfyui_api"),
			).toBeDisabled()
			expect(
				screen.getByText("settings:experimental.IMAGE_GENERATION.warningMissingModel(provider=ComfyUI)"),
			).toBeInTheDocument()
		})

		it("should render optional Automatic1111 model field without missing-model warning", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					imageGenerationSettings={{ imageGenerationProvider: "automatic1111" }}
				/>,
			)

			expect(
				screen.getByText("settings:experimental.IMAGE_GENERATION.optionalApiKeyLabel(provider=Automatic1111)"),
			).toBeInTheDocument()
			expect(
				screen.getByPlaceholderText(
					"settings:experimental.IMAGE_GENERATION.baseUrlPlaceholder(url=http://127.0.0.1:7860)",
				),
			).toBeInTheDocument()
			expect(
				screen.getByText("settings:experimental.IMAGE_GENERATION.optionalModelIdDescription"),
			).toBeInTheDocument()
			expect(screen.getByText("settings:experimental.IMAGE_GENERATION.negativePromptLabel")).toBeInTheDocument()
			expect(
				screen.getByDisplayValue("settings:experimental.IMAGE_GENERATION.apiMethodLabels.automatic1111_api"),
			).toBeDisabled()
			expect(
				screen.queryByText(
					"settings:experimental.IMAGE_GENERATION.warningMissingModel(provider=Automatic1111)",
				),
			).not.toBeInTheDocument()
			expect(
				screen.getByText("settings:experimental.IMAGE_GENERATION.successConfigured(provider=Automatic1111)"),
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

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

	const defaultProps = {
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
		it("should render dedicated image generation settings without an experiment toggle", () => {
			render(<ImageGenerationSettings {...defaultProps} />)

			expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.description")).toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.providerLabel")).toBeInTheDocument()
			expect(mockSetImageGenerationSetting).not.toHaveBeenCalled()
		})

		it("should update the provider-specific API key when user changes the OpenRouter API key", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationSettings={{ imageGenerationProvider: "openrouter" }}
				/>,
			)

			fireEvent.change(
				screen.getByPlaceholderText("settings:imageGeneration.apiKeyPlaceholder(provider=OpenRouter)"),
				{ target: { value: "new-openrouter-key" } },
			)

			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith("openRouterImageApiKey", "new-openrouter-key")
		})

		it("should update imageGenerationProvider when user changes providers", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
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
					"settings:imageGeneration.apiKeyPlaceholder(provider=OpenAI / OpenAI Compatible)",
				),
				{ target: { value: "updated-openai-key" } },
			)
			fireEvent.change(
				screen.getByPlaceholderText(
					"settings:imageGeneration.baseUrlPlaceholder(url=https://api.openai.com/v1)",
				),
				{ target: { value: "https://compatible.example/v1" } },
			)
			fireEvent.change(screen.getByDisplayValue("custom-image-model"), {
				target: { value: "updated-custom-model" },
			})
			fireEvent.change(screen.getByDisplayValue("settings:imageGeneration.apiMethodLabels.chat_completions"), {
				target: { value: "images_api" },
			})

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

		it("should update OpenRouter fields when a removed provider is saved", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationSettings={{
						imageGenerationProvider: "comfyui",
						openRouterImageApiKey: "existing-openrouter-key",
						openRouterImageBaseUrl: "https://openrouter.example/api/v1",
						comfyUiImageApiKey: "existing-comfyui-key",
					}}
				/>,
			)

			fireEvent.change(
				screen.getByPlaceholderText("settings:imageGeneration.apiKeyPlaceholder(provider=OpenRouter)"),
				{ target: { value: "updated-openrouter-key" } },
			)
			fireEvent.change(
				screen.getByPlaceholderText(
					"settings:imageGeneration.baseUrlPlaceholder(url=https://openrouter.ai/api/v1)",
				),
				{ target: { value: "https://openrouter.changed/api/v1" } },
			)

			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith(
				"openRouterImageApiKey",
				"updated-openrouter-key",
			)
			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith(
				"openRouterImageBaseUrl",
				"https://openrouter.changed/api/v1",
			)
			expect(mockSetImageGenerationSetting).not.toHaveBeenCalledWith("comfyUiImageApiKey", expect.any(String))
		})
	})

	describe("Conditional Rendering", () => {
		it("should render provider recommendation and visible limit guidance", () => {
			render(<ImageGenerationSettings {...defaultProps} />)

			expect(screen.getByText("settings:imageGeneration.recommendations.title")).toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.recommendations.description")).toBeInTheDocument()
			expect(
				screen.getByText("settings:imageGeneration.recommendations.rows.openrouter.provider"),
			).toBeInTheDocument()
			expect(
				screen.getByText("settings:imageGeneration.recommendations.rows.openaiCompatible.provider"),
			).toBeInTheDocument()
			expect(
				screen.getByText("settings:imageGeneration.recommendations.rows.googleAiStudio.limit"),
			).toBeInTheDocument()
			expect(
				screen.getByText("settings:imageGeneration.recommendations.rows.huggingFace.limit"),
			).toBeInTheDocument()
			expect(
				screen.getByText("settings:imageGeneration.recommendations.rows.stability.limit"),
			).toBeInTheDocument()
		})

		it("should render provider-specific fields when enabled is true and provider is OpenRouter", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationSettings={{ imageGenerationProvider: "openrouter" }}
				/>,
			)

			expect(
				screen.getByPlaceholderText("settings:imageGeneration.apiKeyPlaceholder(provider=OpenRouter)"),
			).toBeInTheDocument()
			expect(
				screen.getByPlaceholderText(
					"settings:imageGeneration.baseUrlPlaceholder(url=https://openrouter.ai/api/v1)",
				),
			).toBeInTheDocument()
			expect(screen.getAllByRole("combobox")).toHaveLength(3)
			expect(
				screen.getByText("settings:imageGeneration.warningMissingApiKey(provider=OpenRouter)"),
			).toBeInTheDocument()
		})

		it("should render custom model and unlocked API method fields for OpenAI-compatible image generation", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
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
					"settings:imageGeneration.apiKeyPlaceholder(provider=OpenAI / OpenAI Compatible)",
				),
			).toBeInTheDocument()
			expect(screen.getByDisplayValue("custom-image-model")).toBeInTheDocument()
			expect(screen.getByDisplayValue("settings:imageGeneration.apiMethodLabels.chat_completions")).toBeEnabled()
			expect(
				screen.getByText("settings:imageGeneration.successConfigured(provider=OpenAI / OpenAI Compatible)"),
			).toBeInTheDocument()
		})

		it("should render active provider choices only and normalize removed providers to OpenRouter", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationSettings={{ imageGenerationProvider: "automatic1111" }}
				/>,
			)

			const providerSelect = screen.getAllByRole("combobox")[0]
			expect(providerSelect).toHaveValue("openrouter")
			expect(
				within(providerSelect)
					.getAllByRole("option")
					.map((option) => option.textContent),
			).toEqual(["OpenRouter", "OpenAI / OpenAI Compatible"])
			expect(within(providerSelect).queryByRole("option", { name: "ComfyUI" })).not.toBeInTheDocument()
			expect(within(providerSelect).queryByRole("option", { name: "Automatic1111" })).not.toBeInTheDocument()
			expect(within(providerSelect).queryByRole("option", { name: "Ollama" })).not.toBeInTheDocument()
			expect(within(providerSelect).queryByRole("option", { name: "LM Studio" })).not.toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.providerDescription")).toBeInTheDocument()
			expect(
				screen.getByPlaceholderText("settings:imageGeneration.apiKeyPlaceholder(provider=OpenRouter)"),
			).toBeInTheDocument()
			expect(
				screen.queryByText("settings:imageGeneration.optionalApiKeyLabel(provider=Automatic1111)"),
			).not.toBeInTheDocument()
		})

		it("should not render removed ComfyUI configuration fields from stale settings", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationSettings={{
						imageGenerationProvider: "comfyui",
						comfyUiImageApiKey: "comfyui-key",
						comfyUiImageBaseUrl: "http://127.0.0.1:8188",
						comfyUiImageGenerationSelectedModel: "sdxl.safetensors",
					}}
				/>,
			)

			expect(
				screen.getByPlaceholderText("settings:imageGeneration.apiKeyPlaceholder(provider=OpenRouter)"),
			).toBeInTheDocument()
			expect(
				screen.queryByText("settings:imageGeneration.optionalApiKeyLabel(provider=ComfyUI)"),
			).not.toBeInTheDocument()
			expect(
				screen.queryByPlaceholderText("settings:imageGeneration.baseUrlPlaceholder(url=http://127.0.0.1:8188)"),
			).not.toBeInTheDocument()
			expect(screen.queryByText("settings:imageGeneration.negativePromptLabel")).not.toBeInTheDocument()
			expect(
				screen.queryByDisplayValue("settings:imageGeneration.apiMethodLabels.comfyui_api"),
			).not.toBeInTheDocument()
		})

		it("should not render removed Automatic1111 configuration fields from stale settings", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationSettings={{
						imageGenerationProvider: "automatic1111",
						automatic1111ImageBaseUrl: "http://127.0.0.1:7860",
						automatic1111ImageGenerationNegativePrompt: "bad anatomy",
					}}
				/>,
			)

			expect(
				screen.getByPlaceholderText("settings:imageGeneration.apiKeyPlaceholder(provider=OpenRouter)"),
			).toBeInTheDocument()
			expect(
				screen.queryByText("settings:imageGeneration.optionalApiKeyLabel(provider=Automatic1111)"),
			).not.toBeInTheDocument()
			expect(
				screen.queryByPlaceholderText("settings:imageGeneration.baseUrlPlaceholder(url=http://127.0.0.1:7860)"),
			).not.toBeInTheDocument()
			expect(screen.queryByText("settings:imageGeneration.negativePromptLabel")).not.toBeInTheDocument()
			expect(
				screen.queryByDisplayValue("settings:imageGeneration.apiMethodLabels.automatic1111_api"),
			).not.toBeInTheDocument()
		})

		it("should always render provider configuration fields in the dedicated settings panel", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationSettings={{ imageGenerationProvider: "openrouter" }}
				/>,
			)

			expect(
				screen.getByPlaceholderText("settings:imageGeneration.apiKeyPlaceholder(provider=OpenRouter)"),
			).toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.providerLabel")).toBeInTheDocument()
		})
	})
})

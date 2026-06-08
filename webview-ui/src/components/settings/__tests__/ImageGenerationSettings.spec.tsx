import { fireEvent, render, screen, within } from "@testing-library/react"

import { ImageGenerationSettings } from "../ImageGenerationSettings"

const mockUseRouterModels = vi.hoisted(() => vi.fn(() => ({ data: undefined as any })))

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

vi.mock("@src/components/ui/hooks/useRouterModels", () => ({
	useRouterModels: mockUseRouterModels,
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => {
			if (!options) {
				return key
			}

			const renderedOptions = Object.entries(options)
				.map(([optionKey, optionValue]) => `${optionKey}=${optionValue}`)
				.join(",")

			return `${key}(${renderedOptions})`
		},
		i18n: { language: "en" },
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
		mockUseRouterModels.mockReturnValue({ data: undefined })
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

		it("should update Cloudflare Workers AI provider-specific fields", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationSettings={{
						imageGenerationProvider: "cloudflare",
						cloudflareImageApiKey: "existing-cloudflare-token",
						cloudflareImageAccountId: "existing-account-id",
						cloudflareImageBaseUrl: "https://api.cloudflare.com/client/v4",
						cloudflareImageGenerationSelectedModel: "@cf/black-forest-labs/flux-1-schnell",
						cloudflareImageGenerationApiMethod: "workers_ai",
					}}
				/>,
			)

			fireEvent.change(
				screen.getByPlaceholderText(
					"settings:imageGeneration.apiKeyPlaceholder(provider=Cloudflare Workers AI)",
				),
				{ target: { value: "updated-cloudflare-token" } },
			)
			fireEvent.change(screen.getByPlaceholderText("settings:imageGeneration.cloudflareAccountIdPlaceholder"), {
				target: { value: "updated-account-id" },
			})
			fireEvent.change(
				screen.getByPlaceholderText(
					"settings:imageGeneration.baseUrlPlaceholder(url=https://api.cloudflare.com/client/v4)",
				),
				{ target: { value: "https://cloudflare.example/client/v4" } },
			)
			fireEvent.change(screen.getAllByRole("combobox")[1], {
				target: { value: "@cf/leonardo/phoenix-1.0" },
			})

			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith(
				"cloudflareImageApiKey",
				"updated-cloudflare-token",
			)
			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith("cloudflareImageAccountId", "updated-account-id")
			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith(
				"cloudflareImageBaseUrl",
				"https://cloudflare.example/client/v4",
			)
			expect(mockSetImageGenerationSetting).toHaveBeenCalledWith(
				"cloudflareImageGenerationSelectedModel",
				"@cf/leonardo/phoenix-1.0",
			)
			expect(screen.getByDisplayValue("settings:imageGeneration.apiMethodLabels.workers_ai")).toBeDisabled()
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
		it("should not render provider recommendation or visible free-limit guidance", () => {
			render(<ImageGenerationSettings {...defaultProps} />)

			expect(screen.queryByText("settings:imageGeneration.recommendations.title")).not.toBeInTheDocument()
			expect(screen.queryByText("settings:imageGeneration.recommendations.description")).not.toBeInTheDocument()
			expect(
				screen.queryByText("settings:imageGeneration.recommendations.rows.openrouter.provider"),
			).not.toBeInTheDocument()
			expect(
				screen.queryByText("settings:imageGeneration.recommendations.rows.openaiCompatible.provider"),
			).not.toBeInTheDocument()
			expect(
				screen.queryByText("settings:imageGeneration.recommendations.rows.googleAiStudio.limit"),
			).not.toBeInTheDocument()
			expect(
				screen.queryByText("settings:imageGeneration.recommendations.rows.huggingFace.limit"),
			).not.toBeInTheDocument()
			expect(
				screen.queryByText("settings:imageGeneration.recommendations.rows.stability.limit"),
			).not.toBeInTheDocument()
		})

		it("should render dynamic user-available OpenRouter image models separately from static choices", () => {
			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {
						"google/gemini-2.5-flash-image-preview": {
							maxTokens: 8192,
							contextWindow: 128000,
							supportsImages: true,
							supportsImageOutput: true,
							supportsPromptCache: false,
						},
						"google/imagen-4": {
							maxTokens: 8192,
							contextWindow: 32000,
							supportsImages: false,
							supportsImageOutput: true,
							supportsPromptCache: false,
						},
					},
				},
			})

			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationSettings={{
						imageGenerationProvider: "openrouter",
						openRouterImageBaseUrl: "https://openrouter.example/api/v1",
						openRouterImageApiKey: "openrouter-image-key",
					}}
				/>,
			)

			expect(mockUseRouterModels).toHaveBeenCalledWith({
				provider: "openrouter",
				modelType: "image",
				values: {
					openRouterImageBaseUrl: "https://openrouter.example/api/v1",
					openRouterImageApiKey: "openrouter-image-key",
				},
				enabled: true,
			})

			const modelSelect = screen.getAllByRole("combobox")[1]
			expect(
				within(modelSelect).getByRole("option", { name: "google/gemini-2.5-flash-image-preview" }),
			).toBeInTheDocument()
			expect(within(modelSelect).getByRole("option", { name: "google/imagen-4" })).toBeInTheDocument()
			expect(
				within(modelSelect).getByRole("option", { name: "Gemini 2.5 Flash Image (Paid)" }),
			).toBeInTheDocument()
			expect(
				within(modelSelect).getByRole("option", { name: "google/gemini-2.5-flash-image-preview" }),
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

		it("should render Cloudflare account, locked Workers AI method, and pricing guidance", () => {
			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationSettings={{
						imageGenerationProvider: "cloudflare",
						cloudflareImageApiKey: "cloudflare-token",
					}}
				/>,
			)

			expect(
				screen.getByPlaceholderText(
					"settings:imageGeneration.apiKeyPlaceholder(provider=Cloudflare Workers AI)",
				),
			).toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.cloudflareAccountIdLabel")).toBeInTheDocument()
			expect(
				screen.getByPlaceholderText("settings:imageGeneration.cloudflareAccountIdPlaceholder"),
			).toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.cloudflareAccountIdDescription")).toBeInTheDocument()
			expect(
				screen.getByText(
					"settings:imageGeneration.cloudflareBaseUrlDescription(url=https://api.cloudflare.com/client/v4)",
				),
			).toBeInTheDocument()
			expect(screen.getByDisplayValue("settings:imageGeneration.apiMethodLabels.workers_ai")).toBeDisabled()
			expect(screen.getByText("settings:imageGeneration.cloudflareApiMethodDescription")).toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.cloudflarePricing.title")).toBeInTheDocument()
			expect(
				screen.getByText(
					"settings:imageGeneration.cloudflarePricing.quotaDescription(freeAllocation=10,000 Neurons per day,resetTime=00:00 UTC,paidOverage=$0.011 / 1,000 Neurons)",
				),
			).toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.cloudflarePricing.modelColumn")).toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.cloudflarePricing.priceColumn")).toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.cloudflarePricing.neuronsColumn")).toBeInTheDocument()
			expect(screen.getAllByText("FLUX.1 Schnell")).toHaveLength(2)
			expect(screen.getByText("@cf/black-forest-labs/flux-1-schnell")).toBeInTheDocument()
			expect(
				screen.getByText("settings:imageGeneration.warningMissingAccountId(provider=Cloudflare Workers AI)"),
			).toBeInTheDocument()
		})

		it("should render locally estimated Cloudflare Workers AI usage left", () => {
			const utcDate = new Date().toISOString().slice(0, 10)

			render(
				<ImageGenerationSettings
					{...defaultProps}
					imageGenerationSettings={{
						imageGenerationProvider: "cloudflare",
						cloudflareImageApiKey: "cloudflare-token",
						cloudflareImageAccountId: "account-123",
					}}
					cloudflareWorkersAiImageUsage={{
						utcDate,
						neuronsUsed: 1_250,
						requestCount: 3,
						estimatedNeuronsUsed: 1_250,
						updatedAt: `${utcDate}T08:00:00.000Z`,
					}}
				/>,
			)

			expect(screen.getByText("settings:imageGeneration.cloudflareUsage.title")).toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.cloudflareUsage.remainingLabel")).toBeInTheDocument()
			expect(
				screen.getByText("settings:imageGeneration.cloudflareUsage.neuronsValue(count=8,750)"),
			).toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.cloudflareUsage.usedLabel")).toBeInTheDocument()
			expect(
				screen.getByText("settings:imageGeneration.cloudflareUsage.usedValue(used=1,250,quota=10,000)"),
			).toBeInTheDocument()
			expect(screen.getByText("settings:imageGeneration.cloudflareUsage.requestsLabel")).toBeInTheDocument()
			expect(screen.getByText("3")).toBeInTheDocument()
			expect(
				screen.getByText("settings:imageGeneration.cloudflareUsage.localEstimateDescription"),
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
			).toEqual(["OpenRouter", "OpenAI / OpenAI Compatible", "Cloudflare Workers AI"])
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

import React from "react"

import { act, render, screen, waitFor } from "@/utils/test-utils"
import { openAiModelInfoSaneDefaults, type ModelInfo, type ProviderSettings } from "@roo-code/types"

import { VSCodeLM } from "../VSCodeLM"

const mocks = vi.hoisted(() => ({
	modelPicker: vi.fn(),
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("../../ModelPicker", () => ({
	ModelPicker: (props: any) => {
		mocks.modelPicker(props)
		return <div data-testid="model-picker">Model Picker</div>
	},
}))

describe("VSCodeLM", () => {
	const mockSetApiConfigurationField = vi.fn()

	const renderVSCodeLM = (apiConfiguration: Partial<ProviderSettings> = {}) =>
		render(
			<VSCodeLM
				apiConfiguration={apiConfiguration as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
			/>,
		)

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the description while no VS Code LM models have been loaded", () => {
		renderVSCodeLM()

		expect(screen.getByText("settings:providers.vscodeLmModel")).toBeInTheDocument()
		expect(screen.getByText("settings:providers.vscodeLmDescription")).toBeInTheDocument()
		expect(screen.getByText("settings:providers.vscodeLmWarning")).toBeInTheDocument()
		expect(screen.queryByTestId("model-picker")).not.toBeInTheDocument()
	})

	it("builds conservative model picker metadata from VS Code LM model messages", async () => {
		renderVSCodeLM()

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "vsCodeLmModels",
						vsCodeLmModels: [
							{
								vendor: "copilot",
								id: "model/id",
							},
							{
								vendor: "copilot/chat",
								family: "gpt 4",
								version: "2024/10",
								id: "model/id?",
							},
						],
					},
				}),
			)
		})

		await waitFor(() => expect(screen.getByTestId("model-picker")).toBeInTheDocument())

		const modelPickerProps = mocks.modelPicker.mock.calls.at(-1)?.[0]
		expect(modelPickerProps).toMatchObject({
			defaultModelId: "",
			modelIdKey: "vsCodeLmModelSelector",
			serviceName: "VS Code LM",
			hidePricing: true,
		})

		expect(Object.keys(modelPickerProps.models)).toEqual([
			"copilot///model%2Fid",
			"copilot%2Fchat/gpt%204/2024%2F10/model%2Fid%3F",
		])

		const sparseSelectorInfo = modelPickerProps.models["copilot///model%2Fid"] as ModelInfo
		expect(sparseSelectorInfo).toEqual({
			...openAiModelInfoSaneDefaults,
			supportsImages: false,
			supportsPromptCache: false,
			description: "copilot - model/id",
		})
		expect(sparseSelectorInfo).not.toHaveProperty("maxTokens")
		expect(sparseSelectorInfo).not.toHaveProperty("inputPrice")
		expect(sparseSelectorInfo).not.toHaveProperty("outputPrice")

		const encodedSelectorInfo = modelPickerProps.models[
			"copilot%2Fchat/gpt%204/2024%2F10/model%2Fid%3F"
		] as ModelInfo
		expect(encodedSelectorInfo).toEqual({
			...openAiModelInfoSaneDefaults,
			supportsImages: false,
			supportsPromptCache: false,
			description: "copilot/chat - gpt 4 - 2024/10 - model/id?",
		})
		expect(encodedSelectorInfo).not.toHaveProperty("maxTokens")
		expect(encodedSelectorInfo).not.toHaveProperty("inputPrice")
		expect(encodedSelectorInfo).not.toHaveProperty("outputPrice")
	})

	it("round-trips selector values through model picker transforms", async () => {
		renderVSCodeLM({
			vsCodeLmModelSelector: {
				vendor: "copilot",
				id: "model/id",
			},
		})

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "vsCodeLmModels",
						vsCodeLmModels: [
							{
								vendor: "copilot",
								id: "model/id",
							},
						],
					},
				}),
			)
		})

		await waitFor(() => expect(screen.getByTestId("model-picker")).toBeInTheDocument())

		const modelPickerProps = mocks.modelPicker.mock.calls.at(-1)?.[0]
		expect(modelPickerProps.valueTransform("copilot///model%2Fid")).toEqual({
			vendor: "copilot",
			id: "model/id",
		})
		expect(
			modelPickerProps.displayTransform({
				vendor: "copilot",
				id: "model/id",
			}),
		).toBe("copilot///model%2Fid")
	})
})

import React from "react"
import { cleanup, fireEvent, render, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"
import type { ClineMessage, ClineSayTool, GeneratedImageMetadata } from "@roo-code/types"

const { getStateMock, postMessageMock, setStateMock } = vi.hoisted(() => ({
	getStateMock: vi.fn(() => undefined),
	postMessageMock: vi.fn(),
	setStateMock: vi.fn((state) => state),
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		getState: getStateMock,
		postMessage: postMessageMock,
		setState: setStateMock,
	},
}))

vi.mock("@src/components/agents/AgentStatusPanel", () => ({
	AgentStatusPanel: ({ tool }: { tool: ClineSayTool }) => (
		<section data-testid="agent-status-panel">{tool.executionPlan?.planId}</section>
	),
}))

vi.mock("../../common/ImageBlock", () => ({
	default: ({ imageUri, imagePath }: { imageUri?: string; imagePath?: string }) => (
		<div data-testid="image-block">
			{imageUri}:{imagePath}
		</div>
	),
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, string>) => {
			if (key === "chat:imageGeneration.statusTitle") {
				return `Image Generation ${options?.status ?? ""}`.trim()
			}

			return key
		},
		i18n: { exists: () => true, language: "en" },
	}),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

function renderChatRow(message: ClineMessage, onImageApprovalGenerate = vi.fn()) {
	const queryClient = new QueryClient()

	const renderResult = render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={message}
					isExpanded={false}
					isLast={false}
					isStreaming={false}
					onToggleExpand={() => {}}
					onImageApprovalGenerate={onImageApprovalGenerate}
					onSuggestionClick={() => {}}
					onBatchFileResponse={() => {}}
					onFollowUpUnmount={() => {}}
					isFollowUpAnswered={false}
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)

	return { ...renderResult, onImageApprovalGenerate }
}

const createImageGenerationSayMessage = (
	metadata: GeneratedImageMetadata,
	options: { imageUri?: string; imagePath?: string; tool?: "generateImage" | "imageGenerated" } = {},
): ClineMessage => ({
	type: "say",
	say: "tool",
	ts: Date.now(),
	text: JSON.stringify({
		tool: options.tool ?? "generateImage",
		content: metadata.prompt,
		path: metadata.outputPath ?? metadata.path,
		imageGeneration: metadata,
		...(options.imageUri && { imageUri: options.imageUri }),
		...(options.imagePath && { imagePath: options.imagePath }),
	}),
})

describe("ChatRow - image generation", () => {
	beforeEach(() => {
		getStateMock.mockClear()
		postMessageMock.mockClear()
		setStateMock.mockClear()
	})

	afterEach(() => {
		cleanup()
	})

	it.each(["pending", "running", "completed", "error"] as const)(
		"renders %s image-generation status rows",
		(status) => {
			renderChatRow(
				createImageGenerationSayMessage({
					status,
					prompt: `${status} prompt`,
					path: `images/${status}.png`,
					...(status === "error" ? { error: "Provider failed" } : {}),
				}),
			)

			expect(screen.getByText(`Image Generation chat:imageGeneration.status.${status}`)).toBeInTheDocument()
			expect(screen.getByText(`images/${status}.png`)).toBeInTheDocument()
			expect(screen.queryByText(`${status} prompt`)).not.toBeInTheDocument()
			if (status === "error") {
				expect(screen.getByText("Provider failed")).toBeInTheDocument()
			}
		},
	)

	it("renders the completed image preview, output path, and cost inside the unified image-generation tool row", () => {
		renderChatRow(
			createImageGenerationSayMessage(
				{
					status: "completed",
					prompt: "Draw a corgi in space",
					providerLabel: "OpenRouter",
					model: "google/gemini-2.5-flash-image-preview",
					outputPath: "images/corgi.png",
					imageFormat: "png",
					usage: {
						cost: 0.0042,
						currency: "USD",
					},
				},
				{
					imageUri: "vscode-resource://generated-corgi.png?t=123",
					imagePath: "/workspace/images/corgi.png",
				},
			),
		)

		expect(screen.getByTestId("image-block")).toHaveTextContent(
			"vscode-resource://generated-corgi.png?t=123:/workspace/images/corgi.png",
		)
		expect(screen.getByText("Image Generation chat:imageGeneration.status.completed")).toBeInTheDocument()
		expect(screen.getByText("OpenRouter")).toBeInTheDocument()
		expect(screen.getByText("google/gemini-2.5-flash-image-preview")).toBeInTheDocument()
		expect(screen.getByText("images/corgi.png")).toBeInTheDocument()
		expect(screen.getByText("$0.0042")).toBeInTheDocument()
		expect(screen.queryByText("Draw a corgi in space")).not.toBeInTheDocument()
	})

	it("renders compact proposed details and an editable prompt for image-generation approval", () => {
		const message: ClineMessage = {
			type: "ask",
			ask: "tool",
			ts: Date.now(),
			text: JSON.stringify({
				tool: "generateImage",
				content: "Paint a red fox in watercolor",
				path: "images/fox.png",
				imageGeneration: {
					status: "pending",
					prompt: "Paint a red fox in watercolor",
					provider: "openrouter",
					providerLabel: "OpenRouter",
					model: "google/gemini-2.5-flash-image-preview",
					baseURL: "https://user:secret@example.com/api/v1?api_key=hidden#fragment",
					apiMethod: "chat_completions",
					isLocal: false,
					outputPath: "images/fox.png",
					inputImage: "assets/sketch.png",
					imageFormat: "png",
					usage: { tokensIn: 12, totalTokens: 13 },
				} satisfies GeneratedImageMetadata,
			}),
		}

		const { container, onImageApprovalGenerate } = renderChatRow(message)

		expect(screen.getByText("chat:fileOperations.wantsToGenerateImage")).toBeInTheDocument()
		expect(screen.getByText("chat:imageGeneration.approval.editPromptHint")).toBeInTheDocument()
		const promptEditor = screen.getByLabelText("chat:imageGeneration.approval.promptLabel")
		expect(promptEditor).toHaveValue("Paint a red fox in watercolor")
		expect(screen.getByText("OpenRouter")).toBeInTheDocument()
		expect(screen.getByText("google/gemini-2.5-flash-image-preview")).toBeInTheDocument()
		expect(screen.getByText("images/fox.png")).toBeInTheDocument()
		expect(screen.getByText("assets/sketch.png")).toBeInTheDocument()
		expect(screen.getByText("12")).toBeInTheDocument()
		expect(screen.getByText("13")).toBeInTheDocument()
		expect(screen.queryByText("chat:imageGeneration.metadata.cost")).not.toBeInTheDocument()
		expect(screen.queryByText("https://example.com/api/v1")).not.toBeInTheDocument()
		expect(screen.queryByText("chat:imageGeneration.metadata.remoteEndpoint")).not.toBeInTheDocument()
		expect(screen.queryByText("chat:imageGeneration.apiMethods.chat_completions")).not.toBeInTheDocument()
		expect(container).not.toHaveTextContent("secret")
		expect(container).not.toHaveTextContent("api_key")

		fireEvent.change(promptEditor, { target: { value: "Paint a blue fox in watercolor" } })
		fireEvent.click(screen.getByRole("button", { name: "chat:imageGeneration.approval.generate" }))

		expect(onImageApprovalGenerate).toHaveBeenCalledWith("Paint a blue fox in watercolor")
	})

	it("renders compact completed metadata and hides verbose prompt details until expanded", () => {
		const { container } = renderChatRow(
			createImageGenerationSayMessage({
				status: "completed",
				prompt: "Final provider prompt",
				originalPrompt: "Use the original prompt",
				editedPrompt: "Use the edited prompt",
				provider: "openai",
				providerLabel: "OpenAI",
				model: "gpt-image-1",
				baseURL: "http://127.0.0.1:8188?token=hidden",
				apiMethod: "images_api",
				isLocal: true,
				outputPath: "images/edited.png",
				imageFormat: "webp",
				usage: {
					tokensIn: 10,
					tokensOut: 20,
					totalTokens: 30,
					imageCount: 1,
					cost: 0.0025,
					currency: "USD",
				},
			}),
		)

		expect(screen.getByText("Image Generation chat:imageGeneration.status.completed")).toBeInTheDocument()
		expect(screen.getByText("OpenAI")).toBeInTheDocument()
		expect(screen.getByText("gpt-image-1")).toBeInTheDocument()
		expect(screen.getByText("images/edited.png")).toBeInTheDocument()
		expect(screen.getByText("webp")).toBeInTheDocument()
		expect(screen.getByText("$0.0025")).toBeInTheDocument()
		expect(screen.queryByText("Final provider prompt")).not.toBeInTheDocument()
		expect(screen.queryByText("Use the edited prompt")).not.toBeInTheDocument()
		expect(screen.queryByText("Use the original prompt")).not.toBeInTheDocument()
		expect(screen.queryByText("http://127.0.0.1:8188")).not.toBeInTheDocument()
		expect(screen.queryByText("chat:imageGeneration.metadata.localEndpoint")).not.toBeInTheDocument()
		expect(screen.queryByText("chat:imageGeneration.apiMethods.images_api")).not.toBeInTheDocument()
		expect(container).not.toHaveTextContent("hidden")

		fireEvent.click(screen.getByRole("button", { name: "chat:imageGeneration.metadata.showDetails" }))

		expect(screen.getByText("Final provider prompt")).toBeInTheDocument()
		expect(screen.getByText("Use the edited prompt")).toBeInTheDocument()
		expect(screen.getByText("Use the original prompt")).toBeInTheDocument()
		expect(screen.getByText("http://127.0.0.1:8188")).toBeInTheDocument()
		expect(screen.getByText("chat:imageGeneration.metadata.localEndpoint")).toBeInTheDocument()
		expect(screen.getByText("chat:imageGeneration.apiMethods.images_api")).toBeInTheDocument()
	})

	it("renders generated image payload metadata compactly without duplicate verbose details", () => {
		const message: ClineMessage = {
			type: "say",
			say: "image",
			ts: Date.now(),
			text: JSON.stringify({
				imageUri: "vscode-resource://generated-image",
				imagePath: "images/dog.png",
				imageGeneration: {
					status: "error",
					prompt: "Draw a dog",
					providerLabel: "Automatic1111",
					baseURL: "http://user:pass@localhost:7860/sdapi/v1/txt2img?secret=hidden#fragment",
					isLocal: true,
					path: "images/dog.png",
					error: "Provider returned invalid image data",
				} satisfies GeneratedImageMetadata,
			}),
		}

		const { container } = renderChatRow(message)

		expect(screen.getByTestId("image-block")).toHaveTextContent("vscode-resource://generated-image:images/dog.png")
		expect(screen.getByText("Image Generation chat:imageGeneration.status.error")).toBeInTheDocument()
		expect(screen.getByText("Automatic1111")).toBeInTheDocument()
		expect(screen.getByText("Provider returned invalid image data")).toBeInTheDocument()
		expect(screen.queryByText("Draw a dog")).not.toBeInTheDocument()
		expect(screen.queryByText("http://localhost:7860/sdapi/v1/txt2img")).not.toBeInTheDocument()
		expect(container).not.toHaveTextContent("pass")
		expect(container).not.toHaveTextContent("secret")
	})
})

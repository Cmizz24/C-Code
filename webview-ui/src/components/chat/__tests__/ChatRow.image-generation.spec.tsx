import React from "react"
import { cleanup, render, screen } from "@/utils/test-utils"
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

function renderChatRow(message: ClineMessage) {
	const queryClient = new QueryClient()

	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={message}
					isExpanded={false}
					isLast={false}
					isStreaming={false}
					onToggleExpand={() => {}}
					onSuggestionClick={() => {}}
					onBatchFileResponse={() => {}}
					onFollowUpUnmount={() => {}}
					isFollowUpAnswered={false}
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

const createImageGenerationSayMessage = (metadata: GeneratedImageMetadata): ClineMessage => ({
	type: "say",
	say: "tool",
	ts: Date.now(),
	text: JSON.stringify({
		tool: "imageGenerated",
		content: metadata.prompt,
		path: metadata.outputPath ?? metadata.path,
		imageGeneration: metadata,
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
			expect(screen.getByText(`${status} prompt`)).toBeInTheDocument()
			expect(screen.getByText(`images/${status}.png`)).toBeInTheDocument()
			if (status === "error") {
				expect(screen.getByText("Provider failed")).toBeInTheDocument()
			}
		},
	)

	it("renders proposed prompt details for image-generation approval without showing missing cost", () => {
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

		const { container } = renderChatRow(message)

		expect(screen.getByText("chat:fileOperations.wantsToGenerateImage")).toBeInTheDocument()
		expect(screen.getByText("chat:imageGeneration.approval.editPromptHint")).toBeInTheDocument()
		expect(screen.getByText("Paint a red fox in watercolor")).toBeInTheDocument()
		expect(screen.getByText("OpenRouter")).toBeInTheDocument()
		expect(screen.getByText("google/gemini-2.5-flash-image-preview")).toBeInTheDocument()
		expect(screen.getByText("https://example.com/api/v1")).toBeInTheDocument()
		expect(screen.getByText("chat:imageGeneration.metadata.remoteEndpoint")).toBeInTheDocument()
		expect(screen.getByText("chat:imageGeneration.apiMethods.chat_completions")).toBeInTheDocument()
		expect(screen.getByText("images/fox.png")).toBeInTheDocument()
		expect(screen.getByText("assets/sketch.png")).toBeInTheDocument()
		expect(screen.getByText("12")).toBeInTheDocument()
		expect(screen.getByText("13")).toBeInTheDocument()
		expect(screen.queryByText("chat:imageGeneration.metadata.cost")).not.toBeInTheDocument()
		expect(container).not.toHaveTextContent("secret")
		expect(container).not.toHaveTextContent("api_key")
	})

	it("renders completed provider metadata and only displays returned cost details", () => {
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
		expect(screen.getByText("Final provider prompt")).toBeInTheDocument()
		expect(screen.getByText("Use the edited prompt")).toBeInTheDocument()
		expect(screen.getByText("Use the original prompt")).toBeInTheDocument()
		expect(screen.getByText("OpenAI")).toBeInTheDocument()
		expect(screen.getByText("gpt-image-1")).toBeInTheDocument()
		expect(screen.getByText("http://127.0.0.1:8188")).toBeInTheDocument()
		expect(screen.getByText("chat:imageGeneration.metadata.localEndpoint")).toBeInTheDocument()
		expect(screen.getByText("chat:imageGeneration.apiMethods.images_api")).toBeInTheDocument()
		expect(screen.getByText("images/edited.png")).toBeInTheDocument()
		expect(screen.getByText("webp")).toBeInTheDocument()
		expect(screen.getByText("$0.0025")).toBeInTheDocument()
		expect(container).not.toHaveTextContent("hidden")
	})

	it("renders generated image payload metadata with sanitized endpoint and error details", () => {
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
		expect(screen.getByText("Draw a dog")).toBeInTheDocument()
		expect(screen.getByText("Automatic1111")).toBeInTheDocument()
		expect(screen.getByText("http://localhost:7860/sdapi/v1/txt2img")).toBeInTheDocument()
		expect(screen.getByText("Provider returned invalid image data")).toBeInTheDocument()
		expect(container).not.toHaveTextContent("pass")
		expect(container).not.toHaveTextContent("secret")
	})
})

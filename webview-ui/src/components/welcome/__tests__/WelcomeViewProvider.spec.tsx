// npx vitest src/components/welcome/__tests__/WelcomeViewProvider.spec.tsx

import { render, screen, fireEvent, waitFor, within } from "@/utils/test-utils"
import userEvent from "@testing-library/user-event"
import { openRouterDefaultModelId } from "@roo-code/types"

import * as ExtensionStateContext from "@src/context/ExtensionStateContext"
const { ExtensionStateContextProvider } = ExtensionStateContext

import WelcomeViewProvider from "../WelcomeViewProvider"
import { vscode } from "@src/utils/vscode"

vi.mock("../../settings/ApiOptions", () => ({
	default: ({ apiConfiguration }: any) => (
		<div
			data-testid="api-options"
			data-provider={apiConfiguration.apiProvider}
			data-model={apiConfiguration.openRouterModelId}>
			API Options Component
		</div>
	),
}))

vi.mock("../../common/Tab", () => ({
	Tab: ({ children }: any) => <div data-testid="tab">{children}</div>,
	TabContent: ({ children, className, ...props }: any) => (
		<div data-testid="tab-content" className={className} {...props}>
			{children}
		</div>
	),
}))

vi.mock("../RooHero", () => ({
	default: () => <div data-testid="roo-hero">Roo Hero</div>,
}))

vi.mock("lucide-react", () => ({
	ArrowLeft: () => <span data-testid="arrow-left-icon">left</span>,
	Brain: () => <span data-testid="brain-icon">brain</span>,
	Check: () => <span data-testid="check-icon">check</span>,
	ChevronDown: () => <span data-testid="chevron-down-icon">chevron</span>,
	X: () => <span data-testid="x-icon">x</span>,
	AlertTriangle: () => <span data-testid="alert-icon">alert</span>,
	CheckCircle2: () => <span data-testid="check-circle-icon">check</span>,
	Download: () => <span data-testid="download-icon">download</span>,
	ExternalLink: () => <span data-testid="external-icon">external</span>,
	RefreshCcw: () => <span data-testid="refresh-icon">refresh</span>,
	Server: () => <span data-testid="server-icon">server</span>,
	ShieldCheck: () => <span data-testid="shield-icon">shield</span>,
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children }: any) => <span data-testid={`trans-${i18nKey}`}>{children || i18nKey}</span>,
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

const renderWelcomeViewProvider = (extensionState = {}) => {
	const useExtensionStateMock = vi.spyOn(ExtensionStateContext, "useExtensionState")
	const setApiConfiguration = vi.fn()
	useExtensionStateMock.mockReturnValue({
		apiConfiguration: {},
		currentApiConfigName: "default",
		setApiConfiguration,
		uriScheme: "vscode",
		...extensionState,
	} as any)

	render(
		<ExtensionStateContextProvider>
			<WelcomeViewProvider />
		</ExtensionStateContextProvider>,
	)

	return { useExtensionStateMock, setApiConfiguration }
}

const dispatchExtensionMessage = (data: any) => {
	window.dispatchEvent(new MessageEvent("message", { data }))
}

const openProviderDropdown = async () => {
	const user = userEvent.setup()
	await user.click(screen.getByTestId("welcome-provider-select"))
	return { user, listbox: await screen.findByRole("listbox") }
}

const selectWelcomeProvider = async (providerLabel: string) => {
	const { user, listbox } = await openProviderDropdown()
	await user.click(within(listbox).getByText(providerLabel))
	return user
}

const openLocalAiSetup = () => {
	fireEvent.click(screen.getByTestId("local-ai-option-card"))
}

const mockProbe = {
	os: "win32",
	arch: "x64",
	cpu: { model: "Test CPU", count: 8 },
	memory: { totalBytes: 16 * 1024 ** 3, totalGb: 16 },
	disk: { status: "known", freeBytes: 80 * 1024 ** 3, freeGb: 80, path: "C:" },
	gpu: { status: "unknown", names: [] },
	runtimes: {
		ollama: { provider: "ollama", displayName: "Ollama", baseUrl: "http://localhost:11434", status: "running" },
		lmStudio: {
			provider: "lmstudio",
			displayName: "LM Studio",
			baseUrl: "http://localhost:1234",
			status: "unknown",
		},
	},
	probedAt: "2026-01-01T00:00:00.000Z",
}

const mockRecommendation = {
	provider: "ollama",
	recommendedSetup: "local",
	runtimeDisplayName: "Ollama",
	baseUrl: "http://localhost:11434",
	model: {
		provider: "ollama",
		tag: "qwen2.5-coder:7b",
		displayName: "Qwen2.5 Coder 7B",
		description: "Standard local coder model",
		approximateSizeGb: 4.7,
		minimumRamGb: 12,
		recommendedRamGb: 16,
		tier: "standard",
		defaultNumCtx: 8192,
	},
	ollamaNumCtx: 8192,
	confidence: "high",
	reasons: ["Detected about 16 GB RAM and 8 CPU cores."],
	hasWeakHardwareWarning: false,
	warnings: [],
	freeDiskGb: 80,
	diskBudgetGb: 8,
	privacyNote: "Inference runs locally once Ollama and the selected model are installed.",
}

const mockWeakRecommendation = {
	...mockRecommendation,
	recommendedSetup: "local",
	model: {
		...mockRecommendation.model,
		tag: "qwen2.5-coder:1.5b",
		displayName: "Qwen2.5 Coder 1.5B",
		description: "Fast local coder model",
		approximateSizeGb: 1.1,
		minimumRamGb: 4,
		recommendedRamGb: 8,
		tier: "tiny",
		defaultNumCtx: 4096,
	},
	ollamaNumCtx: undefined,
	confidence: "low",
	reasons: ["Detected about 7.7 GB RAM and 8 CPU cores."],
	hasWeakHardwareWarning: true,
	warnings: [],
}

describe("WelcomeViewProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the landing screen by default", () => {
		renderWelcomeViewProvider()

		expect(screen.getByText(/welcome:landing.greeting/)).toBeInTheDocument()
		expect(screen.getByTestId("welcome-startup-content")).toHaveClass("pt-8")
		expect(screen.getByTestId("trans-welcome:landing.introduction")).toBeInTheDocument()
		expect(screen.getByText(/welcome:landing.localAi.title/)).toBeInTheDocument()
		expect(screen.getByText(/welcome:landing.provider.title/)).toBeInTheDocument()
		expect(screen.getByTestId("local-ai-option-card")).toBeInTheDocument()
		expect(screen.getByTestId("api-provider-option-card")).toBeInTheDocument()
		expect(screen.getByText(/welcome:importSettings/)).toBeInTheDocument()
	})

	it("does not render duplicate bottom Get Started or Set up local AI buttons on the landing screen", () => {
		renderWelcomeViewProvider()

		expect(screen.queryByText(/welcome:landing.getStarted/)).not.toBeInTheDocument()
		expect(screen.queryByText(/welcome:landing.setupLocalAi/)).not.toBeInTheDocument()
	})

	it("keeps the API provider dropdown closed until opened", () => {
		renderWelcomeViewProvider()

		expect(screen.getByTestId("welcome-provider-select")).toHaveAttribute("aria-expanded", "false")
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
		expect(screen.queryByText("Anthropic")).not.toBeInTheDocument()
	})

	it("shows available API providers when the landing dropdown is opened", async () => {
		renderWelcomeViewProvider()

		const { listbox } = await openProviderDropdown()

		expect(screen.getByTestId("welcome-provider-select")).toHaveAttribute("aria-expanded", "true")
		expect(within(listbox).getByText("OpenRouter")).toBeInTheDocument()
		expect(within(listbox).getByText("Anthropic")).toBeInTheDocument()
		expect(within(listbox).getByText("OpenAI")).toBeInTheDocument()
		expect(within(listbox).getByText("Ollama")).toBeInTheDocument()
		expect(within(listbox).getByText("LM Studio")).toBeInTheDocument()
	})

	it("opens provider setup with the selected provider preselected", async () => {
		const { setApiConfiguration } = renderWelcomeViewProvider()

		await selectWelcomeProvider("Anthropic")

		expect(screen.getByTestId("api-options")).toBeInTheDocument()
		expect(screen.getByTestId("api-options")).toHaveAttribute("data-provider", "anthropic")
		expect(setApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				apiProvider: "anthropic",
			}),
		)
		expect(screen.getByTestId("trans-welcome:providerSignup.chooseProvider")).toBeInTheDocument()
		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "upsertApiConfiguration" }))
	})

	it("opens provider setup when OpenRouter is selected", async () => {
		const { setApiConfiguration } = renderWelcomeViewProvider()

		await selectWelcomeProvider("OpenRouter")

		expect(screen.getByTestId("welcome-startup-content")).toHaveClass("pt-8")
		expect(screen.getByRole("heading", { name: /welcome:providerSignup.heading/ })).toBeInTheDocument()
		expect(screen.getByTestId("api-options")).toBeInTheDocument()
		expect(screen.getByTestId("api-options")).toHaveAttribute("data-provider", "openrouter")
		expect(screen.getByTestId("api-options")).toHaveAttribute("data-model", openRouterDefaultModelId)
		expect(setApiConfiguration).toHaveBeenCalledWith({
			apiProvider: "openrouter",
			openRouterModelId: openRouterDefaultModelId,
		})
		expect(screen.getByTestId("trans-welcome:providerSignup.chooseProvider")).toBeInTheDocument()
		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "upsertApiConfiguration" }))
	})

	it("treats the built-in Anthropic default as empty onboarding config", async () => {
		const { setApiConfiguration } = renderWelcomeViewProvider({
			apiConfiguration: {
				apiProvider: "anthropic",
				apiModelId: "claude-sonnet-4-5",
			},
		})

		await selectWelcomeProvider("OpenRouter")

		expect(screen.getByTestId("api-options")).toHaveAttribute("data-provider", "openrouter")
		expect(screen.getByTestId("api-options")).toHaveAttribute("data-model", openRouterDefaultModelId)
		expect(setApiConfiguration).toHaveBeenCalledWith({
			apiProvider: "openrouter",
			openRouterModelId: openRouterDefaultModelId,
		})
	})

	it("saves the configured provider from setup", async () => {
		renderWelcomeViewProvider({
			apiConfiguration: {
				apiProvider: "openrouter",
				openRouterApiKey: "test-key",
				openRouterModelId: openRouterDefaultModelId,
			},
		})

		await selectWelcomeProvider("OpenRouter")
		fireEvent.click(screen.getByText(/welcome:providerSignup.finish/))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "upsertApiConfiguration",
			text: "default",
			apiConfiguration: {
				apiProvider: "openrouter",
				openRouterApiKey: "test-key",
				openRouterModelId: openRouterDefaultModelId,
			},
		})
	})

	it("returns to landing from provider setup", async () => {
		renderWelcomeViewProvider()

		await selectWelcomeProvider("OpenRouter")
		fireEvent.click(screen.getByText(/welcome:providerSignup.goBack/))

		expect(screen.getByText(/welcome:landing.greeting/)).toBeInTheDocument()
		expect(screen.queryByTestId("api-options")).not.toBeInTheDocument()
	})

	it("opens the local AI setup path and probes hardware", () => {
		renderWelcomeViewProvider()

		openLocalAiSetup()

		expect(screen.getByTestId("welcome-startup-content")).toHaveClass("pt-8")
		expect(screen.getByTestId("local-ai-setup-header")).toBeInTheDocument()
		expect(screen.getByTestId("local-ai-setup-heading")).toBeInTheDocument()
		expect(screen.getByText(/welcome:localSetup.heading/)).toBeInTheDocument()
		expect(screen.getByText(/welcome:localSetup.form.usage.label/)).toBeInTheDocument()
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "localAiProbe" })
	})

	it("keeps the local setup header visible when switching local states", async () => {
		renderWelcomeViewProvider()

		openLocalAiSetup()
		fireEvent.click(screen.getByText(/welcome:localSetup.actions.manual/))

		expect(screen.getByTestId("local-ai-setup-header")).toBeInTheDocument()
		expect(screen.getByTestId("local-ai-setup-heading")).toBeInTheDocument()
		expect(screen.getByText(/welcome:localSetup.manual.heading/)).toBeInTheDocument()

		fireEvent.click(screen.getByText(/welcome:providerSignup.goBack/))
		dispatchExtensionMessage({ type: "localAiProbeResult", payload: mockProbe })
		fireEvent.click(screen.getByText(/welcome:localSetup.actions.recommend/))
		dispatchExtensionMessage({ type: "localAiRecommendationResult", payload: mockRecommendation })

		await waitFor(() => expect(screen.getByText("Qwen2.5 Coder 7B")).toBeInTheDocument())
		expect(screen.getByTestId("local-ai-setup-header")).toBeInTheDocument()
	})

	it("builds a local AI recommendation from questionnaire answers", async () => {
		renderWelcomeViewProvider()

		openLocalAiSetup()
		dispatchExtensionMessage({ type: "localAiProbeResult", payload: mockProbe })

		const [usageSelect, preferenceSelect] = screen.getAllByRole("combobox")
		fireEvent.change(usageSelect, { target: { value: "agentic" } })
		fireEvent.change(preferenceSelect, { target: { value: "quality" } })
		fireEvent.click(screen.getByText(/welcome:localSetup.actions.recommend/))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "localAiRecommend",
			payload: expect.objectContaining({
				probe: mockProbe,
				questionnaire: expect.objectContaining({ usageProfile: "agentic", preference: "quality" }),
			}),
		})

		dispatchExtensionMessage({ type: "localAiRecommendationResult", payload: mockRecommendation })

		await waitFor(() => expect(screen.getByText("Qwen2.5 Coder 7B")).toBeInTheDocument())
		expect(screen.getByText("qwen2.5-coder:7b")).toBeInTheDocument()
		expect(screen.queryByTestId("local-ai-weak-hardware-warning")).not.toBeInTheDocument()
		expect(screen.getByText(/welcome:localSetup.actions.confirmDownload/)).toBeInTheDocument()
	})

	it("shows one weak-hardware warning while still allowing local setup to continue", async () => {
		renderWelcomeViewProvider()

		openLocalAiSetup()
		dispatchExtensionMessage({ type: "localAiProbeResult", payload: mockProbe })
		fireEvent.click(screen.getByText(/welcome:localSetup.actions.recommend/))
		dispatchExtensionMessage({ type: "localAiRecommendationResult", payload: mockWeakRecommendation })

		await waitFor(() => expect(screen.getByText("Qwen2.5 Coder 1.5B")).toBeInTheDocument())
		expect(screen.queryByTestId("local-ai-api-recommendation")).not.toBeInTheDocument()
		expect(screen.getAllByTestId("local-ai-weak-hardware-warning")).toHaveLength(1)
		expect(screen.getAllByText(/welcome:localSetup.recommendation.weakHardwareWarning/)).toHaveLength(1)
		expect(screen.getByText(/welcome:localSetup.actions.useApiProvider/)).toBeInTheDocument()
		expect(screen.getByText(/welcome:localSetup.actions.confirmDownload/)).toBeInTheDocument()

		fireEvent.click(screen.getByText(/welcome:localSetup.actions.confirmDownload/))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "localAiStartSetup",
			payload: expect.objectContaining({ recommendation: mockWeakRecommendation }),
		})
	})

	it("confirms download, shows progress, and renders success", async () => {
		renderWelcomeViewProvider()

		openLocalAiSetup()
		dispatchExtensionMessage({ type: "localAiProbeResult", payload: mockProbe })
		fireEvent.click(screen.getByText(/welcome:localSetup.actions.recommend/))
		dispatchExtensionMessage({ type: "localAiRecommendationResult", payload: mockRecommendation })

		await waitFor(() => screen.getByText(/welcome:localSetup.actions.confirmDownload/))
		fireEvent.click(screen.getByText(/welcome:localSetup.actions.confirmDownload/))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "localAiStartSetup",
			payload: expect.objectContaining({ recommendation: mockRecommendation }),
		})

		dispatchExtensionMessage({
			type: "localAiSetupProgress",
			payload: { stage: "download", message: "downloading", percent: 50, modelTag: "qwen2.5-coder:7b" },
		})

		await waitFor(() => expect(screen.getByText("downloading")).toBeInTheDocument())
		expect(screen.getByText(/welcome:localSetup.progress.percent/)).toBeInTheDocument()

		dispatchExtensionMessage({
			type: "localAiSetupResult",
			success: true,
			payload: { success: true, modelTag: "qwen2.5-coder:7b", profileName: "Local AI (Ollama)" },
		})

		await waitFor(() => expect(screen.getByText(/welcome:localSetup.success.heading/)).toBeInTheDocument())
	})

	it("supports cancellation during local AI setup", async () => {
		renderWelcomeViewProvider()

		openLocalAiSetup()
		dispatchExtensionMessage({ type: "localAiProbeResult", payload: mockProbe })
		fireEvent.click(screen.getByText(/welcome:localSetup.actions.recommend/))
		dispatchExtensionMessage({ type: "localAiRecommendationResult", payload: mockRecommendation })
		await waitFor(() => screen.getByText(/welcome:localSetup.actions.confirmDownload/))
		fireEvent.click(screen.getByText(/welcome:localSetup.actions.confirmDownload/))
		fireEvent.click(screen.getByText(/welcome:localSetup.actions.cancel/))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "localAiCancelSetup" })
	})

	it("shows manual local AI setup and opens official Ollama download", () => {
		renderWelcomeViewProvider()

		openLocalAiSetup()
		fireEvent.click(screen.getByText(/welcome:localSetup.actions.manual/))

		expect(screen.getByText(/welcome:localSetup.manual.heading/)).toBeInTheDocument()

		fireEvent.click(screen.getByText(/welcome:localSetup.actions.openOllamaDownload/))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "openExternal", url: "https://ollama.com/download" })
	})

	it("imports settings from the landing screen", () => {
		renderWelcomeViewProvider()

		fireEvent.click(screen.getByText(/welcome:importSettings/))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "importSettings" })
	})
})

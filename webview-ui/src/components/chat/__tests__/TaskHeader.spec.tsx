// npx vitest src/components/chat/__tests__/TaskHeader.spec.tsx

import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { ContextCacheStats, ProviderSettings } from "@roo-code/types"

import TaskHeader, { TaskHeaderProps } from "../TaskHeader"

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, any>) => {
			switch (key) {
				case "chat:task.contextCache.diagnostics.evictionsValue":
					return `${options?.total} total · ${options?.hot} hot / ${options?.cold} cold`
				case "chat:task.contextCache.diagnostics.contributors":
					return `${options?.count} ${options?.count === 1 ? "contributor" : "contributors"}`
				case "chat:task.contextCache.diagnostics.contributorUsage":
					return `${options?.ram} · ${options?.hot} hot / ${options?.cold} cold`
				case "chat:task.contextCache.diagnostics.combinedStatus":
					return `Combined: ${options?.used} / ${options?.budget}`
				case "chat:task.contextCache.diagnostics.evictionsStatus":
					return `Evictions: ${options?.value}`
				default:
					return key
			}
		},
	}),
	// Mock initReactI18next to prevent initialization errors in tests
	initReactI18next: {
		type: "3rdParty",
		init: vi.fn(),
	},
}))

// Mock the vscode API - use vi.hoisted to ensure the mock is available when vi.mock is hoisted
const { mockPostMessage } = vi.hoisted(() => ({
	mockPostMessage: vi.fn(),
}))
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: mockPostMessage,
	},
}))

// Mock the VSCodeBadge component
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeBadge: ({ children }: { children: React.ReactNode }) => <div data-testid="vscode-badge">{children}</div>,
}))

// Create a variable to hold the mock state
const mockExtensionState: {
	apiConfiguration: ProviderSettings
	currentTaskItem: { id: string } | null
	clineMessages: any[]
	contextCacheEnabled: boolean
	contextCacheStats: ContextCacheStats
	contextCacheWarning?: string
	openAiCodexRateLimits?: any
	providerPlanLimits?: any
	providerPlanUsage?: any
	cachedProviderPlanUsage?: any
} = {
	apiConfiguration: {
		apiProvider: "anthropic",
		apiKey: "test-api-key",
		apiModelId: "claude-3-opus-20240229",
	} as ProviderSettings,
	currentTaskItem: { id: "test-task-id" },
	clineMessages: [],
	contextCacheEnabled: true,
	contextCacheStats: {
		hotCacheTokens: 12345,
		hotCacheChunks: 3,
		coldCacheChunks: 7,
		ramUsedMb: 128,
		ramBudgetMb: 2048,
		swapsThisSession: 5,
		condensingAvoided: 2,
	},
	contextCacheWarning: undefined,
	providerPlanLimits: {},
	providerPlanUsage: {},
	cachedProviderPlanUsage: {},
}

// Mock the ExtensionStateContext
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
}))

// Mock findLastIndex from @roo/array
vi.mock("@roo/array", () => ({
	findLastIndex: (array: any[], predicate: (item: any) => boolean) => {
		for (let i = array.length - 1; i >= 0; i--) {
			if (predicate(array[i])) {
				return i
			}
		}
		return -1
	},
}))

// Create a variable to hold the mock model info for useSelectedModel
let mockModelInfo: { contextWindow: number; maxTokens: number; subscriptionBased?: boolean } | undefined = undefined

// Mock useSelectedModel hook
vi.mock("@/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({
		provider: "anthropic",
		id: "test-model",
		info: mockModelInfo,
		isLoading: false,
		isError: false,
	}),
}))

// Mock getModelMaxOutputTokens from @roo/api
let mockMaxOutputTokens = 0
vi.mock("@roo/api", () => ({
	getModelMaxOutputTokens: () => mockMaxOutputTokens,
}))

describe("TaskHeader", () => {
	const defaultProps: TaskHeaderProps = {
		task: { type: "say", ts: Date.now(), text: "Test task", images: [] },
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.05,
		contextTokens: 200,
		buttonsDisabled: false,
		handleCondenseContext: vi.fn(),
	}

	const queryClient = new QueryClient()

	const renderTaskHeader = (props: Partial<TaskHeaderProps> = {}) => {
		return render(
			<QueryClientProvider client={queryClient}>
				<TaskHeader {...defaultProps} {...props} />
			</QueryClientProvider>,
		)
	}

	beforeEach(() => {
		vi.clearAllMocks()
		mockExtensionState.contextCacheEnabled = true
		mockExtensionState.contextCacheStats = {
			hotCacheTokens: 12345,
			hotCacheChunks: 3,
			coldCacheChunks: 7,
			ramUsedMb: 128,
			ramBudgetMb: 2048,
			swapsThisSession: 5,
			condensingAvoided: 2,
		}
		mockExtensionState.contextCacheWarning = undefined
		mockExtensionState.providerPlanLimits = {}
		mockExtensionState.providerPlanUsage = {}
		mockExtensionState.cachedProviderPlanUsage = {}
		mockExtensionState.openAiCodexRateLimits = undefined
		mockExtensionState.apiConfiguration = {
			apiProvider: "anthropic",
			apiKey: "test-api-key",
			apiModelId: "claude-3-opus-20240229",
		} as ProviderSettings
	})

	it("should display hot and cold context cache status in the collapsed header", () => {
		renderTaskHeader()

		const status = screen.getByTestId("context-cache-collapsed-status")
		expect(status).toBeInTheDocument()
		expect(status).toHaveTextContent("3 chat:task.contextCache.hotShort / 7 chat:task.contextCache.coldShort")
		expect(status).toHaveTextContent("128MB/2GB")
	})

	it("should display context cache stats and warnings when expanded", () => {
		mockExtensionState.contextCacheWarning = "Cold cache full — falling back to condensing"

		renderTaskHeader()
		fireEvent.click(screen.getByText("Test task"))

		const status = screen.getByTestId("context-cache-status")
		expect(status).toHaveTextContent("chat:task.contextCache.label")
		expect(status).toHaveTextContent("chat:task.contextCache.hotCache: 3 / 12.3k chat:contextManagement.tokens")
		expect(status).toHaveTextContent("chat:task.contextCache.coldCache: 7 / 128MB / 2GB")
		expect(status).toHaveTextContent("chat:task.contextCache.swaps: 5")
		expect(status).toHaveTextContent("chat:task.contextCache.condensingAvoided: 2")
		expect(screen.getByTestId("context-cache-status-warning")).toHaveTextContent(
			"Cold cache full — falling back to condensing",
		)
	})

	it("should display combined context cache diagnostics in collapsed and expanded states", () => {
		mockExtensionState.contextCacheStats = {
			hotCacheTokens: 12345,
			hotCacheChunks: 3,
			coldCacheChunks: 7,
			ramUsedMb: 128,
			ramBudgetMb: 2048,
			swapsThisSession: 5,
			condensingAvoided: 2,
			combinedBudget: {
				ramUsedMb: 512,
				ramBudgetMb: 2048,
				hotCacheRamMb: 128,
				coldCacheRamMb: 384,
				hotCacheChunks: 4,
				coldCacheChunks: 9,
				managerCount: 2,
				evictions: { hot: 1, cold: 2, total: 3 },
				contributors: [
					{
						id: "context-cache-contributor-1",
						label: "Foreground task 1 (code)",
						mode: "code",
						isBackground: false,
						isActive: true,
						hotCacheChunks: 3,
						coldCacheChunks: 4,
						hotCacheRamMb: 64,
						coldCacheRamMb: 192,
						ramUsedMb: 256,
						evictions: { hot: 1, cold: 1, total: 2 },
					},
				],
			},
		}

		renderTaskHeader()

		const collapsedStatus = screen.getByTestId("context-cache-collapsed-status")
		expect(collapsedStatus).toHaveTextContent(
			"4 chat:task.contextCache.hotShort / 9 chat:task.contextCache.coldShort",
		)
		expect(collapsedStatus).toHaveTextContent("512MB/2GB")
		expect(collapsedStatus).toHaveTextContent("2 contributors")

		fireEvent.click(screen.getByText("Test task"))

		expect(screen.getByTestId("context-cache-combined-status")).toHaveTextContent(
			"Combined: 512MB / 2GB · 2 contributors",
		)
		expect(screen.getByTestId("context-cache-cold-status")).toHaveTextContent(
			"chat:task.contextCache.coldCache: 9 / 384MB",
		)
		expect(screen.getByTestId("context-cache-cold-status")).not.toHaveTextContent("512MB")
		expect(screen.getByTestId("context-cache-eviction-status")).toHaveTextContent(
			"Evictions: 3 total · 1 hot / 2 cold",
		)
		expect(screen.getByTestId("context-cache-contributor-status")).toHaveTextContent(
			"Foreground task 1 (code): 256MB · 3 hot / 4 cold",
		)
	})

	it("should hide context cache status when the context cache is disabled", () => {
		mockExtensionState.contextCacheEnabled = false

		renderTaskHeader()

		expect(screen.queryByTestId("context-cache-collapsed-status")).not.toBeInTheDocument()
		fireEvent.click(screen.getByText("Test task"))
		expect(screen.queryByTestId("context-cache-status")).not.toBeInTheDocument()
	})

	it("should display cost when totalCost is greater than 0", () => {
		renderTaskHeader()
		expect(screen.getByText("$0.05")).toBeInTheDocument()
	})

	it("should not display cost when totalCost is 0", () => {
		renderTaskHeader({ totalCost: 0 })
		expect(screen.queryByText("$0.0000")).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is null", () => {
		renderTaskHeader({ totalCost: null as any })
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is undefined", () => {
		renderTaskHeader({ totalCost: undefined as any })
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should not display cost when totalCost is NaN", () => {
		renderTaskHeader({ totalCost: NaN })
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("should display aggregated child-only cost when totalCost is 0", () => {
		renderTaskHeader({ totalCost: 0, aggregatedCost: 0.05, hasSubtasks: true })
		expect(screen.getByText("$0.05")).toBeInTheDocument()
	})

	it("should render the condense context button when expanded", () => {
		renderTaskHeader()
		// First click to expand the task header
		const taskHeader = screen.getByText("Test task")
		fireEvent.click(taskHeader)

		// Now find the condense button in the expanded state
		const buttons = screen.getAllByRole("button")
		const condenseButton = buttons.find((button) => button.querySelector("svg.lucide-fold-vertical"))
		expect(condenseButton).toBeDefined()
		expect(condenseButton?.querySelector("svg")).toBeInTheDocument()
	})

	it("should call handleCondenseContext when condense context button is clicked", () => {
		const handleCondenseContext = vi.fn()
		renderTaskHeader({ handleCondenseContext })

		// First click to expand the task header
		const taskHeader = screen.getByText("Test task")
		fireEvent.click(taskHeader)

		// Find the button that contains the FoldVertical icon
		const buttons = screen.getAllByRole("button")
		const condenseButton = buttons.find((button) => button.querySelector("svg.lucide-fold-vertical"))
		expect(condenseButton).toBeDefined()
		fireEvent.click(condenseButton!)
		expect(handleCondenseContext).toHaveBeenCalledWith("test-task-id")
	})

	it("should disable the condense context button when buttonsDisabled is true", () => {
		const handleCondenseContext = vi.fn()
		renderTaskHeader({ buttonsDisabled: true, handleCondenseContext })

		// First click to expand the task header
		const taskHeader = screen.getByText("Test task")
		fireEvent.click(taskHeader)

		// Find the button that contains the FoldVertical icon
		const buttons = screen.getAllByRole("button")
		const condenseButton = buttons.find((button) => button.querySelector("svg.lucide-fold-vertical"))
		expect(condenseButton).toBeDefined()
		expect(condenseButton).toBeDisabled()
		fireEvent.click(condenseButton!)
		expect(handleCondenseContext).not.toHaveBeenCalled()
	})

	describe("Back to parent task button", () => {
		beforeEach(() => {
			mockPostMessage.mockClear()
		})

		it("should not show back button when parentTaskId is not provided", () => {
			renderTaskHeader()
			expect(screen.queryByText("chat:task.backToParentTask")).not.toBeInTheDocument()
		})

		it("should not show back button when parentTaskId is undefined", () => {
			renderTaskHeader({ parentTaskId: undefined })
			expect(screen.queryByText("chat:task.backToParentTask")).not.toBeInTheDocument()
		})

		it("should show back button when parentTaskId is provided", () => {
			renderTaskHeader({ parentTaskId: "parent-task-123" })
			expect(screen.getByText("chat:task.backToParentTask")).toBeInTheDocument()
		})

		it("should call vscode.postMessage with showTaskWithId when back button is clicked", () => {
			renderTaskHeader({ parentTaskId: "parent-task-123" })

			const backButton = screen.getByText("chat:task.backToParentTask")
			fireEvent.click(backButton)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "parent-task-123",
			})
		})

		it("should show back button with ArrowLeft icon", () => {
			renderTaskHeader({ parentTaskId: "parent-task-123" })

			// Find the button containing the back text and verify it has the ArrowLeft icon
			const backButton = screen.getByText("chat:task.backToParentTask").closest("button")
			expect(backButton).toBeInTheDocument()
			expect(backButton?.querySelector("svg.lucide-arrow-left")).toBeInTheDocument()
		})
	})

	describe("Context window percentage calculation", () => {
		// The percentage should be calculated as:
		// contextTokens / (contextWindow - reservedForOutput) * 100
		// This represents the percentage of AVAILABLE input space used,
		// not the percentage of the total context window.

		beforeEach(() => {
			// Set up mock model with known contextWindow
			mockModelInfo = { contextWindow: 1000, maxTokens: 200 }
			// Set up mock for getModelMaxOutputTokens to return reservedForOutput
			mockMaxOutputTokens = 200
		})

		afterEach(() => {
			// Reset mocks
			mockModelInfo = undefined
			mockMaxOutputTokens = 0
		})

		it("should calculate percentage based on available input space, not total context window", () => {
			// With the formula: contextTokens / (contextWindow - reservedForOutput) * 100
			// If contextTokens = 200, contextWindow = 1000, reservedForOutput = 200
			// Then available input space = 1000 - 200 = 800
			// Percentage = 200 / 800 * 100 = 25%
			//
			// Old (incorrect) formula would have been: (200 + 200) / 1000 * 100 = 40%

			renderTaskHeader({ contextTokens: 200 })

			// The percentage should be rendered in the collapsed header state
			// Verify that 25% is displayed (correct formula) and NOT 40% (old incorrect formula)
			expect(screen.getByText("25%")).toBeInTheDocument()
			expect(screen.queryByText("40%")).not.toBeInTheDocument()
		})

		it("should handle edge case when available input space is zero", () => {
			// When contextWindow equals reservedForOutput, available space is 0
			// The percentage should be 0 to avoid division by zero
			mockModelInfo = { contextWindow: 200, maxTokens: 200 }
			mockMaxOutputTokens = 200

			renderTaskHeader({ contextTokens: 100 })

			// Should show 0% when available input space is 0
			expect(screen.getByText("0%")).toBeInTheDocument()
		})
	})

	describe("subscription-based (plan-based) providers", () => {
		beforeEach(() => {
			mockModelInfo = { contextWindow: 400000, maxTokens: 128000, subscriptionBased: true }
			mockMaxOutputTokens = 128000
		})

		afterEach(() => {
			mockModelInfo = undefined
			mockMaxOutputTokens = 0
		})

		it("should not display cost for subscription-based providers even when totalCost > 0", () => {
			renderTaskHeader({ totalCost: 0.05 })
			expect(screen.queryByText("$0.05")).not.toBeInTheDocument()
		})

		it("should display token usage in collapsed view for subscription-based providers", () => {
			renderTaskHeader({ tokensIn: 15000, tokensOut: 5000, totalCost: 0 })
			// Token usage should be visible with ↑ and ↓ arrows
			expect(screen.getByText(/↑/)).toBeInTheDocument()
			expect(screen.getByText(/↓/)).toBeInTheDocument()
		})

		it("should display token usage in collapsed view when totalCost > 0 for subscription-based providers", () => {
			renderTaskHeader({ tokensIn: 15000, tokensOut: 5000, totalCost: 0.05 })
			// Should show tokens, NOT cost
			expect(screen.getByText(/↑/)).toBeInTheDocument()
			expect(screen.getByText(/↓/)).toBeInTheDocument()
			expect(screen.queryByText("$0.05")).not.toBeInTheDocument()
		})

		it("should not display token usage in collapsed view when there are no tokens", () => {
			renderTaskHeader({ tokensIn: 0, tokensOut: 0, totalCost: 0 })
			// Should not show any ↑ or ↓ markers
			expect(screen.queryByText(/↑/)).not.toBeInTheDocument()
			expect(screen.queryByText(/↓/)).not.toBeInTheDocument()
		})

		it("should still show cost for non-subscription providers", () => {
			// Reset to non-subscription model
			mockModelInfo = { contextWindow: 200000, maxTokens: 8192 }
			renderTaskHeader({ totalCost: 0.05 })
			expect(screen.getByText("$0.05")).toBeInTheDocument()
		})
	})

	describe("provider-reported plan usage", () => {
		beforeEach(() => {
			mockModelInfo = { contextWindow: 200000, maxTokens: 8192 }
			mockMaxOutputTokens = 8192
		})

		afterEach(() => {
			mockModelInfo = undefined
			mockMaxOutputTokens = 0
		})

		it("should ignore deprecated locally tracked provider token plan usage", () => {
			mockExtensionState.providerPlanLimits = {
				anthropic: { tokenLimit: 1000, resetPeriod: "monthly" },
			}
			mockExtensionState.providerPlanUsage = {
				anthropic: { tokensUsed: 450, costUsed: 0.2, periodStart: Date.now() },
			}

			renderTaskHeader({ tokensIn: 300, tokensOut: 150, totalCost: 0.05 })

			expect(screen.queryByTestId("plan-usage-percent")).not.toBeInTheDocument()
			expect(screen.queryByTestId("plan-usage-remaining")).not.toBeInTheDocument()
			expect(screen.getByText("$0.05")).toBeInTheDocument()
		})

		it("should ignore deprecated locally tracked provider cost plan usage", () => {
			mockExtensionState.providerPlanLimits = {
				anthropic: { tokenLimit: 1000, costLimit: 1, resetPeriod: "monthly" },
			}
			mockExtensionState.providerPlanUsage = {
				anthropic: { tokensUsed: 100, costUsed: 0.8, periodStart: Date.now() },
			}

			renderTaskHeader({ tokensIn: 100, tokensOut: 50, totalCost: 0.05 })

			expect(screen.queryByTestId("plan-usage-percent")).not.toBeInTheDocument()
			expect(screen.queryByTestId("plan-usage-remaining")).not.toBeInTheDocument()
			expect(screen.getByText("$0.05")).toBeInTheDocument()
		})

		it("should not display provider plan usage without provider-reported usage", () => {
			renderTaskHeader({ tokensIn: 100, tokensOut: 50, totalCost: 0.05 })

			expect(screen.queryByTestId("plan-usage-percent")).not.toBeInTheDocument()
			expect(screen.getByText("$0.05")).toBeInTheDocument()
		})

		it("should display live API-fetched plan usage for providers with automatic usage APIs", () => {
			mockModelInfo = { contextWindow: 200000, maxTokens: 8192, subscriptionBased: true }
			mockExtensionState.apiConfiguration = {
				apiProvider: "minimax",
				apiModelId: "minimax-m2",
				minimaxApiKey: "test-minimax-key",
			} as ProviderSettings
			mockExtensionState.cachedProviderPlanUsage = {
				minimax: { usedPercent: 61.4, tokensRemaining: 12345 },
			}

			renderTaskHeader({ tokensIn: 100, tokensOut: 50, totalCost: 0 })

			expect(screen.getByTestId("plan-usage-percent")).toHaveTextContent("61% plan used")
			expect(screen.getByTestId("plan-usage-remaining")).toHaveTextContent("12.3k tokens left")
		})

		it("should automatically fetch live plan usage for plan-based providers with usage APIs", () => {
			mockModelInfo = { contextWindow: 200000, maxTokens: 8192, subscriptionBased: true }
			mockExtensionState.apiConfiguration = {
				apiProvider: "minimax",
				apiModelId: "minimax-m2",
				minimaxApiKey: "test-minimax-key",
				minimaxBaseUrl: "https://api.minimax.io/v1",
			} as ProviderSettings

			renderTaskHeader({ tokensIn: 100, tokensOut: 50, totalCost: 0 })

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "fetchMiniMaxPlanUsage",
				text: "test-minimax-key",
				bool: false,
			})
		})

		it("should prefer OpenAI Codex API rate limit usage over locally tracked plan usage", () => {
			mockModelInfo = { contextWindow: 400000, maxTokens: 128000, subscriptionBased: true }
			mockExtensionState.apiConfiguration = {
				apiProvider: "openai-codex",
				apiModelId: "gpt-5.5",
			} as ProviderSettings
			mockExtensionState.openAiCodexRateLimits = {
				primary: { usedPercent: 12.2, resetsAt: Date.now() + 3_600_000 },
				fetchedAt: Date.now(),
			}
			mockExtensionState.providerPlanLimits = {
				"openai-codex": { tokenLimit: 1000, resetPeriod: "monthly" },
			}
			mockExtensionState.providerPlanUsage = {
				"openai-codex": { tokensUsed: 900, costUsed: 0, periodStart: Date.now() },
			}

			renderTaskHeader({ tokensIn: 100, tokensOut: 50, totalCost: 0 })

			expect(screen.getByTestId("plan-usage-percent")).toHaveTextContent("12% plan used")
			expect(screen.queryByText("90% plan used")).not.toBeInTheDocument()
		})
	})
})

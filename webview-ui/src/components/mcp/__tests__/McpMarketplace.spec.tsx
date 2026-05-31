import React from "react"
import { fireEvent, render, screen, within } from "@/utils/test-utils"

import { marketplaceMcpCatalog } from "@roo/mcpMarketplace"
import { vscode } from "@src/utils/vscode"

import McpMarketplace from "../McpMarketplace"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, string | number>) => {
			const translations: Record<string, string> = {
				"mcp:marketplace.title": "MCP Marketplace",
				"mcp:marketplace.description":
					"Discover trusted MCP servers for search, coding, docs, databases, files, and team workflows. Choose one and C will set it up in a guided task.",
				"mcp:marketplace.featuredCatalog": "Featured MCP servers",
				"mcp:marketplace.stats.servers": "Curated servers",
				"mcp:marketplace.stats.installed": "Installed",
				"mcp:marketplace.search.label": "Search marketplace",
				"mcp:marketplace.search.placeholder": "Search by name, category, package, or secret...",
				"mcp:marketplace.filters.categoryLabel": "Filter by category",
				"mcp:marketplace.filters.all": "All categories",
				"mcp:marketplace.resultsSummary": "Showing {{shown}} of {{total}} servers",
				"mcp:marketplace.badges.featured": "Featured",
				"mcp:marketplace.badges.popular": "Popular",
				"mcp:marketplace.labels.category": "Category",
				"mcp:marketplace.labels.package": "Package",
				"mcp:marketplace.labels.source": "Source",
				"mcp:marketplace.labels.transport": "Transport",
				"mcp:marketplace.labels.requiredSecrets": "Required secrets",
				"mcp:marketplace.labels.prerequisites": "Prerequisites",
				"mcp:marketplace.labels.suggestedScope": "Suggested scope",
				"mcp:marketplace.labels.scope": "Target scope",
				"mcp:marketplace.labels.verification": "Verification",
				"mcp:marketplace.labels.riskNotes": "Risk notes",
				"mcp:marketplace.scope.global": "Global",
				"mcp:marketplace.scope.project": "Project",
				"mcp:marketplace.actions.installWithAI": "Install with AI",
				"mcp:marketplace.actions.configureAgain": "Configure Again",
				"mcp:marketplace.actions.clearFilters": "Clear filters",
				"mcp:marketplace.actions.showDetails": "Details",
				"mcp:marketplace.actions.hideDetails": "Hide details",
				"mcp:marketplace.actions.openDocs": "Open docs",
				"mcp:marketplace.customDiscovery.title": "Can't find the MCP server?",
				"mcp:marketplace.customDiscovery.description":
					"Enter the MCP server you want and C will open an MCP Setup task to discover official docs, propose safe config, and verify it with your installed research tools.",
				"mcp:marketplace.customDiscovery.mode.label": "Custom MCP server action",
				"mcp:marketplace.customDiscovery.mode.find": "Find existing",
				"mcp:marketplace.customDiscovery.mode.create": "Create new",
				"mcp:marketplace.customDiscovery.inputLabel": "MCP server name or description",
				"mcp:marketplace.customDiscovery.placeholder": "Example: Perplexity search MCP server",
				"mcp:marketplace.customDiscovery.action": "Discover with AI",
				"mcp:marketplace.customDiscovery.validation.empty":
					"Enter an MCP server name or description before starting discovery.",
				"mcp:marketplace.customDiscovery.create.description":
					"Describe the MCP server or tooling you want and C will open an MCP Setup task to design, implement, configure, and verify a custom local server.",
				"mcp:marketplace.customDiscovery.create.inputLabel": "What should the new MCP server do?",
				"mcp:marketplace.customDiscovery.create.placeholder":
					"Example: Add a tool that looks up internal package docs from this workspace",
				"mcp:marketplace.customDiscovery.create.action": "Create with AI",
				"mcp:marketplace.customDiscovery.create.recommendation":
					"Context7 and web search can help with docs, but creation is not blocked if they are not installed.",
				"mcp:marketplace.customDiscovery.create.validation.empty":
					"Enter what you want the MCP server to do before starting custom MCP server creation.",
				"mcp:marketplace.customDiscovery.requirements.context7": "Context7 installed",
				"mcp:marketplace.customDiscovery.requirements.webSearch": "Web search installed",
				"mcp:marketplace.customDiscovery.requirements.missingBoth":
					"Install Context7 and at least one web search MCP server before starting custom MCP discovery.",
				"mcp:marketplace.customDiscovery.requirements.missingContext7":
					"Install Context7 before starting custom MCP discovery.",
				"mcp:marketplace.customDiscovery.requirements.missingWebSearch":
					"Install at least one web search MCP server, such as Exa Web Search, Brave Search, Tavily Search, or Firecrawl, before starting custom MCP discovery.",
				"mcp:marketplace.empty.title": "No MCP servers found",
				"mcp:marketplace.empty.description":
					"Try a different search term or clear the selected category filter.",
				"mcp:marketplace.status.installed": "Installed",
				"mcp:marketplace.prerequisiteOverflow": "+{{count}} more",
				"mcp:marketplace.secretSummary": "{{count}} required",
				"mcp:marketplace.optionalSecretSummary": "{{count}} optional",
				"mcp:marketplace.noSecrets": "No secrets",
				"mcp:marketplace.noneRequired": "None required",
			}

			return Object.entries(options ?? {}).reduce(
				(value, [name, replacement]) => value.replace(`{{${name}}}`, String(replacement)),
				translations[key] || key,
			)
		},
	}),
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

describe("McpMarketplace", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	const getCard = (name: string) => {
		const card = screen.getByRole("heading", { name }).closest("article")
		expect(card).toBeTruthy()
		return card!
	}

	it("renders slim marketplace catalog cards with setup metadata hidden until expanded", () => {
		render(<McpMarketplace servers={[]} />)

		expect(screen.getByText("MCP Marketplace")).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Can't find the MCP server?" })).toBeInTheDocument()
		expect(screen.getByText(String(marketplaceMcpCatalog.length))).toBeInTheDocument()
		expect(screen.getByText("Curated servers")).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Filesystem" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "GitHub" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Context7" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Exa Web Search" })).toBeInTheDocument()

		expect(screen.queryByText("@modelcontextprotocol/server-filesystem")).not.toBeInTheDocument()
		expect(screen.queryByText("GITHUB_PERSONAL_ACCESS_TOKEN")).not.toBeInTheDocument()
		expect(screen.queryByText("streamable-http")).not.toBeInTheDocument()

		const githubCard = getCard("GitHub")
		fireEvent.click(within(githubCard).getByRole("button", { name: /Details/i }))

		expect(within(githubCard).getByText("@modelcontextprotocol/server-github")).toBeInTheDocument()
		expect(within(githubCard).getByText("GITHUB_PERSONAL_ACCESS_TOKEN")).toBeInTheDocument()
		expect(within(githubCard).getByText("stdio")).toBeInTheDocument()
		expect(within(githubCard).getByText("Open docs")).toBeInTheDocument()
	})

	it("filters catalog cards by search query", () => {
		render(<McpMarketplace servers={[]} />)

		fireEvent.change(screen.getByLabelText("Search marketplace"), { target: { value: "context7" } })

		expect(screen.getByRole("heading", { name: "Context7" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: "GitHub" })).not.toBeInTheDocument()
		expect(screen.getByText(`Showing 1 of ${marketplaceMcpCatalog.length} servers`)).toBeInTheDocument()
	})

	it("filters catalog cards by category", () => {
		const searchCatalogItems = marketplaceMcpCatalog.filter((item) => item.category === "Search")

		render(<McpMarketplace servers={[]} />)

		fireEvent.click(screen.getByRole("button", { name: "Search" }))

		expect(screen.getByRole("heading", { name: "Exa Web Search" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Brave Search" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Tavily Search" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: "Filesystem" })).not.toBeInTheDocument()
		expect(
			screen.getByText(`Showing ${searchCatalogItems.length} of ${marketplaceMcpCatalog.length} servers`),
		).toBeInTheDocument()
	})

	it("shows an empty state and clears active filters", () => {
		render(<McpMarketplace servers={[]} />)

		fireEvent.change(screen.getByLabelText("Search marketplace"), { target: { value: "no-match-server" } })

		expect(screen.getByText("No MCP servers found")).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: "Filesystem" })).not.toBeInTheDocument()

		fireEvent.click(screen.getByRole("button", { name: /Clear filters/i }))

		expect(screen.getByRole("heading", { name: "Filesystem" })).toBeInTheDocument()
		expect(screen.getByLabelText("Search marketplace")).toHaveValue("")
	})

	it("shows installed state and configure-again action for configured servers", () => {
		render(
			<McpMarketplace
				servers={
					[
						{
							name: "github",
							config: "{}",
							status: "connected",
						},
					] as any
				}
			/>,
		)

		const githubCard = getCard("GitHub")
		expect(within(githubCard!).getByText("Installed")).toBeInTheDocument()
		expect(within(githubCard!).queryByRole("button", { name: /Configure Again/i })).not.toBeInTheDocument()

		fireEvent.click(within(githubCard!).getByRole("button", { name: /Details/i }))

		expect(within(githubCard!).getByRole("button", { name: /Configure Again/i })).toBeInTheDocument()
	})

	it("posts the marketplace install message with the recommended scope", () => {
		const item = marketplaceMcpCatalog[0]

		render(<McpMarketplace servers={[]} />)

		fireEvent.click(within(getCard(item.name)).getByRole("button", { name: /Details/i }))
		fireEvent.click(within(getCard(item.name)).getByRole("button", { name: /Install with AI/i }))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "installMarketplaceMcp",
			marketplaceMcpId: item.id,
			marketplaceMcpScope: item.recommendedScope,
		})
	})

	it("posts the selected target scope", () => {
		const item = marketplaceMcpCatalog[0]

		render(<McpMarketplace servers={[]} />)

		const itemCard = getCard(item.name)

		fireEvent.click(within(itemCard!).getByRole("button", { name: /Details/i }))
		fireEvent.change(within(itemCard!).getByLabelText(`Target scope ${item.name}`), { target: { value: "global" } })
		fireEvent.click(within(itemCard!).getByRole("button", { name: /Install with AI/i }))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "installMarketplaceMcp",
			marketplaceMcpId: item.id,
			marketplaceMcpScope: "global",
		})
	})

	it("switches between find existing and create new custom MCP modes", () => {
		render(<McpMarketplace servers={[]} />)

		expect(screen.getByRole("tab", { name: "Find existing" })).toHaveAttribute("aria-selected", "true")
		expect(screen.getByRole("tab", { name: "Create new" })).toHaveAttribute("aria-selected", "false")
		expect(screen.getByLabelText("MCP server name or description")).toBeInTheDocument()
		expect(screen.getByText("Context7 installed")).toBeInTheDocument()

		fireEvent.click(screen.getByRole("tab", { name: "Create new" }))

		expect(screen.getByRole("tab", { name: "Find existing" })).toHaveAttribute("aria-selected", "false")
		expect(screen.getByRole("tab", { name: "Create new" })).toHaveAttribute("aria-selected", "true")
		expect(screen.getByLabelText("What should the new MCP server do?")).toBeInTheDocument()
		expect(
			screen.getByText(
				"Context7 and web search can help with docs, but creation is not blocked if they are not installed.",
			),
		).toBeInTheDocument()
		expect(screen.queryByText("Context7 installed")).not.toBeInTheDocument()

		fireEvent.click(screen.getByRole("tab", { name: "Find existing" }))

		expect(screen.getByLabelText("MCP server name or description")).toBeInTheDocument()
		expect(screen.getByText("Context7 installed")).toBeInTheDocument()
	})

	it("shows missing custom discovery prerequisites instead of starting a task", () => {
		render(<McpMarketplace servers={[]} />)

		expect(
			screen.getByText(
				"Install Context7 and at least one web search MCP server before starting custom MCP discovery.",
			),
		).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Discover with AI/i })).toBeDisabled()

		fireEvent.change(screen.getByLabelText("MCP server name or description"), {
			target: { value: "Perplexity search MCP server" },
		})

		expect(screen.getByRole("button", { name: /Discover with AI/i })).toBeDisabled()
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("keeps custom discovery disabled for empty input when prerequisites are installed", () => {
		render(
			<McpMarketplace
				servers={
					[
						{ name: "context7", config: "{}", status: "connected" },
						{ name: "exa", config: "{}", status: "connected" },
					] as any
				}
			/>,
		)

		expect(screen.queryByText(/before starting custom MCP discovery/i)).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Discover with AI/i })).toBeDisabled()
	})

	it("validates an empty custom creation request without requiring discovery prerequisites", () => {
		render(<McpMarketplace servers={[]} />)

		fireEvent.click(screen.getByRole("tab", { name: "Create new" }))

		const input = screen.getByLabelText("What should the new MCP server do?")
		expect(screen.queryByText(/before starting custom MCP discovery/i)).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Create with AI/i })).toBeDisabled()

		fireEvent.submit(input.closest("form")!)

		expect(
			screen.getByText("Enter what you want the MCP server to do before starting custom MCP server creation."),
		).toBeInTheDocument()
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("posts a custom discovery message when Context7 and web search are installed", () => {
		render(
			<McpMarketplace
				servers={
					[
						{ name: "context7", config: "{}", status: "connected" },
						{ name: "exa", config: "{}", status: "connected" },
					] as any
				}
			/>,
		)

		fireEvent.change(screen.getByLabelText("MCP server name or description"), {
			target: { value: " Perplexity search MCP server " },
		})
		fireEvent.click(screen.getByRole("button", { name: /Discover with AI/i }))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "discoverMarketplaceMcp",
			marketplaceMcpDiscoveryRequest: "Perplexity search MCP server",
		})
	})

	it("posts a custom creation message without requiring web search prerequisites", () => {
		render(<McpMarketplace servers={[]} />)

		fireEvent.click(screen.getByRole("tab", { name: "Create new" }))
		fireEvent.change(screen.getByLabelText("What should the new MCP server do?"), {
			target: { value: " Build a workspace docs lookup MCP server " },
		})
		fireEvent.click(screen.getByRole("button", { name: /Create with AI/i }))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "createMarketplaceMcpServer",
			marketplaceMcpCreationRequest: "Build a workspace docs lookup MCP server",
		})
	})
})

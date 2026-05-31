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

	it("renders marketplace catalog cards with setup metadata", () => {
		render(<McpMarketplace servers={[]} />)

		expect(screen.getByText("MCP Marketplace")).toBeInTheDocument()
		expect(screen.getByText(String(marketplaceMcpCatalog.length))).toBeInTheDocument()
		expect(screen.getByText("Curated servers")).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Filesystem" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "GitHub" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Context7" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Exa Web Search" })).toBeInTheDocument()
		expect(screen.getByText("@modelcontextprotocol/server-filesystem")).toBeInTheDocument()
		expect(screen.getByText("@upstash/context7-mcp")).toBeInTheDocument()
		expect(screen.getByText("exa-mcp-server")).toBeInTheDocument()
		expect(screen.getByText("GITHUB_PERSONAL_ACCESS_TOKEN")).toBeInTheDocument()
		expect(screen.getByText("EXA_API_KEY")).toBeInTheDocument()
		expect(screen.getByText("streamable-http")).toBeInTheDocument()
		expect(screen.getAllByText("stdio").length).toBeGreaterThan(0)
	})

	it("filters catalog cards by search query", () => {
		render(<McpMarketplace servers={[]} />)

		fireEvent.change(screen.getByLabelText("Search marketplace"), { target: { value: "context7" } })

		expect(screen.getByRole("heading", { name: "Context7" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: "GitHub" })).not.toBeInTheDocument()
		expect(screen.getByText(`Showing 1 of ${marketplaceMcpCatalog.length} servers`)).toBeInTheDocument()
	})

	it("filters catalog cards by category", () => {
		render(<McpMarketplace servers={[]} />)

		fireEvent.click(screen.getByRole("button", { name: "Search" }))

		expect(screen.getByRole("heading", { name: "Exa Web Search" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Brave Search" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Tavily Search" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: "Filesystem" })).not.toBeInTheDocument()
		expect(screen.getByText(`Showing 3 of ${marketplaceMcpCatalog.length} servers`)).toBeInTheDocument()
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
		expect(within(githubCard!).getByRole("button", { name: /Configure Again/i })).toBeInTheDocument()
	})

	it("posts the marketplace install message with the recommended scope", () => {
		const item = marketplaceMcpCatalog[0]

		render(<McpMarketplace servers={[]} />)

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

		fireEvent.change(within(itemCard!).getByLabelText(`Target scope ${item.name}`), { target: { value: "global" } })
		fireEvent.click(within(itemCard!).getByRole("button", { name: /Install with AI/i }))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "installMarketplaceMcp",
			marketplaceMcpId: item.id,
			marketplaceMcpScope: "global",
		})
	})
})

import React from "react"
import { fireEvent, render, screen, within } from "@/utils/test-utils"

import { marketplaceMcpCatalog } from "@roo/mcpMarketplace"
import { vscode } from "@src/utils/vscode"

import McpMarketplace from "../McpMarketplace"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"mcp:marketplace.title": "MCP Marketplace",
				"mcp:marketplace.description": "Choose a trusted MCP server and let C set it up in a new task.",
				"mcp:marketplace.featuredCatalog": "Featured MCP servers",
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
				"mcp:marketplace.status.installed": "Installed",
				"mcp:marketplace.noneRequired": "None required",
			}

			return translations[key] || key
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

	it("renders marketplace catalog cards with setup metadata", () => {
		render(<McpMarketplace servers={[]} />)

		expect(screen.getByText("MCP Marketplace")).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "Filesystem" })).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "GitHub" })).toBeInTheDocument()
		expect(screen.getByText("@modelcontextprotocol/server-filesystem")).toBeInTheDocument()
		expect(screen.getByText("GITHUB_PERSONAL_ACCESS_TOKEN")).toBeInTheDocument()
		expect(screen.getAllByText("stdio").length).toBeGreaterThan(0)
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

		const githubCard = screen.getByRole("heading", { name: "GitHub" }).closest("article")

		expect(githubCard).toBeTruthy()
		expect(within(githubCard!).getByText("Installed")).toBeInTheDocument()
		expect(within(githubCard!).getByRole("button", { name: /Configure Again/i })).toBeInTheDocument()
	})

	it("posts the marketplace install message with the recommended scope", () => {
		const item = marketplaceMcpCatalog[0]

		render(<McpMarketplace servers={[]} />)

		fireEvent.click(screen.getAllByRole("button", { name: /Install with AI/i })[0])

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "installMarketplaceMcp",
			marketplaceMcpId: item.id,
			marketplaceMcpScope: item.recommendedScope,
		})
	})

	it("posts the selected target scope", () => {
		const item = marketplaceMcpCatalog[0]

		render(<McpMarketplace servers={[]} />)

		const itemCard = screen.getByRole("heading", { name: item.name }).closest("article")
		expect(itemCard).toBeTruthy()

		fireEvent.change(within(itemCard!).getByLabelText(`Target scope ${item.name}`), { target: { value: "global" } })
		fireEvent.click(within(itemCard!).getByRole("button", { name: /Install with AI/i }))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "installMarketplaceMcp",
			marketplaceMcpId: item.id,
			marketplaceMcpScope: "global",
		})
	})
})

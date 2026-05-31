import {
	buildMarketplaceMcpSetupPrompt,
	getMarketplaceMcpItem,
	isMarketplaceMcpScope,
	marketplaceMcpCatalog,
} from "../marketplaceCatalog"

describe("marketplaceCatalog", () => {
	it("contains the curated MCP marketplace entries", () => {
		expect(marketplaceMcpCatalog.map((item) => item.id)).toEqual([
			"filesystem",
			"github",
			"notion",
			"linear",
			"context7",
			"exa-web-search",
			"google-drive",
			"sentry",
			"memory",
			"sequential-thinking",
			"sqlite",
			"postgresql",
			"playwright",
			"brave-search",
			"tavily-search",
			"firecrawl",
		])
	})

	it("includes Context7 and Exa metadata, secrets, and config templates", () => {
		const context7 = getMarketplaceMcpItem("context7")
		const exa = getMarketplaceMcpItem("exa-web-search")

		expect(context7).toMatchObject({
			serverName: "context7",
			name: "Context7",
			category: "Documentation",
			transportType: "streamable-http",
			recommendedScope: "global",
			requiredSecrets: [],
			optionalSecrets: ["CONTEXT7_API_KEY"],
			documentationUrl: "https://github.com/upstash/context7",
			sampleConfig: {
				type: "streamable-http",
				url: "https://mcp.context7.com/mcp",
			},
		})
		expect(context7?.prerequisites).toContain("Network access to https://mcp.context7.com/mcp")

		expect(exa).toMatchObject({
			serverName: "exa",
			name: "Exa Web Search",
			category: "Search",
			transportType: "stdio",
			recommendedScope: "global",
			requiredSecrets: ["EXA_API_KEY"],
			documentationUrl: "https://docs.exa.ai/reference/exa-mcp",
			sampleConfig: {
				command: "npx",
				args: ["-y", "exa-mcp-server"],
				env: {
					EXA_API_KEY: "${env:EXA_API_KEY}",
				},
			},
		})
		expect(exa?.riskNotes).toContain("Search queries and fetched URLs are sent to Exa")
	})

	it("looks up items by trusted catalog id", () => {
		expect(getMarketplaceMcpItem("github")?.serverName).toBe("github")
		expect(getMarketplaceMcpItem("unknown-server")).toBeUndefined()
	})

	it("validates supported marketplace target scopes", () => {
		expect(isMarketplaceMcpScope("global")).toBe(true)
		expect(isMarketplaceMcpScope("project")).toBe(true)
		expect(isMarketplaceMcpScope("workspace")).toBe(false)
	})

	it("builds a deterministic setup prompt with scope, secrets, merge, and verification instructions", () => {
		const item = getMarketplaceMcpItem("github")

		expect(item).toBeDefined()

		const prompt = buildMarketplaceMcpSetupPrompt(item!, "global", {
			globalConfigPath: "/mock/global/mcp_settings.json",
		})

		expect(prompt).toContain('Set up the "GitHub" MCP server')
		expect(prompt).toContain("Target scope: global")
		expect(prompt).toContain("/mock/global/mcp_settings.json")
		expect(prompt).toContain("GITHUB_PERSONAL_ACCESS_TOKEN")
		expect(prompt).toContain("Optional secrets:\n- None")
		expect(prompt).toContain("merge under the existing top-level mcpServers object")
		expect(prompt).toContain("Preserve all existing servers")
		expect(prompt).toContain("Do not echo, log, or store literal secret values")
		expect(prompt).toContain("Verify the server connects")
	})

	it("includes optional secrets and streamable HTTP config in setup prompts", () => {
		const item = getMarketplaceMcpItem("context7")

		expect(item).toBeDefined()

		const prompt = buildMarketplaceMcpSetupPrompt(item!, "global")

		expect(prompt).toContain('Set up the "Context7" MCP server')
		expect(prompt).toContain("Optional secrets:\n- CONTEXT7_API_KEY")
		expect(prompt).toContain('"type": "streamable-http"')
		expect(prompt).toContain('"url": "https://mcp.context7.com/mcp"')
		expect(prompt).toContain("Resolve a public library such as Next.js")
	})
})

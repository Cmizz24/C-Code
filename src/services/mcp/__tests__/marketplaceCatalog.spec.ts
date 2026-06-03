import {
	buildMarketplaceMcpCreationPrompt,
	buildMarketplaceMcpDiscoveryPrompt,
	buildMarketplaceMcpSetupPrompt,
	getMarketplaceMcpDiscoveryPrerequisiteStatus,
	getMarketplaceMcpItem,
	isMarketplaceMcpCatalogItemInstalled,
	isMarketplaceMcpContext7ServerIdentifier,
	isMarketplaceMcpScope,
	isMarketplaceMcpWebSearchServerIdentifier,
	marketplaceMcpCatalog,
} from "../marketplaceCatalog"

describe("marketplaceCatalog", () => {
	it("contains the expanded curated MCP marketplace entries", () => {
		const catalogIds = marketplaceMcpCatalog.map((item) => item.id)

		expect(marketplaceMcpCatalog).toHaveLength(50)
		expect(new Set(catalogIds).size).toBe(catalogIds.length)
		expect(catalogIds).toEqual(
			expect.arrayContaining([
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
				"git",
				"fetch",
				"time",
				"puppeteer",
				"slack",
				"google-maps",
				"redis",
				"gitlab",
				"aws-kb-retrieval",
				"docker",
				"kubernetes",
				"aws-documentation",
				"azure",
				"supabase",
				"stripe",
				"shopify",
				"browserbase",
				"figma",
				"atlassian",
				"gmail",
				"google-calendar",
				"google-sheets",
				"bigquery",
				"snowflake",
				"mongodb",
				"elasticsearch",
				"qdrant",
				"chroma",
				"datadog",
				"grafana",
				"prometheus",
				"logfire",
				"airtable",
				"hubspot",
			]),
		)

		for (const item of marketplaceMcpCatalog) {
			expect(item.serverName).toBeTruthy()
			expect(item.name).toBeTruthy()
			expect(item.category).toBeTruthy()
			expect(item.description).toBeTruthy()
			expect(item.packageName).toBeTruthy()
			expect(item.sourceUrl).toMatch(/^https:\/\//)
			expect(item.transportType).toMatch(/^(stdio|streamable-http)$/)
			expect(item.recommendedScope).toMatch(/^(global|project)$/)
			expect(item.verificationApproach).toBeTruthy()
			expect(item.sampleConfig).toBeTruthy()
		}
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

	it("matches installed catalog items and custom discovery prerequisites by trusted identifiers", () => {
		const context7 = getMarketplaceMcpItem("context7")
		const exa = getMarketplaceMcpItem("exa-web-search")
		const github = getMarketplaceMcpItem("github")

		expect(context7).toBeDefined()
		expect(exa).toBeDefined()
		expect(github).toBeDefined()
		expect(isMarketplaceMcpCatalogItemInstalled(context7!, ["Context7"])).toBe(true)
		expect(isMarketplaceMcpCatalogItemInstalled(exa!, ["exa-web-search"])).toBe(true)
		expect(isMarketplaceMcpCatalogItemInstalled(github!, ["not-github"])).toBe(false)
		expect(isMarketplaceMcpContext7ServerIdentifier("@upstash/context7-mcp")).toBe(true)
		expect(isMarketplaceMcpWebSearchServerIdentifier("exa")).toBe(true)
		expect(isMarketplaceMcpWebSearchServerIdentifier("firecrawl")).toBe(true)
		expect(isMarketplaceMcpWebSearchServerIdentifier("github")).toBe(false)

		expect(getMarketplaceMcpDiscoveryPrerequisiteStatus([])).toEqual({
			hasContext7: false,
			hasWebSearch: false,
			missing: ["context7", "webSearch"],
		})
		expect(getMarketplaceMcpDiscoveryPrerequisiteStatus(["context7"])).toEqual({
			hasContext7: true,
			hasWebSearch: false,
			missing: ["webSearch"],
		})
		expect(getMarketplaceMcpDiscoveryPrerequisiteStatus(["context7", "brave-search"])).toEqual({
			hasContext7: true,
			hasWebSearch: true,
			missing: [],
		})
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
		expect(prompt).toContain("dedicated MCP Setup mode")
		expect(prompt).toContain("Stay within MCP setup work")
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

	it("builds a deterministic custom discovery prompt with research, safety, and verification instructions", () => {
		const prompt = buildMarketplaceMcpDiscoveryPrompt(" Perplexity search MCP server ", {
			globalConfigPath: "/mock/global/mcp_settings.json",
			projectConfigPath: "/mock/workspace/.roo/mcp.json",
			installedServerNames: ["context7", "exa"],
		})

		expect(prompt).toContain("Find and set up the requested MCP server")
		expect(prompt).toContain("Perplexity search MCP server")
		expect(prompt).toContain("- context7")
		expect(prompt).toContain("- exa")
		expect(prompt).toContain("/mock/global/mcp_settings.json")
		expect(prompt).toContain("/mock/workspace/.roo/mcp.json")
		expect(prompt).toContain("Use the installed Context7 MCP server")
		expect(prompt).toContain("Use an installed web search MCP server")
		expect(prompt).toContain("Verify the official source")
		expect(prompt).toContain("Propose a safe MCP config")
		expect(prompt).toContain("Do not echo, log, or store literal secret values")
		expect(prompt).toContain("Request approval before running commands")
		expect(prompt).toContain("Verify the server connects")
		expect(prompt).toContain("Report the discovered official source/docs")
	})

	it("builds a deterministic custom creation prompt with implementation, config, secrets, and verification instructions", () => {
		const prompt = buildMarketplaceMcpCreationPrompt(" Build a workspace docs lookup MCP server ", {
			globalConfigPath: "/mock/global/mcp_settings.json",
			projectConfigPath: "/mock/workspace/.roo/mcp.json",
			installedServerNames: ["context7"],
		})

		expect(prompt).toContain("Create a new custom MCP server")
		expect(prompt).toContain("Build a workspace docs lookup MCP server")
		expect(prompt).toContain("- context7")
		expect(prompt).toContain("/mock/global/mcp_settings.json")
		expect(prompt).toContain("/mock/workspace/.roo/mcp.json")
		expect(prompt).toContain("Prefer a simple local TypeScript/Node MCP server")
		expect(prompt).toContain("safe project-local location")
		expect(prompt).toContain("merge MCP config under the existing top-level mcpServers object")
		expect(prompt).toContain("Preserve all existing servers")
		expect(prompt).toContain("Use environment variables")
		expect(prompt).toContain("${env:SECRET_NAME}")
		expect(prompt).toContain("Request approval before running commands")
		expect(prompt).toContain("Verify the server connects")
		expect(prompt).toContain("safe, non-destructive test call")
		expect(prompt).toContain("Report the final server name")
	})
})

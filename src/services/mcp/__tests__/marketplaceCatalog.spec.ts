import {
	buildMarketplaceMcpSetupPrompt,
	getMarketplaceMcpItem,
	isMarketplaceMcpScope,
	marketplaceMcpCatalog,
} from "../marketplaceCatalog"

describe("marketplaceCatalog", () => {
	it("contains the initial curated MCP marketplace entries", () => {
		expect(marketplaceMcpCatalog.map((item) => item.id)).toEqual([
			"filesystem",
			"github",
			"sqlite",
			"postgresql",
			"playwright",
			"brave-search",
		])
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
		expect(prompt).toContain("merge under the existing top-level mcpServers object")
		expect(prompt).toContain("Preserve all existing servers")
		expect(prompt).toContain("Do not echo, log, or store literal secret values")
		expect(prompt).toContain("Verify the server connects")
	})
})

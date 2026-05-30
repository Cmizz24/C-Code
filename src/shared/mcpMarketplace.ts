export type MarketplaceMcpScope = "global" | "project"

export type MarketplaceMcpTransport = "stdio" | "streamable-http" | "sse"

export interface MarketplaceMcpCatalogItem {
	id: string
	serverName: string
	name: string
	category: string
	description: string
	packageName: string
	source: string
	sourceUrl: string
	documentationUrl?: string
	transportType: MarketplaceMcpTransport
	recommendedScope: MarketplaceMcpScope
	requiredSecrets: string[]
	prerequisites: string[]
	verificationApproach: string
	riskNotes: string
	setupNotes: string[]
	sampleConfig: Record<string, unknown>
}

export const marketplaceMcpCatalog = [
	{
		id: "filesystem",
		serverName: "filesystem",
		name: "Filesystem",
		category: "Local files",
		description: "Read and manage files inside explicitly approved directories.",
		packageName: "@modelcontextprotocol/server-filesystem",
		source: "npm package from the Model Context Protocol project",
		sourceUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem",
		documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
		transportType: "stdio",
		recommendedScope: "project",
		requiredSecrets: [],
		prerequisites: ["Node.js", "One or more explicit directories the server may access"],
		verificationApproach: "List allowed directories or read a small known file from an approved directory.",
		riskNotes:
			"Can expose local file contents within configured directories; restrict paths to the smallest safe scope.",
		setupNotes: [
			"Confirm the exact directory or directories the user wants to expose before writing config.",
			"Use absolute paths where possible and avoid broad roots such as the user home directory unless explicitly requested.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-filesystem", "<workspace-or-approved-directory>"],
		},
	},
	{
		id: "github",
		serverName: "github",
		name: "GitHub",
		category: "Developer tools",
		description:
			"Work with GitHub repositories, issues, pull requests, and code search using a personal access token.",
		packageName: "@modelcontextprotocol/server-github",
		source: "npm package from the Model Context Protocol project",
		sourceUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-github",
		documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
		transportType: "stdio",
		recommendedScope: "global",
		requiredSecrets: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
		prerequisites: ["Node.js", "GitHub personal access token with the minimum repo scopes needed"],
		verificationApproach:
			"Call a read-only GitHub tool such as listing the authenticated user or a known repository.",
		riskNotes:
			"Token permissions may allow repository reads or writes; use a least-privilege token and avoid echoing it.",
		setupNotes: [
			"Ask for the token only if it is not already available as an environment variable or secret placeholder.",
			"Prefer environment placeholders in MCP config instead of literal token values.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-github"],
			env: {
				GITHUB_PERSONAL_ACCESS_TOKEN: "${env:GITHUB_PERSONAL_ACCESS_TOKEN}",
			},
		},
	},
	{
		id: "sqlite",
		serverName: "sqlite",
		name: "SQLite",
		category: "Databases",
		description: "Inspect and query a local SQLite database file.",
		packageName: "@modelcontextprotocol/server-sqlite",
		source: "npm package from the Model Context Protocol project",
		sourceUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-sqlite",
		documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
		transportType: "stdio",
		recommendedScope: "project",
		requiredSecrets: [],
		prerequisites: ["Node.js", "Path to a SQLite database file"],
		verificationApproach:
			"Run a read-only schema inspection or a harmless SELECT query against the configured database.",
		riskNotes: "May expose local database contents; verify with read-only queries and avoid modifying tables.",
		setupNotes: [
			"Confirm the database file path before writing config.",
			"Use read-only verification queries unless the user explicitly asks for writes.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-sqlite", "<path-to-database.sqlite>"],
		},
	},
	{
		id: "postgresql",
		serverName: "postgres",
		name: "PostgreSQL",
		category: "Databases",
		description: "Inspect schemas and run SQL queries against a PostgreSQL database.",
		packageName: "@modelcontextprotocol/server-postgres",
		source: "npm package from the Model Context Protocol project",
		sourceUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-postgres",
		documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
		transportType: "stdio",
		recommendedScope: "project",
		requiredSecrets: ["POSTGRES_CONNECTION_STRING"],
		prerequisites: [
			"Node.js",
			"Network access to PostgreSQL",
			"Connection string with least-privilege credentials",
		],
		verificationApproach: "Run a read-only connection check such as SELECT version() or schema listing.",
		riskNotes:
			"Database credentials may allow sensitive reads or writes; use least-privilege credentials and read-only checks.",
		setupNotes: [
			"Ask for the connection string only if it is not already available through an environment variable or placeholder.",
			"Do not run destructive SQL during setup or verification.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-postgres", "${env:POSTGRES_CONNECTION_STRING}"],
			env: {
				POSTGRES_CONNECTION_STRING: "${env:POSTGRES_CONNECTION_STRING}",
			},
		},
	},
	{
		id: "playwright",
		serverName: "playwright",
		name: "Playwright",
		category: "Browser automation",
		description: "Automate browser interactions for inspection, screenshots, and end-to-end verification.",
		packageName: "@playwright/mcp",
		source: "npm package from Microsoft Playwright",
		sourceUrl: "https://www.npmjs.com/package/@playwright/mcp",
		documentationUrl: "https://github.com/microsoft/playwright-mcp",
		transportType: "stdio",
		recommendedScope: "project",
		requiredSecrets: [],
		prerequisites: ["Node.js", "Browser binaries installed by Playwright if required"],
		verificationApproach:
			"Open a harmless public page or local dev URL and read the page title without submitting data.",
		riskNotes:
			"Browser automation can interact with websites; avoid logging into accounts or submitting forms during verification.",
		setupNotes: [
			"Inspect current @playwright/mcp documentation for the recommended launch command before writing config.",
			"If browser binaries are missing, install only the required browser dependencies after approval.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "@playwright/mcp"],
		},
	},
	{
		id: "brave-search",
		serverName: "brave-search",
		name: "Brave Search",
		category: "Search",
		description: "Search the web through the Brave Search API.",
		packageName: "@modelcontextprotocol/server-brave-search",
		source: "npm package from the Model Context Protocol project",
		sourceUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-brave-search",
		documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
		transportType: "stdio",
		recommendedScope: "global",
		requiredSecrets: ["BRAVE_API_KEY"],
		prerequisites: ["Node.js", "Brave Search API key"],
		verificationApproach: "Run a low-risk read-only search query and confirm results are returned.",
		riskNotes: "Search queries are sent to Brave; avoid private or secret terms in verification queries.",
		setupNotes: [
			"Ask for the API key only if it is not already available as an environment variable or secret placeholder.",
			"Use a generic verification query that does not include private project details.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-brave-search"],
			env: {
				BRAVE_API_KEY: "${env:BRAVE_API_KEY}",
			},
		},
	},
] as const satisfies readonly MarketplaceMcpCatalogItem[]

export type MarketplaceMcpCatalogId = (typeof marketplaceMcpCatalog)[number]["id"]

export const marketplaceMcpCatalogById = Object.fromEntries(
	marketplaceMcpCatalog.map((item) => [item.id, item]),
) as Record<string, MarketplaceMcpCatalogItem>

export const getMarketplaceMcpCatalogItem = (id: string | undefined) => {
	return id ? marketplaceMcpCatalogById[id] : undefined
}

export const isMarketplaceMcpScope = (scope: unknown): scope is MarketplaceMcpScope => {
	return scope === "global" || scope === "project"
}

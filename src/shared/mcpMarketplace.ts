export type MarketplaceMcpScope = "global" | "project"

export type MarketplaceMcpTransport = "stdio" | "streamable-http" | "sse"

export interface MarketplaceMcpCatalogItem {
	id: string
	serverName: string
	name: string
	featured?: boolean
	popular?: boolean
	category: string
	description: string
	packageName: string
	source: string
	sourceUrl: string
	documentationUrl?: string
	transportType: MarketplaceMcpTransport
	recommendedScope: MarketplaceMcpScope
	requiredSecrets: string[]
	optionalSecrets?: string[]
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
		popular: true,
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
		featured: true,
		popular: true,
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
		id: "notion",
		serverName: "notionApi",
		name: "Notion",
		featured: true,
		popular: true,
		category: "Knowledge & productivity",
		description: "Search, read, and update Notion workspace content through Notion's MCP server.",
		packageName: "@notionhq/notion-mcp-server",
		source: "official npm package from Notion",
		sourceUrl: "https://www.npmjs.com/package/@notionhq/notion-mcp-server",
		documentationUrl: "https://developers.notion.com/docs/mcp",
		transportType: "stdio",
		recommendedScope: "global",
		requiredSecrets: ["NOTION_TOKEN"],
		optionalSecrets: ["OPENAPI_MCP_HEADERS"],
		prerequisites: [
			"Node.js",
			"Notion integration token or approved Notion MCP OAuth setup",
			"Pages connected to the Notion integration",
		],
		verificationApproach:
			"Run a read-only search or retrieve a known non-sensitive page that has been explicitly shared with the integration.",
		riskNotes:
			"Can read or update connected Notion pages depending on integration capabilities; use least-privilege permissions and avoid broad workspace access.",
		setupNotes: [
			"Inspect current Notion MCP documentation before deciding between remote OAuth setup and the local npm package.",
			"Ask for NOTION_TOKEN only if the user chooses the local package and it is not already available as an environment variable or secret placeholder.",
			"Confirm which pages or workspaces are connected to the Notion integration before verifying access.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "@notionhq/notion-mcp-server"],
			env: {
				NOTION_TOKEN: "${env:NOTION_TOKEN}",
			},
		},
	},
	{
		id: "linear",
		serverName: "linear",
		name: "Linear",
		popular: true,
		category: "Project management",
		description: "Manage Linear issues, projects, and teams through a token-backed MCP server.",
		packageName: "linear-mcp",
		source: "community npm package from dvcrn",
		sourceUrl: "https://www.npmjs.com/package/linear-mcp",
		documentationUrl: "https://github.com/dvcrn/linear-mcp",
		transportType: "stdio",
		recommendedScope: "global",
		requiredSecrets: ["LINEAR_ACCESS_TOKEN"],
		prerequisites: ["Node.js", "Linear developer token with the minimum scopes needed"],
		verificationApproach:
			"List teams or fetch a known public-safe issue first; avoid creating or updating issues during setup verification.",
		riskNotes:
			"Linear tokens can expose or modify planning data; use a least-privilege token and avoid destructive issue or project changes.",
		setupNotes: [
			"Ask for the Linear token only if LINEAR_ACCESS_TOKEN is not already available as an environment variable or secret placeholder.",
			"For multiple workspaces, configure unique server names and tool prefixes rather than reusing the same server name.",
			"Use read-only verification until the user explicitly asks to create or edit Linear records.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "linear-mcp"],
			env: {
				LINEAR_ACCESS_TOKEN: "${env:LINEAR_ACCESS_TOKEN}",
			},
		},
	},
	{
		id: "context7",
		serverName: "context7",
		name: "Context7",
		featured: true,
		popular: true,
		category: "Documentation",
		description:
			"Fetch up-to-date, version-specific library documentation and code examples directly into MCP context.",
		packageName: "@upstash/context7-mcp",
		source: "hosted Context7 MCP endpoint and npm package from Upstash",
		sourceUrl: "https://www.npmjs.com/package/@upstash/context7-mcp",
		documentationUrl: "https://github.com/upstash/context7",
		transportType: "streamable-http",
		recommendedScope: "global",
		requiredSecrets: [],
		optionalSecrets: ["CONTEXT7_API_KEY"],
		prerequisites: [
			"Network access to https://mcp.context7.com/mcp",
			"Optional Context7 API key for higher rate limits or private repositories",
		],
		verificationApproach:
			"Resolve a public library such as Next.js and query a small, non-sensitive documentation topic.",
		riskNotes:
			"Documentation queries are sent to Context7; avoid private package names unless using an approved account and API key.",
		setupNotes: [
			"Inspect the current Context7 MCP documentation before choosing hosted streamable HTTP versus the npx stdio package.",
			"The API key is optional for basic public documentation use; if supplied, reference it through an environment placeholder or header rather than a literal value.",
			"Recommend adding a lightweight usage rule so coding questions can opt into Context7 when fresh docs are needed.",
		],
		sampleConfig: {
			type: "streamable-http",
			url: "https://mcp.context7.com/mcp",
		},
	},
	{
		id: "exa-web-search",
		serverName: "exa",
		name: "Exa Web Search",
		featured: true,
		popular: true,
		category: "Search",
		description: "Run real-time web search and fetch clean page content through Exa's MCP server.",
		packageName: "exa-mcp-server",
		source: "npm package and hosted MCP service from Exa",
		sourceUrl: "https://www.npmjs.com/package/exa-mcp-server",
		documentationUrl: "https://docs.exa.ai/reference/exa-mcp",
		transportType: "stdio",
		recommendedScope: "global",
		requiredSecrets: ["EXA_API_KEY"],
		prerequisites: ["Node.js", "Exa API key"],
		verificationApproach:
			"Run a read-only search for a public, non-sensitive query and confirm result titles and URLs are returned.",
		riskNotes: "Search queries and fetched URLs are sent to Exa; avoid private terms, secrets, and internal URLs.",
		setupNotes: [
			"Ask for the API key only if EXA_API_KEY is not already available as an environment variable or secret placeholder.",
			"Prefer the documented local npm command when the user wants a key-backed setup; consider hosted streamable HTTP only if current docs and Roo support the required authentication flow.",
			"Use generic public verification queries that do not reveal project details.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "exa-mcp-server"],
			env: {
				EXA_API_KEY: "${env:EXA_API_KEY}",
			},
		},
	},
	{
		id: "google-drive",
		serverName: "gdrive",
		name: "Google Drive",
		popular: true,
		category: "Cloud files",
		description: "Search, list, and read Google Drive files after a local OAuth setup.",
		packageName: "@modelcontextprotocol/server-gdrive",
		source: "npm package from the Model Context Protocol project",
		sourceUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-gdrive",
		documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive",
		transportType: "stdio",
		recommendedScope: "global",
		requiredSecrets: [],
		prerequisites: [
			"Node.js",
			"Google Cloud OAuth desktop client with readonly Drive scope",
			"Completed local OAuth credential flow",
		],
		verificationApproach:
			"Run a read-only file search for a generic term or list accessible files without opening sensitive documents.",
		riskNotes:
			"Can expose accessible Google Drive filenames and file contents; use readonly scopes and avoid indexing or opening private documents during setup.",
		setupNotes: [
			"Confirm the user has completed the OAuth client and credential setup before adding the server.",
			"If credentials are missing, guide the user through OAuth setup before attempting to verify MCP tools.",
			"Use the documented npx config once credentials are already available locally.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-gdrive"],
		},
	},
	{
		id: "sentry",
		serverName: "sentry",
		name: "Sentry",
		featured: true,
		popular: true,
		category: "Observability",
		description: "Investigate Sentry issues, errors, and project context through Sentry's official MCP server.",
		packageName: "@sentry/mcp-server",
		source: "official npm package and hosted MCP service from Sentry",
		sourceUrl: "https://www.npmjs.com/package/@sentry/mcp-server",
		documentationUrl: "https://docs.sentry.io/ai/mcp/",
		transportType: "stdio",
		recommendedScope: "global",
		requiredSecrets: [],
		optionalSecrets: ["SENTRY_ACCESS_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
		prerequisites: [
			"Node.js",
			"Sentry account for device-code authentication or a self-hosted Sentry token",
			"Optional embedded agent provider configuration for AI-powered search tools",
		],
		verificationApproach:
			"Authenticate with Sentry, then list organizations or projects before reading a non-sensitive issue summary.",
		riskNotes:
			"May expose production errors, stack traces, user data, or project metadata; use least-privilege access and avoid pasting sensitive event payloads.",
		setupNotes: [
			"Inspect current Sentry MCP docs before deciding between hosted remote MCP and local stdio setup.",
			"For sentry.io, prefer device-code authentication instead of manually collecting a token when the environment is interactive.",
			"For self-hosted Sentry, use SENTRY_ACCESS_TOKEN and SENTRY_HOST placeholders rather than literal values.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "@sentry/mcp-server@latest"],
		},
	},
	{
		id: "memory",
		serverName: "memory",
		name: "Memory",
		popular: true,
		category: "Knowledge & memory",
		description: "Maintain a local knowledge graph of durable facts that can be reused across conversations.",
		packageName: "@modelcontextprotocol/server-memory",
		source: "npm package from the Model Context Protocol project",
		sourceUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-memory",
		documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
		transportType: "stdio",
		recommendedScope: "global",
		requiredSecrets: [],
		prerequisites: ["Node.js", "Agreement on what kinds of facts are safe to store"],
		verificationApproach:
			"List or search the knowledge graph with a harmless query, or create only a clearly disposable test entity if the user approves.",
		riskNotes:
			"May persist sensitive personal or project facts locally; establish clear boundaries and avoid storing secrets or credentials.",
		setupNotes: [
			"Confirm whether the user wants global memory or project-specific memory before writing config.",
			"Avoid seeding memory with sensitive facts during setup; prefer read-only verification if possible.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-memory"],
		},
	},
	{
		id: "sequential-thinking",
		serverName: "sequential-thinking",
		name: "Sequential Thinking",
		popular: true,
		category: "Reasoning",
		description: "Expose a structured thinking tool for breaking down complex problems step by step.",
		packageName: "@modelcontextprotocol/server-sequential-thinking",
		source: "npm package from the Model Context Protocol project",
		sourceUrl: "https://www.npmjs.com/package/@modelcontextprotocol/server-sequential-thinking",
		documentationUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
		transportType: "stdio",
		recommendedScope: "global",
		requiredSecrets: [],
		prerequisites: ["Node.js"],
		verificationApproach: "Run a short, non-sensitive one-step reasoning check and confirm the tool responds.",
		riskNotes:
			"Reasoning traces may include user-provided details; do not include secrets, credentials, or private data in verification prompts.",
		setupNotes: [
			"Use the documented npx command and keep the setup global unless the user wants project-local behavior.",
			"Verify with a simple public puzzle or planning example rather than private project data.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
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
		featured: true,
		popular: true,
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
		popular: true,
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
	{
		id: "tavily-search",
		serverName: "tavily",
		name: "Tavily Search",
		popular: true,
		category: "Search",
		description: "Search and extract web content through Tavily's research-focused search API.",
		packageName: "tavily-mcp",
		source: "npm package from Tavily",
		sourceUrl: "https://www.npmjs.com/package/tavily-mcp",
		documentationUrl: "https://github.com/tavily-ai/tavily-mcp",
		transportType: "stdio",
		recommendedScope: "global",
		requiredSecrets: ["TAVILY_API_KEY"],
		prerequisites: ["Node.js", "Tavily API key"],
		verificationApproach:
			"Run a read-only search for a public, generic query and confirm source URLs are returned.",
		riskNotes: "Search queries are sent to Tavily; avoid private project names, credentials, or internal URLs.",
		setupNotes: [
			"Ask for the API key only if TAVILY_API_KEY is not already available as an environment variable or secret placeholder.",
			"Use generic public verification queries and avoid crawling private or authenticated pages.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "tavily-mcp"],
			env: {
				TAVILY_API_KEY: "${env:TAVILY_API_KEY}",
			},
		},
	},
	{
		id: "firecrawl",
		serverName: "firecrawl",
		name: "Firecrawl",
		popular: true,
		category: "Web scraping",
		description: "Scrape, search, and extract structured content from public web pages with Firecrawl.",
		packageName: "firecrawl-mcp",
		source: "npm package from Firecrawl",
		sourceUrl: "https://www.npmjs.com/package/firecrawl-mcp",
		documentationUrl: "https://github.com/firecrawl/firecrawl-mcp-server",
		transportType: "stdio",
		recommendedScope: "global",
		requiredSecrets: ["FIRECRAWL_API_KEY"],
		optionalSecrets: ["FIRECRAWL_API_URL"],
		prerequisites: [
			"Node.js",
			"Firecrawl API key for cloud usage",
			"Optional Firecrawl API URL for self-hosted instances",
		],
		verificationApproach:
			"Scrape a small public documentation page or run a generic public search without submitting private URLs.",
		riskNotes:
			"Scraping can send target URLs and page content to Firecrawl; respect site policies and avoid private or authenticated pages.",
		setupNotes: [
			"Ask for the API key only if FIRECRAWL_API_KEY is not already available as an environment variable or secret placeholder.",
			"If the user uses a self-hosted Firecrawl instance, verify FIRECRAWL_API_URL and authentication requirements before writing config.",
			"Use low-volume public verification to avoid consuming unnecessary credits.",
		],
		sampleConfig: {
			command: "npx",
			args: ["-y", "firecrawl-mcp"],
			env: {
				FIRECRAWL_API_KEY: "${env:FIRECRAWL_API_KEY}",
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

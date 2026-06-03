import {
	getMarketplaceMcpDiscoveryPrerequisiteStatus,
	getMarketplaceMcpCatalogItem,
	isMarketplaceMcpScope,
	isMarketplaceMcpContext7ServerIdentifier,
	isMarketplaceMcpWebSearchServerIdentifier,
	isMarketplaceMcpCatalogItemInstalled,
	marketplaceMcpCatalog,
	type MarketplaceMcpDiscoveryPrerequisiteStatus,
	type MarketplaceMcpCatalogItem,
	type MarketplaceMcpScope,
} from "../../shared/mcpMarketplace"

export {
	getMarketplaceMcpDiscoveryPrerequisiteStatus,
	getMarketplaceMcpCatalogItem,
	isMarketplaceMcpScope,
	isMarketplaceMcpContext7ServerIdentifier,
	isMarketplaceMcpWebSearchServerIdentifier,
	isMarketplaceMcpCatalogItemInstalled,
	marketplaceMcpCatalog,
	type MarketplaceMcpDiscoveryPrerequisiteStatus,
	type MarketplaceMcpCatalogItem,
	type MarketplaceMcpScope,
}

export const getMarketplaceMcpItem = getMarketplaceMcpCatalogItem

export interface MarketplaceMcpSetupPromptOptions {
	globalConfigPath?: string
	projectConfigPath?: string
}

export interface MarketplaceMcpDiscoveryPromptOptions extends MarketplaceMcpSetupPromptOptions {
	installedServerNames?: string[]
}

export interface MarketplaceMcpCreationPromptOptions extends MarketplaceMcpSetupPromptOptions {
	installedServerNames?: string[]
}

const formatList = (items: string[]) => {
	return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None"
}

const formatConfigTarget = (scope: MarketplaceMcpScope, options: MarketplaceMcpSetupPromptOptions) => {
	if (scope === "project") {
		return options.projectConfigPath
			? `Project MCP settings file: ${options.projectConfigPath}`
			: "Project MCP settings file: .roo/mcp.json in the current workspace"
	}

	return options.globalConfigPath
		? `Global MCP settings file: ${options.globalConfigPath}`
		: "Global MCP settings file: use C Code's global MCP settings file"
}

export const buildMarketplaceMcpSetupPrompt = (
	item: MarketplaceMcpCatalogItem,
	targetScope: MarketplaceMcpScope,
	options: MarketplaceMcpSetupPromptOptions = {},
) => {
	const suggestedConfig = JSON.stringify(
		{
			mcpServers: {
				[item.serverName]: item.sampleConfig,
			},
		},
		null,
		"\t",
	)

	return `Set up the "${item.name}" MCP server from C Code's trusted MCP Marketplace.

Marketplace metadata:
- Catalog id: ${item.id}
- Server name to configure under mcpServers: ${item.serverName}
- Category: ${item.category}
- Description: ${item.description}
- Package/source: ${item.packageName} (${item.source})
- Source URL: ${item.sourceUrl}
- Documentation URL: ${item.documentationUrl ?? item.sourceUrl}
- Transport type: ${item.transportType}
- Target scope: ${targetScope}
- Target config: ${formatConfigTarget(targetScope, options)}

Required secrets:
${formatList(item.requiredSecrets)}

Optional secrets:
${formatList(item.optionalSecrets ?? [])}

Prerequisites:
${formatList(item.prerequisites)}

Risk notes:
- ${item.riskNotes}

Setup notes:
${formatList(item.setupNotes)}

Suggested MCP config starting point, to merge under the existing top-level mcpServers object without deleting any existing servers:
\`\`\`json
${suggestedConfig}
\`\`\`

Mode guidance:
- You are running in the dedicated MCP Setup mode for installation, configuration, troubleshooting, and verification of MCP servers.
- Stay within MCP setup work. Do not refactor unrelated project code, rewrite unrelated settings, or mutate existing MCP servers beyond the requested merge unless the user explicitly asks.

Task requirements:
1. Inspect the marketplace metadata and current upstream package documentation before choosing final command arguments.
2. Confirm prerequisites. Ask the user only for genuinely missing secrets or required local values, such as paths, database connection strings, or API keys.
3. Do not echo, log, or store literal secret values in the conversation. Prefer environment placeholders such as \${env:SECRET_NAME} in MCP config.
4. Install or invoke the package using the safest current documented command. Request approval before running commands that install packages or change files.
5. Open or create the ${targetScope} MCP settings file. If the file is missing, create a valid JSON object with a top-level mcpServers object.
6. Merge the ${item.serverName} server config under mcpServers. Preserve all existing servers and existing unrelated settings.
7. Refresh or restart MCP connections if needed after saving the config.
8. Verify the server connects and exposes expected capabilities. Use this safe verification approach: ${item.verificationApproach}
9. Avoid destructive verification. Do not modify repositories, databases, files, browser sessions, or external services unless the user explicitly asks.
10. Report the final server name, target scope, config file location, exposed tools/resources observed during verification, and any follow-up the user must complete.`
}

export const buildMarketplaceMcpDiscoveryPrompt = (
	requestedServer: string,
	options: MarketplaceMcpDiscoveryPromptOptions = {},
) => {
	const trimmedRequest = requestedServer.trim()
	const installedServerNames = options.installedServerNames?.length
		? options.installedServerNames.map((serverName) => `- ${serverName}`).join("\n")
		: "- Context7 and at least one web search MCP server were reported as installed by the Marketplace UI. Re-check the current MCP server list before using tools."

	return `Find and set up the requested MCP server using C Code's custom MCP discovery flow.

User request:
${trimmedRequest}

Installed MCP prerequisites reported by the Marketplace UI:
${installedServerNames}

Config targets:
- Global MCP settings file: ${options.globalConfigPath ?? "use C Code's global MCP settings file"}
- Project MCP settings file: ${options.projectConfigPath ?? ".roo/mcp.json in the current workspace"}

Mode guidance:
- You are running in the dedicated MCP Setup mode for discovery, installation, configuration, troubleshooting, and verification of MCP servers.
- Stay within MCP setup work. Do not refactor unrelated project code, rewrite unrelated settings, or mutate existing MCP servers beyond the requested setup unless the user explicitly asks.

Task requirements:
1. Use the installed Context7 MCP server for current documentation and code examples when the target MCP package, SDK, framework, or service has library docs available.
2. Use an installed web search MCP server for web discovery. Search for the official MCP server, official package, source repository, and documentation for the user's requested server.
3. Verify the official source before proposing configuration. Prefer vendor-owned documentation, official GitHub organizations, reputable package registries, and Model Context Protocol references. Clearly call out uncertainty if only community sources exist.
4. Propose a safe MCP config under the existing top-level mcpServers object. Preserve all existing servers and existing unrelated settings.
5. Ask the user only for genuinely required missing credentials, API keys, paths, account IDs, or local prerequisites. Do not ask for optional credentials unless they are needed for the requested setup.
6. Do not echo, log, or store literal secret values in the conversation. Prefer environment placeholders such as \${env:SECRET_NAME} in MCP config.
7. Request approval before running commands that install packages, start installers, change files, or contact external services beyond read-only documentation/search lookups.
8. Install or invoke the package using the safest current documented command. Avoid deprecated packages when an official replacement exists.
9. Refresh or restart MCP connections if needed after saving config.
10. Verify the server connects and exposes expected tools/resources using a read-only, non-sensitive check. Avoid destructive verification and do not modify repositories, databases, files, browser sessions, or external services unless the user explicitly asks.
11. Report the discovered official source/docs, final server name, target config scope/file, exposed tools/resources observed during verification, and any follow-up the user must complete.`
}

export const buildMarketplaceMcpCreationPrompt = (
	requestedCapability: string,
	options: MarketplaceMcpCreationPromptOptions = {},
) => {
	const trimmedRequest = requestedCapability.trim()
	const installedServerNames = options.installedServerNames?.length
		? options.installedServerNames.map((serverName) => `- ${serverName}`).join("\n")
		: "- None reported. Proceed from the user's requirements and local development tools; do not block creation only because research MCP servers are missing."

	return `Create a new custom MCP server using C Code's MCP Marketplace creation flow.

User request:
${trimmedRequest}

Installed MCP servers available for optional research or verification:
${installedServerNames}

Config targets:
- Global MCP settings file: ${options.globalConfigPath ?? "use C Code's global MCP settings file"}
- Project MCP settings file: ${options.projectConfigPath ?? ".roo/mcp.json in the current workspace"}

Mode guidance:
- You are running in the dedicated MCP Setup mode for designing, implementing, configuring, troubleshooting, and verifying MCP servers.
- Stay within MCP setup work. Do not refactor unrelated project code, rewrite unrelated settings, or mutate existing MCP servers beyond the requested custom server unless the user explicitly asks.

Task requirements:
1. Clarify requirements only when necessary to implement safely. If the user's request is already actionable, proceed without extra questions.
2. Design the minimal MCP server appropriate for the requested capability. Prefer a simple local TypeScript/Node MCP server unless the request clearly implies another stack or runtime.
3. Create implementation files in a safe project-local location, such as a clearly named directory under the current workspace. Do not write outside the workspace unless the user explicitly approves a different safe path.
4. Keep the implementation focused on the requested tools/resources. Avoid unrelated scaffolding, broad permissions, destructive defaults, or hidden network/file access.
5. Add or merge MCP config under the existing top-level mcpServers object. Preserve all existing servers and existing unrelated settings.
6. Avoid storing secrets in committed or project files. Use environment variables, documented placeholders such as \${env:SECRET_NAME}, or local user-provided secret stores instead of literal secret values.
7. Request approval before running commands that install packages, change files, start long-running processes, or contact external services.
8. Install dependencies and run the MCP server locally using the simplest documented local workflow for the chosen stack.
9. Refresh or restart MCP connections if needed after saving config.
10. Verify the server connects and exposes the expected tools/resources. Perform a safe, non-destructive test call if possible.
11. Avoid destructive verification. Do not modify repositories, databases, files, browser sessions, or external services unless the user explicitly asks.
12. Report the final server name, files created, config location, exposed capabilities, verification steps/results, and any manual follow-up the user must complete.`
}

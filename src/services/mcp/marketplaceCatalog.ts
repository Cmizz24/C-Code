import {
	getMarketplaceMcpCatalogItem,
	isMarketplaceMcpScope,
	marketplaceMcpCatalog,
	type MarketplaceMcpCatalogItem,
	type MarketplaceMcpScope,
} from "../../shared/mcpMarketplace"

export {
	getMarketplaceMcpCatalogItem,
	isMarketplaceMcpScope,
	marketplaceMcpCatalog,
	type MarketplaceMcpCatalogItem,
	type MarketplaceMcpScope,
}

export const getMarketplaceMcpItem = getMarketplaceMcpCatalogItem

export interface MarketplaceMcpSetupPromptOptions {
	globalConfigPath?: string
	projectConfigPath?: string
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

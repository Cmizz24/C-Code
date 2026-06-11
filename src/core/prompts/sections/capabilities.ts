import { McpHub } from "../../../services/mcp/McpHub"

export function getCapabilitiesSection(cwd: string, mcpHub?: McpHub): string {
	return `====

CAPABILITIES

- Your available tools depend on the active mode and settings. They may let you execute CLI commands, list files, inspect source definitions, search with semantic or regex tools, read and write files, inspect UI, generate images, ask follow-up questions, switch modes, delegate work, or access external resources. Use only tools that are currently available to your mode.
- When the user initially gives you a task, a recursive list of all filepaths in the current workspace directory ('${cwd}') will be included in environment_details. This provides an overview of the project's file structure, offering key insights into the project from directory/file names (how developers conceptualize and organize their code) and file extensions (the language used). This can also guide decision-making on which files to explore further. If list_files is available and you need to further explore directories such as outside the current workspace directory, you can use it. If you pass 'true' for the recursive parameter, it will list files recursively. Otherwise, it will list files at the top level, which is better suited for generic directories where you don't necessarily need the nested structure, like the Desktop.
- When a user explicitly asks for work that the current mode's tools cannot perform (for example terminal commands, file edits, visual UI inspection, or image generation), use switch_mode or new_task to route to a capable mode instead of refusing or asking the user to do it manually.
- For explicit image generation or image editing requests, use generate_image when it is available. Do not substitute visual_browser_inspector, Playwright/browser automation, MCP tools, or a manual web UI workflow unless the user explicitly asks to operate or inspect a browser/web app.
- When execute_command is available, use it to run commands on the user's computer whenever it helps accomplish the user's task, such as running tests, builds, package managers, scripts, or inspecting the environment. When you need to execute a CLI command, you must provide a clear explanation of what the command does. For repository text searches, prefer the provided semantic/regex search tools over shell commands; on Windows, avoid long cmd.exe findstr patterns and use split searches or PowerShell Select-String when shell search is unavoidable. For creating or editing file contents, prefer the normal write/edit tools available to your mode instead of embedding file contents in shell here-strings, heredocs, or echo chains. Interactive and long-running commands are allowed, since the commands are run in the user's VSCode terminal. The user may keep commands running in the background and you will be kept updated on their status along the way. Each command you execute is run in a new terminal instance.${
		mcpHub
			? `
- You have access to MCP servers that may provide additional tools and resources. Each server may provide different capabilities that you can use to accomplish tasks more effectively.
`
			: ""
	}`
}

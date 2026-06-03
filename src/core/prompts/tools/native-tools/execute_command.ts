import type OpenAI from "openai"

const EXECUTE_COMMAND_DESCRIPTION = `Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task, such as running tests, builds, package managers, scripts, or inspecting the environment. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer relative commands and paths that avoid location sensitivity for terminal consistency.

For creating or editing file contents, prefer the normal write/edit tools available to the current mode (for example write_to_file, apply_patch, apply_diff, edit, edit_file, or search_replace) instead of embedding file contents in execute_command with shell here-strings, heredocs, or echo chains. Use execute_command for shell operations, not as the primary way to write file contents.

For repository or code searches, prefer the dedicated search tools over shell text-search commands when available. On Windows/cmd.exe, avoid long findstr search strings, large alternation patterns, and pipelines like type file | findstr /N "a\|b\|..." because findstr has short pattern limits and can break pipes. If shell search is necessary, split searches into short patterns or use PowerShell Select-String with manageable pattern arrays. Treat findstr exit code 1 as "no matches" rather than a workflow-breaking error when there is no findstr error output.

Parameters:
- command: (required) The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.
- cwd: (optional) The working directory to execute the command in
- timeout: (optional) Timeout in seconds. When exceeded, the command keeps running in the background and you receive the output so far. Set this for commands that may run indefinitely, such as dev servers or file watchers, so you can proceed without waiting for them to exit.

Example: Executing npm run dev
{ "command": "npm run dev", "cwd": null, "timeout": null }

Example: Executing ls in a specific directory if directed
{ "command": "ls -la", "cwd": "/home/user/projects", "timeout": null }

Example: Checking Git status with relative paths
{ "command": "git status --short", "cwd": null, "timeout": null }

Example: Running a build with a timeout
{ "command": "npm run build", "cwd": null, "timeout": 30 }`

const COMMAND_PARAMETER_DESCRIPTION = `Shell command to execute`

const CWD_PARAMETER_DESCRIPTION = `Optional working directory for the command, relative or absolute`

const TIMEOUT_PARAMETER_DESCRIPTION = `Timeout in seconds. When exceeded, the command continues running in the background and output collected so far is returned. Use this for long-running processes like dev servers, file watchers, or any command that may not exit on its own`

export default {
	type: "function",
	function: {
		name: "execute_command",
		description: EXECUTE_COMMAND_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: COMMAND_PARAMETER_DESCRIPTION,
				},
				cwd: {
					type: ["string", "null"],
					description: CWD_PARAMETER_DESCRIPTION,
				},
				timeout: {
					type: ["number", "null"],
					description: TIMEOUT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["command", "cwd", "timeout"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

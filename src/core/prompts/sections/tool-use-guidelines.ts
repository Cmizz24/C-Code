export function getToolUseGuidelinesSection(): string {
	return `# Tool Use Guidelines

1. Assess what information you already have and what information you need to proceed with the task.
2. Choose the most appropriate tool based on the task and the tool descriptions provided. Assess if you need additional information to proceed, and which of the available tools would be most effective for gathering this information. For example using the list_files tool is more effective than running a command like \`ls\` in the terminal. It's critical that you think about each available tool and use the one that best fits the current step in the task.
3. For creating or editing file contents, prefer the normal write/edit tools available to your mode over execute_command shell here-strings, heredocs, or echo chains. Use execute_command for running commands, tests, builds, package managers, scripts, or shell operations rather than embedding large file contents in command strings.
4. For repository or code searches, prefer dedicated search tools over shell text-search commands. On Windows/cmd.exe, avoid long findstr alternation patterns; use split searches or PowerShell Select-String when shell search is necessary, and treat findstr exit code 1 as no matches when there is no error output.
5. If multiple actions are needed, you may use multiple tools in a single message when appropriate, or use tools iteratively across messages. Each tool use should be informed by the results of previous tool uses. Do not assume the outcome of any tool use. Each step must be informed by the previous step's result.

By carefully considering the user's response after tool executions, you can react accordingly and make informed decisions about how to proceed with the task. This iterative process helps ensure the overall success and accuracy of your work.`
}

import * as assert from "assert"
import * as vscode from "vscode"

import { setDefaultSuiteTimeout } from "./test-utils"
import { EXTENSION_PACKAGE_NAME, getCommand } from "./utils"

suite("Roo Code Extension", function () {
	setDefaultSuiteTimeout(this)

	test("Commands should be registered", async () => {
		const expectedCommands = [
			"SidebarProvider.open",
			"SidebarProvider.focus",
			"SidebarProvider.resetViewLocation",
			"SidebarProvider.toggleVisibility",
			"SidebarProvider.removeView",
			"activationCompleted",
			"plusButtonClicked",
			"popoutButtonClicked",
			"openInNewTab",
			"settingsButtonClicked",
			"historyButtonClicked",
			"newTask",
			"setCustomStoragePath",
			"focusInput",
			"acceptInput",
			"explainCode",
			"fixCode",
			"improveCode",
			"addToContext",
			"terminalAddToContext",
			"terminalFixCommand",
			"terminalExplainCommand",
		]

		const commands = new Set(
			(await vscode.commands.getCommands(true)).filter((cmd) => cmd.startsWith(EXTENSION_PACKAGE_NAME)),
		)

		for (const command of expectedCommands) {
			assert.ok(commands.has(getCommand(command)), `Command ${command} should be registered`)
		}
	})
})

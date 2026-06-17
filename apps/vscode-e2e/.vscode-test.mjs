/**
 * See: https://code.visualstudio.com/api/working-with-extensions/testing-extension
 */

import { defineConfig } from "@vscode/test-cli"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const extensionPackageJson = JSON.parse(readFileSync(path.resolve(__dirname, "../../src/package.json"), "utf-8"))
const extensionId = `${extensionPackageJson.publisher}.${extensionPackageJson.name}`

export default defineConfig({
	label: "integrationTest",
	files: "out/suite/**/*.test.js",
	workspaceFolder: ".",
	mocha: {
		ui: "tdd",
		timeout: 60000,
	},
	launchArgs: [`--enable-proposed-api=${extensionId}`, "--disable-extensions"],
})

import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"

import { runTests } from "@vscode/test-electron"

async function main() {
	let testWorkspace: string | undefined
	let pathShimRoot: string | undefined

	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const realExtensionDevelopmentPath = path.resolve(__dirname, "../../../src")

		// The path to the extension test script
		// Passed to --extensionTestsPath
		const realExtensionTestsPath = path.resolve(__dirname, "./suite/index")

		// @vscode/test-electron launches through a Windows shell, so paths containing
		// spaces can be split before VS Code receives them. Route the extension and
		// test entrypoint through a temporary no-space shim to keep local workspaces
		// such as "c code" runnable.
		pathShimRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roo-e2e-paths-"))
		const extensionDevelopmentPath = path.join(pathShimRoot, "extension")
		const extensionTestsPath = path.join(pathShimRoot, "suite-index.js")
		const symlinkType = process.platform === "win32" ? "junction" : "dir"

		await fs.symlink(realExtensionDevelopmentPath, extensionDevelopmentPath, symlinkType)
		await fs.writeFile(extensionTestsPath, `module.exports = require(${JSON.stringify(realExtensionTestsPath)});\n`)

		// Create a temporary workspace folder for tests
		testWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "roo-test-workspace-"))

		// Get test filter from command line arguments or environment variable
		// Usage examples:
		// - npm run test:e2e -- --grep "write-to-file"
		// - TEST_GREP="apply-diff" npm run test:e2e
		// - TEST_FILE="task.test.js" npm run test:e2e
		const testGrep = process.argv.find((arg, i) => process.argv[i - 1] === "--grep") || process.env.TEST_GREP
		const testFile = process.argv.find((arg, i) => process.argv[i - 1] === "--file") || process.env.TEST_FILE
		delete process.env.ELECTRON_RUN_AS_NODE

		// Pass test filters as environment variables to the test runner
		const extensionTestsEnv = {
			...process.env,
			...(testGrep && { TEST_GREP: testGrep }),
			...(testFile && { TEST_FILE: testFile }),
		}

		// Download VS Code, unzip it and run the integration test
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: [testWorkspace],
			extensionTestsEnv,
			version: process.env.VSCODE_VERSION || "1.101.2",
		})
	} catch (error) {
		console.error("Failed to run tests", error)
		process.exit(1)
	} finally {
		if (testWorkspace) {
			await fs.rm(testWorkspace, { recursive: true, force: true })
		}

		if (pathShimRoot) {
			await fs.rm(pathShimRoot, { recursive: true, force: true })
		}
	}
}

main()

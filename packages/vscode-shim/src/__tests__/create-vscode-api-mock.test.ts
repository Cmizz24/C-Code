import fs from "fs/promises"
import os from "os"
import path from "path"

import { createVSCodeAPIMock } from "../api/create-vscode-api-mock.js"

describe("createVSCodeAPIMock extension lookup", () => {
	let tempRoot: string

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-shim-extension-lookup-"))
	})

	afterEach(async () => {
		await fs.rm(tempRoot, { recursive: true, force: true })
	})

	it("resolves the current fork extension ID", () => {
		const vscode = createVSCodeAPIMock(
			path.join(tempRoot, "extension"),
			path.join(tempRoot, "workspace"),
			undefined,
			{ storageDir: path.join(tempRoot, "storage") },
		)

		const extension = vscode.extensions.getExtension("cmizz.c-code")

		expect(extension?.id).toBe("cmizz.c-code")
		expect(extension?.extensionPath).toBe(path.join(tempRoot, "extension"))
	})

	it("retains legacy upstream extension ID compatibility", () => {
		const vscode = createVSCodeAPIMock(
			path.join(tempRoot, "extension"),
			path.join(tempRoot, "workspace"),
			undefined,
			{ storageDir: path.join(tempRoot, "storage") },
		)

		expect(vscode.extensions.getExtension("RooVeterinaryInc.roo-cline")?.id).toBe("RooVeterinaryInc.roo-cline")
		expect(vscode.extensions.getExtension("unknown.extension")).toBeUndefined()
	})
})

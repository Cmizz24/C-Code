import fs from "fs/promises"
import os from "os"
import path from "path"

import { getExtensionIdentity, getExtensionPackageName } from "../extension-identity.js"

async function createExtensionPackage(packageJson: Record<string, unknown>): Promise<string> {
	const extensionPath = await fs.mkdtemp(path.join(os.tmpdir(), "c-code-extension-identity-"))
	await fs.writeFile(path.join(extensionPath, "package.json"), JSON.stringify(packageJson), "utf-8")
	return extensionPath
}

describe("extension identity utilities", () => {
	let tempPaths: string[] = []

	afterEach(async () => {
		await Promise.all(tempPaths.map((tempPath) => fs.rm(tempPath, { recursive: true, force: true })))
		tempPaths = []
	})

	it("reads the extension package name and publisher from package.json", async () => {
		const extensionPath = await createExtensionPackage({ name: "c-code", publisher: "cmizz" })
		tempPaths.push(extensionPath)

		expect(getExtensionIdentity(extensionPath)).toEqual({ name: "c-code", publisher: "cmizz" })
		expect(getExtensionPackageName(extensionPath)).toBe("c-code")
	})

	it("finds package.json one level above dist-style extension paths", async () => {
		const extensionPath = await createExtensionPackage({ name: "c-code", publisher: "cmizz" })
		const distPath = path.join(extensionPath, "dist")
		await fs.mkdir(distPath)
		tempPaths.push(extensionPath)

		expect(getExtensionPackageName(distPath)).toBe("c-code")
	})

	it("does not mistake the CLI release package for extension identity", async () => {
		const releasePath = await fs.mkdtemp(path.join(os.tmpdir(), "c-code-cli-release-"))
		const extensionPath = path.join(releasePath, "extension")
		await fs.mkdir(extensionPath)
		await fs.writeFile(path.join(releasePath, "package.json"), JSON.stringify({ name: "@roo-code/cli" }), "utf-8")
		await fs.writeFile(path.join(extensionPath, "package.json"), JSON.stringify({ type: "commonjs" }), "utf-8")
		tempPaths.push(releasePath)

		expect(getExtensionIdentity(extensionPath)).toBeUndefined()
		expect(getExtensionPackageName(extensionPath)).toBe("c-code")
	})

	it("falls back to the fork package name when package metadata is unavailable", async () => {
		const extensionPath = await fs.mkdtemp(path.join(os.tmpdir(), "missing-extension-identity-"))
		tempPaths.push(extensionPath)

		expect(getExtensionIdentity(extensionPath)).toBeUndefined()
		expect(getExtensionPackageName(extensionPath)).toBe("c-code")
	})
})

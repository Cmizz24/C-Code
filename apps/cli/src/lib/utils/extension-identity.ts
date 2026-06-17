import path from "path"
import fs from "fs"

export interface ExtensionIdentity {
	publisher: string
	name: string
}

const FALLBACK_EXTENSION_PACKAGE_NAME = "c-code"

function readPackageJson(packageJsonPath: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as Record<string, unknown>
	} catch {
		return undefined
	}
}

function isExtensionManifest(packageJson: Record<string, unknown>): boolean {
	const name = packageJson.name

	if (typeof name !== "string" || name.length === 0) {
		return false
	}

	const publisher = packageJson.publisher
	const contributes = packageJson.contributes

	return (
		(typeof publisher === "string" && publisher.length > 0) ||
		(typeof contributes === "object" && contributes !== null)
	)
}

export function getExtensionIdentity(extensionPath: string): ExtensionIdentity | undefined {
	const packageJsonCandidates = [
		path.join(extensionPath, "package.json"),
		path.join(extensionPath, "..", "package.json"),
	]

	for (const packageJsonPath of packageJsonCandidates) {
		const packageJson = readPackageJson(packageJsonPath)

		if (!packageJson) {
			continue
		}

		if (!isExtensionManifest(packageJson)) {
			continue
		}

		const name = packageJson.name as string
		const publisher = packageJson.publisher

		return {
			name,
			publisher: typeof publisher === "string" && publisher.length > 0 ? publisher : "unknown",
		}
	}

	return undefined
}

export function getExtensionPackageName(extensionPath: string): string {
	return getExtensionIdentity(extensionPath)?.name ?? FALLBACK_EXTENSION_PACKAGE_NAME
}

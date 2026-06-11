import crypto from "crypto"
import path from "path"

export function normalizeWorkspaceIdentifier(workspacePath: string): string {
	return path.resolve(workspacePath).replace(/\\/g, "/").toLowerCase()
}

export function hashWorkspaceIdentifier(workspacePath: string): string {
	return crypto.createHash("sha256").update(normalizeWorkspaceIdentifier(workspacePath)).digest("hex")
}

export function normalizeMemoryPath(filePath: string): string {
	return filePath.trim().replace(/\\/g, "/").replace(/^\.\//, "")
}

export function uniqueNormalizedPaths(paths: readonly string[] | undefined): string[] {
	if (!paths?.length) {
		return []
	}

	const seen = new Set<string>()
	const result: string[] = []

	for (const value of paths) {
		const normalized = normalizeMemoryPath(value)
		if (!normalized || seen.has(normalized)) {
			continue
		}
		seen.add(normalized)
		result.push(normalized)
	}

	return result
}

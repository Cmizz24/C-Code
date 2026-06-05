import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { describe, expect, it } from "vitest"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dirname, "..")

const findSourceFiles = (dir: string): string[] => {
	const entries = fs.readdirSync(dir, { withFileTypes: true })

	return entries.flatMap((entry) => {
		const entryPath = path.join(dir, entry.name)

		if (entry.isDirectory()) {
			return findSourceFiles(entryPath)
		}

		return /\.tsx?$/.test(entry.name) ? [entryPath] : []
	})
}

describe("ExtensionStateContext imports", () => {
	it("use the canonical @src alias to keep one context module identity in debug/HMR", () => {
		const files = findSourceFiles(srcDir).filter((file) => !file.endsWith("ExtensionStateContext.imports.spec.ts"))

		const nonCanonicalImports = files.flatMap((file) => {
			const contents = fs.readFileSync(file, "utf8")
			const matches = [...contents.matchAll(/from\s+["']([^"']*ExtensionStateContext)["']/g)]

			return matches
				.map((match) => match[1])
				.filter((specifier) => specifier !== "@src/context/ExtensionStateContext")
				.map((specifier) => `${path.relative(srcDir, file).replace(/\\/g, "/")}: ${specifier}`)
		})

		expect(nonCanonicalImports).toEqual([])
	})
})

describe("TranslationContext imports", () => {
	it("use the canonical @src alias to keep one context module identity in debug/HMR", () => {
		const files = findSourceFiles(srcDir).filter((file) => !file.endsWith("ExtensionStateContext.imports.spec.ts"))

		const nonCanonicalImports = files.flatMap((file) => {
			const contents = fs.readFileSync(file, "utf8")
			const matches = [...contents.matchAll(/from\s+["']([^"']*TranslationContext)["']/g)]

			return matches
				.map((match) => match[1])
				.filter(
					(specifier) =>
						specifier.endsWith("i18n/TranslationContext") && specifier !== "@src/i18n/TranslationContext",
				)
				.map((specifier) => `${path.relative(srcDir, file).replace(/\\/g, "/")}: ${specifier}`)
		})

		expect(nonCanonicalImports).toEqual([])
	})
})

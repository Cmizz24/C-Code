// npx vitest run services/ripgrep/__tests__/index.spec.ts

import * as path from "path"

import { getBinPath, truncateLine } from "../index"
import { fileExistsAtPath } from "../../../utils/fs"

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
}))

describe("Ripgrep line truncation", () => {
	// The default MAX_LINE_LENGTH is 500 in the implementation
	const MAX_LINE_LENGTH = 500

	it("should truncate lines longer than MAX_LINE_LENGTH", () => {
		const longLine = "a".repeat(600) // Line longer than MAX_LINE_LENGTH
		const truncated = truncateLine(longLine)

		expect(truncated).toContain("[truncated...]")
		expect(truncated.length).toBeLessThan(longLine.length)
		expect(truncated.length).toEqual(MAX_LINE_LENGTH + " [truncated...]".length)
	})

	it("should not truncate lines shorter than MAX_LINE_LENGTH", () => {
		const shortLine = "Short line of text"
		const truncated = truncateLine(shortLine)

		expect(truncated).toEqual(shortLine)
		expect(truncated).not.toContain("[truncated...]")
	})

	it("should correctly truncate a line at exactly MAX_LINE_LENGTH characters", () => {
		const exactLine = "a".repeat(MAX_LINE_LENGTH)
		const exactPlusOne = exactLine + "x"

		// Should not truncate when exactly MAX_LINE_LENGTH
		expect(truncateLine(exactLine)).toEqual(exactLine)

		// Should truncate when exceeding MAX_LINE_LENGTH by even 1 character
		expect(truncateLine(exactPlusOne)).toContain("[truncated...]")
	})

	it("should handle empty lines without errors", () => {
		expect(truncateLine("")).toEqual("")
	})

	it("should allow custom maximum length", () => {
		const customLength = 100
		const line = "a".repeat(customLength + 50)

		const truncated = truncateLine(line, customLength)

		expect(truncated.length).toEqual(customLength + " [truncated...]".length)
		expect(truncated).toContain("[truncated...]")
	})
})

describe("getBinPath", () => {
	const appRoot = path.join("mock", "vscode", "resources", "app")
	const binName = process.platform.startsWith("win") ? "rg.exe" : "rg"
	const platformArch = `${process.platform}-${process.arch}`

	beforeEach(() => {
		vi.resetAllMocks()
	})

	it("resolves the VS Code ripgrep-universal platform-specific binary layout", async () => {
		const expectedPath = path.join(appRoot, `node_modules/@vscode/ripgrep-universal/bin/${platformArch}/`, binName)

		vi.mocked(fileExistsAtPath).mockImplementation(async (filePath) => filePath === expectedPath)

		await expect(getBinPath(appRoot)).resolves.toBe(expectedPath)
		expect(fileExistsAtPath).toHaveBeenCalledWith(expectedPath)
	})

	it("falls back to the legacy VS Code ripgrep binary layout", async () => {
		const expectedPath = path.join(appRoot, "node_modules/@vscode/ripgrep/bin/", binName)

		vi.mocked(fileExistsAtPath).mockImplementation(async (filePath) => filePath === expectedPath)

		await expect(getBinPath(appRoot)).resolves.toBe(expectedPath)
		expect(fileExistsAtPath).toHaveBeenCalledWith(expectedPath)
	})

	it("returns undefined when no bundled ripgrep binary exists", async () => {
		vi.mocked(fileExistsAtPath).mockResolvedValue(false)

		await expect(getBinPath(appRoot)).resolves.toBeUndefined()
		expect(fileExistsAtPath).toHaveBeenCalled()
	})
})

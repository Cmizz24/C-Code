import type { VsCodeLmModelSelector } from "../vsCodeSelectorUtils"
import { parseVsCodeLmModelSelector, stringifyVsCodeLmModelSelector } from "../vsCodeSelectorUtils"

describe("vsCodeSelectorUtils", () => {
	describe("stringifyVsCodeLmModelSelector", () => {
		it("should join all defined selector properties with separator", () => {
			const selector: VsCodeLmModelSelector = {
				vendor: "test-vendor",
				family: "test-family",
				version: "v1",
				id: "test-id",
			}

			const result = stringifyVsCodeLmModelSelector(selector)
			expect(result).toBe("test-vendor/test-family/v1/test-id")
		})

		it("should omit trailing undefined properties", () => {
			const selector: VsCodeLmModelSelector = {
				vendor: "test-vendor",
				family: "test-family",
			}

			const result = stringifyVsCodeLmModelSelector(selector)
			expect(result).toBe("test-vendor/test-family")
		})

		it("should preserve blank middle fields for positional selector precision", () => {
			const selector: VsCodeLmModelSelector = {
				vendor: "copilot",
				id: "model/id",
			}

			const result = stringifyVsCodeLmModelSelector(selector)
			expect(result).toBe("copilot///model%2Fid")
		})

		it("should URL-encode selector properties", () => {
			const selector: VsCodeLmModelSelector = {
				vendor: "copilot/chat",
				family: "gpt 4",
				version: "2024/10",
				id: "model/id?",
			}

			const result = stringifyVsCodeLmModelSelector(selector)
			expect(result).toBe("copilot%2Fchat/gpt%204/2024%2F10/model%2Fid%3F")
		})

		it("should handle empty selector", () => {
			const selector: VsCodeLmModelSelector = {}

			const result = stringifyVsCodeLmModelSelector(selector)
			expect(result).toBe("")
		})

		it("should handle selector with only one property", () => {
			const selector: VsCodeLmModelSelector = {
				vendor: "test-vendor",
			}

			const result = stringifyVsCodeLmModelSelector(selector)
			expect(result).toBe("test-vendor")
		})
	})

	describe("parseVsCodeLmModelSelector", () => {
		it("should parse all selector properties", () => {
			const result = parseVsCodeLmModelSelector("test-vendor/test-family/v1/test-id")

			expect(result).toEqual({
				vendor: "test-vendor",
				family: "test-family",
				version: "v1",
				id: "test-id",
			})
		})

		it("should preserve blank middle fields when parsing", () => {
			const result = parseVsCodeLmModelSelector("copilot///model%2Fid")

			expect(result).toEqual({
				vendor: "copilot",
				id: "model/id",
			})
		})

		it("should round-trip encoded selectors", () => {
			const selector: VsCodeLmModelSelector = {
				vendor: "copilot/chat",
				family: "gpt 4",
				version: "2024/10",
				id: "model/id?",
			}

			const result = parseVsCodeLmModelSelector(stringifyVsCodeLmModelSelector(selector))

			expect(result).toEqual(selector)
		})
	})
})

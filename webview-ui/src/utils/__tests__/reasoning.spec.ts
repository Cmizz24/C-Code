import { normalizeReasoningContent } from "../reasoning"

describe("normalizeReasoningContent", () => {
	it("separates adjacent bold reasoning chunks when empty HTML comments were used as delimiters", () => {
		const input =
			"**Designing safe cache rebuild for API history** <!-- -->**Assessing cache reset for overwrite scenarios**<!-- -->**Checking fallout**"

		expect(normalizeReasoningContent(input)).toBe(
			"**Designing safe cache rebuild for API history**\n\n**Assessing cache reset for overwrite scenarios**\n\n**Checking fallout**",
		)
	})

	it("removes standalone empty HTML comment separators without leaving raw markup", () => {
		const input = "Before <!-- --> middle <!-- --> after"

		expect(normalizeReasoningContent(input)).toBe("Before middle after")
	})
})

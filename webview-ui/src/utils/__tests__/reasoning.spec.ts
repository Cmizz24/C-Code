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

	it("removes closed HTML-comment-wrapped summary headings", () => {
		const input =
			"Actual reasoning before. <!--**Planning CSS consolidation and redesign**--> Actual reasoning after."

		expect(normalizeReasoningContent(input)).toBe("Actual reasoning before. Actual reasoning after.")
	})

	it("removes malformed open HTML-comment summary headings", () => {
		const input = "Actual reasoning. <!--**Outlining editorial design and typography options**"

		expect(normalizeReasoningContent(input)).toBe("Actual reasoning.")
	})

	it("handles nested malformed comments without leaving raw fragments", () => {
		const input = "First thought. <!--<!--**Planning CSS consolidation and redesign**-->--> Second thought."

		expect(normalizeReasoningContent(input)).toBe("First thought. Second thought.")
	})

	it("preserves legitimate Markdown and useful commented reasoning text", () => {
		const input =
			"**Useful observation**\n\n<!-- I compared the typography choices and selected the safer option. -->\n\n- Keep the existing selector."

		expect(normalizeReasoningContent(input)).toBe(
			"**Useful observation**\n\nI compared the typography choices and selected the safer option.\n\n- Keep the existing selector.",
		)
	})
})

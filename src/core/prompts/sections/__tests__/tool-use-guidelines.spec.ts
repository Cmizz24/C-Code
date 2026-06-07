import { getToolUseGuidelinesSection } from "../tool-use-guidelines"

describe("getToolUseGuidelinesSection", () => {
	it("should include proper numbered guidelines", () => {
		const guidelines = getToolUseGuidelinesSection()

		expect(guidelines).toContain("1. Assess what information")
		expect(guidelines).toContain("2. Choose the most appropriate tool")
		expect(guidelines).toContain("6. If multiple actions are needed")
	})

	it("should route unsupported actions to capable modes instead of refusing", () => {
		const guidelines = getToolUseGuidelinesSection()

		expect(guidelines).toContain("current mode cannot perform")
		expect(guidelines).toContain("required tool or tool group is unavailable")
		expect(guidelines).toContain("do not refuse or tell the user to do it manually")
		expect(guidelines).toContain("Use switch_mode for a direct mode change or new_task for delegation")
		expect(guidelines).toContain("terminal/command work -> Code")
		expect(guidelines).toContain("Debug for troubleshooting")
		expect(guidelines).toContain("CLI Tools for pure command-line work")
		expect(guidelines).toContain("visual_browser_inspector")
		expect(guidelines).toContain("image_generation")
	})

	it("should include Windows-safe repository search guidance", () => {
		const guidelines = getToolUseGuidelinesSection()

		expect(guidelines).toContain("prefer dedicated search tools")
		expect(guidelines).toContain("avoid long findstr alternation patterns")
		expect(guidelines).toContain("PowerShell Select-String")
		expect(guidelines).toContain("treat findstr exit code 1 as no matches")
	})

	it("should include multiple-tools-per-message guidance", () => {
		const guidelines = getToolUseGuidelinesSection()

		expect(guidelines).toContain("you may use multiple tools in a single message")
		expect(guidelines).not.toContain("use one tool at a time per message")
	})

	it("should use simplified footer without step-by-step language", () => {
		const guidelines = getToolUseGuidelinesSection()

		expect(guidelines).toContain("carefully considering the user's response after tool executions")
		expect(guidelines).not.toContain("It is crucial to proceed step-by-step")
		expect(guidelines).not.toContain("ALWAYS wait for user confirmation after each tool use")
	})

	it("should include common guidance", () => {
		const guidelines = getToolUseGuidelinesSection()
		expect(guidelines).toContain("Assess what information you already have")
		expect(guidelines).toContain("Choose the most appropriate tool")
		expect(guidelines).not.toContain("<actual_tool_name>")
	})

	it("should not include per-tool confirmation guidelines", () => {
		const guidelines = getToolUseGuidelinesSection()

		expect(guidelines).not.toContain("After each tool use, the user will respond with the result")
	})
})

import type { ModeConfig } from "@roo-code/types"

describe("Native Tools Filtering by Mode", () => {
	describe("attemptApiRequest native tool filtering", () => {
		it("should filter native tools based on mode restrictions", async () => {
			// This test verifies that native tools are filtered by mode restrictions
			// before being sent to the API.

			const architectMode: ModeConfig = {
				slug: "architect",
				name: "Architect",
				roleDefinition: "Test architect",
				groups: ["read", "mcp"] as const,
			}

			const codeMode: ModeConfig = {
				slug: "code",
				name: "Code",
				roleDefinition: "Test code",
				groups: ["read", "edit", "command", "mcp", "visual_browser_inspector", "image_generation"] as const,
			}

			// Import the functions we need to test
			const { isToolAllowedForMode } = await import("../../tools/validateToolUse")
			const { TOOL_GROUPS, ALWAYS_AVAILABLE_TOOLS } = await import("../../../shared/tools")

			// Test architect mode - should NOT have edit tools
			const architectAllowedTools = new Set<string>()
			architectMode.groups.forEach((groupEntry) => {
				const groupName = typeof groupEntry === "string" ? groupEntry : groupEntry[0]
				const toolGroup = TOOL_GROUPS[groupName]
				if (toolGroup) {
					toolGroup.tools.forEach((tool) => {
						if (isToolAllowedForMode(tool as any, "architect", [architectMode])) {
							architectAllowedTools.add(tool)
						}
					})
				}
			})
			ALWAYS_AVAILABLE_TOOLS.forEach((tool) => architectAllowedTools.add(tool))

			// Architect should NOT have edit tools
			expect(architectAllowedTools.has("write_to_file")).toBe(false)
			expect(architectAllowedTools.has("apply_diff")).toBe(false)
			expect(architectAllowedTools.has("edit")).toBe(false)
			expect(architectAllowedTools.has("search_replace")).toBe(false)
			expect(architectAllowedTools.has("edit_file")).toBe(false)
			expect(architectAllowedTools.has("apply_patch")).toBe(false)

			// Architect SHOULD have read tools
			expect(architectAllowedTools.has("read_file")).toBe(true)
			expect(architectAllowedTools.has("list_files")).toBe(true)

			// Architect SHOULD have always-available tools
			expect(architectAllowedTools.has("ask_followup_question")).toBe(true)
			expect(architectAllowedTools.has("attempt_completion")).toBe(true)

			// Architect should NOT have dedicated visual or image generation tools
			expect(architectAllowedTools.has("visual_browser_inspector")).toBe(false)
			expect(architectAllowedTools.has("generate_image")).toBe(false)

			// Test code mode - SHOULD have edit tools
			const codeAllowedTools = new Set<string>()
			codeMode.groups.forEach((groupEntry) => {
				const groupName = typeof groupEntry === "string" ? groupEntry : groupEntry[0]
				const toolGroup = TOOL_GROUPS[groupName]
				if (toolGroup) {
					toolGroup.tools.forEach((tool) => {
						if (isToolAllowedForMode(tool as any, "code", [codeMode])) {
							codeAllowedTools.add(tool)
						}
					})
				}
			})
			ALWAYS_AVAILABLE_TOOLS.forEach((tool) => codeAllowedTools.add(tool))

			// Code SHOULD have edit tools
			expect(codeAllowedTools.has("write_to_file")).toBe(true)
			expect(codeAllowedTools.has("apply_diff")).toBe(true)
			expect(codeAllowedTools.has("edit")).toBe(true)
			expect(codeAllowedTools.has("search_replace")).toBe(true)
			expect(codeAllowedTools.has("edit_file")).toBe(true)
			expect(codeAllowedTools.has("apply_patch")).toBe(true)

			// Code SHOULD have read tools
			expect(codeAllowedTools.has("read_file")).toBe(true)
			expect(codeAllowedTools.has("list_files")).toBe(true)

			// Code SHOULD have command tools
			expect(codeAllowedTools.has("execute_command")).toBe(true)

			// Code SHOULD have dedicated visual and image generation tools
			expect(codeAllowedTools.has("visual_browser_inspector")).toBe(true)
			expect(codeAllowedTools.has("generate_image")).toBe(true)
		})

		it("should not infer dedicated visual or image tools from broad command/edit groups", async () => {
			const broadMode: ModeConfig = {
				slug: "broad-mode",
				name: "Broad Mode",
				roleDefinition: "Test broad mode",
				groups: ["read", "edit", "command", "mcp"] as const,
			}

			const { isToolAllowedForMode } = await import("../../tools/validateToolUse")

			expect(isToolAllowedForMode("execute_command", "broad-mode", [broadMode])).toBe(true)
			expect(isToolAllowedForMode("write_to_file", "broad-mode", [broadMode])).toBe(true)
			expect(isToolAllowedForMode("visual_browser_inspector", "broad-mode", [broadMode])).toBe(false)
			expect(isToolAllowedForMode("generate_image", "broad-mode", [broadMode])).toBe(false)
		})

		it("should filter MCP tools based on use_mcp_tool permission", async () => {
			const modeWithMcp: ModeConfig = {
				slug: "test-mode-with-mcp",
				name: "Test Mode",
				roleDefinition: "Test",
				groups: ["read", "mcp"] as const,
			}

			const modeWithoutMcp: ModeConfig = {
				slug: "test-mode-no-mcp",
				name: "Test Mode No MCP",
				roleDefinition: "Test",
				groups: ["read"] as const,
			}

			const { isToolAllowedForMode } = await import("../../tools/validateToolUse")

			// Mode with MCP group should allow use_mcp_tool
			expect(isToolAllowedForMode("use_mcp_tool", "test-mode-with-mcp", [modeWithMcp])).toBe(true)

			// Mode without MCP group should NOT allow use_mcp_tool
			expect(isToolAllowedForMode("use_mcp_tool", "test-mode-no-mcp", [modeWithoutMcp])).toBe(false)
		})

		it("should always include always-available tools regardless of mode", async () => {
			const restrictiveMode: ModeConfig = {
				slug: "restrictive",
				name: "Restrictive",
				roleDefinition: "Test",
				groups: [] as const, // No groups at all
			}

			const { isToolAllowedForMode } = await import("../../tools/validateToolUse")
			const { ALWAYS_AVAILABLE_TOOLS } = await import("../../../shared/tools")

			// Always-available tools should work even with no groups
			ALWAYS_AVAILABLE_TOOLS.forEach((tool) => {
				expect(isToolAllowedForMode(tool as any, "restrictive", [restrictiveMode])).toBe(true)
			})

			expect(isToolAllowedForMode("switch_mode", "restrictive", [restrictiveMode])).toBe(true)
			expect(isToolAllowedForMode("new_task", "restrictive", [restrictiveMode])).toBe(true)
			expect(isToolAllowedForMode("execute_command", "restrictive", [restrictiveMode])).toBe(false)
			expect(isToolAllowedForMode("write_to_file", "restrictive", [restrictiveMode])).toBe(false)
			expect(isToolAllowedForMode("visual_browser_inspector", "restrictive", [restrictiveMode])).toBe(false)
			expect(isToolAllowedForMode("generate_image", "restrictive", [restrictiveMode])).toBe(false)
		})

		it("only includes the background coordination native tool when explicitly requested", async () => {
			const { getNativeTools } = await import("../../prompts/tools/native-tools")

			const defaultToolNames = getNativeTools().map((tool: any) => tool.function.name)
			const backgroundToolNames = getNativeTools({ includeAgentCoordinationTool: true }).map(
				(tool: any) => tool.function.name,
			)

			expect(defaultToolNames).not.toContain("coordinate_agents")
			expect(backgroundToolNames).toContain("coordinate_agents")
		})

		it("guides execute_command toward command execution instead of shell file writes", async () => {
			const { getNativeTools } = await import("../../prompts/tools/native-tools")

			const executeCommandTool = getNativeTools().find(
				(tool: any) => tool.function.name === "execute_command",
			) as any
			const description = executeCommandTool.function.description

			expect(description).toContain("running tests, builds, package managers, scripts")
			expect(description).toContain("prefer the normal write/edit tools available to the current mode")
			expect(description).toContain("shell here-strings, heredocs, or echo chains")
			expect(description).toContain("Use execute_command for shell operations")
			expect(description).toContain("avoid long findstr search strings")
			expect(description).toContain("PowerShell Select-String")
			expect(description).toContain('findstr exit code 1 as "no matches"')
			expect(description).not.toContain("Prefer to execute complex CLI commands over creating executable scripts")
			expect(description).not.toContain("touch ./testdata/example.file")
		})

		it("describes mode routing tools for unavailable current-mode capabilities", async () => {
			const { getNativeTools } = await import("../../prompts/tools/native-tools")

			const switchModeTool = getNativeTools().find((tool: any) => tool.function.name === "switch_mode") as any
			const newTaskTool = getNativeTools().find((tool: any) => tool.function.name === "new_task") as any
			const generateImageTool = getNativeTools().find(
				(tool: any) => tool.function.name === "generate_image",
			) as any
			const visualBrowserInspectorTool = getNativeTools().find(
				(tool: any) => tool.function.name === "visual_browser_inspector",
			) as any

			expect(switchModeTool.function.description).toContain("requires a capability or tool group")
			expect(switchModeTool.function.description).toContain("rather than refusing")
			expect(switchModeTool.function.description).toContain("CLI Tools")
			expect(switchModeTool.function.description).toContain("visual_browser_inspector")
			expect(switchModeTool.function.description).toContain("image_generation")
			expect(switchModeTool.function.description).toContain("standalone image-generation requests")
			expect(switchModeTool.function.description).toContain("browser/MCP/manual web UI workarounds")

			expect(newTaskTool.function.description).toContain("delegate work to a capable mode")
			expect(newTaskTool.function.description).toContain("unavailable tools")
			expect(newTaskTool.function.description).toContain("rather than refusing")
			expect(newTaskTool.function.description).toContain("Prefer switch_mode")
			expect(newTaskTool.function.description).toContain("explicit image-generation requests")
			expect(newTaskTool.function.description).toContain("do not delegate to browser/MCP/manual web UI workflows")

			expect(generateImageTool.function.description).toContain("primary path")
			expect(generateImageTool.function.description).toContain("Do not use Visual Browser Inspector")
			expect(generateImageTool.function.description).toContain("MCP tools")
			expect(generateImageTool.function.description).toContain("images/<descriptive-name>.png")

			expect(visualBrowserInspectorTool.function.description).toContain("Do not use this as a substitute")
			expect(visualBrowserInspectorTool.function.description).toContain("generate_image")
		})
	})
})

// npx vitest run src/core/tools/__tests__/validateToolUse.spec.ts

import type { ModeConfig } from "@roo-code/types"

import { FileRestrictionError, modes } from "../../../shared/modes"
import { TOOL_GROUPS } from "../../../shared/tools"

import { validateToolUse, isToolAllowedForMode } from "../validateToolUse"

const codeMode = modes.find((m) => m.slug === "code")?.slug || "code"
const architectMode = modes.find((m) => m.slug === "architect")?.slug || "architect"
const explainMode = modes.find((m) => m.slug === "explain")?.slug || "explain"

describe("mode-validator", () => {
	describe("isToolAllowedForMode", () => {
		describe("code mode", () => {
			it("allows configured code mode tools", () => {
				// Code mode has read, edit, command, mcp, visual browser inspector, and image generation groups. Mode-switching tools are always available.
				const codeTools = [
					...TOOL_GROUPS.read.tools,
					...TOOL_GROUPS.edit.tools,
					...TOOL_GROUPS.command.tools,
					...TOOL_GROUPS.visual_browser_inspector.tools,
					...TOOL_GROUPS.image_generation.tools,
					...TOOL_GROUPS.mcp.tools,
					...TOOL_GROUPS.modes.tools,
				]

				codeTools.forEach((tool: string) => {
					expect(isToolAllowedForMode(tool, codeMode, [])).toBe(true)
				})

				expect(isToolAllowedForMode("edit", codeMode, [])).toBe(true)
				expect(isToolAllowedForMode("search_replace", codeMode, [])).toBe(true)
				expect(isToolAllowedForMode("edit_file", codeMode, [])).toBe(true)
				expect(isToolAllowedForMode("apply_patch", codeMode, [])).toBe(true)

				expect(isToolAllowedForMode("plan_parallel_tasks", codeMode, [])).toBe(false)
			})

			it("disallows unknown tools", () => {
				expect(isToolAllowedForMode("unknown_tool" as any, codeMode, [])).toBe(false)
			})
		})

		describe("architect mode", () => {
			it("allows configured tools", () => {
				// Architect mode has read and mcp groups
				const architectTools = [...TOOL_GROUPS.read.tools, ...TOOL_GROUPS.mcp.tools]
				architectTools.forEach((tool) => {
					expect(isToolAllowedForMode(tool, architectMode, [])).toBe(true)
				})
			})
		})

		describe("explain mode", () => {
			it("allows configured tools", () => {
				// Explain mode has read and mcp groups
				const explainTools = [...TOOL_GROUPS.read.tools, ...TOOL_GROUPS.mcp.tools]
				explainTools.forEach((tool) => {
					expect(isToolAllowedForMode(tool, explainMode, [])).toBe(true)
				})
			})
		})

		describe("custom modes", () => {
			it("allows tools from custom mode configuration", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "custom-mode",
						name: "Custom Mode",
						roleDefinition: "Custom role",
						groups: ["read", "edit"] as const,
					},
				]
				// Should allow tools from read and edit groups
				expect(isToolAllowedForMode("read_file", "custom-mode", customModes)).toBe(true)
				expect(isToolAllowedForMode("write_to_file", "custom-mode", customModes)).toBe(true)
				// Should not allow tools from other groups
				expect(isToolAllowedForMode("execute_command", "custom-mode", customModes)).toBe(false)
			})

			it("does not grant visual browser inspector or image generation from broad command/edit groups", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "broad-groups-mode",
						name: "Broad Groups Mode",
						roleDefinition: "Custom role",
						groups: ["read", "edit", "command"],
					},
				]

				expect(isToolAllowedForMode("visual_browser_inspector", "broad-groups-mode", customModes)).toBe(false)
				expect(isToolAllowedForMode("generate_image", "broad-groups-mode", customModes)).toBe(false)
			})

			it("allows visual browser inspector and image generation from dedicated groups", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "visual-image-mode",
						name: "Visual Image Mode",
						roleDefinition: "Custom role",
						groups: ["read", "visual_browser_inspector", "image_generation"],
					},
				]

				expect(isToolAllowedForMode("visual_browser_inspector", "visual-image-mode", customModes)).toBe(true)
				expect(isToolAllowedForMode("generate_image", "visual-image-mode", customModes)).toBe(true)
			})

			it("allows generate_image output paths matching inherited edit restrictions", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "restricted-image-mode",
						name: "Restricted Image Mode",
						roleDefinition: "Custom role",
						groups: [
							"read",
							["edit", { fileRegex: "\\.png$", description: "PNG outputs only" }],
							"image_generation",
						],
					},
				]

				expect(
					isToolAllowedForMode("generate_image", "restricted-image-mode", customModes, undefined, {
						path: "assets/generated/mockup.png",
					}),
				).toBe(true)
			})

			it("rejects generate_image output paths outside inherited edit restrictions", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "restricted-image-mode",
						name: "Restricted Image Mode",
						roleDefinition: "Custom role",
						groups: [
							"read",
							["edit", { fileRegex: "\\.png$", description: "PNG outputs only" }],
							"image_generation",
						],
					},
				]

				expect(() =>
					isToolAllowedForMode("generate_image", "restricted-image-mode", customModes, undefined, {
						path: "assets/generated/mockup.jpg",
					}),
				).toThrow(FileRestrictionError)
				expect(() =>
					isToolAllowedForMode("generate_image", "restricted-image-mode", customModes, undefined, {
						path: "assets/generated/mockup.jpg",
					}),
				).toThrow(/PNG outputs only/)
			})

			it("prefers dedicated image_generation file restrictions over edit restrictions", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "dedicated-image-restriction-mode",
						name: "Dedicated Image Restriction Mode",
						roleDefinition: "Custom role",
						groups: [
							"read",
							["edit", { fileRegex: "\\.md$", description: "Markdown files only" }],
							["image_generation", { fileRegex: "\\.png$", description: "PNG images only" }],
						],
					},
				]

				expect(
					isToolAllowedForMode("generate_image", "dedicated-image-restriction-mode", customModes, undefined, {
						path: "assets/generated/mockup.png",
					}),
				).toBe(true)

				expect(() =>
					isToolAllowedForMode("generate_image", "dedicated-image-restriction-mode", customModes, undefined, {
						path: "docs/mockup.md",
					}),
				).toThrow(/PNG images only/)
			})

			it("allows custom mode to override built-in mode", () => {
				const customModes: ModeConfig[] = [
					{
						slug: codeMode,
						name: "Custom Code Mode",
						roleDefinition: "Custom role",
						groups: ["read"] as const,
					},
				]
				// Should allow tools from read group
				expect(isToolAllowedForMode("read_file", codeMode, customModes)).toBe(true)
				// Should not allow tools from other groups
				expect(isToolAllowedForMode("write_to_file", codeMode, customModes)).toBe(false)
				expect(isToolAllowedForMode("apply_patch", codeMode, customModes)).toBe(false)
				expect(isToolAllowedForMode("edit", codeMode, customModes)).toBe(false)
				expect(isToolAllowedForMode("search_replace", codeMode, customModes)).toBe(false)
				expect(isToolAllowedForMode("edit_file", codeMode, customModes)).toBe(false)
			})

			it("respects tool requirements in custom modes", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "custom-mode",
						name: "Custom Mode",
						roleDefinition: "Custom role",
						groups: ["edit"] as const,
					},
				]
				const requirements = { apply_diff: false }

				// Should respect disabled requirement even if tool group is allowed
				expect(isToolAllowedForMode("apply_diff", "custom-mode", customModes, requirements)).toBe(false)

				// Should allow other edit tools
				expect(isToolAllowedForMode("write_to_file", "custom-mode", customModes, requirements)).toBe(true)
			})
		})

		describe("dynamic MCP tools", () => {
			it("allows dynamic MCP tools when mcp group is in mode groups", () => {
				// Code mode has mcp group, so dynamic MCP tools should be allowed
				expect(isToolAllowedForMode("mcp_context7_resolve-library-id", codeMode, [])).toBe(true)
				expect(isToolAllowedForMode("mcp_serverName_toolName", codeMode, [])).toBe(true)
			})

			it("disallows dynamic MCP tools when mcp group is not in mode groups", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "no-mcp-mode",
						name: "No MCP Mode",
						roleDefinition: "Custom role",
						groups: ["read", "edit"] as const,
					},
				]
				// Custom mode without mcp group should not allow dynamic MCP tools
				expect(isToolAllowedForMode("mcp_context7_resolve-library-id", "no-mcp-mode", customModes)).toBe(false)
				expect(isToolAllowedForMode("mcp_serverName_toolName", "no-mcp-mode", customModes)).toBe(false)
			})

			it("allows dynamic MCP tools in custom mode with mcp group", () => {
				const customModes: ModeConfig[] = [
					{
						slug: "custom-mcp-mode",
						name: "Custom MCP Mode",
						roleDefinition: "Custom role",
						groups: ["read", "mcp"] as const,
					},
				]
				expect(isToolAllowedForMode("mcp_context7_resolve-library-id", "custom-mcp-mode", customModes)).toBe(
					true,
				)
			})
		})

		describe("tool requirements", () => {
			it("respects tool requirements when provided", () => {
				const requirements = { apply_diff: false }
				expect(isToolAllowedForMode("apply_diff", codeMode, [], requirements)).toBe(false)

				const enabledRequirements = { apply_diff: true }
				expect(isToolAllowedForMode("apply_diff", codeMode, [], enabledRequirements)).toBe(true)
			})

			it("allows tools when their requirements are not specified", () => {
				const requirements = { some_other_tool: true }
				expect(isToolAllowedForMode("apply_diff", codeMode, [], requirements)).toBe(true)
			})

			it("handles undefined and empty requirements", () => {
				expect(isToolAllowedForMode("apply_diff", codeMode, [], undefined)).toBe(true)
				expect(isToolAllowedForMode("apply_diff", codeMode, [], {})).toBe(true)
			})

			it("prioritizes requirements over mode configuration", () => {
				const requirements = { apply_diff: false }
				// Even in code mode which allows all tools, disabled requirement should take precedence
				expect(isToolAllowedForMode("apply_diff", codeMode, [], requirements)).toBe(false)
			})

			it("prioritizes requirements over ALWAYS_AVAILABLE_TOOLS", () => {
				// Tools in ALWAYS_AVAILABLE_TOOLS (switch_mode, new_task, etc.) should still
				// be blockable via toolRequirements / disabledTools
				const requirements = { switch_mode: false, new_task: false, attempt_completion: false }
				expect(isToolAllowedForMode("switch_mode", codeMode, [], requirements)).toBe(false)
				expect(isToolAllowedForMode("new_task", codeMode, [], requirements)).toBe(false)
				expect(isToolAllowedForMode("attempt_completion", codeMode, [], requirements)).toBe(false)
			})
		})
	})

	describe("validateToolUse", () => {
		it("throws error for unknown/invalid tools", () => {
			// Unknown tools should throw with a specific "Unknown tool" error
			expect(() => validateToolUse("unknown_tool" as any, "architect", [])).toThrow(
				'Unknown tool "unknown_tool". This tool does not exist.',
			)
		})

		it("throws error for disallowed tools in architect mode", () => {
			// execute_command is a valid tool but not allowed in architect mode
			expect(() => validateToolUse("execute_command", "architect", [])).toThrow(
				'Tool "execute_command" is not allowed in architect mode.',
			)
		})

		it("does not throw for allowed tools in architect mode", () => {
			expect(() => validateToolUse("read_file", "architect", [])).not.toThrow()
		})

		it("throws error when tool requirement is not met", () => {
			const requirements = { apply_diff: false }
			expect(() => validateToolUse("apply_diff", codeMode, [], requirements)).toThrow(
				'Tool "apply_diff" is not allowed in code mode.',
			)
		})

		it("does not throw when tool requirement is met", () => {
			const requirements = { apply_diff: true }
			expect(() => validateToolUse("apply_diff", codeMode, [], requirements)).not.toThrow()
		})

		it("denies background-only coordination tool unless the runtime requirement is met", () => {
			expect(() => validateToolUse("coordinate_agents", codeMode, [], { coordinate_agents: false })).toThrow(
				'Tool "coordinate_agents" is not allowed in code mode.',
			)
			expect(() => validateToolUse("coordinate_agents", codeMode, [], { coordinate_agents: true })).not.toThrow()
		})

		it("handles undefined requirements gracefully", () => {
			expect(() => validateToolUse("apply_diff", codeMode, [], undefined)).not.toThrow()
		})

		it("blocks tool when disabledTools is converted to toolRequirements", () => {
			const disabledTools = ["execute_command", "search_files"]
			const toolRequirements = disabledTools.reduce(
				(acc: Record<string, boolean>, tool: string) => {
					acc[tool] = false
					return acc
				},
				{} as Record<string, boolean>,
			)

			expect(() => validateToolUse("execute_command", codeMode, [], toolRequirements)).toThrow(
				'Tool "execute_command" is not allowed in code mode.',
			)
			expect(() => validateToolUse("search_files", codeMode, [], toolRequirements)).toThrow(
				'Tool "search_files" is not allowed in code mode.',
			)
		})

		it("allows non-disabled tools when disabledTools is converted to toolRequirements", () => {
			const disabledTools = ["execute_command"]
			const toolRequirements = disabledTools.reduce(
				(acc: Record<string, boolean>, tool: string) => {
					acc[tool] = false
					return acc
				},
				{} as Record<string, boolean>,
			)

			expect(() => validateToolUse("read_file", codeMode, [], toolRequirements)).not.toThrow()
			expect(() => validateToolUse("write_to_file", codeMode, [], toolRequirements)).not.toThrow()
		})

		it("handles empty disabledTools array converted to toolRequirements", () => {
			const disabledTools: string[] = []
			const toolRequirements = disabledTools.reduce(
				(acc: Record<string, boolean>, tool: string) => {
					acc[tool] = false
					return acc
				},
				{} as Record<string, boolean>,
			)

			expect(() => validateToolUse("execute_command", codeMode, [], toolRequirements)).not.toThrow()
		})
	})
})

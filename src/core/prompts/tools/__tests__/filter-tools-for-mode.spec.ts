// npx vitest run core/prompts/tools/__tests__/filter-tools-for-mode.spec.ts

import type OpenAI from "openai"
import type { ModeConfig } from "@roo-code/types"

import { filterNativeToolsForMode } from "../filter-tools-for-mode"

function makeTool(name: string): OpenAI.Chat.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name,
			description: `${name} tool`,
			parameters: { type: "object", properties: {} },
		},
	} as OpenAI.Chat.ChatCompletionTool
}

describe("filterNativeToolsForMode - disabledTools", () => {
	const nativeTools: OpenAI.Chat.ChatCompletionTool[] = [
		makeTool("execute_command"),
		makeTool("read_file"),
		makeTool("ask_for_context"),
		makeTool("write_to_file"),
		makeTool("apply_diff"),
		makeTool("edit"),
		makeTool("search_replace"),
		makeTool("edit_file"),
		makeTool("apply_patch"),
		makeTool("visual_browser_inspector"),
		makeTool("generate_image"),
		makeTool("switch_mode"),
		makeTool("new_task"),
	]

	it("removes tools listed in settings.disabledTools", () => {
		const settings = {
			disabledTools: ["execute_command"],
		}

		const result = filterNativeToolsForMode(nativeTools, "code", undefined, undefined, undefined, settings)

		const resultNames = result.map((t) => (t as any).function.name)
		expect(resultNames).not.toContain("execute_command")
		expect(resultNames).toContain("read_file")
		expect(resultNames).toContain("write_to_file")
		expect(resultNames).toContain("apply_diff")
		expect(resultNames).toContain("apply_patch")
	})

	it("does not remove any tools when disabledTools is empty", () => {
		const settings = {
			disabledTools: [],
		}

		const result = filterNativeToolsForMode(nativeTools, "code", undefined, undefined, undefined, settings)

		const resultNames = result.map((t) => (t as any).function.name)
		expect(resultNames).toContain("execute_command")
		expect(resultNames).toContain("read_file")
		expect(resultNames).toContain("write_to_file")
		expect(resultNames).toContain("apply_diff")
		expect(resultNames).toContain("edit")
		expect(resultNames).toContain("search_replace")
		expect(resultNames).toContain("edit_file")
		expect(resultNames).toContain("apply_patch")
		expect(resultNames).toContain("visual_browser_inspector")
		expect(resultNames).not.toContain("generate_image")
	})

	it("does not remove any tools when disabledTools is undefined", () => {
		const settings = {}

		const result = filterNativeToolsForMode(nativeTools, "code", undefined, undefined, undefined, settings)

		const resultNames = result.map((t) => (t as any).function.name)
		expect(resultNames).toContain("execute_command")
		expect(resultNames).toContain("read_file")
		expect(resultNames).toContain("apply_patch")
		expect(resultNames).toContain("visual_browser_inspector")
		expect(resultNames).not.toContain("generate_image")
	})

	it("keeps routing tools available for read-only modes without granting unavailable tool groups", () => {
		const customModes: ModeConfig[] = [
			{
				slug: "read-only-mode",
				name: "Read Only Mode",
				roleDefinition: "A mode with only read tools.",
				groups: ["read"],
			},
		]

		const result = filterNativeToolsForMode(nativeTools, "read-only-mode", customModes, {
			imageGeneration: true,
		})

		const resultNames = result.map((t) => (t as any).function.name)
		expect(resultNames).toContain("read_file")
		expect(resultNames).toContain("ask_for_context")
		expect(resultNames).toContain("switch_mode")
		expect(resultNames).toContain("new_task")
		expect(resultNames).not.toContain("execute_command")
		expect(resultNames).not.toContain("write_to_file")
		expect(resultNames).not.toContain("visual_browser_inspector")
		expect(resultNames).not.toContain("generate_image")
	})

	it("exposes ask_for_context as always available but honors disabledTools", () => {
		const readOnlyModes: ModeConfig[] = [
			{
				slug: "read-only-mode",
				name: "Read Only Mode",
				roleDefinition: "A mode with only read tools.",
				groups: ["read"],
			},
		]

		const readOnlyResult = filterNativeToolsForMode(nativeTools, "read-only-mode", readOnlyModes, undefined)
		const readOnlyNames = readOnlyResult.map((t) => (t as any).function.name)
		expect(readOnlyNames).toContain("ask_for_context")

		const disabledResult = filterNativeToolsForMode(nativeTools, "code", undefined, undefined, undefined, {
			disabledTools: ["ask_for_context"],
		})
		const disabledNames = disabledResult.map((t) => (t as any).function.name)
		expect(disabledNames).not.toContain("ask_for_context")
	})

	it("combines disabledTools with other setting-based exclusions", () => {
		const settings = {
			disabledTools: ["execute_command"],
		}

		const result = filterNativeToolsForMode(nativeTools, "code", undefined, undefined, undefined, settings)

		const resultNames = result.map((t) => (t as any).function.name)
		expect(resultNames).not.toContain("execute_command")
		expect(resultNames).toContain("read_file")
	})

	it("disables canonical tool when disabledTools contains alias name", () => {
		const settings = {
			disabledTools: ["search_and_replace"],
			modelInfo: {
				includedTools: ["search_and_replace"],
			},
		}

		const result = filterNativeToolsForMode(nativeTools, "code", undefined, undefined, undefined, settings)

		const resultNames = result.map((t) => (t as any).function.name)
		expect(resultNames).not.toContain("search_and_replace")
		expect(resultNames).not.toContain("edit")
	})

	it("does not expose visual browser inspector or image generation through broad command/edit groups", () => {
		const customModes: ModeConfig[] = [
			{
				slug: "broad-groups-mode",
				name: "Broad Groups Mode",
				roleDefinition: "A mode with only broad tool groups.",
				groups: ["read", "edit", "command", "mcp"],
			},
		]

		const result = filterNativeToolsForMode(nativeTools, "broad-groups-mode", customModes, {
			imageGeneration: true,
		})

		const resultNames = result.map((t) => (t as any).function.name)
		expect(resultNames).toContain("execute_command")
		expect(resultNames).toContain("write_to_file")
		expect(resultNames).not.toContain("visual_browser_inspector")
		expect(resultNames).not.toContain("generate_image")
	})

	it("exposes visual browser inspector and image generation through dedicated groups", () => {
		const customModes: ModeConfig[] = [
			{
				slug: "visual-image-mode",
				name: "Visual Image Mode",
				roleDefinition: "A mode with visual and image generation tools.",
				groups: ["read", "visual_browser_inspector", "image_generation"],
			},
		]

		const result = filterNativeToolsForMode(nativeTools, "visual-image-mode", customModes, {
			imageGeneration: true,
		})

		const resultNames = result.map((t) => (t as any).function.name)
		expect(resultNames).toContain("visual_browser_inspector")
		expect(resultNames).toContain("generate_image")
	})

	it("hides generate_image when the image generation experiment is disabled", () => {
		const customModes: ModeConfig[] = [
			{
				slug: "visual-image-mode",
				name: "Visual Image Mode",
				roleDefinition: "A mode with visual and image generation tools.",
				groups: ["read", "visual_browser_inspector", "image_generation"],
			},
		]

		const result = filterNativeToolsForMode(nativeTools, "visual-image-mode", customModes, {
			imageGeneration: false,
		})

		const resultNames = result.map((t) => (t as any).function.name)
		expect(resultNames).toContain("visual_browser_inspector")
		expect(resultNames).not.toContain("generate_image")
	})

	it("exposes image generation for built-in UI/UX but routes from Orchestrator", () => {
		const uiUxResult = filterNativeToolsForMode(nativeTools, "ui-ux", undefined, {
			imageGeneration: true,
		})
		const uiUxNames = uiUxResult.map((t) => (t as any).function.name)

		expect(uiUxNames).toContain("visual_browser_inspector")
		expect(uiUxNames).toContain("generate_image")

		const orchestratorResult = filterNativeToolsForMode(nativeTools, "orchestrator", undefined, {
			imageGeneration: true,
		})
		const orchestratorNames = orchestratorResult.map((t) => (t as any).function.name)

		expect(orchestratorNames).toContain("switch_mode")
		expect(orchestratorNames).toContain("new_task")
		expect(orchestratorNames).not.toContain("visual_browser_inspector")
		expect(orchestratorNames).not.toContain("generate_image")
	})
})

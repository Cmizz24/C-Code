import type { ModeConfig } from "@roo-code/types"

import {
	defaultModeSlug,
	defaultPrompts,
	findModeBySlug,
	getAllModes,
	getCustomInstructions,
	getModeBySlug,
	getModeGroupForSlug,
	getModeSelection,
	getToolsForMode,
	normalizeModeSlug,
} from "../modes"

describe("browser-safe modes shim", () => {
	it("exposes built-in mode metadata without extension-host modules", () => {
		const builtInModes = getAllModes()
		const defaultMode = getModeBySlug(defaultModeSlug)

		expect(defaultMode).toBeDefined()
		expect(builtInModes[0]?.slug).toBe(defaultModeSlug)
		expect(defaultPrompts[defaultModeSlug]?.roleDefinition).toBe(defaultMode?.roleDefinition)
		expect(getModeGroupForSlug(defaultModeSlug)).toBe("defaults")
	})

	it("normalizes legacy mode slugs before matching modes", () => {
		expect(normalizeModeSlug("ask")).toBe("explain")
		expect(normalizeModeSlug("orcestrator")).toBe("orchestrator")
		expect(getModeBySlug("ask")?.slug).toBe("explain")
	})

	it("lets custom modes override built-in modes in browser callers", () => {
		const customModes: ModeConfig[] = [
			{
				slug: defaultModeSlug,
				name: "Custom default mode",
				roleDefinition: "Custom role",
				groups: ["read"],
				customInstructions: "Custom instructions",
				description: "Custom description",
			},
		]

		expect(getAllModes(customModes)[0]?.name).toBe("Custom default mode")
		expect(findModeBySlug(defaultModeSlug, customModes)?.roleDefinition).toBe("Custom role")
		expect(getCustomInstructions(defaultModeSlug, customModes)).toBe("Custom instructions")
		expect(getModeSelection(defaultModeSlug, undefined, customModes)).toEqual({
			roleDefinition: "Custom role",
			baseInstructions: "Custom instructions",
			description: "Custom description",
		})
	})

	it("resolves mode tool groups with always-available tools", () => {
		expect(getToolsForMode(["read"])).toEqual(
			expect.arrayContaining(["read_file", "search_files", "attempt_completion", "coordinate_agents"]),
		)
	})
})

import * as vscode from "vscode"

import {
	type GroupEntry,
	type ModeConfig,
	type CustomModePrompts,
	type ToolGroup,
	type PromptComponent,
	DEFAULT_MODES,
	DEFAULT_MODE_GROUPS,
	MCP_SETUP_MODE_SLUG,
	type BuiltInModeGroup,
} from "@roo-code/types"

import { addCustomInstructions } from "../core/prompts/sections/custom-instructions"

import { TOOL_GROUPS, ALWAYS_AVAILABLE_TOOLS } from "./tools"

export type Mode = string

// Helper to extract group name regardless of format
export function getGroupName(group: GroupEntry): ToolGroup {
	if (typeof group === "string") {
		return group
	}

	return group[0]
}

// Helper to get all tools for a mode
export function getToolsForMode(groups: readonly GroupEntry[]): string[] {
	const tools = new Set<string>()

	// Add tools from each group (excluding customTools which are opt-in only)
	groups.forEach((group) => {
		const groupName = getGroupName(group)
		const groupConfig = TOOL_GROUPS[groupName]
		groupConfig.tools.forEach((tool: string) => tools.add(tool))
	})

	// Always add required tools
	ALWAYS_AVAILABLE_TOOLS.forEach((tool) => tools.add(tool))

	return Array.from(tools)
}

// Main modes configuration as an ordered array
export const modes = DEFAULT_MODES

// Export the default mode slug
export const defaultModeSlug = modes[0].slug

export const explainModeSlug = "explain"

export const marketplaceMcpSetupModeSlug = MCP_SETUP_MODE_SLUG

export const legacyModeSlugFallbacks: Readonly<Record<string, string>> = Object.freeze({
	ask: explainModeSlug,
})

export function normalizeModeSlug(slug: string): string {
	return legacyModeSlugFallbacks[slug] ?? slug
}

export function isLegacyModeSlug(slug: string): boolean {
	return normalizeModeSlug(slug) !== slug
}

export function normalizeModeConfig(mode: ModeConfig): ModeConfig {
	const normalizedSlug = normalizeModeSlug(mode.slug)

	if (normalizedSlug === mode.slug) {
		return mode
	}

	return {
		...mode,
		slug: normalizedSlug,
	}
}

export const defaultModeGroups = DEFAULT_MODE_GROUPS

export type ModeGroup = BuiltInModeGroup

export const specialistModeSlugs = Object.freeze(
	Object.entries(defaultModeGroups)
		.filter(([group]) => group !== "defaults")
		.flatMap(([, config]) => [...config.slugs]),
)

export const specialistModeSlugList = specialistModeSlugs.join(", ")

export function getModeGroupForSlug(slug: string): ModeGroup | undefined {
	const normalizedSlug = normalizeModeSlug(slug)

	for (const [group, config] of Object.entries(defaultModeGroups) as Array<
		[ModeGroup, (typeof defaultModeGroups)[ModeGroup]]
	>) {
		if ((config.slugs as readonly string[]).includes(normalizedSlug)) {
			return group
		}
	}

	return undefined
}

export function getGroupedModes(customModes?: ModeConfig[]): Array<{
	group: ModeGroup | "custom"
	label: string
	modes: ModeConfig[]
}> {
	const allModes = getAllModes(customModes)
	const groupedModes: Array<{ group: ModeGroup | "custom"; label: string; modes: ModeConfig[] }> = (
		Object.entries(defaultModeGroups) as Array<[ModeGroup, (typeof defaultModeGroups)[ModeGroup]]>
	)
		.map(([group, config]) => ({
			group,
			label: config.label,
			modes: config.slugs
				.map((slug) => allModes.find((mode) => mode.slug === slug))
				.filter((mode): mode is ModeConfig => mode !== undefined),
		}))
		.filter((group) => group.modes.length > 0)

	const categorizedSlugs = new Set<string>(Object.values(defaultModeGroups).flatMap((config) => [...config.slugs]))
	const customOnlyModes = allModes.filter((mode) => !categorizedSlugs.has(mode.slug))

	if (customOnlyModes.length > 0) {
		groupedModes.push({
			group: "custom",
			label: "Custom",
			modes: customOnlyModes,
		})
	}

	return groupedModes
}

// Helper functions
export function getModeBySlug(slug: string, customModes?: ModeConfig[]): ModeConfig | undefined {
	const normalizedSlug = normalizeModeSlug(slug)

	// Check custom modes first
	const customMode = customModes?.find((mode) => normalizeModeSlug(mode.slug) === normalizedSlug)
	if (customMode) {
		return normalizeModeConfig(customMode)
	}
	// Then check built-in modes
	return modes.find((mode) => mode.slug === normalizedSlug)
}

export function getModeConfig(slug: string, customModes?: ModeConfig[]): ModeConfig {
	const mode = getModeBySlug(slug, customModes)
	if (!mode) {
		throw new Error(`No mode found for slug: ${slug}`)
	}
	return mode
}

// Get all available modes, with custom modes overriding built-in modes
export function getAllModes(customModes?: ModeConfig[]): ModeConfig[] {
	if (!customModes?.length) {
		return [...modes]
	}

	// Start with built-in modes
	const allModes = [...modes]

	// Process custom modes
	customModes.forEach((customMode) => {
		const normalizedCustomMode = normalizeModeConfig(customMode)
		const index = allModes.findIndex((mode) => mode.slug === normalizedCustomMode.slug)
		if (index !== -1) {
			// Override existing mode
			allModes[index] = normalizedCustomMode
		} else {
			// Add new mode
			allModes.push(normalizedCustomMode)
		}
	})

	return allModes
}

// Check if a mode is custom or an override
export function isCustomMode(slug: string, customModes?: ModeConfig[]): boolean {
	const normalizedSlug = normalizeModeSlug(slug)
	return !!customModes?.some((mode) => normalizeModeSlug(mode.slug) === normalizedSlug)
}

/**
 * Find a mode by its slug, don't fall back to built-in modes
 */
export function findModeBySlug(slug: string, modes: readonly ModeConfig[] | undefined): ModeConfig | undefined {
	const normalizedSlug = normalizeModeSlug(slug)
	const mode = modes?.find((mode) => normalizeModeSlug(mode.slug) === normalizedSlug)
	return mode ? normalizeModeConfig(mode) : undefined
}

/**
 * Get the mode selection based on the provided mode slug, prompt component, and custom modes.
 * If a custom mode is found, it takes precedence over the built-in modes.
 * If no custom mode is found, the built-in mode is used with partial merging from promptComponent.
 * If neither is found, the default mode is used.
 */
export function getModeSelection(mode: string, promptComponent?: PromptComponent, customModes?: ModeConfig[]) {
	const normalizedMode = normalizeModeSlug(mode)
	const customMode = findModeBySlug(normalizedMode, customModes)
	const builtInMode = findModeBySlug(normalizedMode, modes)

	// If we have a custom mode, use it entirely
	if (customMode) {
		return {
			roleDefinition: customMode.roleDefinition || "",
			baseInstructions: customMode.customInstructions || "",
			description: customMode.description || "",
		}
	}

	// Otherwise, use built-in mode as base and merge with promptComponent
	const baseMode = builtInMode || modes[0] // fallback to default mode

	return {
		roleDefinition: promptComponent?.roleDefinition || baseMode.roleDefinition || "",
		baseInstructions: promptComponent?.customInstructions || baseMode.customInstructions || "",
		description: baseMode.description || "",
	}
}

// Custom error class for file restrictions
export class FileRestrictionError extends Error {
	constructor(mode: string, pattern: string, description: string | undefined, filePath: string, tool?: string) {
		const toolInfo = tool ? `Tool '${tool}' in mode '${mode}'` : `This mode (${mode})`
		super(
			`${toolInfo} can only edit files matching pattern: ${pattern}${description ? ` (${description})` : ""}. Got: ${filePath}`,
		)
		this.name = "FileRestrictionError"
	}
}

// Create the mode-specific default prompts
export const defaultPrompts: Readonly<CustomModePrompts> = Object.freeze(
	Object.fromEntries(
		modes.map((mode) => [
			mode.slug,
			{
				roleDefinition: mode.roleDefinition,
				whenToUse: mode.whenToUse,
				customInstructions: mode.customInstructions,
				description: mode.description,
			},
		]),
	),
)

// Helper function to get all modes with their prompt overrides from extension state
export async function getAllModesWithPrompts(context: vscode.ExtensionContext): Promise<ModeConfig[]> {
	const customModes = (await context.globalState.get<ModeConfig[]>("customModes")) || []
	const customModePrompts = (await context.globalState.get<CustomModePrompts>("customModePrompts")) || {}

	const allModes = getAllModes(customModes)
	return allModes.map((mode) => ({
		...mode,
		roleDefinition: customModePrompts[mode.slug]?.roleDefinition ?? mode.roleDefinition,
		whenToUse: customModePrompts[mode.slug]?.whenToUse ?? mode.whenToUse,
		customInstructions: customModePrompts[mode.slug]?.customInstructions ?? mode.customInstructions,
		// description is not overridable via customModePrompts, so we keep the original
	}))
}

// Helper function to get complete mode details with all overrides
export async function getFullModeDetails(
	modeSlug: string,
	customModes?: ModeConfig[],
	customModePrompts?: CustomModePrompts,
	options?: {
		cwd?: string
		globalCustomInstructions?: string
		language?: string
	},
): Promise<ModeConfig> {
	const normalizedModeSlug = normalizeModeSlug(modeSlug)
	// First get the base mode config from custom modes or built-in modes
	const baseMode =
		getModeBySlug(normalizedModeSlug, customModes) || modes.find((m) => m.slug === normalizedModeSlug) || modes[0]

	// Check for any prompt component overrides
	const promptComponent = customModePrompts?.[normalizedModeSlug] ?? customModePrompts?.[modeSlug]

	// Get the base custom instructions
	const baseCustomInstructions = promptComponent?.customInstructions || baseMode.customInstructions || ""
	const baseWhenToUse = promptComponent?.whenToUse || baseMode.whenToUse || ""
	const baseDescription = promptComponent?.description || baseMode.description || ""

	// If we have cwd, load and combine all custom instructions
	let fullCustomInstructions = baseCustomInstructions
	if (options?.cwd) {
		fullCustomInstructions = await addCustomInstructions(
			baseCustomInstructions,
			options.globalCustomInstructions || "",
			options.cwd,
			normalizedModeSlug,
			{ language: options.language },
		)
	}

	// Return mode with any overrides applied
	return {
		...baseMode,
		roleDefinition: promptComponent?.roleDefinition || baseMode.roleDefinition,
		whenToUse: baseWhenToUse,
		description: baseDescription,
		customInstructions: fullCustomInstructions,
	}
}

// Helper function to safely get role definition
export function getRoleDefinition(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.roleDefinition
}

// Helper function to safely get description
export function getDescription(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.description ?? ""
}

// Helper function to safely get whenToUse
export function getWhenToUse(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.whenToUse ?? ""
}

// Helper function to safely get custom instructions
export function getCustomInstructions(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.customInstructions ?? ""
}

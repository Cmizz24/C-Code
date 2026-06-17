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

import { TOOL_GROUPS, ALWAYS_AVAILABLE_TOOLS } from "@roo/tools"

export type Mode = string

export function getGroupName(group: GroupEntry): ToolGroup {
	if (typeof group === "string") {
		return group
	}

	return group[0]
}

export function getToolsForMode(groups: readonly GroupEntry[]): string[] {
	const tools = new Set<string>()

	groups.forEach((group) => {
		const groupName = getGroupName(group)
		const groupConfig = TOOL_GROUPS[groupName]
		groupConfig.tools.forEach((tool: string) => tools.add(tool))
	})

	ALWAYS_AVAILABLE_TOOLS.forEach((tool) => tools.add(tool))

	return Array.from(tools)
}

export const modes = DEFAULT_MODES

export const defaultModeSlug = modes[0].slug

export const explainModeSlug = "explain"

export const marketplaceMcpSetupModeSlug = MCP_SETUP_MODE_SLUG

export const legacyModeSlugFallbacks: Readonly<Record<string, string>> = Object.freeze({
	ask: explainModeSlug,
	orcestrator: "orchestrator",
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

export function getModeBySlug(slug: string, customModes?: ModeConfig[]): ModeConfig | undefined {
	const normalizedSlug = normalizeModeSlug(slug)

	const customMode = customModes?.find((mode) => normalizeModeSlug(mode.slug) === normalizedSlug)
	if (customMode) {
		return normalizeModeConfig(customMode)
	}

	return modes.find((mode) => mode.slug === normalizedSlug)
}

export function getModeConfig(slug: string, customModes?: ModeConfig[]): ModeConfig {
	const mode = getModeBySlug(slug, customModes)
	if (!mode) {
		throw new Error(`No mode found for slug: ${slug}`)
	}
	return mode
}

export function getAllModes(customModes?: ModeConfig[]): ModeConfig[] {
	if (!customModes?.length) {
		return [...modes]
	}

	const allModes = [...modes]

	customModes.forEach((customMode) => {
		const normalizedCustomMode = normalizeModeConfig(customMode)
		const index = allModes.findIndex((mode) => mode.slug === normalizedCustomMode.slug)
		if (index !== -1) {
			allModes[index] = normalizedCustomMode
		} else {
			allModes.push(normalizedCustomMode)
		}
	})

	return allModes
}

export function isCustomMode(slug: string, customModes?: ModeConfig[]): boolean {
	const normalizedSlug = normalizeModeSlug(slug)
	return !!customModes?.some((mode) => normalizeModeSlug(mode.slug) === normalizedSlug)
}

export function findModeBySlug(slug: string, modes: readonly ModeConfig[] | undefined): ModeConfig | undefined {
	const normalizedSlug = normalizeModeSlug(slug)
	const mode = modes?.find((mode) => normalizeModeSlug(mode.slug) === normalizedSlug)
	return mode ? normalizeModeConfig(mode) : undefined
}

export function getModeSelection(mode: string, promptComponent?: PromptComponent, customModes?: ModeConfig[]) {
	const normalizedMode = normalizeModeSlug(mode)
	const customMode = findModeBySlug(normalizedMode, customModes)
	const builtInMode = findModeBySlug(normalizedMode, modes)

	if (customMode) {
		return {
			roleDefinition: customMode.roleDefinition || "",
			baseInstructions: customMode.customInstructions || "",
			description: customMode.description || "",
		}
	}

	const baseMode = builtInMode || modes[0]

	return {
		roleDefinition: promptComponent?.roleDefinition || baseMode.roleDefinition || "",
		baseInstructions: promptComponent?.customInstructions || baseMode.customInstructions || "",
		description: baseMode.description || "",
	}
}

export class FileRestrictionError extends Error {
	constructor(mode: string, pattern: string, description: string | undefined, filePath: string, tool?: string) {
		const toolInfo = tool ? `Tool '${tool}' in mode '${mode}'` : `This mode (${mode})`
		super(
			`${toolInfo} can only edit files matching pattern: ${pattern}${description ? ` (${description})` : ""}. Got: ${filePath}`,
		)
		this.name = "FileRestrictionError"
	}
}

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

export function getRoleDefinition(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.roleDefinition
}

export function getDescription(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.description ?? ""
}

export function getWhenToUse(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.whenToUse ?? ""
}

export function getCustomInstructions(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.customInstructions ?? ""
}

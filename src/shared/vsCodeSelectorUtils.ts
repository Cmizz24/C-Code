export const SELECTOR_SEPARATOR = "/"

export type VsCodeLmModelSelector = {
	vendor?: string
	family?: string
	version?: string
	id?: string
}

export const VSCODE_LM_SELECTOR_KEYS = ["vendor", "family", "version", "id"] as const satisfies ReadonlyArray<
	keyof VsCodeLmModelSelector
>

function getLastDefinedSelectorIndex(selector: VsCodeLmModelSelector): number {
	for (let index = VSCODE_LM_SELECTOR_KEYS.length - 1; index >= 0; index--) {
		if (selector[VSCODE_LM_SELECTOR_KEYS[index]]) {
			return index
		}
	}

	return -1
}

function safeDecodeSelectorPart(part: string): string {
	try {
		return decodeURIComponent(part)
	} catch {
		return part
	}
}

export function stringifyVsCodeLmModelSelector(selector?: VsCodeLmModelSelector): string {
	if (!selector) {
		return ""
	}

	const lastDefinedIndex = getLastDefinedSelectorIndex(selector)
	if (lastDefinedIndex === -1) {
		return ""
	}

	return VSCODE_LM_SELECTOR_KEYS.slice(0, lastDefinedIndex + 1)
		.map((key) => encodeURIComponent(selector[key] ?? ""))
		.join(SELECTOR_SEPARATOR)
}

export function parseVsCodeLmModelSelector(modelId: string): VsCodeLmModelSelector {
	const parts = modelId.split(SELECTOR_SEPARATOR)
	const lastSelectorIndex = VSCODE_LM_SELECTOR_KEYS.length - 1

	return VSCODE_LM_SELECTOR_KEYS.reduce((selector, key, index) => {
		const rawValue = index === lastSelectorIndex ? parts.slice(index).join(SELECTOR_SEPARATOR) : parts[index]
		const value = rawValue ? safeDecodeSelectorPart(rawValue) : undefined

		return value ? { ...selector, [key]: value } : selector
	}, {} as VsCodeLmModelSelector)
}

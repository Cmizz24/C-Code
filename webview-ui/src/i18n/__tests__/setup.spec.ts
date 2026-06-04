import i18next from "../setup"

describe("i18n setup", () => {
	it("bundles settings namespace resources synchronously for startup renders", () => {
		expect(i18next.isInitialized).toBe(true)
		expect(i18next.options.ns).toContain("settings")
		expect(i18next.hasResourceBundle("en", "settings")).toBe(true)

		const startupSettingsLabels = [
			i18next.t("settings:header.title"),
			i18next.t("settings:sections.providers"),
			i18next.t("settings:providers.configProfile"),
		]

		expect(startupSettingsLabels).toEqual(["Settings", "Providers", "Configuration Profile"])
		expect(startupSettingsLabels).not.toContain("settings:header.title")
		expect(startupSettingsLabels).not.toContain("settings:sections.providers")
		expect(startupSettingsLabels).not.toContain("settings:providers.configProfile")
	})
})

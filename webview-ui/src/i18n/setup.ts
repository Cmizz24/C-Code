import i18next from "i18next"
import { initReactI18next } from "react-i18next"

// Build translations object
const translations: Record<string, Record<string, any>> = {}

// Dynamically load locale files
const localeFiles = import.meta.glob("./locales/**/*.json", { eager: true })

// Process all locale files
Object.entries(localeFiles).forEach(([path, module]) => {
	// Extract language and namespace from path
	// Example path: './locales/en/common.json' -> language: 'en', namespace: 'common'
	const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json/)

	if (match) {
		const [, language, namespace] = match

		// Initialize language object if it doesn't exist
		if (!translations[language]) {
			translations[language] = {}
		}

		// Add namespace resources to language
		translations[language][namespace] = (module as any).default || module
	}
})

const namespaces = Array.from(new Set(Object.values(translations).flatMap((language) => Object.keys(language))))
const defaultNamespace = namespaces.includes("common") ? "common" : (namespaces[0] ?? "common")

// Initialize i18next for React
// This will be initialized with the VSCode language in TranslationProvider.
// Bundled resources are provided up front so first render can resolve namespaced keys like
// `settings:header.title` instead of waiting for a post-mount effect.
i18next.use(initReactI18next).init({
	resources: translations,
	ns: namespaces.length > 0 ? namespaces : ["common"],
	defaultNS: defaultNamespace,
	lng: "en", // Default language (will be overridden)
	fallbackLng: "en",
	debug: false,
	interpolation: {
		escapeValue: false, // React already escapes by default
	},
})

let translationsLoaded = false

export function loadTranslations() {
	if (translationsLoaded) {
		return
	}

	Object.entries(translations).forEach(([lang, namespaces]) => {
		try {
			Object.entries(namespaces).forEach(([namespace, resources]) => {
				if (i18next.hasResourceBundle(lang, namespace)) {
					return
				}

				i18next.addResourceBundle(lang, namespace, resources, true, true)
			})
		} catch (error) {
			console.warn(`Could not load ${lang} translations:`, error)
		}
	})

	translationsLoaded = true
}

export default i18next

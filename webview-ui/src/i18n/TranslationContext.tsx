import React, { createContext, useContext, ReactNode, useEffect, useCallback, useSyncExternalStore } from "react"
import i18next, { loadTranslations } from "./setup"
import { useExtensionState } from "@src/context/ExtensionStateContext"

type TranslationContextValue = {
	t: (key: string, options?: Record<string, any>) => string
	i18n: typeof i18next
}

// Create context for translations
const translationContextKey = Symbol.for("roo-code.webview.TranslationContext")

export const TranslationContext = ((globalThis as Record<PropertyKey, unknown>)[translationContextKey] ??=
	createContext<TranslationContextValue>({
		t: (key: string) => key,
		i18n: i18next,
	})) as React.Context<TranslationContextValue>

// Translation provider component
export const TranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
	// Get the extension state directly - it already contains all state properties
	const extensionState = useExtensionState()
	useSyncExternalStore(
		(onStoreChange) => {
			i18next.on("languageChanged", onStoreChange)

			return () => {
				i18next.off("languageChanged", onStoreChange)
			}
		},
		() => i18next.language,
		() => i18next.language,
	)

	// Load translations once when the component mounts
	useEffect(() => {
		try {
			loadTranslations()
		} catch (error) {
			console.error("Failed to load translations:", error)
		}
	}, [])

	useEffect(() => {
		i18next.changeLanguage(extensionState.language)
	}, [extensionState.language])

	// Memoize the translation function to prevent unnecessary re-renders
	const translate = useCallback((key: string, options?: Record<string, any>) => {
		return i18next.t(key, options)
	}, [])

	return (
		<TranslationContext.Provider
			value={{
				t: translate,
				i18n: i18next,
			}}>
			{children}
		</TranslationContext.Provider>
	)
}

// Custom hook for easy translations
export const useAppTranslation = () => useContext(TranslationContext)

export default TranslationProvider

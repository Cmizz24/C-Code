import { useQuery } from "@tanstack/react-query"

import { type RouterModels, type ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

type UseRouterModelsOptions = {
	provider?: string // single provider filter (e.g. "openrouter")
	modelType?: "chat" | "image"
	values?: Record<string, unknown>
	enabled?: boolean // gate fetching entirely
}

const getRouterModels = async (opts: Omit<UseRouterModelsOptions, "enabled">) =>
	new Promise<RouterModels>((resolve, reject) => {
		const { provider, modelType, values } = opts

		const cleanup = () => {
			if (typeof window !== "undefined") {
				window.removeEventListener("message", handler)
			}
		}

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error("Router models request timed out"))
		}, 10000)

		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "routerModels") {
				const msgProvider = message?.values?.provider as string | undefined
				const msgModelType = message?.values?.modelType as "chat" | "image" | undefined

				// Verify response matches request
				if (provider !== msgProvider || modelType !== msgModelType) {
					// Not our response; ignore and wait for the matching one
					return
				}

				clearTimeout(timeout)
				cleanup()

				if (message.routerModels) {
					resolve(message.routerModels)
				} else {
					reject(new Error("No router models in response"))
				}
			}
		}

		window.addEventListener("message", handler)

		const requestValues = {
			...values,
			...(provider ? { provider } : {}),
			...(modelType ? { modelType } : {}),
		}

		if (Object.keys(requestValues).length > 0) {
			vscode.postMessage({ type: "requestRouterModels", values: requestValues })
		} else {
			vscode.postMessage({ type: "requestRouterModels" })
		}
	})

export const useRouterModels = (opts: UseRouterModelsOptions = {}) => {
	const provider = opts.provider || undefined
	const modelType = opts.modelType === "image" ? "image" : undefined
	const values = opts.values

	return useQuery({
		queryKey: ["routerModels", provider || "all", modelType || "chat", values || {}],
		queryFn: () => getRouterModels({ provider, modelType, values }),
		enabled: opts.enabled !== false,
	})
}

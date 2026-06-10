import { useQuery } from "@tanstack/react-query"

import { type ModelRecord, type ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

type OllamaModelsOptions = {
	baseUrl?: string
	apiKey?: string
}

const getOllamaModels = async (opts: OllamaModelsOptions = {}) =>
	new Promise<ModelRecord>((resolve, reject) => {
		const requestId = crypto.randomUUID()

		const cleanup = () => {
			window.removeEventListener("message", handler)
		}

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error("Ollama models request timed out"))
		}, 10000)

		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "ollamaModels") {
				if (message.requestId && message.requestId !== requestId) {
					return
				}

				clearTimeout(timeout)
				cleanup()

				if (message.ollamaModels) {
					resolve(message.ollamaModels)
				} else {
					reject(new Error("No Ollama models in response"))
				}
			}
		}

		window.addEventListener("message", handler)
		vscode.postMessage({
			type: "requestOllamaModels",
			requestId,
			values: {
				ollamaBaseUrl: opts.baseUrl,
				ollamaApiKey: opts.apiKey,
			},
		})
	})

export const useOllamaModels = (modelId?: string, opts: OllamaModelsOptions = {}) =>
	useQuery({
		queryKey: ["ollamaModels", opts.baseUrl, opts.apiKey],
		queryFn: () => (modelId ? getOllamaModels(opts) : {}),
	})

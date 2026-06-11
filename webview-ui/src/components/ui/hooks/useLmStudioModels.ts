import { useQuery } from "@tanstack/react-query"

import { type ModelRecord, type ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

type LmStudioModelsOptions = {
	baseUrl?: string
}

const getLmStudioModels = async (opts: LmStudioModelsOptions = {}) =>
	new Promise<ModelRecord>((resolve, reject) => {
		const requestId = crypto.randomUUID()

		const cleanup = () => {
			window.removeEventListener("message", handler)
		}

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error("LM Studio models request timed out"))
		}, 10000)

		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "lmStudioModels") {
				if (message.requestId && message.requestId !== requestId) {
					return
				}

				clearTimeout(timeout)
				cleanup()

				if (message.lmStudioModels) {
					resolve(message.lmStudioModels)
				} else {
					reject(new Error("No LMStudio models in response"))
				}
			}
		}

		window.addEventListener("message", handler)
		vscode.postMessage({
			type: "requestLmStudioModels",
			requestId,
			values: {
				lmStudioBaseUrl: opts.baseUrl,
			},
		})
	})

export const useLmStudioModels = (modelId?: string, opts: LmStudioModelsOptions = {}) =>
	useQuery({
		queryKey: ["lmStudioModels", opts.baseUrl],
		queryFn: () => (modelId ? getLmStudioModels(opts) : {}),
	})

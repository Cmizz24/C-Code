import { spawn } from "child_process"

import type {
	LocalAiSetupProgress,
	LocalAiSetupResult,
	LocalAiSetupStartRequest,
	ProviderSettings,
} from "@roo-code/types"

import { detectOllamaRuntime, OLLAMA_DEFAULT_BASE_URL } from "./hardware"

export const OLLAMA_INSTALL_URL = "https://ollama.com/download"
export const LOCAL_AI_PROFILE_NAME = "Local AI (Ollama)"

type ProgressReporter = (progress: LocalAiSetupProgress) => void | Promise<void>

interface OllamaPullEvent {
	status?: string
	digest?: string
	total?: number
	completed?: number
	error?: string
}

export const parseOllamaPullLine = (line: string): LocalAiSetupProgress | undefined => {
	const trimmed = line.trim()
	if (!trimmed) {
		return undefined
	}

	let event: OllamaPullEvent
	try {
		event = JSON.parse(trimmed) as OllamaPullEvent
	} catch {
		return undefined
	}

	if (event.error) {
		return {
			stage: "error",
			message: event.error,
			error: event.error,
			status: event.status,
		}
	}

	const percent =
		typeof event.completed === "number" && typeof event.total === "number" && event.total > 0
			? Math.round((event.completed / event.total) * 100)
			: undefined

	return {
		stage: "download",
		message: event.status ?? "Downloading model",
		status: event.status,
		completedBytes: event.completed,
		totalBytes: event.total,
		percent,
	}
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const tryStartOllama = async (baseUrl: string, reportProgress: ProgressReporter, signal: AbortSignal) => {
	await reportProgress({
		stage: "runtime",
		message: "Ollama is installed but not running. Attempting to start Ollama safely.",
	})

	try {
		const child = spawn("ollama", ["serve"], {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		})
		child.unref()
	} catch (error) {
		await reportProgress({
			stage: "error",
			message: "Ollama is installed but could not be started automatically.",
			error: error instanceof Error ? error.message : String(error),
		})
		return false
	}

	for (let attempt = 0; attempt < 15; attempt++) {
		if (signal.aborted) {
			throw new DOMException("Local AI setup cancelled", "AbortError")
		}

		const status = await detectOllamaRuntime(baseUrl)
		if (status.status === "running") {
			return true
		}

		await wait(1_000)
	}

	return false
}

const pullOllamaModel = async (
	baseUrl: string,
	modelTag: string,
	reportProgress: ProgressReporter,
	signal: AbortSignal,
) => {
	await reportProgress({
		stage: "download",
		message: `Starting Ollama model download for ${modelTag}.`,
		modelTag,
	})

	const response = await fetch(`${baseUrl}/api/pull`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name: modelTag, stream: true }),
		signal,
	})

	if (!response.ok) {
		throw new Error(`Ollama pull failed with HTTP ${response.status}.`)
	}

	if (!response.body) {
		throw new Error("Ollama did not provide a download progress stream.")
	}

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ""

	while (true) {
		const { done, value } = await reader.read()
		if (done) {
			break
		}

		buffer += decoder.decode(value, { stream: true })
		const lines = buffer.split(/\r?\n/)
		buffer = lines.pop() ?? ""

		for (const line of lines) {
			const progress = parseOllamaPullLine(line)
			if (!progress) {
				continue
			}

			if (progress.stage === "error") {
				throw new Error(progress.error ?? progress.message)
			}

			await reportProgress({ ...progress, modelTag })
		}
	}

	if (buffer.trim()) {
		const progress = parseOllamaPullLine(buffer)
		if (progress?.stage === "error") {
			throw new Error(progress.error ?? progress.message)
		}
		if (progress) {
			await reportProgress({ ...progress, modelTag })
		}
	}
}

const verifyOllamaModel = async (baseUrl: string, modelTag: string) => {
	const response = await fetch(`${baseUrl}/api/tags`)
	if (!response.ok) {
		return false
	}

	const data = (await response.json()) as { models?: Array<{ name?: string; model?: string }> }
	return (data.models ?? []).some((model) => model.name === modelTag || model.model === modelTag)
}

const buildProviderSettings = (request: LocalAiSetupStartRequest): ProviderSettings => {
	const { recommendation } = request
	return {
		apiProvider: "ollama",
		ollamaBaseUrl: recommendation.baseUrl || OLLAMA_DEFAULT_BASE_URL,
		ollamaModelId: recommendation.model.tag,
		...(recommendation.ollamaNumCtx ? { ollamaNumCtx: recommendation.ollamaNumCtx } : {}),
	}
}

export class LocalAiSetupManager {
	private currentAbortController: AbortController | undefined

	cancel() {
		this.currentAbortController?.abort()
	}

	async start(request: LocalAiSetupStartRequest, reportProgress: ProgressReporter): Promise<LocalAiSetupResult> {
		this.currentAbortController?.abort()
		const abortController = new AbortController()
		this.currentAbortController = abortController
		const { signal } = abortController
		const baseUrl = request.recommendation.baseUrl || OLLAMA_DEFAULT_BASE_URL
		const modelTag = request.recommendation.model.tag

		try {
			await reportProgress({ stage: "runtime", message: "Checking Ollama runtime.", modelTag })
			let runtime = await detectOllamaRuntime(baseUrl)

			if (runtime.status === "missing") {
				const message =
					"Ollama is not installed or not available on PATH. Install Ollama, start it, then retry."
				await reportProgress({
					stage: "error",
					message,
					error: message,
					installUrl: OLLAMA_INSTALL_URL,
					modelTag,
				})
				return { success: false, error: message, installUrl: OLLAMA_INSTALL_URL, modelTag }
			}

			if (runtime.status === "installed-not-running") {
				const started = await tryStartOllama(baseUrl, reportProgress, signal)
				if (!started) {
					const message = "Ollama is installed but is not running. Start Ollama manually, then retry."
					await reportProgress({ stage: "error", message, error: message, modelTag })
					return { success: false, error: message, modelTag }
				}
				runtime = await detectOllamaRuntime(baseUrl)
			}

			if (runtime.status !== "running") {
				const message = "Ollama is not reachable at the selected local URL."
				await reportProgress({ stage: "error", message, error: message, modelTag })
				return { success: false, error: message, modelTag }
			}

			await pullOllamaModel(baseUrl, modelTag, reportProgress, signal)

			await reportProgress({ stage: "verify", message: "Verifying the model is available in Ollama.", modelTag })
			const verified = await verifyOllamaModel(baseUrl, modelTag)
			if (!verified) {
				const message = "Ollama finished the download, but the model was not found in the local model list."
				await reportProgress({ stage: "error", message, error: message, modelTag })
				return { success: false, error: message, modelTag }
			}

			const providerSettings = buildProviderSettings(request)
			await reportProgress({ stage: "configure", message: "Configuring the Ollama provider profile.", modelTag })

			return {
				success: true,
				providerSettings,
				profileName: LOCAL_AI_PROFILE_NAME,
				modelTag,
			}
		} catch (error) {
			const isAbort = signal.aborted || (error instanceof DOMException && error.name === "AbortError")
			const message = isAbort
				? "Local AI setup was cancelled."
				: error instanceof Error
					? error.message
					: String(error)
			await reportProgress({
				stage: isAbort ? "cancelled" : "error",
				message,
				error: isAbort ? undefined : message,
				modelTag,
			})

			return { success: false, error: message, modelTag }
		} finally {
			if (this.currentAbortController === abortController) {
				this.currentAbortController = undefined
			}
		}
	}
}

export const localAiSetupManager = new LocalAiSetupManager()

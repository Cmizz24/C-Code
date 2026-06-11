import type {
	LocalAiSetupProgress,
	LocalAiSetupResult,
	LocalAiSetupStartRequest,
	ProviderSettings,
} from "@roo-code/types"

import { detectLmStudioRuntime, LM_STUDIO_DEFAULT_BASE_URL, normalizeLmStudioBaseUrl } from "./hardware"

export const LM_STUDIO_DOWNLOAD_URL = "https://lmstudio.ai/download"
export const LM_STUDIO_SERVER_DOCS_URL = "https://lmstudio.ai/docs/basics/server"
export const LOCAL_AI_LM_STUDIO_PROFILE_NAME = "Local AI (LM Studio)"

type ProgressReporter = (progress: LocalAiSetupProgress) => void | Promise<void>

const buildLmStudioProviderSettings = (baseUrl: string, modelId: string): ProviderSettings => ({
	apiProvider: "lmstudio",
	lmStudioBaseUrl: normalizeLmStudioBaseUrl(baseUrl || LM_STUDIO_DEFAULT_BASE_URL),
	lmStudioModelId: modelId,
})

export const configureLmStudioProvider = async (
	request: LocalAiSetupStartRequest,
	reportProgress: ProgressReporter,
): Promise<LocalAiSetupResult> => {
	const baseUrl = normalizeLmStudioBaseUrl(request.recommendation.baseUrl || LM_STUDIO_DEFAULT_BASE_URL)
	const modelTag = request.questionnaire.selectedModel || request.recommendation.model.tag

	await reportProgress({ stage: "runtime", message: "Checking LM Studio local server.", modelTag })
	const runtime = await detectLmStudioRuntime(baseUrl)

	if (runtime.status === "missing") {
		const message =
			"LM Studio is not installed or its local server is not reachable. Download LM Studio, install a model, start the local server, then retry."
		await reportProgress({ stage: "error", message, error: message, installUrl: LM_STUDIO_DOWNLOAD_URL, modelTag })
		return { success: false, error: message, installUrl: LM_STUDIO_DOWNLOAD_URL, modelTag }
	}

	if (runtime.status === "installed-not-running") {
		const message = "LM Studio is installed, but the local server is not running. Start the server, then retry."
		await reportProgress({
			stage: "error",
			message,
			error: message,
			installUrl: LM_STUDIO_SERVER_DOCS_URL,
			modelTag,
		})
		return { success: false, error: message, installUrl: LM_STUDIO_SERVER_DOCS_URL, modelTag }
	}

	if (runtime.status === "detection-failed") {
		const message = `LM Studio detection failed${runtime.error ? `: ${runtime.error}` : "."}`
		await reportProgress({
			stage: "error",
			message,
			error: message,
			installUrl: LM_STUDIO_SERVER_DOCS_URL,
			modelTag,
		})
		return { success: false, error: message, installUrl: LM_STUDIO_SERVER_DOCS_URL, modelTag }
	}

	if (runtime.status !== "running") {
		const message = "LM Studio is not reachable at the selected local URL."
		await reportProgress({
			stage: "error",
			message,
			error: message,
			installUrl: LM_STUDIO_SERVER_DOCS_URL,
			modelTag,
		})
		return { success: false, error: message, installUrl: LM_STUDIO_SERVER_DOCS_URL, modelTag }
	}

	if (!modelTag || !(runtime.models ?? []).includes(modelTag)) {
		const message =
			"LM Studio is running, but the selected model was not found. Download or load a chat model in LM Studio, then retry."
		await reportProgress({
			stage: "error",
			message,
			error: message,
			installUrl: LM_STUDIO_SERVER_DOCS_URL,
			modelTag,
		})
		return { success: false, error: message, installUrl: LM_STUDIO_SERVER_DOCS_URL, modelTag }
	}

	await reportProgress({ stage: "configure", message: "Configuring the LM Studio provider profile.", modelTag })

	return {
		success: true,
		providerSettings: buildLmStudioProviderSettings(baseUrl, modelTag),
		profileName: LOCAL_AI_LM_STUDIO_PROFILE_NAME,
		modelTag,
	}
}

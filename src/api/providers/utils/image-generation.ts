import {
	CLOUDFLARE_WORKERS_AI_FREE_ALLOCATION,
	CLOUDFLARE_WORKERS_AI_IMAGE_MODEL_PRICING,
	type GeneratedImageMetadata,
	type ImageGenerationUsageDetails,
} from "@roo-code/types"

import { t } from "../../../i18n"

// Image generation types
interface ImageGenerationResponse {
	choices?: Array<{
		message?: {
			content?: string
			images?: Array<{
				type?: string
				image_url?: {
					url?: string
				}
			}>
		}
	}>
	error?: {
		message?: string
		type?: string
		code?: string
	}
}

interface ImagesApiResponse {
	data?: Array<{
		b64_json?: string
		url?: string
	}>
	images?: string[]
	image?: string
	error?: {
		message?: string
		type?: string
		code?: string
	}
}

interface CloudflareWorkersAiResponse {
	result?: unknown
	image?: string
	errors?: Array<{ message?: string }>
	success?: boolean
	usage?: unknown
}

type ImageGenerationProviderName = "openrouter" | "openai" | "cloudflare" | "comfyui" | "automatic1111"

type ImageGenerationApiMethodName =
	| "chat_completions"
	| "images_api"
	| "workers_ai"
	| "comfyui_api"
	| "automatic1111_api"

export interface ImageGenerationResult {
	success: boolean
	imageData?: string
	imageFormat?: string
	usage?: ImageGenerationUsageDetails
	metadata?: GeneratedImageMetadata
	error?: string
}

export interface ImageGenerationOptions {
	baseURL: string
	authToken?: string
	model: string
	prompt: string
	inputImage?: string
	provider?: ImageGenerationProviderName
}

export interface ImagesApiOptions {
	baseURL: string
	authToken?: string
	model: string
	prompt: string
	inputImage?: string
	size?: string
	quality?: string
	outputFormat?: string
	provider?: ImageGenerationProviderName
}

export interface CloudflareWorkersAiImageGenerationOptions {
	baseURL: string
	authToken?: string
	accountId: string
	model: string
	prompt: string
	inputImage?: string
	provider?: Extract<ImageGenerationProviderName, "cloudflare">
}

export interface Automatic1111ImageGenerationOptions {
	baseURL: string
	authToken?: string
	model?: string
	prompt: string
	negativePrompt?: string
	inputImage?: string
	provider?: Extract<ImageGenerationProviderName, "automatic1111">
}

export interface ComfyUiImageGenerationOptions {
	baseURL: string
	authToken?: string
	model: string
	prompt: string
	negativePrompt?: string
	inputImage?: string
	provider?: Extract<ImageGenerationProviderName, "comfyui">
}

const buildImageGenerationHeaders = (authToken?: string): Record<string, string> => ({
	...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
	"Content-Type": "application/json",
	"HTTP-Referer": "https://github.com/Cmizz24/C-Code",
	"X-Title": "C Code",
})

const buildMultipartImageGenerationHeaders = (authToken?: string): Record<string, string> => ({
	...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
	"HTTP-Referer": "https://github.com/Cmizz24/C-Code",
	"X-Title": "C Code",
})

const buildOptionalAuthHeaders = (authToken?: string): Record<string, string> =>
	authToken ? { Authorization: `Bearer ${authToken}` } : {}

const IMAGE_GENERATION_CONFIGURATION_GUIDANCE =
	"Check that the configured image generation provider, base URL, API method, and model support text-to-image or image-edit generation. Use OpenRouter image-output models, Cloudflare Workers AI image models, or an OpenAI/OpenAI-compatible Images API endpoint; vision/image-understanding models can analyze images, but they are not image-generation models."

const IMAGE_GENERATION_RESPONSE_GUIDANCE =
	"Expected image data in one of these response shapes: OpenAI Images API data[0].b64_json or data[0].url; OpenAI-compatible chat choices[0].message.images[].image_url.url; Cloudflare Workers AI result.image or image base64 values; image, message.images, or images values containing base64 image strings; binary image responses; or text content containing a data:image/...;base64 URL or markdown image data URL. Use a real image-generation model through OpenRouter, Cloudflare Workers AI, or an OpenAI/OpenAI-compatible Images API endpoint; vision/image-understanding models are not valid image-generation models."

const STREAM_EVENTS_PROPERTY = "__streamEvents" as const

const formatProviderError = (message: string): string =>
	t("tools:generateImage.failedWithMessage", {
		message,
	})

const formatResponseStatus = (response: Pick<Response, "status" | "statusText">): string =>
	`${response.status}${response.statusText ? ` ${response.statusText}` : ""}`

const getResponseStatus = (response: Response): string => {
	const responseWithStatus = response as Partial<Pick<Response, "status" | "statusText">>
	return typeof responseWithStatus.status === "number"
		? formatResponseStatus(responseWithStatus as Response)
		: "unknown"
}

const getResponseHeader = (response: Response, headerName: string): string | undefined => {
	try {
		const value = response.headers?.get?.(headerName)
		return typeof value === "string" && value.trim() ? value.trim() : undefined
	} catch {
		return undefined
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

const getFiniteNumber = (value: unknown): number | undefined => {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined
	}

	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : undefined
	}

	return undefined
}

const getFirstNumberField = (record: Record<string, unknown>, fields: string[]): number | undefined => {
	for (const field of fields) {
		const value = getFiniteNumber(record[field])
		if (value !== undefined) {
			return value
		}
	}

	return undefined
}

const getFirstStringField = (record: Record<string, unknown>, fields: string[]): string | undefined => {
	for (const field of fields) {
		const value = record[field]
		if (typeof value === "string" && value.trim()) {
			return value.trim()
		}
	}

	return undefined
}

const extractImageGenerationUsageDetails = (value: unknown): ImageGenerationUsageDetails | undefined => {
	if (!isRecord(value)) {
		return undefined
	}

	const usageRecord = isRecord(value.usage) ? value.usage : value
	const tokensIn = getFirstNumberField(usageRecord, [
		"tokensIn",
		"tokens_in",
		"input_tokens",
		"prompt_tokens",
		"promptTokens",
	])
	const tokensOut = getFirstNumberField(usageRecord, [
		"tokensOut",
		"tokens_out",
		"output_tokens",
		"completion_tokens",
		"completionTokens",
	])
	const totalTokens = getFirstNumberField(usageRecord, ["totalTokens", "total_tokens"])
	const imageCount = getFirstNumberField(usageRecord, [
		"imageCount",
		"image_count",
		"images_count",
		"generated_images",
	])
	const neurons = getFirstNumberField(usageRecord, [
		"neurons",
		"total_neurons",
		"totalNeurons",
		"neuron_count",
		"neuronCount",
	])
	const estimatedNeurons = getFirstNumberField(usageRecord, [
		"estimatedNeurons",
		"estimated_neurons",
		"estimated_total_neurons",
		"estimatedTotalNeurons",
	])
	const cost = getFirstNumberField(usageRecord, ["cost", "total_cost", "totalCost", "cost_usd", "costUsd"])
	const estimatedCost = getFirstNumberField(usageRecord, [
		"estimatedCost",
		"estimated_cost",
		"estimated_cost_usd",
		"estimatedCostUsd",
	])
	const currency = getFirstStringField(usageRecord, ["currency", "cost_currency"])
	const pricingDescription = getFirstStringField(usageRecord, [
		"pricingDescription",
		"pricing_description",
		"pricing",
	])
	const quotaDescription = getFirstStringField(usageRecord, ["quotaDescription", "quota_description", "quota"])

	const usage: ImageGenerationUsageDetails = {
		...(tokensIn !== undefined && { tokensIn }),
		...(tokensOut !== undefined && { tokensOut }),
		...(totalTokens !== undefined && { totalTokens }),
		...(imageCount !== undefined && { imageCount }),
		...(neurons !== undefined && { neurons }),
		...(estimatedNeurons !== undefined && { estimatedNeurons }),
		...(cost !== undefined && { cost }),
		...(estimatedCost !== undefined && { estimatedCost }),
		...(currency !== undefined && { currency }),
		...(pricingDescription !== undefined && { pricingDescription }),
		...(quotaDescription !== undefined && { quotaDescription }),
	}

	return Object.keys(usage).length > 0 ? usage : undefined
}

interface ProviderResponseDiagnosticsContext {
	provider?: ImageGenerationProviderName
	apiMethod: ImageGenerationApiMethodName
	endpoint: string
	model: string
}

interface ProviderResponseDiagnostics {
	status?: string
	contentType?: string
	bodyByteLength?: number
	streaming?: boolean
	topLevelKeys?: string[]
	eventKeys?: string[]
}

type JsonParseResult<T> =
	| { success: true; data: T; diagnostics: ProviderResponseDiagnostics }
	| { success: false; error: string }

type ProviderResponseRecord = Record<string, unknown> & {
	[STREAM_EVENTS_PROPERTY]?: ProviderResponseRecord[]
}

type ImageCandidate =
	| { kind: "data_or_url"; value: string; fallbackFormat?: string }
	| { kind: "base64"; value: string; fallbackFormat?: string }

const sanitizeDiagnosticValue = (value: unknown, fallback = "unknown"): string => {
	const text = String(value ?? "")
		.replace(/[\r\n\t]+/g, " ")
		.trim()
	if (!text) {
		return fallback
	}
	return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

const formatDiagnosticKeys = (keys: string[] | undefined): string =>
	keys && keys.length > 0 ? keys.map((key) => sanitizeDiagnosticValue(key)).join("|") : "none"

const getProviderSpecificGuidance = (_context: ProviderResponseDiagnosticsContext): string => ""

const formatProviderResponseDiagnostics = (
	context: ProviderResponseDiagnosticsContext,
	diagnostics: ProviderResponseDiagnostics,
): string => {
	return [
		`provider=${sanitizeDiagnosticValue(context.provider)}`,
		`apiMethod=${sanitizeDiagnosticValue(context.apiMethod)}`,
		`endpoint=${sanitizeDiagnosticValue(context.endpoint)}`,
		`status=${sanitizeDiagnosticValue(diagnostics.status)}`,
		`contentType=${sanitizeDiagnosticValue(diagnostics.contentType)}`,
		`bodyByteLength=${diagnostics.bodyByteLength ?? "unknown"}`,
		`streaming=${diagnostics.streaming === undefined ? "unknown" : String(diagnostics.streaming)}`,
		`topLevelKeys=${formatDiagnosticKeys(diagnostics.topLevelKeys)}`,
		`eventKeys=${formatDiagnosticKeys(diagnostics.eventKeys)}`,
		`model=${sanitizeDiagnosticValue(context.model)}`,
	].join(", ")
}

const formatProviderErrorWithDiagnostics = (
	message: string,
	context: ProviderResponseDiagnosticsContext,
	diagnostics: ProviderResponseDiagnostics,
): string => {
	const providerSpecificGuidance = getProviderSpecificGuidance(context)
	return formatProviderError(
		`${message}${providerSpecificGuidance ? ` ${providerSpecificGuidance}` : ""} Diagnostics: ${formatProviderResponseDiagnostics(context, diagnostics)}`,
	)
}

const getRecordKeys = (record: Record<string, unknown>): string[] =>
	Object.keys(record)
		.filter((key) => key !== STREAM_EVENTS_PROPERTY)
		.sort()

const getEventKeys = (record: ProviderResponseRecord): string[] | undefined => {
	const events = record[STREAM_EVENTS_PROPERTY]
	if (!Array.isArray(events) || events.length === 0) {
		return undefined
	}

	return [...new Set(events.flatMap((event) => getRecordKeys(event)))].sort()
}

const isStreamingResponse = (response: Response, parsedAsStream = false): boolean => {
	if (parsedAsStream) {
		return true
	}

	const contentType = getResponseHeader(response, "content-type") || ""
	const transferEncoding = getResponseHeader(response, "transfer-encoding") || ""
	return /(?:text\/event-stream|application\/(?:x-)?ndjson)/i.test(contentType) || /chunked/i.test(transferEncoding)
}

const buildResponseDiagnostics = (
	response: Response,
	overrides: Partial<ProviderResponseDiagnostics> = {},
): ProviderResponseDiagnostics => ({
	status: getResponseStatus(response),
	contentType: getResponseHeader(response, "content-type") || "unknown",
	streaming: isStreamingResponse(response),
	...overrides,
})

const getEndpointPath = (url: string): string => {
	try {
		return new URL(url).pathname || "unknown"
	} catch {
		const withoutQuery = url.split(/[?#]/)[0]
		const match = withoutQuery.match(/^https?:\/\/[^/]+(\/.*)$/i)
		return match?.[1] || withoutQuery || "unknown"
	}
}

const validateProviderJsonShape = <T>(
	value: unknown,
	context: ProviderResponseDiagnosticsContext,
	diagnostics: ProviderResponseDiagnostics,
): JsonParseResult<T> => {
	if (!isRecord(value)) {
		return {
			success: false,
			error: formatProviderErrorWithDiagnostics(
				`The image generation provider returned an unexpected JSON response. ${IMAGE_GENERATION_CONFIGURATION_GUIDANCE}`,
				context,
				diagnostics,
			),
		}
	}

	const record = value as ProviderResponseRecord
	return {
		success: true,
		data: value as T,
		diagnostics: {
			...diagnostics,
			topLevelKeys: getRecordKeys(record),
			eventKeys: getEventKeys(record),
		},
	}
}

const parseNdjsonProviderResponse = (responseText: string): ProviderResponseRecord | undefined => {
	const events: ProviderResponseRecord[] = []

	for (const line of responseText.split(/\r?\n/)) {
		const trimmedLine = line.trim()
		if (!trimmedLine) {
			continue
		}

		const jsonLine = trimmedLine.startsWith("data:") ? trimmedLine.slice("data:".length).trim() : trimmedLine
		if (jsonLine === "[DONE]") {
			continue
		}

		try {
			const parsed = JSON.parse(jsonLine)
			if (!isRecord(parsed)) {
				return undefined
			}
			events.push(parsed as ProviderResponseRecord)
		} catch {
			return undefined
		}
	}

	return events.length > 0 ? { [STREAM_EVENTS_PROPERTY]: events } : undefined
}

async function readProviderJsonResponse<T>(
	response: Response,
	responseDescription: string,
	context: ProviderResponseDiagnosticsContext,
): Promise<JsonParseResult<T>> {
	const responseWithText = response as Response & { text?: () => Promise<string>; json?: () => Promise<unknown> }

	if (typeof responseWithText.text === "function") {
		const responseText = await responseWithText.text()
		const diagnostics = buildResponseDiagnostics(response, {
			bodyByteLength: Buffer.byteLength(responseText, "utf8"),
		})

		if (!responseText.trim()) {
			return {
				success: false,
				error: formatProviderErrorWithDiagnostics(
					`The image generation provider returned an empty ${responseDescription}. ${IMAGE_GENERATION_CONFIGURATION_GUIDANCE}`,
					context,
					diagnostics,
				),
			}
		}

		try {
			return validateProviderJsonShape<T>(JSON.parse(responseText), context, diagnostics)
		} catch {
			const ndjsonResult = parseNdjsonProviderResponse(responseText)
			if (ndjsonResult) {
				return validateProviderJsonShape<T>(ndjsonResult, context, {
					...diagnostics,
					streaming: true,
				})
			}

			return {
				success: false,
				error: formatProviderErrorWithDiagnostics(
					`The image generation provider returned a non-JSON ${responseDescription}. ${IMAGE_GENERATION_CONFIGURATION_GUIDANCE}`,
					context,
					diagnostics,
				),
			}
		}
	}

	if (typeof responseWithText.json === "function") {
		const diagnostics = buildResponseDiagnostics(response)
		try {
			return validateProviderJsonShape<T>(await responseWithText.json(), context, diagnostics)
		} catch {
			return {
				success: false,
				error: formatProviderErrorWithDiagnostics(
					`The image generation provider returned an invalid JSON ${responseDescription}. ${IMAGE_GENERATION_CONFIGURATION_GUIDANCE}`,
					context,
					diagnostics,
				),
			}
		}
	}

	return {
		success: false,
		error: formatProviderErrorWithDiagnostics(
			`The image generation provider returned an unreadable ${responseDescription}. ${IMAGE_GENERATION_CONFIGURATION_GUIDANCE}`,
			context,
			buildResponseDiagnostics(response),
		),
	}
}

const getErrorMessageFromErrorResponse = async (
	response: Response,
	context: ProviderResponseDiagnosticsContext,
): Promise<string> => {
	const statusMessage = t("tools:generateImage.failedWithStatus", {
		status: response.status,
		statusText: response.statusText,
	})
	const responseWithText = response as Response & { text?: () => Promise<string> }

	if (typeof responseWithText.text !== "function") {
		return statusMessage
	}

	const errorText = await responseWithText.text()
	const diagnostics = buildResponseDiagnostics(response, {
		bodyByteLength: Buffer.byteLength(errorText, "utf8"),
	})
	if (!errorText.trim()) {
		return formatProviderErrorWithDiagnostics(
			`The image generation provider returned an empty error response (${formatResponseStatus(response)}). ${IMAGE_GENERATION_CONFIGURATION_GUIDANCE}`,
			context,
			diagnostics,
		)
	}

	try {
		const errorJson = JSON.parse(errorText)
		if (isRecord(errorJson) && isRecord(errorJson.error) && typeof errorJson.error.message === "string") {
			return formatProviderError(errorJson.error.message)
		}

		const cloudflareErrorMessage = getCloudflareWorkersAiErrorMessage(errorJson)
		if (cloudflareErrorMessage) {
			return formatProviderError(cloudflareErrorMessage)
		}

		if (isRecord(errorJson) && typeof errorJson.message === "string" && errorJson.message.trim()) {
			return formatProviderError(errorJson.message)
		}

		if (isRecord(errorJson)) {
			return formatProviderErrorWithDiagnostics(
				`The image generation provider returned an error response (${formatResponseStatus(response)}). ${IMAGE_GENERATION_CONFIGURATION_GUIDANCE}`,
				context,
				{
					...diagnostics,
					topLevelKeys: getRecordKeys(errorJson),
				},
			)
		}
	} catch {
		return formatProviderErrorWithDiagnostics(
			`The image generation provider returned a non-JSON error response (${formatResponseStatus(response)}). ${IMAGE_GENERATION_CONFIGURATION_GUIDANCE}`,
			context,
			diagnostics,
		)
	}

	return statusMessage
}

const getCloudflareWorkersAiErrorMessage = (value: unknown): string | undefined => {
	if (!isRecord(value)) {
		return undefined
	}

	if (Array.isArray(value.errors)) {
		const messages = value.errors
			.map((error) => (isRecord(error) && typeof error.message === "string" ? error.message.trim() : undefined))
			.filter((message): message is string => Boolean(message))

		if (messages.length > 0) {
			return messages.join("; ")
		}
	}

	if (value.success === false) {
		return "Cloudflare Workers AI returned an unsuccessful response without an error message."
	}

	return undefined
}

const getImageFormatFromContentType = (contentType: string | null | undefined): string | undefined => {
	const match = contentType?.match(/^image\/(png|jpeg|jpg|webp|gif)(?:;|$)/i)
	return match?.[1]?.toLowerCase()
}

const getImageFormatFromUrl = (url: string): string | undefined => {
	try {
		const parsed = new URL(url)
		const match = parsed.pathname.match(/\.(png|jpe?g|webp|gif)$/i)
		return match?.[1]?.toLowerCase().replace("jpg", "jpeg")
	} catch {
		const match = url.match(/\.(png|jpe?g|webp|gif)(?:\?|#|$)/i)
		return match?.[1]?.toLowerCase().replace("jpg", "jpeg")
	}
}

const isDallEImageModel = (model: string): boolean => /^dall-e-\d+/i.test(model.trim())

const isProviderSpecificGenerationsEditModel = (model: string): boolean => model.trim().startsWith("bfl/")

const getImagesApiResponseFallbackFormat = (model: string, outputFormat: string): string =>
	isDallEImageModel(model) ? "png" : outputFormat

const normalizeBinaryImageResponse = async (
	response: Response,
	fallbackFormat = "png",
): Promise<Pick<ImageGenerationResult, "imageData" | "imageFormat"> | undefined> => {
	const contentType = getResponseHeader(response, "content-type")
	const format = normalizeImageFormat(getImageFormatFromContentType(contentType), fallbackFormat)

	if (!getImageFormatFromContentType(contentType)) {
		return undefined
	}

	const responseWithArrayBuffer = response as Response & { arrayBuffer?: () => Promise<ArrayBuffer> }
	if (typeof responseWithArrayBuffer.arrayBuffer !== "function") {
		return undefined
	}

	const arrayBuffer = await responseWithArrayBuffer.arrayBuffer()
	const base64Data = Buffer.from(arrayBuffer).toString("base64")
	return {
		imageData: `data:image/${format};base64,${base64Data}`,
		imageFormat: format,
	}
}

const sanitizeBase64ImageData = (value: string): string => value.trim().replace(/\s/g, "")

const normalizeImageFormat = (format: string | undefined, fallbackFormat = "png"): string => {
	const normalized = (format || fallbackFormat).toLowerCase().replace("jpg", "jpeg")
	return normalized || "png"
}

const getImageFileExtension = (format: string): string => (format === "jpeg" ? "jpg" : format)

const getImageEditInputFromDataUrl = (
	inputImage: string,
): { data: ArrayBuffer; filename: string; mimeType: string } | undefined => {
	const base64Match = inputImage.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i)
	if (!base64Match) {
		return undefined
	}

	const imageFormat = normalizeImageFormat(base64Match[1])
	const base64Data = sanitizeBase64ImageData(base64Match[2])
	const imageBuffer = Buffer.from(base64Data, "base64")
	const imageData = new ArrayBuffer(imageBuffer.byteLength)
	new Uint8Array(imageData).set(imageBuffer)

	return {
		data: imageData,
		filename: `input.${getImageFileExtension(imageFormat)}`,
		mimeType: `image/${imageFormat}`,
	}
}

const appendFormDataString = (formData: FormData, name: string, value: string | number | undefined): void => {
	if (value !== undefined && String(value).trim()) {
		formData.append(name, String(value))
	}
}

const appendImagesApiOutputOptions = (
	target: Record<string, unknown> | FormData,
	model: string,
	outputFormat: string,
): void => {
	if (typeof (target as FormData).append === "function") {
		const formData = target as FormData
		if (isDallEImageModel(model)) {
			appendFormDataString(formData, "response_format", "b64_json")
		} else {
			appendFormDataString(formData, "output_format", outputFormat)
		}
		return
	}

	const requestBody = target as Record<string, unknown>
	if (isDallEImageModel(model)) {
		requestBody.response_format = "b64_json"
	} else {
		requestBody.output_format = outputFormat
	}
}

const detectImageFormatFromBase64 = (base64Data: string): string | undefined => {
	try {
		const buffer = Buffer.from(sanitizeBase64ImageData(base64Data).slice(0, 64), "base64")

		if (
			buffer.length >= 8 &&
			buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		) {
			return "png"
		}

		if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
			return "jpeg"
		}

		if (buffer.length >= 6) {
			const signature = buffer.subarray(0, 6).toString("ascii")
			if (signature === "GIF87a" || signature === "GIF89a") {
				return "gif"
			}
		}

		if (
			buffer.length >= 12 &&
			buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
			buffer.subarray(8, 12).toString("ascii") === "WEBP"
		) {
			return "webp"
		}
	} catch {
		return undefined
	}

	return undefined
}

const getStringField = (record: Record<string, unknown>, field: string): string | undefined => {
	const value = record[field]
	return typeof value === "string" && value.trim() ? value : undefined
}

const getMimeImageFormat = (record: Record<string, unknown>): string | undefined => {
	const mimeType = getStringField(record, "mimeType") || getStringField(record, "mime_type")
	const match = mimeType?.match(/^image\/(png|jpeg|jpg|webp|gif)$/i)
	return match?.[1]?.toLowerCase().replace("jpg", "jpeg")
}

const getImageCandidateFromText = (text: string, fallbackFormat = "png"): ImageCandidate | undefined => {
	const dataUrlMatch = text.match(/data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+/i)
	if (dataUrlMatch?.[0]) {
		return { kind: "data_or_url", value: dataUrlMatch[0], fallbackFormat }
	}

	const markdownImageUrlMatch = text.match(
		/!\[[^\]]*\]\((https?:\/\/[^)\s]+\.(?:png|jpe?g|webp|gif)(?:\?[^)\s]*)?)\)/i,
	)
	if (markdownImageUrlMatch?.[1]) {
		return { kind: "data_or_url", value: markdownImageUrlMatch[1], fallbackFormat }
	}

	const compactText = text
		.trim()
		.replace(/^```(?:\w+)?\s*/i, "")
		.replace(/\s*```$/, "")
		.replace(/\s/g, "")

	if (compactText.length > 64 && /^[A-Za-z0-9+/=]+$/.test(compactText) && detectImageFormatFromBase64(compactText)) {
		return { kind: "base64", value: compactText, fallbackFormat }
	}

	return undefined
}

const getImageCandidateFromImageValue = (value: unknown, fallbackFormat = "png"): ImageCandidate | undefined => {
	if (typeof value === "string" && value.trim()) {
		const trimmedValue = value.trim()
		return trimmedValue.startsWith("data:image/") || /^https?:\/\//i.test(trimmedValue)
			? { kind: "data_or_url", value: trimmedValue, fallbackFormat }
			: { kind: "base64", value: trimmedValue, fallbackFormat }
	}

	if (!isRecord(value)) {
		return undefined
	}

	const imageUrl = value.image_url
	if (isRecord(imageUrl)) {
		const imageUrlValue = getStringField(imageUrl, "url")
		if (imageUrlValue) {
			return { kind: "data_or_url", value: imageUrlValue, fallbackFormat }
		}
	}

	const url = getStringField(value, "url")
	if (url) {
		return { kind: "data_or_url", value: url, fallbackFormat }
	}

	const base64Value =
		getStringField(value, "b64_json") || getStringField(value, "base64") || getStringField(value, "data")
	if (base64Value) {
		return { kind: "base64", value: base64Value, fallbackFormat: getMimeImageFormat(value) || fallbackFormat }
	}

	return undefined
}

const getImageCandidateFromImagesArray = (value: unknown, fallbackFormat = "png"): ImageCandidate | undefined => {
	if (!Array.isArray(value)) {
		return undefined
	}

	for (const item of value) {
		const candidate = getImageCandidateFromImageValue(item, fallbackFormat)
		if (candidate) {
			return candidate
		}
	}

	return undefined
}

const getImageCandidateFromContent = (value: unknown, fallbackFormat = "png"): ImageCandidate | undefined => {
	if (typeof value === "string") {
		return getImageCandidateFromText(value, fallbackFormat)
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const candidate =
				getImageCandidateFromImageValue(item, fallbackFormat) ||
				getImageCandidateFromContent(item, fallbackFormat)
			if (candidate) {
				return candidate
			}
		}
		return undefined
	}

	if (!isRecord(value)) {
		return undefined
	}

	const imageValueCandidate = getImageCandidateFromImageValue(value, fallbackFormat)
	if (imageValueCandidate) {
		return imageValueCandidate
	}

	const text = getStringField(value, "text") || getStringField(value, "content")
	return text ? getImageCandidateFromText(text, fallbackFormat) : undefined
}

const getImageCandidateFromMessage = (message: unknown, fallbackFormat = "png"): ImageCandidate | undefined => {
	if (!isRecord(message)) {
		return undefined
	}

	return (
		getImageCandidateFromImagesArray(message.images, fallbackFormat) ||
		getImageCandidateFromContent(message.content, fallbackFormat) ||
		getImageCandidateFromImageValue(message, fallbackFormat)
	)
}

const collectTextFragmentsFromRecord = (record: ProviderResponseRecord): string[] => {
	const fragments: string[] = []

	const response = getStringField(record, "response")
	if (response) {
		fragments.push(response)
	}

	const content = getStringField(record, "content")
	if (content) {
		fragments.push(content)
	}

	if (isRecord(record.message)) {
		const messageContent = getStringField(record.message, "content")
		if (messageContent) {
			fragments.push(messageContent)
		}
	}

	if (Array.isArray(record.choices)) {
		for (const choice of record.choices) {
			if (!isRecord(choice)) {
				continue
			}

			for (const messageKey of ["message", "delta"] as const) {
				if (isRecord(choice[messageKey])) {
					const messageContent = getStringField(choice[messageKey], "content")
					if (messageContent) {
						fragments.push(messageContent)
					}
				}
			}
		}
	}

	return fragments
}

const getImageCandidateFromProviderRecord = (
	record: ProviderResponseRecord,
	fallbackFormat = "png",
	includeStreamEvents = true,
): ImageCandidate | undefined => {
	if (includeStreamEvents && Array.isArray(record[STREAM_EVENTS_PROPERTY])) {
		const streamEvents = record[STREAM_EVENTS_PROPERTY] ?? []

		for (const event of streamEvents) {
			const candidate = getImageCandidateFromProviderRecord(event, fallbackFormat, false)
			if (candidate) {
				return candidate
			}
		}

		const combinedText = streamEvents.flatMap((event) => collectTextFragmentsFromRecord(event)).join("")
		if (combinedText) {
			return getImageCandidateFromText(combinedText, fallbackFormat)
		}
	}

	if (isRecord(record.result)) {
		const resultCandidate = getImageCandidateFromProviderRecord(
			record.result as ProviderResponseRecord,
			fallbackFormat,
			false,
		)
		if (resultCandidate) {
			return resultCandidate
		}
	}

	const directResultCandidate = getImageCandidateFromImageValue(record.result, fallbackFormat)
	if (directResultCandidate) {
		return directResultCandidate
	}

	const data = record.data
	if (Array.isArray(data)) {
		const dataCandidate = getImageCandidateFromImagesArray(data, fallbackFormat)
		if (dataCandidate) {
			return dataCandidate
		}
	}

	if (Array.isArray(record.choices)) {
		for (const choice of record.choices) {
			if (!isRecord(choice)) {
				continue
			}

			const candidate =
				getImageCandidateFromMessage(choice.message, fallbackFormat) ||
				getImageCandidateFromMessage(choice.delta, fallbackFormat) ||
				getImageCandidateFromContent(choice.content, fallbackFormat)

			if (candidate) {
				return candidate
			}
		}
	}

	return (
		getImageCandidateFromMessage(record.message, fallbackFormat) ||
		getImageCandidateFromImagesArray(record.images, fallbackFormat) ||
		getImageCandidateFromImageValue(record.image, fallbackFormat) ||
		getImageCandidateFromContent(record.response, fallbackFormat) ||
		getImageCandidateFromContent(record.content, fallbackFormat)
	)
}

const normalizeImageCandidate = async (
	candidate: ImageCandidate,
	fallbackFormat = "png",
): Promise<Pick<ImageGenerationResult, "imageData" | "imageFormat">> => {
	if (candidate.kind === "base64") {
		const base64Data = sanitizeBase64ImageData(candidate.value)
		const imageFormat = normalizeImageFormat(
			detectImageFormatFromBase64(base64Data),
			candidate.fallbackFormat || fallbackFormat,
		)

		return {
			imageData: `data:image/${imageFormat};base64,${base64Data}`,
			imageFormat,
		}
	}

	return normalizeImageGenerationData(candidate.value, candidate.fallbackFormat || fallbackFormat)
}

const extractImageFromProviderResponse = async (
	result: ProviderResponseRecord,
	fallbackFormat = "png",
): Promise<Pick<ImageGenerationResult, "imageData" | "imageFormat"> | undefined> => {
	const candidate = getImageCandidateFromProviderRecord(result, fallbackFormat)
	return candidate ? normalizeImageCandidate(candidate, fallbackFormat) : undefined
}

const getNoExtractableImageError = (
	apiMethod: ImageGenerationApiMethodName,
	context: ProviderResponseDiagnosticsContext,
	diagnostics: ProviderResponseDiagnostics,
): string =>
	formatProviderErrorWithDiagnostics(
		`The image generation provider response did not include extractable image data for the ${apiMethod} API method. ${IMAGE_GENERATION_RESPONSE_GUIDANCE}`,
		context,
		diagnostics,
	)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type CloudflareWorkersAiRequestFormat = (typeof CLOUDFLARE_WORKERS_AI_IMAGE_MODEL_PRICING)[number]["requestFormat"]

const getCloudflareWorkersAiModelPricing = (model: string) =>
	CLOUDFLARE_WORKERS_AI_IMAGE_MODEL_PRICING.find((pricing) => pricing.model === model.trim())

const getCloudflareWorkersAiRequestFormat = (model: string): CloudflareWorkersAiRequestFormat =>
	getCloudflareWorkersAiModelPricing(model)?.requestFormat ?? "json"

const buildCloudflareWorkersAiEndpoint = (baseURL: string, accountId: string, model: string): string => {
	const normalizedBaseUrl = baseURL.trim().replace(/\/+$/, "")
	const normalizedAccountId = encodeURIComponent(accountId.trim())
	const normalizedModel = model.trim().replace(/^\/+/, "")
	return `${normalizedBaseUrl}/accounts/${normalizedAccountId}/ai/run/${normalizedModel}`
}

const getCloudflareWorkersAiUsageDetails = (
	model: string,
	response?: CloudflareWorkersAiResponse,
): ImageGenerationUsageDetails | undefined => {
	const usageFromResponse = response
		? extractImageGenerationUsageDetails(response) ||
			(isRecord(response.result) ? extractImageGenerationUsageDetails(response.result) : undefined)
		: undefined
	const pricing = getCloudflareWorkersAiModelPricing(model)

	const usage: ImageGenerationUsageDetails = {
		...(usageFromResponse ?? {}),
		...(pricing && {
			pricingDescription: `${pricing.label}: ${pricing.priceDetails.join("; ")}. Neurons: ${pricing.neuronDetails.join("; ")}`,
		}),
		quotaDescription: `Free allocation: ${CLOUDFLARE_WORKERS_AI_FREE_ALLOCATION.neuronsPerDay}; resets at ${CLOUDFLARE_WORKERS_AI_FREE_ALLOCATION.resetTime}; paid overage: ${CLOUDFLARE_WORKERS_AI_FREE_ALLOCATION.paidOverage}.`,
	}

	return Object.keys(usage).length > 0 ? usage : undefined
}

const appendCloudflareWorkersAiInputImage = (formData: FormData, inputImage: string): boolean => {
	const editInput = getImageEditInputFromDataUrl(inputImage)
	if (!editInput) {
		return false
	}

	formData.append("image", new Blob([editInput.data], { type: editInput.mimeType }), editInput.filename)
	return true
}

interface Automatic1111ImageGenerationResponse {
	images?: unknown[]
	info?: string
	parameters?: Record<string, unknown>
	error?: string | { message?: string }
}

interface ComfyUiPromptResponse {
	prompt_id?: string
	number?: number
	node_errors?: Record<string, unknown>
	error?: string | { message?: string }
}

interface ComfyUiImageReference {
	filename: string
	subfolder?: string
	type?: string
}

const getComfyUiPromptHistory = (
	history: ProviderResponseRecord,
	promptId: string,
): Record<string, unknown> | undefined =>
	isRecord(history[promptId]) ? (history[promptId] as Record<string, unknown>) : undefined

const isComfyUiPromptComplete = (promptHistory: Record<string, unknown>): boolean => {
	const status = promptHistory.status
	if (!isRecord(status)) {
		return false
	}

	if (status.completed === true) {
		return true
	}

	const statusString = getStringField(status, "status_str")?.toLowerCase()
	return statusString === "success" || statusString === "error"
}

const getLocalProviderErrorMessage = (error: unknown): string => {
	if (typeof error === "string" && error.trim()) {
		return error.trim()
	}

	if (isRecord(error) && typeof error.message === "string" && error.message.trim()) {
		return error.message.trim()
	}

	return t("tools:generateImage.unknownError")
}

const buildComfyUiDefaultWorkflow = (options: { model: string; prompt: string; negativePrompt?: string }) => ({
	"3": {
		class_type: "KSampler",
		inputs: {
			seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
			steps: 20,
			cfg: 8,
			sampler_name: "euler",
			scheduler: "normal",
			denoise: 1,
			model: ["4", 0],
			positive: ["6", 0],
			negative: ["7", 0],
			latent_image: ["5", 0],
		},
	},
	"4": {
		class_type: "CheckpointLoaderSimple",
		inputs: {
			ckpt_name: options.model,
		},
	},
	"5": {
		class_type: "EmptyLatentImage",
		inputs: {
			width: 1024,
			height: 1024,
			batch_size: 1,
		},
	},
	"6": {
		class_type: "CLIPTextEncode",
		inputs: {
			text: options.prompt,
			clip: ["4", 1],
		},
	},
	"7": {
		class_type: "CLIPTextEncode",
		inputs: {
			text: options.negativePrompt || "",
			clip: ["4", 1],
		},
	},
	"8": {
		class_type: "VAEDecode",
		inputs: {
			samples: ["3", 0],
			vae: ["4", 2],
		},
	},
	"9": {
		class_type: "SaveImage",
		inputs: {
			filename_prefix: "roo_image",
			images: ["8", 0],
		},
	},
})

const getComfyUiImageReference = (
	history: ProviderResponseRecord,
	promptId: string,
): ComfyUiImageReference | undefined => {
	const promptHistory = getComfyUiPromptHistory(history, promptId) ?? history
	const outputs = isRecord(promptHistory.outputs) ? promptHistory.outputs : undefined

	if (!outputs) {
		return undefined
	}

	for (const output of Object.values(outputs)) {
		if (!isRecord(output) || !Array.isArray(output.images)) {
			continue
		}

		for (const image of output.images) {
			if (!isRecord(image)) {
				continue
			}

			const filename = getStringField(image, "filename")
			if (!filename) {
				continue
			}

			return {
				filename,
				subfolder: getStringField(image, "subfolder"),
				type: getStringField(image, "type") || "output",
			}
		}
	}

	return undefined
}

const fetchComfyUiOutputImage = async (
	baseURL: string,
	authToken: string | undefined,
	image: ComfyUiImageReference,
	context: ProviderResponseDiagnosticsContext,
): Promise<ImageGenerationResult> => {
	const params = new URLSearchParams({
		filename: image.filename,
		type: image.type || "output",
	})

	if (image.subfolder) {
		params.set("subfolder", image.subfolder)
	}

	const url = `${baseURL}/view?${params.toString()}`
	const response = await fetch(url, {
		method: "GET",
		headers: buildOptionalAuthHeaders(authToken),
	})

	if (!response.ok) {
		return {
			success: false,
			error: await getErrorMessageFromErrorResponse(response, { ...context, endpoint: getEndpointPath(url) }),
		}
	}

	const binaryImage = await normalizeBinaryImageResponse(response)
	if (binaryImage) {
		return {
			success: true,
			...binaryImage,
		}
	}

	return {
		success: false,
		error: formatProviderErrorWithDiagnostics(
			`ComfyUI returned an output reference, but /view did not return image data. ${IMAGE_GENERATION_RESPONSE_GUIDANCE}`,
			{ ...context, endpoint: getEndpointPath(url) },
			buildResponseDiagnostics(response),
		),
	}
}

export async function generateImageWithAutomatic1111(
	options: Automatic1111ImageGenerationOptions,
): Promise<ImageGenerationResult> {
	const { baseURL, authToken, model, prompt, negativePrompt, inputImage, provider = "automatic1111" } = options

	if (inputImage) {
		return {
			success: false,
			error: formatProviderError(
				"Automatic1111 local image generation currently supports text-to-image requests through /sdapi/v1/txt2img. Remove the input image or use an image-edit provider.",
			),
		}
	}

	try {
		const url = `${baseURL}/sdapi/v1/txt2img`
		const diagnosticsContext: ProviderResponseDiagnosticsContext = {
			provider,
			apiMethod: "automatic1111_api",
			endpoint: getEndpointPath(url),
			model: model || "current-checkpoint",
		}

		const requestBody: Record<string, unknown> = {
			prompt,
			negative_prompt: negativePrompt || "",
			width: 1024,
			height: 1024,
			batch_size: 1,
			n_iter: 1,
			steps: 20,
			cfg_scale: 7,
			sampler_name: "Euler",
			save_images: false,
		}

		if (model?.trim()) {
			requestBody.override_settings = {
				sd_model_checkpoint: model.trim(),
			}
		}

		const response = await fetch(url, {
			method: "POST",
			headers: buildImageGenerationHeaders(authToken),
			body: JSON.stringify(requestBody),
		})

		if (!response.ok) {
			return {
				success: false,
				error: await getErrorMessageFromErrorResponse(response, diagnosticsContext),
			}
		}

		const parsedResult = await readProviderJsonResponse<Automatic1111ImageGenerationResponse>(
			response,
			"response",
			diagnosticsContext,
		)
		if (!parsedResult.success) {
			return parsedResult
		}

		const result = parsedResult.data
		if (result.error) {
			return {
				success: false,
				error: formatProviderError(getLocalProviderErrorMessage(result.error)),
			}
		}

		const normalizedImage = await extractImageFromProviderResponse(result as ProviderResponseRecord)
		if (!normalizedImage) {
			return {
				success: false,
				error: getNoExtractableImageError("automatic1111_api", diagnosticsContext, parsedResult.diagnostics),
			}
		}

		return {
			success: true,
			...normalizedImage,
			usage: extractImageGenerationUsageDetails(result),
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

export async function generateImageWithComfyUi(options: ComfyUiImageGenerationOptions): Promise<ImageGenerationResult> {
	const { baseURL, authToken, model, prompt, negativePrompt, inputImage, provider = "comfyui" } = options

	if (inputImage) {
		return {
			success: false,
			error: formatProviderError(
				"ComfyUI local image generation currently uses Roo's default text-to-image workflow. Remove the input image or use an image-edit provider.",
			),
		}
	}

	try {
		const url = `${baseURL}/prompt`
		const diagnosticsContext: ProviderResponseDiagnosticsContext = {
			provider,
			apiMethod: "comfyui_api",
			endpoint: getEndpointPath(url),
			model,
		}

		const response = await fetch(url, {
			method: "POST",
			headers: buildImageGenerationHeaders(authToken),
			body: JSON.stringify({
				prompt: buildComfyUiDefaultWorkflow({ model, prompt, negativePrompt }),
				client_id: `roo-code-${Date.now()}`,
			}),
		})

		if (!response.ok) {
			return {
				success: false,
				error: await getErrorMessageFromErrorResponse(response, diagnosticsContext),
			}
		}

		const parsedPromptResult = await readProviderJsonResponse<ComfyUiPromptResponse>(
			response,
			"prompt response",
			diagnosticsContext,
		)
		if (!parsedPromptResult.success) {
			return parsedPromptResult
		}

		const promptResult = parsedPromptResult.data
		if (promptResult.error) {
			return {
				success: false,
				error: formatProviderError(getLocalProviderErrorMessage(promptResult.error)),
			}
		}

		if (!promptResult.prompt_id) {
			return {
				success: false,
				error: formatProviderErrorWithDiagnostics(
					`ComfyUI did not return a prompt_id. ${IMAGE_GENERATION_CONFIGURATION_GUIDANCE}`,
					diagnosticsContext,
					parsedPromptResult.diagnostics,
				),
			}
		}

		const promptId = promptResult.prompt_id
		for (let attempt = 0; attempt < 60; attempt++) {
			const historyUrl = `${baseURL}/history/${encodeURIComponent(promptId)}`
			const historyContext: ProviderResponseDiagnosticsContext = {
				...diagnosticsContext,
				endpoint: getEndpointPath(historyUrl),
			}
			const historyResponse = await fetch(historyUrl, {
				method: "GET",
				headers: buildOptionalAuthHeaders(authToken),
			})

			if (!historyResponse.ok) {
				return {
					success: false,
					error: await getErrorMessageFromErrorResponse(historyResponse, historyContext),
				}
			}

			const parsedHistoryResult = await readProviderJsonResponse<ProviderResponseRecord>(
				historyResponse,
				"history response",
				historyContext,
			)
			if (!parsedHistoryResult.success) {
				return parsedHistoryResult
			}

			const imageReference = getComfyUiImageReference(parsedHistoryResult.data, promptId)
			if (imageReference) {
				return fetchComfyUiOutputImage(baseURL, authToken, imageReference, diagnosticsContext)
			}

			const promptHistory = getComfyUiPromptHistory(parsedHistoryResult.data, promptId)
			if (promptHistory && isComfyUiPromptComplete(promptHistory)) {
				return {
					success: false,
					error: getNoExtractableImageError("comfyui_api", historyContext, parsedHistoryResult.diagnostics),
				}
			}

			await sleep(1_000)
		}

		return {
			success: false,
			error: formatProviderError(
				"ComfyUI did not produce an image before the request timed out. Check that the server is running, the checkpoint name exists, and the workflow can complete.",
			),
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

export async function normalizeImageGenerationData(
	imageData: string,
	fallbackFormat = "png",
): Promise<Pick<ImageGenerationResult, "imageData" | "imageFormat">> {
	if (imageData.startsWith("data:image/")) {
		const base64Match = imageData.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i)
		if (!base64Match) {
			throw new Error(t("tools:generateImage.invalidImageFormat"))
		}

		return {
			imageData,
			imageFormat: base64Match[1].toLowerCase(),
		}
	}

	if (/^https?:\/\//i.test(imageData)) {
		const response = await fetch(imageData)
		if (!response.ok) {
			throw new Error(
				t("tools:generateImage.failedWithStatus", {
					status: response.status,
					statusText: response.statusText,
				}),
			)
		}

		const format =
			getImageFormatFromContentType(response.headers?.get?.("content-type")) ||
			getImageFormatFromUrl(imageData) ||
			fallbackFormat
		const arrayBuffer = await response.arrayBuffer()
		const base64Data = Buffer.from(arrayBuffer).toString("base64")

		return {
			imageData: `data:image/${format};base64,${base64Data}`,
			imageFormat: format,
		}
	}

	throw new Error(t("tools:generateImage.invalidImageFormat"))
}

/**
 * Shared image generation implementation for OpenAI-compatible image providers.
 */
export async function generateImageWithProvider(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
	const { baseURL, authToken, model, prompt, inputImage, provider } = options

	try {
		const url = `${baseURL}/chat/completions`
		const diagnosticsContext: ProviderResponseDiagnosticsContext = {
			provider,
			apiMethod: "chat_completions",
			endpoint: getEndpointPath(url),
			model,
		}
		const response = await fetch(url, {
			method: "POST",
			headers: buildImageGenerationHeaders(authToken),
			body: JSON.stringify({
				model,
				messages: [
					{
						role: "user",
						content: inputImage
							? [
									{
										type: "text",
										text: prompt,
									},
									{
										type: "image_url",
										image_url: {
											url: inputImage,
										},
									},
								]
							: prompt,
					},
				],
				modalities: ["image", "text"],
			}),
		})

		if (!response.ok) {
			const errorMessage = await getErrorMessageFromErrorResponse(response, diagnosticsContext)
			return {
				success: false,
				error: errorMessage,
			}
		}

		const binaryImage = await normalizeBinaryImageResponse(response)
		if (binaryImage) {
			return {
				success: true,
				...binaryImage,
			}
		}

		const parsedResult = await readProviderJsonResponse<ImageGenerationResponse>(
			response,
			"response",
			diagnosticsContext,
		)
		if (!parsedResult.success) {
			return parsedResult
		}

		const result = parsedResult.data

		if (result.error) {
			return {
				success: false,
				error: t("tools:generateImage.failedWithMessage", {
					message: result.error.message,
				}),
			}
		}

		const normalizedImage = await extractImageFromProviderResponse(result as ProviderResponseRecord)
		if (!normalizedImage) {
			return {
				success: false,
				error: getNoExtractableImageError("chat_completions", diagnosticsContext, parsedResult.diagnostics),
			}
		}

		return {
			success: true,
			...normalizedImage,
			usage: extractImageGenerationUsageDetails(result),
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

/**
 * Generate an image using Cloudflare Workers AI's account-scoped REST API.
 */
export async function generateImageWithCloudflareWorkersAi(
	options: CloudflareWorkersAiImageGenerationOptions,
): Promise<ImageGenerationResult> {
	const { baseURL, authToken, accountId, model, prompt, inputImage, provider = "cloudflare" } = options

	try {
		const url = buildCloudflareWorkersAiEndpoint(baseURL, accountId, model)
		const diagnosticsContext: ProviderResponseDiagnosticsContext = {
			provider,
			apiMethod: "workers_ai",
			endpoint: getEndpointPath(url),
			model,
		}
		const requestFormat = getCloudflareWorkersAiRequestFormat(model)
		let fetchOptions: RequestInit

		if (requestFormat === "multipart") {
			const formData = new FormData()
			appendFormDataString(formData, "prompt", prompt)
			if (inputImage && !appendCloudflareWorkersAiInputImage(formData, inputImage)) {
				return {
					success: false,
					error: formatProviderError(
						"Cloudflare Workers AI image-to-image generation requires a data:image/...;base64 input image for multipart models.",
					),
				}
			}

			fetchOptions = {
				method: "POST",
				headers: buildMultipartImageGenerationHeaders(authToken),
				body: formData,
			}
		} else {
			fetchOptions = {
				method: "POST",
				headers: buildImageGenerationHeaders(authToken),
				body: JSON.stringify({ prompt }),
			}
		}

		const response = await fetch(url, fetchOptions)

		if (!response.ok) {
			const errorMessage = await getErrorMessageFromErrorResponse(response, diagnosticsContext)
			return {
				success: false,
				error: errorMessage,
			}
		}

		const binaryImage = await normalizeBinaryImageResponse(response)
		if (binaryImage) {
			return {
				success: true,
				...binaryImage,
				usage: getCloudflareWorkersAiUsageDetails(model),
			}
		}

		const parsedResult = await readProviderJsonResponse<CloudflareWorkersAiResponse>(
			response,
			"response",
			diagnosticsContext,
		)
		if (!parsedResult.success) {
			return parsedResult
		}

		const result = parsedResult.data
		const cloudflareErrorMessage = getCloudflareWorkersAiErrorMessage(result)
		if (cloudflareErrorMessage) {
			return {
				success: false,
				error: formatProviderError(cloudflareErrorMessage),
			}
		}

		const normalizedImage = await extractImageFromProviderResponse(result as ProviderResponseRecord)
		if (!normalizedImage) {
			return {
				success: false,
				error: getNoExtractableImageError("workers_ai", diagnosticsContext, parsedResult.diagnostics),
			}
		}

		return {
			success: true,
			...normalizedImage,
			usage: getCloudflareWorkersAiUsageDetails(model, result),
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

/**
 * Generate an image using OpenAI's Images API (/v1/images/generations)
 * Supports BFL models (Flux) with provider-specific options for image editing
 */
export async function generateImageWithImagesApi(options: ImagesApiOptions): Promise<ImageGenerationResult> {
	const { baseURL, authToken, model, prompt, inputImage, outputFormat = "png", provider } = options

	try {
		const normalizedOutputFormat = normalizeImageFormat(outputFormat)
		const useGenerationsEndpoint = !inputImage || isProviderSpecificGenerationsEditModel(model)
		const url = `${baseURL}/images/${useGenerationsEndpoint ? "generations" : "edits"}`
		const diagnosticsContext: ProviderResponseDiagnosticsContext = {
			provider,
			apiMethod: "images_api",
			endpoint: getEndpointPath(url),
			model,
		}

		let fetchOptions: RequestInit

		if (!useGenerationsEndpoint) {
			const editInput = getImageEditInputFromDataUrl(inputImage)
			if (!editInput) {
				return {
					success: false,
					error: formatProviderError(
						"OpenAI Images API image edits require a data:image/...;base64 input image. Use a supported local input image file or omit the image parameter for text-to-image generation.",
					),
				}
			}

			const formData = new FormData()
			appendFormDataString(formData, "model", model)
			appendFormDataString(formData, "prompt", prompt)
			appendFormDataString(formData, "n", 1)
			appendFormDataString(formData, "size", options.size)
			appendFormDataString(formData, "quality", options.quality)
			appendImagesApiOutputOptions(formData, model, normalizedOutputFormat)
			formData.append("image", new Blob([editInput.data], { type: editInput.mimeType }), editInput.filename)

			fetchOptions = {
				method: "POST",
				headers: buildMultipartImageGenerationHeaders(authToken),
				body: formData,
			}
		} else {
			// Build the request body. For BFL (Black Forest Labs) models like flux-pro-1.1,
			// inputImage is passed via providerOptions.blackForestLabs.inputImage on /images/generations.
			const requestBody: Record<string, unknown> = {
				model,
				prompt,
				n: 1,
			}

			if (options.size) {
				requestBody.size = options.size
			}
			if (options.quality) {
				requestBody.quality = options.quality
			}

			if (isProviderSpecificGenerationsEditModel(model)) {
				requestBody.providerOptions = {
					blackForestLabs: {
						outputFormat: normalizedOutputFormat,
						...(inputImage && { inputImage }),
					},
				}
			} else {
				appendImagesApiOutputOptions(requestBody, model, normalizedOutputFormat)
			}

			fetchOptions = {
				method: "POST",
				headers: buildImageGenerationHeaders(authToken),
				body: JSON.stringify(requestBody),
			}
		}

		const response = await fetch(url, fetchOptions)

		if (!response.ok) {
			const errorMessage = await getErrorMessageFromErrorResponse(response, diagnosticsContext)
			return {
				success: false,
				error: errorMessage,
			}
		}

		const responseFallbackFormat = getImagesApiResponseFallbackFormat(model, normalizedOutputFormat)
		const binaryImage = await normalizeBinaryImageResponse(response, responseFallbackFormat)
		if (binaryImage) {
			return {
				success: true,
				...binaryImage,
			}
		}

		const parsedResult = await readProviderJsonResponse<ImagesApiResponse>(response, "response", diagnosticsContext)
		if (!parsedResult.success) {
			return parsedResult
		}

		const result = parsedResult.data

		if (result.error) {
			return {
				success: false,
				error: t("tools:generateImage.failedWithMessage", {
					message: result.error.message,
				}),
			}
		}

		const normalizedImage = await extractImageFromProviderResponse(
			result as ProviderResponseRecord,
			responseFallbackFormat,
		)
		if (!normalizedImage) {
			return {
				success: false,
				error: getNoExtractableImageError("images_api", diagnosticsContext, parsedResult.diagnostics),
			}
		}

		return {
			success: true,
			...normalizedImage,
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

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
	error?: {
		message?: string
		type?: string
		code?: string
	}
}

export interface ImageGenerationResult {
	success: boolean
	imageData?: string
	imageFormat?: string
	error?: string
}

export interface ImageGenerationOptions {
	baseURL: string
	authToken?: string
	model: string
	prompt: string
	inputImage?: string
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
}

const buildImageGenerationHeaders = (authToken?: string): Record<string, string> => ({
	...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
	"Content-Type": "application/json",
	"HTTP-Referer": "https://github.com/Cmizz24/C-Code",
	"X-Title": "C Code",
})

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
	const { baseURL, authToken, model, prompt, inputImage } = options

	try {
		const response = await fetch(`${baseURL}/chat/completions`, {
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
			const errorText = await response.text()
			let errorMessage = t("tools:generateImage.failedWithStatus", {
				status: response.status,
				statusText: response.statusText,
			})

			try {
				const errorJson = JSON.parse(errorText)
				if (errorJson.error?.message) {
					errorMessage = t("tools:generateImage.failedWithMessage", {
						message: errorJson.error.message,
					})
				}
			} catch {
				// Use default error message
			}
			return {
				success: false,
				error: errorMessage,
			}
		}

		const result: ImageGenerationResponse = await response.json()

		if (result.error) {
			return {
				success: false,
				error: t("tools:generateImage.failedWithMessage", {
					message: result.error.message,
				}),
			}
		}

		// Extract the generated image from the response
		const images = result.choices?.[0]?.message?.images
		if (!images || images.length === 0) {
			return {
				success: false,
				error: t("tools:generateImage.noImageGenerated"),
			}
		}

		const imageData = images[0]?.image_url?.url
		if (!imageData) {
			return {
				success: false,
				error: t("tools:generateImage.invalidImageData"),
			}
		}

		const normalizedImage = await normalizeImageGenerationData(imageData)

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

/**
 * Generate an image using OpenAI's Images API (/v1/images/generations)
 * Supports BFL models (Flux) with provider-specific options for image editing
 */
export async function generateImageWithImagesApi(options: ImagesApiOptions): Promise<ImageGenerationResult> {
	const { baseURL, authToken, model, prompt, inputImage, outputFormat = "png" } = options

	try {
		const url = `${baseURL}/images/generations`

		// Build the request body
		// For BFL models, inputImage is passed via providerOptions.blackForestLabs.inputImage
		const requestBody: Record<string, unknown> = {
			model,
			prompt,
			n: 1,
		}

		// Add optional parameters
		if (options.size) {
			requestBody.size = options.size
		}
		if (options.quality) {
			requestBody.quality = options.quality
		}

		// For BFL (Black Forest Labs) models like flux-pro-1.1, use providerOptions
		if (model.startsWith("bfl/")) {
			requestBody.providerOptions = {
				blackForestLabs: {
					outputFormat: outputFormat,
					// inputImage: Base64 encoded image or URL of image to use as reference
					...(inputImage && { inputImage }),
				},
			}
		} else {
			// For other models, use standard output_format parameter
			requestBody.output_format = outputFormat
		}

		const fetchOptions: RequestInit = {
			method: "POST",
			headers: buildImageGenerationHeaders(authToken),
			body: JSON.stringify(requestBody),
		}

		const response = await fetch(url, fetchOptions)

		if (!response.ok) {
			const errorText = await response.text()
			let errorMessage = t("tools:generateImage.failedWithStatus", {
				status: response.status,
				statusText: response.statusText,
			})

			try {
				const errorJson = JSON.parse(errorText)
				if (errorJson.error?.message) {
					errorMessage = t("tools:generateImage.failedWithMessage", {
						message: errorJson.error.message,
					})
				}
			} catch {
				// Use default error message
			}
			return {
				success: false,
				error: errorMessage,
			}
		}

		const result: ImagesApiResponse = await response.json()

		if (result.error) {
			return {
				success: false,
				error: t("tools:generateImage.failedWithMessage", {
					message: result.error.message,
				}),
			}
		}

		// Extract the generated image from the response
		const images = result.data
		if (!images || images.length === 0) {
			return {
				success: false,
				error: t("tools:generateImage.noImageGenerated"),
			}
		}

		const imageItem = images[0]

		// Handle b64_json response (most common)
		if (imageItem?.b64_json) {
			// Convert base64 to data URL
			const dataUrl = `data:image/${outputFormat};base64,${imageItem.b64_json}`
			return {
				success: true,
				imageData: dataUrl,
				imageFormat: outputFormat,
			}
		}

		// Handle URL response (fallback)
		if (imageItem?.url) {
			const normalizedImage = await normalizeImageGenerationData(imageItem.url, outputFormat)
			return {
				success: true,
				...normalizedImage,
			}
		}

		return {
			success: false,
			error: t("tools:generateImage.invalidImageData"),
		}
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : t("tools:generateImage.unknownError"),
		}
	}
}

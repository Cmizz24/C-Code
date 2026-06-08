import path from "path"
import fs from "fs/promises"
import * as vscode from "vscode"
import {
	CLOUDFLARE_WORKERS_AI_PAID_OVERAGE_USD_PER_1000_NEURONS,
	GenerateImageParams,
	estimateCloudflareWorkersAiImageGenerationUsage,
	getCloudflareWorkersAiImageUsageSnapshot,
	type GeneratedImageMetadata,
	type ImageGenerationUsageDetails,
} from "@roo-code/types"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import {
	generateImageWithConfiguredProvider,
	resolveImageGenerationConfig,
} from "../../api/providers/utils/image-generation-provider"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

const SUPPORTED_OUTPUT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"])
const SUPPORTED_OUTPUT_FORMATS_DISPLAY = "PNG, JPG, JPEG, WEBP, GIF"
const getOutputFormatFromExtension = (extension: string): string | undefined =>
	extension ? extension.replace(/^\./, "").replace("jpg", "jpeg") : undefined

type ImageDimensions = { width: number; height: number }

const isPositiveFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value > 0

const getPositiveUsageNumber = (value: unknown): number | undefined =>
	isPositiveFiniteNumber(value) ? value : undefined

const readUInt24LE = (buffer: Buffer, offset: number): number =>
	buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16)

const getPngDimensions = (buffer: Buffer): ImageDimensions | undefined => {
	if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
		return undefined
	}

	const width = buffer.readUInt32BE(16)
	const height = buffer.readUInt32BE(20)
	return width > 0 && height > 0 ? { width, height } : undefined
}

const getGifDimensions = (buffer: Buffer): ImageDimensions | undefined => {
	if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "GIF") {
		return undefined
	}

	const width = buffer.readUInt16LE(6)
	const height = buffer.readUInt16LE(8)
	return width > 0 && height > 0 ? { width, height } : undefined
}

const getJpegDimensions = (buffer: Buffer): ImageDimensions | undefined => {
	if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
		return undefined
	}

	let offset = 2
	while (offset + 9 < buffer.length) {
		if (buffer[offset] !== 0xff) {
			offset++
			continue
		}

		const marker = buffer[offset + 1]
		const segmentLength = buffer.readUInt16BE(offset + 2)
		if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) {
			return undefined
		}

		const isStartOfFrame =
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf)

		if (isStartOfFrame) {
			const height = buffer.readUInt16BE(offset + 5)
			const width = buffer.readUInt16BE(offset + 7)
			return width > 0 && height > 0 ? { width, height } : undefined
		}

		offset += 2 + segmentLength
	}

	return undefined
}

const getWebpDimensions = (buffer: Buffer): ImageDimensions | undefined => {
	if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
		return undefined
	}

	const chunkType = buffer.toString("ascii", 12, 16)
	if (chunkType === "VP8X") {
		const width = readUInt24LE(buffer, 24) + 1
		const height = readUInt24LE(buffer, 27) + 1
		return width > 0 && height > 0 ? { width, height } : undefined
	}

	if (chunkType === "VP8 " && buffer.length >= 30) {
		const width = buffer.readUInt16LE(26) & 0x3fff
		const height = buffer.readUInt16LE(28) & 0x3fff
		return width > 0 && height > 0 ? { width, height } : undefined
	}

	if (chunkType === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
		const bits = buffer.readUInt32LE(21)
		const width = (bits & 0x3fff) + 1
		const height = ((bits >> 14) & 0x3fff) + 1
		return width > 0 && height > 0 ? { width, height } : undefined
	}

	return undefined
}

const getImageDimensions = (buffer: Buffer, imageFormat: string): ImageDimensions | undefined => {
	switch (imageFormat) {
		case "png":
			return getPngDimensions(buffer)
		case "jpg":
		case "jpeg":
			return getJpegDimensions(buffer)
		case "gif":
			return getGifDimensions(buffer)
		case "webp":
			return getWebpDimensions(buffer)
		default:
			return undefined
	}
}

const getEstimatedCloudflareCost = (neurons: number): number =>
	Math.round((neurons / 1_000) * CLOUDFLARE_WORKERS_AI_PAID_OVERAGE_USD_PER_1000_NEURONS * 1_000_000) / 1_000_000

export class GenerateImageTool extends BaseTool<"generate_image"> {
	readonly name = "generate_image" as const

	async execute(params: GenerateImageParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { prompt, path: relPath, image: inputImagePath } = params
		const { pushToolResult, askApproval, askApprovalWithResponse } = callbacks

		const provider = task.providerRef.deref()
		const state = await provider?.getState()

		if (!prompt) {
			task.consecutiveMistakeCount++
			task.recordToolError("generate_image")
			pushToolResult(await task.sayAndCreateMissingParamError("generate_image", "prompt"))
			return
		}

		if (!relPath) {
			task.consecutiveMistakeCount++
			task.recordToolError("generate_image")
			pushToolResult(await task.sayAndCreateMissingParamError("generate_image", "path"))
			return
		}

		const outputExtension = path.extname(relPath).toLowerCase()
		const requestedOutputFormat = getOutputFormatFromExtension(outputExtension)
		if (outputExtension && !SUPPORTED_OUTPUT_EXTENSIONS.has(outputExtension)) {
			const errorMessage = `Unsupported output file extension: ${outputExtension}. SVG output is not supported by image generation. Image generation can save ${SUPPORTED_OUTPUT_FORMATS_DISPLAY} files. Use a supported extension or omit the extension so Roo can choose one automatically.`
			await task.say("error", errorMessage)
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
		if (!accessAllowed) {
			await task.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		let inputImageData: string | undefined
		if (inputImagePath) {
			const inputImageFullPath = path.resolve(task.cwd, inputImagePath)

			const inputImageExists = await fileExistsAtPath(inputImageFullPath)
			if (!inputImageExists) {
				await task.say("error", `Input image not found: ${getReadablePath(task.cwd, inputImagePath)}`)
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(`Input image not found: ${getReadablePath(task.cwd, inputImagePath)}`),
				)
				return
			}

			const inputImageAccessAllowed = task.rooIgnoreController?.validateAccess(inputImagePath)
			if (!inputImageAccessAllowed) {
				await task.say("rooignore_error", inputImagePath)
				pushToolResult(formatResponse.rooIgnoreError(inputImagePath))
				return
			}

			try {
				const imageBuffer = await fs.readFile(inputImageFullPath)
				const imageExtension = path.extname(inputImageFullPath).toLowerCase().replace(".", "")

				const supportedFormats = ["png", "jpg", "jpeg", "gif", "webp"]
				if (!supportedFormats.includes(imageExtension)) {
					await task.say(
						"error",
						`Unsupported image format: ${imageExtension}. Supported formats: ${supportedFormats.join(", ")}`,
					)
					task.didToolFailInCurrentTurn = true
					pushToolResult(
						formatResponse.toolError(
							`Unsupported image format: ${imageExtension}. Supported formats: ${supportedFormats.join(", ")}`,
						),
					)
					return
				}

				const mimeType = imageExtension === "jpg" ? "jpeg" : imageExtension
				inputImageData = `data:image/${mimeType};base64,${imageBuffer.toString("base64")}`
			} catch (error) {
				await task.say(
					"error",
					`Failed to read input image: ${error instanceof Error ? error.message : "Unknown error"}`,
				)
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`Failed to read input image: ${error instanceof Error ? error.message : "Unknown error"}`,
					),
				)
				return
			}
		}

		const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

		const fullPath = path.resolve(task.cwd, relPath)
		const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)
		const readableOutputPath = getReadablePath(task.cwd, relPath)
		const readableInputImagePath = inputImagePath ? getReadablePath(task.cwd, inputImagePath) : undefined
		const resolvedConfig = resolveImageGenerationConfig(state)
		const providerMetadata: GeneratedImageMetadata = resolvedConfig.success
			? {
					provider: resolvedConfig.config.provider,
					providerLabel: resolvedConfig.config.providerLabel,
					baseURL: resolvedConfig.config.baseURL,
					model: resolvedConfig.config.model,
					apiMethod: resolvedConfig.config.apiMethod,
					isLocal: resolvedConfig.config.isLocal,
				}
			: {}
		const createImageGenerationMetadata = (overrides: GeneratedImageMetadata = {}): GeneratedImageMetadata => ({
			...providerMetadata,
			prompt,
			originalPrompt: prompt,
			path: readableOutputPath,
			...(readableInputImagePath && { inputImage: readableInputImagePath }),
			...overrides,
		})
		const updateImageGenerationStatus = async (
			metadata: GeneratedImageMetadata,
			options: { imageUri?: string; imagePath?: string } = {},
		) => {
			const toolPayload = {
				tool: "generateImage" as const,
				path: metadata.outputPath ?? metadata.path ?? readableOutputPath,
				content: metadata.prompt,
				imageGeneration: metadata,
				...(options.imageUri && { imageUri: options.imageUri }),
				...(options.imagePath && { imagePath: options.imagePath }),
			}

			if (typeof task.updateImageGenerationMessage === "function") {
				const didUpdate = await task.updateImageGenerationMessage({
					metadata,
					path: toolPayload.path,
					content: toolPayload.content,
					...options,
				})

				if (didUpdate) {
					return
				}
			}

			await task.say("tool", JSON.stringify(toolPayload))
		}

		const sharedMessageProps = {
			tool: "generateImage" as const,
			path: readableOutputPath,
			content: prompt,
			imageGeneration: createImageGenerationMetadata({ status: "pending" }),
			isOutsideWorkspace,
			isProtected: isWriteProtected,
		}
		let writeIntentRelPath: string | undefined
		let didAcquireWriteIntent = false

		try {
			task.consecutiveMistakeCount = 0

			if (!resolvedConfig.success) {
				await updateImageGenerationStatus(
					createImageGenerationMetadata({ status: "error", error: resolvedConfig.error }),
				)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(resolvedConfig.error))
				return
			}

			const approvalMessage = JSON.stringify({
				...sharedMessageProps,
				content: prompt,
				...(readableInputImagePath && { inputImage: readableInputImagePath }),
			})

			const approvalResponse = askApprovalWithResponse
				? await askApprovalWithResponse("tool", approvalMessage, undefined, isWriteProtected, {
						suppressApprovalFeedback: true,
					})
				: { approved: await askApproval("tool", approvalMessage, undefined, isWriteProtected) }

			if (!approvalResponse.approved) {
				return
			}

			const editedPrompt = approvalResponse.text?.trim()
			const promptForProvider = editedPrompt || prompt
			const promptMetadata = createImageGenerationMetadata({
				status: "running",
				prompt: promptForProvider,
				...(editedPrompt && editedPrompt !== prompt && { editedPrompt }),
			})

			await updateImageGenerationStatus(promptMetadata)

			const result = await generateImageWithConfiguredProvider({
				state,
				prompt: promptForProvider,
				inputImage: inputImageData,
				outputFormat: requestedOutputFormat,
			})

			if (!result.success) {
				const errorMessage = result.error || "Failed to generate image"
				await updateImageGenerationStatus(
					createImageGenerationMetadata({
						...result.metadata,
						status: "error",
						prompt: promptForProvider,
						...(editedPrompt && editedPrompt !== prompt && { editedPrompt }),
						error: errorMessage,
					}),
				)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			if (!result.imageData) {
				const errorMessage = "No image data received"
				await updateImageGenerationStatus(
					createImageGenerationMetadata({
						...result.metadata,
						status: "error",
						prompt: promptForProvider,
						...(editedPrompt && editedPrompt !== prompt && { editedPrompt }),
						error: errorMessage,
					}),
				)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const base64Match = result.imageData.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/)
			if (!base64Match) {
				const errorMessage = "Invalid image format received"
				await updateImageGenerationStatus(
					createImageGenerationMetadata({
						...result.metadata,
						status: "error",
						prompt: promptForProvider,
						...(editedPrompt && editedPrompt !== prompt && { editedPrompt }),
						error: errorMessage,
					}),
				)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const imageFormat = base64Match[1]
			const base64Data = base64Match[2]
			const imageBuffer = Buffer.from(base64Data, "base64")
			const imageDimensions = getImageDimensions(imageBuffer, imageFormat)

			let finalPath = relPath
			if (!finalPath.match(/\.(png|jpg|jpeg|webp|gif)$/i)) {
				finalPath = `${finalPath}.${imageFormat === "jpeg" ? "jpg" : imageFormat}`
			}

			let finalUsage = result.usage
			if (resolvedConfig.config.provider === "cloudflare" && resolvedConfig.config.apiMethod === "workers_ai") {
				const cloudflareUsage: ImageGenerationUsageDetails = { ...(result.usage ?? {}) }
				const providerNeurons = getPositiveUsageNumber(cloudflareUsage.neurons)
				const providerEstimatedNeurons = getPositiveUsageNumber(cloudflareUsage.estimatedNeurons)
				const hasProviderUsage = cloudflareUsage.usageSource === "provider_response"
				let usageUpdate:
					| {
							neurons: number
							source: "provider_response" | "local_estimate"
							includesLocalEstimate: boolean
					  }
					| undefined

				if (providerNeurons !== undefined || providerEstimatedNeurons !== undefined) {
					const neurons = providerNeurons ?? providerEstimatedNeurons!
					cloudflareUsage.usageSource = hasProviderUsage ? "provider_response" : "local_estimate"
					cloudflareUsage.currency = cloudflareUsage.currency ?? "USD"
					cloudflareUsage.estimatedCost = cloudflareUsage.estimatedCost ?? getEstimatedCloudflareCost(neurons)
					usageUpdate = {
						neurons,
						source: hasProviderUsage ? "provider_response" : "local_estimate",
						includesLocalEstimate: !hasProviderUsage,
					}
				} else {
					const estimate = estimateCloudflareWorkersAiImageGenerationUsage({
						model: resolvedConfig.config.model,
						imageWidth: imageDimensions?.width,
						imageHeight: imageDimensions?.height,
						hasInputImage: Boolean(inputImageData),
					})

					cloudflareUsage.estimatedNeurons = estimate.estimatedNeurons
					cloudflareUsage.estimatedCost = estimate.estimatedCost
					cloudflareUsage.currency = cloudflareUsage.currency ?? estimate.currency
					cloudflareUsage.usageSource = hasProviderUsage
						? "provider_response_with_local_quota"
						: "local_estimate"
					usageUpdate = {
						neurons: estimate.estimatedNeurons,
						source: "local_estimate",
						includesLocalEstimate: true,
					}
				}

				if (usageUpdate) {
					await provider?.updateCloudflareWorkersAiImageUsage?.({
						neurons: usageUpdate.neurons,
						source: usageUpdate.source,
					})

					const updatedState = await provider?.getState()
					const usageSnapshot = getCloudflareWorkersAiImageUsageSnapshot(
						updatedState?.cloudflareWorkersAiImageUsage,
					)

					cloudflareUsage.dailyQuotaNeurons = usageSnapshot.dailyQuotaNeurons
					cloudflareUsage.estimatedUsedNeuronsToday = usageSnapshot.neuronsUsed
					cloudflareUsage.estimatedRemainingNeurons = usageSnapshot.estimatedRemainingNeurons
					cloudflareUsage.quotaResetAt = usageSnapshot.resetAt
					if (hasProviderUsage || usageUpdate.source === "provider_response") {
						cloudflareUsage.usageSource = "provider_response_with_local_quota"
					} else if (usageUpdate.includesLocalEstimate) {
						cloudflareUsage.usageSource = "local_estimate"
					}
				}

				finalUsage = cloudflareUsage
			}

			const writePermission = task.requestAgentWriteIntent(finalPath)
			if (!writePermission.approved) {
				const reason = writePermission.reason ?? `Write denied for ${finalPath}`
				await updateImageGenerationStatus(
					createImageGenerationMetadata({
						...result.metadata,
						status: "error",
						prompt: promptForProvider,
						...(editedPrompt && editedPrompt !== prompt && { editedPrompt }),
						outputPath: getReadablePath(task.cwd, finalPath),
						imageFormat,
						...(imageDimensions && {
							imageWidth: imageDimensions.width,
							imageHeight: imageDimensions.height,
						}),
						usage: finalUsage,
						error: reason,
					}),
				)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(reason))
				return
			}

			writeIntentRelPath = finalPath
			didAcquireWriteIntent = true

			const absolutePath = path.resolve(task.cwd, finalPath)
			const directory = path.dirname(absolutePath)
			await fs.mkdir(directory, { recursive: true })

			await fs.writeFile(absolutePath, imageBuffer)

			if (finalPath) {
				await task.fileContextTracker.trackFileContext(finalPath, "roo_edited")
			}

			task.didEditFile = true

			task.recordToolUsage("generate_image")

			const fullImagePath = path.join(task.cwd, finalPath)

			let imageUri = provider?.convertToWebviewUri?.(fullImagePath) ?? vscode.Uri.file(fullImagePath).toString()

			const cacheBuster = Date.now()
			imageUri = imageUri.includes("?") ? `${imageUri}&t=${cacheBuster}` : `${imageUri}?t=${cacheBuster}`

			const completedMetadata = createImageGenerationMetadata({
				...result.metadata,
				status: "completed",
				prompt: promptForProvider,
				...(editedPrompt && editedPrompt !== prompt && { editedPrompt }),
				outputPath: getReadablePath(task.cwd, finalPath),
				imageFormat,
				...(imageDimensions && { imageWidth: imageDimensions.width, imageHeight: imageDimensions.height }),
				usage: finalUsage,
			})

			await updateImageGenerationStatus(completedMetadata, { imageUri, imagePath: fullImagePath })
			pushToolResult(formatResponse.toolResult(getReadablePath(task.cwd, finalPath)))
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			await updateImageGenerationStatus(
				createImageGenerationMetadata({
					status: "error",
					error: errorMessage,
				}),
			)
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError(`Error generating image: ${errorMessage}`))
		} finally {
			if (didAcquireWriteIntent && writeIntentRelPath) {
				task.releaseAgentWriteIntent(writeIntentRelPath)
			}
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"generate_image">): Promise<void> {
		return
	}
}

export const generateImageTool = new GenerateImageTool()

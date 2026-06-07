import path from "path"
import fs from "fs/promises"
import * as vscode from "vscode"
import { GenerateImageParams, type GeneratedImageMetadata } from "@roo-code/types"
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

export class GenerateImageTool extends BaseTool<"generate_image"> {
	readonly name = "generate_image" as const

	async execute(params: GenerateImageParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { prompt, path: relPath, image: inputImagePath } = params
		const { handleError, pushToolResult, askApproval, askApprovalWithResponse } = callbacks

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
		const sayImageGenerationStatus = async (metadata: GeneratedImageMetadata) => {
			await task.say(
				"tool",
				JSON.stringify({
					tool: "imageGenerated",
					path: metadata.outputPath ?? metadata.path ?? readableOutputPath,
					content: metadata.prompt,
					imageGeneration: metadata,
				}),
			)
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
				await sayImageGenerationStatus(
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

			await sayImageGenerationStatus(promptMetadata)

			const result = await generateImageWithConfiguredProvider({
				state,
				prompt: promptForProvider,
				inputImage: inputImageData,
				outputFormat: requestedOutputFormat,
			})

			if (!result.success) {
				const errorMessage = result.error || "Failed to generate image"
				await sayImageGenerationStatus(
					createImageGenerationMetadata({
						...result.metadata,
						status: "error",
						prompt: promptForProvider,
						...(editedPrompt && editedPrompt !== prompt && { editedPrompt }),
						error: errorMessage,
					}),
				)
				await task.say("error", errorMessage)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			if (!result.imageData) {
				const errorMessage = "No image data received"
				await sayImageGenerationStatus(
					createImageGenerationMetadata({
						...result.metadata,
						status: "error",
						prompt: promptForProvider,
						...(editedPrompt && editedPrompt !== prompt && { editedPrompt }),
						error: errorMessage,
					}),
				)
				await task.say("error", errorMessage)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const base64Match = result.imageData.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/)
			if (!base64Match) {
				const errorMessage = "Invalid image format received"
				await sayImageGenerationStatus(
					createImageGenerationMetadata({
						...result.metadata,
						status: "error",
						prompt: promptForProvider,
						...(editedPrompt && editedPrompt !== prompt && { editedPrompt }),
						error: errorMessage,
					}),
				)
				await task.say("error", errorMessage)
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const imageFormat = base64Match[1]
			const base64Data = base64Match[2]

			let finalPath = relPath
			if (!finalPath.match(/\.(png|jpg|jpeg|webp|gif)$/i)) {
				finalPath = `${finalPath}.${imageFormat === "jpeg" ? "jpg" : imageFormat}`
			}

			const writePermission = task.requestAgentWriteIntent(finalPath)
			if (!writePermission.approved) {
				const reason = writePermission.reason ?? `Write denied for ${finalPath}`
				await sayImageGenerationStatus(
					createImageGenerationMetadata({
						...result.metadata,
						status: "error",
						prompt: promptForProvider,
						...(editedPrompt && editedPrompt !== prompt && { editedPrompt }),
						outputPath: getReadablePath(task.cwd, finalPath),
						imageFormat,
						usage: result.usage,
						error: reason,
					}),
				)
				await task.say("error", reason)
				pushToolResult(formatResponse.toolError(reason))
				return
			}

			writeIntentRelPath = finalPath
			didAcquireWriteIntent = true

			const imageBuffer = Buffer.from(base64Data, "base64")

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
				usage: result.usage,
			})

			await sayImageGenerationStatus(completedMetadata)
			await task.say(
				"image",
				JSON.stringify({ imageUri, imagePath: fullImagePath, imageGeneration: completedMetadata }),
			)
			pushToolResult(formatResponse.toolResult(getReadablePath(task.cwd, finalPath)))
		} catch (error) {
			await sayImageGenerationStatus(
				createImageGenerationMetadata({
					status: "error",
					error: error instanceof Error ? error.message : "Unknown error",
				}),
			)
			await handleError("generating image", error as Error)
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

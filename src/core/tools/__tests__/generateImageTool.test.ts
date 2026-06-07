import { describe, it, expect, vi, beforeEach } from "vitest"
import { generateImageTool } from "../GenerateImageTool"
import { ToolUse } from "../../../shared/tools"
import { Task } from "../../task/Task"
import * as fs from "fs/promises"
import * as pathUtils from "../../../utils/pathUtils"
import * as fileUtils from "../../../utils/fs"
import { EXPERIMENT_IDS } from "../../../shared/experiments"
import {
	generateImageWithConfiguredProvider,
	resolveImageGenerationConfig,
} from "../../../api/providers/utils/image-generation-provider"

// Mock dependencies
vi.mock("fs/promises")
vi.mock("../../../utils/pathUtils")
vi.mock("../../../utils/fs")
vi.mock("../../../utils/safeWriteJson")
vi.mock("../../../api/providers/utils/image-generation-provider", () => ({
	generateImageWithConfiguredProvider: vi.fn(),
	resolveImageGenerationConfig: vi.fn(),
}))

describe("generateImageTool", () => {
	let mockCline: any
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any

	beforeEach(() => {
		vi.clearAllMocks()
		const providerMetadata = {
			provider: "openrouter",
			providerLabel: "OpenRouter",
			baseURL: "https://openrouter.ai/api/v1",
			model: "google/gemini-2.5-flash-image",
			apiMethod: "chat_completions",
			isLocal: false,
		} as const
		vi.mocked(resolveImageGenerationConfig).mockReturnValue({
			success: true,
			config: {
				...providerMetadata,
				authToken: "test-api-key",
				negativePrompt: undefined,
			},
		})
		vi.mocked(generateImageWithConfiguredProvider).mockResolvedValue({
			success: true,
			imageData: "data:image/png;base64,fakebase64data",
			imageFormat: "png",
			metadata: providerMetadata,
		})

		// Setup mock Cline instance
		mockCline = {
			cwd: "/test/workspace",
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			recordToolUsage: vi.fn(),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			say: vi.fn(),
			updateImageGenerationMessage: vi.fn().mockResolvedValue(true),
			rooIgnoreController: {
				validateAccess: vi.fn().mockReturnValue(true),
			},
			rooProtectedController: {
				isWriteProtected: vi.fn().mockReturnValue(false),
			},
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi.fn().mockResolvedValue({
						experiments: {
							[EXPERIMENT_IDS.IMAGE_GENERATION]: true,
						},
						openRouterImageApiKey: "test-api-key",
						openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
					}),
				}),
			},
			fileContextTracker: {
				trackFileContext: vi.fn(),
			},
			requestAgentWriteIntent: vi.fn().mockReturnValue({ approved: true }),
			releaseAgentWriteIntent: vi.fn(),
			didEditFile: false,
		}

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()

		// Mock file system operations
		vi.mocked(fileUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("fake-image-data"))
		vi.mocked(fs.mkdir).mockResolvedValue(undefined)
		vi.mocked(fs.writeFile).mockResolvedValue(undefined)
		vi.mocked(pathUtils.isPathOutsideWorkspace).mockReturnValue(false)
	})

	describe("partial block handling", () => {
		it("should return early when block is partial", async () => {
			const partialBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: true,
			}

			await generateImageTool.handle(mockCline as Task, partialBlock as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			// Should not process anything when partial
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalled()
			expect(mockCline.say).not.toHaveBeenCalled()
		})

		it("should return early when block is partial even with image parameter", async () => {
			const partialBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Upscale this image",
					path: "upscaled-image.png",
					image: "source-image.png",
				},
				nativeArgs: {
					prompt: "Upscale this image",
					path: "upscaled-image.png",
					image: "source-image.png",
				},
				partial: true,
			}

			await generateImageTool.handle(mockCline as Task, partialBlock as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			// Should not process anything when partial
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalled()
			expect(mockCline.say).not.toHaveBeenCalled()
			expect(fs.readFile).not.toHaveBeenCalled()
		})

		it("should process when block is not partial", async () => {
			const completeBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, completeBlock as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			// Should process the complete block
			expect(mockAskApproval).toHaveBeenCalled()
			expect(generateImageWithConfiguredProvider).toHaveBeenCalledWith({
				state: expect.objectContaining({
					openRouterImageApiKey: "test-api-key",
					openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
				}),
				prompt: "Generate a test image",
				inputImage: undefined,
				outputFormat: "png",
			})
			expect(mockCline.requestAgentWriteIntent).toHaveBeenCalledWith("test-image.png")
			expect(mockCline.releaseAgentWriteIntent).toHaveBeenCalledWith("test-image.png")
			expect(mockCline.updateImageGenerationMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					metadata: expect.objectContaining({ status: "running" }),
				}),
			)
			expect(mockCline.updateImageGenerationMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					metadata: expect.objectContaining({ status: "completed" }),
					imageUri: expect.stringMatching(/\?t=\d+$/),
				}),
			)
			expect(mockCline.say).not.toHaveBeenCalledWith("tool", expect.anything())
			expect(mockCline.say).not.toHaveBeenCalledWith("image", expect.anything())
			expect(mockPushToolResult).toHaveBeenCalled()
		})

		it("should not write image when agent write intent is rejected for mustNotTouch", async () => {
			mockCline.requestAgentWriteIntent.mockReturnValue({
				approved: false,
				reason: "test-image.png is listed in mustNotTouch for agent-a.",
			})

			const completeBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, completeBlock as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(mockCline.updateImageGenerationMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					metadata: expect.objectContaining({
						status: "error",
						error: "test-image.png is listed in mustNotTouch for agent-a.",
					}),
				}),
			)
			expect(mockCline.say).not.toHaveBeenCalledWith(
				"error",
				"test-image.png is listed in mustNotTouch for agent-a.",
			)
			expect(fs.writeFile).not.toHaveBeenCalled()
			expect(mockCline.releaseAgentWriteIntent).not.toHaveBeenCalled()
		})

		it("should add cache-busting parameter to image URI", async () => {
			const completeBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			// Mock convertToWebviewUri to return a test URI
			const mockWebviewUri = "https://file+.vscode-resource.vscode-cdn.net/test/workspace/test-image.png"
			mockCline.providerRef.deref().convertToWebviewUri = vi.fn().mockReturnValue(mockWebviewUri)

			await generateImageTool.handle(mockCline as Task, completeBlock as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			const completedUpdate = mockCline.updateImageGenerationMessage.mock.calls
				.map(([payload]: any[]) => payload)
				.find((payload: any) => payload.metadata.status === "completed")

			expect(completedUpdate).toBeDefined()
			expect(completedUpdate.imageUri).toMatch(/\?t=\d+$/)
			// Handle both Unix and Windows path separators
			const expectedPath =
				process.platform === "win32" ? "\\test\\workspace\\test-image.png" : "/test/workspace/test-image.png"
			expect(completedUpdate.imagePath).toBe(expectedPath)
			expect(completedUpdate.metadata).toEqual(
				expect.objectContaining({
					status: "completed",
					outputPath: expect.stringContaining("test-image.png"),
				}),
			)
			expect(mockCline.say).not.toHaveBeenCalledWith("image", expect.anything())
		})

		it("should send edited approval prompt to the configured provider and emitted metadata", async () => {
			const mockAskApprovalWithResponse = vi.fn().mockResolvedValue({
				approved: true,
				text: "Use the edited prompt",
			})
			const completeBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, completeBlock as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				askApprovalWithResponse: mockAskApprovalWithResponse,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(generateImageWithConfiguredProvider).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: "Use the edited prompt",
				}),
			)

			const updatePayloads = mockCline.updateImageGenerationMessage.mock.calls.map(([payload]: any[]) => payload)

			expect(updatePayloads).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						metadata: expect.objectContaining({
							status: "running",
							prompt: "Use the edited prompt",
							originalPrompt: "Generate a test image",
							editedPrompt: "Use the edited prompt",
						}),
					}),
				]),
			)
			expect(updatePayloads).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						imageUri: expect.stringMatching(/\?t=\d+$/),
						imagePath: expect.any(String),
						metadata: expect.objectContaining({
							status: "completed",
							prompt: "Use the edited prompt",
							originalPrompt: "Generate a test image",
							editedPrompt: "Use the edited prompt",
						}),
					}),
				]),
			)
			expect(mockCline.say).not.toHaveBeenCalledWith("tool", expect.anything())
			expect(mockCline.say).not.toHaveBeenCalledWith("image", expect.anything())
		})

		it("should render provider failures through the unified image-generation update without duplicate generic errors", async () => {
			vi.mocked(generateImageWithConfiguredProvider).mockResolvedValueOnce({
				success: false,
				error: "Provider failed",
				metadata: {
					provider: "openrouter",
					providerLabel: "OpenRouter",
					model: "google/gemini-2.5-flash-image",
				},
			})

			const completeBlock: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, completeBlock as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(mockCline.updateImageGenerationMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					metadata: expect.objectContaining({
						status: "error",
						error: "Provider failed",
					}),
				}),
			)
			expect(mockCline.say).not.toHaveBeenCalledWith("error", expect.stringContaining("Provider failed"))
			expect(mockHandleError).not.toHaveBeenCalled()
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Provider failed"))
		})
	})

	describe("missing parameters", () => {
		it("should handle missing prompt parameter", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					path: "test-image.png",
				},
				nativeArgs: {
					path: "test-image.png",
				} as any,
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("generate_image")
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("generate_image", "prompt")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
		})

		it("should handle missing path parameter", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
				},
				nativeArgs: {
					prompt: "Generate a test image",
				} as any,
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("generate_image")
			expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("generate_image", "path")
			expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
		})
	})

	describe("output path validation", () => {
		it("should reject unsupported output extensions before requesting approval", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.svg",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.svg",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(mockCline.say).toHaveBeenCalledWith(
				"error",
				expect.stringContaining("Unsupported output file extension: .svg"),
			)
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("SVG"))
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(generateImageWithConfiguredProvider).not.toHaveBeenCalled()
			expect(fs.writeFile).not.toHaveBeenCalled()
		})

		it("should pass jpeg output format for jpg output paths", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.jpg",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.jpg",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(generateImageWithConfiguredProvider).toHaveBeenCalledWith(
				expect.objectContaining({
					outputFormat: "jpeg",
				}),
			)
			expect(mockCline.requestAgentWriteIntent).toHaveBeenCalledWith("test-image.jpg")
		})

		it("should omit provider output format when the output path has no extension", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(generateImageWithConfiguredProvider).toHaveBeenCalledWith(
				expect.objectContaining({
					outputFormat: undefined,
				}),
			)
			expect(mockCline.requestAgentWriteIntent).toHaveBeenCalledWith("test-image.png")
		})
	})

	describe("legacy experiment flag", () => {
		it("should process image generation when the legacy experiment flag is disabled", async () => {
			mockCline.providerRef.deref().getState.mockResolvedValue({
				experiments: {
					[EXPERIMENT_IDS.IMAGE_GENERATION]: false,
				},
				openRouterImageApiKey: "test-api-key",
				openRouterImageGenerationSelectedModel: "google/gemini-2.5-flash-image",
			})

			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(mockAskApproval).toHaveBeenCalled()
			expect(generateImageWithConfiguredProvider).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: "Generate a test image",
				}),
			)
			expect(mockPushToolResult).toHaveBeenCalled()
		})

		it("should emit an error status when image generation settings cannot be resolved", async () => {
			mockCline.updateImageGenerationMessage.mockResolvedValueOnce(false)
			vi.mocked(resolveImageGenerationConfig).mockReturnValue({
				success: false,
				error: "tools:generateImage.apiKeyRequired(provider=OpenRouter)",
			})
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				nativeArgs: {
					prompt: "Generate a test image",
					path: "test-image.png",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(generateImageWithConfiguredProvider).not.toHaveBeenCalled()
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("tools:generateImage.apiKeyRequired(provider=OpenRouter)"),
			)

			const toolStatusPayloads = mockCline.say.mock.calls
				.filter((call: any[]) => call[0] === "tool")
				.map((call: any[]) => JSON.parse(call[1]))

			expect(toolStatusPayloads).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						tool: "generateImage",
						imageGeneration: expect.objectContaining({
							status: "error",
							error: "tools:generateImage.apiKeyRequired(provider=OpenRouter)",
						}),
					}),
				]),
			)
		})
	})

	describe("input image validation", () => {
		it("should pass supported input image data to the configured provider", async () => {
			const inputBuffer = Buffer.from("source-image-data")
			vi.mocked(fs.readFile).mockResolvedValue(inputBuffer)

			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Upscale this image",
					path: "upscaled.png",
					image: "source.png",
				},
				nativeArgs: {
					prompt: "Upscale this image",
					path: "upscaled.png",
					image: "source.png",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(generateImageWithConfiguredProvider).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: "Upscale this image",
					inputImage: `data:image/png;base64,${inputBuffer.toString("base64")}`,
					outputFormat: "png",
				}),
			)
		})

		it("should handle non-existent input image", async () => {
			vi.mocked(fileUtils.fileExistsAtPath).mockResolvedValue(false)

			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Upscale this image",
					path: "upscaled.png",
					image: "non-existent.png",
				},
				nativeArgs: {
					prompt: "Upscale this image",
					path: "upscaled.png",
					image: "non-existent.png",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("Input image not found"))
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Input image not found"))
		})

		it("should handle unsupported image format", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "generate_image",
				params: {
					prompt: "Upscale this image",
					path: "upscaled.png",
					image: "test.bmp", // Unsupported format
				},
				nativeArgs: {
					prompt: "Upscale this image",
					path: "upscaled.png",
					image: "test.bmp",
				},
				partial: false,
			}

			await generateImageTool.handle(mockCline as Task, block as ToolUse<"generate_image">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("Unsupported image format"))
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Unsupported image format"))
		})
	})
})

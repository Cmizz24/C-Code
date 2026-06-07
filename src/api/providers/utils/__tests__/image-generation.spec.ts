import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
	generateImageWithAutomatic1111,
	generateImageWithComfyUi,
	generateImageWithImagesApi,
	generateImageWithProvider,
	normalizeImageGenerationData,
} from "../image-generation"

// Mock the i18n module
vi.mock("../../../../i18n", () => ({
	t: (key: string, options?: any) => {
		// Return a sensible mock for i18n
		if (key === "tools:generateImage.failedWithMessage" && options?.message) {
			return options.message
		}
		return key
	},
}))

// Mock fetch globally
global.fetch = vi.fn()
global.FormData = vi.fn(() => ({
	append: vi.fn(),
})) as any
global.Blob = vi.fn() as any
global.atob = vi.fn((str: string) => {
	return Buffer.from(str, "base64").toString("binary")
})

const ONE_BY_ONE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

describe("normalizeImageGenerationData", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("should return data URLs without fetching", async () => {
		const result = await normalizeImageGenerationData("data:image/webp;base64,ZmFrZQ==")

		expect(result).toEqual({
			imageData: "data:image/webp;base64,ZmFrZQ==",
			imageFormat: "webp",
		})
		expect(global.fetch).not.toHaveBeenCalled()
	})

	it("should fetch external URLs and convert them to data URLs", async () => {
		const imageBuffer = Buffer.from("external image data")
		vi.mocked(global.fetch).mockResolvedValue({
			ok: true,
			headers: {
				get: vi.fn().mockReturnValue("image/jpeg"),
			},
			arrayBuffer: vi
				.fn()
				.mockResolvedValue(
					imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength),
				),
		} as any)

		const result = await normalizeImageGenerationData("https://example.com/generated-image.png")

		expect(result).toEqual({
			imageData: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
			imageFormat: "jpeg",
		})
		expect(global.fetch).toHaveBeenCalledWith("https://example.com/generated-image.png")
	})

	it("should fall back to the URL extension when content type is not an image", async () => {
		const imageBuffer = Buffer.from("webp image data")
		vi.mocked(global.fetch).mockResolvedValue({
			ok: true,
			headers: {
				get: vi.fn().mockReturnValue("application/octet-stream"),
			},
			arrayBuffer: vi
				.fn()
				.mockResolvedValue(
					imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength),
				),
		} as any)

		const result = await normalizeImageGenerationData("https://example.com/generated-image.webp")

		expect(result).toEqual({
			imageData: `data:image/webp;base64,${imageBuffer.toString("base64")}`,
			imageFormat: "webp",
		})
	})

	it("should reject unsupported image data", async () => {
		await expect(normalizeImageGenerationData("not-an-image")).rejects.toThrow(
			"tools:generateImage.invalidImageFormat",
		)
	})
})

describe("generateImageWithImagesApi", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("image generation (text-to-image)", () => {
		it("should successfully generate an image", async () => {
			const mockBase64 = Buffer.from("fake image data").toString("base64")
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: [{ b64_json: mockBase64 }],
				}),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "A cute cat",
				outputFormat: "png",
			})

			expect(result.success).toBe(true)
			expect(result.imageData).toContain("data:image/png;base64,")
			expect(result.imageFormat).toBe("png")

			// Verify fetch was called with correct parameters
			expect(global.fetch).toHaveBeenCalledWith(
				"https://api.example.com/v1/images/generations",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						Authorization: "Bearer test-token",
						"Content-Type": "application/json",
					}),
				}),
			)
		})

		it("should handle API errors gracefully", async () => {
			const mockResponse = {
				ok: false,
				status: 400,
				statusText: "Bad Request",
				text: vi.fn().mockResolvedValue("{}"),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "A cute cat",
			})

			expect(result.success).toBe(false)
			expect(result.error).toBeDefined()
		})

		it("should return an actionable error for empty successful provider responses", async () => {
			vi.mocked(global.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				statusText: "OK",
				headers: {
					get: vi.fn((header: string) =>
						header.toLowerCase() === "content-type" ? "application/json" : null,
					),
				},
				text: vi.fn().mockResolvedValue(""),
			} as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://compatible.example/v1",
				model: "custom-image-model",
				prompt: "A cute cat",
				provider: "openai",
			})

			expect(result.success).toBe(false)
			expect(result.error).toContain("empty response")
			expect(result.error).toContain("API method")
			expect(result.error).toContain("configured image generation provider")
			expect(result.error).toContain("vision/image-understanding models can analyze images")
			expect(result.error).toContain("provider=openai")
			expect(result.error).toContain("apiMethod=images_api")
			expect(result.error).toContain("endpoint=/v1/images/generations")
			expect(result.error).toContain("status=200 OK")
			expect(result.error).toContain("contentType=application/json")
			expect(result.error).toContain("bodyByteLength=0")
			expect(result.error).toContain("streaming=false")
			expect(result.error).toContain("model=custom-image-model")
			expect(result.error).not.toContain("A cute cat")
			expect(result.error).not.toContain("Ollama")
			expect(result.error).not.toContain("Unexpected end of JSON input")
		})

		it("should explain empty NDJSON Images API responses with generic image-generation guidance", async () => {
			vi.mocked(global.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				statusText: "OK",
				headers: {
					get: vi.fn((header: string) =>
						header.toLowerCase() === "content-type" ? "application/x-ndjson" : null,
					),
				},
				text: vi.fn().mockResolvedValue(""),
			} as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://compatible.example/v1",
				model: "custom-image-model",
				prompt: "A private prompt that must not be logged",
				provider: "openai",
			})

			expect(result.success).toBe(false)
			expect(result.error).toContain("empty response")
			expect(result.error).toContain("support text-to-image or image-edit generation")
			expect(result.error).toContain("vision/image-understanding models can analyze images")
			expect(result.error).toContain("provider=openai")
			expect(result.error).toContain("apiMethod=images_api")
			expect(result.error).toContain("endpoint=/v1/images/generations")
			expect(result.error).toContain("status=200 OK")
			expect(result.error).toContain("contentType=application/x-ndjson")
			expect(result.error).toContain("bodyByteLength=0")
			expect(result.error).toContain("streaming=true")
			expect(result.error).toContain("topLevelKeys=none")
			expect(result.error).toContain("eventKeys=none")
			expect(result.error).toContain("model=custom-image-model")
			expect(result.error).not.toContain("Ollama")
			expect(result.error).not.toContain("private prompt")
		})

		it("should return an actionable error for non-JSON successful provider responses", async () => {
			vi.mocked(global.fetch).mockResolvedValue({
				ok: true,
				text: vi.fn().mockResolvedValue("not json"),
			} as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "A cute cat",
			})

			expect(result.success).toBe(false)
			expect(result.error).toContain("non-JSON response")
			expect(result.error).toContain("provider")
			expect(result.error).not.toContain("Unexpected end of JSON input")
		})

		it("should return an actionable error for non-JSON provider error bodies", async () => {
			vi.mocked(global.fetch).mockResolvedValue({
				ok: false,
				status: 404,
				statusText: "Not Found",
				text: vi.fn().mockResolvedValue("not found"),
			} as any)

			const result = await generateImageWithImagesApi({
				baseURL: "http://localhost:1234/v1",
				model: "local-model",
				prompt: "A cute cat",
			})

			expect(result.success).toBe(false)
			expect(result.error).toContain("non-JSON error response")
			expect(result.error).toContain("404 Not Found")
			expect(result.error).toContain("API method")
			expect(result.error).not.toContain("not found")
		})

		it("should handle missing image data in response", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: [{}], // Missing b64_json and url
				}),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "A cute cat",
			})

			expect(result.success).toBe(false)
			expect(result.error).toBeDefined()
		})

		it("should handle URL response instead of b64_json", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: [{ url: "data:image/png;base64,iVBORw0KGgo=" }],
				}),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "A cute cat",
			})

			expect(result.success).toBe(true)
			expect(result.imageData).toBe("data:image/png;base64,iVBORw0KGgo=")
			expect(result.imageFormat).toBe("png")
		})

		it("should handle external URL response", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: [{ url: "https://example.com/generated-image.png" }],
				}),
			}
			const imageBuffer = Buffer.from("downloaded image data")
			const mockImageResponse = {
				ok: true,
				headers: {
					get: vi.fn().mockReturnValue("image/png"),
				},
				arrayBuffer: vi
					.fn()
					.mockResolvedValue(
						imageBuffer.buffer.slice(
							imageBuffer.byteOffset,
							imageBuffer.byteOffset + imageBuffer.byteLength,
						),
					),
			}

			vi.mocked(global.fetch)
				.mockResolvedValueOnce(mockResponse as any)
				.mockResolvedValueOnce(mockImageResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "A cute cat",
				outputFormat: "png",
			})

			expect(result.success).toBe(true)
			expect(result.imageData).toBe(`data:image/png;base64,${imageBuffer.toString("base64")}`)
			expect(result.imageFormat).toBe("png")
			expect(global.fetch).toHaveBeenNthCalledWith(2, "https://example.com/generated-image.png")
		})

		it("should handle empty data array in response", async () => {
			const responseText = JSON.stringify({ data: [] })
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
				headers: {
					get: vi.fn((header: string) =>
						header.toLowerCase() === "content-type" ? "application/json" : null,
					),
				},
				text: vi.fn().mockResolvedValue(responseText),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "A cute cat",
			})

			expect(result.success).toBe(false)
			expect(result.error).toContain("did not include extractable image data")
			expect(result.error).toContain("apiMethod=images_api")
			expect(result.error).toContain(`bodyByteLength=${Buffer.byteLength(responseText, "utf8")}`)
			expect(result.error).toContain("topLevelKeys=data")
			expect(result.error).toContain("eventKeys=none")
		})

		it("should handle API error response", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					error: {
						message: "Rate limit exceeded",
						type: "rate_limit_error",
					},
				}),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "A cute cat",
			})

			expect(result.success).toBe(false)
			expect(result.error).toBeDefined()
		})

		it("should include optional parameters when provided", async () => {
			const mockBase64 = Buffer.from("fake image data").toString("base64")
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: [{ b64_json: mockBase64 }],
				}),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "A cute cat",
				size: "1024x1024",
				quality: "hd",
				outputFormat: "png",
			})

			expect(result.success).toBe(true)

			// Verify fetch was called with optional parameters
			const callArgs = vi.mocked(global.fetch).mock.calls[0]
			const body = JSON.parse(callArgs[1]?.body as string)
			expect(body.size).toBe("1024x1024")
			expect(body.quality).toBe("hd")
		})

		it("should send standard Images API request options for OpenAI-compatible providers", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: [{ b64_json: ONE_BY_ONE_PNG_BASE64 }],
				}),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://compatible.example/v1",
				model: "custom-image-model",
				prompt: "A cute cat",
				size: "1024x1024",
				quality: "hd",
				outputFormat: "webp",
				provider: "openai",
			})

			expect(result).toEqual({
				success: true,
				imageData: `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`,
				imageFormat: "png",
			})

			const callArgs = vi.mocked(global.fetch).mock.calls[0]
			const body = JSON.parse(callArgs[1]?.body as string)
			expect(body).toEqual({
				model: "custom-image-model",
				prompt: "A cute cat",
				n: 1,
				size: "1024x1024",
				quality: "hd",
				output_format: "webp",
			})
			expect(body).not.toHaveProperty("response_format")
		})

		it("should use DALL-E response_format instead of GPT image output_format", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: [{ b64_json: ONE_BY_ONE_PNG_BASE64 }],
				}),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.openai.com/v1",
				authToken: "test-token",
				model: "dall-e-3",
				prompt: "A cute cat",
				outputFormat: "webp",
				provider: "openai",
			})

			expect(result.success).toBe(true)
			const callArgs = vi.mocked(global.fetch).mock.calls[0]
			expect(callArgs[0]).toBe("https://api.openai.com/v1/images/generations")
			const body = JSON.parse(callArgs[1]?.body as string)
			expect(body).toEqual({
				model: "dall-e-3",
				prompt: "A cute cat",
				n: 1,
				response_format: "b64_json",
			})
			expect(body).not.toHaveProperty("output_format")
		})

		it("should omit optional Images API size and quality when none is configured", async () => {
			vi.mocked(global.fetch).mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: [{ b64_json: ONE_BY_ONE_PNG_BASE64 }],
				}),
			} as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://compatible.example/v1",
				model: "custom-image-model",
				prompt: "A cute cat",
				provider: "openai",
			})

			expect(result.success).toBe(true)

			const callArgs = vi.mocked(global.fetch).mock.calls[0]
			const body = JSON.parse(callArgs[1]?.body as string)
			expect(body).toEqual({
				model: "custom-image-model",
				prompt: "A cute cat",
				n: 1,
				output_format: "png",
			})
			expect(body).not.toHaveProperty("size")
			expect(body).not.toHaveProperty("quality")
		})

		it("should extract OpenAI-compatible top-level base64 image arrays", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					images: [ONE_BY_ONE_PNG_BASE64],
				}),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://compatible.example/v1",
				model: "custom-image-model",
				prompt: "A cute cat",
				provider: "openai",
			})

			expect(result).toEqual({
				success: true,
				imageData: `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`,
				imageFormat: "png",
			})
		})

		it("should extract OpenAI-compatible top-level singular image responses", async () => {
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					model: "custom-image-model",
					image: ONE_BY_ONE_PNG_BASE64,
					done: true,
				}),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://compatible.example/v1",
				model: "custom-image-model",
				prompt: "A cute cat",
				provider: "openai",
			})

			expect(result).toEqual({
				success: true,
				imageData: `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`,
				imageFormat: "png",
			})
		})

		it("should extract OpenAI-compatible NDJSON final image events", async () => {
			vi.mocked(global.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				statusText: "OK",
				headers: {
					get: vi.fn((header: string) =>
						header.toLowerCase() === "content-type" ? "application/x-ndjson" : null,
					),
				},
				text: vi
					.fn()
					.mockResolvedValue(
						[
							JSON.stringify({ model: "custom-image-model", response: "", done: false }),
							JSON.stringify({ model: "custom-image-model", image: ONE_BY_ONE_PNG_BASE64, done: true }),
						].join("\n"),
					),
			} as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://compatible.example/v1",
				model: "custom-image-model",
				prompt: "A cute cat",
				provider: "openai",
			})

			expect(result).toEqual({
				success: true,
				imageData: `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`,
				imageFormat: "png",
			})
		})

		it("should handle binary image responses", async () => {
			const imageBuffer = Buffer.from("binary image data")
			vi.mocked(global.fetch).mockResolvedValue({
				ok: true,
				headers: {
					get: vi.fn((header: string) => (header.toLowerCase() === "content-type" ? "image/png" : null)),
				},
				arrayBuffer: vi
					.fn()
					.mockResolvedValue(
						imageBuffer.buffer.slice(
							imageBuffer.byteOffset,
							imageBuffer.byteOffset + imageBuffer.byteLength,
						),
					),
			} as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://compatible.example/v1",
				model: "custom-image-model",
				prompt: "A cute cat",
				provider: "openai",
			})

			expect(result).toEqual({
				success: true,
				imageData: `data:image/png;base64,${imageBuffer.toString("base64")}`,
				imageFormat: "png",
			})
		})

		it("should handle network errors", async () => {
			vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"))

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "A cute cat",
			})

			expect(result.success).toBe(false)
			expect(result.error).toContain("Network error")
		})
	})

	describe("image editing", () => {
		it("should use /images/edits endpoint with multipart input image for OpenAI-compatible edits", async () => {
			const mockBase64 = Buffer.from("fake image data").toString("base64")
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: [{ b64_json: mockBase64 }],
				}),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const inputImageDataUrl = `data:image/png;base64,${mockBase64}`

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "Make it blue",
				inputImage: inputImageDataUrl,
				outputFormat: "png",
			})

			expect(result.success).toBe(true)

			const [callUrl, callOptions] = vi.mocked(global.fetch).mock.calls[0]
			expect(callUrl).toBe("https://api.example.com/v1/images/edits")
			expect(callOptions?.headers).toEqual(
				expect.objectContaining({
					Authorization: "Bearer test-token",
				}),
			)
			expect(callOptions?.headers).not.toHaveProperty("Content-Type")

			const formData = callOptions?.body as unknown as { append: ReturnType<typeof vi.fn> }
			expect(formData.append).toHaveBeenCalledWith("model", "gpt-image-1")
			expect(formData.append).toHaveBeenCalledWith("prompt", "Make it blue")
			expect(formData.append).toHaveBeenCalledWith("n", "1")
			expect(formData.append).toHaveBeenCalledWith("output_format", "png")
			expect(formData.append).not.toHaveBeenCalledWith("response_format", expect.anything())
			expect(global.Blob).toHaveBeenCalledWith([expect.any(ArrayBuffer)], { type: "image/png" })
			expect(formData.append).toHaveBeenCalledWith("image", expect.any(Object), "input.png")
		})

		it("should keep provider-specific BFL edits on /images/generations with providerOptions", async () => {
			vi.mocked(global.fetch).mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: [{ b64_json: ONE_BY_ONE_PNG_BASE64 }],
				}),
			} as any)

			const inputImageDataUrl = `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`

			const result = await generateImageWithImagesApi({
				baseURL: "https://openrouter.ai/api/v1",
				authToken: "test-token",
				model: "bfl/flux-kontext-pro",
				prompt: "Make it blue",
				inputImage: inputImageDataUrl,
				outputFormat: "jpeg",
				provider: "openrouter",
			})

			expect(result.success).toBe(true)
			const [callUrl, callOptions] = vi.mocked(global.fetch).mock.calls[0]
			expect(callUrl).toBe("https://openrouter.ai/api/v1/images/generations")
			expect(callOptions?.headers).toEqual(
				expect.objectContaining({
					Authorization: "Bearer test-token",
					"Content-Type": "application/json",
				}),
			)

			const body = JSON.parse(callOptions?.body as string)
			expect(body).toEqual({
				model: "bfl/flux-kontext-pro",
				prompt: "Make it blue",
				n: 1,
				providerOptions: {
					blackForestLabs: {
						outputFormat: "jpeg",
						inputImage: inputImageDataUrl,
					},
				},
			})
		})

		it("should handle edit operation errors", async () => {
			const mockResponse = {
				ok: false,
				status: 400,
				statusText: "Bad Request",
				text: vi.fn().mockResolvedValue("{}"),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const inputImageDataUrl =
				"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "Make it blue",
				inputImage: inputImageDataUrl,
			})

			expect(result.success).toBe(false)
			expect(result.error).toBeDefined()
		})
	})

	describe("output format handling", () => {
		it("should use png format by default", async () => {
			const mockBase64 = Buffer.from("fake image data").toString("base64")
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: [{ b64_json: mockBase64 }],
				}),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "A cute cat",
			})

			expect(result.imageFormat).toBe("png")
			expect(result.imageData).toContain("data:image/png;base64,")
		})

		it("should use specified output format", async () => {
			const mockBase64 = Buffer.from("fake image data").toString("base64")
			const mockResponse = {
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: [{ b64_json: mockBase64 }],
				}),
			}

			vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

			const result = await generateImageWithImagesApi({
				baseURL: "https://api.example.com/v1",
				authToken: "test-token",
				model: "gpt-image-1",
				prompt: "A cute cat",
				outputFormat: "jpeg",
			})

			expect(result.imageFormat).toBe("jpeg")
			expect(result.imageData).toContain("data:image/jpeg;base64,")
		})
	})
})

describe("generateImageWithAutomatic1111", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("should generate an image through /sdapi/v1/txt2img", async () => {
		vi.mocked(global.fetch).mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				images: [ONE_BY_ONE_PNG_BASE64],
			}),
		} as any)

		const result = await generateImageWithAutomatic1111({
			baseURL: "http://127.0.0.1:7860",
			authToken: "local-proxy-token",
			model: "dreamshaper.safetensors",
			prompt: "A cute cat",
			negativePrompt: "blurry",
		})

		expect(result).toEqual({
			success: true,
			imageData: `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`,
			imageFormat: "png",
		})

		expect(global.fetch).toHaveBeenCalledWith(
			"http://127.0.0.1:7860/sdapi/v1/txt2img",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer local-proxy-token",
					"Content-Type": "application/json",
				}),
			}),
		)

		const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]?.body as string)
		expect(body).toMatchObject({
			prompt: "A cute cat",
			negative_prompt: "blurry",
			width: 1024,
			height: 1024,
			batch_size: 1,
			n_iter: 1,
			steps: 20,
			cfg_scale: 7,
			sampler_name: "Euler",
			save_images: false,
			override_settings: {
				sd_model_checkpoint: "dreamshaper.safetensors",
			},
		})
	})

	it("should leave the currently loaded checkpoint when no model override is provided", async () => {
		vi.mocked(global.fetch).mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				images: [ONE_BY_ONE_PNG_BASE64],
			}),
		} as any)

		const result = await generateImageWithAutomatic1111({
			baseURL: "http://127.0.0.1:7860",
			prompt: "A cute cat",
		})

		expect(result.success).toBe(true)
		const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]?.body as string)
		expect(body).not.toHaveProperty("override_settings")
		expect(body.negative_prompt).toBe("")
	})

	it("should reject input images because the local helper is text-to-image only", async () => {
		const result = await generateImageWithAutomatic1111({
			baseURL: "http://127.0.0.1:7860",
			prompt: "Make it blue",
			inputImage: "data:image/png;base64,input",
		})

		expect(result.success).toBe(false)
		expect(result.error).toContain("text-to-image requests")
		expect(result.error).toContain("Remove the input image")
		expect(global.fetch).not.toHaveBeenCalled()
	})

	it("should return actionable diagnostics for missing image data", async () => {
		vi.mocked(global.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			headers: {
				get: vi.fn((header: string) => (header.toLowerCase() === "content-type" ? "application/json" : null)),
			},
			text: vi.fn().mockResolvedValue(JSON.stringify({ images: [] })),
		} as any)

		const result = await generateImageWithAutomatic1111({
			baseURL: "http://127.0.0.1:7860",
			model: "dreamshaper.safetensors",
			prompt: "A cute cat",
		})

		expect(result.success).toBe(false)
		expect(result.error).toContain("did not include extractable image data")
		expect(result.error).toContain("apiMethod=automatic1111_api")
		expect(result.error).toContain("endpoint=/sdapi/v1/txt2img")
		expect(result.error).toContain("provider=automatic1111")
		expect(result.error).toContain("model=dreamshaper.safetensors")
	})
})

describe("generateImageWithComfyUi", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("should submit a prompt, poll history, and fetch the generated image", async () => {
		const imageBuffer = Buffer.from("comfyui image data")
		vi.mocked(global.fetch)
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ prompt_id: "prompt-123" }),
			} as any)
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					"prompt-123": {
						outputs: {
							"9": {
								images: [{ filename: "roo_image_00001_.png", subfolder: "", type: "output" }],
							},
						},
					},
				}),
			} as any)
			.mockResolvedValueOnce({
				ok: true,
				headers: {
					get: vi.fn((header: string) => (header.toLowerCase() === "content-type" ? "image/png" : null)),
				},
				arrayBuffer: vi
					.fn()
					.mockResolvedValue(
						imageBuffer.buffer.slice(
							imageBuffer.byteOffset,
							imageBuffer.byteOffset + imageBuffer.byteLength,
						),
					),
			} as any)

		const result = await generateImageWithComfyUi({
			baseURL: "http://127.0.0.1:8188",
			authToken: "local-proxy-token",
			model: "sdxl.safetensors",
			prompt: "A cute cat",
			negativePrompt: "blurry",
		})

		expect(result).toEqual({
			success: true,
			imageData: `data:image/png;base64,${imageBuffer.toString("base64")}`,
			imageFormat: "png",
		})

		expect(global.fetch).toHaveBeenNthCalledWith(
			1,
			"http://127.0.0.1:8188/prompt",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer local-proxy-token",
					"Content-Type": "application/json",
				}),
			}),
		)
		expect(global.fetch).toHaveBeenNthCalledWith(
			2,
			"http://127.0.0.1:8188/history/prompt-123",
			expect.objectContaining({
				method: "GET",
				headers: { Authorization: "Bearer local-proxy-token" },
			}),
		)
		expect(global.fetch).toHaveBeenNthCalledWith(
			3,
			"http://127.0.0.1:8188/view?filename=roo_image_00001_.png&type=output",
			expect.objectContaining({
				method: "GET",
				headers: { Authorization: "Bearer local-proxy-token" },
			}),
		)

		const promptBody = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]?.body as string)
		expect(promptBody.client_id).toMatch(/^roo-code-/)
		expect(promptBody.prompt["4"].inputs.ckpt_name).toBe("sdxl.safetensors")
		expect(promptBody.prompt["6"].inputs.text).toBe("A cute cat")
		expect(promptBody.prompt["7"].inputs.text).toBe("blurry")
	})

	it("should keep polling when ComfyUI creates history before outputs are complete", async () => {
		vi.useFakeTimers()
		try {
			const imageBuffer = Buffer.from("comfyui image data")
			vi.mocked(global.fetch)
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ prompt_id: "prompt-123" }),
				} as any)
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({
						"prompt-123": {
							status: { completed: false, status_str: "running" },
						},
					}),
				} as any)
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({
						"prompt-123": {
							status: { completed: true, status_str: "success" },
							outputs: {
								"9": {
									images: [{ filename: "roo_image_00001_.png", subfolder: "", type: "output" }],
								},
							},
						},
					}),
				} as any)
				.mockResolvedValueOnce({
					ok: true,
					headers: {
						get: vi.fn((header: string) => (header.toLowerCase() === "content-type" ? "image/png" : null)),
					},
					arrayBuffer: vi
						.fn()
						.mockResolvedValue(
							imageBuffer.buffer.slice(
								imageBuffer.byteOffset,
								imageBuffer.byteOffset + imageBuffer.byteLength,
							),
						),
				} as any)

			const resultPromise = generateImageWithComfyUi({
				baseURL: "http://127.0.0.1:8188",
				model: "sdxl.safetensors",
				prompt: "A cute cat",
			})

			for (let index = 0; index < 10; index++) {
				await Promise.resolve()
			}
			expect(global.fetch).toHaveBeenCalledTimes(2)

			await vi.advanceTimersByTimeAsync(1_000)
			const result = await resultPromise

			expect(result).toEqual({
				success: true,
				imageData: `data:image/png;base64,${imageBuffer.toString("base64")}`,
				imageFormat: "png",
			})
			expect(global.fetch).toHaveBeenNthCalledWith(
				3,
				"http://127.0.0.1:8188/history/prompt-123",
				expect.objectContaining({ method: "GET" }),
			)
			expect(global.fetch).toHaveBeenNthCalledWith(
				4,
				"http://127.0.0.1:8188/view?filename=roo_image_00001_.png&type=output",
				expect.objectContaining({ method: "GET" }),
			)
		} finally {
			vi.useRealTimers()
		}
	})

	it("should return diagnostics when ComfyUI completes without output images", async () => {
		vi.mocked(global.fetch)
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ prompt_id: "prompt-123" }),
			} as any)
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				statusText: "OK",
				headers: {
					get: vi.fn((header: string) =>
						header.toLowerCase() === "content-type" ? "application/json" : null,
					),
				},
				text: vi.fn().mockResolvedValue(
					JSON.stringify({
						"prompt-123": {
							status: { completed: true, status_str: "success" },
							outputs: {},
						},
					}),
				),
			} as any)

		const result = await generateImageWithComfyUi({
			baseURL: "http://127.0.0.1:8188",
			model: "sdxl.safetensors",
			prompt: "A cute cat",
		})

		expect(result.success).toBe(false)
		expect(result.error).toContain("did not include extractable image data")
		expect(result.error).toContain("apiMethod=comfyui_api")
		expect(result.error).toContain("endpoint=/history/prompt-123")
		expect(global.fetch).toHaveBeenCalledTimes(2)
	})

	it("should reject input images because the default workflow is text-to-image only", async () => {
		const result = await generateImageWithComfyUi({
			baseURL: "http://127.0.0.1:8188",
			model: "sdxl.safetensors",
			prompt: "Make it blue",
			inputImage: "data:image/png;base64,input",
		})

		expect(result.success).toBe(false)
		expect(result.error).toContain("default text-to-image workflow")
		expect(result.error).toContain("Remove the input image")
		expect(global.fetch).not.toHaveBeenCalled()
	})

	it("should return actionable diagnostics when ComfyUI omits prompt_id", async () => {
		vi.mocked(global.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			headers: {
				get: vi.fn((header: string) => (header.toLowerCase() === "content-type" ? "application/json" : null)),
			},
			text: vi.fn().mockResolvedValue(JSON.stringify({ number: 1 })),
		} as any)

		const result = await generateImageWithComfyUi({
			baseURL: "http://127.0.0.1:8188",
			model: "sdxl.safetensors",
			prompt: "A cute cat",
		})

		expect(result.success).toBe(false)
		expect(result.error).toContain("did not return a prompt_id")
		expect(result.error).toContain("apiMethod=comfyui_api")
		expect(result.error).toContain("endpoint=/prompt")
		expect(result.error).toContain("provider=comfyui")
		expect(result.error).toContain("model=sdxl.safetensors")
	})
})

describe("generateImageWithProvider (chat completions)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("should use /chat/completions endpoint", async () => {
		const mockResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({
				choices: [
					{
						message: {
							images: [
								{
									image_url: {
										url: "data:image/png;base64,iVBORw0KGgo=",
									},
								},
							],
						},
					},
				],
			}),
		}

		vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

		const result = await generateImageWithProvider({
			baseURL: "https://api.example.com/v1",
			authToken: "test-token",
			model: "gpt-4-vision",
			prompt: "A cute cat",
		})

		expect(result.success).toBe(true)

		// Verify /chat/completions endpoint was used
		const callUrl = vi.mocked(global.fetch).mock.calls[0][0]
		expect(callUrl).toContain("/chat/completions")
	})

	it("should extract OpenAI-compatible message.images base64 responses", async () => {
		const mockResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({
				model: "custom-image-chat-model",
				message: {
					role: "assistant",
					content: "",
					images: [ONE_BY_ONE_PNG_BASE64],
				},
				done: true,
			}),
		}

		vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

		const result = await generateImageWithProvider({
			baseURL: "https://compatible.example/v1",
			model: "custom-image-chat-model",
			prompt: "A cute cat",
		})

		expect(result).toEqual({
			success: true,
			imageData: `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`,
			imageFormat: "png",
		})
	})

	it("should extract OpenAI-compatible NDJSON message.images responses", async () => {
		vi.mocked(global.fetch).mockResolvedValue({
			ok: true,
			text: vi.fn().mockResolvedValue(
				[
					JSON.stringify({
						model: "custom-image-chat-model",
						message: { role: "assistant", content: "" },
						done: false,
					}),
					JSON.stringify({
						model: "custom-image-chat-model",
						message: { role: "assistant", content: "", images: [ONE_BY_ONE_PNG_BASE64] },
						done: true,
					}),
				].join("\n"),
			),
		} as any)

		const result = await generateImageWithProvider({
			baseURL: "https://compatible.example/v1",
			model: "custom-image-chat-model",
			prompt: "A cute cat",
		})

		expect(result).toEqual({
			success: true,
			imageData: `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`,
			imageFormat: "png",
		})
	})

	it("should handle missing images in response", async () => {
		const mockResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({
				choices: [{ message: { content: "No images" } }],
			}),
		}

		vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

		const result = await generateImageWithProvider({
			baseURL: "https://api.example.com/v1",
			authToken: "test-token",
			model: "gpt-4-vision",
			prompt: "A cute cat",
		})

		expect(result.success).toBe(false)
		expect(result.error).toContain("did not include extractable image data")
		expect(result.error).toContain("chat_completions")
		expect(result.error).toContain("Expected image data")
		expect(result.error).not.toContain("No images")
	})

	it("should return an actionable error for empty chat-completions provider responses", async () => {
		vi.mocked(global.fetch).mockResolvedValue({
			ok: true,
			text: vi.fn().mockResolvedValue(""),
		} as any)

		const result = await generateImageWithProvider({
			baseURL: "https://api.example.com/v1",
			authToken: "test-token",
			model: "gpt-4-vision",
			prompt: "A cute cat",
		})

		expect(result.success).toBe(false)
		expect(result.error).toContain("empty response")
		expect(result.error).toContain("API method")
		expect(result.error).not.toContain("Unexpected end of JSON input")
	})
})

import { DEFAULT_REMOTE_DEBUG_LOGGING_ENDPOINT } from "@roo-code/types"

import { RemoteDebugLogger, sanitizeRemoteDebugEvent, type RemoteDebugLoggerConfig } from "../RemoteDebugLogger"

const createSuccessFetchMock = () => vi.fn<typeof fetch>(async () => ({ ok: true, status: 204 }) as Response)

const createLogger = (
	config: RemoteDebugLoggerConfig,
	fetchImpl: typeof fetch = createSuccessFetchMock() as unknown as typeof fetch,
	log?: (message: string) => void,
) =>
	new RemoteDebugLogger(() => config, {
		fetchImpl,
		batchSize: 1,
		flushIntervalMs: 60_000,
		maxRetries: 0,
		requestTimeoutMs: 100,
		log,
	})

describe("RemoteDebugLogger", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does not send when remote diagnostics are disabled", async () => {
		const fetchMock = createSuccessFetchMock()
		const logger = createLogger(
			{
				enabled: false,
				endpoint: DEFAULT_REMOTE_DEBUG_LOGGING_ENDPOINT,
			},
			fetchMock as unknown as typeof fetch,
		)

		logger.record({
			type: "task.created",
			properties: {
				apiKey: "secret-api-key",
				prompt: "raw user request",
			},
		})
		await logger.flushNow()

		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("drops events for invalid or non-HTTPS endpoints", async () => {
		const fetchMock = createSuccessFetchMock()
		const logger = createLogger(
			{
				enabled: true,
				endpoint: "http://cmtesting.site/api/extension/debug-log",
			},
			fetchMock as unknown as typeof fetch,
		)

		logger.record({ type: "task.started" })
		await logger.flushNow()

		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("sends sanitized batches when enabled", async () => {
		const fetchMock = createSuccessFetchMock()
		const logger = createLogger(
			{
				enabled: true,
				endpoint: DEFAULT_REMOTE_DEBUG_LOGGING_ENDPOINT,
				authToken: "server-token",
				installId: "install-id",
				sessionId: "session-id",
				extensionVersion: "1.2.3",
				platform: {
					os: "win32",
					arch: "x64",
					vscodeVersion: "1.100.0",
				},
			},
			fetchMock as unknown as typeof fetch,
		)

		logger.record({
			type: "task.completed",
			severity: "warn",
			timestamp: "2026-06-08T23:00:00.000Z",
			featureArea: "task",
			taskId: "task-123",
			provider: "anthropic",
			modelId: "claude-sonnet-4",
			properties: {
				apiKey: "secret-api-key",
				userPrompt: "build my private app",
				workspacePath: "C:\\Users\\clayton\\private-workspace",
				safeFlag: true,
				safeMessage: "Request failed at https://example.com/private and C:\\Users\\clayton\\project\\file.ts",
			},
		})
		await logger.flushNow()

		expect(fetchMock).toHaveBeenCalledTimes(1)

		const [endpoint, request] = fetchMock.mock.calls[0]
		expect(endpoint).toBe(DEFAULT_REMOTE_DEBUG_LOGGING_ENDPOINT)
		expect(request).toEqual(
			expect.objectContaining({
				method: "POST",
				signal: expect.any(AbortSignal),
			}),
		)

		const headers = request?.headers as Record<string, string>
		expect(headers).toEqual(
			expect.objectContaining({
				"Content-Type": "application/json",
				"X-C-Code-Diagnostics-Version": "1",
				Authorization: "Bearer server-token",
			}),
		)

		const payload = JSON.parse(request?.body as string)
		expect(payload).toEqual(
			expect.objectContaining({
				version: 1,
				source: "c-code-vscode-extension",
				installId: "install-id",
				sessionId: "session-id",
				extensionVersion: "1.2.3",
				platform: {
					os: "win32",
					arch: "x64",
					vscodeVersion: "1.100.0",
				},
			}),
		)

		const [event] = payload.events
		expect(event).toEqual(
			expect.objectContaining({
				type: "task.completed",
				severity: "warn",
				timestamp: "2026-06-08T23:00:00.000Z",
				featureArea: "task",
				provider: "anthropic",
				modelId: "claude-sonnet-4",
			}),
		)
		expect(event.taskId).toMatch(/^[a-f0-9]{16}$/)
		expect(event.taskId).not.toBe("task-123")
		expect(event.properties).toEqual(
			expect.objectContaining({
				apiKey: "[REDACTED]",
				userPrompt: "[REDACTED]",
				workspacePath: "[REDACTED]",
				safeFlag: true,
				safeMessage: "Request failed at [REDACTED_URL] and [REDACTED_PATH]",
			}),
		)

		const serializedPayload = JSON.stringify(payload)
		expect(serializedPayload).not.toContain("secret-api-key")
		expect(serializedPayload).not.toContain("build my private app")
		expect(serializedPayload).not.toContain("C:\\Users\\clayton")
		expect(serializedPayload).not.toContain("https://example.com/private")
	})

	it("redacts secrets, raw content, paths, URLs, and environment data", () => {
		const error = new Error(
			"Request failed with Bearer abc123 and token=secret-token at C:\\Users\\clayton\\project\\file.ts against https://example.com/private",
		)
		error.stack = "Error: token=secret-token\n    at C:\\Users\\clayton\\project\\file.ts:1:1"

		const event = sanitizeRemoteDebugEvent({
			type: "task.failed",
			error,
			properties: {
				headers: {
					authorization: "Bearer abc123",
				},
				env: {
					OPENAI_API_KEY: "secret-api-key",
				},
				nested: {
					password: "secret-password",
					content: "raw file content",
					safeMessage: "Failed under /Users/clayton/workspace/file.ts with https://example.com/private",
				},
			},
		})

		expect(event.error?.message).toContain("Bearer [REDACTED]")
		expect(event.error?.message).toContain("token=[REDACTED]")
		expect(event.error?.message).toContain("[REDACTED_PATH]")
		expect(event.error?.message).toContain("[REDACTED_URL]")
		expect(event.error?.message).not.toContain("abc123")
		expect(event.error?.message).not.toContain("secret-token")
		expect(event.error?.message).not.toContain("C:\\Users\\clayton")

		expect(event.properties?.headers).toBe("[REDACTED]")
		expect(event.properties?.env).toBe("[REDACTED]")
		expect((event.properties?.nested as Record<string, unknown>).password).toBe("[REDACTED]")
		expect((event.properties?.nested as Record<string, unknown>).content).toBe("[REDACTED]")
		expect((event.properties?.nested as Record<string, unknown>).safeMessage).toBe(
			"Failed under [REDACTED_PATH] with [REDACTED_URL]",
		)
	})

	it("swallows failed requests without interrupting callers", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => {
			throw new Error("network failed with token=secret-token at https://example.com/private")
		})
		const log = vi.fn()
		const logger = createLogger(
			{
				enabled: true,
				endpoint: DEFAULT_REMOTE_DEBUG_LOGGING_ENDPOINT,
			},
			fetchMock as unknown as typeof fetch,
			log,
		)

		expect(() => logger.record({ type: "task.created" })).not.toThrow()
		await expect(logger.flushNow()).resolves.toBeUndefined()

		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(log).toHaveBeenCalledTimes(1)
		expect(log.mock.calls[0][0]).toContain("Remote diagnostics flush failed")
		expect(log.mock.calls[0][0]).not.toContain("secret-token")
		expect(log.mock.calls[0][0]).not.toContain("https://example.com/private")
	})
})

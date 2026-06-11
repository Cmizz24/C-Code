import { REMOTE_DEBUG_LOGGING_ENDPOINT } from "@roo-code/types"

import {
	RemoteDebugLogger,
	sanitizeRemoteDebugEvent,
	type RemoteDebugEvent,
	type RemoteDebugLoggerConfig,
} from "../RemoteDebugLogger"

const createSuccessFetchMock = () => vi.fn<typeof fetch>(async () => ({ ok: true, status: 204 }) as Response)

const createLogger = (
	config: RemoteDebugLoggerConfig,
	fetchImpl: typeof fetch = createSuccessFetchMock() as unknown as typeof fetch,
	log?: (message: string) => void,
	options: { batchSize?: number; flushIntervalMs?: number; maxRetries?: number; requestTimeoutMs?: number } = {},
) =>
	new RemoteDebugLogger(() => config, {
		fetchImpl,
		batchSize: options.batchSize ?? 1,
		flushIntervalMs: options.flushIntervalMs ?? 60_000,
		maxRetries: options.maxRetries ?? 3,
		requestTimeoutMs: options.requestTimeoutMs ?? 100,
		log,
	})

describe("RemoteDebugLogger", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("does not send when remote diagnostics are disabled", async () => {
		const fetchMock = createSuccessFetchMock()
		const logger = createLogger(
			{
				enabled: false,
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

	it("sends sanitized batches when enabled", async () => {
		const fetchMock = createSuccessFetchMock()
		const logger = createLogger(
			{
				enabled: true,
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
		expect(endpoint).toBe(REMOTE_DEBUG_LOGGING_ENDPOINT)
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
			}),
		)
		expect(headers.Authorization).toBeUndefined()
		expect(Object.keys(headers).some((header) => header.toLowerCase() === "authorization")).toBe(false)

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
		expect(payload.delivery).toEqual(
			expect.objectContaining({
				status: "initial",
				attempt: 1,
				maxRetries: 3,
				batchEventCount: 1,
				queuedEventCount: 0,
				requestTimeoutMs: 100,
			}),
		)

		const [event] = payload.events
		expect(event).toEqual(
			expect.objectContaining({
				type: "task.completed",
				severity: "warn",
				timestamp: expect.any(String),
				featureArea: "task",
				provider: "anthropic",
				modelId: "claude-sonnet-4",
			}),
		)
		expect(event.taskSummary).toEqual(
			expect.objectContaining({
				status: "completed",
				messageCount: 0,
				askCount: 0,
				sayCount: 0,
				apiRequestCount: 0,
				apiRetryCount: 0,
				apiFailureCount: 0,
				toolAttemptCount: 0,
				toolFailureCount: 0,
				hasParentTask: false,
				hasRootTask: false,
				lastMessage: {
					type: "unknown",
					hasText: false,
					textLength: 0,
				},
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

	it("preserves structured advanced event summaries while redacting raw diagnostic content", () => {
		const event = sanitizeRemoteDebugEvent({
			type: "task.api_request.failed",
			severity: "error",
			featureArea: "task",
			taskId: "task-advanced-id",
			parentTaskId: "parent-advanced-id",
			rootTaskId: "root-advanced-id",
			agentId: "agent-advanced-id",
			operation: {
				stage: "api_request",
				status: "failed",
				trigger: "message",
				attempt: 2,
				durationMs: 345,
				result: "streaming_failed",
			},
			taskSummary: {
				status: "active",
				messageCount: 5,
				askCount: 1,
				sayCount: 4,
				apiRequestCount: 2,
				apiRetryCount: 1,
				apiFailureCount: 1,
				toolAttemptCount: 3,
				toolFailureCount: 1,
				lastMessage: {
					type: "ask",
					ask: "api_req_failed",
					hasText: true,
					textLength: 72,
					text: "raw private prompt",
				} as any,
			},
			apiRequest: {
				protocol: "anthropic",
				status: "failed",
				requestIndex: 2,
				requestCount: 2,
				retryAttempt: 1,
				retryDelayMs: 2_000,
				tokensIn: 100,
				tokensOut: 50,
				cacheWrites: 10,
				cacheReads: 5,
				cost: 0.123,
				cancelReason: "streaming_failed",
				streamingFailed: true,
				request: "POST https://example.com/private?token=secret raw private prompt",
			} as any,
			message: {
				action: "created",
				type: "ask",
				ask: "api_req_failed",
				hasText: true,
				textLength: 1_234,
				tool: "read_file",
				text: "C:\\Users\\clayton\\secret.txt raw command output",
			} as any,
			runtime: {
				source: "process",
				origin: "unhandledRejection",
				unhandled: true,
				component: "provider",
				operation: "stream token=secret-token at https://example.com/private",
			},
			properties: {
				workspaceName: "private-workspace",
				commandOutput: "secret command output",
				safeMessage: "Retry scheduled at https://example.com/private from C:\\Users\\clayton\\project",
				safeCount: 2,
			},
		} as RemoteDebugEvent)

		expect(event.taskId).toMatch(/^[a-f0-9]{16}$/)
		expect(event.taskId).not.toBe("task-advanced-id")
		expect(event.agentId).toMatch(/^[a-f0-9]{16}$/)
		expect(event.operation).toEqual(
			expect.objectContaining({
				stage: "api_request",
				status: "failed",
				attempt: 2,
				durationMs: 345,
			}),
		)
		expect(event.taskSummary).toEqual(
			expect.objectContaining({
				messageCount: 5,
				apiRequestCount: 2,
				apiFailureCount: 1,
				toolFailureCount: 1,
			}),
		)
		expect((event.taskSummary?.lastMessage as any).text).toBe("[REDACTED]")
		expect(event.apiRequest).toEqual(
			expect.objectContaining({
				protocol: "anthropic",
				status: "failed",
				requestIndex: 2,
				tokensIn: 100,
				streamingFailed: true,
			}),
		)
		expect((event.apiRequest as any).request).toBe("[REDACTED]")
		expect(event.message).toEqual(
			expect.objectContaining({
				action: "created",
				type: "ask",
				ask: "api_req_failed",
				hasText: true,
				textLength: 1_234,
				tool: "read_file",
			}),
		)
		expect((event.message as any).text).toBe("[REDACTED]")
		expect(event.runtime?.operation).toBe("stream token=[REDACTED] at [REDACTED_URL]")
		expect(event.properties?.workspaceName).toBe("[REDACTED]")
		expect(event.properties?.commandOutput).toBe("[REDACTED]")
		expect(event.properties?.safeMessage).toBe("Retry scheduled at [REDACTED_URL] from [REDACTED_PATH]")
		expect(event.properties?.safeCount).toBe(2)

		const serializedEvent = JSON.stringify(event)
		expect(serializedEvent).not.toContain("task-advanced-id")
		expect(serializedEvent).not.toContain("agent-advanced-id")
		expect(serializedEvent).not.toContain("raw private prompt")
		expect(serializedEvent).not.toContain("raw command output")
		expect(serializedEvent).not.toContain("secret-token")
		expect(serializedEvent).not.toContain("https://example.com/private")
		expect(serializedEvent).not.toContain("C:\\Users\\clayton")
	})

	it("drops prohibited message, active, idle, and interactive events before sending", async () => {
		const fetchMock = createSuccessFetchMock()
		const logger = createLogger(
			{
				enabled: true,
			},
			fetchMock as unknown as typeof fetch,
			undefined,
			{ batchSize: 10 },
		)

		for (const type of [
			"message.created",
			"message.updated",
			"message.deleted",
			"task.message",
			"anything.message.x",
			"task.idle",
			"task.active",
			"task.interactive",
		]) {
			logger.record({ type })
		}
		await logger.flushNow()

		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("sends only clean allowed event types with contract feature areas", async () => {
		const fetchMock = createSuccessFetchMock()
		const logger = createLogger(
			{
				enabled: true,
			},
			fetchMock as unknown as typeof fetch,
			undefined,
			{ batchSize: 10 },
		)

		logger.record({ type: "task.created" })
		logger.record({ type: "task.focused" })
		logger.record({ type: "task.unpaused" })
		logger.record({ type: "api.request", featureArea: "message", apiRequest: { status: "completed" } })
		logger.record({ type: "tool.usage" })
		await logger.flushNow()

		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [, request] = fetchMock.mock.calls[0]
		const payload = JSON.parse(request?.body as string)
		expect(payload.events.map((event: RemoteDebugEvent) => event.type)).toEqual([
			"task.created",
			"task.focus",
			"task.resumed",
			"api.request",
			"tool.usage",
		])
		expect(payload.events.map((event: RemoteDebugEvent) => event.featureArea)).toEqual([
			"task",
			"task",
			"task",
			"api",
			"tool",
		])
		expect(payload.events[3].apiRequest).toEqual(expect.objectContaining({ stage: "finished", status: "finished" }))
	})

	it("adds delivery metadata to every batch with real batch and queue counts", async () => {
		const fetchMock = createSuccessFetchMock()
		const logger = createLogger(
			{
				enabled: true,
			},
			fetchMock as unknown as typeof fetch,
			undefined,
			{ batchSize: 2, maxRetries: 3, requestTimeoutMs: 5_000 },
		)

		logger.record({ type: "task.created" })
		logger.record({ type: "tool.usage" })
		await logger.flushNow()

		logger.record({ type: "task.spawned" })
		await logger.flushNow()

		expect(fetchMock).toHaveBeenCalledTimes(2)
		const firstPayload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
		const secondPayload = JSON.parse(fetchMock.mock.calls[1][1]?.body as string)
		expect(firstPayload.delivery).toEqual({
			status: "initial",
			attempt: 1,
			maxRetries: 3,
			batchEventCount: 2,
			queuedEventCount: 0,
			requestTimeoutMs: 5_000,
		})
		expect(secondPayload.delivery).toEqual({
			status: "initial",
			attempt: 1,
			maxRetries: 3,
			batchEventCount: 1,
			queuedEventCount: 0,
			requestTimeoutMs: 5_000,
		})
	})

	it("flushes error events immediately and ensures error severity events include runtime or error details", async () => {
		vi.useFakeTimers()
		const fetchMock = createSuccessFetchMock()
		const logger = createLogger(
			{
				enabled: true,
			},
			fetchMock as unknown as typeof fetch,
			undefined,
			{ batchSize: 10, flushIntervalMs: 60_000 },
		)

		logger.record({ type: "task.created", severity: "info" })
		await vi.advanceTimersByTimeAsync(0)
		expect(fetchMock).not.toHaveBeenCalled()

		logger.record({ type: "runtime.error", severity: "error", error: new Error("unhandled runtime error") })
		await vi.advanceTimersByTimeAsync(0)

		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [, request] = fetchMock.mock.calls[0]
		const payload = JSON.parse(request?.body as string) as { events: Array<any> }
		expect(payload.events.map((event) => event.type)).toEqual(["task.created", "runtime.error"])
		expect(payload.events[1].error).toEqual(
			expect.objectContaining({ name: "Error", message: "unhandled runtime error" }),
		)

		fetchMock.mockClear()
		logger.record({ type: "tool.usage", severity: "error" })
		await vi.advanceTimersByTimeAsync(0)

		expect(fetchMock).toHaveBeenCalledTimes(1)
		const fallbackPayload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
		expect(fallbackPayload.events[0]).toEqual(
			expect.objectContaining({
				type: "tool.usage",
				severity: "error",
				featureArea: "tool",
				runtime: {
					source: "extension",
					component: "tool",
				},
			}),
		)
	})

	it("fills required taskSummary fields for task.completed events", async () => {
		const fetchMock = createSuccessFetchMock()
		const logger = createLogger(
			{
				enabled: true,
			},
			fetchMock as unknown as typeof fetch,
		)

		logger.record({
			type: "task.completed",
			parentTaskId: "parent-task",
			taskSummary: {
				messageCount: 4,
				askCount: 1,
				sayCount: 3,
				apiRequestCount: 2,
				apiRetryCount: 1,
				apiFailureCount: 0,
				toolAttemptCount: 5,
				toolFailureCount: 1,
				lastMessage: {
					type: "say",
					say: "completion_result",
					hasText: true,
					textLength: 123,
				},
			},
		})
		await logger.flushNow()

		const [, request] = fetchMock.mock.calls[0]
		const payload = JSON.parse(request?.body as string)
		expect(payload.events[0].taskSummary).toEqual({
			status: "completed",
			messageCount: 4,
			askCount: 1,
			sayCount: 3,
			apiRequestCount: 2,
			apiRetryCount: 1,
			apiFailureCount: 0,
			toolAttemptCount: 5,
			toolFailureCount: 1,
			hasParentTask: true,
			hasRootTask: false,
			lastMessage: {
				type: "say",
				say: "completion_result",
				hasText: true,
				textLength: 123,
			},
		})
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
			},
			fetchMock as unknown as typeof fetch,
			log,
			{ maxRetries: 0 },
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

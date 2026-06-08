import crypto from "crypto"

import { DEFAULT_REMOTE_DEBUG_LOGGING_ENDPOINT, type TokenUsage, type ToolUsage } from "@roo-code/types"

export type RemoteDebugSeverity = "debug" | "info" | "warn" | "error"

export type RemoteDebugEvent = {
	type: string
	severity?: RemoteDebugSeverity
	timestamp?: string
	featureArea?: string
	taskId?: string
	parentTaskId?: string
	rootTaskId?: string
	agentId?: string
	background?: boolean
	mode?: string
	provider?: string
	modelId?: string
	tokenUsage?: TokenUsage
	toolUsage?: ToolUsage
	error?: unknown
	properties?: Record<string, unknown>
}

export type RemoteDebugLoggerConfig = {
	enabled?: boolean
	endpoint?: string
	authToken?: string
	installId?: string
	sessionId?: string
	extensionVersion?: string
	platform?: {
		os?: string
		arch?: string
		vscodeVersion?: string
	}
}

type SanitizedRemoteDebugEvent = Omit<RemoteDebugEvent, "error" | "properties"> & {
	timestamp: string
	error?: {
		name?: string
		message?: string
		stack?: string
	}
	properties?: Record<string, unknown>
}

type QueueItem = {
	event: SanitizedRemoteDebugEvent
	attempts: number
}

type RemoteDebugLoggerOptions = {
	fetchImpl?: typeof fetch
	batchSize?: number
	flushIntervalMs?: number
	maxQueueSize?: number
	maxEventsPerMinute?: number
	maxRetries?: number
	requestTimeoutMs?: number
	log?: (message: string) => void
}

const DEFAULT_BATCH_SIZE = 10
const DEFAULT_FLUSH_INTERVAL_MS = 5_000
const DEFAULT_MAX_QUEUE_SIZE = 200
const DEFAULT_MAX_EVENTS_PER_MINUTE = 120
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000
const MAX_STRING_LENGTH = 1_000
const MAX_STACK_LENGTH = 2_000
const MAX_OBJECT_DEPTH = 5

const SECRET_KEY_PATTERN =
	/(api[-_]?key|apikey|authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|password|secret|credential|cookie|bearer|private[-_]?key)/i
const RAW_CONTENT_KEY_PATTERN =
	/^(prompt|userPrompt|userMessage|task|text|content|contents|fileContent|fileContents|raw|request|response|headers|env|environment|workspacePath|filePath|path|cwd|clineMessages|apiConversationHistory|images)$/i
const HASHED_IDENTIFIER_KEYS = new Set(["taskId", "parentTaskId", "rootTaskId", "agentId"])

const hashIdentifier = (value: string) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)

const truncate = (value: string, maxLength = MAX_STRING_LENGTH) =>
	value.length > maxLength ? `${value.slice(0, maxLength)}…` : value

const redactString = (value: string, maxLength = MAX_STRING_LENGTH): string => {
	const redacted = value
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
		.replace(/(api[-_]?key|token|password|secret)\s*[:=]\s*["']?[^"'\s,;]+/gi, "$1=[REDACTED]")
		.replace(/https?:\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
		.replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\s]+\\)*[^\\/:*?"<>|\s]*/g, "[REDACTED_PATH]")
		.replace(/\/(?:Users|home|workspace|private|tmp)\/[^\s"'<>]+/g, "[REDACTED_PATH]")

	return truncate(redacted, maxLength)
}

const sanitizeValue = (value: unknown, key?: string, depth = 0): unknown => {
	if (key && SECRET_KEY_PATTERN.test(key)) {
		return "[REDACTED]"
	}

	if (key && RAW_CONTENT_KEY_PATTERN.test(key)) {
		return "[REDACTED]"
	}

	if (typeof value === "string") {
		if (key && HASHED_IDENTIFIER_KEYS.has(key)) {
			return hashIdentifier(value)
		}

		return redactString(value)
	}

	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined
	}

	if (typeof value === "boolean" || value === null || value === undefined) {
		return value
	}

	if (depth >= MAX_OBJECT_DEPTH) {
		return "[TRUNCATED]"
	}

	if (Array.isArray(value)) {
		return value.slice(0, 20).map((item) => sanitizeValue(item, undefined, depth + 1))
	}

	if (typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
				entryKey,
				sanitizeValue(entryValue, entryKey, depth + 1),
			]),
		)
	}

	return undefined
}

export const sanitizeRemoteDebugError = (error: unknown): SanitizedRemoteDebugEvent["error"] => {
	if (!error) {
		return undefined
	}

	if (error instanceof Error) {
		return {
			name: redactString(error.name, 120),
			message: redactString(error.message, 500),
			stack: error.stack ? redactString(error.stack, MAX_STACK_LENGTH) : undefined,
		}
	}

	return { message: redactString(String(error), 500) }
}

export const sanitizeRemoteDebugEvent = (event: RemoteDebugEvent): SanitizedRemoteDebugEvent => {
	const sanitizedProperties = sanitizeValue(event.properties ?? {}, "properties") as Record<string, unknown>

	return {
		type: redactString(event.type, 120),
		severity: event.severity ?? "info",
		timestamp: event.timestamp ?? new Date().toISOString(),
		featureArea: event.featureArea ? redactString(event.featureArea, 120) : undefined,
		taskId: event.taskId ? (sanitizeValue(event.taskId, "taskId") as string) : undefined,
		parentTaskId: event.parentTaskId ? (sanitizeValue(event.parentTaskId, "parentTaskId") as string) : undefined,
		rootTaskId: event.rootTaskId ? (sanitizeValue(event.rootTaskId, "rootTaskId") as string) : undefined,
		agentId: event.agentId ? (sanitizeValue(event.agentId, "agentId") as string) : undefined,
		background: event.background,
		mode: event.mode ? redactString(event.mode, 120) : undefined,
		provider: event.provider ? redactString(event.provider, 120) : undefined,
		modelId: event.modelId ? redactString(event.modelId, 160) : undefined,
		tokenUsage: sanitizeValue(event.tokenUsage, "tokenUsage") as TokenUsage | undefined,
		toolUsage: sanitizeValue(event.toolUsage, "toolUsage") as ToolUsage | undefined,
		error: sanitizeRemoteDebugError(event.error),
		properties: Object.keys(sanitizedProperties).length > 0 ? sanitizedProperties : undefined,
	}
}

const normalizeEndpoint = (endpoint?: string): string | undefined => {
	const candidate = endpoint?.trim() || DEFAULT_REMOTE_DEBUG_LOGGING_ENDPOINT

	try {
		const url = new URL(candidate)
		return url.protocol === "https:" ? url.toString() : undefined
	} catch {
		return undefined
	}
}

export class RemoteDebugLogger {
	private readonly fetchImpl: typeof fetch
	private readonly batchSize: number
	private readonly flushIntervalMs: number
	private readonly maxQueueSize: number
	private readonly maxEventsPerMinute: number
	private readonly maxRetries: number
	private readonly requestTimeoutMs: number
	private readonly log?: (message: string) => void
	private queue: QueueItem[] = []
	private flushTimer?: ReturnType<typeof setTimeout>
	private flushPromise?: Promise<void>
	private recentEventTimestamps: number[] = []
	private backoffUntil = 0
	private disposed = false

	constructor(
		private readonly getConfig: () => RemoteDebugLoggerConfig,
		options: RemoteDebugLoggerOptions = {},
	) {
		this.fetchImpl = options.fetchImpl ?? fetch
		this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
		this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
		this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE
		this.maxEventsPerMinute = options.maxEventsPerMinute ?? DEFAULT_MAX_EVENTS_PER_MINUTE
		this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
		this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
		this.log = options.log
	}

	record(event: RemoteDebugEvent): void {
		try {
			if (this.disposed) {
				return
			}

			const config = this.getConfig()
			if (!config.enabled || !normalizeEndpoint(config.endpoint)) {
				return
			}

			if (!this.consumeRateLimitSlot()) {
				return
			}

			this.queue.push({ event: sanitizeRemoteDebugEvent(event), attempts: 0 })
			if (this.queue.length > this.maxQueueSize) {
				this.queue.splice(0, this.queue.length - this.maxQueueSize)
			}

			if (this.queue.length >= this.batchSize) {
				this.scheduleFlush(0)
			} else {
				this.scheduleFlush(this.flushIntervalMs)
			}
		} catch {
			// Logging must never affect the user's workflow.
		}
	}

	async flushNow(): Promise<void> {
		if (this.flushPromise) {
			return this.flushPromise
		}

		this.flushPromise = this.flush().finally(() => {
			this.flushPromise = undefined
		})

		return this.flushPromise
	}

	async dispose(): Promise<void> {
		this.disposed = true
		this.clearFlushTimer()

		await Promise.race([
			this.flushNow(),
			new Promise<void>((resolve) => setTimeout(resolve, Math.min(this.requestTimeoutMs, 1_500))),
		]).catch(() => undefined)
	}

	private consumeRateLimitSlot(): boolean {
		const now = Date.now()
		this.recentEventTimestamps = this.recentEventTimestamps.filter((timestamp) => now - timestamp < 60_000)

		if (this.recentEventTimestamps.length >= this.maxEventsPerMinute) {
			return false
		}

		this.recentEventTimestamps.push(now)
		return true
	}

	private scheduleFlush(delayMs: number): void {
		if (this.flushTimer) {
			return
		}

		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined
			void this.flushNow()
		}, delayMs)
	}

	private clearFlushTimer(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
			this.flushTimer = undefined
		}
	}

	private async flush(): Promise<void> {
		this.clearFlushTimer()

		if (this.queue.length === 0) {
			return
		}

		const config = this.getConfig()
		const endpoint = normalizeEndpoint(config.endpoint)

		if (!config.enabled) {
			this.queue = []
			return
		}

		if (!endpoint) {
			this.queue = []
			return
		}

		const now = Date.now()
		if (now < this.backoffUntil) {
			this.scheduleFlush(this.backoffUntil - now)
			return
		}

		const batch = this.queue.splice(0, this.batchSize)
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				"X-C-Code-Diagnostics-Version": "1",
			}

			if (config.authToken?.trim()) {
				headers.Authorization = `Bearer ${config.authToken.trim()}`
			}

			const response = await this.fetchImpl(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify({
					version: 1,
					source: "c-code-vscode-extension",
					sentAt: new Date().toISOString(),
					installId: config.installId,
					sessionId: config.sessionId,
					extensionVersion: config.extensionVersion,
					platform: sanitizeValue(config.platform, "platform"),
					events: batch.map((item) => item.event),
				}),
				signal: controller.signal,
			})

			if (!response.ok && (response.status === 429 || response.status >= 500)) {
				throw new Error(`Remote diagnostics ingest failed with status ${response.status}`)
			}

			this.backoffUntil = 0
		} catch (error) {
			this.log?.(
				`Remote diagnostics flush failed: ${sanitizeRemoteDebugError(error)?.message ?? "unknown error"}`,
			)
			const retryable = batch
				.map((item) => ({ ...item, attempts: item.attempts + 1 }))
				.filter((item) => item.attempts <= this.maxRetries)

			if (retryable.length > 0) {
				this.queue.unshift(...retryable)
				if (this.queue.length > this.maxQueueSize) {
					this.queue.splice(this.maxQueueSize)
				}

				const highestAttempt = Math.max(...retryable.map((item) => item.attempts))
				const backoffMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, highestAttempt - 1))
				this.backoffUntil = Date.now() + backoffMs
				this.scheduleFlush(backoffMs)
			}
		} finally {
			clearTimeout(timeout)
		}

		if (!this.disposed && this.queue.length > 0 && Date.now() >= this.backoffUntil) {
			this.scheduleFlush(this.flushIntervalMs)
		}
	}
}

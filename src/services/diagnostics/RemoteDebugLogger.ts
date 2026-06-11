import crypto from "crypto"

import { REMOTE_DEBUG_LOGGING_ENDPOINT, type TokenUsage, type ToolUsage } from "@roo-code/types"

export type RemoteDebugSeverity = "debug" | "info" | "warn" | "error"

export type RemoteDebugOperationSummary = {
	stage?: string
	status?: string
	trigger?: string
	attempt?: number
	durationMs?: number
	result?: string
}

export type RemoteDebugTaskSummary = {
	status?: string
	messageCount?: number
	askCount?: number
	sayCount?: number
	apiRequestCount?: number
	apiRetryCount?: number
	apiFailureCount?: number
	toolAttemptCount?: number
	toolFailureCount?: number
	consecutiveMistakeCount?: number
	consecutiveNoToolUseCount?: number
	consecutiveNoAssistantMessagesCount?: number
	hasParentTask?: boolean
	hasRootTask?: boolean
	lastMessage?: RemoteDebugMessageSummary
}

export type RemoteDebugApiRequestSummary = {
	stage?: string
	protocol?: string
	status?: string
	requestIndex?: number
	requestCount?: number
	retryAttempt?: number
	retryDelayMs?: number
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	cancelReason?: string
	streamingFailed?: boolean
}

export type RemoteDebugMessageSummary = {
	action?: "created" | "updated"
	type?: string
	ask?: string
	say?: string
	partial?: boolean
	hasText?: boolean
	textLength?: number
	hasImages?: boolean
	imageCount?: number
	hasReasoning?: boolean
	hasCheckpoint?: boolean
	hasProgressStatus?: boolean
	hasContextCondense?: boolean
	hasContextTruncation?: boolean
	apiProtocol?: string
	isProtected?: boolean
	isAnswered?: boolean
	tool?: string
}

export type RemoteDebugDeliverySummary = {
	status?: string
	attempt?: number
	maxRetries?: number
	retryDelayMs?: number
	batchEventCount?: number
	queuedEventCount?: number
	droppedEventCount?: number
	requestTimeoutMs?: number
}

export type RemoteDebugRuntimeSummary = {
	source?: string
	origin?: string
	unhandled?: boolean
	component?: string
	operation?: string
}

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
	operation?: RemoteDebugOperationSummary
	taskSummary?: RemoteDebugTaskSummary
	apiRequest?: RemoteDebugApiRequestSummary
	message?: RemoteDebugMessageSummary
	delivery?: RemoteDebugDeliverySummary
	runtime?: RemoteDebugRuntimeSummary
	error?: unknown
	properties?: Record<string, unknown>
}

export type RemoteDebugLoggerConfig = {
	enabled?: boolean
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

export type RemoteDebugRecordOptions = {
	flushImmediately?: boolean
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
const CLEAN_REMOTE_DEBUG_EVENT_TYPES = new Set([
	"task.completed",
	"task.created",
	"task.aborted",
	"task.paused",
	"task.resumed",
	"task.spawned",
	"task.focus",
	"api.request",
	"tool.usage",
	"runtime.error",
])
const SUPPRESSED_REMOTE_DEBUG_EVENT_TYPES = new Set([
	"message.created",
	"message.updated",
	"message.deleted",
	"task.idle",
	"task.active",
	"task.interactive",
])
const REMOTE_DEBUG_EVENT_TYPE_ALIASES = new Map<string, string>([
	["task.focused", "task.focus"],
	["task.unpaused", "task.resumed"],
	["task.api_request.started", "api.request"],
	["task.api_request.completed", "api.request"],
	["task.api_request.finished", "api.request"],
	["task.api_request.retried", "api.request"],
	["task.api_request.failed", "api.request"],
	["task.token_usage_updated", "tool.usage"],
	["task.tool_failed", "tool.usage"],
])
const REMOTE_DEBUG_EVENT_FEATURE_AREAS: Record<string, "task" | "api" | "tool" | "runtime"> = {
	"task.completed": "task",
	"task.created": "task",
	"task.aborted": "task",
	"task.paused": "task",
	"task.resumed": "task",
	"task.spawned": "task",
	"task.focus": "task",
	"api.request": "api",
	"tool.usage": "tool",
	"runtime.error": "runtime",
}
const CLEAN_REMOTE_DEBUG_API_STAGES = new Set(["started", "finished", "retried", "failed"])
const EMPTY_REMOTE_DEBUG_LAST_MESSAGE: RemoteDebugMessageSummary = {
	type: "unknown",
	hasText: false,
	textLength: 0,
}

const SECRET_KEY_PATTERN =
	/(api[-_]?key|apikey|authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|password|secret|credential|cookie|bearer|private[-_]?key)/i
const RAW_CONTENT_KEY_PATTERN =
	/^(prompt|userPrompt|userMessage|task|transcript|conversation|conversationHistory|text|content|contents|fileContent|fileContents|raw|request|response|requestBody|responseBody|body|headers|env|environment|environmentDetails|workspace|workspaceName|workspacePath|filePath|path|cwd|command|commandOutput|stdout|stderr|diff|patch|clineMessages|apiConversationHistory|images)$/i
const HASHED_IDENTIFIER_KEYS = new Set(["taskId", "parentTaskId", "rootTaskId", "agentId"])

const hashIdentifier = (value: string) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)

const getIsoTimestampFromDateNow = () => new Date(Date.now()).toISOString()

const shouldSuppressRemoteDebugEventType = (type: string): boolean => {
	const normalizedType = type.toLowerCase()
	return SUPPRESSED_REMOTE_DEBUG_EVENT_TYPES.has(normalizedType) || normalizedType.includes(".message")
}

const normalizeRemoteDebugApiStage = (stage: unknown): string | undefined => {
	if (typeof stage !== "string" || stage.length === 0) {
		return undefined
	}

	const normalizedStage = stage.toLowerCase()
	if (CLEAN_REMOTE_DEBUG_API_STAGES.has(normalizedStage)) {
		return normalizedStage
	}

	switch (normalizedStage) {
		case "completed":
			return "finished"
		case "retry_delayed":
		case "retry_delay_countdown":
		case "rate_limit_wait":
			return "retried"
		case "cancelled":
		case "streaming_failed":
			return "failed"
		default:
			return undefined
	}
}

const deriveRemoteDebugApiStageFromType = (type: string): string | undefined => {
	const normalizedType = type.toLowerCase()
	const suffix = normalizedType.startsWith("task.api_request.")
		? normalizedType.slice("task.api_request.".length)
		: undefined

	return normalizeRemoteDebugApiStage(suffix)
}

const completeRemoteDebugTaskSummary = (event: RemoteDebugEvent): RemoteDebugTaskSummary => ({
	status: event.taskSummary?.status ?? "completed",
	messageCount: event.taskSummary?.messageCount ?? 0,
	askCount: event.taskSummary?.askCount ?? 0,
	sayCount: event.taskSummary?.sayCount ?? 0,
	apiRequestCount: event.taskSummary?.apiRequestCount ?? 0,
	apiRetryCount: event.taskSummary?.apiRetryCount ?? 0,
	apiFailureCount: event.taskSummary?.apiFailureCount ?? 0,
	toolAttemptCount: event.taskSummary?.toolAttemptCount ?? 0,
	toolFailureCount: event.taskSummary?.toolFailureCount ?? 0,
	hasParentTask: event.taskSummary?.hasParentTask ?? Boolean(event.parentTaskId),
	hasRootTask: event.taskSummary?.hasRootTask ?? Boolean(event.rootTaskId),
	lastMessage: event.taskSummary?.lastMessage ?? EMPTY_REMOTE_DEBUG_LAST_MESSAGE,
})

const normalizeRemoteDebugEvent = (event: RemoteDebugEvent): RemoteDebugEvent | undefined => {
	if (shouldSuppressRemoteDebugEventType(event.type)) {
		return undefined
	}

	const lowerType = event.type.toLowerCase()
	const type = REMOTE_DEBUG_EVENT_TYPE_ALIASES.get(lowerType) ?? lowerType

	if (shouldSuppressRemoteDebugEventType(type) || !CLEAN_REMOTE_DEBUG_EVENT_TYPES.has(type)) {
		return undefined
	}

	const featureArea = REMOTE_DEBUG_EVENT_FEATURE_AREAS[type]
	let normalizedEvent: RemoteDebugEvent = {
		...event,
		type,
		featureArea,
	}

	if (type === "api.request") {
		const stage =
			normalizeRemoteDebugApiStage(event.apiRequest?.stage ?? event.apiRequest?.status) ??
			deriveRemoteDebugApiStageFromType(lowerType)

		if (!stage) {
			return undefined
		}

		normalizedEvent = {
			...normalizedEvent,
			operation: {
				...event.operation,
				stage: "request",
				status: stage,
			},
			apiRequest: {
				...event.apiRequest,
				stage,
				status: stage,
			},
		}
	}

	if (type === "task.completed") {
		normalizedEvent = {
			...normalizedEvent,
			taskSummary: completeRemoteDebugTaskSummary(normalizedEvent),
		}
	}

	if (normalizedEvent.severity === "error" && !normalizedEvent.runtime && !normalizedEvent.error) {
		normalizedEvent = {
			...normalizedEvent,
			runtime: {
				source: "extension",
				component: featureArea,
			},
		}
	}

	return normalizedEvent
}

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
		timestamp: event.timestamp ?? getIsoTimestampFromDateNow(),
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
		operation: sanitizeValue(event.operation, "operation") as RemoteDebugOperationSummary | undefined,
		taskSummary: sanitizeValue(event.taskSummary, "taskSummary") as RemoteDebugTaskSummary | undefined,
		apiRequest: sanitizeValue(event.apiRequest, "apiRequest") as RemoteDebugApiRequestSummary | undefined,
		message: sanitizeValue(event.message, "message") as RemoteDebugMessageSummary | undefined,
		delivery: sanitizeValue(event.delivery, "delivery") as RemoteDebugDeliverySummary | undefined,
		runtime: sanitizeValue(event.runtime, "runtime") as RemoteDebugRuntimeSummary | undefined,
		error: sanitizeRemoteDebugError(event.error),
		properties: Object.keys(sanitizedProperties).length > 0 ? sanitizedProperties : undefined,
	}
}

const getRemoteDebugLoggingEndpoint = (): string | undefined => {
	try {
		const url = new URL(REMOTE_DEBUG_LOGGING_ENDPOINT)
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
	private droppedEventsSinceLastFlush = 0

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

	record(event: RemoteDebugEvent, options: RemoteDebugRecordOptions = {}): void {
		try {
			if (this.disposed) {
				return
			}

			const config = this.getConfig()
			if (!config.enabled || !getRemoteDebugLoggingEndpoint()) {
				return
			}

			const normalizedEvent = normalizeRemoteDebugEvent(event)
			if (!normalizedEvent) {
				return
			}

			if (!this.consumeRateLimitSlot()) {
				this.droppedEventsSinceLastFlush++
				return
			}

			const sanitizedEvent = sanitizeRemoteDebugEvent({
				...normalizedEvent,
				timestamp: getIsoTimestampFromDateNow(),
			})
			this.queue.push({ event: sanitizedEvent, attempts: 0 })
			if (this.queue.length > this.maxQueueSize) {
				const droppedCount = this.queue.length - this.maxQueueSize
				this.queue.splice(0, droppedCount)
				this.droppedEventsSinceLastFlush += droppedCount
			}

			if (
				options.flushImmediately === true ||
				sanitizedEvent.severity === "error" ||
				this.queue.length >= this.batchSize
			) {
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
			if (delayMs > 0) {
				return
			}

			this.clearFlushTimer()
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
		const endpoint = getRemoteDebugLoggingEndpoint()

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
		const highestBatchAttempt = batch.reduce((highestAttempt, item) => Math.max(highestAttempt, item.attempts), 0)
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				"X-C-Code-Diagnostics-Version": "1",
			}

			const response = await this.fetchImpl(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify({
					version: 1,
					source: "c-code-vscode-extension",
					sentAt: getIsoTimestampFromDateNow(),
					installId: config.installId,
					sessionId: config.sessionId,
					extensionVersion: config.extensionVersion,
					platform: sanitizeValue(config.platform, "platform"),
					delivery: sanitizeValue(
						{
							status: highestBatchAttempt > 0 ? "retry" : "initial",
							attempt: highestBatchAttempt + 1,
							maxRetries: this.maxRetries,
							batchEventCount: batch.length,
							queuedEventCount: this.queue.length,
							requestTimeoutMs: this.requestTimeoutMs,
						},
						"delivery",
					),
					events: batch.map((item) => item.event),
				}),
				signal: controller.signal,
			})

			if (!response.ok && (response.status === 429 || response.status >= 500)) {
				throw new Error(`Remote diagnostics ingest failed with status ${response.status}`)
			}

			this.backoffUntil = 0
			this.droppedEventsSinceLastFlush = 0
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
					const droppedCount = this.queue.length - this.maxQueueSize
					this.queue.splice(this.maxQueueSize)
					this.droppedEventsSinceLastFlush += droppedCount
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

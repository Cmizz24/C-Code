import type { ProviderCapacityErrorKind, ProviderCapacityMetadata } from "@roo-code/types"

const PROVIDER_CAPACITY_METADATA_KEY = "providerCapacity" as const

type ErrorRecord = Record<string, any>

export interface ProviderCapacityExtractionOptions {
	provider?: string
	defaultKind?: ProviderCapacityErrorKind
	fallbackMessage?: string
}

export interface CreateProviderCapacityErrorOptions extends ProviderCapacityExtractionOptions {
	message: string
	status?: number
	code?: string
	retryAfter?: string | number | null
	details?: string
	body?: string
	responseBody?: string
	cause?: unknown
}

function isRecord(value: unknown): value is ErrorRecord {
	return typeof value === "object" && value !== null
}

function stringifyDetails(value: unknown): string | undefined {
	if (value === undefined || value === null) {
		return undefined
	}

	if (typeof value === "string") {
		return value
	}

	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

export function parseRetryAfterMs(value: unknown, now = Date.now()): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined
	}

	if (typeof value === "number" && Number.isFinite(value)) {
		return value > 0 ? value * 1000 : undefined
	}

	const retryAfter = String(value).trim()
	if (!retryAfter) {
		return undefined
	}

	const seconds = Number(retryAfter)
	if (Number.isFinite(seconds)) {
		return seconds > 0 ? seconds * 1000 : undefined
	}

	const retryAt = Date.parse(retryAfter)
	if (Number.isFinite(retryAt)) {
		return Math.max(0, retryAt - now)
	}

	return undefined
}

function getHeaderValue(headers: unknown, name: string): unknown {
	if (!headers) {
		return undefined
	}

	if (typeof Headers !== "undefined" && headers instanceof Headers) {
		return headers.get(name) ?? headers.get(name.toLowerCase()) ?? headers.get(name.toUpperCase())
	}

	if (isRecord(headers)) {
		return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
	}

	return undefined
}

function getNestedValue(error: ErrorRecord, path: string[]): unknown {
	let current: unknown = error
	for (const part of path) {
		if (!isRecord(current)) {
			return undefined
		}
		current = current[part]
	}
	return current
}

function extractStatus(error: ErrorRecord): number | undefined {
	const statusCandidates = [
		error.status,
		error.statusCode,
		error.code,
		getNestedValue(error, ["error", "status"]),
		getNestedValue(error, ["error", "statusCode"]),
		getNestedValue(error, ["response", "status"]),
		getNestedValue(error, ["$metadata", "httpStatusCode"]),
	]

	for (const candidate of statusCandidates) {
		const status = typeof candidate === "number" ? candidate : Number(candidate)
		if (Number.isInteger(status) && status >= 100 && status <= 599) {
			return status
		}
	}

	return undefined
}

function extractCode(error: ErrorRecord): string | undefined {
	const code =
		error.code ?? error.type ?? getNestedValue(error, ["error", "code"]) ?? getNestedValue(error, ["error", "type"])
	return code === undefined || code === null ? undefined : String(code)
}

function extractMessage(error: unknown, fallbackMessage = "Provider request failed"): string {
	if (error instanceof Error && error.message) {
		return error.message
	}

	if (isRecord(error)) {
		const message =
			error.message ??
			getNestedValue(error, ["error", "message"]) ??
			getNestedValue(error, ["response", "data", "error", "message"])
		if (message !== undefined && message !== null && String(message).trim()) {
			return String(message)
		}
	}

	return fallbackMessage
}

function detectKind(
	status: number | undefined,
	code: string | undefined,
	signature: string,
): ProviderCapacityErrorKind | undefined {
	if (status === 429 || /\b(429|rate limit|rate_limit|too many requests)\b/i.test(signature)) {
		return "rate_limit"
	}

	if (/\b(insufficient_quota|quota|quota exceeded|exceeded your current quota)\b/i.test(signature)) {
		return "quota_exceeded"
	}

	if (
		/\b(usage limit|usage_limit|usage_limit_reached|monthly limit|billing hard limit|credit balance|exhausted)\b/i.test(
			signature,
		)
	) {
		return "usage_limit"
	}

	if (
		status === 401 ||
		status === 403 ||
		/\b(unauthorized|forbidden|authentication|auth|access denied|invalid api key)\b/i.test(signature)
	) {
		return "auth"
	}

	if (
		status === 503 ||
		/\b(capacity|overloaded|unavailable|temporarily unavailable|service unavailable)\b/i.test(signature)
	) {
		return "capacity"
	}

	if (status !== undefined && status >= 500) {
		return "provider_error"
	}

	if (code && /\b(rate_limit|insufficient_quota|quota|usage_limit|billing|capacity|overloaded)\b/i.test(code)) {
		return "provider_error"
	}

	return undefined
}

export function getProviderCapacityMetadata(error: unknown): ProviderCapacityMetadata | undefined {
	if (!isRecord(error)) {
		return undefined
	}

	const metadata = error[PROVIDER_CAPACITY_METADATA_KEY]
	return isRecord(metadata) ? (metadata as ProviderCapacityMetadata) : undefined
}

export function extractProviderCapacityMetadata(
	error: unknown,
	options: ProviderCapacityExtractionOptions = {},
): ProviderCapacityMetadata | undefined {
	const existing = getProviderCapacityMetadata(error)
	if (existing) {
		return {
			...existing,
			provider: existing.provider ?? options.provider,
		}
	}

	if (!isRecord(error) && !(error instanceof Error)) {
		return undefined
	}

	const record = error as ErrorRecord
	const status = extractStatus(record)
	const code = extractCode(record)
	const message = extractMessage(error, options.fallbackMessage)
	const details = stringifyDetails(
		record.errorDetails ?? record.details ?? getNestedValue(record, ["response", "data"]),
	)
	const responseBody = stringifyDetails(
		record.body ?? record.responseBody ?? getNestedValue(record, ["response", "body"]),
	)
	const retryAfter =
		getHeaderValue(record.headers, "retry-after") ??
		getHeaderValue(getNestedValue(record, ["response", "headers"]), "retry-after")
	const signature = [message, details, responseBody, code].filter(Boolean).join("\n")
	const kind = detectKind(status, code, signature) ?? options.defaultKind

	if (!kind) {
		return undefined
	}

	const retryAfterMs = parseRetryAfterMs(retryAfter)

	return {
		kind,
		message,
		provider: options.provider,
		status,
		code,
		retryAfter: retryAfter === undefined || retryAfter === null ? undefined : String(retryAfter),
		retryAfterMs,
		retryAt: retryAfterMs === undefined ? undefined : Date.now() + retryAfterMs,
		details,
		body: responseBody,
		responseBody,
		isRetryable: kind === "rate_limit" || kind === "capacity" || kind === "provider_error",
	}
}

export function isProviderCapacityError(error: unknown, options: ProviderCapacityExtractionOptions = {}): boolean {
	return extractProviderCapacityMetadata(error, options) !== undefined
}

export function attachProviderCapacityMetadata<T extends Error>(error: T, metadata: ProviderCapacityMetadata): T {
	;(error as ErrorRecord)[PROVIDER_CAPACITY_METADATA_KEY] = metadata
	if (metadata.status !== undefined) {
		;(error as ErrorRecord).status = metadata.status
	}
	if (metadata.code !== undefined) {
		;(error as ErrorRecord).code = metadata.code
	}
	if (metadata.details !== undefined) {
		;(error as ErrorRecord).errorDetails = metadata.details
	}
	return error
}

export function createProviderCapacityError(options: CreateProviderCapacityErrorOptions): Error {
	const error = new Error(options.message)
	if (options.cause !== undefined) {
		;(error as ErrorRecord).cause = options.cause
	}

	const retryAfterMs = parseRetryAfterMs(options.retryAfter)
	const metadata: ProviderCapacityMetadata = {
		kind: options.defaultKind ?? "provider_error",
		message: options.message,
		provider: options.provider,
		status: options.status,
		code: options.code,
		retryAfter:
			options.retryAfter === undefined || options.retryAfter === null ? undefined : String(options.retryAfter),
		retryAfterMs,
		retryAt: retryAfterMs === undefined ? undefined : Date.now() + retryAfterMs,
		details: options.details,
		body: options.body,
		responseBody: options.responseBody ?? options.body,
		isRetryable:
			options.defaultKind === "rate_limit" ||
			options.defaultKind === "capacity" ||
			options.defaultKind === "provider_error" ||
			options.status === 429 ||
			options.status === 503,
	}

	return attachProviderCapacityMetadata(error, metadata)
}

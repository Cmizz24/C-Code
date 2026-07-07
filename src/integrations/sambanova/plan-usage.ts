import type { SambaNovaPlanUsage } from "./types"

const SAMBANOVA_MODELS_URL = "https://api.sambanova.ai/v1/models"

type SambaNovaErrorResponse = {
	error?: {
		message?: unknown
		code?: unknown
	}
}

function parseSambaNovaErrorPayload(text: string): SambaNovaErrorResponse | undefined {
	if (!text.trim()) {
		return undefined
	}

	try {
		const payload = JSON.parse(text) as unknown
		return payload && typeof payload === "object" ? (payload as SambaNovaErrorResponse) : undefined
	} catch {
		return undefined
	}
}

function formatSambaNovaError(response: Response, text: string): string {
	const payload = parseSambaNovaErrorPayload(text)
	const errorMessage = typeof payload?.error?.message === "string" ? payload.error.message : undefined

	if (response.status === 401) {
		return "SambaNova API key is invalid or expired. Please check your API key."
	}

	if (response.status === 429) {
		return "SambaNova rate limit exceeded. Please wait before retrying."
	}

	const statusText = response.statusText ? ` ${response.statusText}` : ""
	const sanitizedMessage = errorMessage?.replace(/\s+/g, " ").trim()
	return `SambaNova usage request failed: ${response.status}${statusText}${sanitizedMessage ? ` - ${sanitizedMessage}` : ""}`
}

function parsePositiveInt(value: string | null): number | undefined {
	if (value === null) return undefined
	const num = parseInt(value, 10)
	return Number.isFinite(num) && num >= 0 ? num : undefined
}

function clampPercent(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.max(0, Math.min(100, value))
}

/**
 * Fetch SambaNova plan usage by making a lightweight GET /models call and
 * parsing rate-limit headers from the response.
 *
 * SambaNova rate-limit headers:
 * - `x-ratelimit-limit-requests` / `x-ratelimit-remaining-requests` (per minute)
 * - `x-ratelimit-limit-requests-day` / `x-ratelimit-remaining-requests-day` (per day)
 */
export async function fetchSambaNovaPlanUsage(apiKey: string): Promise<SambaNovaPlanUsage> {
	const fetchedAt = Date.now()
	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		Accept: "application/json",
	}

	// Make a lightweight call to list models — we only care about the response headers
	const response = await fetch(SAMBANOVA_MODELS_URL, { method: "GET", headers })

	if (!response.ok) {
		const text = await response.text().catch(() => "")
		throw new Error(formatSambaNovaError(response, text))
	}

	// Parse per-minute rate-limit headers
	const minuteLimit = parsePositiveInt(response.headers.get("x-ratelimit-limit-requests"))
	const minuteRemaining = parsePositiveInt(response.headers.get("x-ratelimit-remaining-requests"))

	// Parse per-day rate-limit headers
	const dayLimit = parsePositiveInt(response.headers.get("x-ratelimit-limit-requests-day"))
	const dayRemaining = parsePositiveInt(response.headers.get("x-ratelimit-remaining-requests-day"))

	let minuteUsedPercent: number | undefined
	if (minuteLimit !== undefined && minuteRemaining !== undefined && minuteLimit > 0) {
		minuteUsedPercent = clampPercent(((minuteLimit - minuteRemaining) / minuteLimit) * 100)
	}

	let dayUsedPercent: number | undefined
	if (dayLimit !== undefined && dayRemaining !== undefined && dayLimit > 0) {
		dayUsedPercent = clampPercent(((dayLimit - dayRemaining) / dayLimit) * 100)
	}

	return {
		...(minuteLimit !== undefined ? { minuteRequestLimit: minuteLimit } : {}),
		...(minuteRemaining !== undefined ? { minuteRequestsRemaining: minuteRemaining } : {}),
		...(minuteUsedPercent !== undefined ? { minuteUsedPercent } : {}),
		...(dayLimit !== undefined ? { dayRequestLimit: dayLimit } : {}),
		...(dayRemaining !== undefined ? { dayRequestsRemaining: dayRemaining } : {}),
		...(dayUsedPercent !== undefined ? { dayUsedPercent } : {}),
		fetchedAt,
	}
}

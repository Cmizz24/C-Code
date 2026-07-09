import type { ZAiPlanUsage } from "./types"

const ZAI_INTERNATIONAL_BASE = "https://api.z.ai"
const ZAI_CHINA_BASE = "https://open.bigmodel.cn"

type ZAiQuotaLimit = {
	limit_type?: "TOKENS_LIMIT" | "TIME_LIMIT"
	used?: number
	total?: number
	window_length_seconds?: number
	reset_at?: number
}

type ZAiQuotaLimitResponse = {
	limits?: ZAiQuotaLimit[]
}

type ZAiSubscriptionResponse = {
	plan_name?: string
	plan_type?: string
	name?: string
}

type ZAiErrorResponse = {
	error?: {
		message?: unknown
		code?: unknown
	}
}

function parseZAiErrorPayload(text: string): ZAiErrorResponse | undefined {
	if (!text.trim()) {
		return undefined
	}

	try {
		const payload = JSON.parse(text) as unknown
		return payload && typeof payload === "object" ? (payload as ZAiErrorResponse) : undefined
	} catch {
		return undefined
	}
}

function formatZAiError(response: Response, text: string): string {
	const payload = parseZAiErrorPayload(text)
	const errorCode = typeof payload?.error?.code === "string" ? payload.error.code : undefined
	const errorMessage = typeof payload?.error?.message === "string" ? payload.error.message : undefined

	if (response.status === 401 || errorCode === "unauthorized") {
		return "Z.AI API key is invalid or expired. Please check your API key."
	}

	const statusText = response.statusText ? ` ${response.statusText}` : ""
	const sanitizedMessage = errorMessage?.replace(/\s+/g, " ").trim()
	return `Z.AI usage request failed: ${response.status}${statusText}${sanitizedMessage ? ` - ${sanitizedMessage}` : ""}`
}

function secondsToMs(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1000) : undefined
}

function clampPercent(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.max(0, Math.min(100, value))
}

/**
 * Parse Z.AI quota limits into primary (sub-daily) and secondary (multi-day/weekly) windows.
 * The TOKENS_LIMIT with the shorter window is treated as the primary window.
 */
function parseQuotaLimits(limits: ZAiQuotaLimit[]): {
	primary?: ZAiPlanUsage["primary"]
	secondary?: ZAiPlanUsage["secondary"]
} {
	const tokenLimits = limits.filter((l) => l.limit_type === "TOKENS_LIMIT")

	if (tokenLimits.length === 0) {
		return {}
	}

	// Sort by window_length_seconds ascending so shorter windows come first
	const sorted = [...tokenLimits].sort((a, b) => {
		const aWindow = typeof a.window_length_seconds === "number" ? a.window_length_seconds : Infinity
		const bWindow = typeof b.window_length_seconds === "number" ? b.window_length_seconds : Infinity
		return aWindow - bWindow
	})

	const buildWindow = (limit: ZAiQuotaLimit) => {
		const used = typeof limit.used === "number" ? limit.used : 0
		const total = typeof limit.total === "number" && limit.total > 0 ? limit.total : 0
		const usedPercent = total > 0 ? clampPercent((used / total) * 100) : 0
		const windowLengthSeconds =
			typeof limit.window_length_seconds === "number" ? limit.window_length_seconds : undefined
		const resetAt = typeof limit.reset_at === "number" ? limit.reset_at : undefined

		return {
			usedPercent,
			...(windowLengthSeconds !== undefined ? { windowMinutes: Math.round(windowLengthSeconds / 60) } : {}),
			...(secondsToMs(resetAt) !== undefined ? { resetsAt: secondsToMs(resetAt) } : {}),
		}
	}

	const primary = sorted.length > 0 ? buildWindow(sorted[0]) : undefined
	const secondary = sorted.length > 1 ? buildWindow(sorted[1]) : undefined

	return { primary, secondary }
}

export async function fetchZAiPlanUsage(apiKey: string, isChina?: boolean): Promise<ZAiPlanUsage> {
	const fetchedAt = Date.now()
	const baseUrl = isChina ? ZAI_CHINA_BASE : ZAI_INTERNATIONAL_BASE
	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		Accept: "application/json",
	}

	// Fetch quota limits
	const quotaUrl = `${baseUrl}/api/monitor/usage/quota/limit`
	const quotaResponse = await fetch(quotaUrl, { method: "GET", headers })

	if (!quotaResponse.ok) {
		const text = await quotaResponse.text().catch(() => "")
		throw new Error(formatZAiError(quotaResponse, text))
	}

	const quotaJson = (await quotaResponse.json()) as unknown
	const quotaData = (quotaJson && typeof quotaJson === "object" ? quotaJson : {}) as ZAiQuotaLimitResponse

	if (!quotaData.limits || !Array.isArray(quotaData.limits) || quotaData.limits.length === 0) {
		throw new Error("Z.AI usage response did not include quota limits")
	}

	const { primary, secondary } = parseQuotaLimits(quotaData.limits)

	if (!primary && !secondary) {
		throw new Error("Z.AI usage response did not include TOKENS_LIMIT entries")
	}

	// Best-effort fetch plan name
	let planType: string | undefined
	try {
		const subUrl = `${baseUrl}/api/biz/subscription/list`
		const subResponse = await fetch(subUrl, { method: "GET", headers })

		if (subResponse.ok) {
			const subJson = (await subResponse.json()) as unknown
			const subData = (subJson && typeof subJson === "object" ? subJson : {}) as ZAiSubscriptionResponse

			if (typeof subData === "object" && subData !== null) {
				// Try different possible plan name fields
				planType =
					typeof subData.plan_name === "string"
						? subData.plan_name
						: typeof subData.plan_type === "string"
							? subData.plan_type
							: typeof subData.name === "string"
								? subData.name
								: undefined
			}
		}
	} catch {
		// Subscription info is best-effort; ignore errors
	}

	return {
		...(primary ? { primary } : {}),
		...(secondary ? { secondary } : {}),
		...(planType ? { planType } : {}),
		fetchedAt,
	}
}

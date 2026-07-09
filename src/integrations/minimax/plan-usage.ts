import type { MiniMaxPlanUsage } from "./types"

const MINIMAX_INTERNATIONAL_BASE = "https://www.minimax.io"
const MINIMAX_CHINA_BASE = "https://www.minimaxi.com"

type MiniMaxRemainsResponse = {
	code?: number
	msg?: string
	data?: {
		total_tokens?: number
		total_cost?: number
		plan_name?: string
		remains?: Array<{
			grant_type?: string
			initial_amount?: number
			used_amount?: number
			remain_amount?: number
			expire_time?: string
			goods_name?: string
		}>
	}
}

type MiniMaxErrorResponse = {
	code?: number
	msg?: string
	error?: {
		message?: unknown
		code?: unknown
	}
}

function parseMiniMaxErrorPayload(text: string): MiniMaxErrorResponse | undefined {
	if (!text.trim()) {
		return undefined
	}

	try {
		const payload = JSON.parse(text) as unknown
		return payload && typeof payload === "object" ? (payload as MiniMaxErrorResponse) : undefined
	} catch {
		return undefined
	}
}

function formatMiniMaxError(response: Response, text: string): string {
	const payload = parseMiniMaxErrorPayload(text)
	const errorCode = typeof payload?.code === "number" ? payload.code : undefined
	const errorMessage =
		typeof payload?.msg === "string"
			? payload.msg
			: typeof payload?.error?.message === "string"
				? payload.error.message
				: undefined

	if (response.status === 401 || errorCode === 401) {
		return "MiniMax API key is invalid or expired. Please check your API key."
	}

	if (response.status === 403 || errorCode === 403) {
		return "MiniMax API key does not have access to token plan usage. Please check your API key permissions."
	}

	const statusText = response.statusText ? ` ${response.statusText}` : ""
	const sanitizedMessage = errorMessage?.replace(/\s+/g, " ").trim()
	return `MiniMax usage request failed: ${response.status}${statusText}${sanitizedMessage ? ` - ${sanitizedMessage}` : ""}`
}

function clampPercent(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.max(0, Math.min(100, value))
}

export async function fetchMiniMaxPlanUsage(apiKey: string, isChina?: boolean): Promise<MiniMaxPlanUsage> {
	const fetchedAt = Date.now()
	const baseUrl = isChina ? MINIMAX_CHINA_BASE : MINIMAX_INTERNATIONAL_BASE
	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
		Accept: "application/json",
	}

	const remainsUrl = `${baseUrl}/v1/token_plan/remains`
	const response = await fetch(remainsUrl, { method: "GET", headers })

	if (!response.ok) {
		const text = await response.text().catch(() => "")
		throw new Error(formatMiniMaxError(response, text))
	}

	const json = (await response.json()) as unknown
	const data = (json && typeof json === "object" ? json : {}) as MiniMaxRemainsResponse

	// Check for API-level error codes
	if (typeof data.code === "number" && data.code !== 0 && data.code !== 200) {
		const errorMsg = typeof data.msg === "string" ? data.msg : `API error code ${data.code}`
		throw new Error(`MiniMax usage response error: ${errorMsg}`)
	}

	const remains = Array.isArray(data.data?.remains) ? data.data.remains : []

	if (remains.length === 0) {
		// Try flat structure
		const totalTokens = typeof data.data?.total_tokens === "number" ? data.data.total_tokens : undefined
		const planName = typeof data.data?.plan_name === "string" ? data.data.plan_name : undefined

		return {
			...(totalTokens !== undefined ? { tokensTotal: totalTokens } : {}),
			...(planName ? { planName } : {}),
			fetchedAt,
		}
	}

	// Aggregate across all remaining grant entries
	let tokensUsed = 0
	let tokensRemaining = 0
	let tokensTotal = 0
	const planName = typeof data.data?.plan_name === "string" ? data.data.plan_name : undefined

	for (const entry of remains) {
		const used = typeof entry.used_amount === "number" ? entry.used_amount : 0
		const remain = typeof entry.remain_amount === "number" ? entry.remain_amount : 0
		const initial = typeof entry.initial_amount === "number" ? entry.initial_amount : 0

		tokensUsed += used
		tokensRemaining += remain
		tokensTotal += initial > 0 ? initial : used + remain
	}

	const usedPercent = tokensTotal > 0 ? clampPercent((tokensUsed / tokensTotal) * 100) : 0

	return {
		tokensUsed,
		tokensRemaining,
		tokensTotal: tokensTotal > 0 ? tokensTotal : undefined,
		usedPercent,
		...(planName ? { planName } : {}),
		fetchedAt,
	}
}

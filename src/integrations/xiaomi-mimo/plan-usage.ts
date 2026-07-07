import type { XiaomiMiMoPlanUsage } from "./types"

const XIAOMI_MIMO_PLATFORM_BASE = "https://platform.xiaomimimo.com"

type XiaomiMiMoUsageResponse = {
	code?: number
	message?: string
	data?: {
		credits_remaining?: number
		credits_used?: number
		credits_total?: number
		plan_name?: string
		plan_type?: string
		expire_time?: string
		items?: Array<{
			name?: string
			used?: number
			remaining?: number
			total?: number
			expire_time?: string
		}>
	}
}

type XiaomiMiMoDetailResponse = {
	code?: number
	message?: string
	data?: {
		plan_name?: string
		plan_type?: string
		plan_status?: string
		start_time?: string
		expire_time?: string
		credits_total?: number
		credits_used?: number
		credits_remaining?: number
	}
}

type XiaomiMiMoErrorResponse = {
	code?: number
	message?: string
	error?: {
		message?: unknown
		code?: unknown
	}
}

function parseXiaomiMiMoErrorPayload(text: string): XiaomiMiMoErrorResponse | undefined {
	if (!text.trim()) {
		return undefined
	}

	try {
		const payload = JSON.parse(text) as unknown
		return payload && typeof payload === "object" ? (payload as XiaomiMiMoErrorResponse) : undefined
	} catch {
		return undefined
	}
}

function formatXiaomiMiMoError(response: Response, text: string): string {
	const payload = parseXiaomiMiMoErrorPayload(text)
	const errorCode = typeof payload?.code === "number" ? payload.code : undefined
	const errorMessage =
		typeof payload?.message === "string"
			? payload.message
			: typeof payload?.error?.message === "string"
				? payload.error.message
				: undefined

	if (response.status === 401 || errorCode === 401) {
		return "Xiaomi MiMo cookie is invalid or expired. Please log in to mimo.mi.com and copy a fresh session cookie."
	}

	if (response.status === 403 || errorCode === 403) {
		return "Xiaomi MiMo cookie does not have access to plan usage. Please ensure you are logged in to the platform."
	}

	const statusText = response.statusText ? ` ${response.statusText}` : ""
	const sanitizedMessage = errorMessage?.replace(/\s+/g, " ").trim()
	return `Xiaomi MiMo usage request failed: ${response.status}${statusText}${sanitizedMessage ? ` - ${sanitizedMessage}` : ""}`
}

function clampPercent(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.max(0, Math.min(100, value))
}

function getTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone
	} catch {
		return "UTC"
	}
}

export async function fetchXiaomiMiMoPlanUsage(cookie: string): Promise<XiaomiMiMoPlanUsage> {
	const fetchedAt = Date.now()
	const timezone = getTimezone()
	const headers: Record<string, string> = {
		Cookie: cookie,
		"X-Timezone": timezone,
		Accept: "application/json",
	}

	// Fetch usage summary
	const usageUrl = `${XIAOMI_MIMO_PLATFORM_BASE}/api/v1/tokenPlan/usage`
	const usageResponse = await fetch(usageUrl, { method: "GET", headers })

	if (!usageResponse.ok) {
		const text = await usageResponse.text().catch(() => "")
		throw new Error(formatXiaomiMiMoError(usageResponse, text))
	}

	const usageJson = (await usageResponse.json()) as unknown
	const usageData = (usageJson && typeof usageJson === "object" ? usageJson : {}) as XiaomiMiMoUsageResponse

	// Check for API-level error codes
	if (typeof usageData.code === "number" && usageData.code !== 0 && usageData.code !== 200) {
		const errorMsg = typeof usageData.message === "string" ? usageData.message : `API error code ${usageData.code}`
		throw new Error(`Xiaomi MiMo usage response error: ${errorMsg}`)
	}

	let creditsRemaining: number | undefined
	let creditsUsed: number | undefined
	let creditsTotal: number | undefined
	let planName: string | undefined

	if (usageData.data) {
		creditsRemaining =
			typeof usageData.data.credits_remaining === "number" ? usageData.data.credits_remaining : undefined
		creditsUsed = typeof usageData.data.credits_used === "number" ? usageData.data.credits_used : undefined
		creditsTotal = typeof usageData.data.credits_total === "number" ? usageData.data.credits_total : undefined
		planName =
			typeof usageData.data.plan_name === "string"
				? usageData.data.plan_name
				: typeof usageData.data.plan_type === "string"
					? usageData.data.plan_type
					: undefined
	}

	// If usage data has items, aggregate from them
	if (Array.isArray(usageData.data?.items) && usageData.data!.items!.length > 0) {
		let aggUsed = 0
		let aggRemaining = 0
		let aggTotal = 0

		for (const item of usageData.data!.items!) {
			aggUsed += typeof item.used === "number" ? item.used : 0
			aggRemaining += typeof item.remaining === "number" ? item.remaining : 0
			aggTotal += typeof item.total === "number" ? item.total : 0
		}

		creditsUsed = aggUsed
		creditsRemaining = aggRemaining
		creditsTotal = aggTotal > 0 ? aggTotal : undefined
	}

	// Best-effort fetch detail for plan name if not already available
	if (!planName) {
		try {
			const detailUrl = `${XIAOMI_MIMO_PLATFORM_BASE}/api/v1/tokenPlan/detail`
			const detailResponse = await fetch(detailUrl, { method: "GET", headers })

			if (detailResponse.ok) {
				const detailJson = (await detailResponse.json()) as unknown
				const detailData = (
					detailJson && typeof detailJson === "object" ? detailJson : {}
				) as XiaomiMiMoDetailResponse

				if (detailData.data) {
					planName =
						typeof detailData.data.plan_name === "string"
							? detailData.data.plan_name
							: typeof detailData.data.plan_type === "string"
								? detailData.data.plan_type
								: undefined

					// Also use detail data for credits if usage didn't provide them
					if (creditsRemaining === undefined && typeof detailData.data.credits_remaining === "number") {
						creditsRemaining = detailData.data.credits_remaining
					}
					if (creditsUsed === undefined && typeof detailData.data.credits_used === "number") {
						creditsUsed = detailData.data.credits_used
					}
					if (creditsTotal === undefined && typeof detailData.data.credits_total === "number") {
						creditsTotal = detailData.data.credits_total
					}
				}
			}
		} catch {
			// Detail fetch is best-effort; ignore errors
		}
	}

	const total =
		creditsTotal ??
		(creditsUsed !== undefined && creditsRemaining !== undefined ? creditsUsed + creditsRemaining : undefined)
	const usedPercent =
		creditsUsed !== undefined && total !== undefined && total > 0 ? clampPercent((creditsUsed / total) * 100) : 0

	return {
		...(creditsRemaining !== undefined ? { creditsRemaining } : {}),
		...(creditsUsed !== undefined ? { creditsUsed } : {}),
		...(total !== undefined ? { creditsTotal: total } : {}),
		usedPercent,
		...(planName ? { planName } : {}),
		fetchedAt,
	}
}

import type { MoonshotPlanUsage } from "./types"

const MOONSHOT_BALANCE_URL = "https://api.moonshot.ai/v1/balance"

type MoonshotBalanceResponse = {
	data?: {
		balance?: number
		total_balance?: number
		currency?: string
		granted_balance?: number
		topped_up_balance?: number
	}
	balance?: number
	available_balance?: number
}

type MoonshotErrorResponse = {
	error?: {
		message?: unknown
		code?: unknown
		type?: unknown
	}
}

function parseMoonshotErrorPayload(text: string): MoonshotErrorResponse | undefined {
	if (!text.trim()) {
		return undefined
	}

	try {
		const payload = JSON.parse(text) as unknown
		return payload && typeof payload === "object" ? (payload as MoonshotErrorResponse) : undefined
	} catch {
		return undefined
	}
}

function formatMoonshotError(response: Response, text: string): string {
	const payload = parseMoonshotErrorPayload(text)
	const errorCode = typeof payload?.error?.code === "string" ? payload.error.code : undefined
	const errorMessage = typeof payload?.error?.message === "string" ? payload.error.message : undefined

	if (response.status === 401 || errorCode === "unauthorized" || errorCode === "invalid_authentication") {
		return "Moonshot/Kimi API key is invalid or expired. Please check your API key."
	}

	if (response.status === 402 || errorCode === "insufficient_balance") {
		return "Moonshot/Kimi account has insufficient balance. Please recharge your account."
	}

	const statusText = response.statusText ? ` ${response.statusText}` : ""
	const sanitizedMessage = errorMessage?.replace(/\s+/g, " ").trim()
	return `Moonshot/Kimi usage request failed: ${response.status}${statusText}${sanitizedMessage ? ` - ${sanitizedMessage}` : ""}`
}

export async function fetchMoonshotPlanUsage(apiKey: string): Promise<MoonshotPlanUsage> {
	const fetchedAt = Date.now()
	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		Accept: "application/json",
	}

	const response = await fetch(MOONSHOT_BALANCE_URL, { method: "GET", headers })

	if (!response.ok) {
		const text = await response.text().catch(() => "")
		throw new Error(formatMoonshotError(response, text))
	}

	const json = (await response.json()) as unknown
	const data = (json && typeof json === "object" ? json : {}) as MoonshotBalanceResponse

	// Try nested data.balance first (standard OpenAI-compatible format), then top-level fields
	const balance =
		typeof data.data?.balance === "number"
			? data.data.balance
			: typeof data.data?.total_balance === "number"
				? data.data.total_balance
				: typeof data.balance === "number"
					? data.balance
					: typeof data.available_balance === "number"
						? data.available_balance
						: undefined

	const currency = typeof data.data?.currency === "string" ? data.data.currency : undefined

	if (balance === undefined) {
		throw new Error("Moonshot/Kimi usage response did not include balance information")
	}

	return {
		balance,
		...(currency ? { currency } : {}),
		fetchedAt,
	}
}

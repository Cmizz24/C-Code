import type { PoePlanUsage } from "./types"

const POE_BALANCE_URL = "https://api.poe.com/usage/current_balance"

type PoeBalanceResponse = {
	current_point_balance?: number
}

type PoeBalanceErrorResponse = {
	error?: {
		message?: unknown
		code?: unknown
	}
}

function parsePoeBalanceErrorPayload(text: string): PoeBalanceErrorResponse | undefined {
	if (!text.trim()) {
		return undefined
	}

	try {
		const payload = JSON.parse(text) as unknown
		return payload && typeof payload === "object" ? (payload as PoeBalanceErrorResponse) : undefined
	} catch {
		return undefined
	}
}

function formatPoeBalanceError(response: Response, text: string): string {
	const payload = parsePoeBalanceErrorPayload(text)
	const errorMessage = typeof payload?.error?.message === "string" ? payload.error.message : undefined

	if (response.status === 401) {
		return "Poe API key is invalid or expired. Please check your API key."
	}

	if (response.status === 402) {
		return "Poe account has insufficient balance. Please top up your account."
	}

	const statusText = response.statusText ? ` ${response.statusText}` : ""
	const sanitizedMessage = errorMessage?.replace(/\s+/g, " ").trim()
	return `Poe usage request failed: ${response.status}${statusText}${sanitizedMessage ? ` - ${sanitizedMessage}` : ""}`
}

export async function fetchPoePlanUsage(apiKey: string): Promise<PoePlanUsage> {
	const fetchedAt = Date.now()
	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		Accept: "application/json",
	}

	const response = await fetch(POE_BALANCE_URL, { method: "GET", headers })

	if (!response.ok) {
		const text = await response.text().catch(() => "")
		throw new Error(formatPoeBalanceError(response, text))
	}

	const json = (await response.json()) as unknown
	const data = (json && typeof json === "object" ? json : {}) as PoeBalanceResponse

	if (typeof data.current_point_balance !== "number") {
		throw new Error("Poe usage response did not include current_point_balance")
	}

	return {
		currentPointBalance: data.current_point_balance,
		fetchedAt,
	}
}

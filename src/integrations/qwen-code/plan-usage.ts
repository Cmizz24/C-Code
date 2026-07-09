import { promises as fs } from "node:fs"
import * as os from "os"
import * as path from "path"

import type { QwenCodePlanUsage } from "./types"

const QWEN_DIR = ".qwen"
const QWEN_CREDENTIAL_FILENAME = "oauth_creds.json"

/**
 * DashScope / Qwen Code rate-limit header names.
 * These follow the OpenAI-compatible convention used by DashScope.
 */
const HEADER_REMAINING = "x-ratelimit-remaining-requests"
const HEADER_LIMIT = "x-ratelimit-limit-requests"
const HEADER_RESET = "x-ratelimit-reset-requests"

/** Secondary (daily) window headers, if present */
const HEADER_REMAINING_DAY = "x-ratelimit-remaining-requests-day"
const HEADER_LIMIT_DAY = "x-ratelimit-limit-requests-day"

interface QwenOAuthCredentials {
	access_token: string
	refresh_token?: string
	token_type?: string
	expiry_date?: number
	resource_url?: string
}

function getQwenCachedCredentialPath(customPath?: string): string {
	if (customPath) {
		if (customPath.startsWith("~/")) {
			return path.join(os.homedir(), customPath.slice(2))
		}
		return path.resolve(customPath)
	}
	return path.join(os.homedir(), QWEN_DIR, QWEN_CREDENTIAL_FILENAME)
}

function getBaseUrl(creds: QwenOAuthCredentials): string {
	let baseUrl = creds.resource_url || "https://dashscope.aliyuncs.com/compatible-mode/v1"
	if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
		baseUrl = `https://${baseUrl}`
	}
	return baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`
}

function formatQwenError(response: Response, text: string): string {
	if (response.status === 401) {
		return "Qwen Code OAuth token is invalid or expired. Please re-authenticate."
	}

	let errorMessage: string | undefined
	try {
		const payload = JSON.parse(text) as unknown
		if (payload && typeof payload === "object") {
			const err = (payload as { error?: { message?: unknown } }).error
			if (err && typeof err.message === "string") {
				errorMessage = err.message
			}
		}
	} catch {
		// ignore parse errors
	}

	const statusText = response.statusText ? ` ${response.statusText}` : ""
	const sanitizedMessage = errorMessage?.replace(/\s+/g, " ").trim()
	return `Qwen Code usage request failed: ${response.status}${statusText}${sanitizedMessage ? ` - ${sanitizedMessage}` : ""}`
}

function parsePositiveInt(value: string | null): number | undefined {
	if (value === null) return undefined
	const num = parseInt(value, 10)
	return Number.isFinite(num) && num >= 0 ? num : undefined
}

/**
 * Fetch Qwen Code plan usage by reading OAuth credentials and making a
 * lightweight API call (list models) to retrieve rate-limit headers.
 *
 * @param oauthPath Optional custom path to the OAuth credentials file.
 */
export async function fetchQwenCodePlanUsage(oauthPath?: string): Promise<QwenCodePlanUsage> {
	const fetchedAt = Date.now()

	// Load OAuth credentials
	const credPath = getQwenCachedCredentialPath(oauthPath)
	let credsStr: string
	try {
		credsStr = await fs.readFile(credPath, "utf-8")
	} catch (error) {
		throw new Error(`Failed to read Qwen OAuth credentials from ${credPath}: ${error}`)
	}

	let creds: QwenOAuthCredentials
	try {
		creds = JSON.parse(credsStr) as QwenOAuthCredentials
	} catch {
		throw new Error(`Failed to parse Qwen OAuth credentials from ${credPath}`)
	}

	if (!creds.access_token) {
		throw new Error("Qwen OAuth credentials do not contain an access_token")
	}

	const baseUrl = getBaseUrl(creds)
	const headers: Record<string, string> = {
		Authorization: `Bearer ${creds.access_token}`,
		Accept: "application/json",
		"User-Agent": `QwenCode/1.0.0 (${os.platform()}; ${os.arch()})`,
		"X-DashScope-AuthType": "qwen-oauth",
	}

	// Make a lightweight call to list models — we only care about the response headers
	const modelsUrl = `${baseUrl}/models`
	const response = await fetch(modelsUrl, { method: "GET", headers })

	if (!response.ok) {
		const text = await response.text().catch(() => "")
		throw new Error(formatQwenError(response, text))
	}

	// Parse rate-limit headers
	const limit = parsePositiveInt(response.headers.get(HEADER_LIMIT))
	const remaining = parsePositiveInt(response.headers.get(HEADER_REMAINING))
	const limitDay = parsePositiveInt(response.headers.get(HEADER_LIMIT_DAY))
	const remainingDay = parsePositiveInt(response.headers.get(HEADER_REMAINING_DAY))

	let usedPercent: number | undefined
	if (limit !== undefined && remaining !== undefined && limit > 0) {
		usedPercent = Math.max(0, Math.min(100, ((limit - remaining) / limit) * 100))
	}

	let secondaryUsedPercent: number | undefined
	// Secondary info is returned in separate fields rather than computing percent here

	return {
		...(limit !== undefined ? { requestLimit: limit } : {}),
		...(remaining !== undefined ? { requestsRemaining: remaining } : {}),
		...(usedPercent !== undefined ? { usedPercent, windowLabel: "5h" } : {}),
		...(limitDay !== undefined ? { secondaryRequestLimit: limitDay } : {}),
		...(remainingDay !== undefined ? { secondaryRequestsRemaining: remainingDay } : {}),
		...(limitDay !== undefined ? { secondaryWindowLabel: "day" } : {}),
		fetchedAt,
	}
}

/**
 * Qwen Code plan usage information fetched from the DashScope API.
 *
 * Qwen Code Coding Plan uses request-based quotas:
 * - 6,000 requests per 5 hours
 * - 45,000 requests per week
 * - 90,000 requests per month
 *
 * Usage is detected from rate-limit headers on a lightweight API call.
 */
export interface QwenCodePlanUsage {
	/** Request limit for the primary (short) window, when detected */
	requestLimit?: number
	/** Requests remaining in the primary window, when detected */
	requestsRemaining?: number
	/** Used percent in 0–100 for the primary window */
	usedPercent?: number
	/** Window label (e.g. "5h", "day"), when detected */
	windowLabel?: string
	/** Request limit for the secondary (longer) window, when detected */
	secondaryRequestLimit?: number
	/** Requests remaining in the secondary window, when detected */
	secondaryRequestsRemaining?: number
	/** Secondary window label (e.g. "week", "month"), when detected */
	secondaryWindowLabel?: string
	/** Timestamp when this was fetched (unix ms since epoch) */
	fetchedAt: number
}

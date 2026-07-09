/**
 * SambaNova plan usage information fetched from rate-limit headers.
 *
 * SambaNova returns rate limit info in response headers:
 * - `x-ratelimit-limit-requests` / `x-ratelimit-remaining-requests` (per minute)
 * - `x-ratelimit-limit-requests-day` / `x-ratelimit-remaining-requests-day` (per day)
 */
export interface SambaNovaPlanUsage {
	/** Per-minute request limit */
	minuteRequestLimit?: number
	/** Per-minute requests remaining */
	minuteRequestsRemaining?: number
	/** Per-minute used percent in 0–100 */
	minuteUsedPercent?: number
	/** Per-day request limit */
	dayRequestLimit?: number
	/** Per-day requests remaining */
	dayRequestsRemaining?: number
	/** Per-day used percent in 0–100 */
	dayUsedPercent?: number
	/** Timestamp when this was fetched (unix ms since epoch) */
	fetchedAt: number
}

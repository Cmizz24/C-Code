/**
 * MiniMax plan usage information fetched from the MiniMax API.
 */
export interface MiniMaxPlanUsage {
	/** Tokens used (total, across all windows) */
	tokensUsed?: number
	/** Tokens remaining (total, across all windows) */
	tokensRemaining?: number
	/** Total tokens allocated in the plan */
	tokensTotal?: number
	/** Percentage used (0–100) */
	usedPercent?: number
	/** Plan name, when provided */
	planName?: string
	/** Timestamp when this was fetched (unix ms since epoch) */
	fetchedAt: number
}

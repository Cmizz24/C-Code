/**
 * Moonshot/Kimi plan usage information fetched from the Moonshot API.
 */
export interface MoonshotPlanUsage {
	/** Current account balance */
	balance: number
	/** Currency of the balance (e.g. "CNY", "USD"), when provided */
	currency?: string
	/** Timestamp when this was fetched (unix ms since epoch) */
	fetchedAt: number
}

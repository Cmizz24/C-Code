/**
 * Poe plan usage information fetched from the Poe API.
 */
export interface PoePlanUsage {
	/** Current point balance */
	currentPointBalance: number
	/** Timestamp when this was fetched (unix ms since epoch) */
	fetchedAt: number
}

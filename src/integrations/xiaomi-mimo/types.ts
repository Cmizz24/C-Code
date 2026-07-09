/**
 * Xiaomi MiMo plan usage information fetched from the MiMo platform API.
 */
export interface XiaomiMiMoPlanUsage {
	/** Credits remaining */
	creditsRemaining?: number
	/** Credits used */
	creditsUsed?: number
	/** Total credits allocated */
	creditsTotal?: number
	/** Percentage used (0–100) */
	usedPercent?: number
	/** Plan name, when provided */
	planName?: string
	/** Timestamp when this was fetched (unix ms since epoch) */
	fetchedAt: number
}

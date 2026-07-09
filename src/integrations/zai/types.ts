/**
 * Z.AI / GLM plan usage information fetched from the Z.AI API.
 */
export interface ZAiPlanUsage {
	primary?: {
		/** Used percent in 0–100 (sub-daily window) */
		usedPercent: number
		/** Window length in minutes, when provided */
		windowMinutes?: number
		/** Reset time (unix ms since epoch), when provided */
		resetsAt?: number
	}
	secondary?: {
		/** Used percent in 0–100 (multi-day/weekly window) */
		usedPercent: number
		/** Window length in minutes, when provided */
		windowMinutes?: number
		/** Reset time (unix ms since epoch), when provided */
		resetsAt?: number
	}
	planType?: string
	/** Timestamp when this was fetched (unix ms since epoch) */
	fetchedAt: number
}

import type { HistoryItem, TokenUsage } from "@roo-code/types"

export interface AggregatedCosts {
	ownCost: number // This task's own API costs
	childrenCost: number // Sum of all direct children costs (recursive)
	totalCost: number // ownCost + childrenCost
	childBreakdown?: {
		// Optional detailed breakdown
		[childId: string]: AggregatedCosts
	}
}

export interface AggregateTaskCostsOptions {
	/** Discover children linked by metadata, e.g. background parallel agents with parentTaskId. */
	getChildTaskIds?: (parentId: string) => Promise<string[]>
	/** Count API requests from persisted task messages when available. */
	getTaskRequestCount?: (taskId: string) => Promise<number | undefined>
}

export interface AggregatedTokenUsage {
	tokenUsage: TokenUsage
	requestCount: number
}

const toFiniteNumber = (value: number | undefined): number =>
	typeof value === "number" && Number.isFinite(value) ? value : 0

const createEmptyTokenUsage = (): TokenUsage => ({
	totalTokensIn: 0,
	totalTokensOut: 0,
	totalCacheWrites: 0,
	totalCacheReads: 0,
	totalCost: 0,
	contextTokens: 0,
})

/**
 * Recursively aggregate costs for a task and all its subtasks.
 *
 * @param taskId - The task ID to aggregate costs for
 * @param getTaskHistory - Function to load HistoryItem by task ID
 * @param optionsOrVisited - Optional callbacks for metadata-linked children, or legacy visited Set
 * @param visited - Set to prevent circular references
 * @returns Aggregated cost information
 */
export async function aggregateTaskCostsRecursive(
	taskId: string,
	getTaskHistory: (id: string) => Promise<HistoryItem | undefined>,
	optionsOrVisited: AggregateTaskCostsOptions | Set<string> = {},
	visited: Set<string> = new Set(),
): Promise<AggregatedCosts> {
	const options = optionsOrVisited instanceof Set ? {} : optionsOrVisited
	const currentVisited = optionsOrVisited instanceof Set ? optionsOrVisited : visited

	// Prevent infinite loops
	if (currentVisited.has(taskId)) {
		console.warn(`[aggregateTaskCostsRecursive] Circular reference detected: ${taskId}`)
		return { ownCost: 0, childrenCost: 0, totalCost: 0 }
	}
	currentVisited.add(taskId)

	// Load this task's history
	const history = await getTaskHistory(taskId)
	if (!history) {
		console.warn(`[aggregateTaskCostsRecursive] Task ${taskId} not found`)
		return { ownCost: 0, childrenCost: 0, totalCost: 0 }
	}

	const ownCost = history.totalCost || 0
	let childrenCost = 0
	const childBreakdown: { [childId: string]: AggregatedCosts } = {}
	const childIds = new Set(history.childIds ?? [])

	if (options.getChildTaskIds) {
		for (const childId of await options.getChildTaskIds(taskId)) {
			childIds.add(childId)
		}
	}

	// Recursively aggregate child costs
	if (childIds.size > 0) {
		for (const childId of childIds) {
			const childAggregated = await aggregateTaskCostsRecursive(
				childId,
				getTaskHistory,
				options,
				new Set(currentVisited), // Create new Set to allow sibling traversal
			)
			childrenCost += childAggregated.totalCost
			childBreakdown[childId] = childAggregated
		}
	}

	const result: AggregatedCosts = {
		ownCost,
		childrenCost,
		totalCost: ownCost + childrenCost,
		childBreakdown,
	}

	return result
}

export async function aggregateTaskTokenUsageRecursive(
	taskId: string,
	getTaskHistory: (id: string) => Promise<HistoryItem | undefined>,
	optionsOrVisited: AggregateTaskCostsOptions | Set<string> = {},
	visited: Set<string> = new Set(),
): Promise<AggregatedTokenUsage> {
	const options = optionsOrVisited instanceof Set ? {} : optionsOrVisited
	const currentVisited = optionsOrVisited instanceof Set ? optionsOrVisited : visited

	if (currentVisited.has(taskId)) {
		console.warn(`[aggregateTaskTokenUsageRecursive] Circular reference detected: ${taskId}`)
		return { tokenUsage: createEmptyTokenUsage(), requestCount: 0 }
	}
	currentVisited.add(taskId)

	const history = await getTaskHistory(taskId)
	if (!history) {
		console.warn(`[aggregateTaskTokenUsageRecursive] Task ${taskId} not found`)
		return { tokenUsage: createEmptyTokenUsage(), requestCount: 0 }
	}

	const tokenUsage: TokenUsage = {
		totalTokensIn: toFiniteNumber(history.tokensIn),
		totalTokensOut: toFiniteNumber(history.tokensOut),
		totalCacheWrites: toFiniteNumber(history.cacheWrites),
		totalCacheReads: toFiniteNumber(history.cacheReads),
		totalCost: toFiniteNumber(history.totalCost),
		contextTokens: 0,
	}
	const persistedRequestCount = await options.getTaskRequestCount?.(taskId)
	let requestCount =
		typeof persistedRequestCount === "number" && Number.isFinite(persistedRequestCount)
			? persistedRequestCount
			: tokenUsage.totalTokensIn > 0 || tokenUsage.totalTokensOut > 0 || tokenUsage.totalCost > 0
				? 1
				: 0
	const childIds = new Set(history.childIds ?? [])

	if (options.getChildTaskIds) {
		for (const childId of await options.getChildTaskIds(taskId)) {
			childIds.add(childId)
		}
	}

	for (const childId of childIds) {
		const childAggregated = await aggregateTaskTokenUsageRecursive(
			childId,
			getTaskHistory,
			options,
			new Set(currentVisited),
		)

		tokenUsage.totalTokensIn += childAggregated.tokenUsage.totalTokensIn
		tokenUsage.totalTokensOut += childAggregated.tokenUsage.totalTokensOut
		tokenUsage.totalCacheWrites =
			toFiniteNumber(tokenUsage.totalCacheWrites) + toFiniteNumber(childAggregated.tokenUsage.totalCacheWrites)
		tokenUsage.totalCacheReads =
			toFiniteNumber(tokenUsage.totalCacheReads) + toFiniteNumber(childAggregated.tokenUsage.totalCacheReads)
		tokenUsage.totalCost += childAggregated.tokenUsage.totalCost
		requestCount += childAggregated.requestCount
	}

	return { tokenUsage, requestCount }
}

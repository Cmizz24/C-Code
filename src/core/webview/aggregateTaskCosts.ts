import type { HistoryItem } from "@roo-code/types"

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
}

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

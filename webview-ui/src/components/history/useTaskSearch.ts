import { useState, useEffect, useMemo } from "react"
import { Fzf } from "fzf"
import type { HistoryItem } from "@roo-code/types"

import { highlightFzfMatch } from "@/utils/highlight"
import { useExtensionState } from "@/context/ExtensionStateContext"

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

const aggregateTaskCost = (
	taskId: string,
	taskById: Map<string, HistoryItem>,
	childrenByParentId: Map<string, string[]>,
	visited: Set<string> = new Set(),
): number => {
	if (visited.has(taskId)) {
		return 0
	}

	visited.add(taskId)
	const task = taskById.get(taskId)
	if (!task) {
		return 0
	}

	let totalCost = task.totalCost || 0
	const childIds = new Set([...(task.childIds ?? []), ...(childrenByParentId.get(taskId) ?? [])])

	for (const childId of childIds) {
		totalCost += aggregateTaskCost(childId, taskById, childrenByParentId, new Set(visited))
	}

	return totalCost
}

export const useTaskSearch = () => {
	const { taskHistory, cwd } = useExtensionState()
	const [searchQuery, setSearchQuery] = useState("")
	const [sortOption, setSortOption] = useState<SortOption>("newest")
	const [lastNonRelevantSort, setLastNonRelevantSort] = useState<SortOption | null>("newest")
	const [showAllWorkspaces, setShowAllWorkspaces] = useState(false)

	useEffect(() => {
		if (searchQuery && sortOption !== "mostRelevant" && !lastNonRelevantSort) {
			setLastNonRelevantSort(sortOption)
			setSortOption("mostRelevant")
		} else if (!searchQuery && sortOption === "mostRelevant" && lastNonRelevantSort) {
			setSortOption(lastNonRelevantSort)
			setLastNonRelevantSort(null)
		}
	}, [searchQuery, sortOption, lastNonRelevantSort])

	const presentableTasks = useMemo(() => {
		const validTasks = taskHistory.filter((item) => item.ts && item.task)
		let tasks = validTasks
		if (!showAllWorkspaces) {
			tasks = tasks.filter((item) => item.workspace === cwd)
		}

		const taskById = new Map(validTasks.map((task) => [task.id, task]))
		const childrenByParentId = new Map<string, string[]>()

		for (const task of validTasks) {
			if (task.parentTaskId && taskById.has(task.parentTaskId)) {
				const siblings = childrenByParentId.get(task.parentTaskId) ?? []
				siblings.push(task.id)
				childrenByParentId.set(task.parentTaskId, siblings)
			}
		}

		return tasks.map((task) => ({
			...task,
			totalCost: aggregateTaskCost(task.id, taskById, childrenByParentId),
		}))
	}, [taskHistory, showAllWorkspaces, cwd])

	const fzf = useMemo(() => {
		return new Fzf(presentableTasks, {
			selector: (item) => item.task,
		})
	}, [presentableTasks])

	const tasks = useMemo(() => {
		let results = presentableTasks

		if (searchQuery) {
			const searchResults = fzf.find(searchQuery)
			results = searchResults.map((result) => {
				const positions = Array.from(result.positions)
				const taskEndIndex = result.item.task.length

				return {
					...result.item,
					highlight: highlightFzfMatch(
						result.item.task,
						positions.filter((p) => p < taskEndIndex),
					),
					workspace: result.item.workspace,
				}
			})
		}

		// Then sort the results
		return [...results].sort((a, b) => {
			switch (sortOption) {
				case "oldest":
					return (a.ts || 0) - (b.ts || 0)
				case "mostExpensive":
					return (b.totalCost || 0) - (a.totalCost || 0)
				case "mostTokens":
					const aTokens = (a.tokensIn || 0) + (a.tokensOut || 0) + (a.cacheWrites || 0) + (a.cacheReads || 0)
					const bTokens = (b.tokensIn || 0) + (b.tokensOut || 0) + (b.cacheWrites || 0) + (b.cacheReads || 0)
					return bTokens - aTokens
				case "mostRelevant":
					// Keep fuse order if searching, otherwise sort by newest
					return searchQuery ? 0 : (b.ts || 0) - (a.ts || 0)
				case "newest":
				default:
					return (b.ts || 0) - (a.ts || 0)
			}
		})
	}, [presentableTasks, searchQuery, fzf, sortOption])

	return {
		tasks,
		searchQuery,
		setSearchQuery,
		sortOption,
		setSortOption,
		lastNonRelevantSort,
		setLastNonRelevantSort,
		showAllWorkspaces,
		setShowAllWorkspaces,
	}
}

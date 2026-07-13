import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
	CONTEXT_CACHE_FULL_WARNING,
	ContextWindowManager,
	getContextCacheBudgetOptions,
	normalizeColdCacheRamBudgetMb,
} from "../ContextWindowManager"
import { ContextCacheBudgetCoordinator } from "../ContextCacheBudgetCoordinator"

describe("ContextWindowManager", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	function registerConversationTurn(
		manager: ContextWindowManager,
		content: string,
		messageTimestamp: number,
		tokens = 200,
	) {
		return manager.registerChunk({
			type: "conversation_turn",
			content,
			tokens,
			metadata: {
				messageTimestamps: [messageTimestamp],
			},
		})
	}

	it("normalizes cold cache RAM budgets to the supported settings options", () => {
		const options = getContextCacheBudgetOptions(32 * 1024 * 1024 * 1024)

		expect(normalizeColdCacheRamBudgetMb(undefined, options)).toBe(1024)
		expect(normalizeColdCacheRamBudgetMb(128, options)).toBe(1024)
		expect(normalizeColdCacheRamBudgetMb(1536, options)).toBe(2048)
		expect(normalizeColdCacheRamBudgetMb(7000, options)).toBe(8192)
		expect(normalizeColdCacheRamBudgetMb(65536, options)).toBe(8192)
	})

	it("generates dynamic cold cache RAM options with safe headroom and fallback", () => {
		expect(getContextCacheBudgetOptions().map((option) => option.valueMb)).toEqual([1024, 2048])
		expect(getContextCacheBudgetOptions(-1).map((option) => option.valueMb)).toEqual([1024, 2048])

		const options = getContextCacheBudgetOptions(64 * 1024 * 1024 * 1024)

		expect(options.map((option) => option.valueMb)).toEqual([
			1024, 2048, 3072, 4096, 5120, 6144, 8192, 10240, 12288, 14336, 16384,
		])
		expect(options.find((option) => option.valueMb === 1024)?.recommended).toBe(true)
		expect(options.find((option) => option.valueMb === 8192)?.recommended).toBe(false)
	})

	it("moves old conversation turns to cold cache, hides timestamps, and promotes retrieved matches", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 1000, coldCacheRamBudgetMb: 256 })

		vi.setSystemTime(1_000)
		registerConversationTurn(manager, "First evictable conversation turn about alpha", 101)

		vi.setSystemTime(2_000)
		registerConversationTurn(manager, "Second conversation turn about beta cache lookup", 102)

		vi.setSystemTime(125_000)
		registerConversationTurn(manager, "Current protected conversation turn", 999)

		const result = manager.handlePressure({
			totalTokens: 1000,
			allowedTokens: 650,
			protectedMessageTimestamps: [999],
		})

		expect(result).toEqual({ handled: true, movedChunks: 2, movedTokens: 400, warning: undefined })
		expect(manager.getHiddenMessageTimestamps()).toEqual(new Set([101, 102]))
		expect(manager.getStats()).toMatchObject({
			hotCacheTokens: 200,
			coldCacheChunks: 2,
			swapsThisSession: 2,
			condensingAvoided: 1,
		})
		expect(manager.drainEvents()).toEqual([
			expect.objectContaining({
				type: "condensing_avoided",
				chunkCount: 2,
				tokenCount: 400,
				reason: "request_pressure",
				source: "foreground_task",
				outcome: "moved",
			}),
		])
		expect(manager.drainEvents()).toEqual([])

		const matches = manager.askForContext("beta", { limit: 3 })

		expect(matches).toHaveLength(1)
		expect(matches[0]).toMatchObject({
			type: "conversation_turn",
			content: "Second conversation turn about beta cache lookup",
			tokens: 200,
		})
		expect(manager.getHiddenMessageTimestamps()).toEqual(new Set([101]))
		expect(manager.getStats()).toMatchObject({
			hotCacheTokens: 400,
			coldCacheChunks: 1,
			swapsThisSession: 3,
			condensingAvoided: 1,
		})
		expect(manager.drainEvents()).toEqual([
			expect.objectContaining({
				type: "chunks_pulled_from_cold",
				chunkCount: 1,
				tokenCount: 200,
				reason: "ask_for_context",
				outcome: "retrieved",
				query: "beta",
			}),
		])
	})

	it("provides cold-cache recall hints and invalidates them after retrieval promotion", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 1000, coldCacheRamBudgetMb: 256 })

		vi.setSystemTime(1_000)
		manager.registerChunk({
			type: "conversation_turn",
			content: "Important alpha helper implementation details swapped out of hot context",
			tokens: 20,
			metadata: { filePath: "src/alpha.ts", title: "alpha helper", messageTimestamps: [101] },
		})
		vi.setSystemTime(125_000)
		manager.updateOptions({ hotTokenBudget: 1 })

		const hint = manager.getRecallHint()

		expect(hint).toContain("Cold context cache hint")
		expect(hint).toContain("file=src/alpha.ts")
		expect(hint).toContain("Important alpha helper implementation")
		expect(hint).toContain("ask_for_context")

		const matches = manager.askForContext("alpha helper", { filePath: "src/alpha.ts" })

		expect(matches).toHaveLength(1)
		expect(manager.getRecallHint()).toBeUndefined()
		expect(manager.getStats()).toMatchObject({ coldCacheChunks: 0, hotCacheChunks: 1 })
	})

	it("does not emit cold-cache recall hints when only hot chunks exist", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 1000, coldCacheRamBudgetMb: 256 })

		manager.registerChunk({
			type: "file_content",
			content: "Hot context should not tell the model to recall cold data",
			tokens: 20,
			metadata: { filePath: "src/hot.ts" },
		})

		expect(manager.getRecallHint()).toBeUndefined()
	})

	it("keeps context cache events bounded", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 1 })

		for (let index = 0; index < 25; index++) {
			vi.setSystemTime(index * 61_000)
			registerConversationTurn(manager, `Conversation turn ${index}`, index, 2)
		}

		const events = manager.drainEvents()

		expect(events).toHaveLength(20)
		expect(events.every((event) => event.type === "chunks_moved_to_cold")).toBe(true)
		expect(new Set(events.map((event) => event.id)).size).toBe(20)
	})

	it("enforces the shared combined budget without duplicating cache events", () => {
		const coordinator = new ContextCacheBudgetCoordinator({ budgetBytes: 70 })
		const manager = new ContextWindowManager({
			hotTokenBudget: 1,
			coldCacheRamBudgetMb: 1,
			coldCacheBudgetOptions: [{ valueMb: 1, recommended: true }],
			cacheBudgetCoordinator: coordinator,
			metadata: {
				taskId: "task-1",
				instanceId: "instance-1",
				mode: "code",
				agentId: "agent-1",
				isBackground: true,
				isActive: () => false,
			},
		})

		vi.setSystemTime(1_000)
		registerConversationTurn(manager, "a".repeat(60), 101, 2)
		vi.setSystemTime(62_000)
		registerConversationTurn(manager, "b".repeat(60), 102, 2)

		const stats = manager.getStats()

		expect(stats).toMatchObject({
			hotCacheChunks: 1,
			coldCacheChunks: 0,
			combinedBudget: {
				hotCacheChunks: 1,
				coldCacheChunks: 0,
				managerCount: 1,
				evictions: { hot: 0, cold: 1, total: 1 },
			},
			evictions: { hot: 0, cold: 1, total: 1 },
		})
		expect(stats.contributors).toEqual([
			expect.objectContaining({
				id: "context-cache-contributor-1",
				label: "Background agent 1 (code)",
				mode: "code",
				isBackground: true,
				isActive: false,
				evictions: { hot: 0, cold: 1, total: 1 },
			}),
		])
		expect(JSON.stringify(stats.contributors)).not.toContain("task-1")
		expect(JSON.stringify(stats.contributors)).not.toContain("instance-1")
		expect(JSON.stringify(stats.contributors)).not.toContain("agent-1")
		expect(manager.getContextCacheBudgetSnapshot()).toMatchObject({
			taskId: "task-1",
			instanceId: "instance-1",
			mode: "code",
			agentId: "agent-1",
			isBackground: true,
			isActive: false,
			hotEvictions: 0,
			coldEvictions: 1,
		})
		expect(coordinator.getUsage()).toMatchObject({ usedBytes: 60, hotBytes: 60, coldBytes: 0 })
		expect(manager.drainEvents()).toEqual([
			expect.objectContaining({
				type: "chunks_moved_to_cold",
				chunkCount: 1,
				tokenCount: 2,
				reason: "hot_budget_trim",
				source: "background_agent",
				outcome: "moved",
			}),
			expect.objectContaining({
				type: "chunks_evicted_from_cache",
				chunkCount: 1,
				tokenCount: 2,
				reason: "combined_budget_eviction",
				source: "background_agent",
				outcome: "evicted",
			}),
		])
		expect(manager.drainEvents()).toEqual([])
	})

	it("merges duplicate cold-cache chunks without emitting repeated movement rows", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 1, coldCacheRamBudgetMb: 256 })

		vi.setSystemTime(1_000)
		registerConversationTurn(manager, "Repeated cache content", 101, 2)
		vi.setSystemTime(62_000)
		registerConversationTurn(manager, "Repeated cache content", 102, 2)
		vi.setSystemTime(123_000)
		registerConversationTurn(manager, "Repeated cache content", 103, 2)

		expect(manager.getStats()).toMatchObject({ coldCacheChunks: 1, swapsThisSession: 1 })
		expect(manager.getHiddenMessageTimestamps()).toEqual(new Set([101, 102]))

		const events = manager.drainEvents()
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			type: "chunks_moved_to_cold",
			chunkCount: 1,
			tokenCount: 2,
			reason: "hot_budget_trim",
			outcome: "moved",
		})
	})

	it("does not evict non-conversation chunks or protected conversation turns for request pressure", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 1000, coldCacheRamBudgetMb: 256 })

		manager.registerChunk({
			type: "file_content",
			content: "File content should remain hot during request pressure handling",
			tokens: 300,
			metadata: { filePath: "src/example.ts" },
		})
		registerConversationTurn(manager, "Latest protected conversation turn", 500, 300)

		const result = manager.handlePressure({
			totalTokens: 800,
			allowedTokens: 700,
			protectedMessageTimestamps: [500],
		})

		expect(result).toEqual({ handled: false, movedChunks: 0, movedTokens: 0, warning: undefined })
		expect(manager.getHiddenMessageTimestamps()).toEqual(new Set())
		expect(manager.getStats()).toMatchObject({ hotCacheTokens: 600, coldCacheChunks: 0, condensingAvoided: 0 })
	})

	it("keeps active-request-relevant hot context out of cold cache during pressure", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 1000, coldCacheRamBudgetMb: 256 })

		vi.setSystemTime(1_000)
		registerConversationTurn(
			manager,
			"Payment cache fix details for src/payments/cache.ts and retry key handling",
			101,
		)
		vi.setSystemTime(2_000)
		registerConversationTurn(manager, "Stale unrelated notes about archived terminal output", 102)
		vi.setSystemTime(125_000)
		registerConversationTurn(manager, "Current protected conversation turn", 999)

		const result = manager.handlePressure({
			totalTokens: 1000,
			allowedTokens: 800,
			protectedMessageTimestamps: [999],
			protectedQuery: "Please fix the payment cache retry key in src/payments/cache.ts",
		})

		expect(result).toEqual({ handled: true, movedChunks: 1, movedTokens: 200, warning: undefined })
		expect(manager.getHiddenMessageTimestamps()).toEqual(new Set([102]))
		expect(manager.getStats()).toMatchObject({ hotCacheTokens: 400, coldCacheChunks: 1 })
	})

	it("preserves recently added hot context instead of demoting it to satisfy pressure", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 1000, coldCacheRamBudgetMb: 256 })

		vi.setSystemTime(1_000)
		registerConversationTurn(manager, "Old stale conversation turn with no active request overlap", 101)
		vi.setSystemTime(125_000)
		registerConversationTurn(manager, "Recent useful hot context that should stay active", 102)

		const result = manager.handlePressure({
			totalTokens: 800,
			allowedTokens: 400,
		})

		expect(result).toEqual({ handled: false, movedChunks: 1, movedTokens: 200, warning: undefined })
		expect(manager.getHiddenMessageTimestamps()).toEqual(new Set([101]))
		expect(manager.getStats()).toMatchObject({ hotCacheTokens: 200, coldCacheChunks: 1, condensingAvoided: 0 })
	})

	it("protects recalled cold chunks from immediate re-demotion churn", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 600, coldCacheRamBudgetMb: 256 })

		vi.setSystemTime(1_000)
		registerConversationTurn(manager, "Alpha token details needed again after recall", 101)
		vi.setSystemTime(2_000)
		registerConversationTurn(manager, "Old filler context safe to demote after recall", 102)
		vi.setSystemTime(125_000)

		expect(manager.handlePressure({ totalTokens: 600, allowedTokens: 400 })).toEqual({
			handled: true,
			movedChunks: 1,
			movedTokens: 200,
			warning: undefined,
		})
		expect(manager.getHiddenMessageTimestamps()).toEqual(new Set([101]))

		vi.setSystemTime(126_000)
		const matches = manager.askForContext("alpha token", { limit: 3 })

		expect(matches).toHaveLength(1)
		expect(manager.getHiddenMessageTimestamps()).toEqual(new Set())

		vi.setSystemTime(127_000)
		manager.updateOptions({ hotTokenBudget: 199 })

		expect(manager.getHiddenMessageTimestamps()).toEqual(new Set([102]))
		expect(manager.getStats()).toMatchObject({ hotCacheChunks: 1, coldCacheChunks: 1 })
		expect(manager.askForContext("alpha token", { limit: 3 })).toEqual([])
	})

	it("does not emit success-looking cache events when pressure movement still requires fallback", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 1000, coldCacheRamBudgetMb: 256 })

		vi.setSystemTime(1_000)
		registerConversationTurn(manager, "Only evictable conversation turn", 101, 200)
		vi.setSystemTime(62_000)
		registerConversationTurn(manager, "Latest protected conversation turn", 999, 200)
		vi.setSystemTime(123_000)

		const result = manager.handlePressure({
			totalTokens: 1000,
			allowedTokens: 700,
			protectedMessageTimestamps: [999],
		})

		expect(result).toEqual({ handled: false, movedChunks: 1, movedTokens: 200, warning: undefined })
		expect(manager.getHiddenMessageTimestamps()).toEqual(new Set([101]))
		expect(manager.getStats()).toMatchObject({ hotCacheTokens: 200, coldCacheChunks: 1, condensingAvoided: 0 })
		expect(manager.drainEvents()).toEqual([])

		const repeatedResult = manager.handlePressure({
			totalTokens: 1000,
			allowedTokens: 700,
			protectedMessageTimestamps: [999],
		})

		expect(repeatedResult).toEqual({ handled: false, movedChunks: 0, movedTokens: 0, warning: undefined })
		expect(manager.drainEvents()).toEqual([])
	})

	it("surfaces the cold-cache-full warning when cold cache rejects pressure chunks", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 1000, coldCacheRamBudgetMb: 256 })
		vi.setSystemTime(1_000)
		registerConversationTurn(manager, "Conversation turn that cannot be accepted by cold cache", 700, 200)
		vi.setSystemTime(62_000)

		vi.spyOn((manager as any).coldCache, "add").mockReturnValue({ accepted: false, evicted: [] })

		const result = manager.handlePressure({ totalTokens: 500, allowedTokens: 400 })

		expect(result).toEqual({
			handled: false,
			movedChunks: 0,
			movedTokens: 0,
			warning: CONTEXT_CACHE_FULL_WARNING,
		})
		expect(manager.getWarning()).toBe(CONTEXT_CACHE_FULL_WARNING)
		expect(manager.drainEvents()).toEqual([
			expect.objectContaining({
				type: "cold_cache_full",
				chunkCount: 1,
				tokenCount: 200,
				reason: "request_pressure",
				outcome: "rejected",
				warning: CONTEXT_CACHE_FULL_WARNING,
			}),
		])
	})
})

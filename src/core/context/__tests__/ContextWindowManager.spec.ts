import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
	CONTEXT_CACHE_FULL_WARNING,
	ContextWindowManager,
	getContextCacheBudgetOptions,
	normalizeColdCacheRamBudgetMb,
} from "../ContextWindowManager"

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

		vi.setSystemTime(3_000)
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
			expect.objectContaining({ type: "chunks_moved_to_cold", chunkCount: 2, tokenCount: 400 }),
			expect.objectContaining({ type: "condensing_avoided", chunkCount: 2, tokenCount: 400 }),
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
				query: "beta",
			}),
		])
	})

	it("keeps context cache events bounded", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 1 })

		for (let index = 0; index < 25; index++) {
			registerConversationTurn(manager, `Conversation turn ${index}`, index, 2)
		}

		const events = manager.drainEvents()

		expect(events).toHaveLength(20)
		expect(events.every((event) => event.type === "chunks_moved_to_cold")).toBe(true)
		expect(new Set(events.map((event) => event.id)).size).toBe(20)
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

	it("surfaces the cold-cache-full warning when cold cache rejects pressure chunks", () => {
		const manager = new ContextWindowManager({ hotTokenBudget: 1000, coldCacheRamBudgetMb: 256 })
		registerConversationTurn(manager, "Conversation turn that cannot be accepted by cold cache", 700, 200)

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
				warning: CONTEXT_CACHE_FULL_WARNING,
			}),
		])
	})
})

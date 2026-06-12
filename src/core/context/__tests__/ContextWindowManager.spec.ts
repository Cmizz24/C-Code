import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
	CONTEXT_CACHE_FULL_WARNING,
	ContextWindowManager,
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
		expect(normalizeColdCacheRamBudgetMb(undefined)).toBe(512)
		expect(normalizeColdCacheRamBudgetMb(128)).toBe(256)
		expect(normalizeColdCacheRamBudgetMb(384)).toBe(512)
		expect(normalizeColdCacheRamBudgetMb(900)).toBe(1024)
		expect(normalizeColdCacheRamBudgetMb(4096)).toBe(2048)
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
	})
})

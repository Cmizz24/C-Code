import {
	DEFAULT_CONTEXT_CHUNK_MAX_TOKENS,
	createContextChunks,
	getContextChunkContentHash,
	getContextChunkDedupeKey,
} from "../ContextChunk"

describe("ContextChunk", () => {
	it("bounds explicit token counts restored from persisted context chunks", () => {
		const chunks = createContextChunks({
			type: "conversation_turn",
			content: "small restored context chunk",
			tokens: 1_000_000,
		})

		expect(chunks).toHaveLength(1)
		expect(chunks[0].tokens).toBe(DEFAULT_CONTEXT_CHUNK_MAX_TOKENS)
	})

	it("assigns stable content hashes without reusing random chunk ids", () => {
		const first = createContextChunks({ type: "conversation_turn", content: " duplicate context " })[0]
		const second = createContextChunks({ type: "conversation_turn", content: "duplicate context" })[0]

		expect(first.id).not.toBe(second.id)
		expect(first.contentHash).toBe(second.contentHash)
		expect(first.contentHash).toBe(getContextChunkContentHash("duplicate context"))
		expect(getContextChunkDedupeKey(first)).toBe(getContextChunkDedupeKey(second))
	})

	it("keeps split chunk token estimates within the per-chunk safety limit", () => {
		const chunks = createContextChunks({
			type: "file_content",
			content: "a".repeat(DEFAULT_CONTEXT_CHUNK_MAX_TOKENS * 4 * 2 + 50),
			tokens: 1_000_000,
		})

		expect(chunks.length).toBeGreaterThan(1)
		expect(chunks.every((chunk) => chunk.tokens <= DEFAULT_CONTEXT_CHUNK_MAX_TOKENS)).toBe(true)
		expect(chunks.every((chunk) => chunk.tokens > 0)).toBe(true)
		expect(chunks[0].metadata).toMatchObject({ subchunkIndex: 1, subchunkCount: chunks.length })
		expect(chunks.every((chunk) => chunk.contentHash)).toBe(true)
	})
})

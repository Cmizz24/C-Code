import { parseJSON } from "partial-json"

import { type ToolName, toolNames, type FileEntry } from "@roo-code/types"
import { customToolRegistry } from "@roo-code/core"

import {
	type ToolUse,
	type McpToolUse,
	type ToolParamName,
	type NativeToolArgs,
	toolParamNames,
} from "../../shared/tools"
import {
	AGENT_COORDINATION_MESSAGE_MAX_LENGTH,
	AGENT_COORDINATION_PATH_MAX_LENGTH,
	AGENT_COORDINATION_READ_LIMIT_MAX,
	AGENT_COORDINATION_RELATED_FILES_LIMIT,
} from "../agents/AgentBus"
import { resolveToolAlias } from "../prompts/tools/filter-tools-for-mode"
import type {
	ApiStreamToolCallStartChunk,
	ApiStreamToolCallDeltaChunk,
	ApiStreamToolCallEndChunk,
} from "../../api/transform/stream"
import { MCP_TOOL_PREFIX, MCP_TOOL_SEPARATOR, parseMcpToolName, normalizeMcpToolName } from "../../utils/mcp-name"

/**
 * Helper type to extract properly typed native arguments for a given tool.
 * Returns the type from NativeToolArgs if the tool is defined there, otherwise never.
 */
type NativeArgsFor<TName extends ToolName> = TName extends keyof NativeToolArgs ? NativeToolArgs[TName] : never

/**
 * Parser for native tool calls (OpenAI-style function calling).
 * Converts native tool call format to ToolUse format for compatibility
 * with existing tool execution infrastructure.
 *
 * For tools with refactored parsers (e.g., read_file), this parser provides
 * typed arguments via nativeArgs. Tool-specific handlers should consume
 * nativeArgs directly rather than relying on synthesized legacy params.
 */
/**
 * Event types returned from raw chunk processing.
 */
export type ToolCallStreamEvent = ApiStreamToolCallStartChunk | ApiStreamToolCallDeltaChunk | ApiStreamToolCallEndChunk

/**
 * Parser for native tool calls (OpenAI-style function calling).
 * Converts native tool call format to ToolUse format for compatibility
 * with existing tool execution infrastructure.
 *
 * For tools with refactored parsers (e.g., read_file), this parser provides
 * typed arguments via nativeArgs. Tool-specific handlers should consume
 * nativeArgs directly rather than relying on synthesized legacy params.
 *
 * This class also handles raw tool call chunk processing, converting
 * provider-level raw chunks into start/delta/end events.
 */
export class NativeToolCallParser {
	private static readonly sharedParser = new NativeToolCallParser()
	private rawChunkSequence = 0

	// Streaming state management for argument accumulation (keyed by tool call id)
	// Note: name is string to accommodate dynamic MCP tools (mcp--serverName--toolName)
	private streamingToolCalls = new Map<
		string,
		{
			id: string
			name: string
			argumentsAccumulator: string
		}
	>()

	// Raw chunk tracking state (keyed by robust per-call identity).
	// Prefer provider-supplied id. When id is missing, create a per-stream sequence
	// and use index only as a hint for finding the active call.
	private rawChunkTracker = new Map<
		string,
		{
			key: string
			id: string
			providerId?: string
			name: string
			index?: number
			hasStarted: boolean
			deltaBuffer: string[]
			argumentsAccumulator: string
			hasReceivedJsonLikeArguments: boolean
		}
	>()
	private rawChunkTrackerByProviderId = new Map<string, string>()
	private rawChunkTrackerKeysByIndex = new Map<number, string[]>()
	private rawChunkTrackerKeysWithoutIndex: string[] = []

	private static coerceOptionalBoolean(value: unknown): boolean | undefined {
		if (typeof value === "boolean") {
			return value
		}
		if (typeof value === "string") {
			const lower = value.trim().toLowerCase()
			if (lower === "true") {
				return true
			}
			if (lower === "false") {
				return false
			}
		}
		return undefined
	}

	/**
	 * Process a raw tool call chunk from the API stream.
	 * Handles tracking, buffering, and emits start/delta/end events.
	 *
	 * This is the entry point for providers that emit tool_call_partial chunks.
	 * Returns an array of events to be processed by the consumer.
	 */
	public processRawChunk(chunk: {
		index?: number
		id?: string
		name?: string
		arguments?: string
	}): ToolCallStreamEvent[] {
		const events: ToolCallStreamEvent[] = []
		const { index, id, name, arguments: args } = chunk
		const normalizedIndex = typeof index === "number" && Number.isFinite(index) ? index : undefined

		let tracked = this.resolveRawChunkTracker({ index: normalizedIndex, id, name, arguments: args })

		if (!tracked) {
			return events
		}

		// Update name if present in chunk and not yet set. If a no-id stream reuses an
		// index for a different name, resolveRawChunkTracker creates a new tracker
		// before this point so different tools cannot share an argument buffer.
		if (name && !tracked.name) {
			tracked.name = name
		}

		// Emit start event when we have the name
		if (!tracked.hasStarted && tracked.name) {
			events.push({
				type: "tool_call_start",
				id: tracked.id,
				name: tracked.name,
			})
			tracked.hasStarted = true

			// Flush buffered deltas
			for (const bufferedDelta of tracked.deltaBuffer) {
				events.push({
					type: "tool_call_delta",
					id: tracked.id,
					delta: bufferedDelta,
				})
			}
			tracked.deltaBuffer = []
		}

		// Emit delta event for argument chunks
		if (args) {
			tracked.argumentsAccumulator += args
			if (/^\s*[{[]/.test(args)) {
				tracked.hasReceivedJsonLikeArguments = true
			}

			if (tracked.hasStarted) {
				events.push({
					type: "tool_call_delta",
					id: tracked.id,
					delta: args,
				})
			} else {
				tracked.deltaBuffer.push(args)
			}
		}

		return events
	}

	private resolveRawChunkTracker(chunk: {
		index?: number
		id?: string
		name?: string
		arguments?: string
	}): (typeof this.rawChunkTracker extends Map<string, infer T> ? T : never) | undefined {
		if (chunk.id) {
			const existingKey = this.rawChunkTrackerByProviderId.get(chunk.id)
			if (existingKey) {
				return this.rawChunkTracker.get(existingKey)
			}

			const activeTracker = this.getActiveRawChunkTracker(chunk.index)
			if (
				activeTracker &&
				!activeTracker.providerId &&
				!this.shouldStartNewRawToolCall(activeTracker, chunk.name, chunk.arguments)
			) {
				activeTracker.providerId = chunk.id
				this.rawChunkTrackerByProviderId.set(chunk.id, activeTracker.key)
				if (!activeTracker.hasStarted) {
					activeTracker.id = chunk.id
				}
				return activeTracker
			}

			return this.createRawChunkTracker(chunk.index, chunk.id, chunk.name)
		}

		const activeTracker = this.getActiveRawChunkTracker(chunk.index)
		if (!activeTracker || this.shouldStartNewRawToolCall(activeTracker, chunk.name, chunk.arguments)) {
			return this.createRawChunkTracker(chunk.index, undefined, chunk.name)
		}

		return activeTracker
	}

	private createRawChunkTracker(index: number | undefined, providerId: string | undefined, name: string | undefined) {
		const sequence = this.rawChunkSequence++
		const key = providerId ? `id:${providerId}` : `seq:${sequence}`
		const tracker = {
			key,
			id: providerId ?? `tool_call_${sequence}`,
			providerId,
			name: name || "",
			index,
			hasStarted: false,
			deltaBuffer: [],
			argumentsAccumulator: "",
			hasReceivedJsonLikeArguments: false,
		}

		this.rawChunkTracker.set(key, tracker)
		if (providerId) {
			this.rawChunkTrackerByProviderId.set(providerId, key)
		}

		if (index !== undefined) {
			const keys = this.rawChunkTrackerKeysByIndex.get(index) ?? []
			keys.push(key)
			this.rawChunkTrackerKeysByIndex.set(index, keys)
		} else {
			this.rawChunkTrackerKeysWithoutIndex.push(key)
		}

		return tracker
	}

	private getActiveRawChunkTracker(index: number | undefined) {
		const keys =
			index !== undefined ? this.rawChunkTrackerKeysByIndex.get(index) : this.rawChunkTrackerKeysWithoutIndex
		const activeKey = keys?.[keys.length - 1]
		return activeKey ? this.rawChunkTracker.get(activeKey) : undefined
	}

	private shouldStartNewRawToolCall(
		activeTracker: NonNullable<ReturnType<NativeToolCallParser["getActiveRawChunkTracker"]>>,
		name: string | undefined,
		args: string | undefined,
	): boolean {
		if (!name) {
			return false
		}

		if (activeTracker.name && activeTracker.name !== name) {
			return true
		}

		if (
			activeTracker.hasReceivedJsonLikeArguments &&
			this.isCompleteJsonValue(activeTracker.argumentsAccumulator)
		) {
			return true
		}

		const argsStartsWithJson = typeof args === "string" && /^\s*[{[]/.test(args)
		return activeTracker.hasReceivedJsonLikeArguments && argsStartsWithJson
	}

	private isCompleteJsonValue(value: string): boolean {
		try {
			JSON.parse(value)
			return true
		} catch {
			return false
		}
	}

	public static processRawChunk(chunk: {
		index?: number
		id?: string
		name?: string
		arguments?: string
	}): ToolCallStreamEvent[] {
		return NativeToolCallParser.sharedParser.processRawChunk(chunk)
	}

	/**
	 * Process stream finish reason.
	 * Emits end events when finish_reason is 'tool_calls'.
	 */
	public processFinishReason(finishReason: string | null | undefined): ToolCallStreamEvent[] {
		const events: ToolCallStreamEvent[] = []

		if (finishReason === "tool_calls" && this.rawChunkTracker.size > 0) {
			for (const [, tracked] of this.rawChunkTracker.entries()) {
				events.push({
					type: "tool_call_end",
					id: tracked.id,
				})
			}
		}

		return events
	}

	public static processFinishReason(finishReason: string | null | undefined): ToolCallStreamEvent[] {
		return NativeToolCallParser.sharedParser.processFinishReason(finishReason)
	}

	/**
	 * Finalize any remaining tool calls that weren't explicitly ended.
	 * Should be called at the end of stream processing.
	 */
	public finalizeRawChunks(): ToolCallStreamEvent[] {
		const events: ToolCallStreamEvent[] = []

		if (this.rawChunkTracker.size > 0) {
			for (const [, tracked] of this.rawChunkTracker.entries()) {
				if (tracked.hasStarted) {
					events.push({
						type: "tool_call_end",
						id: tracked.id,
					})
				}
			}
			this.clearRawChunkState()
		}

		return events
	}

	public static finalizeRawChunks(): ToolCallStreamEvent[] {
		return NativeToolCallParser.sharedParser.finalizeRawChunks()
	}

	/**
	 * Clear all raw chunk tracking state.
	 * Should be called when a new API request starts.
	 */
	public clearRawChunkState(): void {
		this.rawChunkTracker.clear()
		this.rawChunkTrackerByProviderId.clear()
		this.rawChunkTrackerKeysByIndex.clear()
		this.rawChunkTrackerKeysWithoutIndex = []
		this.rawChunkSequence = 0
	}

	public static clearRawChunkState(): void {
		NativeToolCallParser.sharedParser.clearRawChunkState()
	}

	/**
	 * Start streaming a new tool call.
	 * Initializes tracking for incremental argument parsing.
	 * Accepts string to support both ToolName and dynamic MCP tools (mcp--serverName--toolName).
	 */
	public startStreamingToolCall(id: string, name: string): void {
		this.streamingToolCalls.set(id, {
			id,
			name,
			argumentsAccumulator: "",
		})
	}

	public static startStreamingToolCall(id: string, name: string): void {
		NativeToolCallParser.sharedParser.startStreamingToolCall(id, name)
	}

	/**
	 * Clear all streaming tool call state.
	 * Should be called when a new API request starts to prevent memory leaks
	 * from interrupted streams.
	 */
	public clearAllStreamingToolCalls(): void {
		this.streamingToolCalls.clear()
	}

	public static clearAllStreamingToolCalls(): void {
		NativeToolCallParser.sharedParser.clearAllStreamingToolCalls()
	}

	/**
	 * Check if there are any active streaming tool calls.
	 * Useful for debugging and testing.
	 */
	public hasActiveStreamingToolCalls(): boolean {
		return this.streamingToolCalls.size > 0
	}

	public static hasActiveStreamingToolCalls(): boolean {
		return NativeToolCallParser.sharedParser.hasActiveStreamingToolCalls()
	}

	/**
	 * Process a chunk of JSON arguments for a streaming tool call.
	 * Uses partial-json-parser to extract values from incomplete JSON immediately.
	 * Returns a partial ToolUse with currently parsed parameters.
	 */
	public processStreamingChunk(id: string, chunk: string): ToolUse | null {
		const toolCall = this.streamingToolCalls.get(id)
		if (!toolCall) {
			return null
		}

		// Accumulate the JSON string
		toolCall.argumentsAccumulator += chunk

		// For dynamic MCP tools, we don't return partial updates - wait for final
		const mcpPrefix = MCP_TOOL_PREFIX + MCP_TOOL_SEPARATOR
		if (toolCall.name.startsWith(mcpPrefix)) {
			return null
		}

		// Parse whatever we can from the incomplete JSON!
		// partial-json-parser extracts partial values (strings, arrays, objects) immediately
		try {
			const partialArgs = parseJSON(toolCall.argumentsAccumulator)

			// Resolve tool alias to canonical name
			const resolvedName = resolveToolAlias(toolCall.name) as ToolName
			// Preserve original name if it differs from resolved (i.e., it was an alias)
			const originalName = toolCall.name !== resolvedName ? toolCall.name : undefined

			// Create partial ToolUse with extracted values
			return NativeToolCallParser.createPartialToolUse(
				toolCall.id,
				resolvedName,
				partialArgs || {},
				true, // partial
				originalName,
			)
		} catch {
			// Even partial-json-parser can fail on severely malformed JSON
			// Return null and wait for next chunk
			return null
		}
	}

	public static processStreamingChunk(id: string, chunk: string): ToolUse | null {
		return NativeToolCallParser.sharedParser.processStreamingChunk(id, chunk)
	}

	/**
	 * Finalize a streaming tool call.
	 * Parses the complete JSON and returns the final ToolUse or McpToolUse.
	 */
	public finalizeStreamingToolCall(id: string): ToolUse | McpToolUse | null {
		const toolCall = this.streamingToolCalls.get(id)
		if (!toolCall) {
			return null
		}

		// Parse the complete accumulated JSON
		// Cast to any for the name since parseToolCall handles both ToolName and dynamic MCP tools
		const finalToolUse = NativeToolCallParser.parseToolCall({
			id: toolCall.id,
			name: toolCall.name as ToolName,
			arguments: toolCall.argumentsAccumulator,
		})

		// Clean up streaming state
		this.streamingToolCalls.delete(id)

		return finalToolUse
	}

	public static finalizeStreamingToolCall(id: string): ToolUse | McpToolUse | null {
		return NativeToolCallParser.sharedParser.finalizeStreamingToolCall(id)
	}

	private static coerceOptionalNumber(value: unknown): number | undefined {
		if (typeof value === "number" && Number.isFinite(value)) {
			return value
		}
		if (typeof value === "string") {
			const n = Number(value)
			if (Number.isFinite(n)) {
				return n
			}
		}
		return undefined
	}

	private static readonly coordinateAgentKindValues = new Set([
		"note",
		"question",
		"answer",
		"decision",
		"blocker",
		"shared-contract",
	])
	private static readonly coordinateAgentAllowedKeys = new Set([
		"action",
		"kind",
		"message",
		"targetAgentId",
		"relatedFiles",
		"replyToId",
		"limit",
	])

	private static buildCoordinateAgentsNativeArgs(
		args: Record<string, any>,
	): NativeToolArgs["coordinate_agents"] | undefined {
		this.assertCoordinateAgentsAllowedKeys(args)

		if (args.action === undefined) {
			return undefined
		}

		if (typeof args.action !== "string") {
			throw new Error("coordinate_agents action must be 'publish', 'read', or 'acknowledge_contract'.")
		}

		const action = args.action.trim()
		if (action !== "publish" && action !== "read" && action !== "acknowledge_contract") {
			throw new Error("coordinate_agents action must be 'publish', 'read', or 'acknowledge_contract'.")
		}

		const limit = this.normalizeCoordinateAgentsLimit(args.limit)

		if (action === "read" || action === "acknowledge_contract") {
			this.normalizeCoordinateAgentsKind(args.kind)
			this.normalizeCoordinateAgentsMessage(args.message)
			this.normalizeCoordinateAgentsTargetAgentId(args.targetAgentId)
			this.normalizeCoordinateAgentsReplyToId(args.replyToId)
			this.normalizeCoordinateAgentsRelatedFiles(args.relatedFiles)

			const nativeArgs: NativeToolArgs["coordinate_agents"] = { action }
			if (limit !== undefined) {
				nativeArgs.limit = limit
			}

			return nativeArgs
		}

		const nativeArgs: NativeToolArgs["coordinate_agents"] = { action }
		const kind = this.normalizeCoordinateAgentsKind(args.kind)
		const message = this.normalizeCoordinateAgentsMessage(args.message)
		const targetAgentId = this.normalizeCoordinateAgentsTargetAgentId(args.targetAgentId)
		const relatedFiles = this.normalizeCoordinateAgentsRelatedFiles(args.relatedFiles)
		const replyToId = this.normalizeCoordinateAgentsReplyToId(args.replyToId)

		if (kind !== undefined) {
			nativeArgs.kind = kind
		}
		if (message !== undefined) {
			nativeArgs.message = message
		}
		if (targetAgentId !== undefined) {
			nativeArgs.targetAgentId = targetAgentId
		}
		if (relatedFiles !== undefined) {
			nativeArgs.relatedFiles = relatedFiles
		}
		if (replyToId !== undefined) {
			nativeArgs.replyToId = replyToId
		}
		if (limit !== undefined) {
			nativeArgs.limit = limit
		}

		return nativeArgs
	}

	private static assertCoordinateAgentsAllowedKeys(args: Record<string, any>): void {
		for (const key of Object.keys(args)) {
			if (!this.coordinateAgentAllowedKeys.has(key)) {
				throw new Error(`Unknown argument '${key}' for coordinate_agents.`)
			}
		}
	}

	private static normalizeCoordinateAgentsKind(value: unknown): NativeToolArgs["coordinate_agents"]["kind"] {
		if (value === undefined) {
			return undefined
		}

		if (typeof value !== "string") {
			throw new Error("coordinate_agents kind must be a string when provided.")
		}

		const normalized = value.trim()
		if (!normalized) {
			return undefined
		}

		if (!this.coordinateAgentKindValues.has(normalized)) {
			throw new Error(
				"coordinate_agents kind must be one of note, question, answer, decision, blocker, or shared-contract.",
			)
		}

		return normalized as NativeToolArgs["coordinate_agents"]["kind"]
	}

	private static normalizeCoordinateAgentsMessage(value: unknown): string | undefined {
		if (value === undefined) {
			return undefined
		}

		if (typeof value !== "string") {
			throw new Error("coordinate_agents message must be a string when provided.")
		}

		const normalized = value
			.split("")
			.filter((char) => !this.isControlCharacter(char))
			.join("")
			.replace(/\s+/g, " ")
			.trim()

		if (!normalized) {
			return undefined
		}

		if (normalized.length > AGENT_COORDINATION_MESSAGE_MAX_LENGTH) {
			return this.truncateCoordinateAgentsMessage(normalized)
		}

		return normalized
	}

	private static truncateCoordinateAgentsMessage(value: string): string {
		const suffix = "…"
		const availableLength = Math.max(0, AGENT_COORDINATION_MESSAGE_MAX_LENGTH - suffix.length)
		return `${value.slice(0, availableLength).trimEnd()}${suffix}`
	}

	private static normalizeCoordinateAgentsTargetAgentId(value: unknown): string | undefined {
		const normalized = this.normalizeCoordinateAgentsIdentifier(value, "targetAgentId")
		const lower = normalized?.toLowerCase()

		if (!normalized || lower === "all" || lower === "none") {
			return undefined
		}

		return normalized
	}

	private static normalizeCoordinateAgentsReplyToId(value: unknown): string | undefined {
		const normalized = this.normalizeCoordinateAgentsIdentifier(value, "replyToId")

		if (!normalized || normalized.toLowerCase() === "none") {
			return undefined
		}

		return normalized
	}

	private static normalizeCoordinateAgentsIdentifier(value: unknown, fieldName: string): string | undefined {
		if (value === undefined) {
			return undefined
		}

		if (typeof value !== "string") {
			throw new Error(`coordinate_agents ${fieldName} must be a string when provided.`)
		}

		const normalized = value
			.split("")
			.filter((char) => !this.isControlCharacter(char))
			.join("")
			.trim()

		if (!normalized) {
			return undefined
		}

		if (normalized.length > 120) {
			throw new Error(`coordinate_agents ${fieldName} must be at most 120 characters.`)
		}

		return normalized
	}

	private static normalizeCoordinateAgentsRelatedFiles(value: unknown): string[] | undefined {
		if (value === undefined) {
			return undefined
		}

		if (!Array.isArray(value)) {
			throw new Error("coordinate_agents relatedFiles must be an array of strings when provided.")
		}

		if (value.length > AGENT_COORDINATION_RELATED_FILES_LIMIT) {
			throw new Error(
				`coordinate_agents relatedFiles must include at most ${AGENT_COORDINATION_RELATED_FILES_LIMIT} entries.`,
			)
		}

		const relatedFiles: string[] = []
		const seen = new Set<string>()

		for (const filePath of value) {
			if (typeof filePath !== "string") {
				throw new Error("coordinate_agents relatedFiles entries must be strings.")
			}

			const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim()
			if (!normalizedPath) {
				continue
			}

			if (normalizedPath.length > AGENT_COORDINATION_PATH_MAX_LENGTH) {
				throw new Error(
					`coordinate_agents relatedFiles entries must be at most ${AGENT_COORDINATION_PATH_MAX_LENGTH} characters.`,
				)
			}

			if (!seen.has(normalizedPath)) {
				seen.add(normalizedPath)
				relatedFiles.push(normalizedPath)
			}
		}

		return relatedFiles.length ? relatedFiles : undefined
	}

	private static normalizeCoordinateAgentsLimit(value: unknown): number | undefined {
		if (value === undefined) {
			return undefined
		}

		const numericValue =
			typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN

		if (!Number.isInteger(numericValue)) {
			throw new Error("coordinate_agents limit must be an integer when provided.")
		}

		if (numericValue < 1 || numericValue > AGENT_COORDINATION_READ_LIMIT_MAX) {
			throw new Error(`coordinate_agents limit must be between 1 and ${AGENT_COORDINATION_READ_LIMIT_MAX}.`)
		}

		return numericValue
	}

	private static isControlCharacter(char: string): boolean {
		const code = char.charCodeAt(0)

		return code <= 31 || code === 127
	}

	/**
	 * Convert raw file entries from API (with line_ranges) to FileEntry objects
	 * (with lineRanges). Handles multiple formats for backward compatibility:
	 *
	 * New tuple format: { path: string, line_ranges: [[1, 50], [100, 150]] }
	 * Object format: { path: string, line_ranges: [{ start: 1, end: 50 }] }
	 * Legacy string format: { path: string, line_ranges: ["1-50"] }
	 *
	 * Returns: { path: string, lineRanges: [{ start: 1, end: 50 }] }
	 */
	private static convertFileEntries(files: unknown[]): FileEntry[] {
		return files.map((file: unknown) => {
			const f = file as Record<string, unknown>
			const entry: FileEntry = { path: f.path as string }
			if (f.line_ranges && Array.isArray(f.line_ranges)) {
				entry.lineRanges = (f.line_ranges as unknown[])
					.map((range: unknown) => {
						// Handle tuple format: [start, end]
						if (Array.isArray(range) && range.length >= 2) {
							return { start: Number(range[0]), end: Number(range[1]) }
						}
						// Handle object format: { start: number, end: number }
						if (typeof range === "object" && range !== null && "start" in range && "end" in range) {
							const r = range as { start: unknown; end: unknown }
							return { start: Number(r.start), end: Number(r.end) }
						}
						// Handle legacy string format: "1-50"
						if (typeof range === "string") {
							const match = range.match(/^(\d+)-(\d+)$/)
							if (match) {
								return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) }
							}
						}
						return null
					})
					.filter((r): r is { start: number; end: number } => r !== null)
			}
			return entry
		})
	}

	/**
	 * Create a partial ToolUse from currently parsed arguments.
	 * Used during streaming to show progress.
	 * @param originalName - The original tool name as called by the model (if different from canonical name)
	 */
	private static createPartialToolUse(
		id: string,
		name: ToolName,
		partialArgs: Record<string, any>,
		partial: boolean,
		originalName?: string,
	): ToolUse | null {
		// Build stringified params for display/partial-progress UI.
		// NOTE: For streaming partial updates, we MUST populate params even for complex types
		// because tool.handlePartial() methods rely on params to show UI updates.
		const params: Partial<Record<ToolParamName, string>> = {}

		for (const [key, value] of Object.entries(partialArgs)) {
			if (toolParamNames.includes(key as ToolParamName)) {
				params[key as ToolParamName] = typeof value === "string" ? value : JSON.stringify(value)
			}
		}

		// Build partial nativeArgs based on what we have so far
		let nativeArgs: any = undefined

		// Track whether legacy format was used
		let usedLegacyFormat = false

		switch (name) {
			case "read_file":
				// Check for legacy format first: { files: [...] }
				// Handle both array and stringified array (some models double-stringify)
				if (partialArgs.files !== undefined) {
					let filesArray: unknown[] | null = null

					if (Array.isArray(partialArgs.files)) {
						filesArray = partialArgs.files
					} else if (typeof partialArgs.files === "string") {
						// Handle double-stringified case: files is a string containing JSON array
						try {
							const parsed = JSON.parse(partialArgs.files)
							if (Array.isArray(parsed)) {
								filesArray = parsed
							}
						} catch {
							// Not valid JSON, ignore
						}
					}

					if (filesArray && filesArray.length > 0) {
						usedLegacyFormat = true
						nativeArgs = {
							files: this.convertFileEntries(filesArray),
							_legacyFormat: true as const,
						}
					}
				}
				// New format: { path: "...", mode: "..." }
				if (!nativeArgs && partialArgs.path !== undefined) {
					nativeArgs = {
						path: partialArgs.path,
						mode: partialArgs.mode,
						offset: this.coerceOptionalNumber(partialArgs.offset),
						limit: this.coerceOptionalNumber(partialArgs.limit),
						indentation:
							partialArgs.indentation && typeof partialArgs.indentation === "object"
								? {
										anchor_line: this.coerceOptionalNumber(partialArgs.indentation.anchor_line),
										max_levels: this.coerceOptionalNumber(partialArgs.indentation.max_levels),
										max_lines: this.coerceOptionalNumber(partialArgs.indentation.max_lines),
										include_siblings: this.coerceOptionalBoolean(
											partialArgs.indentation.include_siblings,
										),
										include_header: this.coerceOptionalBoolean(
											partialArgs.indentation.include_header,
										),
									}
								: undefined,
					}
				}
				break

			case "attempt_completion":
				if (partialArgs.result) {
					nativeArgs = { result: partialArgs.result }
				}
				break

			case "execute_command":
				if (partialArgs.command) {
					nativeArgs = {
						command: partialArgs.command,
						cwd: partialArgs.cwd,
						timeout: partialArgs.timeout,
					}
				}
				break

			case "write_to_file":
				if (partialArgs.path || partialArgs.content) {
					nativeArgs = {
						path: partialArgs.path,
						content: partialArgs.content,
					}
				}
				break

			case "ask_followup_question":
				if (partialArgs.question !== undefined || partialArgs.follow_up !== undefined) {
					nativeArgs = {
						question: partialArgs.question,
						follow_up: Array.isArray(partialArgs.follow_up) ? partialArgs.follow_up : undefined,
					}
				}
				break

			case "apply_diff":
				if (partialArgs.path !== undefined || partialArgs.diff !== undefined) {
					nativeArgs = {
						path: partialArgs.path,
						diff: partialArgs.diff,
					}
				}
				break

			case "codebase_search":
				if (partialArgs.query !== undefined) {
					nativeArgs = {
						query: partialArgs.query,
						path: partialArgs.path,
					}
				}
				break

			case "generate_image":
				if (partialArgs.prompt !== undefined || partialArgs.path !== undefined) {
					nativeArgs = {
						prompt: partialArgs.prompt,
						path: partialArgs.path,
						image: partialArgs.image,
					}
				}
				break

			case "run_slash_command":
				if (partialArgs.command !== undefined) {
					nativeArgs = {
						command: partialArgs.command,
						args: partialArgs.args,
					}
				}
				break

			case "skill":
				if (partialArgs.skill !== undefined) {
					nativeArgs = {
						skill: partialArgs.skill,
						args: partialArgs.args,
					}
				}
				break

			case "search_files":
				if (partialArgs.path !== undefined || partialArgs.regex !== undefined) {
					nativeArgs = {
						path: partialArgs.path,
						regex: partialArgs.regex,
						file_pattern: partialArgs.file_pattern,
					}
				}
				break

			case "switch_mode":
				if (partialArgs.mode_slug !== undefined || partialArgs.reason !== undefined) {
					nativeArgs = {
						mode_slug: partialArgs.mode_slug,
						reason: partialArgs.reason,
					}
				}
				break

			case "update_todo_list":
				if (partialArgs.todos !== undefined) {
					nativeArgs = {
						todos: partialArgs.todos,
					}
				}
				break

			case "use_mcp_tool":
				if (partialArgs.server_name !== undefined || partialArgs.tool_name !== undefined) {
					nativeArgs = {
						server_name: partialArgs.server_name,
						tool_name: partialArgs.tool_name,
						arguments: partialArgs.arguments,
					}
				}
				break

			case "apply_patch":
				if (partialArgs.patch !== undefined) {
					nativeArgs = {
						patch: partialArgs.patch,
					}
				}
				break

			case "search_replace":
				if (
					partialArgs.file_path !== undefined ||
					partialArgs.old_string !== undefined ||
					partialArgs.new_string !== undefined
				) {
					nativeArgs = {
						file_path: partialArgs.file_path,
						old_string: partialArgs.old_string,
						new_string: partialArgs.new_string,
					}
				}
				break

			case "edit":
			case "search_and_replace":
				if (
					partialArgs.file_path !== undefined ||
					partialArgs.old_string !== undefined ||
					partialArgs.new_string !== undefined
				) {
					nativeArgs = {
						file_path: partialArgs.file_path,
						old_string: partialArgs.old_string,
						new_string: partialArgs.new_string,
						replace_all: this.coerceOptionalBoolean(partialArgs.replace_all),
					}
				}
				break

			case "edit_file":
				if (
					partialArgs.file_path !== undefined ||
					partialArgs.old_string !== undefined ||
					partialArgs.new_string !== undefined
				) {
					nativeArgs = {
						file_path: partialArgs.file_path,
						old_string: partialArgs.old_string,
						new_string: partialArgs.new_string,
						expected_replacements: partialArgs.expected_replacements,
					}
				}
				break

			case "list_files":
				if (partialArgs.path !== undefined) {
					nativeArgs = {
						path: partialArgs.path,
						recursive: this.coerceOptionalBoolean(partialArgs.recursive),
					}
				}
				break

			case "new_task":
				if (partialArgs.mode !== undefined || partialArgs.message !== undefined) {
					nativeArgs = {
						mode: partialArgs.mode,
						message: partialArgs.message,
						todos: partialArgs.todos,
					}
				}
				break

			case "plan_parallel_tasks":
				if (partialArgs.goal !== undefined || partialArgs.agents !== undefined) {
					nativeArgs = {
						goal: partialArgs.goal,
						sharedContext: partialArgs.sharedContext,
						sharedContract: partialArgs.sharedContract,
						expectedFiles: Array.isArray(partialArgs.expectedFiles) ? partialArgs.expectedFiles : [],
						agents: Array.isArray(partialArgs.agents) ? partialArgs.agents : [],
					}
				}
				break

			case "coordinate_agents":
				nativeArgs = this.buildCoordinateAgentsNativeArgs(partialArgs)
				break

			default:
				break
		}

		const result: ToolUse = {
			type: "tool_use" as const,
			name,
			params,
			partial,
			nativeArgs,
		}

		// Preserve original name for API history when an alias was used
		if (originalName) {
			result.originalName = originalName
		}

		// Track legacy format usage
		if (usedLegacyFormat) {
			result.usedLegacyFormat = true
		}

		return result
	}

	/**
	 * Convert a native tool call chunk to a ToolUse object.
	 *
	 * @param toolCall - The native tool call from the API stream
	 * @returns A properly typed ToolUse object
	 */
	public static parseToolCall<TName extends ToolName>(toolCall: {
		id: string
		name: TName
		arguments: string
	}): ToolUse<TName> | McpToolUse | null {
		// Check if this is a dynamic MCP tool (mcp--serverName--toolName)
		// Also handle models that output underscores instead of hyphens (mcp__serverName__toolName)
		const mcpPrefix = MCP_TOOL_PREFIX + MCP_TOOL_SEPARATOR

		if (typeof toolCall.name === "string") {
			// Normalize the tool name to handle models that output underscores instead of hyphens
			const normalizedName = normalizeMcpToolName(toolCall.name)
			if (normalizedName.startsWith(mcpPrefix)) {
				// Pass the original tool call but with normalized name for parsing
				return this.parseDynamicMcpTool({ ...toolCall, name: normalizedName })
			}
		}

		// Resolve tool alias to canonical name
		const resolvedName = resolveToolAlias(toolCall.name as string) as TName

		// Validate tool name (after alias resolution).
		if (!toolNames.includes(resolvedName as ToolName) && !customToolRegistry.has(resolvedName)) {
			console.error(`Invalid tool name: ${toolCall.name} (resolved: ${resolvedName})`)
			console.error(`Valid tool names:`, toolNames)
			return null
		}

		try {
			// Parse the arguments JSON string
			const args = NativeToolCallParser.parseToolArguments(toolCall.arguments, resolvedName as ToolName)

			// Build stringified params for display/logging.
			// Tool execution MUST use nativeArgs (typed) and does not support legacy fallbacks.
			const params: Partial<Record<ToolParamName, string>> = {}

			for (const [key, value] of Object.entries(args)) {
				// Validate parameter name
				if (!toolParamNames.includes(key as ToolParamName) && !customToolRegistry.has(resolvedName)) {
					console.warn(`Unknown parameter '${key}' for tool '${resolvedName}'`)
					console.warn(`Valid param names:`, toolParamNames)
					continue
				}

				// Convert to string for legacy params format
				const stringValue = typeof value === "string" ? value : JSON.stringify(value)
				params[key as ToolParamName] = stringValue
			}

			// Build typed nativeArgs for tool execution.
			// Each case validates the minimum required parameters and constructs a properly typed
			// nativeArgs object. If validation fails, we treat the tool call as invalid and fail fast.
			let nativeArgs: NativeArgsFor<TName> | undefined = undefined

			// Track whether legacy format was used
			let usedLegacyFormat = false

			switch (resolvedName) {
				case "read_file":
					// Check for legacy format first: { files: [...] }
					// Handle both array and stringified array (some models double-stringify)
					if (args.files !== undefined) {
						let filesArray: unknown[] | null = null

						if (Array.isArray(args.files)) {
							filesArray = args.files
						} else if (typeof args.files === "string") {
							// Handle double-stringified case: files is a string containing JSON array
							try {
								const parsed = JSON.parse(args.files)
								if (Array.isArray(parsed)) {
									filesArray = parsed
								}
							} catch {
								// Not valid JSON, ignore
							}
						}

						if (filesArray && filesArray.length > 0) {
							usedLegacyFormat = true
							nativeArgs = {
								files: this.convertFileEntries(filesArray),
								_legacyFormat: true as const,
							} as NativeArgsFor<TName>
						}
					}
					// New format: { path: "...", mode: "..." }
					if (!nativeArgs && args.path !== undefined) {
						nativeArgs = {
							path: args.path,
							mode: args.mode,
							offset: this.coerceOptionalNumber(args.offset),
							limit: this.coerceOptionalNumber(args.limit),
							indentation:
								args.indentation && typeof args.indentation === "object"
									? {
											anchor_line: this.coerceOptionalNumber(args.indentation.anchor_line),
											max_levels: this.coerceOptionalNumber(args.indentation.max_levels),
											max_lines: this.coerceOptionalNumber(args.indentation.max_lines),
											include_siblings: this.coerceOptionalBoolean(
												args.indentation.include_siblings,
											),
											include_header: this.coerceOptionalBoolean(args.indentation.include_header),
										}
									: undefined,
						} as NativeArgsFor<TName>
					}
					break

				case "attempt_completion":
					if (args.result) {
						nativeArgs = { result: args.result } as NativeArgsFor<TName>
					}
					break

				case "execute_command":
					if (args.command) {
						nativeArgs = {
							command: args.command,
							cwd: args.cwd,
							timeout: args.timeout,
						} as NativeArgsFor<TName>
					}
					break

				case "apply_diff":
					if (args.path !== undefined && args.diff !== undefined) {
						nativeArgs = {
							path: args.path,
							diff: args.diff,
						} as NativeArgsFor<TName>
					}
					break

				case "edit":
				case "search_and_replace":
					if (
						args.file_path !== undefined &&
						args.old_string !== undefined &&
						args.new_string !== undefined
					) {
						nativeArgs = {
							file_path: args.file_path,
							old_string: args.old_string,
							new_string: args.new_string,
							replace_all: this.coerceOptionalBoolean(args.replace_all),
						} as NativeArgsFor<TName>
					}
					break

				case "ask_followup_question":
					if (args.question !== undefined && args.follow_up !== undefined) {
						nativeArgs = {
							question: args.question,
							follow_up: args.follow_up,
						} as NativeArgsFor<TName>
					}
					break

				case "codebase_search":
					if (args.query !== undefined) {
						nativeArgs = {
							query: args.query,
							path: args.path,
						} as NativeArgsFor<TName>
					}
					break

				case "generate_image":
					if (args.prompt !== undefined && args.path !== undefined) {
						nativeArgs = {
							prompt: args.prompt,
							path: args.path,
							image: args.image,
						} as NativeArgsFor<TName>
					}
					break

				case "run_slash_command":
					if (args.command !== undefined) {
						nativeArgs = {
							command: args.command,
							args: args.args,
						} as NativeArgsFor<TName>
					}
					break

				case "skill":
					if (args.skill !== undefined) {
						nativeArgs = {
							skill: args.skill,
							args: args.args,
						} as NativeArgsFor<TName>
					}
					break

				case "search_files":
					if (args.path !== undefined && args.regex !== undefined) {
						nativeArgs = {
							path: args.path,
							regex: args.regex,
							file_pattern: args.file_pattern,
						} as NativeArgsFor<TName>
					}
					break

				case "switch_mode":
					if (args.mode_slug !== undefined && args.reason !== undefined) {
						nativeArgs = {
							mode_slug: args.mode_slug,
							reason: args.reason,
						} as NativeArgsFor<TName>
					}
					break

				case "update_todo_list":
					if (args.todos !== undefined) {
						nativeArgs = {
							todos: args.todos,
						} as NativeArgsFor<TName>
					}
					break

				case "read_command_output":
					if (args.artifact_id !== undefined) {
						nativeArgs = {
							artifact_id: args.artifact_id,
							search: args.search,
							offset: args.offset,
							limit: args.limit,
						} as NativeArgsFor<TName>
					}
					break

				case "write_to_file":
					if (args.path !== undefined && args.content !== undefined) {
						nativeArgs = {
							path: args.path,
							content: args.content,
						} as NativeArgsFor<TName>
					}
					break

				case "use_mcp_tool":
					if (args.server_name !== undefined && args.tool_name !== undefined) {
						nativeArgs = {
							server_name: args.server_name,
							tool_name: args.tool_name,
							arguments: args.arguments,
						} as NativeArgsFor<TName>
					}
					break

				case "access_mcp_resource":
					if (args.server_name !== undefined && args.uri !== undefined) {
						nativeArgs = {
							server_name: args.server_name,
							uri: args.uri,
						} as NativeArgsFor<TName>
					}
					break

				case "apply_patch":
					if (args.patch !== undefined) {
						nativeArgs = {
							patch: args.patch,
						} as NativeArgsFor<TName>
					}
					break

				case "search_replace":
					if (
						args.file_path !== undefined &&
						args.old_string !== undefined &&
						args.new_string !== undefined
					) {
						nativeArgs = {
							file_path: args.file_path,
							old_string: args.old_string,
							new_string: args.new_string,
						} as NativeArgsFor<TName>
					}
					break

				case "edit_file":
					if (
						args.file_path !== undefined &&
						args.old_string !== undefined &&
						args.new_string !== undefined
					) {
						nativeArgs = {
							file_path: args.file_path,
							old_string: args.old_string,
							new_string: args.new_string,
							expected_replacements: args.expected_replacements,
						} as NativeArgsFor<TName>
					}
					break

				case "list_files":
					if (args.path !== undefined) {
						nativeArgs = {
							path: args.path,
							recursive: this.coerceOptionalBoolean(args.recursive),
						} as NativeArgsFor<TName>
					}
					break

				case "new_task":
					if (args.mode !== undefined && args.message !== undefined) {
						nativeArgs = {
							mode: args.mode,
							message: args.message,
							todos: args.todos,
						} as NativeArgsFor<TName>
					}
					break

				case "plan_parallel_tasks":
					if (args.goal !== undefined && args.agents !== undefined) {
						nativeArgs = {
							goal: args.goal,
							sharedContext: args.sharedContext,
							sharedContract: args.sharedContract,
							expectedFiles: args.expectedFiles,
							agents: args.agents,
						} as NativeArgsFor<TName>
					}
					break

				case "coordinate_agents":
					nativeArgs = this.buildCoordinateAgentsNativeArgs(args) as NativeArgsFor<TName>
					break

				default:
					if (customToolRegistry.has(resolvedName)) {
						nativeArgs = args as NativeArgsFor<TName>
					}

					break
			}

			// Native-only: core tools must always have typed nativeArgs.
			// If we couldn't construct it, the model produced an invalid tool call payload.
			if (!nativeArgs && !customToolRegistry.has(resolvedName)) {
				throw new Error(
					`[NativeToolCallParser] Invalid arguments for tool '${resolvedName}'. ` +
						`Native tool calls require a valid JSON payload matching the tool schema. ` +
						`Received: ${JSON.stringify(args)}`,
				)
			}

			const result: ToolUse<TName> = {
				type: "tool_use" as const,
				id: toolCall.id,
				name: resolvedName,
				params,
				partial: false, // Native tool calls are always complete when yielded
				nativeArgs,
			}

			// Preserve original name for API history when an alias was used
			if (toolCall.name !== resolvedName) {
				result.originalName = toolCall.name
			}

			// Track legacy format usage
			if (usedLegacyFormat) {
				result.usedLegacyFormat = true
			}

			return result
		} catch (error) {
			console.error(
				`Failed to parse tool call arguments: ${error instanceof Error ? error.message : String(error)}`,
			)

			console.error(`Tool call: ${JSON.stringify(toolCall, null, 2)}`)
			return null
		}
	}

	private static parseToolArguments(argumentsString: string, toolName?: ToolName): Record<string, any> {
		if (argumentsString === "") {
			return {}
		}

		try {
			return JSON.parse(argumentsString)
		} catch (error) {
			if (NativeToolCallParser.hasAdjacentTopLevelJsonValues(argumentsString)) {
				throw new Error(
					`Tool call arguments contain multiple adjacent JSON values; expected exactly one JSON object. ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}

			// Attempt narrow recoveries before giving up.
			for (const candidate of NativeToolCallParser.buildRecoveredArgumentCandidates(argumentsString, toolName)) {
				try {
					return JSON.parse(candidate)
				} catch {
					// Try next candidate.
				}
			}

			throw error
		}
	}

	/**
	 * Builds a small set of narrowly-scoped recovery candidates for common LLM
	 * serialisation mistakes that cause raw JSON.parse() to fail.
	 *
	 * Recovery 1 – unquoted markdown checklist in new_task `todos` field:
	 *   The model emits `"todos": - [ ] Item ...` without wrapping the value in
	 *   quotes.  Detect the pattern and re-stringify the markdown portion.
	 *
	 * Recovery 2 – raw control characters inside JSON string values:
	 *   Some LLMs embed bare TAB/CR/LF/BEL characters (code points ≤ 31 or = 127)
	 *   inside a JSON string literal, which is invalid per spec.  Strip them from
	 *   the raw JSON text so JSON.parse() can proceed.
	 */
	private static buildRecoveredArgumentCandidates(raw: string, toolName?: ToolName): string[] {
		const candidates: string[] = []

		// Recovery 1: unquoted markdown checklist in `todos` for new_task.
		if (toolName === "new_task") {
			// Match: "todos": followed by optional whitespace then a markdown checklist
			// (starts with `- [` as in `- [ ] item` or `- [x] item`).  Everything from
			// there to the next JSON key boundary or closing `}` is the raw markdown.
			const unquotedTodosMatch = raw.match(/"todos"\s*:\s*(-\s*\[[\s\S]*?)(\s*(?:,\s*"|}\s*$))/)
			if (unquotedTodosMatch) {
				const markdownContent = unquotedTodosMatch[1]
				const suffix = unquotedTodosMatch[2]
				const prefixEnd = unquotedTodosMatch.index! + '"todos":'.length
				const candidate = raw.slice(0, prefixEnd) + " " + JSON.stringify(markdownContent) + suffix
				candidates.push(candidate)
			}
		}

		// Recovery 2: strip bare control characters (≤ 0x1F or = 0x7F) embedded
		// inside JSON string values.  Walk character-by-character so structural JSON
		// (braces, colons, commas) is never touched.
		// eslint-disable-next-line no-control-regex
		if (/[\x00-\x1F\x7F]/.test(raw)) {
			let sanitized = ""
			let inString = false
			let escaped = false
			for (let i = 0; i < raw.length; i++) {
				const ch = raw[i]
				const code = raw.charCodeAt(i)
				if (escaped) {
					sanitized += ch
					escaped = false
					continue
				}
				if (ch === "\\") {
					sanitized += ch
					escaped = true
					continue
				}
				if (ch === '"') {
					inString = !inString
					sanitized += ch
					continue
				}
				if (inString && (code <= 0x1f || code === 0x7f)) {
					// Drop the illegal control character.
					continue
				}
				sanitized += ch
			}
			if (sanitized !== raw) {
				candidates.push(sanitized)
			}
		}

		return candidates
	}

	private static hasAdjacentTopLevelJsonValues(value: string): boolean {
		let depth = 0
		let inString = false
		let escaped = false
		let started = false

		for (let i = 0; i < value.length; i++) {
			const char = value[i]

			if (!started) {
				if (/\s/.test(char)) {
					continue
				}
				if (char !== "{" && char !== "[") {
					return false
				}
				started = true
			}

			if (inString) {
				if (escaped) {
					escaped = false
				} else if (char === "\\") {
					escaped = true
				} else if (char === '"') {
					inString = false
				}
				continue
			}

			if (char === '"') {
				inString = true
				continue
			}

			if (char === "{" || char === "[") {
				depth++
				continue
			}

			if (char === "}" || char === "]") {
				depth--
				if (depth === 0) {
					const rest = value.slice(i + 1).trimStart()
					return rest.startsWith("{") || rest.startsWith("[")
				}
			}
		}

		return false
	}

	/**
	 * Parse dynamic MCP tools (named mcp--serverName--toolName).
	 * These are generated dynamically by getMcpServerTools() and are returned
	 * as McpToolUse objects that preserve the original tool name.
	 */
	public static parseDynamicMcpTool(toolCall: { id: string; name: string; arguments: string }): McpToolUse | null {
		try {
			// Parse the arguments - these are the actual tool arguments passed directly
			const args = JSON.parse(toolCall.arguments || "{}")

			// Normalize the tool name to handle models that output underscores instead of hyphens
			// e.g., mcp__serverName__toolName -> mcp--serverName--toolName
			const normalizedName = normalizeMcpToolName(toolCall.name)

			// Extract server_name and tool_name from the tool name itself
			// Format: mcp--serverName--toolName (using -- separator)
			const parsed = parseMcpToolName(normalizedName)
			if (!parsed) {
				console.error(`Invalid dynamic MCP tool name format: ${toolCall.name} (normalized: ${normalizedName})`)
				return null
			}

			const { serverName, toolName } = parsed

			const result: McpToolUse = {
				type: "mcp_tool_use" as const,
				id: toolCall.id,
				// Keep the original tool name (e.g., "mcp--serverName--toolName") for API history
				name: toolCall.name,
				serverName,
				toolName,
				arguments: args,
				partial: false,
			}

			return result
		} catch (error) {
			console.error(`Failed to parse dynamic MCP tool:`, error)
			return null
		}
	}
}

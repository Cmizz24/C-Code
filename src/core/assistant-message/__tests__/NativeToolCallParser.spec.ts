import { NativeToolCallParser } from "../NativeToolCallParser"

describe("NativeToolCallParser", () => {
	beforeEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	function applyRawEvents(parser: NativeToolCallParser, events: ReturnType<NativeToolCallParser["processRawChunk"]>) {
		const finalized = []
		for (const event of events) {
			if (event.type === "tool_call_start") {
				parser.startStreamingToolCall(event.id, event.name)
			} else if (event.type === "tool_call_delta") {
				parser.processStreamingChunk(event.id, event.delta)
			} else if (event.type === "tool_call_end") {
				finalized.push(parser.finalizeStreamingToolCall(event.id))
			}
		}
		return finalized
	}

	describe("parseToolCall", () => {
		describe("new_task tool", () => {
			it("returns null for malformed interleaved JSON instead of producing nativeArgs", () => {
				const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

				const result = NativeToolCallParser.parseToolCall({
					id: "toolu_malformed_new_task",
					name: "new_task" as const,
					arguments: '{"mode":"code","message":"Build UI"}{"mode":"debug","message":"last a the"',
				})

				expect(result).toBeNull()
				expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to parse tool call arguments"))
				expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"name": "new_task"'))
				errorSpy.mockRestore()
			})

			it("recovers from unquoted markdown checklist in todos field (Issue 2)", () => {
				// Simulate the LLM emitting "todos": - [ ] Item ... without quoting the value.
				const rawArgs =
					'{"mode":"code","message":"Build dashboard","todos": - [ ] Create project\n- [ ] Add routing\n- [x] Review spec\n}'

				const result = NativeToolCallParser.parseToolCall({
					id: "toolu_unquoted_todos",
					name: "new_task" as const,
					arguments: rawArgs,
				})

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use" && result.nativeArgs) {
					expect(result.nativeArgs).toMatchObject({ mode: "code", message: "Build dashboard" })
					// The recovered todos field should be a string containing the markdown
					expect(typeof result.nativeArgs.todos).toBe("string")
					expect(String(result.nativeArgs.todos)).toContain("- [ ] Create project")
				}
			})
		})

		describe("plan_parallel_tasks tool", () => {
			it("recovers from raw control characters in sharedContext string (Issue 1)", () => {
				// Simulate a sharedContext field containing embedded TAB and BEL control chars.
				const sharedContextWithControlChars = "Use the shared API\tclient\x07for all agents"
				// Build a valid-except-for-control-chars JSON string.
				// Note: plan_parallel_tasks requires both `goal` and `agents` to produce nativeArgs.
				const rawArgs = `{"goal":"Build dashboard","agents":[{"agentId":"api-agent","description":"Build API","owns":[],"dependsOn":[]}],"sharedContext":"${sharedContextWithControlChars}"}`

				const result = NativeToolCallParser.parseToolCall({
					id: "toolu_ctrl_chars_sharedctx",
					name: "plan_parallel_tasks" as const,
					arguments: rawArgs,
				})

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					// sharedContext should have been sanitized — control chars stripped
					const sharedCtx = (result.nativeArgs as any).sharedContext as string
					// eslint-disable-next-line no-control-regex
					expect(sharedCtx).not.toMatch(/[\x00-\x1F\x7F]/)
					expect(sharedCtx).toContain("Use the shared API")
					expect(sharedCtx).toContain("client")
					expect(sharedCtx).toContain("for all agents")
				}
			})
		})

		describe("read_file tool", () => {
			it("returns a controlled parse error for same-name adjacent JSON arguments", () => {
				const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

				const result = NativeToolCallParser.parseToolCall({
					id: "toolu_same_name_concat",
					name: "read_file" as const,
					arguments: '{"path":"first.ts"}{"path":"second.ts"}',
				})

				expect(result).toBeNull()
				expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("multiple adjacent JSON values"))

				const laterResult = NativeToolCallParser.parseToolCall({
					id: "toolu_after_same_name_concat",
					name: "read_file" as const,
					arguments: JSON.stringify({ path: "later.ts" }),
				})
				expect(laterResult?.type).toBe("tool_use")
				if (laterResult?.type === "tool_use") {
					expect(laterResult.nativeArgs).toMatchObject({ path: "later.ts" })
				}

				errorSpy.mockRestore()
			})

			it("should parse minimal single-file read_file args", () => {
				const toolCall = {
					id: "toolu_123",
					name: "read_file" as const,
					arguments: JSON.stringify({
						path: "src/core/task/Task.ts",
					}),
				}

				const result = NativeToolCallParser.parseToolCall(toolCall)

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					expect(result.nativeArgs).toBeDefined()
					const nativeArgs = result.nativeArgs as { path: string }
					expect(nativeArgs.path).toBe("src/core/task/Task.ts")
				}
			})

			it("should parse slice-mode params", () => {
				const toolCall = {
					id: "toolu_123",
					name: "read_file" as const,
					arguments: JSON.stringify({
						path: "src/core/task/Task.ts",
						mode: "slice",
						offset: 10,
						limit: 20,
					}),
				}

				const result = NativeToolCallParser.parseToolCall(toolCall)

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					const nativeArgs = result.nativeArgs as {
						path: string
						mode?: string
						offset?: number
						limit?: number
					}
					expect(nativeArgs.path).toBe("src/core/task/Task.ts")
					expect(nativeArgs.mode).toBe("slice")
					expect(nativeArgs.offset).toBe(10)
					expect(nativeArgs.limit).toBe(20)
				}
			})

			it("should parse indentation-mode params", () => {
				const toolCall = {
					id: "toolu_123",
					name: "read_file" as const,
					arguments: JSON.stringify({
						path: "src/utils.ts",
						mode: "indentation",
						indentation: {
							anchor_line: 123,
							max_levels: 2,
							include_siblings: true,
							include_header: false,
						},
					}),
				}

				const result = NativeToolCallParser.parseToolCall(toolCall)

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					const nativeArgs = result.nativeArgs as {
						path: string
						mode?: string
						indentation?: {
							anchor_line?: number
							max_levels?: number
							include_siblings?: boolean
							include_header?: boolean
						}
					}
					expect(nativeArgs.path).toBe("src/utils.ts")
					expect(nativeArgs.mode).toBe("indentation")
					expect(nativeArgs.indentation?.anchor_line).toBe(123)
					expect(nativeArgs.indentation?.include_siblings).toBe(true)
					expect(nativeArgs.indentation?.include_header).toBe(false)
				}
			})

			// Legacy format backward compatibility tests
			describe("legacy format backward compatibility", () => {
				it("should parse legacy files array format with single file", () => {
					const toolCall = {
						id: "toolu_legacy_1",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [{ path: "src/legacy/file.ts" }],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as { files: Array<{ path: string }>; _legacyFormat: true }
						expect(nativeArgs._legacyFormat).toBe(true)
						expect(nativeArgs.files).toHaveLength(1)
						expect(nativeArgs.files[0].path).toBe("src/legacy/file.ts")
					}
				})

				it("should parse legacy files array format with multiple files", () => {
					const toolCall = {
						id: "toolu_legacy_2",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [{ path: "src/file1.ts" }, { path: "src/file2.ts" }, { path: "src/file3.ts" }],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as { files: Array<{ path: string }>; _legacyFormat: true }
						expect(nativeArgs.files).toHaveLength(3)
						expect(nativeArgs.files[0].path).toBe("src/file1.ts")
						expect(nativeArgs.files[1].path).toBe("src/file2.ts")
						expect(nativeArgs.files[2].path).toBe("src/file3.ts")
					}
				})

				it("should parse legacy line_ranges as tuples", () => {
					const toolCall = {
						id: "toolu_legacy_3",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [
								{
									path: "src/task.ts",
									line_ranges: [
										[1, 50],
										[100, 150],
									],
								},
							],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as {
							files: Array<{ path: string; lineRanges?: Array<{ start: number; end: number }> }>
							_legacyFormat: true
						}
						expect(nativeArgs.files[0].lineRanges).toHaveLength(2)
						expect(nativeArgs.files[0].lineRanges?.[0]).toEqual({ start: 1, end: 50 })
						expect(nativeArgs.files[0].lineRanges?.[1]).toEqual({ start: 100, end: 150 })
					}
				})

				it("should parse legacy line_ranges as objects", () => {
					const toolCall = {
						id: "toolu_legacy_4",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [
								{
									path: "src/task.ts",
									line_ranges: [
										{ start: 10, end: 20 },
										{ start: 30, end: 40 },
									],
								},
							],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as {
							files: Array<{ path: string; lineRanges?: Array<{ start: number; end: number }> }>
						}
						expect(nativeArgs.files[0].lineRanges).toHaveLength(2)
						expect(nativeArgs.files[0].lineRanges?.[0]).toEqual({ start: 10, end: 20 })
						expect(nativeArgs.files[0].lineRanges?.[1]).toEqual({ start: 30, end: 40 })
					}
				})

				it("should parse legacy line_ranges as strings", () => {
					const toolCall = {
						id: "toolu_legacy_5",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [
								{
									path: "src/task.ts",
									line_ranges: ["1-50", "100-150"],
								},
							],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as {
							files: Array<{ path: string; lineRanges?: Array<{ start: number; end: number }> }>
						}
						expect(nativeArgs.files[0].lineRanges).toHaveLength(2)
						expect(nativeArgs.files[0].lineRanges?.[0]).toEqual({ start: 1, end: 50 })
						expect(nativeArgs.files[0].lineRanges?.[1]).toEqual({ start: 100, end: 150 })
					}
				})

				it("should parse double-stringified files array (model quirk)", () => {
					// This tests the real-world case where some models double-stringify the files array
					// e.g., { files: "[{\"path\": \"...\"}]" } instead of { files: [{path: "..."}] }
					const toolCall = {
						id: "toolu_double_stringify",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: JSON.stringify([
								{ path: "src/services/example/service.ts" },
								{ path: "src/services/mcp/McpServerManager.ts" },
							]),
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as {
							files: Array<{ path: string }>
							_legacyFormat: true
						}
						expect(nativeArgs._legacyFormat).toBe(true)
						expect(nativeArgs.files).toHaveLength(2)
						expect(nativeArgs.files[0].path).toBe("src/services/example/service.ts")
						expect(nativeArgs.files[1].path).toBe("src/services/mcp/McpServerManager.ts")
					}
				})

				it("should NOT set usedLegacyFormat for new format", () => {
					const toolCall = {
						id: "toolu_new",
						name: "read_file" as const,
						arguments: JSON.stringify({
							path: "src/new/format.ts",
							mode: "slice",
							offset: 1,
							limit: 100,
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBeUndefined()
					}
				})
			})
		})

		describe("list_files tool", () => {
			it("returns a controlled parse error for different-call adjacent JSON arguments", () => {
				const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

				const result = NativeToolCallParser.parseToolCall({
					id: "toolu_different_name_concat",
					name: "list_files" as const,
					arguments: '{"path":".","recursive":false}{"path":"src/README.md"}',
				})

				expect(result).toBeNull()
				expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("multiple adjacent JSON values"))

				const laterResult = NativeToolCallParser.parseToolCall({
					id: "toolu_after_different_name_concat",
					name: "list_files" as const,
					arguments: JSON.stringify({ path: "src", recursive: true }),
				})
				expect(laterResult?.type).toBe("tool_use")
				if (laterResult?.type === "tool_use") {
					expect(laterResult.nativeArgs).toEqual({ path: "src", recursive: true })
				}

				errorSpy.mockRestore()
			})
		})

		describe("coordinate_agents tool", () => {
			it("accepts reported read payloads with harmless publish-style fields and sanitizes to read args", () => {
				const payloads = [
					{
						action: "read",
						kind: "note",
						message: "",
						targetAgentId: "",
						relatedFiles: [],
						replyToId: "",
						limit: 8,
					},
					{
						action: "read",
						kind: "note",
						message: "Reading recent coordination messages before creating index.html structure.",
						targetAgentId: "",
						relatedFiles: ["index.html"],
						replyToId: "",
						limit: 8,
					},
				]

				for (const [index, payload] of payloads.entries()) {
					const result = NativeToolCallParser.parseToolCall({
						id: `toolu_coordinate_read_${index}`,
						name: "coordinate_agents" as const,
						arguments: JSON.stringify(payload),
					})

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.nativeArgs).toEqual({ action: "read", limit: 8 })
					}
				}
			})

			it("accepts reported publish payloads and normalizes broadcast/no-reply sentinels", () => {
				const result = NativeToolCallParser.parseToolCall({
					id: "toolu_coordinate_publish",
					name: "coordinate_agents" as const,
					arguments: JSON.stringify({
						action: "publish",
						kind: "decision",
						message: "Use styles.css for shared layout classes.",
						targetAgentId: "all",
						relatedFiles: ["styles.css"],
						replyToId: "",
						limit: 8,
					}),
				})

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					expect(result.nativeArgs).toEqual({
						action: "publish",
						kind: "decision",
						message: "Use styles.css for shared layout classes.",
						relatedFiles: ["styles.css"],
						limit: 8,
					})
				}
			})

			it("keeps invalid coordinate_agents values strict", () => {
				const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

				const invalidKind = NativeToolCallParser.parseToolCall({
					id: "toolu_coordinate_invalid_kind",
					name: "coordinate_agents" as const,
					arguments: JSON.stringify({ action: "publish", kind: "status", message: "Invalid kind." }),
				})
				const invalidLimit = NativeToolCallParser.parseToolCall({
					id: "toolu_coordinate_invalid_limit",
					name: "coordinate_agents" as const,
					arguments: JSON.stringify({ action: "read", limit: 21 }),
				})
				expect(invalidKind).toBeNull()
				expect(invalidLimit).toBeNull()
				expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("coordinate_agents kind must be one of"))
				expect(errorSpy).toHaveBeenCalledWith(
					expect.stringContaining("coordinate_agents limit must be between"),
				)

				errorSpy.mockRestore()
			})

			it("normalizes overlong coordinate_agents messages before validation", () => {
				const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
				const message = ` ${"Use concise integration evidence. ".repeat(20)}\n\nFinal sentence. `

				const result = NativeToolCallParser.parseToolCall({
					id: "toolu_coordinate_overlong_message",
					name: "coordinate_agents" as const,
					arguments: JSON.stringify({ action: "publish", kind: "question", message }),
				})

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					const nativeArgs = result.nativeArgs as { message?: string }
					expect(nativeArgs.message).toBeDefined()
					expect(nativeArgs.message?.length).toBeLessThanOrEqual(240)
					expect(nativeArgs.message).toMatch(/…$/)
					expect(nativeArgs.message).not.toContain("\n")
				}
				expect(errorSpy).not.toHaveBeenCalled()

				errorSpy.mockRestore()
			})
		})
	})

	describe("processRawChunk", () => {
		it("keeps provider-id tool calls separate even when the stream reuses an index", () => {
			const parser = new NativeToolCallParser()

			const firstEvents = parser.processRawChunk({
				index: 0,
				id: "call_read_first",
				name: "read_file",
				arguments: '{"path":"first.ts"}',
			})
			const secondEvents = parser.processRawChunk({
				index: 0,
				id: "call_read_second",
				name: "read_file",
				arguments: '{"path":"second.ts"}',
			})

			expect(firstEvents).toEqual([
				{ type: "tool_call_start", id: "call_read_first", name: "read_file" },
				{ type: "tool_call_delta", id: "call_read_first", delta: '{"path":"first.ts"}' },
			])
			expect(secondEvents).toEqual([
				{ type: "tool_call_start", id: "call_read_second", name: "read_file" },
				{ type: "tool_call_delta", id: "call_read_second", delta: '{"path":"second.ts"}' },
			])
			expect(parser.processFinishReason("tool_calls")).toEqual([
				{ type: "tool_call_end", id: "call_read_first" },
				{ type: "tool_call_end", id: "call_read_second" },
			])
		})

		it("keeps same-name calls separate when index is omitted or reused", () => {
			const parser = new NativeToolCallParser()

			applyRawEvents(
				parser,
				parser.processRawChunk({ index: 0, name: "read_file", arguments: '{"path":"first.ts"}' }),
			)
			applyRawEvents(
				parser,
				parser.processRawChunk({ index: 0, name: "read_file", arguments: '{"path":"second.ts"}' }),
			)

			const finalized = applyRawEvents(parser, parser.finalizeRawChunks())

			expect(finalized).toHaveLength(2)
			expect(finalized[0]?.type).toBe("tool_use")
			expect(finalized[1]?.type).toBe("tool_use")
			if (finalized[0]?.type === "tool_use") {
				expect(finalized[0].id).toBe("tool_call_0")
				expect(finalized[0].nativeArgs).toMatchObject({ path: "first.ts" })
			}
			if (finalized[1]?.type === "tool_use") {
				expect(finalized[1].id).toBe("tool_call_1")
				expect(finalized[1].nativeArgs).toMatchObject({ path: "second.ts" })
			}
		})

		it("starts a new same-name call when a fresh function name appears after complete arguments", () => {
			const parser = new NativeToolCallParser()

			applyRawEvents(parser, parser.processRawChunk({ index: 0, name: "read_file" }))
			applyRawEvents(parser, parser.processRawChunk({ index: 0, arguments: '{"path":"first.ts"}' }))
			applyRawEvents(parser, parser.processRawChunk({ index: 0, name: "read_file" }))
			applyRawEvents(parser, parser.processRawChunk({ index: 0, arguments: '{"path":"second.ts"}' }))

			const finalized = applyRawEvents(parser, parser.finalizeRawChunks())

			expect(finalized).toHaveLength(2)
			if (finalized[0]?.type === "tool_use") {
				expect(finalized[0].nativeArgs).toMatchObject({ path: "first.ts" })
			}
			if (finalized[1]?.type === "tool_use") {
				expect(finalized[1].nativeArgs).toMatchObject({ path: "second.ts" })
			}
		})

		it("keeps different tool names separate when index is omitted", () => {
			const parser = new NativeToolCallParser()

			applyRawEvents(parser, parser.processRawChunk({ name: "list_files", arguments: '{"path":"src"}' }))
			applyRawEvents(parser, parser.processRawChunk({ name: "read_file", arguments: '{"path":"README.md"}' }))

			const finalized = applyRawEvents(parser, parser.finalizeRawChunks())

			expect(finalized).toHaveLength(2)
			if (finalized[0]?.type === "tool_use") {
				expect(finalized[0].id).toBe("tool_call_0")
				expect(finalized[0].name).toBe("list_files")
				expect(finalized[0].nativeArgs).toEqual({ path: "src", recursive: undefined })
			}
			if (finalized[1]?.type === "tool_use") {
				expect(finalized[1].id).toBe("tool_call_1")
				expect(finalized[1].name).toBe("read_file")
				expect(finalized[1].nativeArgs).toMatchObject({ path: "README.md" })
			}
		})
	})

	describe("processStreamingChunk", () => {
		describe("read_file tool", () => {
			it("should emit a partial ToolUse with nativeArgs.path during streaming", () => {
				const id = "toolu_streaming_123"
				NativeToolCallParser.startStreamingToolCall(id, "read_file")

				// Simulate streaming chunks
				const fullArgs = JSON.stringify({ path: "src/test.ts" })

				// Process the complete args as a single chunk for simplicity
				const result = NativeToolCallParser.processStreamingChunk(id, fullArgs)

				expect(result).not.toBeNull()
				expect(result?.nativeArgs).toBeDefined()
				const nativeArgs = result?.nativeArgs as { path: string }
				expect(nativeArgs.path).toBe("src/test.ts")
			})
		})
	})

	describe("instance isolation", () => {
		it("does not share raw chunk tracking between parser instances with the same tool index", () => {
			const parserA = new NativeToolCallParser()
			const parserB = new NativeToolCallParser()

			const eventsA = parserA.processRawChunk({
				index: 0,
				id: "call_agent_a",
				name: "read_file",
				arguments: '{"path":"agent-a.ts"}',
			})
			const eventsB = parserB.processRawChunk({
				index: 0,
				id: "call_agent_b",
				name: "list_files",
				arguments: '{"path":"agent-b","recursive":true}',
			})

			expect(eventsA).toEqual([
				{ type: "tool_call_start", id: "call_agent_a", name: "read_file" },
				{ type: "tool_call_delta", id: "call_agent_a", delta: '{"path":"agent-a.ts"}' },
			])
			expect(eventsB).toEqual([
				{ type: "tool_call_start", id: "call_agent_b", name: "list_files" },
				{ type: "tool_call_delta", id: "call_agent_b", delta: '{"path":"agent-b","recursive":true}' },
			])
			expect(parserA.processFinishReason("tool_calls")).toEqual([{ type: "tool_call_end", id: "call_agent_a" }])
			expect(parserB.processFinishReason("tool_calls")).toEqual([{ type: "tool_call_end", id: "call_agent_b" }])
		})

		it("does not concatenate streaming arguments from different parser instances", () => {
			const parserA = new NativeToolCallParser()
			const parserB = new NativeToolCallParser()

			parserA.startStreamingToolCall("call_agent_a", "read_file")
			parserB.startStreamingToolCall("call_agent_b", "list_files")

			parserA.processStreamingChunk("call_agent_a", '{"path":"agent-a.ts"}')
			parserB.processStreamingChunk("call_agent_b", '{"path":"agent-b","recursive":true}')

			const resultA = parserA.finalizeStreamingToolCall("call_agent_a")
			const resultB = parserB.finalizeStreamingToolCall("call_agent_b")

			expect(resultA?.type).toBe("tool_use")
			expect(resultB?.type).toBe("tool_use")
			if (resultA?.type === "tool_use") {
				expect(resultA.name).toBe("read_file")
				expect(resultA.nativeArgs).toEqual({
					path: "agent-a.ts",
					mode: undefined,
					offset: undefined,
					limit: undefined,
					indentation: undefined,
				})
			}
			if (resultB?.type === "tool_use") {
				expect(resultB.name).toBe("list_files")
				expect(resultB.nativeArgs).toEqual({ path: "agent-b", recursive: true })
			}
		})
	})

	describe("finalizeStreamingToolCall", () => {
		describe("read_file tool", () => {
			it("should parse read_file args on finalize", () => {
				const id = "toolu_finalize_123"
				NativeToolCallParser.startStreamingToolCall(id, "read_file")

				// Add the complete arguments
				NativeToolCallParser.processStreamingChunk(
					id,
					JSON.stringify({
						path: "finalized.ts",
						mode: "slice",
						offset: 1,
						limit: 10,
					}),
				)

				const result = NativeToolCallParser.finalizeStreamingToolCall(id)

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					const nativeArgs = result.nativeArgs as { path: string; offset?: number; limit?: number }
					expect(nativeArgs.path).toBe("finalized.ts")
					expect(nativeArgs.offset).toBe(1)
					expect(nativeArgs.limit).toBe(10)
				}
			})
		})
	})
})

import type { ExtensionState } from "@roo-code/types"

import { checkAutoApproval, type AutoApprovalState, type AutoApprovalStateOptions } from "../index"

type AutoApprovalSettings = Pick<ExtensionState, AutoApprovalState | AutoApprovalStateOptions>

const createState = (overrides: Partial<AutoApprovalSettings> = {}): AutoApprovalSettings =>
	({
		autoApprovalEnabled: true,
		alwaysAllowReadOnly: false,
		alwaysAllowReadOnlyOutsideWorkspace: false,
		alwaysAllowWrite: false,
		alwaysAllowWriteOutsideWorkspace: false,
		alwaysAllowWriteProtected: false,
		alwaysAllowMcp: false,
		alwaysAllowModeSwitch: false,
		alwaysAllowSubtasks: false,
		alwaysAllowParallelTasks: false,
		alwaysAllowVisualBrowserInspector: false,
		alwaysAllowImageGeneration: false,
		memoryAutoApproveMistakeMemory: false,
		alwaysAllowExecute: false,
		alwaysAllowFollowupQuestions: false,
		followupAutoApproveTimeoutMs: undefined,
		mcpServers: [],
		allowedCommands: [],
		deniedCommands: [],
		...overrides,
	}) as AutoApprovalSettings

describe("checkAutoApproval", () => {
	describe("visual browser inspector tools", () => {
		it.each(["visualBrowserInspector", "visual_browser_inspector"])(
			"auto-approves %s when the VBI setting and global auto-approval are enabled",
			async (tool) => {
				const result = await checkAutoApproval({
					state: createState({ alwaysAllowVisualBrowserInspector: true }),
					ask: "tool",
					text: JSON.stringify({ tool }),
				})

				expect(result).toEqual({ decision: "approve" })
			},
		)

		it("asks when global auto-approval is disabled", async () => {
			const result = await checkAutoApproval({
				state: createState({ autoApprovalEnabled: false, alwaysAllowVisualBrowserInspector: true }),
				ask: "tool",
				text: JSON.stringify({ tool: "visualBrowserInspector" }),
			})

			expect(result).toEqual({ decision: "ask" })
		})

		it.each([false, undefined])("asks when the VBI setting is %s", async (alwaysAllowVisualBrowserInspector) => {
			const result = await checkAutoApproval({
				state: createState({ alwaysAllowVisualBrowserInspector }),
				ask: "tool",
				text: JSON.stringify({ tool: "visualBrowserInspector" }),
			})

			expect(result).toEqual({ decision: "ask" })
		})

		it("does not fall through to read, write, or execute auto-approval categories", async () => {
			const result = await checkAutoApproval({
				state: createState({
					alwaysAllowReadOnly: true,
					alwaysAllowWrite: true,
					alwaysAllowWriteOutsideWorkspace: true,
					alwaysAllowWriteProtected: true,
					alwaysAllowExecute: true,
					alwaysAllowVisualBrowserInspector: false,
				}),
				ask: "tool",
				text: JSON.stringify({ tool: "visualBrowserInspector", isOutsideWorkspace: false }),
			})

			expect(result).toEqual({ decision: "ask" })
		})
	})

	describe("image generation tools", () => {
		it("auto-approves generateImage when the image generation setting and global auto-approval are enabled", async () => {
			const result = await checkAutoApproval({
				state: createState({ alwaysAllowImageGeneration: true }),
				ask: "tool",
				text: JSON.stringify({ tool: "generateImage" }),
			})

			expect(result).toEqual({ decision: "approve" })
		})

		it("asks when global auto-approval is disabled", async () => {
			const result = await checkAutoApproval({
				state: createState({ autoApprovalEnabled: false, alwaysAllowImageGeneration: true }),
				ask: "tool",
				text: JSON.stringify({ tool: "generateImage" }),
			})

			expect(result).toEqual({ decision: "ask" })
		})

		it.each([false, undefined])(
			"asks when the image generation setting is %s",
			async (alwaysAllowImageGeneration) => {
				const result = await checkAutoApproval({
					state: createState({ alwaysAllowImageGeneration }),
					ask: "tool",
					text: JSON.stringify({ tool: "generateImage" }),
				})

				expect(result).toEqual({ decision: "ask" })
			},
		)

		it("does not fall through to read, write, or execute auto-approval categories", async () => {
			const result = await checkAutoApproval({
				state: createState({
					alwaysAllowReadOnly: true,
					alwaysAllowWrite: true,
					alwaysAllowWriteOutsideWorkspace: true,
					alwaysAllowWriteProtected: true,
					alwaysAllowExecute: true,
					alwaysAllowImageGeneration: false,
				}),
				ask: "tool",
				text: JSON.stringify({ tool: "generateImage", isOutsideWorkspace: false }),
			})

			expect(result).toEqual({ decision: "ask" })
		})
	})

	describe("mistake memory tools", () => {
		it("auto-approves mistakeMemory when the memory setting and global auto-approval are enabled", async () => {
			const result = await checkAutoApproval({
				state: createState({ memoryAutoApproveMistakeMemory: true }),
				ask: "tool",
				text: JSON.stringify({ tool: "mistakeMemory" }),
			})

			expect(result).toEqual({ decision: "approve" })
		})

		it("asks when global auto-approval is disabled", async () => {
			const result = await checkAutoApproval({
				state: createState({ autoApprovalEnabled: false, memoryAutoApproveMistakeMemory: true }),
				ask: "tool",
				text: JSON.stringify({ tool: "mistakeMemory" }),
			})

			expect(result).toEqual({ decision: "ask" })
		})

		it.each([false, undefined])(
			"asks when the mistake memory auto-approval setting is %s",
			async (memoryAutoApproveMistakeMemory) => {
				const result = await checkAutoApproval({
					state: createState({ memoryAutoApproveMistakeMemory }),
					ask: "tool",
					text: JSON.stringify({ tool: "mistakeMemory" }),
				})

				expect(result).toEqual({ decision: "ask" })
			},
		)

		it("does not fall through to read, write, or execute auto-approval categories", async () => {
			const result = await checkAutoApproval({
				state: createState({
					alwaysAllowReadOnly: true,
					alwaysAllowWrite: true,
					alwaysAllowWriteOutsideWorkspace: true,
					alwaysAllowWriteProtected: true,
					alwaysAllowExecute: true,
					memoryAutoApproveMistakeMemory: false,
				}),
				ask: "tool",
				text: JSON.stringify({ tool: "mistakeMemory", isOutsideWorkspace: false }),
			})

			expect(result).toEqual({ decision: "ask" })
		})
	})
})

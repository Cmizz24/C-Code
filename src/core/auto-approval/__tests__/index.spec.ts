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
})

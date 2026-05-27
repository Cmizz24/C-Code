import fs from "fs/promises"

import type { ClineSayTool } from "@roo-code/types"

import { fileExistsAtPath } from "../../../utils/fs"
import type { ToolResponse, ToolUse } from "../../../shared/tools"
import { ApplyPatchTool } from "../ApplyPatchTool"

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn().mockResolvedValue("old\n"),
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		unlink: vi.fn().mockResolvedValue(undefined),
	},
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(true),
}))

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((message: string) => `Error: ${message}`),
		rooIgnoreError: vi.fn((filePath: string) => `Access denied: ${filePath}`),
		createPrettyPatch: vi.fn(() => "mock-diff"),
	},
}))

vi.mock("../../diff/stats", () => ({
	sanitizeUnifiedDiff: vi.fn((diff: string) => diff),
	computeDiffStats: vi.fn(() => ({ additions: 1, deletions: 1 })),
}))

describe("ApplyPatchTool ownership coordination", () => {
	let tool: ApplyPatchTool
	let task: any
	let askApproval: ReturnType<typeof vi.fn>
	let handleError: ReturnType<typeof vi.fn>
	let pushToolResult: ReturnType<typeof vi.fn>
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		vi.clearAllMocks()

		tool = new ApplyPatchTool()
		toolResult = undefined
		askApproval = vi.fn().mockResolvedValue(true)
		handleError = vi.fn().mockResolvedValue(undefined)
		pushToolResult = vi.fn((result: ToolResponse) => {
			toolResult = result
		})

		task = {
			background: false,
			cwd: "/workspace",
			consecutiveMistakeCount: 0,
			didEditFile: false,
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi
						.fn()
						.mockResolvedValue({ diagnosticsEnabled: true, writeDelayMs: 1000, experiments: {} }),
				}),
			},
			rooIgnoreController: {
				validateAccess: vi.fn().mockReturnValue(true),
			},
			rooProtectedController: {
				isWriteProtected: vi.fn().mockReturnValue(false),
			},
			diffViewProvider: {
				editType: undefined,
				originalContent: "",
				open: vi.fn().mockResolvedValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				scrollToFirstDiff: vi.fn(),
				revertChanges: vi.fn().mockResolvedValue(undefined),
				saveChanges: vi
					.fn()
					.mockResolvedValue({ newProblemsMessage: "", userEdits: null, finalContent: "new\n" }),
				saveDirectly: vi.fn().mockResolvedValue({
					newProblemsMessage: "",
					userEdits: undefined,
					finalContent: "new\n",
				}),
				pushToolWriteResult: vi.fn().mockResolvedValue("Tool result message"),
				reset: vi.fn().mockResolvedValue(undefined),
			},
			fileContextTracker: {
				trackFileContext: vi.fn().mockResolvedValue(undefined),
			},
			say: vi.fn().mockResolvedValue(undefined),
			recordToolError: vi.fn(),
			recordToolUsage: vi.fn(),
			processQueuedMessages: vi.fn(),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing param error"),
			requestAgentWriteIntent: vi.fn().mockReturnValue({ approved: true }),
			releaseAgentWriteIntent: vi.fn(),
		}

		vi.mocked(fs.readFile).mockResolvedValue("old\n")
		vi.mocked(fileExistsAtPath).mockResolvedValue(true)
	})

	async function executePatch(patch: string): Promise<ToolResponse | undefined> {
		const toolUse: ToolUse<"apply_patch"> = {
			type: "tool_use",
			name: "apply_patch",
			params: { patch },
			nativeArgs: { patch },
			partial: false,
		}

		await tool.handle(task, toolUse, { askApproval, handleError, pushToolResult })

		return toolResult
	}

	it("acquires and releases write intent around updates", async () => {
		await executePatch(`*** Begin Patch
*** Update File: src/owned.ts
@@
-old
+new
*** End Patch`)

		expect(task.requestAgentWriteIntent).toHaveBeenCalledWith("src/owned.ts")
		expect(task.diffViewProvider.saveChanges).toHaveBeenCalled()
		expect(task.releaseAgentWriteIntent).toHaveBeenCalledWith("src/owned.ts")
		expect(task.recordToolUsage).toHaveBeenCalledWith("apply_patch")
	})

	it("saves background patch updates directly without opening editable preview", async () => {
		task.background = true

		await executePatch(`*** Begin Patch
*** Update File: src/owned.ts
@@
-old
+new
*** End Patch`)

		expect(askApproval).toHaveBeenCalled()
		expect(task.diffViewProvider.open).not.toHaveBeenCalled()
		expect(task.diffViewProvider.update).not.toHaveBeenCalled()
		expect(task.diffViewProvider.scrollToFirstDiff).not.toHaveBeenCalled()
		expect(task.diffViewProvider.saveChanges).not.toHaveBeenCalled()
		expect(task.diffViewProvider.saveDirectly).toHaveBeenCalledWith("src/owned.ts", "new\n", false, true, 1000)
		expect(task.recordToolUsage).toHaveBeenCalledWith("apply_patch")
	})

	it("saves background patch additions directly without opening the new file", async () => {
		task.background = true
		vi.mocked(fileExistsAtPath).mockResolvedValue(false)

		await executePatch(`*** Begin Patch
*** Add File: src/new.ts
+new
*** End Patch`)

		expect(task.diffViewProvider.open).not.toHaveBeenCalled()
		expect(task.diffViewProvider.update).not.toHaveBeenCalled()
		expect(task.diffViewProvider.saveChanges).not.toHaveBeenCalled()
		expect(task.diffViewProvider.saveDirectly).toHaveBeenCalledWith("src/new.ts", "new\n", false, true, 1000)
	})

	it("denies patch writes when ownership rejects the path", async () => {
		task.requestAgentWriteIntent.mockReturnValue({
			approved: false,
			reason: "src/other.ts is owned by another agent.",
		})
		vi.mocked(fileExistsAtPath).mockResolvedValue(false)

		const result = await executePatch(`*** Begin Patch
*** Add File: src/other.ts
+new
*** End Patch`)

		expect(result).toContain("owned by another agent")
		expect(task.say).toHaveBeenCalledWith("error", "src/other.ts is owned by another agent.")
		expect(askApproval).not.toHaveBeenCalled()
		expect(task.diffViewProvider.saveChanges).not.toHaveBeenCalled()
		expect(task.releaseAgentWriteIntent).not.toHaveBeenCalled()
	})

	it("checks and releases both source and destination paths for moves", async () => {
		task.requestAgentWriteIntent
			.mockReturnValueOnce({ approved: true })
			.mockReturnValueOnce({ approved: false, reason: "src/new.ts is owned by another agent." })

		const result = await executePatch(`*** Begin Patch
*** Update File: src/old.ts
*** Move to: src/new.ts
@@
-old
+new
*** End Patch`)

		expect(result).toContain("owned by another agent")
		expect(task.requestAgentWriteIntent).toHaveBeenNthCalledWith(1, "src/old.ts")
		expect(task.requestAgentWriteIntent).toHaveBeenNthCalledWith(2, "src/new.ts")
		expect(task.releaseAgentWriteIntent).toHaveBeenCalledWith("src/old.ts")
		expect(askApproval).not.toHaveBeenCalled()
	})
})

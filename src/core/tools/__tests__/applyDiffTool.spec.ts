import fs from "fs/promises"

import { fileExistsAtPath } from "../../../utils/fs"
import { applyDiffTool } from "../ApplyDiffTool"
import type { ToolResponse, ToolUse } from "../../../shared/tools"

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn().mockResolvedValue("old content\nextra\n"),
	},
	readFile: vi.fn().mockResolvedValue("old content\nextra\n"),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(true),
}))

vi.mock("../../../utils/path", () => ({
	getReadablePath: vi.fn((_cwd: string, relPath: string | undefined) => relPath ?? ""),
}))

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		createPrettyPatch: vi.fn(
			() => "--- src/app.ts\n+++ src/app.ts\n@@ -1,2 +1,2 @@\n-old content\n+new content\n extra\n",
		),
		toolError: vi.fn((message: string) => `Error: ${message}`),
		rooIgnoreError: vi.fn((relPath: string) => `Access denied: ${relPath}`),
	},
}))

describe("applyDiffTool", () => {
	const relPath = "src/app.ts"
	const diffContent = [
		"<<<<<<< SEARCH",
		"old content",
		"=======",
		"new content",
		">>>>>>> REPLACE",
		"<<<<<<< SEARCH",
		"extra",
		"=======",
		"extra updated",
		">>>>>>> REPLACE",
	].join("\n")

	let mockTask: any
	let mockAskApproval: ReturnType<typeof vi.fn>
	let mockHandleError: ReturnType<typeof vi.fn>
	let mockPushToolResult: ReturnType<typeof vi.fn>
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		vi.clearAllMocks()
		applyDiffTool.resetPartialState()
		vi.mocked(fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(fs.readFile).mockResolvedValue("old content\nextra\n")

		mockTask = {
			background: false,
			cwd: "/workspace",
			api: {
				getModel: vi.fn().mockReturnValue({ id: "claude-3" }),
			},
			rooIgnoreController: {
				validateAccess: vi.fn().mockReturnValue(true),
			},
			rooProtectedController: {
				isWriteProtected: vi.fn().mockReturnValue(false),
			},
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi.fn().mockResolvedValue({
						diagnosticsEnabled: true,
						writeDelayMs: 1000,
						experiments: {},
					}),
				}),
			},
			diffStrategy: {
				applyDiff: vi.fn().mockResolvedValue({ success: true, content: "new content\nextra updated\n" }),
				getProgressStatus: vi.fn().mockReturnValue({ icon: "diff-multiple", text: "2" }),
			},
			diffViewProvider: {
				editType: undefined,
				originalContent: undefined,
				open: vi.fn().mockResolvedValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				scrollToFirstDiff: vi.fn(),
				revertChanges: vi.fn().mockResolvedValue(undefined),
				saveChanges: vi
					.fn()
					.mockImplementation(
						async (
							_diagnosticsEnabled: boolean,
							_writeDelayMs: number,
							onProgress?: (event: any) => void,
						) => {
							onProgress?.({ phase: "diagnostics-wait", relPath, delayMs: 1000 })
							onProgress?.({ phase: "diagnostics-check", relPath })
							return { newProblemsMessage: "", userEdits: undefined, finalContent: "new content" }
						},
					),
				saveDirectly: vi.fn().mockResolvedValue({
					newProblemsMessage: "",
					userEdits: undefined,
					finalContent: "new content",
				}),
				pushToolWriteResult: vi.fn().mockResolvedValue("Tool result message"),
				reset: vi.fn().mockResolvedValue(undefined),
			},
			fileContextTracker: {
				trackFileContext: vi.fn().mockResolvedValue(undefined),
			},
			reportAgentProgress: vi.fn(),
			requestAgentWriteIntent: vi.fn().mockReturnValue({ approved: true }),
			releaseAgentWriteIntent: vi.fn(),
			say: vi.fn().mockResolvedValue(undefined),
			recordToolError: vi.fn(),
			processQueuedMessages: vi.fn(),
			consecutiveMistakeCount: 0,
			consecutiveMistakeCountForApplyDiff: new Map<string, number>(),
			didEditFile: false,
		}

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn().mockResolvedValue(undefined)
		toolResult = undefined
		mockPushToolResult = vi.fn((result: ToolResponse) => {
			toolResult = result
		})
	})

	async function executeApplyDiffTool(): Promise<ToolResponse | undefined> {
		const toolUse: ToolUse<"apply_diff"> = {
			type: "tool_use",
			name: "apply_diff",
			params: { path: relPath, diff: diffContent },
			nativeArgs: { path: relPath, diff: diffContent },
			partial: false,
		}

		await applyDiffTool.handle(mockTask, toolUse, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		return toolResult
	}

	it("reports compact progress while applying, previewing, saving, and checking diagnostics", async () => {
		await executeApplyDiffTool()

		expect(mockTask.reportAgentProgress).toHaveBeenCalledWith("Preparing diff for src/app.ts.", "file", relPath)
		expect(mockTask.reportAgentProgress).toHaveBeenCalledWith(
			"Applying 2 diff blocks to src/app.ts.",
			"file",
			relPath,
		)
		expect(mockTask.reportAgentProgress).toHaveBeenCalledWith(
			"Opening diff preview for src/app.ts.",
			"file",
			relPath,
		)
		expect(mockTask.reportAgentProgress).toHaveBeenCalledWith(
			"Rendering diff preview for src/app.ts (+1/-1).",
			"file",
			relPath,
		)
		expect(mockTask.reportAgentProgress).toHaveBeenCalledWith("Saving diff changes to src/app.ts.", "file", relPath)
		expect(mockTask.reportAgentProgress).toHaveBeenCalledWith(
			"Waiting up to 1s for diagnostics after saving src/app.ts.",
			"file",
			relPath,
		)
		expect(mockTask.reportAgentProgress).toHaveBeenCalledWith(
			"Checking diagnostics for src/app.ts.",
			"file",
			relPath,
		)
		expect(mockTask.diffViewProvider.saveChanges).toHaveBeenCalledWith(true, 1000, expect.any(Function))
		expect(toolResult).toContain("Tool result message")
	})

	it("shows and saves live previews for background diffs", async () => {
		mockTask.background = true

		await executeApplyDiffTool()

		expect(mockAskApproval).toHaveBeenCalled()
		expect(mockTask.diffViewProvider.open).toHaveBeenCalledWith(relPath)
		expect(mockTask.diffViewProvider.update).toHaveBeenCalledWith("new content\nextra updated\n", true)
		expect(mockTask.diffViewProvider.scrollToFirstDiff).toHaveBeenCalled()
		expect(mockTask.diffViewProvider.saveChanges).toHaveBeenCalledWith(true, 1000, expect.any(Function))
		expect(mockTask.diffViewProvider.saveDirectly).not.toHaveBeenCalled()
		expect(toolResult).toContain("Tool result message")
	})
})

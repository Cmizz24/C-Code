import type { VisualBrowserInspectorToolParams } from "@roo-code/types"

import type { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { visualBrowserInspectorService } from "../../services/visual-browser-inspector/VisualBrowserInspectorService"
import { BaseTool, type ToolCallbacks } from "./BaseTool"

export class VisualBrowserInspectorTool extends BaseTool<"visual_browser_inspector"> {
	readonly name = "visual_browser_inspector" as const

	async execute(params: VisualBrowserInspectorToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const provider = task.providerRef.deref()
		const approvalMessage = JSON.stringify(
			{
				tool: "visual_browser_inspector",
				action: params.action,
				sessionId: "sessionId" in params ? params.sessionId : undefined,
				url: "url" in params ? params.url : undefined,
				screenshotId: "screenshotId" in params ? params.screenshotId : undefined,
				cropId: "cropId" in params ? params.cropId : undefined,
				note: "Controls only the Playwright browser page and stores screenshots/crops locally under .roo/visual-browser-inspector.",
			},
			null,
			2,
		)

		const didApprove = await askApproval("tool", approvalMessage)
		if (!didApprove) {
			return
		}

		try {
			const result = await visualBrowserInspectorService.execute(params, {
				cwd: task.cwd,
				toWebviewUri: provider?.convertToWebviewUri?.bind(provider),
			})

			pushToolResult(formatResponse.toolResult(JSON.stringify(result, null, 2)))
		} catch (error) {
			await handleError(
				`running visual browser inspector action ${params.action}`,
				error instanceof Error ? error : new Error(String(error)),
			)
		}
	}
}

export const visualBrowserInspectorTool = new VisualBrowserInspectorTool()

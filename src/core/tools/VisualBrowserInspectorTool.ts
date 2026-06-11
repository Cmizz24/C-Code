import type {
	ClineSayTool,
	VisualBrowserFocusTarget,
	VisualBrowserInspectorToolParams,
	VisualBrowserToolResult,
} from "@roo-code/types"

import type { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import {
	type VisualBrowserExecuteOptions,
	isVisualBrowserLocalUrl,
	visualBrowserInspectorService,
} from "../../services/visual-browser-inspector/VisualBrowserInspectorService"
import type { ToolUse } from "../../shared/tools"
import { BaseTool, type ToolCallbacks } from "./BaseTool"

function visualBrowserFocusFromParams(params: VisualBrowserInspectorToolParams): VisualBrowserFocusTarget {
	return {
		sessionId: "sessionId" in params ? params.sessionId : undefined,
		screenshotId: "screenshotId" in params ? params.screenshotId : undefined,
		cropId: "cropId" in params ? params.cropId : undefined,
	}
}

function visualBrowserFocusFromResult(result: VisualBrowserToolResult): VisualBrowserFocusTarget {
	return {
		sessionId: result.session.sessionId,
		screenshotId: result.screenshot?.screenshotId ?? result.crop?.screenshotId ?? result.inspection?.screenshotId,
		cropId: result.crop?.cropId ?? result.inspection?.cropId,
	}
}

function buildVisualBrowserToolPayloadFromParams(
	params: VisualBrowserInspectorToolParams,
	visualBrowserStatus: ClineSayTool["visualBrowserStatus"],
	toolCallId?: string,
): ClineSayTool {
	const focus = visualBrowserFocusFromParams(params)

	return {
		tool: "visualBrowserInspector",
		action: params.action,
		visualBrowserStatus,
		sessionId: focus.sessionId,
		url: "url" in params ? params.url : undefined,
		screenshotId: focus.screenshotId,
		cropId: focus.cropId,
		toolCallId,
	} satisfies ClineSayTool
}

function buildVisualBrowserToolPayloadFromResult(result: VisualBrowserToolResult, toolCallId?: string): ClineSayTool {
	const focus = visualBrowserFocusFromResult(result)

	return {
		tool: "visualBrowserInspector",
		action: result.action,
		visualBrowserStatus: "complete",
		visualBrowserResult: result,
		sessionId: focus.sessionId,
		url: result.session.url,
		screenshotId: focus.screenshotId,
		cropId: focus.cropId,
		toolCallId,
		message: result.message,
	} satisfies ClineSayTool
}

export class VisualBrowserInspectorTool extends BaseTool<"visual_browser_inspector"> {
	readonly name = "visual_browser_inspector" as const

	async execute(params: VisualBrowserInspectorToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const provider = task.providerRef.deref()
		const toolCallId = callbacks.toolCallId
		const approvalPayload = {
			...buildVisualBrowserToolPayloadFromParams(params, "running", toolCallId),
			note: "Controls only the Playwright browser page and stores screenshots/crops locally under .roo/visual-browser-inspector.",
		}
		const approvalMessage = JSON.stringify(approvalPayload, null, 2)

		const didApprove = await askApproval("tool", approvalMessage)
		if (!didApprove) {
			return
		}

		try {
			const toWebviewUri = provider?.convertToWebviewUri?.bind(provider)
			const options: VisualBrowserExecuteOptions = {
				cwd: task.cwd,
				toWebviewUri,
			}

			if (provider?.context?.globalStorageUri?.fsPath) {
				options.globalStoragePath = provider.context.globalStorageUri.fsPath
			}

			if (provider?.log) {
				options.log = provider.log.bind(provider)
			}

			if (provider?.postMessageToVisualBrowserInspectorPanels) {
				options.onBrowserInstallStatus = async (message: string) => {
					await provider.postMessageToVisualBrowserInspectorPanels({
						type: "visualBrowserInspector",
						payload: {
							state: visualBrowserInspectorService.getPanelState(options),
							source: "chat_tool",
							status: "running",
							toolCallId,
							focus: visualBrowserFocusFromParams(params),
							message,
						},
					})
				}
			}

			const result = await visualBrowserInspectorService.execute(params, options)
			const focus = visualBrowserFocusFromResult(result)
			const openedLocalPreview =
				params.action === "visual_browser_open" && isVisualBrowserLocalUrl(result.session.url)
			const message = openedLocalPreview
				? "Verified local preview opened in Visual Browser Inspector."
				: result.message || "Visual Browser Inspector action completed."

			await provider?.postMessageToVisualBrowserInspectorPanels?.({
				type: "visualBrowserInspector",
				payload: {
					state: visualBrowserInspectorService.getPanelState(options),
					result,
					source: "chat_tool",
					status: "complete",
					toolCallId,
					focus,
					localhostUrl: openedLocalPreview ? result.session.url : undefined,
					message,
				},
			})

			await task.say(
				"tool",
				JSON.stringify(buildVisualBrowserToolPayloadFromResult(result, toolCallId)),
				undefined,
				false,
			)

			pushToolResult(formatResponse.toolResult(JSON.stringify(result, null, 2)))
		} catch (error) {
			await handleError(
				`running visual browser inspector action ${params.action}`,
				error instanceof Error ? error : new Error(String(error)),
			)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"visual_browser_inspector">): Promise<void> {
		const action = block.params.action as VisualBrowserInspectorToolParams["action"] | undefined

		if (!action) {
			return
		}

		const partialPayload = buildVisualBrowserToolPayloadFromParams(
			{
				action,
				sessionId: block.params.sessionId,
				url: block.params.url,
				screenshotId: block.params.screenshotId,
				cropId: block.params.cropId,
			} as VisualBrowserInspectorToolParams,
			"running",
			block.id,
		)

		await task.ask("tool", JSON.stringify(partialPayload), block.partial).catch(() => {})
	}
}

export const visualBrowserInspectorTool = new VisualBrowserInspectorTool()

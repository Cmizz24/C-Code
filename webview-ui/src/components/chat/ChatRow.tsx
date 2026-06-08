import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSize } from "react-use"
import { useTranslation, Trans } from "react-i18next"
import deepEqual from "fast-deep-equal"
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react"

import type {
	ClineMessage,
	FollowUpData,
	SuggestionItem,
	ClineApiReqInfo,
	ClineAskUseMcpServer,
	ClineSayTool,
	GeneratedImageMetadata,
	ImageGenerationToolStatus,
} from "@roo-code/types"

import { Mode } from "@roo/modes"

import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"
import { safeJsonParse } from "@roo/core"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { findMatchingResourceOrTemplate } from "@src/utils/mcp"
import { vscode } from "@src/utils/vscode"
import { formatPathTooltip } from "@src/utils/formatPathTooltip"

import { ToolUseBlock, ToolUseBlockHeader } from "../common/ToolUseBlock"
import UpdateTodoListToolBlock from "./UpdateTodoListToolBlock"
import { TodoChangeDisplay } from "./TodoChangeDisplay"
import CodeAccordion from "../common/CodeAccordion"
import MarkdownBlock from "../common/MarkdownBlock"
import { ReasoningBlock } from "./ReasoningBlock"
import Thumbnails from "../common/Thumbnails"
import ImageBlock from "../common/ImageBlock"
import ErrorRow from "./ErrorRow"
import WarningRow from "./WarningRow"
import { AgentStatusPanel } from "@src/components/agents/AgentStatusPanel"

import McpResourceRow from "../mcp/McpResourceRow"

import { Mention } from "./Mention"
import { CheckpointSaved } from "./checkpoints/CheckpointSaved"
import { FollowUpSuggest } from "./FollowUpSuggest"
import { BatchFilePermission } from "./BatchFilePermission"
import { BatchDiffApproval } from "./BatchDiffApproval"
import { ProgressIndicator } from "./ProgressIndicator"
import { Markdown } from "./Markdown"
import { CommandExecution } from "./CommandExecution"
import { CommandExecutionError } from "./CommandExecutionError"
import { AutoApprovedRequestLimitWarning } from "./AutoApprovedRequestLimitWarning"
import { InProgressRow, CondensationResultRow, CondensationErrorRow, TruncationResultRow } from "./context-management"
import CodebaseSearchResultsDisplay from "./CodebaseSearchResultsDisplay"
import { appendImages } from "@src/utils/imageUtils"
import { McpExecution } from "./McpExecution"
import { ChatTextArea } from "./ChatTextArea"
import { MAX_IMAGES_PER_MESSAGE } from "./ChatView"
import { useSelectedModel } from "../ui/hooks/useSelectedModel"
import {
	Eye,
	FileDiff,
	ListTree,
	User,
	Edit,
	Trash2,
	MessageCircleQuestionMark,
	SquareArrowOutUpRight,
	FileCode2,
	PocketKnife,
	FolderTree,
	TerminalSquare,
	MessageCircle,
	Repeat2,
	Split,
	ArrowRight,
	Check,
	Image as ImageIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { PathTooltip } from "../ui/PathTooltip"
import { OpenMarkdownPreviewButton } from "./OpenMarkdownPreviewButton"

// Helper function to get previous todos before a specific message
function getPreviousTodos(messages: ClineMessage[], currentMessageTs: number): any[] {
	// Find the previous updateTodoList message before the current one
	const previousUpdateIndex = messages
		.slice()
		.reverse()
		.findIndex((msg) => {
			if (msg.ts >= currentMessageTs) return false
			if (msg.type === "ask" && msg.ask === "tool") {
				try {
					const tool = JSON.parse(msg.text || "{}")
					return tool.tool === "updateTodoList"
				} catch {
					return false
				}
			}
			return false
		})

	if (previousUpdateIndex !== -1) {
		const previousMessage = messages.slice().reverse()[previousUpdateIndex]
		try {
			const tool = JSON.parse(previousMessage.text || "{}")
			return tool.todos || []
		} catch {
			return []
		}
	}

	// If no previous updateTodoList message, return empty array
	return []
}

const visualBrowserActionLabels: Partial<Record<NonNullable<ClineSayTool["action"]>, string>> = {
	visual_browser_open: "Open page",
	visual_browser_reload: "Reload page",
	visual_browser_back: "Go back",
	visual_browser_forward: "Go forward",
	visual_browser_capture: "Capture screenshot",
	visual_browser_crop: "Create crop",
	visual_browser_inspect_point: "Inspect point",
	visual_browser_inspect_region: "Inspect region",
	visual_browser_click: "Click page",
	visual_browser_hover: "Hover page",
	visual_browser_type: "Type text",
	visual_browser_scroll: "Scroll page",
	visual_browser_analyze_screenshot: "Analyze screenshot",
	visual_browser_analyze_crop: "Analyze crop",
	visual_browser_close: "Close session",
	visual_browser_delete_session: "Delete session",
}

function formatVisualBrowserAction(action: ClineSayTool["action"]): string {
	if (!action) {
		return "Visual Browser Inspector"
	}

	return visualBrowserActionLabels[action] ?? action.replace(/^visual_browser_/, "").replace(/_/g, " ")
}

interface ChatRowProps {
	message: ClineMessage
	lastModifiedMessage?: ClineMessage
	isExpanded: boolean
	isLast: boolean
	isStreaming: boolean
	onToggleExpand: (ts: number) => void
	onHeightChange: (isTaller: boolean) => void
	onImageApprovalGenerate?: (prompt: string) => void
	onSuggestionClick?: (suggestion: SuggestionItem, event?: React.MouseEvent) => void
	onBatchFileResponse?: (response: { [key: string]: boolean }) => void
	onFollowUpUnmount?: () => void
	isFollowUpAnswered?: boolean
	isFollowUpAutoApprovalPaused?: boolean
	editable?: boolean
	hasCheckpoint?: boolean
	onJumpToPreviousCheckpoint?: () => void
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ChatRowContentProps extends Omit<ChatRowProps, "onHeightChange"> {}

interface GeneratedImageSayPayload {
	imageUri?: string
	imagePath?: string
	imageGeneration?: GeneratedImageMetadata
}

const ChatRow = memo(
	(props: ChatRowProps) => {
		const { isLast, onHeightChange, message } = props
		// Store the previous height to compare with the current height
		// This allows us to detect changes without causing re-renders
		const prevHeightRef = useRef(0)

		const [chatrow, { height }] = useSize(
			<div className="px-[15px] py-[10px] pr-[6px]">
				<ChatRowContent {...props} />
			</div>,
		)

		useEffect(() => {
			const isHeightValid = height !== 0 && height !== Infinity
			// used for partials, command output, etc.
			// NOTE: it's important we don't distinguish between partial or complete here since our scroll effects in chatview need to handle height change during partial -> complete
			const isInitialRender = prevHeightRef.current === 0 // prevents scrolling when new element is added since we already scroll for that
			// height starts off at Infinity
			if (isLast && isHeightValid && height !== prevHeightRef.current) {
				if (!isInitialRender) {
					onHeightChange(height > prevHeightRef.current)
				}
				prevHeightRef.current = height
			}
		}, [height, isLast, onHeightChange, message])

		// we cannot return null as virtuoso does not support it, so we use a separate visibleMessages array to filter out messages that should not be rendered
		return chatrow
	},
	// memo does shallow comparison of props, so we need to do deep comparison of arrays/objects whose properties might change
	deepEqual,
)

export default ChatRow

export const ChatRowContent = ({
	message,
	lastModifiedMessage,
	isExpanded,
	isLast,
	isStreaming,
	onToggleExpand,
	onImageApprovalGenerate,
	onSuggestionClick,
	onFollowUpUnmount,
	onBatchFileResponse,
	isFollowUpAnswered,
	isFollowUpAutoApprovalPaused,
	onJumpToPreviousCheckpoint,
}: ChatRowContentProps) => {
	const { t, i18n } = useTranslation()

	const { mcpServers, alwaysAllowMcp, currentCheckpoint, mode, apiConfiguration, clineMessages, currentTaskItem } =
		useExtensionState()
	const { info: model } = useSelectedModel(apiConfiguration)
	const [isEditing, setIsEditing] = useState(false)
	const [editedContent, setEditedContent] = useState("")
	const [editMode, setEditMode] = useState<Mode>(mode || "code")
	const [editImages, setEditImages] = useState<string[]>([])

	// Handle message events for image selection during edit mode
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const msg = event.data
			if (msg.type === "selectedImages" && msg.context === "edit" && msg.messageTs === message.ts && isEditing) {
				setEditImages((prevImages) => appendImages(prevImages, msg.images, MAX_IMAGES_PER_MESSAGE))
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [isEditing, message.ts])

	// Memoized callback to prevent re-renders caused by inline arrow functions.
	const handleToggleExpand = useCallback(() => {
		onToggleExpand(message.ts)
	}, [onToggleExpand, message.ts])

	// Handle edit button click
	const handleEditClick = useCallback(() => {
		setIsEditing(true)
		setEditedContent(message.text || "")
		setEditImages(message.images || [])
		setEditMode(mode || "code")
		// Edit mode is now handled entirely in the frontend
		// No need to notify the backend
	}, [message.text, message.images, mode])

	// Handle cancel edit
	const handleCancelEdit = useCallback(() => {
		setIsEditing(false)
		setEditedContent(message.text || "")
		setEditImages(message.images || [])
		setEditMode(mode || "code")
	}, [message.text, message.images, mode])

	// Handle save edit
	const handleSaveEdit = useCallback(() => {
		setIsEditing(false)
		// Send edited message to backend
		vscode.postMessage({
			type: "submitEditedMessage",
			value: message.ts,
			editedMessageContent: editedContent,
			images: editImages,
		})
	}, [message.ts, editedContent, editImages])

	// Handle image selection for editing
	const handleSelectImages = useCallback(() => {
		vscode.postMessage({ type: "selectImages", context: "edit", messageTs: message.ts })
	}, [message.ts])

	const [cost, apiReqCancelReason, apiReqStreamingFailedMessage] = useMemo(() => {
		if (message.text !== null && message.text !== undefined && message.say === "api_req_started") {
			const info = safeJsonParse<ClineApiReqInfo>(message.text)
			return [info?.cost, info?.cancelReason, info?.streamingFailedMessage]
		}

		return [undefined, undefined, undefined]
	}, [message.text, message.say])

	// When resuming task, last won't be api_req_failed but a resume_task
	// message, so api_req_started will show loading spinner. That's why we just
	// remove the last api_req_started that failed without streaming anything.
	const apiRequestFailedMessage =
		isLast && lastModifiedMessage?.ask === "api_req_failed" // if request is retried then the latest message is a api_req_retried
			? lastModifiedMessage?.text
			: undefined

	const isCommandExecuting =
		isLast && lastModifiedMessage?.ask === "command" && lastModifiedMessage?.text?.includes(COMMAND_OUTPUT_STRING)

	const isMcpServerResponding = isLast && lastModifiedMessage?.say === "mcp_server_request_started"

	const type = message.type === "ask" ? message.ask : message.say

	const normalColor = "var(--vscode-foreground)"
	const errorColor = "var(--vscode-errorForeground)"
	const successColor = "var(--vscode-charts-green)"
	const cancelledColor = "var(--vscode-descriptionForeground)"

	const [icon, title] = useMemo(() => {
		switch (type) {
			case "error":
			case "mistake_limit_reached":
				return [null, null] // These will be handled by ErrorRow component
			case "command":
				return [
					isCommandExecuting ? (
						<ProgressIndicator />
					) : (
						<TerminalSquare className="size-4" aria-label="Terminal icon" />
					),
					<span style={{ color: normalColor, fontWeight: "bold" }}>
						{t("chat:commandExecution.running")}
					</span>,
				]
			case "use_mcp_server":
				const mcpServerUse = safeJsonParse<ClineAskUseMcpServer>(message.text)
				if (mcpServerUse === undefined) {
					return [null, null]
				}
				return [
					isMcpServerResponding ? (
						<ProgressIndicator />
					) : (
						<span
							className="codicon codicon-server"
							style={{ color: normalColor, marginBottom: "-1.5px" }}></span>
					),
					<span style={{ color: normalColor, fontWeight: "bold" }}>
						{mcpServerUse.type === "use_mcp_tool"
							? t("chat:mcp.wantsToUseTool", { serverName: mcpServerUse.serverName })
							: t("chat:mcp.wantsToAccessResource", { serverName: mcpServerUse.serverName })}
					</span>,
				]
			case "completion_result":
				return [
					<span
						className="codicon codicon-check"
						style={{ color: successColor, marginBottom: "-1.5px" }}></span>,
					<span style={{ color: successColor, fontWeight: "bold" }}>{t("chat:taskCompleted")}</span>,
				]
			case "api_req_rate_limit_wait":
				return []
			case "api_req_retry_delayed":
				return []
			case "api_req_started":
				const getIconSpan = (iconName: string, color: string) => (
					<div
						style={{
							width: 16,
							height: 16,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}>
						<span
							className={`codicon codicon-${iconName}`}
							style={{ color, fontSize: 16, marginBottom: "-1.5px" }}
						/>
					</div>
				)
				return [
					apiReqCancelReason !== null && apiReqCancelReason !== undefined ? (
						apiReqCancelReason === "user_cancelled" ? (
							getIconSpan("error", cancelledColor)
						) : (
							getIconSpan("error", errorColor)
						)
					) : cost !== null && cost !== undefined ? (
						getIconSpan("arrow-swap", normalColor)
					) : apiRequestFailedMessage ? (
						getIconSpan("error", errorColor)
					) : isLast ? (
						<ProgressIndicator />
					) : (
						getIconSpan("arrow-swap", normalColor)
					),
					apiReqCancelReason !== null && apiReqCancelReason !== undefined ? (
						apiReqCancelReason === "user_cancelled" ? (
							<span style={{ color: normalColor, fontWeight: "bold" }}>
								{t("chat:apiRequest.cancelled")}
							</span>
						) : (
							<span style={{ color: errorColor, fontWeight: "bold" }}>
								{t("chat:apiRequest.streamingFailed")}
							</span>
						)
					) : cost !== null && cost !== undefined ? (
						<span style={{ color: normalColor }}>{t("chat:apiRequest.title")}</span>
					) : apiRequestFailedMessage ? (
						<span style={{ color: errorColor }}>{t("chat:apiRequest.failed")}</span>
					) : (
						<span style={{ color: normalColor }}>{t("chat:apiRequest.streaming")}</span>
					),
				]
			case "followup":
				return [
					<MessageCircleQuestionMark className="w-4 shrink-0" aria-label="Question icon" />,
					<span style={{ color: normalColor, fontWeight: "bold" }}>{t("chat:questions.hasQuestion")}</span>,
				]
			default:
				return [null, null]
		}
	}, [
		type,
		isCommandExecuting,
		message,
		isMcpServerResponding,
		apiReqCancelReason,
		cost,
		apiRequestFailedMessage,
		t,
		isLast,
	])

	const headerStyle: React.CSSProperties = {
		display: "flex",
		alignItems: "center",
		gap: "10px",
		cursor: "default",
		marginBottom: "10px",
		wordBreak: "break-word",
	}

	const tool = useMemo(
		() => (message.ask === "tool" ? safeJsonParse<ClineSayTool>(message.text) : null),
		[message.ask, message.text],
	)
	const [imageApprovalPrompt, setImageApprovalPrompt] = useState("")
	const [expandedImageGenerationDetails, setExpandedImageGenerationDetails] = useState<Record<string, boolean>>({})

	useEffect(() => {
		if (message.type === "ask" && tool?.tool === "generateImage") {
			setImageApprovalPrompt(tool.imageGeneration?.prompt ?? tool.content ?? "")
		}
	}, [message.type, message.ts, tool])

	const handleImageApprovalPromptChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
		setImageApprovalPrompt(event.target.value)
	}, [])

	const handleImageApprovalGenerate = useCallback(() => {
		const trimmedPrompt = imageApprovalPrompt.trim()

		if (!trimmedPrompt) {
			return
		}

		if (onImageApprovalGenerate) {
			onImageApprovalGenerate(trimmedPrompt)
			return
		}

		vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked", text: trimmedPrompt })
	}, [imageApprovalPrompt, onImageApprovalGenerate])

	const toggleImageGenerationDetails = useCallback((detailsKey: string) => {
		setExpandedImageGenerationDetails((prev) => ({ ...prev, [detailsKey]: !prev[detailsKey] }))
	}, [])

	// Unified diff content (provided by backend when relevant)
	const unifiedDiff = useMemo(() => {
		if (!tool) return undefined
		return (tool.content ?? tool.diff) as string | undefined
	}, [tool])

	const onJumpToCreatedFile = useMemo(() => {
		if (!tool || tool.tool !== "newFileCreated" || !tool.path) {
			return undefined
		}

		return () => vscode.postMessage({ type: "openFile", text: "./" + tool.path })
	}, [tool])

	const followUpData = useMemo(() => {
		if (message.type === "ask" && message.ask === "followup" && !message.partial) {
			return safeJsonParse<FollowUpData>(message.text)
		}
		return null
	}, [message.type, message.ask, message.partial, message.text])

	const renderVisualBrowserInspectorTool = (visualBrowserTool: ClineSayTool) => {
		const result = visualBrowserTool.visualBrowserResult
		const sessionId = visualBrowserTool.sessionId ?? result?.session.sessionId
		const url = visualBrowserTool.url ?? result?.session.url
		const screenshotId =
			visualBrowserTool.screenshotId ??
			result?.screenshot?.screenshotId ??
			result?.crop?.screenshotId ??
			result?.inspection?.screenshotId
		const cropId = visualBrowserTool.cropId ?? result?.crop?.cropId ?? result?.inspection?.cropId
		const isRunning =
			visualBrowserTool.visualBrowserStatus === "running" || (message.type === "ask" && message.partial)
		const isError = visualBrowserTool.visualBrowserStatus === "error"
		const statusText = isRunning
			? "Running"
			: isError
				? "Error"
				: message.type === "say"
					? "Completed"
					: "Requested"
		const issueCount = result?.analysis?.issues.length ?? result?.inspection?.issues?.length
		const inspectedElementCount =
			result?.inspection?.elements?.length ?? (result?.inspection?.element ? 1 : undefined)
		const summary =
			result?.analysis?.summary ??
			result?.analysis?.recommendationSummary ??
			visualBrowserTool.message ??
			result?.message
		const details = [
			["Action", formatVisualBrowserAction(visualBrowserTool.action)],
			["Session", sessionId],
			["URL", url],
			["Screenshot", screenshotId],
			["Crop", cropId],
			["Issues", issueCount === undefined ? undefined : String(issueCount)],
			["Elements", inspectedElementCount === undefined ? undefined : String(inspectedElementCount)],
		].filter((detail): detail is [string, string] => Boolean(detail[1]))

		const openVisualBrowserInspector = () => {
			vscode.postMessage({
				type: "visualBrowserInspector",
				payload: {
					action: "open_panel",
					sessionId,
					screenshotId,
					cropId,
				},
			})
		}

		return (
			<>
				<div className="mb-2 flex items-center gap-2 break-words">
					{isRunning ? (
						<ProgressIndicator />
					) : isError ? (
						<span className="codicon codicon-error text-vscode-errorForeground" />
					) : (
						<Eye className="size-4 shrink-0" aria-label="Visual Browser Inspector icon" />
					)}
					<span className="font-bold">Visual Browser Inspector {statusText}</span>
				</div>
				<div className="pl-6">
					<ToolUseBlock className="cursor-default border border-vscode-panel-border">
						<div className="flex flex-col gap-3 text-sm text-vscode-foreground">
							<div className="flex flex-wrap items-start justify-between gap-2">
								<div className="flex min-w-0 flex-col gap-1">
									<div className="font-medium">
										{formatVisualBrowserAction(visualBrowserTool.action)}
									</div>
									<div className="text-xs text-vscode-descriptionForeground">
										Controlled Playwright browser page only. Screenshots and crops stay local under
										<code className="mx-1 rounded bg-vscode-textCodeBlock-background px-1">
											.roo/visual-browser-inspector
										</code>
										.
									</div>
								</div>
								<button
									type="button"
									className="inline-flex shrink-0 items-center gap-1 rounded border border-vscode-panel-border bg-vscode-button-background px-2 py-1 text-xs font-medium text-vscode-button-foreground hover:bg-vscode-button-hoverBackground"
									onClick={openVisualBrowserInspector}>
									Open Visual Browser Inspector
									<SquareArrowOutUpRight className="size-3" aria-hidden="true" />
								</button>
							</div>

							{summary && (
								<div className="rounded border border-vscode-panel-border bg-vscode-sideBar-background p-2">
									<div className="mb-1 text-xs font-medium uppercase tracking-wide text-vscode-descriptionForeground">
										Summary
									</div>
									<div className="whitespace-pre-wrap break-words">{summary}</div>
								</div>
							)}

							{details.length > 0 && (
								<div className="grid gap-1 text-xs sm:grid-cols-2">
									{details.map(([label, value]) => (
										<div
											key={label}
											className="min-w-0 rounded bg-vscode-sideBar-background px-2 py-1">
											<span className="mr-1 font-medium text-vscode-descriptionForeground">
												{label}:
											</span>
											<span className="break-all">{value}</span>
										</div>
									))}
								</div>
							)}
						</div>
					</ToolUseBlock>
				</div>
			</>
		)
	}

	const formatSafeEndpoint = (baseURL?: string): string | undefined => {
		if (!baseURL) {
			return undefined
		}

		try {
			const url = new URL(baseURL)
			url.username = ""
			url.password = ""
			url.search = ""
			url.hash = ""
			return url.toString().replace(/\/$/, "")
		} catch {
			return baseURL
				.replace(/\/\/[^/@]+@/, "//")
				.split("?")[0]
				.split("#")[0]
				.replace(/\/$/, "")
		}
	}

	const formatImageGenerationNumber = (value?: number): string | undefined => {
		if (typeof value !== "number" || !Number.isFinite(value)) {
			return undefined
		}

		return new Intl.NumberFormat(i18n.language || undefined).format(value)
	}

	const formatImageGenerationCost = (cost?: number, currency?: string): string | undefined => {
		if (typeof cost !== "number" || !Number.isFinite(cost)) {
			return undefined
		}

		const trimmedCurrency = currency?.trim()
		if (trimmedCurrency) {
			try {
				return new Intl.NumberFormat(i18n.language || undefined, {
					style: "currency",
					currency: trimmedCurrency,
					maximumFractionDigits: cost > 0 && cost < 0.01 ? 6 : 4,
				}).format(cost)
			} catch {
				return `${cost.toFixed(cost > 0 && cost < 0.01 ? 6 : 4)} ${trimmedCurrency}`
			}
		}

		return cost.toFixed(cost > 0 && cost < 0.01 ? 6 : 4)
	}

	const formatImageGenerationDateTime = (value?: string): string | undefined => {
		if (!value) {
			return undefined
		}

		const date = new Date(value)
		if (Number.isNaN(date.getTime())) {
			return value
		}

		return new Intl.DateTimeFormat(i18n.language || undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZone: "UTC",
			timeZoneName: "short",
		}).format(date)
	}

	const formatImageGenerationDimensions = (width?: number, height?: number): string | undefined => {
		const formattedWidth = formatImageGenerationNumber(width)
		const formattedHeight = formatImageGenerationNumber(height)

		if (!formattedWidth || !formattedHeight) {
			return undefined
		}

		return t("chat:imageGeneration.metadata.dimensionsValue", {
			width: formattedWidth,
			height: formattedHeight,
		})
	}

	const getNonNegativeFiniteImageGenerationNumber = (value?: number): number | undefined =>
		typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined

	const formatImageGenerationUsageSource = (
		source?: NonNullable<GeneratedImageMetadata["usage"]>["usageSource"],
	): string | undefined => {
		if (!source) {
			return undefined
		}

		const translationKey = `chat:imageGeneration.metadata.usageSources.${source}`
		return i18n.exists(translationKey) ? t(translationKey) : source.replace(/_/g, " ")
	}

	const formatImageGenerationApiMethod = (apiMethod?: GeneratedImageMetadata["apiMethod"]): string | undefined => {
		if (!apiMethod) {
			return undefined
		}

		const translationKey = `chat:imageGeneration.apiMethods.${apiMethod}`
		return i18n.exists(translationKey) ? t(translationKey) : apiMethod.replace(/_/g, " ")
	}

	const renderImageGenerationStatusIcon = (status: ImageGenerationToolStatus) => {
		switch (status) {
			case "pending":
				return <span className="codicon codicon-clock text-vscode-descriptionForeground" />
			case "running":
				return <ProgressIndicator />
			case "error":
				return <span className="codicon codicon-error text-vscode-errorForeground" />
			case "completed":
			default:
				return <ImageIcon className="size-4 shrink-0 text-vscode-charts-green" aria-hidden="true" />
		}
	}

	const renderImageGenerationMetadata = (metadata: GeneratedImageMetadata, includeStatus = false) => {
		const status = metadata.status ?? "completed"
		const statusLabel = t(`chat:imageGeneration.status.${status}`)
		const endpoint = formatSafeEndpoint(metadata.baseURL)
		const usage = metadata.usage
		const isCloudflareImageGeneration = metadata.provider === "cloudflare"

		type ImageGenerationDetail = {
			key: string
			labelKey: string
			value?: React.ReactNode
			wide?: boolean
			mono?: boolean
			error?: boolean
		}

		const renderCloudflareUsageProgress = (): React.ReactNode | undefined => {
			const quota = getNonNegativeFiniteImageGenerationNumber(usage?.dailyQuotaNeurons)
			const remaining = getNonNegativeFiniteImageGenerationNumber(usage?.estimatedRemainingNeurons)
			const estimatedUsed = getNonNegativeFiniteImageGenerationNumber(usage?.estimatedUsedNeuronsToday)
			const used =
				estimatedUsed ??
				(quota !== undefined && remaining !== undefined ? Math.max(quota - remaining, 0) : undefined)

			if (!quota || used === undefined) {
				return undefined
			}

			const clampedUsed = Math.max(0, Math.min(used, quota))
			const percent = Math.max(0, Math.min(100, (clampedUsed / quota) * 100))
			const remainingValue = remaining ?? Math.max(quota - clampedUsed, 0)
			const usageLabel = t("chat:imageGeneration.metadata.cloudflareUsageValue", {
				used: formatImageGenerationNumber(clampedUsed),
				quota: formatImageGenerationNumber(quota),
				remaining: formatImageGenerationNumber(remainingValue),
			})
			const usageBarClassName =
				percent >= 90
					? "bg-vscode-errorForeground"
					: percent >= 70
						? "bg-vscode-editorWarning-foreground"
						: "bg-vscode-button-background"

			return (
				<div className="space-y-1" data-testid="cloudflare-image-generation-usage">
					<div className="text-vscode-foreground">{usageLabel}</div>
					<div
						className="h-2 w-full overflow-hidden rounded-sm bg-vscode-input-background"
						role="progressbar"
						aria-label={t("chat:imageGeneration.metadata.cloudflareUsage")}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(percent)}
						aria-valuetext={usageLabel}
						data-testid="cloudflare-image-generation-usage-progress">
						<div
							className={`h-full transition-all duration-300 ${usageBarClassName}`}
							style={{ width: `${percent}%` }}
						/>
					</div>
				</div>
			)
		}

		const cloudflareCompactDetails: ImageGenerationDetail[] = [
			{
				key: "dimensions",
				labelKey: "chat:imageGeneration.metadata.dimensions",
				value: formatImageGenerationDimensions(metadata.imageWidth, metadata.imageHeight),
			},
			{ key: "imageFormat", labelKey: "chat:imageGeneration.metadata.imageFormat", value: metadata.imageFormat },
			{
				key: "cloudflareUsage",
				labelKey: "chat:imageGeneration.metadata.cloudflareUsage",
				value: renderCloudflareUsageProgress(),
				wide: true,
			},
			{
				key: "error",
				labelKey: "chat:imageGeneration.metadata.error",
				value: status === "error" ? metadata.error : undefined,
				wide: true,
				error: true,
			},
		].filter((detail) => detail.value !== undefined && detail.value !== null && detail.value !== "")

		const standardCompactDetails: ImageGenerationDetail[] = [
			{
				key: "provider",
				labelKey: "chat:imageGeneration.metadata.provider",
				value: metadata.providerLabel ?? metadata.provider,
			},
			{ key: "model", labelKey: "chat:imageGeneration.metadata.model", value: metadata.model },
			{
				key: "dimensions",
				labelKey: "chat:imageGeneration.metadata.dimensions",
				value: formatImageGenerationDimensions(metadata.imageWidth, metadata.imageHeight),
			},
			{
				key: "outputPath",
				labelKey: "chat:imageGeneration.metadata.outputPath",
				value: metadata.outputPath ?? metadata.path,
				mono: true,
				wide: true,
			},
			{
				key: "inputImage",
				labelKey: "chat:imageGeneration.metadata.inputImage",
				value: metadata.inputImage,
				mono: true,
				wide: true,
			},
			{ key: "imageFormat", labelKey: "chat:imageGeneration.metadata.imageFormat", value: metadata.imageFormat },
			{
				key: "tokensIn",
				labelKey: "chat:imageGeneration.metadata.tokensIn",
				value: formatImageGenerationNumber(usage?.tokensIn),
			},
			{
				key: "tokensOut",
				labelKey: "chat:imageGeneration.metadata.tokensOut",
				value: formatImageGenerationNumber(usage?.tokensOut),
			},
			{
				key: "totalTokens",
				labelKey: "chat:imageGeneration.metadata.totalTokens",
				value: formatImageGenerationNumber(usage?.totalTokens),
			},
			{
				key: "images",
				labelKey: "chat:imageGeneration.metadata.images",
				value: formatImageGenerationNumber(usage?.imageCount),
			},
			{
				key: "cost",
				labelKey: "chat:imageGeneration.metadata.cost",
				value: formatImageGenerationCost(usage?.cost, usage?.currency),
			},
			{
				key: "estimatedCost",
				labelKey: "chat:imageGeneration.metadata.estimatedCost",
				value: formatImageGenerationCost(usage?.estimatedCost, usage?.currency),
			},
			{
				key: "neurons",
				labelKey: "chat:imageGeneration.metadata.neurons",
				value: formatImageGenerationNumber(usage?.neurons),
			},
			{
				key: "estimatedNeurons",
				labelKey: "chat:imageGeneration.metadata.estimatedNeurons",
				value: formatImageGenerationNumber(usage?.estimatedNeurons),
			},
			{
				key: "estimatedRemainingNeurons",
				labelKey: "chat:imageGeneration.metadata.estimatedRemainingNeurons",
				value: formatImageGenerationNumber(usage?.estimatedRemainingNeurons),
			},
			{
				key: "error",
				labelKey: "chat:imageGeneration.metadata.error",
				value: metadata.error,
				wide: true,
				error: true,
			},
		].filter((detail) => detail.value !== undefined && detail.value !== null && detail.value !== "")
		const compactDetails = isCloudflareImageGeneration ? cloudflareCompactDetails : standardCompactDetails

		const fullDetails: ImageGenerationDetail[] = [
			{
				key: "prompt",
				labelKey: "chat:imageGeneration.metadata.prompt",
				value: metadata.prompt,
				wide: true,
			},
			{
				key: "editedPrompt",
				labelKey: "chat:imageGeneration.metadata.editedPrompt",
				value: metadata.editedPrompt,
				wide: true,
			},
			{
				key: "originalPrompt",
				labelKey: "chat:imageGeneration.metadata.originalPrompt",
				value: metadata.originalPrompt,
				wide: true,
			},
			{
				key: "endpoint",
				labelKey: "chat:imageGeneration.metadata.endpoint",
				value: endpoint,
				mono: true,
				wide: true,
			},
			{
				key: "endpointType",
				labelKey: "chat:imageGeneration.metadata.endpointType",
				value:
					metadata.isLocal === undefined
						? undefined
						: t(
								metadata.isLocal
									? "chat:imageGeneration.metadata.localEndpoint"
									: "chat:imageGeneration.metadata.remoteEndpoint",
							),
			},
			{
				key: "apiMethod",
				labelKey: "chat:imageGeneration.metadata.apiMethod",
				value: formatImageGenerationApiMethod(metadata.apiMethod),
			},
			{
				key: "usageSource",
				labelKey: "chat:imageGeneration.metadata.usageSource",
				value: formatImageGenerationUsageSource(usage?.usageSource),
			},
			{
				key: "estimatedUsedNeuronsToday",
				labelKey: "chat:imageGeneration.metadata.estimatedUsedNeuronsToday",
				value: formatImageGenerationNumber(usage?.estimatedUsedNeuronsToday),
			},
			{
				key: "dailyQuotaNeurons",
				labelKey: "chat:imageGeneration.metadata.dailyQuotaNeurons",
				value: formatImageGenerationNumber(usage?.dailyQuotaNeurons),
			},
			{
				key: "quotaResetAt",
				labelKey: "chat:imageGeneration.metadata.quotaResetAt",
				value: formatImageGenerationDateTime(usage?.quotaResetAt),
			},
			{
				key: "quotaDescription",
				labelKey: "chat:imageGeneration.metadata.quotaDescription",
				value: usage?.quotaDescription,
				wide: true,
			},
			{
				key: "pricingDescription",
				labelKey: "chat:imageGeneration.metadata.pricingDescription",
				value: usage?.pricingDescription,
				wide: true,
			},
		].filter((detail) => detail.value !== undefined && detail.value !== null && detail.value !== "")

		const detailsKey = [status, metadata.outputPath ?? metadata.path, metadata.model, metadata.prompt]
			.filter(Boolean)
			.join(":")
		const isExpanded = !!expandedImageGenerationDetails[detailsKey]
		const renderDetails = (details: ImageGenerationDetail[]) => (
			<dl className="grid gap-2 text-xs sm:grid-cols-2">
				{details.map((detail) => (
					<div
						key={detail.key}
						className={cn(
							"min-w-0 rounded bg-vscode-sideBar-background px-2 py-1",
							detail.wide && "sm:col-span-2",
							detail.error &&
								"border border-vscode-inputValidation-errorBorder bg-vscode-inputValidation-errorBackground text-vscode-errorForeground",
						)}>
						<dt className="mb-0.5 font-medium text-vscode-descriptionForeground">{t(detail.labelKey)}</dt>
						<dd
							className={cn(
								"m-0 whitespace-pre-wrap break-words",
								detail.mono && "font-mono break-all",
								detail.error && "text-vscode-errorForeground",
							)}>
							{detail.value}
						</dd>
					</div>
				))}
			</dl>
		)

		return (
			<div className={cn("flex flex-col gap-3 text-sm text-vscode-foreground", includeStatus && "p-2")}>
				{includeStatus && (
					<div className="flex items-center gap-2 text-vscode-foreground">
						{renderImageGenerationStatusIcon(status)}
						<span className="font-medium">
							{t("chat:imageGeneration.statusTitle", { status: statusLabel })}
						</span>
					</div>
				)}

				{compactDetails.length > 0 && renderDetails(compactDetails)}

				{!isCloudflareImageGeneration && fullDetails.length > 0 && (
					<div className="flex flex-col gap-2">
						<button
							type="button"
							className="w-fit rounded text-xs text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground"
							onClick={() => toggleImageGenerationDetails(detailsKey)}>
							{t(
								isExpanded
									? "chat:imageGeneration.metadata.hideDetails"
									: "chat:imageGeneration.metadata.showDetails",
							)}
						</button>
						{isExpanded && renderDetails(fullDetails)}
					</div>
				)}
			</div>
		)
	}

	const renderImageGenerationStatusTool = (imageTool: ClineSayTool) => {
		const metadata: GeneratedImageMetadata = imageTool.imageGeneration ?? {
			status: "completed",
			prompt: imageTool.content,
			path: imageTool.path,
		}
		const status = metadata.status ?? "completed"
		const statusLabel = t(`chat:imageGeneration.status.${status}`)
		const imageUri = imageTool.imageUri
		const imagePath = imageTool.imagePath

		return (
			<>
				<div style={headerStyle}>
					{renderImageGenerationStatusIcon(status)}
					<span style={{ fontWeight: "bold" }}>
						{t("chat:imageGeneration.statusTitle", { status: statusLabel })}
					</span>
				</div>
				<div className="pl-6">
					<ToolUseBlock className="cursor-default border border-vscode-panel-border">
						<div className="flex flex-col gap-3 p-2">
							{imageUri || imagePath ? <ImageBlock imageUri={imageUri} imagePath={imagePath} /> : null}
							{renderImageGenerationMetadata(metadata)}
						</div>
					</ToolUseBlock>
				</div>
			</>
		)
	}

	if (tool) {
		const toolIcon = (name: string) => (
			<span
				className={`codicon codicon-${name}`}
				style={{ color: "var(--vscode-foreground)", marginBottom: "-1.5px" }}></span>
		)

		switch (tool.tool as string) {
			case "parallelAgents":
				return <AgentStatusPanel tool={tool} />
			case "visualBrowserInspector":
			case "visual_browser_inspector":
				return renderVisualBrowserInspectorTool(tool)
			case "imageGenerated":
				return renderImageGenerationStatusTool(tool)
			case "editedExistingFile":
			case "appliedDiff":
			case "newFileCreated":
			case "searchAndReplace":
			case "search_and_replace":
			case "search_replace":
			case "edit":
			case "edit_file":
			case "apply_patch":
			case "apply_diff":
				// Check if this is a batch diff request
				if (message.type === "ask" && tool.batchDiffs && Array.isArray(tool.batchDiffs)) {
					return (
						<>
							<div style={headerStyle}>
								<FileDiff className="w-4 shrink-0" aria-label="Batch diff icon" />
								<span style={{ fontWeight: "bold" }}>
									{t("chat:fileOperations.wantsToApplyBatchChanges")}
								</span>
							</div>
							<BatchDiffApproval files={tool.batchDiffs} ts={message.ts} />
						</>
					)
				}

				// Regular single file diff
				return (
					<>
						<div style={headerStyle}>
							{tool.isProtected ? (
								<span
									className="codicon codicon-lock"
									style={{ color: "var(--vscode-editorWarning-foreground)", marginBottom: "-1.5px" }}
								/>
							) : (
								toolIcon("diff")
							)}
							<span style={{ fontWeight: "bold" }}>
								{tool.isProtected
									? t("chat:fileOperations.wantsToEditProtected")
									: tool.isOutsideWorkspace
										? t("chat:fileOperations.wantsToEditOutsideWorkspace")
										: t("chat:fileOperations.wantsToEdit")}
							</span>
						</div>
						<div className="pl-6">
							<CodeAccordion
								path={tool.path}
								code={unifiedDiff ?? tool.content ?? tool.diff ?? ""}
								language="diff"
								progressStatus={message.progressStatus}
								isLoading={message.partial}
								isExpanded={isExpanded}
								onToggleExpand={handleToggleExpand}
								onJumpToFile={onJumpToCreatedFile}
								diffStats={tool.diffStats}
							/>
						</div>
					</>
				)
			case "insertContent":
				return (
					<>
						<div style={headerStyle}>
							{tool.isProtected ? (
								<span
									className="codicon codicon-lock"
									style={{ color: "var(--vscode-editorWarning-foreground)", marginBottom: "-1.5px" }}
								/>
							) : (
								toolIcon("insert")
							)}
							<span style={{ fontWeight: "bold" }}>
								{tool.isProtected
									? t("chat:fileOperations.wantsToEditProtected")
									: tool.isOutsideWorkspace
										? t("chat:fileOperations.wantsToEditOutsideWorkspace")
										: tool.lineNumber === 0
											? t("chat:fileOperations.wantsToInsertAtEnd")
											: t("chat:fileOperations.wantsToInsertWithLineNumber", {
													lineNumber: tool.lineNumber,
												})}
							</span>
						</div>
						<div className="pl-6">
							<CodeAccordion
								path={tool.path}
								code={unifiedDiff ?? tool.diff}
								language="diff"
								progressStatus={message.progressStatus}
								isLoading={message.partial}
								isExpanded={isExpanded}
								onToggleExpand={handleToggleExpand}
								diffStats={tool.diffStats}
							/>
						</div>
					</>
				)
			case "codebaseSearch": {
				return (
					<div style={headerStyle}>
						{toolIcon("search")}
						<span style={{ fontWeight: "bold" }}>
							{tool.path ? (
								<Trans
									i18nKey="chat:codebaseSearch.wantsToSearchWithPath"
									components={{ code: <code></code> }}
									values={{ query: tool.query, path: tool.path }}
								/>
							) : (
								<Trans
									i18nKey="chat:codebaseSearch.wantsToSearch"
									components={{ code: <code></code> }}
									values={{ query: tool.query }}
								/>
							)}
						</span>
					</div>
				)
			}
			case "updateTodoList" as any: {
				const todos = (tool as any).todos || []
				// Get previous todos from the latest todos in the task context
				const previousTodos = getPreviousTodos(clineMessages, message.ts)

				return <TodoChangeDisplay previousTodos={previousTodos} newTodos={todos} />
			}
			case "readFile":
				// Check if this is a batch file permission request
				const isBatchRequest = message.type === "ask" && tool.batchFiles && Array.isArray(tool.batchFiles)

				if (isBatchRequest) {
					return (
						<>
							<div style={headerStyle}>
								<Eye className="w-4 shrink-0" aria-label="View files icon" />
								<span style={{ fontWeight: "bold" }}>
									{t("chat:fileOperations.wantsToReadMultiple")}
								</span>
							</div>
							<BatchFilePermission
								files={tool.batchFiles || []}
								onPermissionResponse={(response) => {
									onBatchFileResponse?.(response)
								}}
								ts={message?.ts}
							/>
						</>
					)
				}

				// Regular single file read request
				return (
					<>
						<div style={headerStyle}>
							<FileCode2 className="w-4 shrink-0" aria-label="Read file icon" />
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask"
									? tool.isOutsideWorkspace
										? t("chat:fileOperations.wantsToReadOutsideWorkspace")
										: tool.additionalFileCount && tool.additionalFileCount > 0
											? t("chat:fileOperations.wantsToReadAndXMore", {
													count: tool.additionalFileCount,
												})
											: t("chat:fileOperations.wantsToRead")
									: t("chat:fileOperations.didRead")}
							</span>
						</div>
						<div className="pl-6">
							<ToolUseBlock>
								<ToolUseBlockHeader
									className="group"
									onClick={() =>
										vscode.postMessage({
											type: "openFile",
											text: tool.content,
											values: tool.startLine ? { line: tool.startLine } : undefined,
										})
									}>
									{tool.path?.startsWith(".") && <span>.</span>}
									<PathTooltip content={formatPathTooltip(tool.path, tool.reason)}>
										<span className="whitespace-nowrap overflow-hidden text-ellipsis text-left mr-2 rtl">
											{formatPathTooltip(tool.path, tool.reason)}
										</span>
									</PathTooltip>
									<div style={{ flexGrow: 1 }}></div>
									<SquareArrowOutUpRight
										className="w-4 shrink-0 codicon codicon-link-external opacity-0 group-hover:opacity-100 transition-opacity"
										style={{ fontSize: 13.5, margin: "1px 0" }}
									/>
								</ToolUseBlockHeader>
							</ToolUseBlock>
						</div>
					</>
				)
			case "skill": {
				const skillInfo = tool
				return (
					<>
						<div style={headerStyle}>
							{toolIcon("book")}
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask" ? t("chat:skill.wantsToLoad") : t("chat:skill.didLoad")}
							</span>
						</div>
						<div
							style={{
								marginTop: "4px",
								backgroundColor: "var(--vscode-editor-background)",
								border: "1px solid var(--vscode-editorGroup-border)",
								borderRadius: "4px",
								overflow: "hidden",
								cursor: "pointer",
							}}
							onClick={handleToggleExpand}>
							<ToolUseBlockHeader
								className="group"
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "10px 12px",
								}}>
								<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
									<span style={{ fontWeight: "500", fontSize: "var(--vscode-font-size)" }}>
										{skillInfo.skill}
									</span>
									{skillInfo.source && (
										<VSCodeBadge style={{ fontSize: "calc(var(--vscode-font-size) - 2px)" }}>
											{skillInfo.source}
										</VSCodeBadge>
									)}
								</div>
								<span
									className={`codicon codicon-chevron-${isExpanded ? "up" : "down"} opacity-0 group-hover:opacity-100 transition-opacity duration-200`}></span>
							</ToolUseBlockHeader>
							{isExpanded && (skillInfo.args || skillInfo.description) && (
								<div
									style={{
										padding: "12px 16px",
										borderTop: "1px solid var(--vscode-editorGroup-border)",
										display: "flex",
										flexDirection: "column",
										gap: "8px",
									}}>
									{skillInfo.description && (
										<div style={{ color: "var(--vscode-descriptionForeground)" }}>
											{skillInfo.description}
										</div>
									)}
									{skillInfo.args && (
										<div>
											<span style={{ fontWeight: "500" }}>Arguments: </span>
											<span style={{ color: "var(--vscode-descriptionForeground)" }}>
												{skillInfo.args}
											</span>
										</div>
									)}
								</div>
							)}
						</div>
					</>
				)
			}
			case "listFilesTopLevel":
				return (
					<>
						<div style={headerStyle}>
							<ListTree className="w-4 shrink-0" aria-label="List files icon" />
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask"
									? tool.isOutsideWorkspace
										? t("chat:directoryOperations.wantsToViewTopLevelOutsideWorkspace")
										: t("chat:directoryOperations.wantsToViewTopLevel")
									: tool.isOutsideWorkspace
										? t("chat:directoryOperations.didViewTopLevelOutsideWorkspace")
										: t("chat:directoryOperations.didViewTopLevel")}
							</span>
						</div>
						<div className="pl-6">
							<CodeAccordion
								path={tool.path}
								code={tool.content}
								language="shell-session"
								isExpanded={isExpanded}
								onToggleExpand={handleToggleExpand}
							/>
						</div>
					</>
				)
			case "listFilesRecursive":
				return (
					<>
						<div style={headerStyle}>
							<FolderTree className="w-4 shrink-0" aria-label="Folder tree icon" />
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask"
									? tool.isOutsideWorkspace
										? t("chat:directoryOperations.wantsToViewRecursiveOutsideWorkspace")
										: t("chat:directoryOperations.wantsToViewRecursive")
									: tool.isOutsideWorkspace
										? t("chat:directoryOperations.didViewRecursiveOutsideWorkspace")
										: t("chat:directoryOperations.didViewRecursive")}
							</span>
						</div>
						<div className="pl-6">
							<CodeAccordion
								path={tool.path}
								code={tool.content}
								language="shellsession"
								isExpanded={isExpanded}
								onToggleExpand={handleToggleExpand}
							/>
						</div>
					</>
				)
			case "searchFiles":
				return (
					<>
						<div style={headerStyle}>
							{toolIcon("search")}
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask" ? (
									<Trans
										i18nKey={
											tool.isOutsideWorkspace
												? "chat:directoryOperations.wantsToSearchOutsideWorkspace"
												: "chat:directoryOperations.wantsToSearch"
										}
										components={{ code: <code className="font-medium">{tool.regex}</code> }}
										values={{ regex: tool.regex }}
									/>
								) : (
									<Trans
										i18nKey={
											tool.isOutsideWorkspace
												? "chat:directoryOperations.didSearchOutsideWorkspace"
												: "chat:directoryOperations.didSearch"
										}
										components={{ code: <code className="font-medium">{tool.regex}</code> }}
										values={{ regex: tool.regex }}
									/>
								)}
							</span>
						</div>
						<div className="pl-6">
							<CodeAccordion
								path={tool.path! + (tool.filePattern ? `/(${tool.filePattern})` : "")}
								code={tool.content}
								language="shellsession"
								isExpanded={isExpanded}
								onToggleExpand={handleToggleExpand}
							/>
						</div>
					</>
				)
			case "switchMode":
				return (
					<>
						<div style={headerStyle}>
							<PocketKnife className="w-4 shrink-0" aria-label="Switch mode icon" />
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask" ? (
									<>
										{tool.reason ? (
											<Trans
												i18nKey="chat:modes.wantsToSwitchWithReason"
												components={{ code: <code className="font-medium">{tool.mode}</code> }}
												values={{ mode: tool.mode, reason: tool.reason }}
											/>
										) : (
											<Trans
												i18nKey="chat:modes.wantsToSwitch"
												components={{ code: <code className="font-medium">{tool.mode}</code> }}
												values={{ mode: tool.mode }}
											/>
										)}
									</>
								) : (
									<>
										{tool.reason ? (
											<Trans
												i18nKey="chat:modes.didSwitchWithReason"
												components={{ code: <code className="font-medium">{tool.mode}</code> }}
												values={{ mode: tool.mode, reason: tool.reason }}
											/>
										) : (
											<Trans
												i18nKey="chat:modes.didSwitch"
												components={{ code: <code className="font-medium">{tool.mode}</code> }}
												values={{ mode: tool.mode }}
											/>
										)}
									</>
								)}
							</span>
						</div>
					</>
				)
			case "newTask":
				// Find all newTask messages to determine which child task ID corresponds to this message
				const newTaskMessages = clineMessages.filter((msg) => {
					if (msg.type === "ask" && msg.ask === "tool") {
						const t = safeJsonParse<ClineSayTool>(msg.text)
						return t?.tool === "newTask"
					}
					return false
				})
				const thisNewTaskIndex = newTaskMessages.findIndex((msg) => msg.ts === message.ts)
				const childIds = currentTaskItem?.childIds || []

				// Only get the child task ID if this newTask has been approved (has a corresponding entry in childIds)
				// This prevents showing a link to a previous task when the current newTask is still awaiting approval
				// Note: We don't use delegatedToId here because it persists after child tasks complete and would
				// incorrectly point to the previous task when a new newTask is awaiting approval
				const childTaskId =
					thisNewTaskIndex >= 0 && thisNewTaskIndex < childIds.length ? childIds[thisNewTaskIndex] : undefined

				// Check if the next message is a subtask_result - if so, don't show the button
				// since the result is displayed right after this message
				const currentMessageIndex = clineMessages.findIndex((msg) => msg.ts === message.ts)
				const nextMessage = currentMessageIndex >= 0 ? clineMessages[currentMessageIndex + 1] : undefined
				const isFollowedBySubtaskResult = nextMessage?.type === "say" && nextMessage?.say === "subtask_result"

				return (
					<>
						<div style={headerStyle}>
							<Split className="size-4" />
							<span style={{ fontWeight: "bold" }}>
								<Trans
									i18nKey="chat:subtasks.wantsToCreate"
									components={{ code: <code>{tool.mode}</code> }}
									values={{ mode: tool.mode }}
								/>
							</span>
						</div>
						<div className="border-l border-muted-foreground/80 ml-2 pl-4 pb-1">
							<MarkdownBlock markdown={tool.content} />
							<div>
								{childTaskId && !isFollowedBySubtaskResult && (
									<button
										className="cursor-pointer flex gap-1 items-center mt-2 text-vscode-descriptionForeground hover:text-vscode-descriptionForeground hover:underline font-normal"
										onClick={() =>
											vscode.postMessage({ type: "showTaskWithId", text: childTaskId })
										}>
										{t("chat:subtasks.goToSubtask")}
										<ArrowRight className="size-3" />
									</button>
								)}
							</div>
						</div>
					</>
				)
			case "finishTask":
				return (
					<>
						<div style={headerStyle}>
							{toolIcon("check-all")}
							<span style={{ fontWeight: "bold" }}>{t("chat:subtasks.wantsToFinish")}</span>
						</div>
						<div className="text-muted-foreground pl-6">
							<MarkdownBlock markdown={t("chat:subtasks.completionInstructions")} />
						</div>
					</>
				)
			case "runSlashCommand": {
				const slashCommandInfo = tool
				return (
					<>
						<div style={headerStyle}>
							{toolIcon("play")}
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask"
									? t("chat:slashCommand.wantsToRun")
									: t("chat:slashCommand.didRun")}
							</span>
						</div>
						<div
							style={{
								marginTop: "4px",
								backgroundColor: "var(--vscode-editor-background)",
								border: "1px solid var(--vscode-editorGroup-border)",
								borderRadius: "4px",
								overflow: "hidden",
								cursor: "pointer",
							}}
							onClick={handleToggleExpand}>
							<ToolUseBlockHeader
								className="group"
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "10px 12px",
								}}>
								<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
									<span style={{ fontWeight: "500", fontSize: "var(--vscode-font-size)" }}>
										/{slashCommandInfo.command}
									</span>
									{slashCommandInfo.source && (
										<VSCodeBadge style={{ fontSize: "calc(var(--vscode-font-size) - 2px)" }}>
											{slashCommandInfo.source}
										</VSCodeBadge>
									)}
								</div>
								<span
									className={`codicon codicon-chevron-${isExpanded ? "up" : "down"} opacity-0 group-hover:opacity-100 transition-opacity duration-200`}></span>
							</ToolUseBlockHeader>
							{isExpanded && (slashCommandInfo.args || slashCommandInfo.description) && (
								<div
									style={{
										padding: "12px 16px",
										borderTop: "1px solid var(--vscode-editorGroup-border)",
										display: "flex",
										flexDirection: "column",
										gap: "8px",
									}}>
									{slashCommandInfo.args && (
										<div>
											<span style={{ fontWeight: "500" }}>Arguments: </span>
											<span style={{ color: "var(--vscode-descriptionForeground)" }}>
												{slashCommandInfo.args}
											</span>
										</div>
									)}
									{slashCommandInfo.description && (
										<div style={{ color: "var(--vscode-descriptionForeground)" }}>
											{slashCommandInfo.description}
										</div>
									)}
								</div>
							)}
						</div>
					</>
				)
			}
			case "generateImage":
				const imageGenerationMetadata = tool.imageGeneration ?? {
					status: message.type === "ask" ? "pending" : "completed",
					prompt: tool.content,
					path: tool.path,
				}
				const imageApprovalPromptId = `image-generation-approval-prompt-${message.ts}`
				const imageGenerationStatus = imageGenerationMetadata.status ?? "completed"
				const shouldRenderApproval = message.type === "ask"

				return (
					<>
						<div style={headerStyle}>
							{shouldRenderApproval && tool.isProtected ? (
								<span
									className="codicon codicon-lock"
									style={{ color: "var(--vscode-editorWarning-foreground)", marginBottom: "-1.5px" }}
								/>
							) : !shouldRenderApproval ? (
								renderImageGenerationStatusIcon(imageGenerationStatus)
							) : (
								toolIcon("file-media")
							)}
							<span style={{ fontWeight: "bold" }}>
								{shouldRenderApproval
									? tool.isProtected
										? t("chat:fileOperations.wantsToGenerateImageProtected")
										: tool.isOutsideWorkspace
											? t("chat:fileOperations.wantsToGenerateImageOutsideWorkspace")
											: t("chat:fileOperations.wantsToGenerateImage")
									: t("chat:imageGeneration.statusTitle", {
											status: t(`chat:imageGeneration.status.${imageGenerationStatus}`),
										})}
							</span>
						</div>
						{shouldRenderApproval ? (
							<div className="pl-6">
								<ToolUseBlock>
									<div className="flex flex-col gap-3 p-2">
										<div className="flex items-center gap-2 text-xs text-vscode-descriptionForeground">
											<ImageIcon className="size-3" aria-hidden="true" />
											<span>{t("chat:imageGeneration.approval.editPromptHint")}</span>
										</div>
										<div className="flex flex-col gap-1">
											<label
												htmlFor={imageApprovalPromptId}
												className="text-xs font-medium text-vscode-descriptionForeground">
												{t("chat:imageGeneration.approval.promptLabel")}
											</label>
											<textarea
												id={imageApprovalPromptId}
												aria-label={t("chat:imageGeneration.approval.promptLabel")}
												value={imageApprovalPrompt}
												onChange={handleImageApprovalPromptChange}
												rows={4}
												className="w-full resize-y rounded border border-vscode-input-border bg-vscode-input-background px-2 py-1 text-sm text-vscode-input-foreground outline-none focus:border-vscode-focusBorder"
											/>
										</div>
										<div className="flex justify-end">
											<button
												type="button"
												disabled={imageApprovalPrompt.trim().length === 0}
												onClick={handleImageApprovalGenerate}
												className={cn(
													"rounded bg-vscode-button-background px-3 py-1 text-xs font-medium text-vscode-button-foreground hover:bg-vscode-button-hoverBackground",
													imageApprovalPrompt.trim().length === 0 &&
														"cursor-not-allowed opacity-50",
												)}>
												{t("chat:imageGeneration.approval.generate")}
											</button>
										</div>
										{renderImageGenerationMetadata(imageGenerationMetadata)}
									</div>
								</ToolUseBlock>
							</div>
						) : (
							<div className="pl-6">
								<ToolUseBlock className="cursor-default border border-vscode-panel-border">
									<div className="flex flex-col gap-3 p-2">
										{tool.imageUri || tool.imagePath ? (
											<ImageBlock imageUri={tool.imageUri} imagePath={tool.imagePath} />
										) : null}
										{renderImageGenerationMetadata(imageGenerationMetadata)}
									</div>
								</ToolUseBlock>
							</div>
						)}
					</>
				)
			default:
				return null
		}
	}

	switch (message.type) {
		case "say":
			switch (message.say) {
				case "diff_error":
					return (
						<ErrorRow
							type="diff_error"
							message={message.text || ""}
							expandable={true}
							showCopyButton={true}
						/>
					)
				case "subtask_result":
					// Get the child task ID that produced this result
					const completedChildTaskId = currentTaskItem?.completedByChildId
					return (
						<div className="border-l border-muted-foreground/80 ml-2 pl-4 pt-2 pb-1 -mt-5">
							<div style={headerStyle}>
								<span style={{ fontWeight: "bold" }}>{t("chat:subtasks.resultContent")}</span>
								<Check className="size-3" />
							</div>
							<MarkdownBlock markdown={message.text} />
							{completedChildTaskId && (
								<button
									className="cursor-pointer flex gap-1 items-center mt-2 text-vscode-descriptionForeground hover:text-vscode-descriptionForeground hover:underline font-normal"
									onClick={() =>
										vscode.postMessage({ type: "showTaskWithId", text: completedChildTaskId })
									}>
									{t("chat:subtasks.goToSubtask")}
									<ArrowRight className="size-3" />
								</button>
							)}
						</div>
					)
				case "reasoning":
					return (
						<ReasoningBlock
							content={message.text || ""}
							ts={message.ts}
							isStreaming={isStreaming}
							isLast={isLast}
						/>
					)
				case "api_req_started":
					// Determine if the API request is in progress
					const isApiRequestInProgress =
						apiReqCancelReason === undefined && apiRequestFailedMessage === undefined && cost === undefined

					return (
						<>
							<div
								className={`group text-sm transition-opacity ${
									isApiRequestInProgress ? "opacity-100" : "opacity-40 hover:opacity-100"
								}`}
								style={{
									...headerStyle,
									marginBottom:
										((cost === null || cost === undefined) && apiRequestFailedMessage) ||
										apiReqStreamingFailedMessage
											? 10
											: 0,
									justifyContent: "space-between",
								}}>
								<div style={{ display: "flex", alignItems: "center", gap: "10px", flexGrow: 1 }}>
									{icon}
									{title}
								</div>
								<div
									className="text-xs text-vscode-dropdown-foreground border-vscode-dropdown-border/50 border px-1.5 py-0.5 rounded-lg"
									style={{ opacity: cost !== null && cost !== undefined && cost > 0 ? 1 : 0 }}>
									${Number(cost || 0)?.toFixed(4)}
								</div>
							</div>
							{(((cost === null || cost === undefined) && apiRequestFailedMessage) ||
								apiReqStreamingFailedMessage) && (
								<ErrorRow
									type="api_failure"
									message={apiRequestFailedMessage || apiReqStreamingFailedMessage || ""}
									docsURL={
										apiRequestFailedMessage?.toLowerCase().includes("powershell")
											? "https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22"
											: undefined
									}
									errorDetails={apiReqStreamingFailedMessage}
								/>
							)}
						</>
					)
				case "api_req_retry_delayed":
					let body = t(`chat:apiRequest.failed`)
					let retryInfo, rawError, code, docsURL
					if (message.text !== undefined) {
						// Try to show richer error message for that code, if available
						const potentialCode = parseInt(message.text.substring(0, 3))
						if (!isNaN(potentialCode) && potentialCode >= 400) {
							code = potentialCode
							const stringForError = `chat:apiRequest.errorMessage.${code}`
							if (i18n.exists(stringForError)) {
								body = t(stringForError)
								// Fill this out in upcoming PRs
								// Do not remove this
								// switch(code) {
								// 	case ERROR_CODE:
								// 		docsURL = ???
								// 		break;
								// }
							} else {
								// Non-HTTP-status-code error message - store full text as errorDetails
								body = t("chat:apiRequest.errorMessage.unknown")
								docsURL = "https://github.com/Cmizz24/C-Code/issues/new?template=bug_report.yml"
							}
						}

						// This isn't pretty, but since the retry logic happens at a lower level
						// and the message object is just a flat string, we need to extract the
						// retry information using this "tag" as a convention
						const retryTimerMatch = message.text.match(/<retry_timer>(.*?)<\/retry_timer>/)
						const retryTimer = retryTimerMatch && retryTimerMatch[1] ? parseInt(retryTimerMatch[1], 10) : 0
						rawError = message.text.replace(/<retry_timer>(.*?)<\/retry_timer>/, "").trim()
						retryInfo = retryTimer > 0 && (
							<p
								className={cn(
									"mt-2 font-light text-xs  text-vscode-descriptionForeground cursor-default flex items-center gap-1 transition-all duration-1000",
									retryTimer === 0 ? "opacity-0 max-h-0" : "max-h-2 opacity-100",
								)}>
								<Repeat2 className="size-3" strokeWidth={1.5} />
								<span>{retryTimer}s</span>
							</p>
						)
					}
					return (
						<ErrorRow
							type="api_req_retry_delayed"
							code={code}
							message={body}
							docsURL={docsURL}
							additionalContent={retryInfo}
							errorDetails={rawError}
						/>
					)
				case "api_req_rate_limit_wait": {
					const isWaiting = message.partial === true

					const waitSeconds = (() => {
						if (!message.text) return undefined
						try {
							const data = JSON.parse(message.text)
							return typeof data.seconds === "number" ? data.seconds : undefined
						} catch {
							return undefined
						}
					})()

					return isWaiting && waitSeconds !== undefined ? (
						<div
							className={`group text-sm transition-opacity opacity-100`}
							style={{
								...headerStyle,
								marginBottom: 0,
								justifyContent: "space-between",
							}}>
							<div style={{ display: "flex", alignItems: "center", gap: "10px", flexGrow: 1 }}>
								<ProgressIndicator />
								<span style={{ color: normalColor }}>{t("chat:apiRequest.rateLimitWait")}</span>
							</div>
							<span className="text-xs font-light text-vscode-descriptionForeground">{waitSeconds}s</span>
						</div>
					) : null
				}
				case "api_req_finished":
					return null // we should never see this message type
				case "text":
					return (
						<div className="group">
							<div style={headerStyle}>
								<MessageCircle className="w-4 shrink-0" aria-label="Speech bubble icon" />
								<span style={{ fontWeight: "bold" }}>{t("chat:text.rooSaid")}</span>
								<div style={{ flexGrow: 1 }} />
								<OpenMarkdownPreviewButton markdown={message.text} />
							</div>
							<div className="pl-6">
								<Markdown markdown={message.text} partial={message.partial} />
								{message.images && message.images.length > 0 && (
									<div style={{ marginTop: "10px" }}>
										{message.images.map((image, index) => (
											<ImageBlock key={index} imageData={image} />
										))}
									</div>
								)}
							</div>
						</div>
					)
				case "user_feedback":
					return (
						<div className="group">
							<div style={headerStyle}>
								<User className="w-4 shrink-0" aria-label="User icon" />
								<span style={{ fontWeight: "bold" }}>{t("chat:feedback.youSaid")}</span>
							</div>
							<div
								className={cn(
									"ml-6 border rounded-sm overflow-hidden whitespace-pre-wrap",
									isEditing
										? "bg-vscode-editor-background text-vscode-editor-foreground"
										: "cursor-text p-1 bg-vscode-editor-foreground/70 text-vscode-editor-background",
								)}>
								{isEditing ? (
									<div className="flex flex-col gap-2">
										<ChatTextArea
											inputValue={editedContent}
											setInputValue={setEditedContent}
											sendingDisabled={false}
											selectApiConfigDisabled={true}
											placeholderText={t("chat:editMessage.placeholder")}
											selectedImages={editImages}
											setSelectedImages={setEditImages}
											onSend={handleSaveEdit}
											onSelectImages={handleSelectImages}
											shouldDisableImages={!model?.supportsImages}
											mode={editMode}
											setMode={setEditMode}
											modeShortcutText=""
											isEditMode={true}
											onCancel={handleCancelEdit}
										/>
									</div>
								) : (
									<div className="flex justify-between">
										<div
											className="flex-grow px-2 py-1 wrap-anywhere rounded-lg transition-colors"
											onClick={(e) => {
												e.stopPropagation()
												if (!isStreaming) {
													handleEditClick()
												}
											}}
											title={t("chat:queuedMessages.clickToEdit")}>
											<Mention text={message.text} withShadow />
										</div>
										<div className="flex gap-2 pr-1">
											<div
												className="cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
												style={{ visibility: isStreaming ? "hidden" : "visible" }}
												onClick={(e) => {
													e.stopPropagation()
													handleEditClick()
												}}>
												<Edit className="w-4 shrink-0" aria-label="Edit message icon" />
											</div>
											<div
												className="cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
												style={{ visibility: isStreaming ? "hidden" : "visible" }}
												onClick={(e) => {
													e.stopPropagation()
													vscode.postMessage({ type: "deleteMessage", value: message.ts })
												}}>
												<Trash2 className="w-4 shrink-0" aria-label="Delete message icon" />
											</div>
										</div>
									</div>
								)}
								{!isEditing && message.images && message.images.length > 0 && (
									<Thumbnails images={message.images} style={{ marginTop: "8px" }} />
								)}
							</div>
						</div>
					)
				case "user_feedback_diff":
					const tool = safeJsonParse<ClineSayTool>(message.text)
					if (tool?.tool === "parallelAgents") {
						return null
					}

					return (
						<div style={{ marginTop: -10, width: "100%" }}>
							<CodeAccordion
								code={tool?.diff}
								language="diff"
								isFeedback={true}
								isExpanded={isExpanded}
								onToggleExpand={handleToggleExpand}
							/>
						</div>
					)
				case "error":
					// Check if this is a model response error based on marker strings from backend
					const isNoToolsUsedError = message.text === "MODEL_NO_TOOLS_USED"
					const isNoAssistantMessagesError = message.text === "MODEL_NO_ASSISTANT_MESSAGES"

					if (isNoToolsUsedError) {
						return (
							<ErrorRow
								type="error"
								title={t("chat:modelResponseIncomplete")}
								message={t("chat:modelResponseErrors.noToolsUsed")}
								errorDetails={t("chat:modelResponseErrors.noToolsUsedDetails")}
							/>
						)
					}

					if (isNoAssistantMessagesError) {
						return (
							<ErrorRow
								type="error"
								title={t("chat:modelResponseIncomplete")}
								message={t("chat:modelResponseErrors.noAssistantMessages")}
								errorDetails={t("chat:modelResponseErrors.noAssistantMessagesDetails")}
							/>
						)
					}

					// Fallback for generic errors
					return (
						<ErrorRow type="error" message={message.text || t("chat:error")} errorDetails={message.text} />
					)
				case "completion_result":
					return (
						<div className="group">
							<div style={headerStyle}>
								{icon}
								{title}
								<div style={{ flexGrow: 1 }} />
								<OpenMarkdownPreviewButton markdown={message.text} />
							</div>
							<div className="border-l border-green-600/30 ml-2 pl-4 pb-1">
								<Markdown markdown={message.text} />
							</div>
						</div>
					)
				case "shell_integration_warning":
					return <CommandExecutionError />
				case "checkpoint_saved":
					return (
						<CheckpointSaved
							ts={message.ts!}
							commitHash={message.text!}
							currentHash={currentCheckpoint}
							checkpoint={message.checkpoint}
							onJumpToPreviousCheckpoint={onJumpToPreviousCheckpoint}
						/>
					)
				case "condense_context":
					// In-progress state
					if (message.partial) {
						return <InProgressRow eventType="condense_context" />
					}
					// Completed state
					if (message.contextCondense) {
						return <CondensationResultRow data={message.contextCondense} />
					}
					return null
				case "condense_context_error":
					return <CondensationErrorRow errorText={message.text} />
				case "sliding_window_truncation":
					// In-progress state
					if (message.partial) {
						return <InProgressRow eventType="sliding_window_truncation" />
					}
					// Completed state
					if (message.contextTruncation) {
						return <TruncationResultRow data={message.contextTruncation} />
					}
					return null
				case "codebase_search_result":
					let parsed: {
						content: {
							query: string
							results: Array<{
								filePath: string
								score: number
								startLine: number
								endLine: number
								codeChunk: string
							}>
						}
					} | null = null

					try {
						if (message.text) {
							parsed = JSON.parse(message.text)
						}
					} catch (error) {
						console.error("Failed to parse codebaseSearch content:", error)
					}

					if (parsed && !parsed?.content) {
						console.error("Invalid codebaseSearch content structure:", parsed.content)
						return <div>Error displaying search results.</div>
					}

					const { results = [] } = parsed?.content || {}

					return <CodebaseSearchResultsDisplay results={results} />
				case "user_edit_todos":
					return <UpdateTodoListToolBlock userEdited onChange={() => {}} />
				case "tool" as any:
					// Handle say tool messages
					const sayTool = safeJsonParse<ClineSayTool>(message.text)
					if (!sayTool) return null

					switch (sayTool.tool) {
						case "parallelAgents":
							return <AgentStatusPanel tool={sayTool} />
						case "visualBrowserInspector":
						case "visual_browser_inspector":
							return renderVisualBrowserInspectorTool(sayTool)
						case "generateImage":
						case "imageGenerated":
							return renderImageGenerationStatusTool(sayTool)
						case "runSlashCommand": {
							const slashCommandInfo = sayTool
							return (
								<>
									<div style={headerStyle}>
										<span
											className="codicon codicon-terminal-cmd"
											style={{
												color: "var(--vscode-foreground)",
												marginBottom: "-1.5px",
											}}></span>
										<span style={{ fontWeight: "bold" }}>{t("chat:slashCommand.didRun")}</span>
									</div>
									<div className="pl-6">
										<ToolUseBlock>
											<ToolUseBlockHeader
												style={{
													display: "flex",
													flexDirection: "column",
													alignItems: "flex-start",
													gap: "4px",
													padding: "10px 12px",
												}}>
												<div
													style={{
														display: "flex",
														alignItems: "center",
														gap: "8px",
														width: "100%",
													}}>
													<span
														style={{
															fontWeight: "500",
															fontSize: "var(--vscode-font-size)",
														}}>
														/{slashCommandInfo.command}
													</span>
													{slashCommandInfo.args && (
														<span
															style={{
																color: "var(--vscode-descriptionForeground)",
																fontSize: "var(--vscode-font-size)",
															}}>
															{slashCommandInfo.args}
														</span>
													)}
												</div>
												{slashCommandInfo.description && (
													<div
														style={{
															color: "var(--vscode-descriptionForeground)",
															fontSize: "calc(var(--vscode-font-size) - 1px)",
														}}>
														{slashCommandInfo.description}
													</div>
												)}
												{slashCommandInfo.source && (
													<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
														<VSCodeBadge
															style={{ fontSize: "calc(var(--vscode-font-size) - 2px)" }}>
															{slashCommandInfo.source}
														</VSCodeBadge>
													</div>
												)}
											</ToolUseBlockHeader>
										</ToolUseBlock>
									</div>
								</>
							)
						}
						case "readCommandOutput": {
							const formatBytes = (bytes: number) => {
								if (bytes < 1024) return `${bytes} B`
								if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
								return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
							}

							// Determine if this is a search operation
							const isSearch = sayTool.searchPattern !== undefined

							let infoText = ""
							if (isSearch) {
								// Search mode: show pattern and match count
								const matchText =
									sayTool.matchCount !== undefined
										? sayTool.matchCount === 1
											? "1 match"
											: `${sayTool.matchCount} matches`
										: ""
								infoText = `search: "${sayTool.searchPattern}"${matchText ? ` • ${matchText}` : ""}`
							} else if (
								sayTool.readStart !== undefined &&
								sayTool.readEnd !== undefined &&
								sayTool.totalBytes !== undefined
							) {
								// Read mode: show byte range
								infoText = `${formatBytes(sayTool.readStart)} - ${formatBytes(sayTool.readEnd)} of ${formatBytes(sayTool.totalBytes)}`
							} else if (sayTool.totalBytes !== undefined) {
								infoText = formatBytes(sayTool.totalBytes)
							}

							return (
								<div style={headerStyle}>
									<FileCode2 className="w-4 shrink-0" aria-label="Read command output icon" />
									<span style={{ fontWeight: "bold" }}>{t("chat:readCommandOutput.title")}</span>
									{infoText && (
										<span
											className="text-xs ml-1"
											style={{ color: "var(--vscode-descriptionForeground)" }}>
											({infoText})
										</span>
									)}
								</div>
							)
						}
						default:
							return null
					}
				case "image":
					// Parse the JSON to get imageUri and imagePath
					const imageInfo = safeJsonParse<GeneratedImageSayPayload>(message.text || "{}")
					if (!imageInfo) {
						return null
					}
					return (
						<div className="mt-2 flex flex-col gap-2">
							<ImageBlock imageUri={imageInfo.imageUri} imagePath={imageInfo.imagePath} />
							{imageInfo.imageGeneration && (
								<div className="pl-6">
									<ToolUseBlock className="cursor-default border border-vscode-panel-border">
										{renderImageGenerationMetadata(imageInfo.imageGeneration, true)}
									</ToolUseBlock>
								</div>
							)}
						</div>
					)
				case "too_many_tools_warning": {
					const warningData = safeJsonParse<{
						toolCount: number
						serverCount: number
						threshold: number
					}>(message.text || "{}")
					if (!warningData) return null
					const toolsPart = t("chat:tooManyTools.toolsPart", { count: warningData.toolCount })
					const serversPart = t("chat:tooManyTools.serversPart", { count: warningData.serverCount })
					return (
						<WarningRow
							title={t("chat:tooManyTools.title")}
							message={t("chat:tooManyTools.messageTemplate", {
								tools: toolsPart,
								servers: serversPart,
								threshold: warningData.threshold,
							})}
							actionText={t("chat:tooManyTools.openMcpSettings")}
							onAction={() =>
								window.postMessage(
									{ type: "action", action: "settingsButtonClicked", values: { section: "mcp" } },
									"*",
								)
							}
						/>
					)
				}
				default:
					return (
						<>
							{title && (
								<div style={headerStyle}>
									{icon}
									{title}
								</div>
							)}
							<div style={{ paddingTop: 10 }}>
								<Markdown markdown={message.text} partial={message.partial} />
							</div>
						</>
					)
			}
		case "ask":
			switch (message.ask) {
				case "mistake_limit_reached":
					return <ErrorRow type="mistake_limit" message={message.text || ""} errorDetails={message.text} />
				case "command":
					return (
						<CommandExecution
							executionId={message.ts.toString()}
							text={message.text}
							icon={icon}
							title={title}
						/>
					)
				case "use_mcp_server":
					// Parse the message text to get the MCP server request
					const messageJson = safeJsonParse<any>(message.text, {})

					// Extract the response field if it exists
					const { response, ...mcpServerRequest } = messageJson

					// Create the useMcpServer object with the response field
					const useMcpServer: ClineAskUseMcpServer = {
						...mcpServerRequest,
						response,
					}

					if (!useMcpServer) {
						return null
					}

					const server = mcpServers.find((server) => server.name === useMcpServer.serverName)

					return (
						<>
							<div style={headerStyle}>
								{icon}
								{title}
							</div>
							<div className="w-full bg-vscode-editor-background border border-vscode-border rounded-xs p-2 mt-2">
								{useMcpServer.type === "access_mcp_resource" && (
									<McpResourceRow
										item={{
											// Use the matched resource/template details, with fallbacks
											...(findMatchingResourceOrTemplate(
												useMcpServer.uri || "",
												server?.resources,
												server?.resourceTemplates,
											) || {
												name: "",
												mimeType: "",
												description: "",
											}),
											// Always use the actual URI from the request
											uri: useMcpServer.uri || "",
										}}
									/>
								)}
								{useMcpServer.type === "use_mcp_tool" && (
									<McpExecution
										executionId={message.ts.toString()}
										text={useMcpServer.arguments !== "{}" ? useMcpServer.arguments : undefined}
										serverName={useMcpServer.serverName}
										toolName={useMcpServer.toolName}
										isArguments={true}
										server={server}
										useMcpServer={useMcpServer}
										alwaysAllowMcp={alwaysAllowMcp}
									/>
								)}
							</div>
						</>
					)
				case "completion_result":
					if (message.text) {
						return (
							<div className="group">
								<div style={headerStyle}>
									{icon}
									{title}
									<div style={{ flexGrow: 1 }} />
									<OpenMarkdownPreviewButton markdown={message.text} />
								</div>
								<div style={{ color: "var(--vscode-charts-green)", paddingTop: 10 }}>
									<Markdown markdown={message.text} partial={message.partial} />
								</div>
							</div>
						)
					} else {
						return null // Don't render anything when we get a completion_result ask without text
					}
				case "followup":
					return (
						<>
							{title && (
								<div style={headerStyle}>
									{icon}
									{title}
								</div>
							)}
							<div className="flex flex-col gap-2 ml-6">
								<Markdown
									markdown={message.partial === true ? message?.text : followUpData?.question}
								/>
								<FollowUpSuggest
									suggestions={followUpData?.suggest}
									onSuggestionClick={onSuggestionClick}
									ts={message?.ts}
									onCancelAutoApproval={onFollowUpUnmount}
									isAnswered={isFollowUpAnswered}
									isFollowUpAutoApprovalPaused={isFollowUpAutoApprovalPaused}
								/>
							</div>
						</>
					)
				case "auto_approval_max_req_reached": {
					return <AutoApprovedRequestLimitWarning message={message} />
				}
				default:
					return null
			}
	}
}

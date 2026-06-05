export const visualBrowserViewportPresetNames = ["mobile", "tablet", "desktop"] as const

export type VisualBrowserViewportPresetName = (typeof visualBrowserViewportPresetNames)[number]

export interface VisualBrowserViewport {
	name: VisualBrowserViewportPresetName | "custom"
	width: number
	height: number
	deviceScaleFactor?: number
	isMobile?: boolean
	hasTouch?: boolean
}

export const visualBrowserViewportPresets: Record<VisualBrowserViewportPresetName, VisualBrowserViewport> = {
	mobile: {
		name: "mobile",
		width: 390,
		height: 844,
		deviceScaleFactor: 1,
		isMobile: true,
		hasTouch: true,
	},
	tablet: {
		name: "tablet",
		width: 768,
		height: 1024,
		deviceScaleFactor: 1,
		isMobile: true,
		hasTouch: true,
	},
	desktop: {
		name: "desktop",
		width: 1440,
		height: 900,
		deviceScaleFactor: 1,
		isMobile: false,
		hasTouch: false,
	},
} as const

export type VisualBrowserAction =
	| "visual_browser_open"
	| "visual_browser_reload"
	| "visual_browser_back"
	| "visual_browser_forward"
	| "visual_browser_capture"
	| "visual_browser_crop"
	| "visual_browser_inspect_point"
	| "visual_browser_inspect_region"
	| "visual_browser_click"
	| "visual_browser_hover"
	| "visual_browser_type"
	| "visual_browser_scroll"
	| "visual_browser_analyze_screenshot"
	| "visual_browser_analyze_crop"
	| "visual_browser_close"
	| "visual_browser_delete_session"

export type VisualBrowserSessionStatus = "opening" | "active" | "closed" | "error"

export interface VisualBrowserBoundingBox {
	x: number
	y: number
	width: number
	height: number
}

export interface VisualBrowserPoint {
	x: number
	y: number
}

export interface VisualBrowserArtifactPaths {
	rootDir: string
	screenshotsDir: string
	cropsDir: string
	metadataPath: string
	findingsPath?: string
}

export interface VisualBrowserSessionMetadata {
	sessionId: string
	status: VisualBrowserSessionStatus
	url: string
	createdAt: string
	updatedAt: string
	closedAt?: string
	viewport: VisualBrowserViewport
	headless: boolean
	allowExternal: boolean
	artifacts: VisualBrowserArtifactPaths
	error?: string
}

export interface VisualBrowserScreenshotMetadata {
	sessionId: string
	screenshotId: string
	url: string
	title?: string
	path: string
	webviewUri?: string
	createdAt: string
	viewport: VisualBrowserViewport
	pageWidth: number
	pageHeight: number
	fullPage: boolean
	redacted: boolean
}

export interface VisualBrowserCropMetadata {
	sessionId: string
	cropId: string
	screenshotId: string
	url: string
	path: string
	webviewUri?: string
	createdAt: string
	viewport: VisualBrowserViewport
	region: VisualBrowserBoundingBox
	elements: VisualBrowserElementMetadata[]
}

export interface VisualBrowserComputedStyles {
	display?: string
	position?: string
	zIndex?: string
	color?: string
	backgroundColor?: string
	fontFamily?: string
	fontSize?: string
	fontWeight?: string
	lineHeight?: string
	overflow?: string
	overflowX?: string
	overflowY?: string
	opacity?: string
	visibility?: string
}

export interface VisualBrowserElementMetadata {
	tagName: string
	selector: string
	text?: string
	role?: string | null
	ariaLabel?: string | null
	attributes: Record<string, string>
	boundingBox: VisualBrowserBoundingBox
	visible: boolean
	computedStyles?: VisualBrowserComputedStyles
	sourceMapping?: Record<string, string>
}

export interface VisualBrowserInspectedElement extends VisualBrowserElementMetadata {
	ancestors: VisualBrowserElementMetadata[]
}

export type VisualBrowserIssueSeverity = "critical" | "major" | "minor"

export interface VisualBrowserIssue {
	severity: VisualBrowserIssueSeverity
	confidence: number
	title: string
	visualEvidence: string
	screenshotId: string
	cropId: string | null
	selectorOrElement: string
	boundingBox: VisualBrowserBoundingBox
	likelyCause: string
	suggestedFix: string
	filesToInspect: string[]
}

export interface VisualBrowserAnalysisResult {
	summary: string
	issues: VisualBrowserIssue[]
}

export interface VisualBrowserInspectionResult {
	sessionId: string
	screenshotId?: string
	cropId?: string
	url: string
	viewport: VisualBrowserViewport
	point?: VisualBrowserPoint
	region?: VisualBrowserBoundingBox
	element?: VisualBrowserInspectedElement | null
	elements?: VisualBrowserElementMetadata[]
	issues?: VisualBrowserIssue[]
}

export interface VisualBrowserPanelState {
	session?: VisualBrowserSessionMetadata
	screenshots: VisualBrowserScreenshotMetadata[]
	crops: VisualBrowserCropMetadata[]
	inspections: VisualBrowserInspectionResult[]
	findings: VisualBrowserAnalysisResult[]
	selection?: VisualBrowserBoundingBox
	statusMessage?: string
	error?: string
}

export interface VisualBrowserOpenParams {
	action: "visual_browser_open"
	url: string
	sessionId?: string
	viewport?: VisualBrowserViewportPresetName | VisualBrowserViewport
	headless?: boolean
	allowExternal?: boolean
}

export interface VisualBrowserSessionParams {
	sessionId?: string
}

export interface VisualBrowserCaptureParams extends VisualBrowserSessionParams {
	action: "visual_browser_capture"
	fullPage?: boolean
}

export interface VisualBrowserCropParams extends VisualBrowserSessionParams {
	action: "visual_browser_crop"
	screenshotId: string
	region: VisualBrowserBoundingBox
}

export interface VisualBrowserInspectPointParams extends VisualBrowserSessionParams {
	action: "visual_browser_inspect_point"
	x: number
	y: number
	screenshotId?: string
}

export interface VisualBrowserInspectRegionParams extends VisualBrowserSessionParams {
	action: "visual_browser_inspect_region"
	region: VisualBrowserBoundingBox
	screenshotId?: string
}

export interface VisualBrowserClickParams extends VisualBrowserSessionParams {
	action: "visual_browser_click"
	x?: number
	y?: number
	selector?: string
}

export interface VisualBrowserHoverParams extends VisualBrowserSessionParams {
	action: "visual_browser_hover"
	x?: number
	y?: number
	selector?: string
}

export interface VisualBrowserTypeParams extends VisualBrowserSessionParams {
	action: "visual_browser_type"
	text: string
	selector?: string
}

export interface VisualBrowserScrollParams extends VisualBrowserSessionParams {
	action: "visual_browser_scroll"
	deltaX?: number
	deltaY?: number
}

export interface VisualBrowserAnalyzeScreenshotParams extends VisualBrowserSessionParams {
	action: "visual_browser_analyze_screenshot"
	screenshotId: string
	prompt?: string
}

export interface VisualBrowserAnalyzeCropParams extends VisualBrowserSessionParams {
	action: "visual_browser_analyze_crop"
	cropId: string
	prompt?: string
}

export interface VisualBrowserNavigationParams extends VisualBrowserSessionParams {
	action: "visual_browser_reload" | "visual_browser_back" | "visual_browser_forward"
}

export interface VisualBrowserCloseParams extends VisualBrowserSessionParams {
	action: "visual_browser_close"
}

export interface VisualBrowserDeleteSessionParams extends VisualBrowserSessionParams {
	action: "visual_browser_delete_session"
}

export type VisualBrowserInspectorToolParams =
	| VisualBrowserOpenParams
	| VisualBrowserCaptureParams
	| VisualBrowserCropParams
	| VisualBrowserInspectPointParams
	| VisualBrowserInspectRegionParams
	| VisualBrowserClickParams
	| VisualBrowserHoverParams
	| VisualBrowserTypeParams
	| VisualBrowserScrollParams
	| VisualBrowserAnalyzeScreenshotParams
	| VisualBrowserAnalyzeCropParams
	| VisualBrowserNavigationParams
	| VisualBrowserCloseParams
	| VisualBrowserDeleteSessionParams

export interface VisualBrowserToolResult {
	action: VisualBrowserAction
	session: VisualBrowserSessionMetadata
	screenshot?: VisualBrowserScreenshotMetadata
	crop?: VisualBrowserCropMetadata
	inspection?: VisualBrowserInspectionResult
	analysis?: VisualBrowserAnalysisResult
	message?: string
}

export type VisualBrowserWebviewRequest =
	| { action: "get_state"; sessionId?: string }
	| { action: "open"; url: string; viewport: VisualBrowserViewportPresetName; allowExternal?: boolean }
	| { action: "capture"; sessionId?: string; fullPage?: boolean }
	| { action: "crop"; sessionId?: string; screenshotId: string; region: VisualBrowserBoundingBox }
	| { action: "inspect_point"; sessionId?: string; x: number; y: number; screenshotId?: string }
	| { action: "inspect_region"; sessionId?: string; region: VisualBrowserBoundingBox; screenshotId?: string }
	| { action: "analyze_screenshot"; sessionId?: string; screenshotId: string; prompt?: string }
	| { action: "analyze_crop"; sessionId?: string; cropId: string; prompt?: string }
	| { action: "stop"; sessionId?: string }
	| { action: "delete_session"; sessionId?: string }

export interface VisualBrowserWebviewResponse {
	requestId?: string
	state: VisualBrowserPanelState
	result?: VisualBrowserToolResult
	error?: string
}

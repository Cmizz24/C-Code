import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"

import {
	type ExtensionMessage,
	type VisualBrowserBoundingBox,
	type VisualBrowserCropMetadata,
	type VisualBrowserElementMetadata,
	type VisualBrowserPanelState,
	type VisualBrowserPoint,
	type VisualBrowserScreenshotMetadata,
	type VisualBrowserViewportPresetName,
	type VisualBrowserWebviewRequest,
	type VisualBrowserWebviewResponse,
	visualBrowserViewportPresets,
} from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

const emptyPanelState: VisualBrowserPanelState = {
	screenshots: [],
	crops: [],
	inspections: [],
	findings: [],
	statusMessage: "No controlled Playwright browser session is active.",
}

const buttonBaseClass =
	"rounded border border-vscode-panel-border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
const primaryButtonClass = `${buttonBaseClass} bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground`
const secondaryButtonClass = `${buttonBaseClass} bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground`
const dangerButtonClass = `${buttonBaseClass} bg-vscode-errorForeground text-vscode-editor-background hover:opacity-90`
const inputClass =
	"rounded border border-vscode-input-border bg-vscode-input-background px-2 py-1.5 text-sm text-vscode-input-foreground outline-none focus:border-vscode-focusBorder"

function normalizeUrlForCheck(input: string): string {
	const trimmed = input.trim()

	if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) || trimmed.startsWith("file:")) {
		return trimmed
	}

	return `http://${trimmed}`
}

function isProbablyLocalUrl(input: string): boolean {
	try {
		const url = new URL(normalizeUrlForCheck(input))
		const hostname = url.hostname.toLowerCase()

		return (
			url.protocol === "file:" ||
			hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "::1" ||
			hostname.endsWith(".localhost") ||
			/^127\./.test(hostname) ||
			/^10\./.test(hostname) ||
			/^192\.168\./.test(hostname) ||
			/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
		)
	} catch {
		return false
	}
}

function formatBox(box: VisualBrowserBoundingBox): string {
	return `${Math.round(box.x)}, ${Math.round(box.y)} · ${Math.round(box.width)} × ${Math.round(box.height)}`
}

function severityClassName(severity: string): string {
	switch (severity) {
		case "critical":
			return "border-vscode-errorForeground text-vscode-errorForeground"
		case "major":
			return "border-vscode-editorWarning-foreground text-vscode-editorWarning-foreground"
		default:
			return "border-vscode-descriptionForeground text-vscode-descriptionForeground"
	}
}

function elementLabel(element: VisualBrowserElementMetadata): string {
	const label = element.ariaLabel || element.role || element.text || element.selector
	return `${element.tagName.toLowerCase()} · ${label}`
}

function latestByCreatedAt<T extends { createdAt: string }>(items: T[]): T | undefined {
	return [...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
}

export default function VisualBrowserInspectorView() {
	const [panelState, setPanelState] = useState<VisualBrowserPanelState>(emptyPanelState)
	const [url, setUrl] = useState("http://localhost:3000")
	const [viewport, setViewport] = useState<VisualBrowserViewportPresetName>("mobile")
	const [allowExternal, setAllowExternal] = useState(false)
	const [fullPage, setFullPage] = useState(false)
	const [analysisPrompt, setAnalysisPrompt] = useState("")
	const [selectedScreenshotId, setSelectedScreenshotId] = useState<string | undefined>()
	const [selectedCropId, setSelectedCropId] = useState<string | undefined>()
	const [selection, setSelection] = useState<VisualBrowserBoundingBox | undefined>()
	const [statusMessage, setStatusMessage] = useState<string | undefined>()
	const [isLoading, setIsLoading] = useState(false)
	const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 1, height: 1 })
	const imageRef = useRef<HTMLImageElement | null>(null)
	const dragStartRef = useRef<VisualBrowserPoint | undefined>()
	const pendingAnalyzeCropRef = useRef(false)

	const currentSessionId = panelState.session?.sessionId
	const activeSession = Boolean(panelState.session && panelState.session.status !== "closed")
	const latestScreenshot = useMemo(() => latestByCreatedAt(panelState.screenshots), [panelState.screenshots])
	const currentScreenshot = useMemo<VisualBrowserScreenshotMetadata | undefined>(() => {
		return (
			panelState.screenshots.find((screenshot) => screenshot.screenshotId === selectedScreenshotId) ??
			latestScreenshot
		)
	}, [latestScreenshot, panelState.screenshots, selectedScreenshotId])
	const currentCrop = useMemo<VisualBrowserCropMetadata | undefined>(() => {
		return panelState.crops.find((crop) => crop.cropId === selectedCropId) ?? latestByCreatedAt(panelState.crops)
	}, [panelState.crops, selectedCropId])
	const externalUrlNeedsApproval = url.trim().length > 0 && !isProbablyLocalUrl(url)
	const selectionReady = Boolean(currentScreenshot && selection && selection.width >= 1 && selection.height >= 1)

	const sendRequest = useCallback((request: VisualBrowserWebviewRequest) => {
		setIsLoading(true)
		setStatusMessage(`Running ${request.action.replace(/_/g, " ")}...`)
		vscode.postMessage({ type: "visualBrowserInspector", payload: request })
	}, [])

	useEffect(() => {
		sendRequest({ action: "get_state" })
	}, [sendRequest])

	useEffect(() => {
		if (!currentScreenshot) {
			setSelectedScreenshotId(undefined)
			setSelection(undefined)
			return
		}

		if (
			!selectedScreenshotId ||
			!panelState.screenshots.some((screenshot) => screenshot.screenshotId === selectedScreenshotId)
		) {
			setSelectedScreenshotId(currentScreenshot.screenshotId)
		}
	}, [currentScreenshot, panelState.screenshots, selectedScreenshotId])

	useEffect(() => {
		if (!currentScreenshot) {
			setImageSize({ width: 1, height: 1 })
			return
		}

		setImageSize({ width: currentScreenshot.pageWidth || 1, height: currentScreenshot.pageHeight || 1 })
	}, [currentScreenshot])

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message = event.data as ExtensionMessage

			if (message.type !== "visualBrowserInspector") {
				return
			}

			const payload = message.payload as VisualBrowserWebviewResponse | { action?: string } | undefined

			if (payload && "action" in payload && payload.action === "show") {
				sendRequest({ action: "get_state" })
				return
			}

			if (!payload || !("state" in payload)) {
				return
			}

			setIsLoading(false)
			setPanelState(payload.state)
			setStatusMessage(
				payload.error || payload.result?.message || payload.state.error || payload.state.statusMessage,
			)

			if (payload.result?.screenshot) {
				setSelectedScreenshotId(payload.result.screenshot.screenshotId)
				setSelection(undefined)
			}

			if (payload.result?.crop) {
				setSelectedCropId(payload.result.crop.cropId)

				if (pendingAnalyzeCropRef.current) {
					pendingAnalyzeCropRef.current = false
					sendRequest({
						action: "analyze_crop",
						sessionId: payload.result.session.sessionId,
						cropId: payload.result.crop.cropId,
						prompt: analysisPrompt.trim() || undefined,
					})
				}
			}
		},
		[analysisPrompt, sendRequest],
	)

	useEvent("message", handleMessage)

	const getImagePoint = useCallback(
		(event: React.MouseEvent): VisualBrowserPoint | undefined => {
			const image = imageRef.current

			if (!image) {
				return undefined
			}

			const rect = image.getBoundingClientRect()
			const naturalWidth = image.naturalWidth || imageSize.width || 1
			const naturalHeight = image.naturalHeight || imageSize.height || 1
			const x = Math.min(Math.max(((event.clientX - rect.left) / rect.width) * naturalWidth, 0), naturalWidth)
			const y = Math.min(Math.max(((event.clientY - rect.top) / rect.height) * naturalHeight, 0), naturalHeight)

			return { x, y }
		},
		[imageSize.height, imageSize.width],
	)

	const updateSelection = useCallback((start: VisualBrowserPoint, end: VisualBrowserPoint) => {
		const x = Math.min(start.x, end.x)
		const y = Math.min(start.y, end.y)
		const width = Math.abs(end.x - start.x)
		const height = Math.abs(end.y - start.y)

		setSelection({
			x: Math.round(x),
			y: Math.round(y),
			width: Math.round(width),
			height: Math.round(height),
		})
	}, [])

	const handleMouseDown = useCallback(
		(event: React.MouseEvent) => {
			if (!currentScreenshot) {
				return
			}

			const point = getImagePoint(event)

			if (!point) {
				return
			}

			event.preventDefault()
			dragStartRef.current = point
			setSelectedCropId(undefined)
			setSelection({ x: Math.round(point.x), y: Math.round(point.y), width: 0, height: 0 })
		},
		[currentScreenshot, getImagePoint],
	)

	const handleMouseMove = useCallback(
		(event: React.MouseEvent) => {
			if (!dragStartRef.current || event.buttons !== 1) {
				return
			}

			const point = getImagePoint(event)

			if (point) {
				updateSelection(dragStartRef.current, point)
			}
		},
		[getImagePoint, updateSelection],
	)

	const handleMouseUp = useCallback(
		(event: React.MouseEvent) => {
			if (!dragStartRef.current) {
				return
			}

			const point = getImagePoint(event)

			if (point) {
				updateSelection(dragStartRef.current, point)
			}

			dragStartRef.current = undefined
		},
		[getImagePoint, updateSelection],
	)

	const handleScreenshotLoad = useCallback(() => {
		const image = imageRef.current

		if (!image) {
			return
		}

		setImageSize({
			width: image.naturalWidth || currentScreenshot?.pageWidth || 1,
			height: image.naturalHeight || currentScreenshot?.pageHeight || 1,
		})
	}, [currentScreenshot?.pageHeight, currentScreenshot?.pageWidth])

	const openBrowser = useCallback(() => {
		if (!url.trim()) {
			setStatusMessage("Enter a URL to inspect.")
			return
		}

		if (externalUrlNeedsApproval && !allowExternal) {
			setStatusMessage("External URLs are blocked until you explicitly enable Allow external URL capture.")
			return
		}

		sendRequest({ action: "open", url, viewport, allowExternal })
	}, [allowExternal, externalUrlNeedsApproval, sendRequest, url, viewport])

	const captureScreenshot = useCallback(() => {
		sendRequest({ action: "capture", sessionId: currentSessionId, fullPage })
	}, [currentSessionId, fullPage, sendRequest])

	const cropSelection = useCallback(() => {
		if (!currentScreenshot || !selection) {
			return
		}

		sendRequest({
			action: "crop",
			sessionId: currentSessionId,
			screenshotId: currentScreenshot.screenshotId,
			region: selection,
		})
	}, [currentScreenshot, currentSessionId, selection, sendRequest])

	const inspectSelection = useCallback(() => {
		if (!currentScreenshot || !selection) {
			return
		}

		sendRequest({
			action: "inspect_region",
			sessionId: currentSessionId,
			screenshotId: currentScreenshot.screenshotId,
			region: selection,
		})
	}, [currentScreenshot, currentSessionId, selection, sendRequest])

	const analyzeScreenshot = useCallback(() => {
		if (!currentScreenshot) {
			return
		}

		sendRequest({
			action: "analyze_screenshot",
			sessionId: currentSessionId,
			screenshotId: currentScreenshot.screenshotId,
			prompt: analysisPrompt.trim() || undefined,
		})
	}, [analysisPrompt, currentScreenshot, currentSessionId, sendRequest])

	const analyzeSelectedArea = useCallback(() => {
		if (currentCrop) {
			sendRequest({
				action: "analyze_crop",
				sessionId: currentSessionId,
				cropId: currentCrop.cropId,
				prompt: analysisPrompt.trim() || undefined,
			})
			return
		}

		if (!currentScreenshot || !selection) {
			return
		}

		pendingAnalyzeCropRef.current = true
		cropSelection()
	}, [analysisPrompt, cropSelection, currentCrop, currentScreenshot, currentSessionId, selection, sendRequest])

	const stopSession = useCallback(() => {
		sendRequest({ action: "stop", sessionId: currentSessionId })
	}, [currentSessionId, sendRequest])

	const deleteSession = useCallback(() => {
		sendRequest({ action: "delete_session", sessionId: currentSessionId })
		setSelection(undefined)
		setSelectedCropId(undefined)
		setSelectedScreenshotId(undefined)
	}, [currentSessionId, sendRequest])

	const status = statusMessage || panelState.error || panelState.statusMessage

	return (
		<div className="flex h-full flex-col gap-4 overflow-y-auto bg-vscode-editor-background p-4 text-vscode-foreground">
			<header className="flex flex-col gap-2 border-b border-vscode-panel-border pb-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<h2 className="m-0 text-lg font-semibold">Visual Browser Inspector</h2>
						<p className="m-0 text-sm text-vscode-descriptionForeground">
							Controlled Playwright browser capture only. Artifacts stay local under
							<code className="ml-1 rounded bg-vscode-textCodeBlock-background px-1">
								.roo/visual-browser-inspector
							</code>
							.
						</p>
					</div>
					<span className="rounded border border-vscode-panel-border px-2 py-1 text-xs text-vscode-descriptionForeground">
						{panelState.session?.status ?? "idle"}
					</span>
				</div>
				{status && (
					<div className="rounded border border-vscode-panel-border bg-vscode-sideBar-background px-3 py-2 text-sm">
						{isLoading ? "⏳ " : ""}
						{status}
					</div>
				)}
			</header>

			<section className="grid gap-3 rounded border border-vscode-panel-border bg-vscode-sideBar-background p-3">
				<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_auto]">
					<label className="grid gap-1 text-sm">
						<span className="text-vscode-descriptionForeground">URL</span>
						<input
							className={inputClass}
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							placeholder="http://localhost:3000"
						/>
					</label>
					<label className="grid gap-1 text-sm">
						<span className="text-vscode-descriptionForeground">Viewport</span>
						<select
							className={inputClass}
							value={viewport}
							onChange={(event) => setViewport(event.target.value as VisualBrowserViewportPresetName)}>
							{Object.entries(visualBrowserViewportPresets).map(([name, preset]) => (
								<option key={name} value={name}>
									{name} · {preset.width}×{preset.height}
								</option>
							))}
						</select>
					</label>
					<div className="flex items-end">
						<button className={primaryButtonClass} type="button" onClick={openBrowser} disabled={isLoading}>
							Open browser
						</button>
					</div>
				</div>

				<label className="flex items-start gap-2 text-sm text-vscode-descriptionForeground">
					<input
						className="mt-1"
						type="checkbox"
						checked={allowExternal}
						onChange={(event) => setAllowExternal(event.target.checked)}
					/>
					<span>
						Allow external URL capture. Non-localhost URLs are blocked unless this is explicitly enabled.
						{externalUrlNeedsApproval && !allowExternal ? " Current URL needs this confirmation." : ""}
					</span>
				</label>

				<div className="flex flex-wrap gap-2">
					<label className="flex items-center gap-2 rounded border border-vscode-panel-border px-2 py-1 text-sm text-vscode-descriptionForeground">
						<input
							type="checkbox"
							checked={fullPage}
							onChange={(event) => setFullPage(event.target.checked)}
						/>
						Full-page screenshot
					</label>
					<button
						className={secondaryButtonClass}
						type="button"
						onClick={captureScreenshot}
						disabled={!activeSession || isLoading}>
						Capture screenshot
					</button>
					<button
						className={secondaryButtonClass}
						type="button"
						onClick={analyzeScreenshot}
						disabled={!currentScreenshot || isLoading}>
						Analyze screenshot
					</button>
					<button
						className={secondaryButtonClass}
						type="button"
						onClick={stopSession}
						disabled={!activeSession || isLoading}>
						Stop session
					</button>
					<button
						className={dangerButtonClass}
						type="button"
						onClick={deleteSession}
						disabled={!panelState.session || isLoading}>
						Delete session artifacts
					</button>
				</div>
			</section>

			<section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
				<div className="grid gap-3">
					<div className="rounded border border-vscode-panel-border bg-vscode-sideBar-background p-3">
						<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
							<h3 className="m-0 text-base font-semibold">Screenshot selection</h3>
							{panelState.screenshots.length > 0 && (
								<select
									className={inputClass}
									value={currentScreenshot?.screenshotId ?? ""}
									onChange={(event) => {
										setSelectedScreenshotId(event.target.value)
										setSelection(undefined)
									}}>
									{panelState.screenshots.map((screenshot) => (
										<option key={screenshot.screenshotId} value={screenshot.screenshotId}>
											{screenshot.screenshotId} · {screenshot.fullPage ? "full" : "viewport"}
										</option>
									))}
								</select>
							)}
						</div>

						{currentScreenshot?.webviewUri ? (
							<div className="grid gap-3">
								<div
									className="relative inline-block max-w-full cursor-crosshair select-none overflow-hidden rounded border border-vscode-panel-border bg-vscode-editor-background"
									onMouseDown={handleMouseDown}
									onMouseMove={handleMouseMove}
									onMouseUp={handleMouseUp}>
									<img
										ref={imageRef}
										src={currentScreenshot.webviewUri}
										alt={`Captured screenshot ${currentScreenshot.screenshotId}`}
										className="block max-h-[70vh] max-w-full"
										draggable={false}
										onLoad={handleScreenshotLoad}
									/>
									{selection && selection.width > 0 && selection.height > 0 && (
										<svg
											className="pointer-events-none absolute inset-0 h-full w-full"
											viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
											preserveAspectRatio="none"
											aria-hidden="true">
											<rect
												x={selection.x}
												y={selection.y}
												width={selection.width}
												height={selection.height}
												className="fill-vscode-button-background/20 stroke-vscode-focusBorder"
												strokeWidth="2"
											/>
										</svg>
									)}
								</div>

								<div className="flex flex-wrap items-center gap-2 text-sm">
									<span className="text-vscode-descriptionForeground">
										{selection
											? `Selected ${formatBox(selection)} px`
											: "Drag over the screenshot to select a region."}
									</span>
									<button
										className={secondaryButtonClass}
										type="button"
										onClick={cropSelection}
										disabled={!selectionReady || isLoading}>
										Crop selected area
									</button>
									<button
										className={secondaryButtonClass}
										type="button"
										onClick={inspectSelection}
										disabled={!selectionReady || isLoading}>
										Inspect selected area
									</button>
									<button
										className={secondaryButtonClass}
										type="button"
										onClick={analyzeSelectedArea}
										disabled={(!selectionReady && !currentCrop) || isLoading}>
										Ask AI to analyze selected area
									</button>
								</div>
							</div>
						) : (
							<div className="rounded border border-dashed border-vscode-panel-border p-6 text-center text-sm text-vscode-descriptionForeground">
								Open a controlled browser session and capture a screenshot to begin visual inspection.
							</div>
						)}
					</div>

					<label className="grid gap-1 rounded border border-vscode-panel-border bg-vscode-sideBar-background p-3 text-sm">
						<span className="font-medium">Analysis prompt</span>
						<textarea
							className={`${inputClass} min-h-20 resize-y`}
							value={analysisPrompt}
							onChange={(event) => setAnalysisPrompt(event.target.value)}
							placeholder="Optional: tell Roo what visual issue to focus on."
						/>
					</label>
				</div>

				<aside className="grid content-start gap-3">
					<section className="rounded border border-vscode-panel-border bg-vscode-sideBar-background p-3">
						<h3 className="m-0 mb-2 text-base font-semibold">Saved crops</h3>
						{panelState.crops.length === 0 ? (
							<p className="m-0 text-sm text-vscode-descriptionForeground">No crops saved yet.</p>
						) : (
							<div className="grid gap-2">
								{panelState.crops.map((crop) => (
									<button
										key={crop.cropId}
										className={`grid gap-1 rounded border p-2 text-left text-sm ${crop.cropId === currentCrop?.cropId ? "border-vscode-focusBorder" : "border-vscode-panel-border"}`}
										type="button"
										onClick={() => setSelectedCropId(crop.cropId)}>
										{crop.webviewUri && (
											<img
												src={crop.webviewUri}
												alt={`Crop ${crop.cropId}`}
												className="max-h-32 rounded"
											/>
										)}
										<span className="font-medium">{crop.cropId}</span>
										<span className="text-vscode-descriptionForeground">
											{formatBox(crop.region)} px
										</span>
									</button>
								))}
							</div>
						)}
					</section>

					<section className="rounded border border-vscode-panel-border bg-vscode-sideBar-background p-3">
						<h3 className="m-0 mb-2 text-base font-semibold">Inspected elements</h3>
						{panelState.inspections.length === 0 ? (
							<p className="m-0 text-sm text-vscode-descriptionForeground">No element inspections yet.</p>
						) : (
							<div className="grid gap-2">
								{[...panelState.inspections].reverse().map((inspection, index) => (
									<div
										key={`${inspection.screenshotId ?? inspection.cropId ?? "inspection"}-${index}`}
										className="rounded border border-vscode-panel-border p-2 text-sm">
										{inspection.element && (
											<div className="grid gap-1">
												<strong>{elementLabel(inspection.element)}</strong>
												<code className="break-all rounded bg-vscode-textCodeBlock-background px-1 py-0.5 text-xs">
													{inspection.element.selector}
												</code>
												<span className="text-vscode-descriptionForeground">
													{formatBox(inspection.element.boundingBox)} px
												</span>
											</div>
										)}
										{inspection.elements && (
											<ul className="m-0 grid list-none gap-1 p-0">
												{inspection.elements.slice(0, 8).map((element) => (
													<li key={element.selector} className="grid gap-0.5">
														<span>{elementLabel(element)}</span>
														<code className="break-all text-xs text-vscode-descriptionForeground">
															{element.selector}
														</code>
													</li>
												))}
											</ul>
										)}
									</div>
								))}
							</div>
						)}
					</section>
				</aside>
			</section>

			<section className="rounded border border-vscode-panel-border bg-vscode-sideBar-background p-3">
				<h3 className="m-0 mb-2 text-base font-semibold">Findings</h3>
				{panelState.findings.length === 0 ? (
					<p className="m-0 text-sm text-vscode-descriptionForeground">No analysis findings yet.</p>
				) : (
					<div className="grid gap-3">
						{panelState.findings.map((finding, findingIndex) => (
							<article
								key={`${finding.summary}-${findingIndex}`}
								className="rounded border border-vscode-panel-border p-3">
								<p className="mt-0 text-sm">{finding.summary}</p>
								<div className="grid gap-2">
									{finding.issues.map((issue, issueIndex) => (
										<div
											key={`${issue.title}-${issueIndex}`}
											className={`rounded border p-2 text-sm ${severityClassName(issue.severity)}`}>
											<div className="flex flex-wrap items-center gap-2">
												<strong>{issue.title}</strong>
												<span className="text-xs uppercase">{issue.severity}</span>
												<span className="text-xs">
													confidence {Math.round(issue.confidence * 100)}%
												</span>
											</div>
											<p>{issue.visualEvidence}</p>
											<p className="text-vscode-descriptionForeground">
												Likely cause: {issue.likelyCause}
											</p>
											<p className="text-vscode-descriptionForeground">
												Suggested fix: {issue.suggestedFix}
											</p>
											<code className="break-all text-xs">{issue.selectorOrElement}</code>
											{issue.filesToInspect.length > 0 && (
												<p className="mb-0 text-xs text-vscode-descriptionForeground">
													Files to inspect: {issue.filesToInspect.join(", ")}
												</p>
											)}
										</div>
									))}
								</div>
							</article>
						))}
					</div>
				)}
			</section>
		</div>
	)
}

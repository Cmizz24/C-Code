import type OpenAI from "openai"

const VISUAL_BROWSER_INSPECTOR_DESCRIPTION = `Control and inspect a Playwright Chromium browser page that Roo opens explicitly for Visual Browser Inspector work. This tool captures only the controlled browser page, never the desktop or VS Code. Screenshots, crops, metadata, inspections, and heuristic findings are stored locally under .roo/visual-browser-inspector/<session-id>/.

Use this tool for visual UI inspection, local screenshots, DOM inspection, crop metadata, and local MVP visual-analysis heuristics. Do not use this as a substitute for generate_image when the user asks to generate or edit an image; use image_generation routing instead unless the user explicitly asks to operate or inspect a browser/web app. Non-local/private URLs are blocked unless allowExternal is true.`

export default {
	type: "function",
	function: {
		name: "visual_browser_inspector",
		description: VISUAL_BROWSER_INSPECTOR_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					description: "Visual Browser Inspector action to perform.",
					enum: [
						"visual_browser_open",
						"visual_browser_reload",
						"visual_browser_back",
						"visual_browser_forward",
						"visual_browser_capture",
						"visual_browser_crop",
						"visual_browser_inspect_point",
						"visual_browser_inspect_region",
						"visual_browser_click",
						"visual_browser_hover",
						"visual_browser_type",
						"visual_browser_scroll",
						"visual_browser_analyze_screenshot",
						"visual_browser_analyze_crop",
						"visual_browser_close",
						"visual_browser_delete_session",
					],
				},
				url: { type: ["string", "null"], description: "URL for visual_browser_open." },
				sessionId: {
					type: ["string", "null"],
					description: "Existing session id. Null uses the current session.",
				},
				screenshotId: {
					type: ["string", "null"],
					description: "Screenshot id for crop, inspection, or analysis.",
				},
				cropId: { type: ["string", "null"], description: "Crop id for crop analysis." },
				viewport: {
					anyOf: [
						{ type: "string", enum: ["mobile", "tablet", "desktop"] },
						{
							type: "object",
							properties: {
								name: { type: "string" },
								width: { type: "number" },
								height: { type: "number" },
								deviceScaleFactor: { type: ["number", "null"] },
								isMobile: { type: ["boolean", "null"] },
								hasTouch: { type: ["boolean", "null"] },
							},
							required: ["name", "width", "height", "deviceScaleFactor", "isMobile", "hasTouch"],
							additionalProperties: false,
						},
						{ type: "null" },
					],
					description:
						"Viewport preset or custom viewport for visual_browser_open. Defaults to mobile 390x844.",
				},
				headless: {
					type: ["boolean", "null"],
					description: "Whether to launch Chromium headless. Default is false.",
				},
				allowExternal: {
					type: ["boolean", "null"],
					description: "Set true only after explicit user confirmation to allow non-local URLs.",
				},
				selector: { type: ["string", "null"], description: "CSS selector for click, hover, or type actions." },
				x: { type: ["number", "null"], description: "X coordinate for point/click/hover actions." },
				y: { type: ["number", "null"], description: "Y coordinate for point/click/hover actions." },
				region: {
					anyOf: [
						{
							type: "object",
							properties: {
								x: { type: "number" },
								y: { type: "number" },
								width: { type: "number" },
								height: { type: "number" },
							},
							required: ["x", "y", "width", "height"],
							additionalProperties: false,
						},
						{ type: "null" },
					],
					description: "Screenshot-pixel region for crop, region inspection, or crop analysis.",
				},
				fullPage: { type: ["boolean", "null"], description: "Capture a full-page screenshot when true." },
				deltaX: { type: ["number", "null"], description: "Horizontal scroll delta for visual_browser_scroll." },
				deltaY: { type: ["number", "null"], description: "Vertical scroll delta for visual_browser_scroll." },
				text: { type: ["string", "null"], description: "Text to type into focused or selected element." },
				prompt: {
					type: ["string", "null"],
					description:
						"Optional analysis prompt. MVP analysis uses local heuristics unless a separate model pipeline is explicitly integrated.",
				},
			},
			required: [
				"action",
				"url",
				"sessionId",
				"screenshotId",
				"cropId",
				"viewport",
				"headless",
				"allowExternal",
				"selector",
				"x",
				"y",
				"region",
				"fullPage",
				"deltaX",
				"deltaY",
				"text",
				"prompt",
			],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool

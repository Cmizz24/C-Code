import type { ModelInfo } from "../model.js"

const XAI_GROK_43_BASE_INFO = {
	contextWindow: 1_000_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 1.25,
	outputPrice: 2.5,
	cacheReadsPrice: 0.2,
	includedTools: ["search_replace"],
	excludedTools: ["apply_diff"],
} satisfies ModelInfo

const XAI_GROK_BUILD_INFO = {
	contextWindow: 256_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 1,
	outputPrice: 2,
	cacheReadsPrice: 0.2,
	description: "xAI's Grok Build 0.1 early-access coding model with 256K context window",
	includedTools: ["search_replace"],
	excludedTools: ["apply_diff"],
} satisfies ModelInfo

// https://docs.x.ai/developers/models
// https://docs.x.ai/developers/rest-api-reference/inference/models
export type XAIModelId = keyof typeof xaiModels

export const xaiDefaultModelId: XAIModelId = "grok-4.3"

export const xaiModels = {
	"grok-4.3": {
		...XAI_GROK_43_BASE_INFO,
		supportsReasoningEffort: ["none", "low", "medium", "high"],
		reasoningEffort: "low",
		description: "xAI's recommended Grok 4.3 model with 1M context and reasoning support via Responses API.",
	},
	"grok-build-0.1": {
		...XAI_GROK_BUILD_INFO,
	},
	"grok-4.3-latest": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description: "xAI's Grok 4.3 latest alias retained for existing profiles; use grok-4.3 for stable profiles.",
	},
	"grok-latest": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description: "xAI's latest Grok alias retained for existing profiles; use grok-4.3 for stable profiles.",
	},
	"grok-4.20-0309-reasoning": {
		...XAI_GROK_43_BASE_INFO,
		description: "xAI's Grok 4.20 reasoning model with 1M context and agentic tool calling capabilities.",
	},
	"grok-4.20-0309-non-reasoning": {
		...XAI_GROK_43_BASE_INFO,
		description: "xAI's Grok 4.20 non-reasoning model with 1M context and agentic tool calling capabilities.",
	},
	"grok-4.20-multi-agent-0309": {
		...XAI_GROK_43_BASE_INFO,
		description: "xAI's Grok 4.20 multi-agent model with 1M context and agentic tool calling capabilities.",
	},
	"grok-4.20": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description:
			"xAI's Grok 4.20 alias retained for existing profiles; use Grok 4.3 or a dated Grok 4.20 model ID for new profiles.",
	},
	"grok-4.20-reasoning": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description:
			"xAI's Grok 4.20 reasoning alias retained for existing profiles; use grok-4.20-0309-reasoning for pinned profiles.",
	},
	"grok-4.20-0309": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description:
			"xAI's Grok 4.20 dated alias retained for existing profiles; use grok-4.20-0309-reasoning or grok-4.20-0309-non-reasoning for explicit behavior.",
	},
	"grok-code-fast-1": {
		...XAI_GROK_BUILD_INFO,
		deprecated: true,
		description:
			"xAI's Grok Code Fast alias for Grok Build 0.1 retained for existing profiles; use grok-build-0.1 for new profiles.",
	},
	"grok-code-fast": {
		...XAI_GROK_BUILD_INFO,
		deprecated: true,
		description:
			"xAI's Grok Code Fast alias for Grok Build 0.1 retained for existing profiles; use grok-build-0.1 for new profiles.",
	},
	"grok-code-fast-1-0825": {
		...XAI_GROK_BUILD_INFO,
		deprecated: true,
		description:
			"xAI's pinned Grok Code Fast alias retained for existing profiles; use grok-build-0.1 for new profiles.",
	},
	"grok-4-1-fast-reasoning": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description:
			"xAI's Grok 4.1 Fast reasoning alias retained for existing profiles; current docs alias it to Grok 4.3.",
	},
	"grok-4-1-fast": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description: "xAI's Grok 4.1 Fast alias retained for existing profiles; current docs alias it to Grok 4.3.",
	},
	"grok-4-1-fast-non-reasoning": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description:
			"xAI's Grok 4.1 Fast non-reasoning alias retained for existing profiles; current docs alias it to Grok 4.3.",
	},
	"grok-4-fast-reasoning": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description:
			"xAI's Grok 4 Fast reasoning alias retained for existing profiles; current docs alias it to Grok 4.3.",
	},
	"grok-4-fast": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description: "xAI's Grok 4 Fast alias retained for existing profiles; current docs alias it to Grok 4.3.",
	},
	"grok-4-fast-non-reasoning": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description:
			"xAI's Grok 4 Fast non-reasoning alias retained for existing profiles; current docs alias it to Grok 4.3.",
	},
	"grok-4-0709": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description: "xAI's Grok 4 0709 alias retained for existing profiles; current docs alias it to Grok 4.3.",
	},
	"grok-4": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description: "xAI's Grok 4 alias retained for existing profiles; current docs alias it to Grok 4.3.",
	},
	"grok-4-latest": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description: "xAI's Grok 4 latest alias retained for existing profiles; current docs alias it to Grok 4.3.",
	},
	"grok-3-mini": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description: "xAI's Grok 3 mini alias retained for existing profiles; current docs alias it to Grok 4.3.",
	},
	"grok-3": {
		...XAI_GROK_43_BASE_INFO,
		deprecated: true,
		description: "xAI's Grok 3 alias retained for existing profiles; current docs alias it to Grok 4.3.",
	},
} as const satisfies Record<string, ModelInfo>

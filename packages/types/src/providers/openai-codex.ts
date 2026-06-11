import { z } from "zod"

import { serviceTierSchema, type ModelInfo } from "../model.js"

/**
 * OpenAI Codex Provider
 *
 * This provider uses OAuth authentication via ChatGPT Plus/Pro subscription
 * instead of direct API keys. Requests are routed to the Codex backend at
 * https://chatgpt.com/backend-api/codex/responses
 *
 * Key differences from openai-native:
 * - Uses OAuth Bearer tokens instead of API keys
 * - Subscription-based pricing (no per-token costs)
 * - Limited model subset available
 * - Custom routing to Codex backend
 */

export type OpenAiCodexModelId = keyof typeof openAiCodexModels

export const openAiCodexDefaultModelId: OpenAiCodexModelId = "gpt-5.5"

export const openAiCodexFastStatusStates = ["off", "unsupported", "requested", "confirmed", "rejected"] as const

export const openAiCodexFastStatusStateSchema = z.enum(openAiCodexFastStatusStates)

export const openAiCodexFastStatusSchema = z.object({
	state: openAiCodexFastStatusStateSchema,
	modelId: z.string().optional(),
	requestedServiceTier: serviceTierSchema.optional(),
	observedServiceTier: serviceTierSchema.optional(),
	error: z.string().optional(),
	updatedAt: z.number().optional(),
})

export type OpenAiCodexFastStatus = z.infer<typeof openAiCodexFastStatusSchema>

/**
 * Models available through the Codex OAuth flow.
 * These models are accessible to ChatGPT Plus/Pro subscribers.
 * Costs are 0 as they are covered by the subscription.
 * The ChatGPT/Codex backend does not expose a stable public model-list endpoint,
 * so this provider intentionally uses curated static metadata instead of dynamic auto-update.
 * Deprecated entries are retained only to recognize existing user configuration
 * and must not be offered as new ChatGPT sign-in selections.
 */
export const openAiCodexModels = {
	"gpt-5.1-codex-max": {
		maxTokens: 128000,
		contextWindow: 400000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high", "xhigh"],
		reasoningEffort: "xhigh",
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		deprecated: true,
		description: "GPT-5.1 Codex Max: Deprecated legacy Codex model ID via ChatGPT subscription",
	},
	"gpt-5.1-codex": {
		maxTokens: 128000,
		contextWindow: 400000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "medium",
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		deprecated: true,
		description: "GPT-5.1 Codex: Deprecated legacy Codex model ID via ChatGPT subscription",
	},
	"gpt-5.3-codex": {
		maxTokens: 128000,
		contextWindow: 400000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high", "xhigh"],
		reasoningEffort: "medium",
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		deprecated: true,
		description: "GPT-5.3 Codex: Deprecated coding model via ChatGPT subscription",
	},
	"gpt-5.3-codex-spark": {
		maxTokens: 8192,
		contextWindow: 128000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high", "xhigh"],
		reasoningEffort: "medium",
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		description: "GPT-5.3 Codex Spark: Pro-only research preview, text-only coding model via ChatGPT subscription",
	},
	"gpt-5.2-codex": {
		maxTokens: 128000,
		contextWindow: 400000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high", "xhigh"],
		reasoningEffort: "medium",
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		deprecated: true,
		description: "GPT-5.2 Codex: Deprecated legacy Codex model ID via ChatGPT subscription",
	},
	"gpt-5.1": {
		maxTokens: 128000,
		contextWindow: 400000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["none", "low", "medium", "high"],
		reasoningEffort: "none",
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		supportsVerbosity: true,
		supportsTemperature: false,
		deprecated: true,
		description: "GPT-5.1: Deprecated legacy GPT model ID via ChatGPT subscription",
	},
	"gpt-5": {
		maxTokens: 128000,
		contextWindow: 400000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["minimal", "low", "medium", "high"],
		reasoningEffort: "medium",
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		supportsVerbosity: true,
		supportsTemperature: false,
		deprecated: true,
		description: "GPT-5: Deprecated legacy GPT model ID via ChatGPT subscription",
	},
	"gpt-5-codex": {
		maxTokens: 128000,
		contextWindow: 400000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "medium",
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		deprecated: true,
		description: "GPT-5 Codex: Deprecated legacy Codex model ID via ChatGPT subscription",
	},
	"gpt-5-codex-mini": {
		maxTokens: 128000,
		contextWindow: 400000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "medium",
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		deprecated: true,
		description: "GPT-5 Codex Mini: Deprecated legacy Codex model ID via ChatGPT subscription",
	},
	"gpt-5.1-codex-mini": {
		maxTokens: 128000,
		contextWindow: 400000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "medium",
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		deprecated: true,
		description: "GPT-5.1 Codex Mini: Deprecated legacy Codex model ID via ChatGPT subscription",
	},
	"gpt-5.5": {
		maxTokens: 128000,
		contextWindow: 400000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh"],
		reasoningEffort: "medium",
		inputPrice: 0,
		outputPrice: 0,
		supportsVerbosity: true,
		supportsFastMode: true,
		supportsTemperature: false,
		description: "GPT-5.5: Most capable model via ChatGPT subscription",
	},
	"gpt-5.4": {
		maxTokens: 128000,
		contextWindow: 200000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh"],
		reasoningEffort: "none",
		inputPrice: 0,
		outputPrice: 0,
		supportsVerbosity: true,
		supportsFastMode: true,
		supportsTemperature: false,
		description: "GPT-5.4: Formerly most capable model via ChatGPT subscription",
	},
	"gpt-5.4-mini": {
		maxTokens: 128000,
		contextWindow: 400000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh"],
		reasoningEffort: "none",
		inputPrice: 0,
		outputPrice: 0,
		supportsVerbosity: true,
		supportsTemperature: false,
		description: "GPT-5.4 Mini: Lower-cost GPT-5.4 model via ChatGPT subscription",
	},
	"gpt-5.2": {
		maxTokens: 128000,
		contextWindow: 400000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh"],
		reasoningEffort: "none",
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		deprecated: true,
		description: "GPT-5.2: Deprecated GPT model via ChatGPT subscription",
	},
} as const satisfies Record<string, ModelInfo>

export const openAiCodexSelectableModelIds = [
	"gpt-5.5",
	"gpt-5.4",
	"gpt-5.4-mini",
	"gpt-5.3-codex-spark",
] as const satisfies readonly OpenAiCodexModelId[]

export const isOpenAiCodexSelectableModelId = (modelId: string | undefined): modelId is OpenAiCodexModelId =>
	!!modelId &&
	(openAiCodexSelectableModelIds as readonly string[]).includes(modelId) &&
	(openAiCodexModels[modelId as OpenAiCodexModelId] as ModelInfo).deprecated !== true

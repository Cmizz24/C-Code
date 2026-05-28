import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	deepSeekModels,
	deepSeekDefaultModelId,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	OPENAI_AZURE_AI_INFERENCE_PATH,
	type ModelInfo,
	type ReasoningEffortExtended,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { convertToR1Format } from "../transform/r1-format"

import { OpenAiHandler } from "./openai"
import type { ApiHandlerCreateMessageMetadata } from "../index"

// Custom interface for DeepSeek params to support thinking mode and native effort values.
type DeepSeekChatCompletionParams = Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, "reasoning_effort"> & {
	thinking?: { type: "enabled" | "disabled" }
	reasoning_effort?: "high" | "max"
}

const CURRENT_DEEP_SEEK_MODEL_IDS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"])

function isCurrentDeepSeekModel(modelId: string): boolean {
	return CURRENT_DEEP_SEEK_MODEL_IDS.has(modelId)
}

function isLegacyDeepSeekReasoner(modelId: string): boolean {
	return modelId === "deepseek-reasoner"
}

function isLegacyDeepSeekChat(modelId: string): boolean {
	return modelId === "deepseek-chat"
}

function toDeepSeekReasoningEffort(effort?: ReasoningEffortExtended | "disable" | "max"): "high" | "max" | undefined {
	switch (effort) {
		case "high":
		case "low":
		case "medium":
			return "high"
		case "xhigh":
		case "max":
			return "max"
		default:
			return undefined
	}
}

export class DeepSeekHandler extends OpenAiHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			openAiApiKey: options.deepSeekApiKey ?? "not-provided",
			openAiModelId: options.apiModelId ?? deepSeekDefaultModelId,
			openAiBaseUrl: options.deepSeekBaseUrl || "https://api.deepseek.com",
			openAiStreamingEnabled: true,
			includeMaxTokens: true,
		})
	}

	override getModel() {
		const id = this.options.apiModelId ?? deepSeekDefaultModelId
		const info = deepSeekModels[id as keyof typeof deepSeekModels] || deepSeekModels[deepSeekDefaultModelId]
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: DEEP_SEEK_DEFAULT_TEMPERATURE,
		})
		return { id, info, ...params }
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const modelId = this.options.apiModelId ?? deepSeekDefaultModelId
		const { info: modelInfo, temperature, reasoningEffort } = this.getModel()

		const supportsThinkingToggle = isCurrentDeepSeekModel(modelId)
		const isThinkingModel = this.shouldUseThinkingMode(modelId, modelInfo)
		const deepSeekReasoningEffort = isThinkingModel
			? toDeepSeekReasoningEffort(
					(this.options.reasoningEffort as ReasoningEffortExtended | "disable" | undefined) ??
						reasoningEffort ??
						modelInfo.reasoningEffort,
				)
			: undefined

		// Convert messages to R1 format (merges consecutive same-role messages)
		// This is required for DeepSeek which does not support successive messages with the same role
		// For thinking models, enable mergeToolResultText to preserve reasoning_content
		// during tool call sequences. Without this, environment_details text after tool_results would
		// create user messages that cause DeepSeek to drop all previous reasoning_content.
		// See: https://api-docs.deepseek.com/guides/thinking_mode
		const convertedMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages], {
			mergeToolResultText: isThinkingModel,
		})

		const requestOptions: DeepSeekChatCompletionParams = {
			model: modelId,
			...(isThinkingModel ? {} : { temperature }),
			messages: convertedMessages,
			stream: true as const,
			stream_options: { include_usage: true },
			...(supportsThinkingToggle || isLegacyDeepSeekReasoner(modelId)
				? { thinking: { type: isThinkingModel ? "enabled" : "disabled" } }
				: {}),
			...(deepSeekReasoningEffort ? { reasoning_effort: deepSeekReasoningEffort } : {}),
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
			parallel_tool_calls: metadata?.parallelToolCalls ?? true,
		}

		this.addDeepSeekMaxTokensIfNeeded(requestOptions, modelInfo)

		// Check if base URL is Azure AI Inference (for DeepSeek via Azure)
		const isAzureAiInference = this._isAzureAiInference(this.options.deepSeekBaseUrl)

		let stream
		try {
			stream = await this.client.chat.completions.create(
				requestOptions as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
				isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
			)
		} catch (error) {
			const { handleOpenAIError } = await import("./utils/openai-error-handler")
			throw handleOpenAIError(error, "DeepSeek")
		}

		let lastUsage

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta ?? {}

			// Handle regular text content
			if (delta.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Handle reasoning_content from DeepSeek's interleaved thinking
			// This is the proper way DeepSeek sends thinking content in streaming
			if ("reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					text: (delta.reasoning_content as string) || "",
				}
			}

			// Handle tool calls
			if (delta.tool_calls) {
				for (const toolCall of delta.tool_calls) {
					yield {
						type: "tool_call_partial",
						index: toolCall.index,
						id: toolCall.id,
						name: toolCall.function?.name,
						arguments: toolCall.function?.arguments,
					}
				}
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			yield this.processUsageMetrics(lastUsage, modelInfo)
		}
	}

	private shouldUseThinkingMode(modelId: string, modelInfo: ModelInfo): boolean {
		if (isLegacyDeepSeekReasoner(modelId)) {
			return true
		}

		if (isLegacyDeepSeekChat(modelId)) {
			return false
		}

		if (!isCurrentDeepSeekModel(modelId)) {
			return false
		}

		if (this.options.enableReasoningEffort === false) {
			return false
		}

		if (["disable", "none", "minimal"].includes(this.options.reasoningEffort ?? "")) {
			return false
		}

		return !!modelInfo.supportsReasoningEffort
	}

	private addDeepSeekMaxTokensIfNeeded(requestOptions: DeepSeekChatCompletionParams, modelInfo: ModelInfo): void {
		if (this.options.includeMaxTokens === true) {
			requestOptions.max_tokens = this.options.modelMaxTokens || modelInfo.maxTokens || undefined
		}
	}

	// Override to handle DeepSeek's usage metrics, including caching.
	protected override processUsageMetrics(usage: any, _modelInfo?: any): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
			cacheWriteTokens: usage?.prompt_cache_miss_tokens ?? usage?.prompt_tokens_details?.cache_miss_tokens,
			cacheReadTokens: usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens,
			reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens,
		}
	}
}

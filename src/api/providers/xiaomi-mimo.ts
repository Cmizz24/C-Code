import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type ModelInfo, xiaomiMiMoDefaultModelId, xiaomiMiMoModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { TagMatcher } from "../../utils/tag-matcher"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import type { ApiHandlerCreateMessageMetadata } from "../index"

import { OpenAiHandler } from "./openai"

type XiaomiMiMoThinking = {
	type: "enabled" | "disabled"
}

type XiaomiMiMoChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParamsStreaming & {
	thinking: XiaomiMiMoThinking
}

export class XiaomiMiMoHandler extends OpenAiHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			openAiApiKey: options.xiaomiMiMoApiKey ?? "not-provided",
			openAiModelId: options.apiModelId ?? xiaomiMiMoDefaultModelId,
			openAiBaseUrl: options.xiaomiMiMoBaseUrl || "https://api.xiaomimimo.com/v1",
			openAiStreamingEnabled: true,
			includeMaxTokens: true,
		})
	}

	override getModel() {
		const id = this.options.apiModelId ?? xiaomiMiMoDefaultModelId
		const info = xiaomiMiMoModels[id as keyof typeof xiaomiMiMoModels] ?? xiaomiMiMoModels[xiaomiMiMoDefaultModelId]
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})

		return { id, info, ...params }
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: modelId, info: modelInfo, temperature } = this.getModel()
		const requestOptions: XiaomiMiMoChatCompletionParams = {
			model: modelId,
			temperature,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true as const,
			stream_options: { include_usage: true },
			thinking: { type: this.options.enableReasoningEffort ? "enabled" : "disabled" },
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
			parallel_tool_calls: metadata?.parallelToolCalls ?? true,
		}

		this.addMaxTokensIfNeeded(requestOptions, modelInfo)

		const stream = await this.client.chat.completions.create(requestOptions)
		const matcher = new TagMatcher(
			"think",
			(chunk) =>
				({
					type: chunk.matched ? "reasoning" : "text",
					text: chunk.data,
				}) as const,
		)

		let lastUsage
		const activeToolCallIds = new Set<string>()

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta ?? {}
			const finishReason = chunk.choices?.[0]?.finish_reason

			if (delta.content) {
				for (const matchedChunk of matcher.update(delta.content)) {
					yield matchedChunk
				}
			}

			if ("reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					text: (delta.reasoning_content as string | undefined) || "",
				}
			}

			for (const toolCall of delta.tool_calls ?? []) {
				if (toolCall.id) {
					activeToolCallIds.add(toolCall.id)
				}

				yield {
					type: "tool_call_partial",
					index: toolCall.index,
					id: toolCall.id,
					name: toolCall.function?.name,
					arguments: toolCall.function?.arguments,
				}
			}

			if (finishReason === "tool_calls" && activeToolCallIds.size > 0) {
				for (const id of activeToolCallIds) {
					yield { type: "tool_call_end", id }
				}
				activeToolCallIds.clear()
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		for (const matchedChunk of matcher.final()) {
			yield matchedChunk
		}

		if (lastUsage) {
			yield this.processUsageMetrics(lastUsage, modelInfo)
		}
	}

	protected override processUsageMetrics(usage: any, _modelInfo?: ModelInfo): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
			cacheWriteTokens: usage?.cache_creation_input_tokens || undefined,
			cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? usage?.cache_read_input_tokens,
			reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens,
		}
	}
}

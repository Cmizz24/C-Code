import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type BasetenModelId, basetenDefaultModelId, basetenModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import type { ApiHandlerCreateMessageMetadata } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { getModelParams } from "../transform/model-params"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"
import { handleOpenAIError } from "./utils/openai-error-handler"

type BasetenChatCompletionParamsStreaming = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
	reasoning_effort?: OpenAI.Chat.ChatCompletionCreateParams["reasoning_effort"]
	thinking?: { type: "enabled" }
}

type BasetenChatCompletionParams = OpenAI.Chat.Completions.ChatCompletionCreateParams & {
	reasoning_effort?: OpenAI.Chat.ChatCompletionCreateParams["reasoning_effort"]
	thinking?: { type: "enabled" }
}

export class BasetenHandler extends BaseOpenAiCompatibleProvider<BasetenModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Baseten",
			baseURL: "https://inference.baseten.co/v1",
			apiKey: options.basetenApiKey,
			defaultProviderModelId: basetenDefaultModelId,
			providerModels: basetenModels,
			defaultTemperature: 0.5,
		})
	}

	protected override createStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
		requestOptions?: OpenAI.RequestOptions,
	) {
		const { id: model, info } = this.getModel()
		const modelParams = getModelParams({
			format: "openai",
			modelId: model,
			model: info,
			settings: this.options,
			defaultTemperature: this.defaultTemperature,
		})

		const params: BasetenChatCompletionParamsStreaming = {
			model,
			max_tokens: modelParams.maxTokens ?? undefined,
			temperature: modelParams.temperature,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
			parallel_tool_calls: metadata?.parallelToolCalls ?? true,
		}

		if (modelParams.reasoning?.reasoning_effort) {
			params.reasoning_effort = modelParams.reasoning.reasoning_effort
		}

		if (this.options.enableReasoningEffort && info.supportsReasoningBinary) {
			params.thinking = { type: "enabled" }
		}

		try {
			return this.client.chat.completions.create(params, requestOptions)
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}
	}

	override async completePrompt(prompt: string): Promise<string> {
		const { id: modelId, info: modelInfo } = this.getModel()
		const modelParams = getModelParams({
			format: "openai",
			modelId,
			model: modelInfo,
			settings: this.options,
			defaultTemperature: this.defaultTemperature,
		})

		const params: BasetenChatCompletionParams = {
			model: modelId,
			messages: [{ role: "user", content: prompt }],
		}

		if (modelParams.reasoning?.reasoning_effort) {
			params.reasoning_effort = modelParams.reasoning.reasoning_effort
		}

		if (this.options.enableReasoningEffort && modelInfo.supportsReasoningBinary) {
			params.thinking = { type: "enabled" }
		}

		try {
			const response = await this.client.chat.completions.create(params)

			const responseAny = response as any
			if (responseAny.base_resp?.status_code && responseAny.base_resp.status_code !== 0) {
				throw new Error(
					`${this.providerName} API Error (${responseAny.base_resp.status_code}): ${responseAny.base_resp.status_msg || "Unknown error"}`,
				)
			}

			return response.choices?.[0]?.message.content || ""
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}
	}
}

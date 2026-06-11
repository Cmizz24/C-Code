import type { ModelInfo } from "../model.js"
import type { ZaiApiLine } from "../provider-settings.js"

// Z.ai / GLM
// https://docs.z.ai/guides/overview/pricing
// https://docs.bigmodel.cn/cn/guide/models/text/glm-5.1
// https://docs.bigmodel.cn/cn/guide/models/text/glm-5-turbo
// https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5v-turbo
// https://docs.z.ai/guides/llm/glm-4.5
// https://docs.z.ai/guides/llm/glm-4.6

const glmThinking = {
	supportsReasoningEffort: ["disable", "medium"],
	reasoningEffort: "medium",
	preserveReasoning: true,
} satisfies Pick<ModelInfo, "supportsReasoningEffort" | "reasoningEffort" | "preserveReasoning">

export type InternationalZAiModelId = keyof typeof internationalZAiModels
export const internationalZAiDefaultModelId: InternationalZAiModelId = "glm-4.6"
export const internationalZAiModels = {
	"glm-5.1": {
		maxTokens: 131_072,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 1.4,
		outputPrice: 4.4,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.26,
		description:
			"GLM-5.1 is Z.ai's flagship text model with a 200k context window, 128k output support, and built-in thinking capabilities for complex reasoning, coding, and agentic tasks.",
	},
	"glm-5": {
		maxTokens: 131_072,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 1.0,
		outputPrice: 3.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.2,
		description:
			"GLM-5 is Z.ai's next-generation model with a 200k context window, 128k output support, and built-in thinking capabilities for reasoning, coding, and agentic performance.",
	},
	"glm-5-turbo": {
		maxTokens: 131_072,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 1.2,
		outputPrice: 4.0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.24,
		description:
			"GLM-5-Turbo is a high-throughput GLM-5 variant with a 200k context window, 128k output support, and built-in thinking capabilities.",
	},
	"glm-5v-turbo": {
		maxTokens: 131_072,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 1.2,
		outputPrice: 4.0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.24,
		description:
			"GLM-5V-Turbo is Z.ai's multimodal model for image, video, file, and text inputs with 200k context, 128k output support, and deep thinking capabilities.",
	},
	"glm-4.7": {
		maxTokens: 131_072,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.11,
		description:
			"GLM-4.7 is a long-context GLM model with built-in thinking capabilities enabled by default for enhanced reasoning on complex tasks.",
	},
	"glm-4.7-flash": {
		maxTokens: 16_384,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		isFree: true,
		description:
			"GLM-4.7-Flash is a free, high-speed variant of GLM-4.7 offering fast responses for reasoning and coding tasks.",
	},
	"glm-4.7-flashx": {
		maxTokens: 16_384,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.07,
		outputPrice: 0.4,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.01,
		description:
			"GLM-4.7-FlashX is an ultra-fast GLM-4.7 variant with cost-effective pricing for high-throughput applications.",
	},
	"glm-4.6": {
		maxTokens: 131_072,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.11,
		description:
			"GLM-4.6 is a long-context GLM model with up to 200k context and 128k output support for longer documents and conversations.",
	},
	"glm-4.6v": {
		maxTokens: 32_768,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.3,
		outputPrice: 0.9,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.05,
		description:
			"GLM-4.6V is an advanced multimodal vision model with improved performance and cost-efficiency for visual understanding tasks.",
	},
	"glm-4.6v-flash": {
		maxTokens: 32_768,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		isFree: true,
		description:
			"GLM-4.6V-Flash is a free, high-speed multimodal vision model for rapid image understanding and visual reasoning tasks.",
	},
	"glm-4.6v-flashx": {
		maxTokens: 32_768,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.04,
		outputPrice: 0.4,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.004,
		description:
			"GLM-4.6V-FlashX is an ultra-fast multimodal vision model optimized for high-speed visual processing at low cost.",
	},
	"glm-4.5": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.11,
		description:
			"GLM-4.5 is a featured GLM model for reasoning, coding, and agentic tasks with a 128k context window and hybrid thinking support.",
	},
	"glm-4.5-air": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0.2,
		outputPrice: 1.1,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.03,
		description:
			"GLM-4.5-Air is the lightweight version of GLM-4.5, balancing performance and cost with hybrid thinking support.",
	},
	"glm-4.5-x": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 2.2,
		outputPrice: 8.9,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.45,
		description:
			"GLM-4.5-X is a high-performance GLM-4.5 variant optimized for strong reasoning with fast responses.",
	},
	"glm-4.5-airx": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 1.1,
		outputPrice: 4.5,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.22,
		description: "GLM-4.5-AirX is a lightweight, ultra-fast GLM-4.5 variant delivering strong performance.",
	},
	"glm-4.5-flash": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		isFree: true,
		description: "GLM-4.5-Flash is a free, high-speed model for reasoning, coding, and agentic tasks.",
	},
	"glm-4.5v": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.6,
		outputPrice: 1.8,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.11,
		description:
			"GLM-4.5V is Z.ai's multimodal visual reasoning model for image, video, text, and file input, optimized for GUI tasks, grounding, and document/video understanding.",
	},
	"glm-4-32b-0414-128k": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.1,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "GLM-4-32B is a 32 billion parameter model with 128k context length, optimized for efficiency.",
	},
} as const satisfies Record<string, ModelInfo>

export type MainlandZAiModelId = keyof typeof mainlandZAiModels
export const mainlandZAiDefaultModelId: MainlandZAiModelId = "glm-4.6"
export const mainlandZAiModels = {
	"glm-5.1": {
		maxTokens: 131_072,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		description:
			"GLM-5.1 is Z.ai's flagship text model with a 200k context window, 128k output support, and built-in thinking capabilities for complex reasoning, coding, and agentic tasks.",
	},
	"glm-5": {
		maxTokens: 131_072,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0.29,
		outputPrice: 1.14,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-5 is Z.ai's next-generation model with a 200k context window, 128k output support, and built-in thinking capabilities for reasoning, coding, and agentic performance.",
	},
	"glm-5-turbo": {
		maxTokens: 131_072,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		description:
			"GLM-5-Turbo is a high-throughput GLM-5 variant with a 200k context window, 128k output support, and built-in thinking capabilities.",
	},
	"glm-5v-turbo": {
		maxTokens: 131_072,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		...glmThinking,
		description:
			"GLM-5V-Turbo is Z.ai's multimodal model for image, video, file, and text inputs with 200k context, 128k output support, and deep thinking capabilities.",
	},
	"glm-4.7": {
		maxTokens: 131_072,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0.29,
		outputPrice: 1.14,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.7 is a long-context GLM model with built-in thinking capabilities enabled by default for enhanced reasoning on complex tasks.",
	},
	"glm-4.7-flash": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		isFree: true,
		description:
			"GLM-4.7-Flash is a free, high-speed variant of GLM-4.7 offering fast responses for reasoning and coding tasks.",
	},
	"glm-4.7-flashx": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.035,
		outputPrice: 0.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.005,
		description:
			"GLM-4.7-FlashX is an ultra-fast GLM-4.7 variant with cost-effective pricing for high-throughput applications.",
	},
	"glm-4.6": {
		maxTokens: 131_072,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0.29,
		outputPrice: 1.14,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.6 is a long-context GLM model with up to 200k context and 128k output support for longer documents and conversations.",
	},
	"glm-4.6v": {
		maxTokens: 32_768,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.15,
		outputPrice: 0.45,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.025,
		description:
			"GLM-4.6V is an advanced multimodal vision model with improved performance and cost-efficiency for visual understanding tasks.",
	},
	"glm-4.6v-flash": {
		maxTokens: 32_768,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		isFree: true,
		description:
			"GLM-4.6V-Flash is a free, high-speed multimodal vision model for rapid image understanding and visual reasoning tasks.",
	},
	"glm-4.6v-flashx": {
		maxTokens: 32_768,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.02,
		outputPrice: 0.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.002,
		description:
			"GLM-4.6V-FlashX is an ultra-fast multimodal vision model optimized for high-speed visual processing at low cost.",
	},
	"glm-4.5": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0.29,
		outputPrice: 1.14,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.5 is a featured GLM model for reasoning, coding, and agentic tasks with a 128k context window and hybrid thinking support.",
	},
	"glm-4.5-air": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0.1,
		outputPrice: 0.6,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.02,
		description:
			"GLM-4.5-Air is the lightweight version of GLM-4.5, balancing performance and cost with hybrid thinking support.",
	},
	"glm-4.5-x": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0.29,
		outputPrice: 1.14,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.5-X is a high-performance GLM-4.5 variant optimized for strong reasoning with fast responses.",
	},
	"glm-4.5-airx": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0.1,
		outputPrice: 0.6,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.02,
		description: "GLM-4.5-AirX is a lightweight, ultra-fast GLM-4.5 variant delivering strong performance.",
	},
	"glm-4.5-flash": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		...glmThinking,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		isFree: true,
		description: "GLM-4.5-Flash is a free, high-speed model for reasoning, coding, and agentic tasks.",
	},
	"glm-4.5v": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.29,
		outputPrice: 0.93,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.5V is Z.ai's multimodal visual reasoning model for image, video, text, and file input, optimized for GUI tasks, grounding, and document/video understanding.",
	},
} as const satisfies Record<string, ModelInfo>

export const ZAI_DEFAULT_TEMPERATURE = 0.6

export const zaiApiLineConfigs = {
	international_coding: {
		name: "International Coding",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		isChina: false,
	},
	china_coding: {
		name: "China Coding",
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
		isChina: true,
	},
	international_api: {
		name: "International API",
		baseUrl: "https://api.z.ai/api/paas/v4",
		isChina: false,
	},
	china_api: {
		name: "China API",
		baseUrl: "https://open.bigmodel.cn/api/paas/v4",
		isChina: true,
	},
} satisfies Record<ZaiApiLine, { name: string; baseUrl: string; isChina: boolean }>

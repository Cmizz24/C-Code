import * as fs from "fs"
import * as path from "path"
import type * as vscode from "vscode"

import type { ClineMessage, ModelInfo, ProviderSettings, RooCodeAPI } from "@roo-code/types"

export const RooCodeEventName = {
	TaskCreated: "taskCreated",
	TaskStarted: "taskStarted",
	TaskCompleted: "taskCompleted",
	TaskAborted: "taskAborted",
	TaskFocused: "taskFocused",
	TaskUnfocused: "taskUnfocused",
	TaskActive: "taskActive",
	TaskInteractive: "taskInteractive",
	TaskResumable: "taskResumable",
	TaskIdle: "taskIdle",
	TaskPaused: "taskPaused",
	TaskUnpaused: "taskUnpaused",
	TaskSpawned: "taskSpawned",
	TaskDelegated: "taskDelegated",
	TaskDelegationCompleted: "taskDelegationCompleted",
	TaskDelegationResumed: "taskDelegationResumed",
	Message: "message",
	TaskModeSwitched: "taskModeSwitched",
	TaskAskResponded: "taskAskResponded",
	TaskUserMessage: "taskUserMessage",
	QueuedMessagesUpdated: "queuedMessagesUpdated",
	TaskTokenUsageUpdated: "taskTokenUsageUpdated",
	TaskToolFailed: "taskToolFailed",
	ModeChanged: "modeChanged",
	ProviderProfileChanged: "providerProfileChanged",
	CommandsResponse: "commandsResponse",
	ModesResponse: "modesResponse",
	ModelsResponse: "modelsResponse",
} as const

export type E2EEventName = (typeof RooCodeEventName)[keyof typeof RooCodeEventName]

type ExtensionPackageJson = {
	publisher?: unknown
	name?: unknown
}

type ExtensionWithPackageJson = vscode.Extension<RooCodeAPI> & {
	packageJSON: { publisher?: unknown; name?: unknown }
}

function getExtensionPackageJson(): ExtensionPackageJson {
	const packageJsonPath = path.resolve(__dirname, "../../../../src/package.json")
	return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as ExtensionPackageJson
}

const extensionPackageJson = getExtensionPackageJson()

export const EXTENSION_PACKAGE_NAME =
	typeof extensionPackageJson.name === "string" && extensionPackageJson.name.length > 0
		? extensionPackageJson.name
		: "c-code"
export const EXTENSION_PUBLISHER =
	typeof extensionPackageJson.publisher === "string" && extensionPackageJson.publisher.length > 0
		? extensionPackageJson.publisher
		: "cmizz"
export const EXTENSION_ID = `${EXTENSION_PUBLISHER}.${EXTENSION_PACKAGE_NAME}`

export function getCommand(command: string): string {
	return `${EXTENSION_PACKAGE_NAME}.${command}`
}

export function getExtensionPackageName(extension: ExtensionWithPackageJson): string {
	const name = extension.packageJSON.name
	return typeof name === "string" && name.length > 0 ? name : EXTENSION_PACKAGE_NAME
}

export function assertExtensionIdentity(extension: ExtensionWithPackageJson): void {
	const packageJson = extension.packageJSON
	const publisher = typeof packageJson.publisher === "string" ? packageJson.publisher : EXTENSION_PUBLISHER
	const name = getExtensionPackageName(extension)

	if (publisher !== EXTENSION_PUBLISHER || name !== EXTENSION_PACKAGE_NAME) {
		throw new Error(`Expected extension ${EXTENSION_ID}, got ${publisher}.${name}`)
	}
}

export type FakeApiStreamChunk =
	| { type: "text"; text: string }
	| {
			type: "tool_call"
			id: string
			name: string
			arguments: string
	  }
	| {
			type: "usage"
			inputTokens: number
			outputTokens: number
			cacheWriteTokens?: number
			cacheReadTokens?: number
			reasoningTokens?: number
			totalCost?: number
	  }

type FakeAiRequest = {
	requestNumber: number
	systemPrompt: string
	messages: unknown[]
	metadata?: unknown
}

type FakeAiStreamSource =
	| Iterable<FakeApiStreamChunk>
	| AsyncIterable<FakeApiStreamChunk>
	| ((request: FakeAiRequest) => Iterable<FakeApiStreamChunk> | AsyncIterable<FakeApiStreamChunk>)

function isFakeApiStreamChunk(value: unknown): value is FakeApiStreamChunk {
	if (typeof value !== "object" || value === null || !("type" in value)) {
		return false
	}

	const type = (value as { type?: unknown }).type
	return type === "text" || type === "tool_call" || type === "usage"
}

function normalizeFakeAiResponses(responses: FakeAiStreamSource | FakeAiStreamSource[]): FakeAiStreamSource[] {
	if (!Array.isArray(responses)) {
		return [responses]
	}

	const responseItems = responses as unknown[]

	if (responseItems.every(isFakeApiStreamChunk)) {
		return [responseItems as FakeApiStreamChunk[]]
	}

	return responses as FakeAiStreamSource[]
}

export type E2EFakeAi = {
	readonly id: string
	readonly requestCount: number
	removeFromCache?: () => void
	createMessage(systemPrompt: string, messages: unknown[], metadata?: unknown): AsyncIterable<FakeApiStreamChunk>
	getModel(): { id: string; info: ModelInfo }
	countTokens(content: unknown[]): Promise<number>
	completePrompt(prompt: string): Promise<string>
}

export function fakeModelInfo(overrides: Partial<ModelInfo> = {}): ModelInfo {
	return {
		contextWindow: 128_000,
		maxTokens: 8_192,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		...overrides,
	}
}

export function fakeTextChunk(text: string): FakeApiStreamChunk {
	return { type: "text", text }
}

export function fakeToolCallChunk(
	name: string,
	args: Record<string, unknown>,
	id = `call-${name}`,
): FakeApiStreamChunk {
	return { type: "tool_call", id, name, arguments: JSON.stringify(args) }
}

export function fakeAttemptCompletionChunk(result: string): FakeApiStreamChunk {
	return fakeToolCallChunk("attempt_completion", { result }, "call-attempt-completion")
}

export function fakeUsageChunk(
	overrides: Partial<Extract<FakeApiStreamChunk, { type: "usage" }>> = {},
): FakeApiStreamChunk {
	return { type: "usage", inputTokens: 1, outputTokens: 1, ...overrides }
}

async function* toAsyncIterable<T>(source: Iterable<T> | AsyncIterable<T>): AsyncIterable<T> {
	if (Symbol.asyncIterator in source) {
		yield* source as AsyncIterable<T>
		return
	}

	yield* source as Iterable<T>
}

export function createFakeAi({
	id,
	modelId = "roo-e2e-fake-model",
	modelInfo = fakeModelInfo(),
	responses,
	completePrompt = async () => "",
}: {
	id: string
	modelId?: string
	modelInfo?: ModelInfo
	responses: FakeAiStreamSource | FakeAiStreamSource[]
	completePrompt?: (prompt: string) => Promise<string>
}): E2EFakeAi {
	let requestCount = 0
	const responseList = normalizeFakeAiResponses(responses)

	return {
		id,
		get requestCount() {
			return requestCount
		},
		async *createMessage(systemPrompt, messages, metadata) {
			requestCount += 1
			const request = { requestNumber: requestCount, systemPrompt, messages, metadata }
			const response = responseList[Math.min(requestCount - 1, responseList.length - 1)]

			if (!response) {
				throw new Error("Fake AI requires at least one configured response")
			}

			const source = typeof response === "function" ? response(request) : response

			yield* toAsyncIterable(source)
		},
		getModel() {
			return { id: modelId, info: modelInfo }
		},
		async countTokens(content) {
			return Math.max(1, Math.ceil(JSON.stringify(content).length / 4))
		},
		completePrompt,
	}
}

export function fakeAiProviderSettings(fakeAi: E2EFakeAi): ProviderSettings {
	return { apiProvider: "fake-ai", apiModelId: fakeAi.getModel().id, fakeAi } as ProviderSettings
}

type WaitForOptions = {
	timeout?: number
	interval?: number
}

export const waitFor = (
	condition: (() => Promise<boolean>) | (() => boolean),
	{ timeout = 30_000, interval = 250 }: WaitForOptions = {},
) => {
	let timeoutId: NodeJS.Timeout | undefined = undefined

	return Promise.race([
		new Promise<void>((resolve) => {
			const check = async () => {
				const result = condition()
				const isSatisfied = result instanceof Promise ? await result : result

				if (isSatisfied) {
					if (timeoutId) {
						clearTimeout(timeoutId)
						timeoutId = undefined
					}

					resolve()
				} else {
					setTimeout(check, interval)
				}
			}

			check()
		}),
		new Promise((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(new Error(`Timeout after ${Math.floor(timeout / 1000)}s`))
			}, timeout)
		}),
	])
}

type WaitUntilAbortedOptions = WaitForOptions & {
	api: RooCodeAPI
	taskId: string
}

export const waitUntilAborted = async ({ api, taskId, ...options }: WaitUntilAbortedOptions) => {
	const set = new Set<string>()
	api.on(RooCodeEventName.TaskAborted as never, ((abortedTaskId: string) => set.add(abortedTaskId)) as never)
	await waitFor(() => set.has(taskId), options)
}

type WaitUntilCompletedOptions = WaitForOptions & {
	api: RooCodeAPI
	taskId: string
}

export const waitUntilCompleted = async ({ api, taskId, ...options }: WaitUntilCompletedOptions) => {
	const set = new Set<string>()
	api.on(RooCodeEventName.TaskCompleted as never, ((completedTaskId: string) => set.add(completedTaskId)) as never)
	await waitFor(() => set.has(taskId), options)
}

type RecordedEvent = {
	eventName: E2EEventName
	payload: unknown[]
}

export type EventRecorder = {
	readonly events: RecordedEvent[]
	find(eventName: E2EEventName, predicate?: (...payload: unknown[]) => boolean): RecordedEvent | undefined
	filter(eventName: E2EEventName, predicate?: (...payload: unknown[]) => boolean): RecordedEvent[]
	waitFor(
		eventName: E2EEventName,
		predicate?: (...payload: unknown[]) => boolean,
		options?: WaitForOptions,
	): Promise<RecordedEvent>
	dispose(): void
}

export function recordEvents(api: RooCodeAPI, eventNames: readonly E2EEventName[]): EventRecorder {
	const events: RecordedEvent[] = []
	const listeners = eventNames.map((eventName) => {
		const listener = (...payload: unknown[]) => {
			events.push({ eventName, payload })
		}

		api.on(eventName as never, listener as never)
		return { eventName, listener }
	})

	const filter = (eventName: E2EEventName, predicate?: (...payload: unknown[]) => boolean): RecordedEvent[] =>
		events.filter((event) => {
			if (event.eventName !== eventName) {
				return false
			}

			return predicate ? predicate(...event.payload) : true
		})

	return {
		events,
		find(eventName, predicate) {
			return filter(eventName, predicate)[0]
		},
		filter,
		async waitFor(eventName, predicate, options) {
			let event: RecordedEvent | undefined

			await waitFor(() => {
				event = filter(eventName, predicate)[0]
				return event !== undefined
			}, options)

			return event!
		},
		dispose() {
			for (const { eventName, listener } of listeners) {
				api.off(eventName as never, listener as never)
			}
		},
	}
}

export function approveCompletionResults(api: RooCodeAPI): () => void {
	type CompletionApprovalApi = RooCodeAPI & {
		sidebarProvider?: {
			getCurrentTask?: () => { taskId?: string; approveAsk?: () => void } | undefined
		}
	}

	const approved = new Set<string>()
	const listener = ({ taskId, message }: { taskId: string; message: ClineMessage }) => {
		if (message.type !== "ask" || message.ask !== "completion_result" || message.partial === true) {
			return
		}

		const key = `${taskId}:${message.ts}`
		if (approved.has(key)) {
			return
		}

		approved.add(key)

		// In the VS Code E2E host the webview is focused, so pressPrimaryButton() routes
		// through React state. That can race the just-emitted completion_result ask and
		// drop the click before ChatView observes it. Approve the active task directly
		// for this test helper, falling back to the public API if internals are unavailable.
		const currentTask = (api as CompletionApprovalApi).sidebarProvider?.getCurrentTask?.()

		if (currentTask?.taskId === taskId && typeof currentTask.approveAsk === "function") {
			currentTask.approveAsk()
			return
		}

		void api.pressPrimaryButton()
	}

	api.on(RooCodeEventName.Message as never, listener as never)
	return () => api.off(RooCodeEventName.Message as never, listener as never)
}

export async function runWithCompletionApproval<T>(api: RooCodeAPI, run: () => Promise<T>): Promise<T> {
	const dispose = approveCompletionResults(api)

	try {
		return await run()
	} finally {
		dispose()
	}
}

export async function waitForRecordedCompletion(recorder: EventRecorder, taskId: string, options?: WaitForOptions) {
	await recorder.waitFor(RooCodeEventName.TaskCompleted, (completedTaskId) => completedTaskId === taskId, options)
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

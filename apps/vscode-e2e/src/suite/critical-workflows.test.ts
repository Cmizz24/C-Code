import assert from "assert"
import * as childProcess from "child_process"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type { ClineMessage, ContextCacheStats, ExecutionPlan, RooCodeAPI } from "@roo-code/types"

import { setDefaultSuiteTimeout } from "./test-utils"
import {
	createFakeAi,
	fakeAiProviderSettings,
	fakeAttemptCompletionChunk,
	fakeToolCallChunk,
	fakeUsageChunk,
	approveCompletionResults,
	recordEvents,
	RooCodeEventName,
	waitFor,
	waitForRecordedCompletion,
} from "./utils"

const completionResponse = [
	fakeAttemptCompletionChunk(
		"The requested VS Code E2E smoke workflow is complete: provider profile activation, parallel agent Git setup guidance, memory recall, delegation, and finish steps were handled deterministically.",
	),
	fakeUsageChunk(),
]

type PendingParallelPlanSetupState = {
	plan?: ExecutionPlan
	setupRequired?: {
		reason: string
		message: string
		guidance?: string
	}
}

type CriticalWorkflowAPI = typeof api & {
	getContextCacheDiagnostics(): Promise<ContextCacheStats>
	getPendingParallelPlanSetup(): PendingParallelPlanSetupState
	retryPendingParallelPlan(): Promise<void>
}

const criticalApi = api as CriticalWorkflowAPI

type MessageEventPayload = {
	taskId: string
	action: "created" | "updated"
	message: ClineMessage
}

function uniqueName(prefix: string) {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function execFile(command: string, args: string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		childProcess.execFile(command, args, { cwd }, (error, _stdout, stderr) => {
			if (error) {
				reject(new Error(`${command} ${args.join(" ")} failed: ${stderr || error.message}`))
				return
			}

			resolve()
		})
	})
}

function createParallelPlanToolCall(goal: string) {
	return fakeToolCallChunk(
		"plan_parallel_tasks",
		{
			goal,
			sharedContext: "Deterministic VS Code E2E smoke test context.",
			sharedContract: "Do not touch files outside the assigned ownership map.",
			agents: [
				{
					id: "agent-a",
					mode: "code",
					task: "Create a deterministic smoke artifact.",
					owns: [{ path: "parallel-smoke-a.txt", mode: "exclusive" }],
				},
			],
		},
		"call-plan-parallel-tasks",
	)
}

function createMistakeMemoryToolCall(lesson: string) {
	return fakeToolCallChunk(
		"mistake_memory",
		{
			lesson,
			correction: "Prefer deterministic fake-AI E2E fixtures for smoke coverage.",
			error: null,
			tool_name: "vscode-e2e",
			file_paths: null,
			tags: ["e2e", "deterministic"],
			scope: "global",
			approve: true,
		},
		"call-mistake-memory",
	)
}

function createNewTaskToolCall(message: string) {
	return fakeToolCallChunk(
		"new_task",
		{
			mode: "code",
			message,
			todos: "- [ ] Complete deterministic child smoke task",
		},
		"call-new-task",
	)
}

function assertSetupRequired(setup: PendingParallelPlanSetupState, expectedReason: string) {
	assert.ok(setup.plan, "expected a pending execution plan")
	assert.ok(setup.setupRequired, "expected pending setup guidance")
	assert.strictEqual(setup.setupRequired.reason, expectedReason)
	assert.ok(setup.setupRequired.message.length > 0, "expected setup guidance message")
}

function isToolMessage(message: ClineMessage, toolName: string) {
	if (message.type !== "say" || message.say !== "tool" || !message.text) {
		return false
	}

	try {
		const payload = JSON.parse(message.text) as { tool?: string }
		return payload.tool === toolName
	} catch {
		return false
	}
}

function isToolMessageEvent(toolName: string) {
	return (payload: unknown) => isMessagePayload(payload) && isToolMessage(payload.message, toolName)
}

function isMessagePayload(payload: unknown): payload is MessageEventPayload {
	return typeof payload === "object" && payload !== null && "message" in payload && "taskId" in payload
}

function approveToolAsks(api: RooCodeAPI): () => void {
	const listener = ({ message }: MessageEventPayload) => {
		if (message.type !== "ask" || message.ask !== "tool" || message.partial === true) {
			return
		}

		void api.pressPrimaryButton()
	}

	api.on(RooCodeEventName.Message as never, listener as never)
	return () => api.off(RooCodeEventName.Message as never, listener as never)
}

suite("Critical workflow smoke coverage", function () {
	setDefaultSuiteTimeout(this)

	test("persists provider profiles and can reactivate a saved fake provider", async () => {
		const profileName = uniqueName("e2e-fake-profile")
		const fakeAi = createFakeAi({
			id: uniqueName("profile-fake-ai"),
			modelId: "roo-e2e-profile-model",
			responses: completionResponse,
		})

		await api.upsertProfile(profileName, fakeAiProviderSettings(fakeAi), false)

		assert.ok(api.getProfiles().includes(profileName), "expected saved profile in profile list")
		const entry = api.getProfileEntry(profileName)
		assert.ok(entry, "expected saved profile entry")
		assert.strictEqual(entry.name, profileName)
		assert.strictEqual(entry.apiProvider, "fake-ai")
		assert.strictEqual(entry.modelId, "roo-e2e-profile-model")
		assert.ok(entry.id.length > 0, "expected saved profile entry id")

		await api.setActiveProfile(profileName)
		assert.strictEqual(api.getActiveProfile(), profileName)

		const recorder = recordEvents(api, [RooCodeEventName.TaskCompleted])
		const disposeCompletionApproval = approveCompletionResults(api)

		try {
			const taskId = await api.startNewTask({ text: "Use the active saved fake provider and finish." })

			await waitForRecordedCompletion(recorder, taskId)
			assert.strictEqual(fakeAi.requestCount, 1)
		} finally {
			disposeCompletionApproval()
			recorder.dispose()
			await api.deleteProfile(profileName)
		}
	})

	test("surfaces parallel-agent Git setup guidance and clears it after retry", async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "roo-e2e-parallel-"))
		const previousCwd = process.cwd()
		const fakeAi = createFakeAi({
			id: uniqueName("parallel-fake-ai"),
			responses: [[createParallelPlanToolCall("E2E setup-required smoke"), fakeUsageChunk()], completionResponse],
		})
		const recorder = recordEvents(api, [RooCodeEventName.TaskCompleted])

		process.chdir(workspace)
		const disposeCompletionApproval = approveCompletionResults(api)

		try {
			const taskId = await api.startNewTask({
				configuration: {
					...fakeAiProviderSettings(fakeAi),
					autoApprovalEnabled: true,
					alwaysAllowParallelTasks: true,
					maxConcurrentParallelTasks: 1,
				},
				text: "Plan one parallel smoke agent. The first attempt should report Git setup guidance.",
			})

			await waitFor(() => criticalApi.getPendingParallelPlanSetup().setupRequired !== undefined)
			assertSetupRequired(criticalApi.getPendingParallelPlanSetup(), "not_git_repo")

			await execFile("git", ["init"], workspace)
			await execFile("git", ["config", "user.email", "roo-e2e@example.invalid"], workspace)
			await execFile("git", ["config", "user.name", "Roo E2E"], workspace)
			await fs.writeFile(path.join(workspace, "README.md"), "# Roo E2E parallel smoke\n")
			await execFile("git", ["add", "README.md"], workspace)
			await execFile("git", ["commit", "-m", "Initial commit"], workspace)

			await criticalApi.retryPendingParallelPlan()
			await waitFor(() => criticalApi.getPendingParallelPlanSetup().setupRequired === undefined)
			assert.strictEqual(criticalApi.getPendingParallelPlanSetup().plan, undefined)

			await waitForRecordedCompletion(recorder, taskId)
			assert.ok(fakeAi.requestCount >= 1)
		} finally {
			disposeCompletionApproval()
			recorder.dispose()
			process.chdir(previousCwd)
			await fs.rm(workspace, { recursive: true, force: true })
		}
	})

	test("exposes context cache diagnostics and memory recall messages", async () => {
		const diagnosticsBefore = await criticalApi.getContextCacheDiagnostics()
		assert.ok(Number.isFinite(diagnosticsBefore.hotCacheTokens), "expected numeric hot cache token diagnostics")
		assert.ok(Number.isFinite(diagnosticsBefore.ramBudgetMb), "expected numeric cache RAM budget diagnostics")

		const lesson = `Always use fake-AI critical workflow smoke fixtures ${uniqueName("memory")}`
		const fakeAi = createFakeAi({
			id: uniqueName("memory-fake-ai"),
			responses: [
				[createMistakeMemoryToolCall(lesson), fakeUsageChunk()],
				completionResponse,
				completionResponse,
			],
		})
		const recorder = recordEvents(api, [RooCodeEventName.Message, RooCodeEventName.TaskCompleted])
		const disposeCompletionApproval = approveCompletionResults(api)

		try {
			const memoryTaskId = await api.startNewTask({
				configuration: {
					...fakeAiProviderSettings(fakeAi),
					autoApprovalEnabled: true,
					memoryEnabled: true,
					memoryGlobalEnabled: true,
					memoryWorkspaceEnabled: true,
					memoryMistakeMemoryEnabled: true,
					memoryAutoApproveMistakeMemory: true,
				},
				text: "Save a deterministic memory lesson, then finish.",
			})
			await recorder.waitFor(RooCodeEventName.Message, isToolMessageEvent("mistakeMemory"))
			await waitForRecordedCompletion(recorder, memoryTaskId)

			const recallTaskId = await api.startNewTask({
				configuration: {
					...fakeAiProviderSettings(fakeAi),
					memoryEnabled: true,
					memoryGlobalEnabled: true,
					memoryWorkspaceEnabled: true,
				},
				text: `Recall the lesson about deterministic fake-AI smoke fixtures: ${lesson}`,
			})

			await recorder.waitFor(RooCodeEventName.Message, isToolMessageEvent("memoryRecall"))
			await waitForRecordedCompletion(recorder, recallTaskId)

			const diagnosticsAfter = await criticalApi.getContextCacheDiagnostics()
			assert.ok(diagnosticsAfter.hotCacheTokens >= 0)
			assert.ok(diagnosticsAfter.hotCacheChunks >= 0)
		} finally {
			disposeCompletionApproval()
			recorder.dispose()
		}
	})

	test("delegates a child task and resumes the parent", async () => {
		const fakeAi = createFakeAi({
			id: uniqueName("delegation-fake-ai"),
			responses: [
				[createNewTaskToolCall("Child: complete deterministic delegation smoke coverage."), fakeUsageChunk()],
				completionResponse,
				completionResponse,
			],
		})
		const recorder = recordEvents(api, [
			RooCodeEventName.Message,
			RooCodeEventName.TaskCompleted,
			RooCodeEventName.TaskDelegated,
			RooCodeEventName.TaskDelegationCompleted,
		])
		const disposeToolApproval = approveToolAsks(api)
		const disposeCompletionApproval = approveCompletionResults(api)

		try {
			const parentTaskId = await api.startNewTask({
				configuration: {
					...fakeAiProviderSettings(fakeAi),
					autoApprovalEnabled: true,
					alwaysAllowSubtasks: true,
				},
				text: "Delegate one deterministic child task, then finish after it returns.",
			})

			const delegated = await recorder.waitFor(
				RooCodeEventName.TaskDelegated,
				(eventParentTaskId) => eventParentTaskId === parentTaskId,
			)
			const childTaskId = delegated.payload[1]
			assert.strictEqual(typeof childTaskId, "string")

			await recorder.waitFor(
				RooCodeEventName.TaskDelegationCompleted,
				(eventParentTaskId, eventChildTaskId) =>
					eventParentTaskId === parentTaskId && eventChildTaskId === childTaskId,
			)
			await waitForRecordedCompletion(recorder, parentTaskId)
			assert.ok(fakeAi.requestCount >= 2)
		} finally {
			disposeCompletionApproval()
			disposeToolApproval()
			recorder.dispose()
		}
	})
})

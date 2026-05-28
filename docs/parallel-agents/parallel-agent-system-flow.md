# Parallel Agent System Flow

This report explains how the current Roo Code parallel-agent system is wired from the user's request, through plan approval and background execution, to merge review, materialization, persistence, and parent-task resumption. It is scoped to the parallel-agent integration only.

## Executive summary

Parallel agents let Roo split a larger task into independently owned slices of work, run those slices in isolated Git worktrees, and merge the results back only after structured completion and review evidence exists. The implementation is intentionally conservative: it requires a validated plan, explicit user approval, declared file ownership, background-task tool restrictions, write-intent enforcement, worktree isolation, and a merge review step before edits are materialized in the user's main workspace.

At a high level, the flow is:

1. Roo's orchestrator-capable prompt encourages parallelization only when work can be divided across clear file ownership boundaries.
2. The model calls the native `plan_parallel_tasks` tool with a goal, shared context, expected files, and agent definitions.
3. The extension validates the proposed plan into a canonical `ExecutionPlan` and asks the user to approve it in the webview.
4. Once approved, the parent task pauses instead of continuing to act on its own.
5. The provider captures a Git baseline, creates an `AgentBus`, starts an `OrchestratorEventLoop`, and creates one background `Task` per runnable agent.
6. Each background agent runs in its own Git worktree, receives a system prompt suffix explaining its ownership and coordination constraints, and finishes with `attempt_completion`.
7. The `AgentBus` tracks dependencies, signals, status, write intents, coordination questions and answers, completion packets, and plan-level completion evidence.
8. Writing tools request ownership permission before touching files; background agents cannot recursively delegate or create new parallel plans.
9. After all agents finish, the provider collects diffs from the worktrees, renders merge review evidence in the UI, and waits for user approval unless auto-merge settings allow safe materialization.
10. Approved changes are merged or copied into the main workspace, worktrees are cleaned up, and the parent task resumes with a structured verification directive that discourages redundant broad re-review.

## Source map

The integration is spread across shared types, prompt definitions, tool implementations, orchestration, worktree management, provider lifecycle, task behavior, and webview UI:

| Area                                                 | Main files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared model                                         | [`packages/types/src/agents.ts`](../../packages/types/src/agents.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Planning prompt and validation                       | [`src/core/prompts/tools/native-tools/plan_parallel_tasks.ts`](../../src/core/prompts/tools/native-tools/plan_parallel_tasks.ts), [`src/core/tools/planParallelTasks.ts`](../../src/core/tools/planParallelTasks.ts), [`src/core/prompts/system.ts`](../../src/core/prompts/system.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Coordination prompt and runtime tool                 | [`src/core/prompts/tools/native-tools/coordinate_agents.ts`](../../src/core/prompts/tools/native-tools/coordinate_agents.ts), [`src/core/tools/CoordinateAgentsTool.ts`](../../src/core/tools/CoordinateAgentsTool.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Agent coordination bus                               | [`src/core/agents/AgentBus.ts`](../../src/core/agents/AgentBus.ts), [`src/core/agents/backgroundAgentTools.ts`](../../src/core/agents/backgroundAgentTools.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Worktree lifecycle                                   | [`src/core/agents/WorktreeManager.ts`](../../src/core/agents/WorktreeManager.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Background execution loop                            | [`src/core/orchestrator/OrchestratorEventLoop.ts`](../../src/core/orchestrator/OrchestratorEventLoop.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Provider state, approval, persistence, merge, resume | [`src/core/webview/ClineProvider.ts`](../../src/core/webview/ClineProvider.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Task pause/resume and background bridges             | [`src/core/task/Task.ts`](../../src/core/task/Task.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Assistant message routing                            | [`src/core/assistant-message/presentAssistantMessage.ts`](../../src/core/assistant-message/presentAssistantMessage.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Tool enforcement                                     | [`src/core/tools/WriteToFileTool.ts`](../../src/core/tools/WriteToFileTool.ts), [`src/core/tools/ApplyDiffTool.ts`](../../src/core/tools/ApplyDiffTool.ts), [`src/core/tools/ApplyPatchTool.ts`](../../src/core/tools/ApplyPatchTool.ts), [`src/core/tools/EditTool.ts`](../../src/core/tools/EditTool.ts), [`src/core/tools/EditFileTool.ts`](../../src/core/tools/EditFileTool.ts), [`src/core/tools/SearchReplaceTool.ts`](../../src/core/tools/SearchReplaceTool.ts), [`src/core/tools/GenerateImageTool.ts`](../../src/core/tools/GenerateImageTool.ts), [`src/core/tools/ExecuteCommandTool.ts`](../../src/core/tools/ExecuteCommandTool.ts), [`src/core/tools/AttemptCompletionTool.ts`](../../src/core/tools/AttemptCompletionTool.ts)   |
| Webview approval and status UI                       | [`webview-ui/src/App.tsx`](../../webview-ui/src/App.tsx), [`webview-ui/src/components/agents/PlanPreviewModal.tsx`](../../webview-ui/src/components/agents/PlanPreviewModal.tsx), [`webview-ui/src/components/agents/AgentStatusPanel.tsx`](../../webview-ui/src/components/agents/AgentStatusPanel.tsx), [`webview-ui/src/components/agents/mergeReviewDisplay.ts`](../../webview-ui/src/components/agents/mergeReviewDisplay.ts), [`webview-ui/src/components/chat/ChatView.tsx`](../../webview-ui/src/components/chat/ChatView.tsx), [`webview-ui/src/components/chat/ChatRow.tsx`](../../webview-ui/src/components/chat/ChatRow.tsx), [`webview-ui/src/components/chat/TaskHeader.tsx`](../../webview-ui/src/components/chat/TaskHeader.tsx) |
| Webview message routing                              | [`src/core/webview/webviewMessageHandler.ts`](../../src/core/webview/webviewMessageHandler.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Cost aggregation                                     | [`src/core/webview/aggregateTaskCosts.ts`](../../src/core/webview/aggregateTaskCosts.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Data model

The canonical model lives in [`packages/types/src/agents.ts`](../../packages/types/src/agents.ts). The most important concepts are:

- `FileOwnership`: a declared file or path pattern plus an access mode. Modes are `exclusive`, `read-only`, and `shared`.
- `AgentDependency`: a dependency on another agent, either waiting for that agent to complete or waiting for a named signal from that agent.
- `AgentStatus`: the lifecycle state used by the bus and UI: `pending`, `running`, `blocked`, `complete`, or `failed`.
- `AgentPlan`: the per-agent work description, owned files, disallowed files, dependencies, worktree path, status, and declared signals.
- `ExecutionPlan`: the plan-level object that carries the generated plan id, shared context, ownership map, agents, and creation timestamp.
- Completion and review records: `AgentCompletionPacket`, `ParallelPlanCompletionPacket`, `MergeReviewEntry`, status updates, write conflicts, coordination events, and helper functions that build artifact manifests and merge-review stats.

This shared package matters because both extension-host code and webview UI need the same shape for persisted tool payloads, status updates, review entries, and completion evidence.

## User workflow

From the user's point of view, the parallel-agent workflow is a guided approval-and-review process:

1. The user asks for work that may be split safely.
2. Roo proposes a parallel execution plan instead of immediately spawning subtasks.
3. A modal appears in the webview showing shared context, agents, task descriptions, ownership, and dependencies.
4. The user can approve or cancel the plan. The modal also allows limited edits to agent task descriptions and ownership display before approval.
5. After approval, Roo shows a persistent parallel-agent status card in the chat transcript.
6. The status card updates while background agents run: status, current activity, owned files, dependencies, worktrees, usage, coordination messages, conflicts, and completion data.
7. When agents finish, merge-review evidence appears. The user can approve safe changes or deny the merge.
8. After approved materialization, the parent task resumes with a concise structured summary and verification directive.

The design keeps control points explicit: the user approves the plan before background work begins and approves materialization before changes are brought back to the main workspace.

## Planning flow

### Prompt-level guidance

The system prompt adds parallel-agent guidance for orchestrator-style modes in [`src/core/prompts/system.ts`](../../src/core/prompts/system.ts). Roo is told to use parallel planning only when work can be separated across independent ownership boundaries. The prompt also tells Roo to complete the active planning checklist item before requesting approval, avoid redundant manual review items when structured completion and merge evidence are clean, and fall back to sequential delegation for simple single-agent work.

### Native tool schema

The model-facing native tool is defined in [`src/core/prompts/tools/native-tools/plan_parallel_tasks.ts`](../../src/core/prompts/tools/native-tools/plan_parallel_tasks.ts). It asks the model for:

- `goal`: the overall user-facing objective.
- `sharedContext`: context every child agent needs.
- `expectedFiles`: files expected to be changed or reviewed.
- `agents`: one entry per background agent, including id, mode, task, ownership, disallowed paths, dependencies, and optional signals.

The native prompt emphasizes that Roo starts agents programmatically after approval. The model should not call `new_task` after the user approves the plan.

### Validation and canonicalization

The runtime validator in [`src/core/tools/planParallelTasks.ts`](../../src/core/tools/planParallelTasks.ts) turns model-proposed arguments into a canonical `ExecutionPlan`. It validates:

- Maximum agent count, using the configured parallel concurrency ceiling.
- Unique agent ids.
- Supported mode slugs.
- Ownership modes and normalized paths.
- Dependency targets and dependency cycles.
- Conflicting file ownership.
- Expected files that are not clearly owned.

It also assigns a generated `planId` and initial statuses. Agents with dependencies begin as `blocked`; otherwise they begin as `pending`. The validator fills a default worktree path, but the actual runtime path is later replaced by the worktree manager when worktrees are created.

### Assistant message handling

The native tool call is routed in [`src/core/assistant-message/presentAssistantMessage.ts`](../../src/core/assistant-message/presentAssistantMessage.ts). When a complete `plan_parallel_tasks` block arrives:

1. The parent task enters a plan-pause state.
2. The arguments are validated.
3. The active planning checklist item is completed when validation succeeds.
4. The provider asks the webview to show the plan approval modal.
5. If approved and started, the parent enters an execution-pause state and receives a tool result explaining that Roo is creating worktrees and starting agents programmatically.

If validation fails, Roo receives actionable error text and should revise the plan rather than starting parallel execution.

## Approval and start flow

The webview receives `showPlanPreview` in [`webview-ui/src/App.tsx`](../../webview-ui/src/App.tsx) and renders [`webview-ui/src/components/agents/PlanPreviewModal.tsx`](../../webview-ui/src/components/agents/PlanPreviewModal.tsx). The modal sends either `approvePlan` with the edited plan or `cancelPlan`.

The webview message handler routes those actions in [`src/core/webview/webviewMessageHandler.ts`](../../src/core/webview/webviewMessageHandler.ts):

- `approvePlan` calls the provider approval path.
- `cancelPlan` cancels the pending execution plan.
- Merge-review and conflict messages are also routed here later in the lifecycle.

On approval, [`src/core/webview/ClineProvider.ts`](../../src/core/webview/ClineProvider.ts) starts the plan:

1. Normalize and enforce the maximum concurrent parallel task setting.
2. Tear down any previous parallel execution state.
3. Reset status-card state.
4. Validate that the workspace is a Git repository.
5. Capture a workspace baseline.
6. Set the active execution plan.
7. Persist a `parallelAgents` status tool payload.
8. Create an `OrchestratorEventLoop` with the configured concurrency.
9. Attach `AgentBus` event forwarders.
10. Start scheduling agents.

The parent task stays paused while this happens. That is important because the parent should not continue editing files or running broad verification while child agents are active.

## Parent task pause, resume, and verification guidance

Parent pause state is maintained by [`src/core/task/Task.ts`](../../src/core/task/Task.ts):

- `parallelPlanPaused` is used while the approval flow is in progress.
- `parallelExecutionPaused` is used after approval while background agents execute and merge review completes.

When a task loop detects that parallel execution is paused, it flushes pending tool results to history and returns instead of continuing the conversation loop. On resume, `resumeAfterParallelExecution` clears the execution pause and resumes the paused tool flow. History restoration can call `restoreParallelExecutionPause` to rebuild a paused parent after reload.

When the plan is completed and merged, the provider resumes the parent with structured context: plan status, completion packets, review evidence, and a parent verification directive. That directive explicitly treats structured completion and merge evidence as the verification source of truth and tells the parent not to perform broad file reads or searches over already-merged deliverables solely to verify them. Manual inspection is reserved for missing, failed, contradictory, inconclusive, or user-requested evidence.

This prevents the parent from spending a second full pass redoing child-agent work and keeps the workflow focused on unresolved risk.

## Background task creation

The execution scheduler lives in [`src/core/orchestrator/OrchestratorEventLoop.ts`](../../src/core/orchestrator/OrchestratorEventLoop.ts). It subscribes to `AgentBus` events, schedules runnable agents up to `maxConcurrentAgents`, creates worktrees, starts background tasks, and reacts to completion or failure.

For each runnable agent, the loop:

1. Creates or receives a worktree path from the worktree manager.
2. Builds an agent-specific user message containing the goal, shared context, task, owned files, prohibited files, dependencies, signals, and worktree path.
3. Builds a system prompt suffix telling the agent to stay inside ownership boundaries, use normal sequential tools, prefer write/edit tools over shell file writes, avoid delegation, use coordination only for real questions and answers, and finish with `attempt_completion`.
4. Calls the provider's task factory with background options: agent id, background mode, workspace path, mode slug, system prompt suffix, and `startTask: false`.
5. Starts the background task when scheduling allows it.

The background `Task` receives its own `cwd`, mode, provider profile context, `agentId`, and `AgentBus`. That makes ordinary tools operate inside the agent worktree while still allowing the bus to enforce plan-level constraints.

## AgentBus responsibilities

[`src/core/agents/AgentBus.ts`](../../src/core/agents/AgentBus.ts) is the central coordination primitive. It is responsible for both scheduling semantics and live observability.

### Dependencies and status

The bus tracks the active execution plan and each agent's status. A dependency is satisfied when:

- `waitFor: "complete"`: the dependency agent is in the completed set.
- `waitFor: "signal"`: the dependency agent has published the named signal.

Agents that cannot yet run are marked blocked. When dependencies change, the bus emits status events so the scheduler and UI can update.

### Write ownership and write intents

The bus enforces declared file ownership at write time. A background agent requests a write intent for a normalized relative path. The bus checks:

- Whether the file appears in the agent's `mustNotTouch` set.
- Whether another agent currently holds an active write lock for that path.
- Whether another agent owns the path.
- Whether the current agent's matching ownership is `read-only`.
- Whether unresolved incoming coordination questions should block the write.
- Whether the path was not declared in the plan, in which case the bus can allow it with an unowned warning rather than silently losing traceability.

Approved write intents are tracked until the tool releases them. Denied intents produce write-conflict events and UI banners. The UI lets the user tell the agent to wait or escalate the conflict.

### Coordination Q/A

The bus stores short team-chat events: questions and answers. Coordination is intentionally limited to real model-published question/answer exchange, not progress spam. It tracks open questions, answer state, targeted agents, related files, and recent chat history.

This matters because completion is gated when an agent has unresolved coordination obligations. A child agent should not claim completion while another agent is waiting on its answer.

### Progress, completion packets, and plan packet

The bus emits progress, status, completion, failure, and coordination events. It stores per-agent completion packets and synthesizes a plan-level completion packet once the run is done. These packets feed the status card, merge-review context, persisted tool payloads, and the parent resume directive.

## Tool enforcement and lifecycle

The parallel system relies on normal Roo tools rather than a special child-agent editing path. The difference is that background agents carry `agentId` and `agentBus`, so existing tools can request write permissions through the task object.

### Disabled and background-only tools

[`src/core/agents/backgroundAgentTools.ts`](../../src/core/agents/backgroundAgentTools.ts) disables recursive delegation and nested parallel planning for background agents:

- `new_task` is disabled.
- `plan_parallel_tasks` is disabled.

It also makes `coordinate_agents` available only to background parallel-agent tasks.

The task's native-tool filtering in [`src/core/task/Task.ts`](../../src/core/task/Task.ts) applies those restrictions before model tool schemas are exposed.

### Write and edit tools

The file-writing tools all request an agent write intent before changing the filesystem and release it afterward:

- [`src/core/tools/WriteToFileTool.ts`](../../src/core/tools/WriteToFileTool.ts)
- [`src/core/tools/ApplyDiffTool.ts`](../../src/core/tools/ApplyDiffTool.ts)
- [`src/core/tools/ApplyPatchTool.ts`](../../src/core/tools/ApplyPatchTool.ts)
- [`src/core/tools/EditTool.ts`](../../src/core/tools/EditTool.ts)
- [`src/core/tools/EditFileTool.ts`](../../src/core/tools/EditFileTool.ts)
- [`src/core/tools/SearchReplaceTool.ts`](../../src/core/tools/SearchReplaceTool.ts)
- [`src/core/tools/GenerateImageTool.ts`](../../src/core/tools/GenerateImageTool.ts)

For background agents, several edit paths save directly instead of focusing or disrupting the user's active editor. Multi-file patch application acquires intents for every affected path, including both source and destination paths for moves.

### Execute command recovery

[`src/core/tools/ExecuteCommandTool.ts`](../../src/core/tools/ExecuteCommandTool.ts) remains available for commands, tests, builds, package managers, scripts, and shell operations. It adds recovery guidance for background agents when a command appears to be an embedded shell file write, such as heredocs, here-strings, or echo chains. The agent is told to retry with normal write/edit tools so ownership checks and file-progress handling are preserved.

Command output also has flow-control support. Long output can be persisted and later queried through the command-output reader rather than flooding the conversation.

### Coordination tool

[`src/core/tools/CoordinateAgentsTool.ts`](../../src/core/tools/CoordinateAgentsTool.ts) enforces that `coordinate_agents` is only used by background parallel agents. It supports:

- `read`: return recent team chat and open questions.
- `publish` with `kind: "question"`: ask a targeted or general question.
- `publish` with `kind: "answer"`: answer a prior question, usually with `replyToId`.

Terminal agents suppress further publish operations once marked terminal, which prevents late chat after completion.

### Attempt completion and terminal guards

[`src/core/tools/AttemptCompletionTool.ts`](../../src/core/tools/AttemptCompletionTool.ts) has parallel-agent-specific behavior. Before completing, it checks whether the agent has unresolved coordination questions. If so, it blocks completion and returns a tool error explaining what must be answered.

When completion is valid, the tool marks the parallel agent terminal, cancels the current request, and emits task-completed events. [`src/core/task/Task.ts`](../../src/core/task/Task.ts) and the bus use terminal state to prevent further meaningful tool activity after the child has completed.

## Worktree lifecycle

[`src/core/agents/WorktreeManager.ts`](../../src/core/agents/WorktreeManager.ts) isolates child work from the main workspace and controls materialization.

### Baseline capture

Before agents start, the provider validates the Git repository and captures a baseline reference under:

```text
refs/roo/parallel-baselines/<plan>
```

The baseline gives the system a stable comparison point for each child worktree. It excludes sensitive or irrelevant files such as `.roo/parallel-worktrees`, `.rooignore`, and `.env*` from baseline capture behavior.

### Worktree path

The current worktree path is generated under the user's home directory:

```text
<home>/.roo/parallel-worktrees/<repo-name>-<repo-hash>/<plan>/<agent>
```

The repo hash is derived from the resolved Git root, which avoids collisions between repositories with the same folder name. The path is outside the main repository, reducing accidental inclusion in source control and avoiding nested worktree noise in the workspace.

### Diff collection and review

After all agents finish, the provider asks the worktree manager to collect diffs and merge-review entries. Review entries include status, changed files, conflicted files, diff text when available, change stats, review errors, merge errors, and artifact metadata.

The merge review is stored in the same `parallelAgents` tool payload that feeds the UI. This makes the review durable across reloads and available to the parent resume flow.

### Materialization and cleanup

On approval, the provider materializes approved agent changes into the main workspace. Depending on the review result, this can involve merge operations or fallback copy/materialization paths. Denied or failed merge reviews keep the parent from pretending the plan succeeded.

After materialization or cancellation, the provider tears down spawned tasks, bus state, worktrees, and active plan state as appropriate. Cleanup is also part of resume and abort paths so stale worktrees and status listeners are less likely to leak between runs.

## UI flow

### Plan preview

[`webview-ui/src/components/agents/PlanPreviewModal.tsx`](../../webview-ui/src/components/agents/PlanPreviewModal.tsx) is the user's first explicit control point. It displays the plan id, shared context, each agent's id, mode, current status, task description, owned files, and dependencies. Approval sends `approvePlan`; cancellation sends `cancelPlan`.

### Persistent status card

The provider persists a tool message with `tool: "parallelAgents"`. [`webview-ui/src/components/chat/ChatRow.tsx`](../../webview-ui/src/components/chat/ChatRow.tsx) renders that tool row with [`webview-ui/src/components/agents/AgentStatusPanel.tsx`](../../webview-ui/src/components/agents/AgentStatusPanel.tsx).

The status panel shows:

- Overall plan summary: completed agents, running agents, and plan id.
- Coordination team chat and question answer state.
- Write-intent conflicts and user actions to wait or escalate.
- Inline merge-review evidence and expandable diffs.
- Per-agent task, status, current activity, activity timeline, owned files, disallowed files, dependencies, usage, worktree path, last touched file, and conflict details.

The panel also listens for live extension messages: status updates, coordination updates, write-intent denials, and cleared conflicts.

### Merge controls

There is no standalone merge review panel in the current workspace. Merge review is displayed inline in [`webview-ui/src/components/agents/AgentStatusPanel.tsx`](../../webview-ui/src/components/agents/AgentStatusPanel.tsx), with helper formatting in [`webview-ui/src/components/agents/mergeReviewDisplay.ts`](../../webview-ui/src/components/agents/mergeReviewDisplay.ts). [`webview-ui/src/components/chat/ChatView.tsx`](../../webview-ui/src/components/chat/ChatView.tsx) detects the latest `parallelAgents` tool payload in `review` status and wires the primary and secondary bottom buttons to `mergeApprovedAgents` and `mergeDeniedAgents` messages.

### Cost display

Parallel child task costs are aggregated into the parent task view. [`src/core/webview/aggregateTaskCosts.ts`](../../src/core/webview/aggregateTaskCosts.ts) recursively aggregates explicit child ids plus metadata-linked children such as background parallel agents with a `parentTaskId`. [`webview-ui/src/components/chat/TaskHeader.tsx`](../../webview-ui/src/components/chat/TaskHeader.tsx) displays the aggregated cost and marks it as including subtasks.

## Persistence and resume

Parallel execution state is designed to survive common reload and history scenarios.

Persisted pieces include:

- The `parallelAgents` tool payload in chat history.
- The canonical `ExecutionPlan`.
- Current phase such as running, review, completed, failed, or cancelled.
- Agent status updates and activities.
- Write-intent conflicts.
- Coordination events.
- Agent completion packets.
- The plan-level completion packet.
- Merge-review entries.
- Usage summaries.
- Background task metadata linking child agents to the parent task.

When history is restored, the provider can reconstruct paused parent execution, status-card state, and background child relationships. The task-level `restoreParallelExecutionPause` path prevents the parent from accidentally resuming as if the parallel run had never been active.

Cost aggregation uses metadata-linked children, not only explicit subtask arrays, so background agents created programmatically still contribute to the visible parent cost.

## End-to-end sequence diagram

```mermaid
sequenceDiagram
    participant User
    participant Parent as Parent Task
    participant Planner as plan_parallel_tasks
    participant Provider as ClineProvider
    participant UI as Webview UI
    participant Bus as AgentBus
    participant WM as WorktreeManager
    participant Loop as OrchestratorEventLoop
    participant A as Background Agent A
    participant B as Background Agent B

    User->>Parent: Request work that can be split safely
    Parent->>Planner: Propose goal, shared context, expected files, agents
    Planner-->>Parent: Validated ExecutionPlan or validation errors
    Parent->>Provider: Request plan approval
    Provider->>UI: showPlanPreview
    UI-->>Provider: approvePlan or cancelPlan
    alt approved
        Provider->>WM: Validate repo and capture baseline ref
        Provider->>Bus: Register plan and attach event forwarders
        Provider->>Loop: Start plan with max concurrency
        Parent-->>Parent: Pause parallel execution flow
        Loop->>Bus: Query runnable agents
        Loop->>WM: Create per-agent worktrees
        Loop->>A: Create/start background task in agent worktree
        Loop->>B: Create/start background task in agent worktree
        A->>Bus: Status, progress, write intents, coordination
        B->>Bus: Status, progress, write intents, coordination
        Bus->>Provider: Forward live events
        Provider->>UI: Update parallelAgents status card
        A->>Bus: Completion packet through attempt_completion
        B->>Bus: Completion packet through attempt_completion
        Bus->>Loop: All complete
        Loop->>Provider: Synthesize plan completion
        Provider->>WM: Collect diffs and merge review entries
        Provider->>UI: Show inline merge review
        UI-->>Provider: mergeApprovedAgents or mergeDeniedAgents
        alt merge approved
            Provider->>WM: Materialize approved changes
            Provider->>WM: Cleanup worktrees and baseline state
            Provider->>Parent: Resume with completion packet and verification directive
        else merge denied
            Provider->>WM: Cleanup or preserve diagnostics as configured
            Provider->>Parent: Resume with denied/failed review context
        end
    else cancelled
        Provider->>Parent: Resume/cancel parallel plan path
    end
```

## Recent integration fixes and why they matter

The current source shows several fixes and guardrails that are important for safe parallel execution:

| Fix or guardrail                                                                  | Why it matters                                                                                                        |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Background agents cannot use `new_task` or `plan_parallel_tasks`.                 | Prevents recursive uncontrolled delegation and nested parallel plans that the parent cannot review coherently.        |
| `coordinate_agents` is background-only and limited to real Q/A.                   | Keeps team chat meaningful and avoids turning status updates into noisy coordination messages.                        |
| `attempt_completion` blocks unresolved coordination obligations.                  | Prevents an agent from finishing while another agent is still waiting on its answer.                                  |
| Write/edit/image tools acquire and release write intents.                         | Makes ownership enforcement consistent across normal file writes, patches, replacements, and generated image outputs. |
| Background write tools can save directly.                                         | Avoids disrupting the user's focused editor while background agents update isolated worktrees.                        |
| Shell-write recovery guidance steers agents back to write/edit tools.             | Preserves ownership checks and avoids hidden file edits through heredocs or echo chains.                              |
| Worktrees are generated under the user's home `.roo` area with a repository hash. | Avoids polluting the repository and reduces path collisions across similarly named repos.                             |
| Parent resume includes a no-broad-re-review directive.                            | Keeps parent verification targeted to structured evidence and unresolved risks instead of redoing all child work.     |
| Metadata-linked background children are included in cost aggregation.             | Makes parent task cost reflect programmatically created parallel agents.                                              |
| Terminal guards mark completed agents and suppress late coordination/tool flow.   | Reduces duplicate completion, stale messages, and post-completion side effects.                                       |

## Known limitations and edge cases

1. The system depends on Git. Parallel execution requires a valid Git repository and a capturable baseline.
2. Plan quality matters. Bad ownership boundaries can produce unowned warnings, conflicts, blocked writes, or poor merge-review evidence.
3. `shared` ownership still requires careful agent behavior. Shared paths reduce hard exclusivity but do not remove the need for coordination.
4. Dependency signals are only useful if agents publish the expected signal. A missing signal can leave downstream agents blocked.
5. Merge review can fail or produce conflicts. The user may need to deny materialization or resolve issues manually if generated diffs cannot be applied safely.
6. Background command output may be truncated or persisted separately. Agents need to use command-output reading flow when long-running commands produce large logs.
7. Unowned writes can be allowed with warnings. This avoids dead-ending useful work, but it weakens plan traceability and should be treated as a plan-quality issue.
8. Parent verification intentionally avoids broad re-review. This is efficient, but it assumes completion packets and merge-review evidence are reliable; manual inspection remains appropriate when evidence is missing or contradictory.
9. No standalone merge review panel exists in the current UI tree. Merge review is inline in the agent status panel and controlled through chat-level primary and secondary buttons.

## Operational notes

- Use parallel agents when files and responsibilities can be divided cleanly. Use sequential delegation for tightly coupled work.
- Keep `expectedFiles` aligned with ownership declarations so validation can catch gaps before approval.
- Prefer `complete` dependencies only when downstream work truly needs finished artifacts; use `signal` dependencies for narrower handoffs.
- Treat write-intent conflicts as design feedback. They usually mean ownership is too broad, too narrow, or incorrectly shared.
- Encourage agents to coordinate with concise questions and answers tied to files or decisions.
- Review merge entries before materialization, especially when changes are generated across shared or adjacent files.
- Use structured completion packets, review evidence, and targeted checks to verify the plan after merge.

## Glossary

- **Execution plan**: The approved plan containing shared context, agents, ownership, dependencies, and plan metadata.
- **Parent task**: The original task that requested or planned the parallel work.
- **Background agent**: A child `Task` created programmatically to execute one agent plan in a worktree.
- **AgentBus**: The in-memory coordination bus for status, dependencies, write intents, coordination messages, and completion packets.
- **Write intent**: A temporary per-path lock and permission check requested by a background agent before a writing tool modifies a file.
- **Completion packet**: Structured evidence emitted by an agent or plan summarizing artifacts, status, validation, and review information.
- **Merge review**: The provider-generated review phase that displays child-agent diffs and lets the user approve or deny materialization.
- **Materialization**: Bringing approved worktree changes back into the main workspace.

# C Code

> Cmizz's personal Roo Code fork for VS Code: an AI dev team in your editor with parallel agents, MCP workflows, Codex fast mode, SMTP completion rollups, expanded provider support, and Windows-safe tooling.

C Code is Cmizz's independently maintained fork of the original [Roo Code](https://github.com/RooCodeInc/Roo-Code) extension. It keeps the agentic coding workflow that made Roo Code useful while giving the project its own name, repository, release path, and fork-specific features under the C Code / Cmizz identity.

This fork is built for practical day-to-day development: planning, coding, debugging, coordinating agents, connecting MCP tools, tracking status clearly, and finishing work with reliable completion reporting.

---

## Highlights in the C Code fork

- **Parallel agents for larger workflows** — split complex work across coordinated background agents, checkpoint before execution, review worktree output, and merge approved agent results back into the parent task.
- **Active agent coordination** — parallel agents communicate during execution, coordinate ownership and write intent, avoid stepping on each other's files, and surface coordination/status information in the UI.
- **MCP Marketplace and setup flows** — discover MCP servers for search, code, docs, databases, files, browsers, and team workflows; launch guided MCP setup tasks; and create custom local MCP servers from natural language requirements.
- **SMTP completion notifications** — send task outcome emails using saved SMTP settings, including final parent workflow rollups with overall task summaries, child-task context, requests, token usage, cost, and tool attempt/failure counts without exposing transcripts or secrets.
- **OpenAI Codex / ChatGPT Plus/Pro workflow support** — use the OpenAI Codex provider with OAuth-style ChatGPT subscription access, GPT-5.x/Codex model defaults, fast-mode controls, and authentication/status reporting.
- **Expanded provider and model support** — includes Xiaomi MiMo, DeepSeek, OpenRouter, Requesty, Vercel AI Gateway, Qwen Code, LM Studio, OpenAI, Anthropic, Gemini, xAI, Bedrock, Vertex, Moonshot, MiniMax, Mistral, Fireworks, SambaNova, Poe, and other provider metadata updates from the fork.
- **Xiaomi MiMo AMS-ready support** — adds Xiaomi MiMo chat models with a MiMo V2.5 Pro default model, long-context metadata, official pricing metadata, and both standard and token-plan AMS endpoint options.
- **Windows-safe command behavior** — command guidance and execution handling are tuned for Windows shells while preserving normal cross-platform development workflows.
- **Settings and i18n reliability fixes** — settings views, cached state handling, startup localization, provider composition, and translated UI paths have fork-specific fixes and tests.
- **Organized specialist modes** — C Code keeps the core Roo workflow while adding organized specialist modes for frontend, backend, quality, planning, MCP setup, DevOps, platform work, and repository operations.

---

## What C Code does

C Code brings an AI coding assistant into VS Code that can help with:

- Writing and editing code from natural language instructions
- Refactoring existing files and improving project structure
- Debugging errors, tracing root causes, and explaining behavior
- Reading project context and summarizing relevant files
- Updating documentation, release notes, and configuration
- Automating repetitive development tasks through tools and terminal commands
- Coordinating delegated subtasks and parallel agent workflows
- Connecting MCP servers and external development tooling
- Watching task status and receiving completion rollups when long workflows finish

---

## Provider updates

C Code keeps the broad provider ecosystem from Roo Code and adds fork-specific provider/model updates for subscription-backed Codex work, router-backed models, and OpenAI-compatible services:

- **OpenAI Codex / ChatGPT Plus/Pro** — subscription-backed Codex provider support with GPT-5.5 as the current default, GPT-5.4, GPT-5.4 Mini, GPT-5.2, GPT-5.1, GPT-5, GPT-5 Codex, GPT-5 Codex Mini, GPT-5.1 Codex, GPT-5.1 Codex Max, GPT-5.1 Codex Mini, GPT-5.2 Codex, GPT-5.3 Codex, and GPT-5.3 Codex Spark model entries. Models that support Fast mode expose fast-mode controls and report requested/confirmed/rejected status back to the UI.
- **Xiaomi MiMo** — OpenAI-compatible Xiaomi MiMo provider support with MiMo V2.5 Pro as the default model, MiMo V2 Pro, MiMo V2.5, MiMo V2 Omni, and MiMo V2 Flash metadata, long-context limits, reasoning controls, official pricing metadata, and standard or token-plan AMS base URL choices.
- **DeepSeek and reasoning-capable models** — DeepSeek provider/model metadata and reasoning/tool-call handling are kept current with the fork's streaming and model-parameter paths.
- **Router and gateway providers** — OpenRouter, Requesty, Vercel AI Gateway, LiteLLM, LM Studio, Qwen Code, and other router-style providers are wired through the provider selector, default model handling, validation, and selected-model UI paths.
- **Major model families** — Anthropic, OpenAI Native, Gemini, xAI/Grok, Bedrock, Vertex, Moonshot, MiniMax, Mistral, Fireworks, SambaNova, Poe, Ollama, and OpenAI-compatible providers continue to receive static metadata, pricing, reasoning, prompt-cache, image, and tool-use updates where supported.

---

## Parallel agents and coordination

C Code treats larger jobs like coordinated team workflows rather than one long linear task:

- Orchestrator and Architect can split work into explicit plans with shared context, agent IDs, specialist modes, owned files, must-not-touch paths, and dependencies.
- Background agents run in coordinated worktrees so independent work can progress in parallel without overwriting unrelated files.
- Agents actively communicate status, ownership, write intent, dependency progress, and coordination events during the process.
- The UI surfaces agent lifecycle and coordination state, including agent status panels, labels, activity details, merge review summaries, and parent/child workflow status.
- Parent tasks receive rollups from completed child tasks so the final workflow summary includes what each agent completed and what still needs attention.

---

## MCP Marketplace and workflows

C Code includes MCP workflow improvements for discovering, installing, configuring, and creating Model Context Protocol servers:

- Browse marketplace-style MCP entries grouped by practical use cases such as search, code, documentation, databases, files, browsers, project management, and team workflows.
- Launch guided setup tasks that preserve existing MCP configuration, protect secrets by using environment placeholders, and verify capabilities safely.
- Use the dedicated MCP Setup mode for server installation, settings updates, troubleshooting, and read-only verification when possible.
- Create custom local MCP servers from natural language requirements when marketplace entries do not cover the desired workflow.
- Keep MCP setup/discovery separate from unrelated coding work so server configuration remains focused and auditable.

---

## Stable release

- **Current stable C Code version:** 3.53.0
- **Publisher / publication identity:** Cmizz
- **Package name:** `c-code`
- **Stable VSIX artifact:** `bin/c-code-3.53.0.vsix`

Version 3.53.0 is kept as the latest stable C Code release line unless a future release intentionally bumps the extension version.

---

## Modes

C Code keeps the mode-based workflow from Roo Code and organizes it for day-to-day development:

- **Defaults** — Architect, Code, Debug, and Orchestrator for planning, implementation, troubleshooting, and parallel delegation.
- **Frontend** — UI/UX, Component, CSS Styling, Accessibility, and Animation for webview and interface work.
- **Backend** — API, Database, Auth, Background Jobs, Caching, and Search for service, persistence, and retrieval work.
- **Fullstack** — Integration and Realtime for cross-layer features and streaming behavior.
- **Quality** — Review, Test, Security, Performance, and Refactor for safer changes and validation.
- **Planning** — Spec, Explain, Memory, Diagram, Migration, and Onboarding for requirements, documentation, project knowledge, and safe transitions.
- **Configuration** — MCP Setup for marketplace setup tasks, MCP settings updates, server installation, troubleshooting, and capability verification.
- **DevOps and platform** — DevOps, Mobile, CLI Tools, and Browser Extension for release automation, packaging, command-line tools, and platform-specific work.
- **Repository helper modes** — Translate, Issue Fixer, PR Fixer, Merge Resolver, Docs Extractor, Issue Investigator, and Issue Writer are available for localization, GitHub workflows, conflict resolution, and documentation source extraction.
- **Custom Modes** — create specialized workflows for different tasks while keeping tool permissions scoped to the work.

---

## Completion notifications

C Code can send SMTP completion notifications when configured in settings:

- Individual tasks can report completion, failure, cancellation, token usage, cost, tool attempt counts, and final summaries.
- Parent workflows can send final rollups after delegated or parallel child tasks finish, so long-running agent plans produce one clear overall status email.
- Notifications avoid including full transcripts or secrets and are designed for status visibility rather than data export.

---

## Project status

C Code is a personal fork maintained by Cmizz. The goal is to keep the extension useful, understandable, and actively adaptable for Cmizz's workflow while preserving the original Roo Code foundation.

This project is independent, experimental, and provided as-is.

---

## GitHub repository

Main fork repository:

- [Cmizz24/C-Code](https://github.com/Cmizz24/C-Code)

Original upstream project:

- [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code)

---

## Attribution

C Code is based on Roo Code and remains licensed under Apache 2.0.

Huge respect and thanks go to Roo Code, Inc., the Roo Code maintainers, contributors, and the wider community for building the original extension. This fork starts from their work and keeps that history visible.

This project is not affiliated with, endorsed by, or maintained by Roo Code, Inc. It is an independent personal fork.

---

## Safety note

AI coding tools can make mistakes. Always review generated code, understand commands before running them, and be careful with secrets, private files, and provider API keys.

C Code is provided on an **as-is** basis. You are responsible for how you use it and for reviewing any code or commands it suggests.

---

## License

[Apache 2.0](./LICENSE) — original copyright and license notices are retained.

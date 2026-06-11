# C Code

> Cmizz's personal Roo Code fork for VS Code: an AI dev team in your editor with long-term memory, first-run local AI setup, native image generation, Visual Browser Inspector, parallel agents, MCP workflows, Codex fast mode, SMTP completion rollups, opt-in diagnostics, expanded provider support, and Windows-safe tooling.

C Code is Cmizz's independently maintained fork of the original [Roo Code](https://github.com/RooCodeInc/Roo-Code) extension. It keeps the agentic coding workflow that made Roo Code useful while giving the project its own name, repository, release path, and fork-specific features under the C Code / Cmizz identity.

This fork is built for practical day-to-day development: planning, coding, debugging, coordinating agents, connecting MCP tools, tracking status clearly, and finishing work with reliable completion reporting.

---

## Highlights in the C Code fork

Compared with upstream Roo Code, C Code keeps the familiar agentic coding workflow while adding, changing, and removing behavior for Cmizz's release path and day-to-day workflow:

- **Parallel agents for larger workflows** — split complex work across coordinated background agents, checkpoint before execution, review worktree output, and merge approved agent results back into the parent task.
- **Active agent coordination** — parallel agents communicate during execution, coordinate ownership and write intent, avoid stepping on each other's files, and surface coordination/status information in the UI.
- **Long-term memory** — store and retrieve local conversation memories, search memory, capture mistakes for later reuse, approve pending memories, show memory cards in chat, manage Memory settings, wipe stored memory, and delete individual memories.
- **First-run local AI setup** — the welcome flow can check hardware, recommend local AI paths, guide Ollama and LM Studio setup, warn on weak hardware, and keep provider selection clearer for first-time users.
- **Native image generation** — generate or edit images directly from chat with the `generate_image` tool, prompt approval, workspace-relative save paths, previews in chat, and dedicated Image Generation settings.
- **Cloudflare Workers AI image generation** — use Cloudflare Workers AI as a supported image provider with account/model settings plus usage details such as provider-reported or locally estimated Neurons, cost, reset, and quota notes when available.
- **OpenRouter dynamic image models** — discover image-capable OpenRouter models dynamically, keep provider/model caches scoped correctly, and surface refreshed provider metadata in model selection flows.
- **Visual Browser Inspector** — inspect visual browser state for UI debugging and chat handoff workflows with Playwright browser-management, retry/browser cleanup, lifecycle coverage, and recommended-fixes grouping improvements.
- **Privacy-safe diagnostics when you choose Debug mode** — if you enable Debug mode while reporting an issue, C Code can send only the diagnostic details needed to troubleshoot and improve the fork. Diagnostic payloads avoid transcripts, secrets, private file contents, and provider credentials.
- **MCP Marketplace and setup flows** — discover MCP servers for search, code, docs, databases, files, browsers, and team workflows; launch guided MCP setup tasks; and create custom local MCP servers from natural language requirements.
- **SMTP completion notifications** — send task outcome emails using saved SMTP settings, including final parent workflow rollups with overall task summaries, child-task context, requests, token usage, cost, and tool attempt/failure counts without exposing transcripts or secrets.
- **OpenAI Codex / ChatGPT Plus/Pro workflow support** — use the OpenAI Codex provider with OAuth-style ChatGPT subscription access, GPT-5.x/Codex model defaults, fast-mode controls, authentication/status reporting, stale unsupported model filtering, and supported-model fallback.
- **Prompt enhancement compatibility** — Codex prompt enhancement completions and provider-context fixes keep Enhance Prompt working across provider choices.
- **Orchestrator and delegation reliability** — delegated completion restores parent task state cleanly, with worktree/test hardening for safer multi-agent workflows.
- **Expanded provider and model support** — includes Xiaomi MiMo, DeepSeek, OpenRouter, Requesty, Vercel AI Gateway, Qwen Code, LM Studio, OpenAI, Anthropic, Gemini, xAI, Bedrock, Vertex, Moonshot, MiniMax, Mistral, Fireworks, SambaNova, Poe, and other provider metadata updates from the fork.
- **Xiaomi MiMo AMS-ready support** — adds Xiaomi MiMo chat models with a MiMo V2.5 Pro default model, long-context metadata, official pricing metadata, and both standard and token-plan AMS endpoint options.
- **Windows-safe command behavior** — command guidance and execution handling are tuned for Windows shells while preserving normal cross-platform development workflows.
- **Settings and i18n reliability fixes** — settings views, cached state handling, startup localization, provider composition, and translated UI paths have fork-specific fixes and tests.
- **Organized specialist modes** — C Code keeps the core Roo workflow while adding organized specialist modes for frontend, backend, quality, planning, MCP setup, DevOps, platform work, and repository operations.
- **Image-generation provider choices** — image creation is available through OpenRouter, OpenAI/OpenAI-compatible endpoints, and Cloudflare Workers AI, configured separately from chat provider profiles.

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
- **Image-generation providers** — OpenRouter image-output models, OpenAI/OpenAI-compatible Images API models, and Cloudflare Workers AI image models are available through the dedicated image-generation settings and native tool flow.
- **Xiaomi MiMo** — OpenAI-compatible Xiaomi MiMo provider support with MiMo V2.5 Pro as the default model, MiMo V2 Pro, MiMo V2.5, MiMo V2 Omni, and MiMo V2 Flash metadata, long-context limits, reasoning controls, official pricing metadata, and standard or token-plan AMS base URL choices.
- **DeepSeek and reasoning-capable models** — DeepSeek provider/model metadata and reasoning/tool-call handling are kept current with the fork's streaming and model-parameter paths.
- **Router and gateway providers** — OpenRouter, Requesty, Vercel AI Gateway, LiteLLM, LM Studio, Qwen Code, and other router-style providers are wired through the provider selector, default model handling, validation, and selected-model UI paths.
- **Major model families** — Anthropic, OpenAI Native, Gemini, xAI/Grok, Bedrock, Vertex, Moonshot, MiniMax, Mistral, Fireworks, SambaNova, Poe, Ollama, and OpenAI-compatible providers continue to receive static metadata, pricing, reasoning, prompt-cache, image, and tool-use updates where supported.

---

## Long-term memory and local AI setup

C Code 3.54.1 brings user-facing memory and local onboarding improvements:

- Save local conversation memories, search them from tools, surface matching memory cards in chat, and manage memory approval before entries become active.
- Capture mistake memories, archive or reuse existing memory, wipe stored memory when needed, and delete individual memories from the UI.
- Configure Memory settings separately from provider settings so memory behavior stays visible and controllable.
- Start first-run local AI onboarding with hardware checks, local-provider recommendations, guided Ollama setup, guided LM Studio setup, weak-hardware warnings, and refined provider selection.
- Use local Ollama and LM Studio for guided local chat/provider setup while image generation stays in its dedicated settings and tool flow.

---

## Image generation and visual inspection

C Code 3.54.1 keeps creation and inspection workflows clear:

- Ask C Code to generate or edit an image from chat, approve or adjust the prompt, and save the result directly into your workspace.
- Configure OpenRouter, OpenAI/OpenAI-compatible, or Cloudflare Workers AI image generation separately from chat provider profiles.
- Review generated image previews and safe provider metadata in chat, including Cloudflare Workers AI usage estimates when available.
- Use Visual Browser Inspector for UI/browser inspection workflows with improved browser lifecycle handling, retries, cleanup, and grouped recommended fixes while keeping image generation routed through the dedicated `generate_image` tool.

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

- **Current stable C Code version:** 3.54.1
- **Publisher / publication identity:** Cmizz
- **Package name:** `c-code`
- **Stable VSIX artifact:** `bin/c-code-3.54.1.vsix`

Version 3.54.1 is the current stable C Code patch release line for the next official GitHub release.

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

## Opt-in diagnostics

C Code includes an opt-in diagnostics path for debugging fork-specific issues:

- Diagnostics are controlled by Debug mode and are off by default.
- If you report an issue, enabling Debug mode can help C Code development by sending only the diagnostics needed to troubleshoot the problem.
- Payloads avoid transcripts, secrets, private file contents, and provider credentials.

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

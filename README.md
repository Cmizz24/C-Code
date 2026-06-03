# C Code

> Cmizz's personal Roo Code fork for VS Code: an AI dev team in your editor with parallel agents, MCP workflows, Codex fast mode, SMTP completion rollups, and Windows-safe tooling.

C Code is Cmizz's independently maintained fork of the original [Roo Code](https://github.com/RooCodeInc/Roo-Code) extension. It keeps the agentic coding workflow that made Roo Code useful while giving the project its own name, repository, release path, and fork-specific features.

This fork is built for practical day-to-day development: planning, coding, debugging, coordinating agents, connecting MCP tools, and finishing work with safer status reporting.

---

## Highlights in the C Code fork

- **Parallel agents for larger workflows** — split complex work across coordinated background agents, track per-agent status, checkpoint before execution, review worktree output, and merge approved agent results back into the parent task.
- **MCP Marketplace and setup flows** — discover trusted MCP servers for search, code, docs, databases, files, and team workflows; launch guided MCP setup tasks; and create custom local MCP servers from natural language requirements.
- **SMTP completion notifications** — send task outcome emails using saved SMTP settings, including final parent workflow rollups with overall task summaries, child-task context, requests, token usage, cost, and tool attempt/failure counts without exposing transcripts or secrets.
- **OpenAI Codex / ChatGPT Plus/Pro workflow support** — use the OpenAI Codex provider with fast-mode controls, authentication/status reporting, and model defaults designed for ChatGPT subscription-backed coding sessions.
- **Xiaomi MiMo provider support** — includes Xiaomi MiMo AMS model support and fork defaults for that provider path.
- **Windows-safe command behavior** — command guidance and execution handling are tuned for Windows shells while preserving normal cross-platform development workflows.
- **Settings and i18n reliability fixes** — settings views, cached state handling, startup localization, provider composition, and translated UI paths have fork-specific fixes and tests.
- **Mode-based development** — Code, Architect, Ask, Debug, Orchestrator, Issue/PR helpers, translation, docs, merge resolution, and custom modes remain available for different tasks.

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

---

## Stable release

- **Current stable C Code version:** 3.53.0
- **Publisher / publication identity:** Cmizz
- **Package name:** `c-code`
- **Stable VSIX artifact:** `bin/c-code-3.53.0.vsix`

Version 3.53.0 is kept as the latest stable C Code release line unless a future release intentionally bumps the extension version.

---

## Modes

C Code keeps the mode-based workflow from Roo Code and adapts it for day-to-day development:

- **Code Mode** — make edits, write code, and work directly with files
- **Architect Mode** — plan features, designs, migrations, and larger changes
- **Ask Mode** — explain code, answer questions, and inspect the project
- **Debug Mode** — investigate errors, trace issues, and find root causes
- **Orchestrator Mode** — coordinate multi-step projects and delegate subtasks
- **Custom Modes** — create specialized workflows for different tasks

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

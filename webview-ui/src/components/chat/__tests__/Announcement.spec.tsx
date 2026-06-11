import React from "react"

import { render, screen } from "@/utils/test-utils"

import Announcement from "../Announcement"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@roo/package", () => ({
	Package: {
		version: "3.54.1",
	},
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ children, href, onClick, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={href} onClick={onClick} {...props}>
			{children}
		</a>
	),
}))

vi.mock("react-i18next", () => ({
	Trans: ({
		i18nKey,
		components,
		values,
	}: {
		i18nKey: string
		components?: Record<string, React.ReactElement>
		values?: { version?: string }
	}) => {
		if (i18nKey === "chat:announcement.finalRelease.intro") {
			return (
				<span>
					This C Code {values?.version ?? "{{version}}"} update focuses on practical C Code improvements for
					daily development. Follow the fork repository for release notes, fixes, and development updates:{" "}
					{components?.repoLink && React.cloneElement(components.repoLink, {}, "Cmizz24/C-Code")}.
				</span>
			)
		}

		if (i18nKey === "chat:announcement.finalRelease.alternatives") {
			return (
				<span>
					For issue reports, source changes, and GitHub release notes, use the{" "}
					{components?.repoLink && React.cloneElement(components.repoLink, {}, "C Code GitHub repository")}.
				</span>
			)
		}

		return <span>{i18nKey}</span>
	},
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: { version?: string }) => {
			const translations: Record<string, string> = {
				"chat:announcement.finalRelease.title": `C Code ${options?.version ?? "3.54.1"} update`,
				"chat:announcement.finalRelease.summary":
					"This release highlights the current C Code experience: long-term memory, local AI onboarding, image creation, Visual Browser Inspector reliability, prompt enhancement compatibility, provider/tooling updates, diagnostics, and orchestrator fixes.",
				"chat:announcement.finalRelease.highlightsHeading": "Highlights in this release:",
				"chat:announcement.finalRelease.memory":
					"Long-term memory with local conversation-memory storage and retrieval, memory search, mistake memory, approval flow, chat memory cards, Memory settings, wipe tooling, and individual deletion.",
				"chat:announcement.finalRelease.localAiSetup":
					"First-run local AI setup with hardware checks, Ollama and LM Studio recommendations/setup, weak-hardware warnings, and refined welcome-provider selection.",
				"chat:announcement.finalRelease.imageGeneration":
					"Native image generation from chat, with Image Generation settings, prompt approval, previews, and OpenRouter, OpenAI/OpenAI-compatible, and Cloudflare Workers AI providers.",
				"chat:announcement.finalRelease.visualInspector":
					"Visual Browser Inspector reliability improvements with Playwright browser management, retry/browser cleanup fixes, lifecycle coverage, and grouped recommended fixes.",
				"chat:announcement.finalRelease.promptEnhancement":
					"Codex prompt enhancement completions and provider-context compatibility fixes keep Enhance Prompt working across providers.",
				"chat:announcement.finalRelease.orchestration":
					"Orchestrator and delegation fixes restore parent tasks cleanly after delegated completion and harden worktree/test flows.",
				"chat:announcement.finalRelease.providerTooling":
					"MCP Marketplace/setup flows, ChatGPT Plus/Pro Codex model hygiene, provider/model metadata, settings/i18n, diagnostics, and Windows-safe tooling stay current.",
				"chat:announcement.finalRelease.diagnosticsHelp":
					"Help improve C Code by enabling Debug mode when reporting issues. Diagnostics send only the details needed to troubleshoot problems and avoid transcripts, secrets, private file contents, and provider credentials.",
				"chat:announcement.finalRelease.signoff": "Thanks for using C Code.",
			}

			return translations[key] ?? key
		},
	}),
}))

describe("Announcement", () => {
	it("renders the C Code fork update announcement", () => {
		render(<Announcement hideAnnouncement={vi.fn()} />)

		expect(screen.getByText("C Code 3.54.1 update")).toBeInTheDocument()
		expect(screen.getByText(/This C Code 3.54.1 update focuses/)).toBeInTheDocument()
		expect(screen.queryByText(/\{\{version\}\}/)).not.toBeInTheDocument()
		expect(
			screen.getByText(
				"This release highlights the current C Code experience: long-term memory, local AI onboarding, image creation, Visual Browser Inspector reliability, prompt enhancement compatibility, provider/tooling updates, diagnostics, and orchestrator fixes.",
			),
		).toBeInTheDocument()
		expect(screen.getByText("Highlights in this release:")).toBeInTheDocument()
		expect(screen.getByText(/Long-term memory with local conversation-memory storage/)).toBeInTheDocument()
		expect(screen.getByText(/First-run local AI setup with hardware checks/)).toBeInTheDocument()
		expect(screen.getByText(/Native image generation from chat/)).toBeInTheDocument()
		expect(screen.getByText(/Cloudflare Workers AI providers/)).toBeInTheDocument()
		expect(screen.getByText(/Visual Browser Inspector reliability improvements/)).toBeInTheDocument()
		expect(screen.getByText(/Codex prompt enhancement completions/)).toBeInTheDocument()
		expect(screen.getByText(/Orchestrator and delegation fixes/)).toBeInTheDocument()
		expect(screen.getByText(/MCP Marketplace\/setup flows/)).toBeInTheDocument()
		expect(screen.getByText(/Diagnostics send only the details needed/)).toBeInTheDocument()
		expect(screen.queryByText(/not image generation/)).not.toBeInTheDocument()
		expect(screen.getByText("Thanks for using C Code.")).toBeInTheDocument()
	})

	it("renders the external links", () => {
		render(<Announcement hideAnnouncement={vi.fn()} />)

		expect(screen.getByRole("link", { name: "Cmizz24/C-Code" })).toHaveAttribute(
			"href",
			"https://github.com/Cmizz24/C-Code",
		)
		expect(screen.getByRole("link", { name: "C Code GitHub repository" })).toHaveAttribute(
			"href",
			"https://github.com/Cmizz24/C-Code",
		)
	})

	it("keeps C Code branding without corporate handoff or alternative fork links", () => {
		render(<Announcement hideAnnouncement={vi.fn()} />)

		expect(screen.queryByText("chat:announcement.handoff.description")).not.toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "X" })).not.toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "ZooCode" })).not.toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "Cline" })).not.toBeInTheDocument()
	})
})

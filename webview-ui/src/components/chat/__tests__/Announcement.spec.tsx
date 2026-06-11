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
	Trans: ({ i18nKey, components }: { i18nKey: string; components?: Record<string, React.ReactElement> }) => {
		if (i18nKey === "chat:announcement.finalRelease.intro") {
			return (
				<span>
					C Code 3.54.1 is ready from Cmizz{"'"}s consolidated fork base with the missing PR #11 content
					included. Follow the fork repository for release notes, fixes, and development updates:{" "}
					{components?.repoLink && React.cloneElement(components.repoLink, {}, "Cmizz24/C-Code")}.
				</span>
			)
		}

		if (i18nKey === "chat:announcement.finalRelease.alternatives") {
			return (
				<span>
					For issue reports, source changes, and final GitHub release notes, use the{" "}
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
				"chat:announcement.finalRelease.title": "C Code 3.54.1 corrected release",
				"chat:announcement.finalRelease.summary":
					"This corrected patch release now reflects everything merged into C Code 3.54.x: long-term memory, local AI onboarding, image creation, Visual Browser Inspector reliability, prompt enhancement compatibility, provider/tooling hygiene, diagnostics, and orchestrator fixes.",
				"chat:announcement.finalRelease.highlightsHeading": "Highlights in this corrected release:",
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
					"MCP Marketplace/setup flows, ChatGPT Plus/Pro Codex model hygiene, opt-in remote diagnostics, provider/model metadata, settings/i18n, and Windows-safe tooling remain current.",
				"chat:announcement.finalRelease.supportedImageProviders":
					"Image generation remains routed through OpenRouter, OpenAI/OpenAI-compatible endpoints, and Cloudflare Workers AI; local Ollama and LM Studio are for local chat/provider setup, not image generation.",
				"chat:announcement.finalRelease.signoff": "Thanks for using C Code.",
			}

			if (key === "chat:announcement.finalRelease.title") {
				return `${translations[key]}${options?.version ? "" : ""}`
			}

			return translations[key] ?? key
		},
	}),
}))

describe("Announcement", () => {
	it("renders the C Code fork update announcement", () => {
		render(<Announcement hideAnnouncement={vi.fn()} />)

		expect(screen.getByText("C Code 3.54.1 corrected release")).toBeInTheDocument()
		expect(screen.getByText(/C Code 3.54.1 is ready from Cmizz's consolidated fork base/)).toBeInTheDocument()
		expect(
			screen.getByText(
				"This corrected patch release now reflects everything merged into C Code 3.54.x: long-term memory, local AI onboarding, image creation, Visual Browser Inspector reliability, prompt enhancement compatibility, provider/tooling hygiene, diagnostics, and orchestrator fixes.",
			),
		).toBeInTheDocument()
		expect(screen.getByText("Highlights in this corrected release:")).toBeInTheDocument()
		expect(screen.getByText(/Long-term memory with local conversation-memory storage/)).toBeInTheDocument()
		expect(screen.getByText(/First-run local AI setup with hardware checks/)).toBeInTheDocument()
		expect(screen.getByText(/Native image generation from chat/)).toBeInTheDocument()
		expect(screen.getByText(/Cloudflare Workers AI providers/)).toBeInTheDocument()
		expect(screen.getByText(/Visual Browser Inspector reliability improvements/)).toBeInTheDocument()
		expect(screen.getByText(/Codex prompt enhancement completions/)).toBeInTheDocument()
		expect(screen.getByText(/Orchestrator and delegation fixes/)).toBeInTheDocument()
		expect(screen.getByText(/MCP Marketplace\/setup flows/)).toBeInTheDocument()
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

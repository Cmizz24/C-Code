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
		version: "3.54.0",
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
					C Code 3.54.0 is ready from Cmizz{"'"}s consolidated fork base. Follow the fork repository for
					release notes, fixes, and development updates:{" "}
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
				"chat:announcement.finalRelease.title": "C Code 3.54.0 release",
				"chat:announcement.finalRelease.summary":
					"This release focuses on C Code-specific creation tools, provider/model hygiene, diagnostics, and UI polish while preserving respectful attribution to the original Roo Code project.",
				"chat:announcement.finalRelease.highlightsHeading": "Highlights in this release:",
				"chat:announcement.finalRelease.imageGeneration":
					"Native image generation from chat, with Image Generation settings, prompt approval, previews, and OpenRouter, OpenAI/OpenAI-compatible, and Cloudflare Workers AI providers.",
				"chat:announcement.finalRelease.dynamicModels":
					"Dynamic OpenRouter image-model discovery plus refreshed provider/model metadata and cache scoping.",
				"chat:announcement.finalRelease.visualInspector":
					"Visual Browser Inspector integration for inspecting browser state alongside chat workflows.",
				"chat:announcement.finalRelease.diagnostics":
					"Opt-in remote diagnostics through the existing debug toggle, sent to Cmizz's diagnostics endpoint with anonymous/private event payloads.",
				"chat:announcement.finalRelease.providerHygiene":
					"ChatGPT Plus/Pro Codex catalog cleanup filters stale unsupported models and falls back to supported defaults.",
				"chat:announcement.finalRelease.toolingPolish":
					"Settings, i18n, Windows-safe command guidance, and native tool/mode-flow polish from the C Code work.",
				"chat:announcement.finalRelease.unsupportedLocal":
					"Local image-generation backends such as Ollama, LM Studio, ComfyUI, and Automatic1111 are not exposed as supported image-generation providers in this release.",
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

		expect(screen.getByText("C Code 3.54.0 release")).toBeInTheDocument()
		expect(screen.getByText(/C Code 3.54.0 is ready from Cmizz's consolidated fork base/)).toBeInTheDocument()
		expect(
			screen.getByText(
				"This release focuses on C Code-specific creation tools, provider/model hygiene, diagnostics, and UI polish while preserving respectful attribution to the original Roo Code project.",
			),
		).toBeInTheDocument()
		expect(screen.getByText("Highlights in this release:")).toBeInTheDocument()
		expect(screen.getByText(/Native image generation from chat/)).toBeInTheDocument()
		expect(screen.getByText(/Cloudflare Workers AI providers/)).toBeInTheDocument()
		expect(screen.getByText(/Visual Browser Inspector integration/)).toBeInTheDocument()
		expect(screen.getByText(/Opt-in remote diagnostics/)).toBeInTheDocument()
		expect(screen.getByText(/ChatGPT Plus\/Pro Codex catalog cleanup/)).toBeInTheDocument()
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

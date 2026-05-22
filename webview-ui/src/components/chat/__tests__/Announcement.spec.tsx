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
		version: "3.53.0",
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
					C Code is continuing as Cmizz{"'"}s personal fork of Roo Code. Follow Cmizz{"'"}s repository for the
					latest fork updates, fixes, and development notes:{" "}
					{components?.repoLink && React.cloneElement(components.repoLink, {}, "Cmizz24/C-Code")}.
				</span>
			)
		}

		if (i18nKey === "chat:announcement.finalRelease.alternatives") {
			return (
				<span>
					For the current work, bug reports, and new changes, use the{" "}
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
				"chat:announcement.finalRelease.title": "C Code 3.53.0 update",
				"chat:announcement.finalRelease.continuity":
					"This extension will keep receiving C Code personalization updates while preserving respectful attribution to the original Roo Code project.",
				"chat:announcement.finalRelease.signoff": "Happy coding!",
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

		expect(screen.getByText("C Code 3.53.0 update")).toBeInTheDocument()
		expect(screen.getByText(/C Code is continuing as Cmizz's personal fork of Roo Code/)).toBeInTheDocument()
		expect(
			screen.getByText(
				"This extension will keep receiving C Code personalization updates while preserving respectful attribution to the original Roo Code project.",
			),
		).toBeInTheDocument()
		expect(screen.getByText("Happy coding!")).toBeInTheDocument()
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

	it("does not render corporate handoff or alternative fork links", () => {
		render(<Announcement hideAnnouncement={vi.fn()} />)

		expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
		expect(screen.queryByText("chat:announcement.handoff.description")).not.toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "X" })).not.toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "ZooCode" })).not.toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "Cline" })).not.toBeInTheDocument()
	})
})

import { render, screen } from "@/utils/test-utils"
import type { ModelInfo } from "@roo-code/types"

import { TranslationContext } from "@src/i18n/TranslationContext"

import { ModelInfoView } from "../ModelInfoView"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ href, children, ...props }: any) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}))

const capabilityLabels: Record<string, string> = {
	contextWindow: "context window",
	pricing: "pricing",
	tools: "tools",
	jsonSchema: "JSON schema",
	serviceTiers: "service tiers",
}

const t = (key: string, options?: Record<string, unknown>) => {
	if (key.startsWith("settings:modelInfo.provenance.capabilities.")) {
		return capabilityLabels[key.replace("settings:modelInfo.provenance.capabilities.", "")] ?? key
	}

	switch (key) {
		case "settings:modelInfo.provenance.title":
			return "Model metadata source"
		case "settings:modelInfo.provenance.reviewStatus":
			return `Status: ${options?.status}`
		case "settings:modelInfo.provenance.lastReviewed":
			return `Reviewed: ${options?.date}`
		case "settings:modelInfo.provenance.source":
			return "Source:"
		case "settings:modelInfo.provenance.endpoint":
			return `(endpoint: ${options?.endpoint})`
		case "settings:modelInfo.provenance.capabilitySummary":
			return `Capabilities sourced: ${options?.capabilities}`
		case "settings:modelInfo.provenance.capabilitySummaryWithMore":
			return `Capabilities sourced: ${options?.capabilities} + ${options?.count} more`
		case "settings:modelInfo.provenance.reviewStatuses.reviewed":
			return "reviewed"
		default:
			return key
	}
}

const renderModelInfoView = (modelInfo: ModelInfo) =>
	render(
		<TranslationContext.Provider value={{ t, i18n: {} as any }}>
			<ModelInfoView
				apiProvider="requesty"
				selectedModelId="router-2"
				modelInfo={modelInfo}
				isDescriptionExpanded={false}
				setIsDescriptionExpanded={vi.fn()}
			/>
		</TranslationContext.Provider>,
	)

describe("ModelInfoView", () => {
	it("shows compact provenance and capability source details from existing metadata", () => {
		renderModelInfoView({
			contextWindow: 200_000,
			maxTokens: 8192,
			supportsPromptCache: false,
			inputPrice: 3,
			outputPrice: 15,
			provenance: {
				sources: [
					{
						type: "official-docs",
						label: "Provider model docs",
						url: "https://provider.example/models",
						endpoint: "/v1/models",
					},
				],
				reviewStatus: "reviewed",
				lastReviewed: "2026-07-01",
			},
			capabilityProvenance: {
				contextWindow: { sources: [{ type: "official-api" }], reviewStatus: "reviewed" },
				pricing: { sources: [{ type: "curated" }], reviewStatus: "unreviewed" },
				tools: { sources: [{ type: "provider-announcement" }], reviewStatus: "unreviewed" },
				jsonSchema: { sources: [{ type: "official-docs" }], reviewStatus: "unknown" },
				serviceTiers: { sources: [{ type: "official-docs" }], reviewStatus: "unknown" },
			},
		})

		expect(screen.getByTestId("model-info-provenance")).toHaveTextContent("Model metadata source")
		expect(screen.getByTestId("model-info-provenance-review-status")).toHaveTextContent("Status: reviewed")
		expect(screen.getByTestId("model-info-provenance")).toHaveTextContent("Reviewed: 2026-07-01")
		expect(screen.getByTestId("model-info-capability-provenance")).toHaveTextContent(
			"Capabilities sourced: context window, pricing, tools, JSON schema + 1 more",
		)
		expect(screen.getByTestId("model-info-provenance-source")).toHaveTextContent("Source:")
		expect(screen.getByTestId("model-info-provenance-source")).toHaveTextContent("(endpoint: /v1/models)")
		expect(screen.getByRole("link", { name: "Provider model docs" })).toHaveAttribute(
			"href",
			"https://provider.example/models",
		)
	})
})

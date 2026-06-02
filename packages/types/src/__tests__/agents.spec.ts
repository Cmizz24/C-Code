import type { AgentWriteIntentEvidence, ExecutionPlan, ParallelArtifactManifestEntry } from "../agents.js"
import {
	buildParallelPlanCompletionPacket,
	computeArtifactManifestFromDiff,
	computeMergeReviewChangeStats,
	createAgentCompletionPacket,
} from "../agents.js"

const createPlan = (): ExecutionPlan => ({
	planId: "plan-packets",
	sharedContext: "Coordinate API and UI contracts.",
	sharedContract: "Use data-testid=dashboard-root and API shape { save(): Promise<void> }.",
	fileOwnershipMap: {
		"src/api.ts": "api-agent",
		"src/ui.tsx": "ui-agent",
	},
	createdAt: 1,
	agents: [
		{
			id: "api-agent",
			mode: "code",
			task: "Implement API contract",
			owns: [{ path: "src/api.ts", mode: "exclusive" }],
			mustNotTouch: [],
			dependsOn: [],
			worktreePath: "/tmp/api-agent",
			status: "complete",
			signals: [],
		},
		{
			id: "ui-agent",
			mode: "code",
			task: "Implement UI contract",
			owns: [{ path: "src/ui.tsx", mode: "exclusive" }],
			mustNotTouch: [],
			dependsOn: [],
			worktreePath: "/tmp/ui-agent",
			status: "failed",
			signals: [],
		},
	],
})

describe("computeMergeReviewChangeStats", () => {
	it("counts changed files, additions, deletions, and binary files from unified diffs", () => {
		const diff = [
			"diff --git a/src/app.ts b/src/app.ts",
			"--- a/src/app.ts",
			"+++ b/src/app.ts",
			"-const oldValue = false",
			"+const newValue = true",
			"+const ready = true",
			"diff --git a/assets/logo.png b/assets/logo.png",
			"Binary files a/assets/logo.png and b/assets/logo.png differ",
		].join("\n")

		expect(computeMergeReviewChangeStats(diff)).toEqual({
			filesChanged: 2,
			additions: 2,
			deletions: 1,
			totalChanges: 3,
			binaryFiles: 1,
		})
	})

	it("handles no-diff and binary-only payloads", () => {
		expect(computeMergeReviewChangeStats("")).toEqual({
			filesChanged: 0,
			additions: 0,
			deletions: 0,
			totalChanges: 0,
			binaryFiles: 0,
		})

		expect(computeMergeReviewChangeStats("Binary files a/image.png and b/image.png differ")).toEqual({
			filesChanged: 1,
			additions: 0,
			deletions: 0,
			totalChanges: 0,
			binaryFiles: 1,
		})
	})
})

describe("computeArtifactManifestFromDiff", () => {
	it("extracts created, modified, deleted, renamed, and binary artifacts from unified diffs", () => {
		const diff = [
			"diff --git a/src/app.ts b/src/app.ts",
			"--- a/src/app.ts",
			"+++ b/src/app.ts",
			"-const oldValue = false",
			"+const newValue = true",
			"diff --git a/src/new.ts b/src/new.ts",
			"new file mode 100644",
			"--- /dev/null",
			"+++ b/src/new.ts",
			"+export const created = true",
			"diff --git a/src/old.ts b/src/old.ts",
			"deleted file mode 100644",
			"--- a/src/old.ts",
			"+++ /dev/null",
			"-export const deleted = true",
			"diff --git a/src/before.ts b/src/after.ts",
			"similarity index 100%",
			"rename from src/before.ts",
			"rename to src/after.ts",
			"diff --git a/assets/logo.png b/assets/logo.png",
			"Binary files a/assets/logo.png and b/assets/logo.png differ",
		].join("\n")

		expect(computeArtifactManifestFromDiff(diff)).toEqual([
			expect.objectContaining({
				path: "src/app.ts",
				status: "modified",
				additions: 1,
				deletions: 1,
				binary: false,
				source: "diff",
			}),
			expect.objectContaining({
				path: "src/new.ts",
				status: "created",
				additions: 1,
				deletions: 0,
			}),
			expect.objectContaining({
				path: "src/old.ts",
				status: "deleted",
				additions: 0,
				deletions: 1,
			}),
			expect.objectContaining({
				path: "src/after.ts",
				previousPath: "src/before.ts",
				status: "renamed",
			}),
			expect.objectContaining({
				path: "assets/logo.png",
				status: "modified",
				binary: true,
			}),
		])
	})
})

describe("completion packet helpers", () => {
	it("creates per-agent packets with ownership evidence, deliverables, validation, and merge defaults", () => {
		const plan = createPlan()
		const attemptedWrites: AgentWriteIntentEvidence[] = [
			{ path: "src/api.ts", approved: true, ts: 10 },
			{
				path: "src/ui.tsx",
				approved: false,
				reason: "src/ui.tsx is owned by ui-agent.",
				ownerAgentId: "ui-agent",
				ts: 11,
			},
		]

		const packet = createAgentCompletionPacket(plan, plan.agents[0]!, {
			status: "complete",
			completionResult: "API complete",
			attemptedWrites,
			artifactManifest: [
				{
					path: "src/api.ts",
					status: "modified",
					additions: 3,
					deletions: 1,
					binary: false,
					source: "merge-review",
				},
			],
			ts: 123,
		})

		expect(packet).toEqual(
			expect.objectContaining({
				schemaVersion: 1,
				planId: "plan-packets",
				agentId: "api-agent",
				mode: "code",
				status: "complete",
				completionResult: "API complete",
			}),
		)
		expect(packet.artifactManifest).toEqual([
			expect.objectContaining({ path: "src/api.ts", status: "modified", additions: 3, deletions: 1 }),
		])
		expect(packet.ownership.status).toBe("violation")
		expect(packet.ownership.conflicts).toEqual([
			expect.objectContaining({ path: "src/ui.tsx", ownerAgentId: "ui-agent" }),
		])
		expect(packet.deliverables).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "assigned-task", status: "satisfied", label: "Implement API contract" }),
				expect.objectContaining({ id: "shared-context", status: "satisfied" }),
				expect.objectContaining({ id: "shared-contract", status: "satisfied" }),
			]),
		)
		expect(packet.validation).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "agent-terminal-status", status: "passed" }),
				expect.objectContaining({ name: "ownership-compliance", status: "failed" }),
			]),
		)
		expect(packet.merge).toEqual(expect.objectContaining({ readiness: "awaiting-review", result: "not-merged" }))
		expect(packet.evidence).toEqual(
			expect.objectContaining({
				createdAt: 123,
				updatedAt: 123,
				sources: [expect.objectContaining({ source: "agent-bus", sourceId: "api-agent", ts: 123 })],
			}),
		)
	})

	it("aggregates plan-level artifacts, ownership, merge state, failed agents, and validation summaries", () => {
		const plan = createPlan()
		const apiArtifact: ParallelArtifactManifestEntry = {
			path: "src/api.ts",
			status: "modified",
			additions: 3,
			deletions: 1,
			binary: false,
			source: "merge-review",
		}
		const apiPacket = createAgentCompletionPacket(plan, plan.agents[0]!, {
			status: "complete",
			completionResult: "API complete",
			artifactManifest: [apiArtifact],
			merge: {
				readiness: "ready",
				result: "merged",
				clean: true,
				materialized: true,
				notes: ["Merged cleanly."],
				ts: 200,
			},
			ts: 200,
		})
		const uiPacket = createAgentCompletionPacket(plan, plan.agents[1]!, {
			status: "failed",
			completionResult: "UI tests failed",
			attemptedWrites: [
				{
					path: "src/api.ts",
					approved: false,
					reason: "src/api.ts is owned by api-agent.",
					ownerAgentId: "api-agent",
					ts: 201,
				},
			],
			validation: [
				{
					name: "unit-tests",
					status: "failed",
					summary: "Unit tests failed.",
					source: "provider",
					ts: 201,
				},
			],
			merge: {
				readiness: "not-ready",
				result: "failed",
				clean: false,
				materialized: false,
				conflictedFiles: ["src/ui.tsx"],
				notes: ["Merge failed."],
				ts: 201,
			},
			ts: 201,
		})

		const packet = buildParallelPlanCompletionPacket(plan, [apiPacket, uiPacket], { ts: 300 })

		expect(packet.status).toBe("failed")
		expect(packet.sharedContract).toBe("Use data-testid=dashboard-root and API shape { save(): Promise<void> }.")
		expect(packet.completedAgentCount).toBe(1)
		expect(packet.failedAgentCount).toBe(1)
		expect(packet.aggregateArtifactManifest).toEqual([
			expect.objectContaining({ path: "src/api.ts", agentId: "api-agent" }),
		])
		expect(packet.ownership.status).toBe("violation")
		expect(packet.ownership.conflicts).toEqual([expect.objectContaining({ path: "src/api.ts" })])
		expect(packet.merge).toEqual(
			expect.objectContaining({
				status: "failed",
				clean: false,
				mergedAgents: ["api-agent"],
				failedAgents: ["ui-agent"],
				conflictedFiles: ["src/ui.tsx"],
			}),
		)
		expect(packet.failedAgents).toEqual([
			expect.objectContaining({ agentId: "ui-agent", status: "failed", reason: "UI tests failed" }),
		])
		expect(packet.validationSummary.failed).toBeGreaterThanOrEqual(2)
		expect(packet.evidence.sources).toEqual(
			expect.arrayContaining([expect.objectContaining({ source: "plan-aggregation" })]),
		)
	})
})

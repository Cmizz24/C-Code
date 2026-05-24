import { computeMergeReviewChangeStats } from "../agents.js"

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

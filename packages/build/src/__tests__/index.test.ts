// npx vitest run src/__tests__/index.test.ts

import * as fs from "fs"
import { fileURLToPath } from "url"

import { copyPaths, generatePackageJson, withFileLock } from "../index.js"

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs")>()

	return {
		...actual,
		copyFileSync: vi.fn(actual.copyFileSync),
	}
})

describe("generatePackageJson", () => {
	it("should be a test", () => {
		const generatedPackageJson = generatePackageJson({
			packageJson: {
				name: "roo-cline",
				displayName: "%extension.displayName%",
				description: "%extension.description%",
				publisher: "RooVeterinaryInc",
				version: "3.17.2",
				icon: "assets/icons/icon.png",
				contributes: {
					viewsContainers: {
						activitybar: [
							{
								id: "roo-cline-ActivityBar",
								title: "%views.activitybar.title%",
								icon: "assets/icons/icon.svg",
							},
						],
					},
					views: {
						"roo-cline-ActivityBar": [
							{
								type: "webview",
								id: "roo-cline.SidebarProvider",
								name: "",
							},
						],
					},
					commands: [
						{
							command: "roo-cline.plusButtonClicked",
							title: "%command.newTask.title%",
							icon: "$(edit)",
						},
						{
							command: "roo-cline.openInNewTab",
							title: "%command.openInNewTab.title%",
							category: "%configuration.title%",
						},
					],
					menus: {
						"editor/context": [
							{
								submenu: "roo-cline.contextMenu",
								group: "navigation",
							},
						],
						"roo-cline.contextMenu": [
							{
								command: "roo-cline.addToContext",
								group: "1_actions@1",
							},
						],
						"editor/title": [
							{
								command: "roo-cline.plusButtonClicked",
								group: "navigation@1",
								when: "activeWebviewPanelId == roo-cline.TabPanelProvider",
							},
							{
								command: "roo-cline.settingsButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == roo-cline.TabPanelProvider",
							},
							{
								command: "roo-cline.accountButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == roo-cline.TabPanelProvider",
							},
						],
					},
					submenus: [
						{
							id: "roo-cline.contextMenu",
							label: "%views.contextMenu.label%",
						},
						{
							id: "roo-cline.terminalMenu",
							label: "%views.terminalMenu.label%",
						},
					],
					configuration: {
						title: "%configuration.title%",
						properties: {
							"roo-cline.allowedCommands": {
								type: "array",
								items: {
									type: "string",
								},
								default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
								description: "%commands.allowedCommands.description%",
							},
							"roo-cline.customStoragePath": {
								type: "string",
								default: "",
								description: "%settings.customStoragePath.description%",
							},
						},
					},
				},
				scripts: {
					lint: "eslint **/*.ts",
				},
			},
			overrideJson: {
				name: "roo-code-nightly",
				displayName: "Roo Code Nightly",
				publisher: "RooVeterinaryInc",
				version: "0.0.1",
				icon: "assets/icons/icon-nightly.png",
				scripts: {},
			},
			substitution: ["roo-cline", "roo-code-nightly"],
		})

		expect(generatedPackageJson).toStrictEqual({
			name: "roo-code-nightly",
			displayName: "Roo Code Nightly",
			description: "%extension.description%",
			publisher: "RooVeterinaryInc",
			version: "0.0.1",
			icon: "assets/icons/icon-nightly.png",
			contributes: {
				viewsContainers: {
					activitybar: [
						{
							id: "roo-code-nightly-ActivityBar",
							title: "%views.activitybar.title%",
							icon: "assets/icons/icon.svg",
						},
					],
				},
				views: {
					"roo-code-nightly-ActivityBar": [
						{
							type: "webview",
							id: "roo-code-nightly.SidebarProvider",
							name: "",
						},
					],
				},
				commands: [
					{
						command: "roo-code-nightly.plusButtonClicked",
						title: "%command.newTask.title%",
						icon: "$(edit)",
					},
					{
						command: "roo-code-nightly.openInNewTab",
						title: "%command.openInNewTab.title%",
						category: "%configuration.title%",
					},
				],
				menus: {
					"editor/context": [
						{
							submenu: "roo-code-nightly.contextMenu",
							group: "navigation",
						},
					],
					"roo-code-nightly.contextMenu": [
						{
							command: "roo-code-nightly.addToContext",
							group: "1_actions@1",
						},
					],
					"editor/title": [
						{
							command: "roo-code-nightly.plusButtonClicked",
							group: "navigation@1",
							when: "activeWebviewPanelId == roo-code-nightly.TabPanelProvider",
						},
						{
							command: "roo-code-nightly.settingsButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == roo-code-nightly.TabPanelProvider",
						},
						{
							command: "roo-code-nightly.accountButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == roo-code-nightly.TabPanelProvider",
						},
					],
				},
				submenus: [
					{
						id: "roo-code-nightly.contextMenu",
						label: "%views.contextMenu.label%",
					},
					{
						id: "roo-code-nightly.terminalMenu",
						label: "%views.terminalMenu.label%",
					},
				],
				configuration: {
					title: "%configuration.title%",
					properties: {
						"roo-code-nightly.allowedCommands": {
							type: "array",
							items: {
								type: "string",
							},
							default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
							description: "%commands.allowedCommands.description%",
						},
						"roo-code-nightly.customStoragePath": {
							type: "string",
							default: "",
							description: "%settings.customStoragePath.description%",
						},
					},
				},
			},
			scripts: {},
		})
	})
})

describe("copyPaths", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("retries transient file-lock copy errors", () => {
		vi.spyOn(fs, "lstatSync").mockReturnValue({
			isDirectory: () => false,
		} as fs.Stats)

		const copyFileSync = vi.mocked(fs.copyFileSync)
		const busyError = Object.assign(new Error("resource busy or locked"), { code: "EBUSY" })

		copyFileSync.mockImplementationOnce(() => {
			throw busyError
		})
		copyFileSync.mockImplementationOnce(() => undefined)

		copyPaths([["source.txt", "dest.txt"]], "src-dir", "dst-dir")

		expect(copyFileSync).toHaveBeenCalledTimes(2)
		expect(copyFileSync).toHaveBeenLastCalledWith(
			expect.stringContaining("source.txt"),
			expect.stringContaining("dest.txt"),
		)
	})
})

describe("withFileLock", () => {
	const lockDir = fileURLToPath(new URL("./tmp-build-lock", import.meta.url))

	beforeEach(async () => {
		await fs.promises.rm(lockDir, { recursive: true, force: true })
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await fs.promises.rm(lockDir, { recursive: true, force: true })
	})

	it("serializes concurrent callbacks for the same lock directory", async () => {
		const events: string[] = []
		let firstStarted!: () => void
		let releaseFirst!: () => void
		const firstHasStarted = new Promise<void>((resolve) => {
			firstStarted = resolve
		})
		const firstCanFinish = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})

		const first = withFileLock(
			lockDir,
			async () => {
				events.push("first:start")
				firstStarted()
				await firstCanFinish
				events.push("first:end")
			},
			{ retryDelayMs: 1, maxRetries: 100 },
		)
		await firstHasStarted

		const second = withFileLock(
			lockDir,
			async () => {
				events.push("second:start")
			},
			{ retryDelayMs: 1, maxRetries: 100 },
		)

		await new Promise((resolve) => setTimeout(resolve, 25))

		expect(events).toEqual(["first:start"])

		releaseFirst()
		await Promise.all([first, second])

		expect(events).toEqual(["first:start", "first:end", "second:start"])
	})
})

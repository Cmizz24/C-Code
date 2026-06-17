import * as fs from "fs"
import * as path from "path"
import type * as vscode from "vscode"

import { RooCodeEventName, type RooCodeAPI } from "@roo-code/types"

type ExtensionPackageJson = {
	publisher?: unknown
	name?: unknown
}

type ExtensionWithPackageJson = vscode.Extension<RooCodeAPI> & {
	packageJSON: { publisher?: unknown; name?: unknown }
}

function getExtensionPackageJson(): ExtensionPackageJson {
	const packageJsonPath = path.resolve(__dirname, "../../../../src/package.json")
	return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as ExtensionPackageJson
}

const extensionPackageJson = getExtensionPackageJson()

export const EXTENSION_PACKAGE_NAME =
	typeof extensionPackageJson.name === "string" && extensionPackageJson.name.length > 0
		? extensionPackageJson.name
		: "c-code"
export const EXTENSION_PUBLISHER =
	typeof extensionPackageJson.publisher === "string" && extensionPackageJson.publisher.length > 0
		? extensionPackageJson.publisher
		: "cmizz"
export const EXTENSION_ID = `${EXTENSION_PUBLISHER}.${EXTENSION_PACKAGE_NAME}`

export function getCommand(command: string): string {
	return `${EXTENSION_PACKAGE_NAME}.${command}`
}

export function getExtensionPackageName(extension: ExtensionWithPackageJson): string {
	const name = extension.packageJSON.name
	return typeof name === "string" && name.length > 0 ? name : EXTENSION_PACKAGE_NAME
}

export function assertExtensionIdentity(extension: ExtensionWithPackageJson): void {
	const packageJson = extension.packageJSON
	const publisher = typeof packageJson.publisher === "string" ? packageJson.publisher : EXTENSION_PUBLISHER
	const name = getExtensionPackageName(extension)

	if (publisher !== EXTENSION_PUBLISHER || name !== EXTENSION_PACKAGE_NAME) {
		throw new Error(`Expected extension ${EXTENSION_ID}, got ${publisher}.${name}`)
	}
}

type WaitForOptions = {
	timeout?: number
	interval?: number
}

export const waitFor = (
	condition: (() => Promise<boolean>) | (() => boolean),
	{ timeout = 30_000, interval = 250 }: WaitForOptions = {},
) => {
	let timeoutId: NodeJS.Timeout | undefined = undefined

	return Promise.race([
		new Promise<void>((resolve) => {
			const check = async () => {
				const result = condition()
				const isSatisfied = result instanceof Promise ? await result : result

				if (isSatisfied) {
					if (timeoutId) {
						clearTimeout(timeoutId)
						timeoutId = undefined
					}

					resolve()
				} else {
					setTimeout(check, interval)
				}
			}

			check()
		}),
		new Promise((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(new Error(`Timeout after ${Math.floor(timeout / 1000)}s`))
			}, timeout)
		}),
	])
}

type WaitUntilAbortedOptions = WaitForOptions & {
	api: RooCodeAPI
	taskId: string
}

export const waitUntilAborted = async ({ api, taskId, ...options }: WaitUntilAbortedOptions) => {
	const set = new Set<string>()
	api.on(RooCodeEventName.TaskAborted, (taskId) => set.add(taskId))
	await waitFor(() => set.has(taskId), options)
}

type WaitUntilCompletedOptions = WaitForOptions & {
	api: RooCodeAPI
	taskId: string
}

export const waitUntilCompleted = async ({ api, taskId, ...options }: WaitUntilCompletedOptions) => {
	const set = new Set<string>()
	api.on(RooCodeEventName.TaskCompleted, (taskId) => set.add(taskId))
	await waitFor(() => set.has(taskId), options)
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

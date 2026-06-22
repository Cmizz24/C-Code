import * as fs from "fs/promises"
import * as path from "path"

import type { ContextCacheSnapshot } from "@roo-code/types"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { fileExistsAtPath } from "../../utils/fs"
import { safeWriteJson } from "../../utils/safeWriteJson"
import { getTaskDirectoryPath } from "../../utils/storage"

export async function readContextCache({
	taskId,
	globalStoragePath,
}: {
	taskId: string
	globalStoragePath: string
}): Promise<ContextCacheSnapshot | undefined> {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.contextCache)

	if (!(await fileExistsAtPath(filePath))) {
		return undefined
	}

	try {
		const parsedData = JSON.parse(await fs.readFile(filePath, "utf8"))
		return parsedData?.version === 1 ? (parsedData as ContextCacheSnapshot) : undefined
	} catch (error) {
		console.warn(
			`[readContextCache] Error parsing context cache snapshot, returning empty. TaskId: ${taskId}, Path: ${filePath}, Error: ${error}`,
		)
		return undefined
	}
}

export async function saveContextCache({
	snapshot,
	taskId,
	globalStoragePath,
}: {
	snapshot: ContextCacheSnapshot
	taskId: string
	globalStoragePath: string
}): Promise<void> {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.contextCache)
	await safeWriteJson(filePath, snapshot)
}

import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import { execFile } from "child_process"

import type { LocalAiDiskInfo, LocalAiGpuInfo, LocalAiHardwareProbe, LocalAiRuntimeStatus } from "@roo-code/types"

export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434"
export const LM_STUDIO_DEFAULT_SERVER_URL = "http://localhost:1234"
export const LM_STUDIO_DEFAULT_BASE_URL = `${LM_STUDIO_DEFAULT_SERVER_URL}/v1`

const bytesToGb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10

const runCommand = (command: string, args: string[], timeoutMs = 3_000): Promise<string> =>
	new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{ timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					reject(error)
					return
				}

				resolve(`${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim())
			},
		)
	})

const fetchJson = async <T>(url: string, timeoutMs = 1_500): Promise<T> => {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const response = await fetch(url, { signal: controller.signal })
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`)
		}

		return (await response.json()) as T
	} finally {
		clearTimeout(timeout)
	}
}

export const normalizeLmStudioBaseUrl = (baseUrl = LM_STUDIO_DEFAULT_BASE_URL) => {
	const trimmedBaseUrl = (baseUrl || LM_STUDIO_DEFAULT_BASE_URL).trim().replace(/\/+$/, "")
	return trimmedBaseUrl.endsWith("/v1") ? trimmedBaseUrl : `${trimmedBaseUrl}/v1`
}

export const getLmStudioServerUrl = (baseUrl = LM_STUDIO_DEFAULT_BASE_URL) =>
	normalizeLmStudioBaseUrl(baseUrl).replace(/\/v1$/, "")

const formatRuntimeDetectionError = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error)
	return message.replace(/^Error:\s*/i, "").slice(0, 180)
}

const isConnectionFailure = (error: unknown) => {
	const message = formatRuntimeDetectionError(error)
	return /abort|timeout|timed out|fetch failed|failed to fetch|econnrefused|econnreset|enotfound|network|connect/i.test(
		message,
	)
}

const parseWindowsDriveName = (cwd: string) => {
	const root = path.parse(cwd).root
	const match = /^([A-Za-z]):/.exec(root)
	return match?.[1] ?? "C"
}

export async function detectFreeDisk(cwd: string = process.cwd()): Promise<LocalAiDiskInfo> {
	try {
		if (process.platform === "win32") {
			const driveName = parseWindowsDriveName(cwd)
			const output = await runCommand("powershell.exe", [
				"-NoProfile",
				"-Command",
				`(Get-PSDrive -Name '${driveName}').Free`,
			])
			const freeBytes = Number.parseInt(output.replace(/\D/g, ""), 10)

			if (Number.isFinite(freeBytes)) {
				return { status: "known", path: `${driveName}:`, freeBytes, freeGb: bytesToGb(freeBytes) }
			}
		} else {
			const output = await runCommand("df", ["-kP", cwd])
			const lines = output.split(/\r?\n/).filter(Boolean)
			const values = lines[1]?.trim().split(/\s+/)
			const availableKb = values?.[3] ? Number.parseInt(values[3], 10) : Number.NaN

			if (Number.isFinite(availableKb)) {
				const freeBytes = availableKb * 1024
				return { status: "known", path: cwd, freeBytes, freeGb: bytesToGb(freeBytes) }
			}
		}
	} catch {
		// Best effort only.
	}

	return { status: "unknown", path: cwd }
}

export async function detectGpu(): Promise<LocalAiGpuInfo> {
	const names = new Set<string>()
	let source: string | undefined

	try {
		if (process.platform === "win32") {
			const output = await runCommand("powershell.exe", [
				"-NoProfile",
				"-Command",
				"Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
			])
			output
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean)
				.forEach((name) => names.add(name))
			source = "Win32_VideoController"
		} else if (process.platform === "darwin") {
			const output = await runCommand("system_profiler", ["SPDisplaysDataType"])
			for (const match of output.matchAll(/Chipset Model:\s*(.+)|Metal Family:\s*(.+)/g)) {
				const name = (match[1] ?? match[2])?.trim()
				if (name) {
					names.add(name)
				}
			}
			source = "system_profiler"
		} else {
			try {
				const output = await runCommand("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], 2_000)
				output
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean)
					.forEach((name) => names.add(name))
				source = "nvidia-smi"
			} catch {
				const output = await runCommand("lspci", [])
				output
					.split(/\r?\n/)
					.filter((line) => /vga|3d|display/i.test(line))
					.map((line) => line.replace(/^.*?:\s*/, "").trim())
					.filter(Boolean)
					.forEach((name) => names.add(name))
				source = "lspci"
			}
		}
	} catch {
		// Unknown is safer than treating GPU as absent.
	}

	return names.size > 0 ? { status: "detected", names: [...names], source } : { status: "unknown", names: [] }
}

const getOllamaVersionFromCommand = async () => {
	try {
		const output = await runCommand("ollama", ["--version"], 2_000)
		return output || undefined
	} catch {
		return undefined
	}
}

const pathExists = async (filePath: string) => {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

const getLmStudioVersionFromCommand = async () => {
	try {
		const output = await runCommand("lms", ["--version"], 2_000)
		return output || "LM Studio CLI detected"
	} catch {
		return undefined
	}
}

const getLmStudioAppInstallHint = async () => {
	const candidates: string[] = []

	if (process.platform === "win32") {
		const localAppData = process.env.LOCALAPPDATA
		const programFiles = process.env.ProgramFiles
		const programFilesX86 = process.env["ProgramFiles(x86)"]

		if (localAppData) {
			candidates.push(
				path.join(localAppData, "Programs", "LM Studio", "LM Studio.exe"),
				path.join(localAppData, "LM Studio", "LM Studio.exe"),
			)
		}
		if (programFiles) {
			candidates.push(path.join(programFiles, "LM Studio", "LM Studio.exe"))
		}
		if (programFilesX86) {
			candidates.push(path.join(programFilesX86, "LM Studio", "LM Studio.exe"))
		}
	} else if (process.platform === "darwin") {
		candidates.push("/Applications/LM Studio.app")
	} else {
		candidates.push("/usr/bin/lm-studio", "/usr/local/bin/lm-studio", "/opt/LM Studio/lm-studio")
	}

	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return "LM Studio app detected"
		}
	}

	return undefined
}

const getLmStudioInstallHint = async () =>
	(await getLmStudioVersionFromCommand()) ?? (await getLmStudioAppInstallHint())

export async function detectOllamaRuntime(baseUrl = OLLAMA_DEFAULT_BASE_URL): Promise<LocalAiRuntimeStatus> {
	try {
		const versionResponse = await fetchJson<{ version?: string }>(`${baseUrl}/api/version`)
		let models: string[] = []

		try {
			const tagsResponse = await fetchJson<{ models?: Array<{ name?: string; model?: string }> }>(
				`${baseUrl}/api/tags`,
			)
			models = (tagsResponse.models ?? []).map((model) => model.name ?? model.model).filter(Boolean) as string[]
		} catch {
			// Version is enough to mark the runtime as running.
		}

		return {
			provider: "ollama",
			displayName: "Ollama",
			baseUrl,
			status: "running",
			version: versionResponse.version,
			models,
		}
	} catch (error) {
		const installedVersion = await getOllamaVersionFromCommand()

		return {
			provider: "ollama",
			displayName: "Ollama",
			baseUrl,
			status: installedVersion ? "installed-not-running" : "missing",
			version: installedVersion,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

export async function detectLmStudioRuntime(baseUrl = LM_STUDIO_DEFAULT_BASE_URL): Promise<LocalAiRuntimeStatus> {
	const apiBaseUrl = normalizeLmStudioBaseUrl(baseUrl)

	try {
		const response = await fetchJson<{ data?: Array<{ id?: string }> }>(`${apiBaseUrl}/models`)

		return {
			provider: "lmstudio",
			displayName: "LM Studio",
			baseUrl: apiBaseUrl,
			status: "running",
			models: (response.data ?? []).map((model) => model.id).filter(Boolean) as string[],
		}
	} catch (error) {
		const installHint = await getLmStudioInstallHint()
		const conciseError = formatRuntimeDetectionError(error)
		const status = isConnectionFailure(error)
			? installHint
				? "installed-not-running"
				: "missing"
			: "detection-failed"

		return {
			provider: "lmstudio",
			displayName: "LM Studio",
			baseUrl: apiBaseUrl,
			status,
			version: installHint,
			error: conciseError,
		}
	}
}

export async function probeLocalAi(cwd: string = process.cwd()): Promise<LocalAiHardwareProbe> {
	const cpus = os.cpus() ?? []
	const [disk, gpu, ollama, lmStudio] = await Promise.all([
		detectFreeDisk(cwd),
		detectGpu(),
		detectOllamaRuntime(),
		detectLmStudioRuntime(),
	])
	const totalBytes = os.totalmem()

	return {
		os: process.platform,
		arch: os.arch(),
		cpu: {
			model: cpus[0]?.model,
			count: cpus.length || os.availableParallelism?.() || 1,
		},
		memory: {
			totalBytes,
			totalGb: bytesToGb(totalBytes),
		},
		disk,
		gpu,
		runtimes: {
			ollama,
			lmStudio,
		},
		probedAt: new Date().toISOString(),
	}
}

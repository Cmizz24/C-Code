import * as os from "os"
import * as path from "path"
import { execFile } from "child_process"

import type { LocalAiDiskInfo, LocalAiGpuInfo, LocalAiHardwareProbe, LocalAiRuntimeStatus } from "@roo-code/types"

export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434"
export const LM_STUDIO_DEFAULT_BASE_URL = "http://localhost:1234"

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
	try {
		const response = await fetchJson<{ data?: Array<{ id?: string }> }>(`${baseUrl}/v1/models`)

		return {
			provider: "lmstudio",
			displayName: "LM Studio",
			baseUrl,
			status: "running",
			models: (response.data ?? []).map((model) => model.id).filter(Boolean) as string[],
		}
	} catch (error) {
		return {
			provider: "lmstudio",
			displayName: "LM Studio",
			baseUrl,
			status: "unknown",
			error: error instanceof Error ? error.message : String(error),
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

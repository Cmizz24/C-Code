//
// Tests the ExecuteCommand tool itself vs calling the tool where the tool is mocked.
//
import * as path from "path"
import * as fs from "fs/promises"

import { ExecuteCommandOptions, ExecuteCommandTool } from "../ExecuteCommandTool"
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../../integrations/terminal/Terminal"
import { ExecaTerminal } from "../../../integrations/terminal/ExecaTerminal"
import type { RooTerminalCallbacks } from "../../../integrations/terminal/types"

// Mock fs to control directory existence checks
vitest.mock("fs/promises")

// Mock TerminalRegistry to control terminal creation
vitest.mock("../../../integrations/terminal/TerminalRegistry")

// Mock Terminal and ExecaTerminal classes
vitest.mock("../../../integrations/terminal/Terminal")
vitest.mock("../../../integrations/terminal/ExecaTerminal")

// Import the actual executeCommand function (not mocked)
import { executeCommandInTerminal } from "../ExecuteCommandTool"

// Tests for the executeCommand function
describe("executeCommand", () => {
	let mockTask: any
	let mockTerminal: any
	let mockProcess: any
	let mockProvider: any

	beforeEach(() => {
		vitest.clearAllMocks()

		// Mock fs.access to simulate directory existence
		;(fs.access as any).mockResolvedValue(undefined)

		// Create mock provider
		mockProvider = {
			postMessageToWebview: vitest.fn(),
			getState: vitest.fn().mockResolvedValue({
				terminalShellIntegrationDisabled: false,
			}),
		}

		// Create mock task
		mockTask = {
			cwd: "/test/project",
			taskId: "test-task-123",
			providerRef: {
				deref: vitest.fn().mockResolvedValue(mockProvider),
			},
			say: vitest.fn().mockResolvedValue(undefined),
			terminalProcess: undefined,
		}

		// Create mock process that resolves immediately
		mockProcess = Promise.resolve()
		mockProcess.continue = vitest.fn()

		// Create mock terminal with getCurrentWorkingDirectory method
		mockTerminal = {
			provider: "vscode",
			id: 1,
			initialCwd: "/test/project",
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/project"),
			runCommand: vitest.fn().mockReturnValue(mockProcess),
			terminal: {
				show: vitest.fn(),
			},
		}

		// Mock TerminalRegistry.getOrCreateTerminal
		;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockTerminal)
		;(Terminal.compressTerminalOutput as any).mockImplementation((output: string) => output)
	})

	describe("Working Directory Behavior", () => {
		it("should use terminal.getCurrentWorkingDirectory() in the output message for completed commands", async () => {
			// Setup: Mock terminal to return a different current working directory
			const initialCwd = "/test/project"
			const currentCwd = "/test/project/subdirectory"

			mockTask.cwd = initialCwd
			mockTerminal.initialCwd = initialCwd
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue(currentCwd)

			// Mock the terminal process to complete successfully
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				// Simulate command completion
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(mockTerminal.getCurrentWorkingDirectory).toHaveBeenCalled()
			expect(result).toContain(`within working directory '${currentCwd}'`)
			expect(result).not.toContain(`within working directory '${initialCwd}'`)
		})

		it("should use terminal.getCurrentWorkingDirectory() for VSCode Terminal with shell integration", async () => {
			// Setup: Mock VSCode Terminal instance
			const vscodeTerminal = new Terminal(1, undefined, "/test/project")
			const mockVSCodeTerminal = vscodeTerminal as any

			// Mock shell integration providing different cwd
			mockVSCodeTerminal.terminal = {
				show: vitest.fn(),
				shellIntegration: {
					cwd: { fsPath: "/test/project/changed-dir" },
				},
			}
			mockVSCodeTerminal.getCurrentWorkingDirectory = vitest.fn().mockReturnValue("/test/project/changed-dir")
			mockVSCodeTerminal.runCommand = vitest
				.fn()
				.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
					setTimeout(() => {
						callbacks.onCompleted("Command output", mockProcess)
						callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
					}, 0)
					return mockProcess
				})
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockVSCodeTerminal)

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("within working directory '/test/project/changed-dir'")
		})

		it("should use terminal.getCurrentWorkingDirectory() for ExecaTerminal (always returns initialCwd)", async () => {
			// Setup: Mock ExecaTerminal instance
			const execaTerminal = new ExecaTerminal(1, "/test/project")
			const mockExecaTerminal = execaTerminal as any

			// ExecaTerminal always returns initialCwd
			mockExecaTerminal.getCurrentWorkingDirectory = vitest.fn().mockReturnValue("/test/project")
			mockExecaTerminal.runCommand = vitest
				.fn()
				.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
					setTimeout(() => {
						callbacks.onCompleted("Command output", mockProcess)
						callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
					}, 0)
					return mockProcess
				})
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockExecaTerminal)

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: true, // Forces ExecaTerminal
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(mockExecaTerminal.getCurrentWorkingDirectory).toHaveBeenCalled()
			expect(result).toContain("within working directory '/test/project'")
		})
	})

	describe("Custom Working Directory", () => {
		it("should handle absolute custom cwd and use terminal.getCurrentWorkingDirectory() in output", async () => {
			const customCwd = "/custom/absolute/path"

			mockTerminal.getCurrentWorkingDirectory.mockReturnValue(customCwd)
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd,
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(customCwd, mockTask.taskId, "vscode")
			expect(result).toContain(`within working directory '${customCwd}'`)
		})

		it("should handle relative custom cwd and use terminal.getCurrentWorkingDirectory() in output", async () => {
			const relativeCwd = "subdirectory"
			const resolvedCwd = path.resolve(mockTask.cwd, relativeCwd)

			mockTerminal.getCurrentWorkingDirectory.mockReturnValue(resolvedCwd)
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd: relativeCwd,
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(resolvedCwd, mockTask.taskId, "vscode")
			expect(result).toContain(`within working directory '${resolvedCwd.toPosix()}'`)
		})

		it("should return error when custom working directory does not exist", async () => {
			const nonExistentCwd = "/non/existent/path"

			// Mock fs.access to throw error for non-existent directory
			;(fs.access as any).mockRejectedValue(new Error("Directory does not exist"))

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd: nonExistentCwd,
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toBe(`Working directory '${nonExistentCwd}' does not exist.`)
			expect(TerminalRegistry.getOrCreateTerminal).not.toHaveBeenCalled()
		})
	})

	describe("Terminal Provider Selection", () => {
		it("should use vscode provider when shell integration is enabled", async () => {
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(mockTask.cwd, mockTask.taskId, "vscode")
		})

		it("should use execa provider when shell integration is disabled", async () => {
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: true,
			}

			// Execute
			await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(mockTask.cwd, mockTask.taskId, "execa")
		})
	})

	describe("Command Execution States", () => {
		it("should handle completed command with exit code 0", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command completed successfully", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo success",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("Exit code: 0")
			expect(result).toContain("within working directory '/test/project'")
		})

		it("should handle completed command with non-zero exit code", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command failed", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 1 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "exit 1",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("Command execution was not successful")
			expect(result).toContain("Exit code: 1")
			expect(result).toContain("within working directory '/test/project'")
		})

		it("treats findstr exit code 1 without error output as no matches", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 1 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: 'findstr /N "needle" file.txt',
				terminalShellIntegrationDisabled: false,
			}

			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			expect(rejected).toBe(false)
			expect(result).toContain("findstr returned no matches (exit code 1)")
			expect(result).not.toContain("Command execution was not successful")
			expect(result).toContain("within working directory '/test/project'")
		})

		it("adds recovery guidance for findstr long-pattern or broken-pipe failures", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted(
						"FINDSTR: Search string too long.\nThe process tried to write to a nonexistent pipe.",
						mockProcess,
					)
					callbacks.onShellExecutionComplete({ exitCode: 1 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: 'type file.txt | findstr /N "alpha\\|beta\\|gamma"',
				terminalShellIntegrationDisabled: false,
			}

			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			expect(rejected).toBe(false)
			expect(result).toContain("Command execution was not successful")
			expect(result).toContain("Exit code: 1")
			expect(result).toContain("Windows findstr/cmd.exe cannot handle long search strings")
			expect(result).toContain("PowerShell Select-String")
			expect(result).toContain("within working directory '/test/project'")
		})

		it("nudges background agents to retry failed shell file writes with write/edit tools", async () => {
			mockTask.background = true
			mockTask.agentId = "api-agent"
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("The string is missing the terminator: '@.", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 1 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "powershell -Command \"@'`n{}'@ | Out-File server\\package.json\"",
				terminalShellIntegrationDisabled: false,
			}

			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			expect(rejected).toBe(false)
			expect(result).toContain("Exit code: 1")
			expect(result).toContain("retry with the normal write/edit tools")
			expect(result).toContain("instead of shell here-strings, heredocs, or echo chains")
			expect(result).toContain("not for embedding file contents")
		})

		it("nudges background agents when an oversized command line fails", async () => {
			mockTask.background = true
			mockTask.agentId = "js-agent"
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((_command: string, callbacks: RooTerminalCallbacks) => {
				let resolveProcess: (() => void) | undefined
				const process = new Promise<void>((resolve) => {
					resolveProcess = resolve
				}) as any
				process.continue = vitest.fn()
				setTimeout(async () => {
					callbacks.onShellExecutionComplete({ exitCode: 1 }, process)
					await callbacks.onCompleted("The command line is too long.", process)
					resolveProcess?.()
				}, 0)
				return process
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "powershell -Command \"@'`n$largeGeneratedFileContent`n'@ | Set-Content app.js\"",
				terminalShellIntegrationDisabled: false,
			}

			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			expect(rejected).toBe(false)
			expect(result).toContain("Exit code: 1")
			expect(result).toContain("The command line is too long.")
			expect(result).toContain("retry with the normal write/edit tools")
			expect(result).toContain("not for embedding file contents")
		})

		it("should handle command terminated by signal", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command interrupted", mockProcess)
					callbacks.onShellExecutionComplete(
						{
							exitCode: undefined,
							signalName: "SIGINT",
							coreDumpPossible: false,
						},
						mockProcess,
					)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "long-running-command",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("Process terminated by signal SIGINT")
			expect(result).toContain("within working directory '/test/project'")
		})
	})

	describe("Terminal Working Directory Updates", () => {
		it("should update working directory when terminal returns different cwd", async () => {
			// Setup: Terminal initially at project root, but getCurrentWorkingDirectory returns different path
			const initialCwd = "/test/project"
			const updatedCwd = "/test/project/src"

			mockTask.cwd = initialCwd
			mockTerminal.initialCwd = initialCwd

			// Mock Terminal instance behavior
			const mockTerminalInstance = {
				...mockTerminal,
				terminal: { show: vitest.fn() },
				getCurrentWorkingDirectory: vitest.fn().mockReturnValue(updatedCwd),
				runCommand: vitest.fn().mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
					setTimeout(() => {
						callbacks.onCompleted("Directory changed", mockProcess)
						callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
					}, 0)
					return mockProcess
				}),
			}

			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockTerminalInstance)

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "cd src && pwd",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify the result uses the updated working directory
			expect(rejected).toBe(false)
			expect(result).toContain(`within working directory '${updatedCwd}'`)
			expect(result).not.toContain(`within working directory '${initialCwd}'`)

			// Verify the terminal's getCurrentWorkingDirectory was called
			expect(mockTerminalInstance.getCurrentWorkingDirectory).toHaveBeenCalled()
		})
	})
})

describe("ExecuteCommandTool background agents", () => {
	const originalPlatform = process.platform

	beforeEach(() => {
		vitest.clearAllMocks()
	})

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform })
	})

	it("uses the normal command approval path for background parallel agents", async () => {
		const tool = new ExecuteCommandTool()
		const command = "powershell -Command \"Set-Content -Path src/app.ts -Value 'content'\""
		const task: any = {
			background: true,
			agentId: "ui-agent",
			consecutiveMistakeCount: 0,
			recordToolError: vitest.fn(),
		}
		const callbacks: any = {
			pushToolResult: vitest.fn(),
			askApproval: vitest.fn().mockResolvedValue(false),
			handleError: vitest.fn(),
		}

		await tool.execute({ command }, task, callbacks)

		expect(callbacks.askApproval).toHaveBeenCalledWith("command", command)
		expect(task.recordToolError).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
	})

	it("returns pre-execution recovery guidance for direct Set-Content here-string values", async () => {
		const tool = new ExecuteCommandTool()
		const command = `powershell -Command "Set-Content -Path 'server/index.js' -Value @'
import 'dotenv/config';
console.log('ok');
'@ -Encoding UTF8"`
		const task: any = {
			background: true,
			agentId: "server-agent",
			cwd: "c:/tmp/worktree",
			taskId: "background-task-direct-here-string",
			consecutiveMistakeCount: 0,
			recordToolError: vitest.fn(),
			say: vitest.fn().mockResolvedValue(undefined),
		}
		const callbacks: any = {
			pushToolResult: vitest.fn(),
			askApproval: vitest.fn().mockResolvedValue(true),
			handleError: vitest.fn(),
		}

		await tool.execute({ command }, task, callbacks)

		expect(callbacks.askApproval).not.toHaveBeenCalled()
		expect(TerminalRegistry.getOrCreateTerminal).not.toHaveBeenCalled()
		expect(callbacks.handleError).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).toHaveBeenCalledTimes(1)
		const result = callbacks.pushToolResult.mock.calls[0][0]
		expect(result).toContain("Command not executed")
		expect(result).toContain("PowerShell here-string")
		expect(result).toContain("retry with the normal write/edit tools")
		expect(result).toContain("not for embedding file contents")
	})

	it("continues to run normal non-file-write PowerShell commands for background agents", async () => {
		;(fs.access as any).mockResolvedValue(undefined)

		const tool = new ExecuteCommandTool()
		const command = "powershell -Command \"Write-Output 'ok'\""
		const task: any = {
			background: true,
			agentId: "server-agent",
			cwd: "/test/project",
			taskId: "background-task-normal-powershell",
			lastMessageTs: 123,
			consecutiveMistakeCount: 0,
			recordToolError: vitest.fn(),
			say: vitest.fn().mockResolvedValue(undefined),
			supersedePendingAsk: vitest.fn(),
			providerRef: {
				deref: vitest.fn().mockResolvedValue({
					postMessageToWebview: vitest.fn(),
					getState: vitest.fn().mockResolvedValue({ terminalShellIntegrationDisabled: true }),
				}),
			},
		}
		const terminal: any = {
			provider: "execa",
			id: 1,
			initialCwd: "/test/project",
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/project"),
			runCommand: vitest.fn().mockImplementation((_command: string, callbacks: RooTerminalCallbacks) => {
				let resolveProcess: (() => void) | undefined
				const process = new Promise<void>((resolve) => {
					resolveProcess = resolve
				}) as any
				process.continue = vitest.fn()
				setTimeout(async () => {
					callbacks.onShellExecutionComplete({ exitCode: 0 }, process)
					await callbacks.onCompleted("ok", process)
					resolveProcess?.()
				}, 0)
				return process
			}),
		}
		;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(terminal)
		const callbacks: any = {
			pushToolResult: vitest.fn(),
			askApproval: vitest.fn().mockResolvedValue(true),
			handleError: vitest.fn(),
		}

		await tool.execute({ command }, task, callbacks)

		expect(callbacks.askApproval).toHaveBeenCalledWith("command", command)
		expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(task.cwd, task.taskId, "execa")
		expect(terminal.runCommand).toHaveBeenCalledWith(command, expect.any(Object))
		expect(callbacks.handleError).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).toHaveBeenCalledTimes(1)
		expect(callbacks.pushToolResult.mock.calls[0][0]).toContain("Exit code: 0")
	})

	it("returns pre-execution recovery guidance for oversized background shell file writes on Windows", async () => {
		Object.defineProperty(process, "platform", { value: "win32" })

		const tool = new ExecuteCommandTool()
		const hugeContent = "x".repeat(9_000)
		const command = `cd /d "c:\\Users\\clayton\\Desktop\\test\\.roo\\parallel-worktrees\\plan-mpoqu33b\\component-agent" && powershell -Command "$content = @'
${hugeContent}
'@; Set-Content -Path app.js -Value $content"`
		const task: any = {
			background: true,
			agentId: "component-agent",
			cwd: "c:/Users/clayton/Desktop/test/.roo/parallel-worktrees/plan-mpoqu33b/component-agent",
			taskId: "background-task-1",
			consecutiveMistakeCount: 0,
			recordToolError: vitest.fn(),
			say: vitest.fn().mockResolvedValue(undefined),
		}
		const callbacks: any = {
			pushToolResult: vitest.fn(),
			askApproval: vitest.fn().mockResolvedValue(true),
			handleError: vitest.fn(),
		}

		await tool.execute({ command }, task, callbacks)

		expect(callbacks.askApproval).not.toHaveBeenCalled()
		expect(TerminalRegistry.getOrCreateTerminal).not.toHaveBeenCalled()
		expect(callbacks.handleError).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).toHaveBeenCalledTimes(1)
		const result = callbacks.pushToolResult.mock.calls[0][0]
		expect(result).toContain("Command not executed")
		expect(result).toContain("exceeds the Windows shell command-length safety limit")
		expect(result).toContain("retry with the normal write/edit tools")
		expect(result).toContain("not for embedding file contents")
	})

	it("does not preflight long background commands that are not shell file writes", async () => {
		Object.defineProperty(process, "platform", { value: "win32" })

		const tool = new ExecuteCommandTool()
		const command = `node -e "console.log('${"x".repeat(9_000)}')"`
		const task: any = {
			background: true,
			agentId: "component-agent",
			consecutiveMistakeCount: 0,
			recordToolError: vitest.fn(),
		}
		const callbacks: any = {
			pushToolResult: vitest.fn(),
			askApproval: vitest.fn().mockResolvedValue(false),
			handleError: vitest.fn(),
		}

		await tool.execute({ command }, task, callbacks)

		expect(callbacks.askApproval).toHaveBeenCalledWith("command", command)
		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
		expect(TerminalRegistry.getOrCreateTerminal).not.toHaveBeenCalled()
	})

	it("blocks background agents with malformed here-string headers regardless of command length (Issue 3)", async () => {
		// A short command (well under 8000 chars) with a here-string whose @' delimiter
		// is NOT followed immediately by a newline — this produces a PowerShell parser
		// error and must be blocked pre-execution.
		const tool = new ExecuteCommandTool()
		// Inline here-string: @' is followed by content on the same line (malformed).
		const command =
			`powershell -Command "$content = @'some content on same line as delimiter'@; ` +
			`Set-Content -Path app.js -Value $content"`
		expect(command.length).toBeLessThan(8_000)

		const task: any = {
			background: true,
			agentId: "component-agent",
			cwd: "c:/tmp/worktree",
			taskId: "background-task-malformed",
			consecutiveMistakeCount: 0,
			recordToolError: vitest.fn(),
			say: vitest.fn().mockResolvedValue(undefined),
		}
		const callbacks: any = {
			pushToolResult: vitest.fn(),
			askApproval: vitest.fn().mockResolvedValue(true),
			handleError: vitest.fn(),
		}

		await tool.execute({ command }, task, callbacks)

		expect(callbacks.askApproval).not.toHaveBeenCalled()
		expect(TerminalRegistry.getOrCreateTerminal).not.toHaveBeenCalled()
		expect(callbacks.handleError).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).toHaveBeenCalledTimes(1)
		const result = callbacks.pushToolResult.mock.calls[0][0]
		expect(result).toContain("Command not executed")
		expect(result).toContain("malformed PowerShell here-string header")
		expect(result).toContain("retry with the normal write/edit tools")
	})
})

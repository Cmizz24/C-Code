import type { RooCodeSettings, TokenUsage, ToolUsage } from "@roo-code/types"

import type { ContextProxy } from "../../../core/config/ContextProxy"
import { EmailNotificationService, type EmailNotificationPayload } from "../EmailNotificationService"

const tokenUsage: TokenUsage = {
	totalTokensIn: 12,
	totalTokensOut: 34,
	totalCacheWrites: 5,
	totalCacheReads: 7,
	totalCost: 0.123456,
	contextTokens: 2048,
}

const toolUsage = {
	read_file: { attempts: 2, failures: 1 },
} as ToolUsage

const payload: EmailNotificationPayload & { clineMessages?: string; apiConversationHistory?: string } = {
	taskId: "task-1",
	outcome: "success",
	summary: "Implemented SMTP summary output without leaking smtp-secret.",
	workspacePath: "/workspace/project",
	mode: "code",
	tokenUsage,
	toolUsage,
	requestCount: 3,
}
payload.clineMessages = "Full transcript content must not be included"
payload.apiConversationHistory = "Raw API transcript content must not be included"

const baseSettings: Partial<RooCodeSettings> = {
	emailNotificationsEnabled: true,
	emailNotifyOnSuccess: true,
	emailNotifyOnFailure: false,
	smtpHost: "smtp.example.com",
	smtpPort: 587,
	smtpSecure: false,
	smtpRequireTls: false,
	smtpUsername: "smtp-user",
	smtpFromAddress: "C Code <roo@example.com>",
	smtpRecipients: ["dev@example.com"],
	smtpSubjectTemplate: "C task {{outcome}} for {{workspacePath}} in {{mode}}",
}

const createContextProxy = (settings: Partial<RooCodeSettings> = {}, secret = "smtp-secret") =>
	({
		getValues: vi.fn(() => ({ ...baseSettings, ...settings }) as RooCodeSettings),
		getSecret: vi.fn((key: string) => (key === "smtpPassword" ? secret : undefined)),
	}) as unknown as ContextProxy

const createService = (contextProxy = createContextProxy()) => {
	const sendMail = vi.fn().mockResolvedValue(undefined)
	const transportFactory = vi.fn(() => ({ sendMail }))
	const log = vi.fn()
	const service = new EmailNotificationService(contextProxy, { log, transportFactory })

	return { service, sendMail, transportFactory, log, contextProxy }
}

describe("EmailNotificationService", () => {
	it("does not send when email notifications are disabled", async () => {
		const { service, transportFactory } = createService(createContextProxy({ emailNotificationsEnabled: false }))

		await service.sendTaskNotification(payload)

		expect(transportFactory).not.toHaveBeenCalled()
	})

	it("sends successful task notifications with sanitized SMTP config, HTML body, and plain text fallback", async () => {
		const contextProxy = createContextProxy({
			smtpHost: " smtp.example.com ",
			smtpPort: 465,
			smtpSecure: true,
			smtpRequireTls: true,
			smtpRecipients: [" dev@example.com ", "ops@example.com", "dev@example.com", ""],
		})
		const { service, sendMail, transportFactory } = createService(contextProxy)

		await service.sendTaskNotification(payload)

		expect(contextProxy.getSecret).toHaveBeenCalledWith("smtpPassword")
		expect(transportFactory).toHaveBeenCalledWith({
			host: "smtp.example.com",
			port: 465,
			secure: true,
			requireTLS: true,
			auth: {
				user: "smtp-user",
				pass: "smtp-secret",
			},
		})
		expect(sendMail).toHaveBeenCalledWith(
			expect.objectContaining({
				from: "C Code <roo@example.com>",
				to: ["dev@example.com", "ops@example.com"],
				subject: "C task success for /workspace/project in code",
				text: expect.stringContaining("Task ID: task-1"),
				html: expect.stringContaining("<!doctype html>"),
			}),
		)

		const mailOptions = sendMail.mock.calls[0][0]
		expect(mailOptions.text).toContain("Status: Completed")
		expect(mailOptions.text).toContain(
			"Completion summary: Implemented SMTP summary output without leaking [redacted].",
		)
		expect(mailOptions.text).toContain("Workspace: /workspace/project")
		expect(mailOptions.text).toContain("Requests: 3")
		expect(mailOptions.text).toContain("Total tokens in: 12")
		expect(mailOptions.text).toContain("Total tokens out: 34")
		expect(mailOptions.text).toContain("Cache write tokens: 5")
		expect(mailOptions.text).toContain("Cache read tokens: 7")
		expect(mailOptions.text).toContain("Total tokens: 46")
		expect(mailOptions.text).toContain("Total cost: $0.123456")
		expect(mailOptions.text).toContain("Tool attempts: 2")
		expect(mailOptions.text).toContain("Tool failures: 1")
		expect(mailOptions.text).toContain("Task transcripts and SMTP secrets are not included")
		expect(mailOptions.text).not.toContain("apiConversationHistory")
		expect(mailOptions.text).not.toContain("clineMessages")
		expect(mailOptions.text).not.toContain("Full transcript content")
		expect(mailOptions.text).not.toContain("Raw API transcript content")
		expect(mailOptions.text).not.toContain("smtp-secret")
		expect(mailOptions.html).toContain("Task Completed")
		expect(mailOptions.html).toContain("Task ID")
		expect(mailOptions.html).toContain("Implemented SMTP summary output without leaking [redacted].")
		expect(mailOptions.html).toContain("/workspace/project")
		expect(mailOptions.html).toContain("Requests")
		expect(mailOptions.html).toContain("Cache write tokens")
		expect(mailOptions.html).toContain("Total tokens")
		expect(mailOptions.html).toContain("$0.123456")
		expect(mailOptions.html).not.toContain("apiConversationHistory")
		expect(mailOptions.html).not.toContain("clineMessages")
		expect(mailOptions.html).not.toContain("Full transcript content")
		expect(mailOptions.html).not.toContain("Raw API transcript content")
		expect(mailOptions.html).not.toContain("smtp-secret")
	})

	it("replaces subject template tokens case-insensitively including lowercase taskid", async () => {
		const { service, sendMail } = createService(
			createContextProxy({
				smtpSubjectTemplate:
					"{{taskid}} {{TASKID}} {{taskId}} {{Workspace_Path}} {{MODE}} {{REQUESTS}} {{TOTAL_CACHE_WRITES}} {{total_cache_reads}} {{TOTAL_TOKENS}} {{unknown}}",
			}),
		)

		await service.sendTaskNotification(payload)

		expect(sendMail).toHaveBeenCalledWith(
			expect.objectContaining({
				subject: "task-1 task-1 task-1 /workspace/project code 3 5 7 46 {{unknown}}",
			}),
		)
	})

	it("renders delegated and parallel workflow notification context rows and subject tokens", async () => {
		const { service, sendMail } = createService(
			createContextProxy({
				smtpSubjectTemplate:
					"{{notificationType}}|{{notificationLabel}}|{{parentTaskId}}|{{rootTaskId}}|{{agentId}}|{{taskId}}",
			}),
		)

		await service.sendTaskNotification({
			...payload,
			taskId: "child-task-1",
			notificationType: "delegated-child",
			parentTaskId: "parent-smtp-secret",
			rootTaskId: "root-task-1",
			agentId: "agent-a",
		})
		await service.sendTaskNotification({
			...payload,
			taskId: "parallel-workflow-1",
			notificationType: "parallel-workflow",
			agentId: "merge-coordinator",
		})

		expect(sendMail).toHaveBeenCalledTimes(2)

		const delegatedMailOptions = sendMail.mock.calls[0][0]
		expect(delegatedMailOptions.subject).toBe(
			"delegated-child|Delegated child task|parent-[redacted]|root-task-1|agent-a|child-task-1",
		)
		expect(delegatedMailOptions.text).toContain("Notification type: Delegated child task")
		expect(delegatedMailOptions.text).toContain("Parent task ID: parent-[redacted]")
		expect(delegatedMailOptions.text).toContain("Root task ID: root-task-1")
		expect(delegatedMailOptions.text).toContain("Agent ID: agent-a")
		expect(delegatedMailOptions.html).toContain("Notification type")
		expect(delegatedMailOptions.html).toContain("Delegated child task")
		expect(delegatedMailOptions.html).toContain("Parent task ID")
		expect(delegatedMailOptions.html).toContain("parent-[redacted]")
		expect(delegatedMailOptions.html).toContain("Root task ID")
		expect(delegatedMailOptions.html).toContain("root-task-1")
		expect(delegatedMailOptions.html).toContain("Agent ID")
		expect(delegatedMailOptions.html).toContain("agent-a")
		expect(delegatedMailOptions.text).not.toContain("smtp-secret")
		expect(delegatedMailOptions.html).not.toContain("smtp-secret")

		const parallelMailOptions = sendMail.mock.calls[1][0]
		expect(parallelMailOptions.subject).toBe(
			"parallel-workflow|Parallel agent workflow|||merge-coordinator|parallel-workflow-1",
		)
		expect(parallelMailOptions.text).toContain("Notification type: Parallel agent workflow")
		expect(parallelMailOptions.text).toContain("Agent ID: merge-coordinator")
		expect(parallelMailOptions.text).not.toContain("Parent task ID:")
		expect(parallelMailOptions.text).not.toContain("Root task ID:")
		expect(parallelMailOptions.html).toContain("Parallel agent workflow")
	})

	it("renders missing usage safely as zeros without n/a placeholders", async () => {
		const { service, sendMail } = createService()

		await service.sendTaskNotification({
			taskId: "task-missing-usage",
			outcome: "success",
			workspacePath: "/workspace/project",
			mode: "code",
		})

		const mailOptions = sendMail.mock.calls[0][0]
		expect(mailOptions.text).toContain("Requests: 0")
		expect(mailOptions.text).toContain("Total tokens in: 0")
		expect(mailOptions.text).toContain("Total tokens out: 0")
		expect(mailOptions.text).toContain("Cache write tokens: 0")
		expect(mailOptions.text).toContain("Cache read tokens: 0")
		expect(mailOptions.text).toContain("Total tokens: 0")
		expect(mailOptions.text).toContain("Context tokens: 0")
		expect(mailOptions.text).toContain("Total cost: $0.000000")
		expect(mailOptions.text).toContain("Tool attempts: 0")
		expect(mailOptions.text).toContain("Tool failures: 0")
		expect(mailOptions.text).not.toContain("Completion summary:")
		expect(mailOptions.text).not.toContain("n/a")
		expect(mailOptions.html).not.toContain("n/a")
	})

	it("renders malformed usage safely as zeros instead of skipping the send", async () => {
		const { service, sendMail } = createService()

		await service.sendTaskNotification({
			...payload,
			taskId: "task-malformed-usage",
			tokenUsage: {
				totalTokensIn: Number.NaN,
				totalTokensOut: undefined,
				totalCacheWrites: Number.POSITIVE_INFINITY,
				totalCacheReads: "not-a-number",
				totalCost: undefined,
				contextTokens: null,
			} as any,
			toolUsage: {
				read_file: { attempts: Number.NaN, failures: "nope" },
				execute_command: undefined,
			} as any,
		})

		expect(sendMail).toHaveBeenCalledTimes(1)
		const mailOptions = sendMail.mock.calls[0][0]
		expect(mailOptions.text).toContain("Total tokens in: 0")
		expect(mailOptions.text).toContain("Total tokens out: 0")
		expect(mailOptions.text).toContain("Cache write tokens: 0")
		expect(mailOptions.text).toContain("Cache read tokens: 0")
		expect(mailOptions.text).toContain("Total tokens: 0")
		expect(mailOptions.text).toContain("Context tokens: 0")
		expect(mailOptions.text).toContain("Total cost: $0.000000")
		expect(mailOptions.text).toContain("Tool attempts: 0")
		expect(mailOptions.text).toContain("Tool failures: 0")
	})

	it("defaults success notifications on and failure notifications off", async () => {
		const contextProxy = createContextProxy({
			emailNotifyOnSuccess: undefined,
			emailNotifyOnFailure: undefined,
		})
		const { service, sendMail, transportFactory } = createService(contextProxy)

		await service.sendTaskNotification({ ...payload, outcome: "success" })
		await service.sendTaskNotification({ ...payload, taskId: "task-2", outcome: "failed" })

		expect(sendMail).toHaveBeenCalledTimes(1)
		expect(transportFactory).toHaveBeenCalledTimes(1)
	})

	it("never sends failed or aborted notifications even when failure notifications are enabled", async () => {
		const { service, sendMail } = createService(createContextProxy({ emailNotifyOnFailure: true }))

		await expect(service.sendTaskNotification({ ...payload, outcome: "failed" })).resolves.toEqual({
			attempted: false,
			sent: false,
			skippedReason: "completion-only",
		})
		await expect(
			service.sendTaskNotification({ ...payload, taskId: "task-2", outcome: "aborted" }),
		).resolves.toEqual({
			attempted: false,
			sent: false,
			skippedReason: "completion-only",
		})

		expect(sendMail).not.toHaveBeenCalled()
	})

	it("does not create a transport when required SMTP configuration is invalid", async () => {
		const { service, transportFactory, log } = createService(createContextProxy({ smtpRecipients: [] }))

		await service.sendTaskNotification(payload)

		expect(transportFactory).not.toHaveBeenCalled()
		expect(log).toHaveBeenCalledWith("Email notifications are enabled but no SMTP recipients are configured.")
	})

	it("requires the SMTP password from secret storage when a username is configured", async () => {
		const { service, transportFactory, log } = createService(createContextProxy({}, ""))

		await service.sendTaskNotification(payload)

		expect(transportFactory).not.toHaveBeenCalled()
		expect(log).toHaveBeenCalledWith("Email notifications are enabled but SMTP password is not configured.")
	})

	it("sends SMTP test emails using saved settings and SecretStorage password even when task notifications are disabled", async () => {
		const contextProxy = createContextProxy({
			emailNotificationsEnabled: false,
			emailNotifyOnSuccess: false,
			emailNotifyOnFailure: false,
			smtpRecipients: [" dev@example.com ", "ops@example.com", "dev@example.com"],
		})
		const { service, sendMail, transportFactory, log } = createService(contextProxy)

		await expect(service.sendTestNotification()).resolves.toEqual({ attempted: true, sent: true })

		expect(contextProxy.getSecret).toHaveBeenCalledWith("smtpPassword")
		expect(transportFactory).toHaveBeenCalledWith({
			host: "smtp.example.com",
			port: 587,
			secure: false,
			requireTLS: undefined,
			auth: {
				user: "smtp-user",
				pass: "smtp-secret",
			},
		})
		expect(sendMail).toHaveBeenCalledWith(
			expect.objectContaining({
				from: "C Code <roo@example.com>",
				to: ["dev@example.com", "ops@example.com"],
				subject: "C Code SMTP test",
				text: expect.stringContaining("Your saved SMTP settings can send email successfully."),
				html: expect.stringContaining("SMTP test email"),
			}),
		)

		const mailOptions = sendMail.mock.calls[0][0]
		expect(mailOptions.text).toContain("Task transcripts and SMTP secrets are not included")
		expect(mailOptions.text).not.toContain("Full transcript content")
		expect(mailOptions.text).not.toContain("Raw API transcript content")
		expect(mailOptions.text).not.toContain("smtp-secret")
		expect(mailOptions.html).not.toContain("smtp-secret")
		expect(log.mock.calls.flat().join("\n")).not.toContain("smtp-secret")
		expect(log).toHaveBeenCalledWith("[email-notifications] SMTP test email sent successfully.")
	})

	it("reports invalid SMTP test configuration without creating a transport", async () => {
		const { service, transportFactory, log } = createService(createContextProxy({ smtpHost: "" }))

		await expect(service.sendTestNotification()).resolves.toEqual({
			attempted: false,
			sent: false,
			skippedReason: "invalid-config",
			error: "SMTP settings are incomplete or invalid. Check the extension output for details.",
		})

		expect(transportFactory).not.toHaveBeenCalled()
		expect(log).toHaveBeenCalledWith("SMTP test email cannot be sent because SMTP host is not configured.")
	})

	it("returns sanitized SMTP test send failures without throwing", async () => {
		const contextProxy = createContextProxy()
		const sendMail = vi.fn().mockRejectedValue(new Error("Authentication failed for smtp-secret"))
		const transportFactory = vi.fn(() => ({ sendMail }))
		const log = vi.fn()
		const service = new EmailNotificationService(contextProxy, { log, transportFactory })

		await expect(service.sendTestNotification()).resolves.toEqual({
			attempted: true,
			sent: false,
			error: "Authentication failed for [redacted]",
		})

		expect(log).toHaveBeenCalledWith(
			"Failed to send SMTP test email notification: Authentication failed for [redacted]",
		)
		expect(log.mock.calls.flat().join("\n")).not.toContain("smtp-secret")
	})

	it("suppresses duplicate task outcome notifications", async () => {
		const { service, sendMail } = createService(createContextProxy())

		await service.sendTaskNotification(payload)
		await service.sendTaskNotification(payload)

		expect(sendMail).toHaveBeenCalledTimes(1)
	})

	it("does not send an aborted notification after a successful completion was already sent", async () => {
		const { service, sendMail } = createService(createContextProxy({ emailNotifyOnFailure: true }))

		await service.sendTaskNotification(payload)
		await service.sendTaskNotification({ ...payload, outcome: "aborted" })

		expect(sendMail).toHaveBeenCalledTimes(1)
		expect(sendMail.mock.calls[0][0].subject).toContain("success")
	})

	it("logs sanitized send failures without throwing", async () => {
		const contextProxy = createContextProxy()
		const sendMail = vi.fn().mockRejectedValue(new Error("Authentication failed for smtp-secret"))
		const transportFactory = vi.fn(() => ({ sendMail }))
		const log = vi.fn()
		const service = new EmailNotificationService(contextProxy, { log, transportFactory })

		await expect(service.sendTaskNotification(payload)).resolves.toEqual({ attempted: true, sent: false })

		expect(log).toHaveBeenCalledWith(
			"Failed to send task completion email notification: Authentication failed for [redacted]",
		)
		expect(log.mock.calls[0][0]).not.toContain("smtp-secret")
	})

	it("does not suppress retries when a previous send attempt failed", async () => {
		const contextProxy = createContextProxy()
		const sendMail = vi
			.fn()
			.mockRejectedValueOnce(new Error("Authentication failed for smtp-secret"))
			.mockResolvedValueOnce(undefined)
		const transportFactory = vi.fn(() => ({ sendMail }))
		const log = vi.fn()
		const service = new EmailNotificationService(contextProxy, { log, transportFactory })

		await expect(service.sendTaskNotification(payload)).resolves.toEqual({ attempted: true, sent: false })
		await expect(service.sendTaskNotification(payload)).resolves.toEqual({ attempted: true, sent: true })

		expect(sendMail).toHaveBeenCalledTimes(2)
		expect(log.mock.calls.flat().join("\n")).not.toContain("smtp-secret")
	})
})

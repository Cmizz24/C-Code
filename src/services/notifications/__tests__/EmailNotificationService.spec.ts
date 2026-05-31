import type { RooCodeSettings, TokenUsage, ToolUsage } from "@roo-code/types"

import type { ContextProxy } from "../../../core/config/ContextProxy"
import { EmailNotificationService, type EmailNotificationPayload } from "../EmailNotificationService"

const tokenUsage: TokenUsage = {
	totalTokensIn: 12,
	totalTokensOut: 34,
	totalCost: 0.123456,
	contextTokens: 2048,
}

const toolUsage = {
	read_file: { attempts: 2, failures: 1 },
} as ToolUsage

const payload: EmailNotificationPayload = {
	taskId: "task-1",
	outcome: "success",
	workspacePath: "/workspace/project",
	mode: "code",
	tokenUsage,
	toolUsage,
}

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

	it("sends successful task notifications with sanitized SMTP config and plain text body", async () => {
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
		expect(sendMail).toHaveBeenCalledWith({
			from: "C Code <roo@example.com>",
			to: ["dev@example.com", "ops@example.com"],
			subject: "C task success for /workspace/project in code",
			text: expect.stringContaining("Task ID: task-1"),
		})

		const mailOptions = sendMail.mock.calls[0][0]
		expect(mailOptions.text).toContain("Status: success")
		expect(mailOptions.text).toContain("Workspace: /workspace/project")
		expect(mailOptions.text).toContain("Total tokens in: 12")
		expect(mailOptions.text).toContain("Tool failures: 1")
		expect(mailOptions.text).not.toContain("apiConversationHistory")
		expect(mailOptions.text).not.toContain("clineMessages")
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

	it("sends failed and aborted notifications when failure notifications are enabled", async () => {
		const { service, sendMail } = createService(createContextProxy({ emailNotifyOnFailure: true }))

		await service.sendTaskNotification({ ...payload, outcome: "failed" })
		await service.sendTaskNotification({ ...payload, taskId: "task-2", outcome: "aborted" })

		expect(sendMail).toHaveBeenCalledTimes(2)
		expect(sendMail.mock.calls[0][0].subject).toContain("failed")
		expect(sendMail.mock.calls[1][0].subject).toContain("aborted")
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

	it("suppresses duplicate task outcome notifications", async () => {
		const { service, sendMail } = createService(createContextProxy())

		await service.sendTaskNotification(payload)
		await service.sendTaskNotification(payload)

		expect(sendMail).toHaveBeenCalledTimes(1)
	})

	it("logs sanitized send failures without throwing", async () => {
		const contextProxy = createContextProxy()
		const sendMail = vi.fn().mockRejectedValue(new Error("Authentication failed for smtp-secret"))
		const transportFactory = vi.fn(() => ({ sendMail }))
		const log = vi.fn()
		const service = new EmailNotificationService(contextProxy, { log, transportFactory })

		await expect(service.sendTaskNotification(payload)).resolves.toBeUndefined()

		expect(log).toHaveBeenCalledWith(
			"Failed to send task completion email notification: Authentication failed for [redacted]",
		)
		expect(log.mock.calls[0][0]).not.toContain("smtp-secret")
	})
})

import nodemailer from "nodemailer"

import type { RooCodeSettings, TokenUsage, ToolUsage } from "@roo-code/types"

import type { ContextProxy } from "../../core/config/ContextProxy"

export type EmailNotificationOutcome = "success" | "failed" | "aborted"

export type EmailNotificationPayload = {
	taskId: string
	outcome: EmailNotificationOutcome
	workspacePath?: string
	mode?: string
	tokenUsage?: TokenUsage
	toolUsage?: ToolUsage
}

type EmailTransportOptions = {
	host: string
	port: number
	secure: boolean
	requireTLS?: boolean
	auth?: {
		user: string
		pass: string
	}
}

type EmailMailOptions = {
	from: string
	to: string[]
	subject: string
	text: string
}

type EmailTransport = {
	sendMail(mailOptions: EmailMailOptions): Promise<unknown>
}

export type EmailNotificationServiceOptions = {
	log?: (message: string) => void
	transportFactory?: (options: EmailTransportOptions) => EmailTransport
}

const DEFAULT_SMTP_PORT = 587
const DEFAULT_SUBJECT_TEMPLATE = "C Code task {outcome}: {taskId}"
const MAX_SENT_NOTIFICATION_KEYS = 500

export class EmailNotificationService {
	private readonly log?: (message: string) => void
	private readonly transportFactory: (options: EmailTransportOptions) => EmailTransport
	private readonly sentNotificationKeys = new Set<string>()
	private readonly sentNotificationKeyOrder: string[] = []

	constructor(
		private readonly contextProxy: ContextProxy,
		options: EmailNotificationServiceOptions = {},
	) {
		this.log = options.log
		this.transportFactory =
			options.transportFactory ?? ((transportOptions) => nodemailer.createTransport(transportOptions))
	}

	public async sendTaskNotification(payload: EmailNotificationPayload): Promise<void> {
		try {
			const settings = this.contextProxy.getValues()

			if (!this.shouldNotify(settings, payload.outcome)) {
				return
			}

			const config = this.buildConfig(settings)

			if (!config) {
				return
			}

			const notificationKey = `${payload.taskId}:${payload.outcome}`

			if (this.hasNotificationBeenSent(notificationKey)) {
				return
			}

			this.rememberNotificationKey(notificationKey)

			const transport = this.transportFactory(config.transportOptions)

			await transport.sendMail({
				from: config.from,
				to: config.recipients,
				subject: this.renderSubject(config.subjectTemplate, payload),
				text: this.renderBody(payload),
			})
		} catch (error) {
			this.logError("Failed to send task completion email notification", error)
		}
	}

	private shouldNotify(settings: RooCodeSettings, outcome: EmailNotificationOutcome): boolean {
		if (!settings.emailNotificationsEnabled) {
			return false
		}

		if (outcome === "success") {
			return settings.emailNotifyOnSuccess ?? true
		}

		return settings.emailNotifyOnFailure ?? false
	}

	private buildConfig(settings: RooCodeSettings):
		| {
				transportOptions: EmailTransportOptions
				from: string
				recipients: string[]
				subjectTemplate: string
		  }
		| undefined {
		const host = settings.smtpHost?.trim()
		const port = settings.smtpPort ?? DEFAULT_SMTP_PORT
		const from = settings.smtpFromAddress?.trim()
		const recipients = this.normalizeRecipients(settings.smtpRecipients)
		const username = settings.smtpUsername?.trim()
		const password = this.contextProxy.getSecret("smtpPassword")
		const subjectTemplate = settings.smtpSubjectTemplate?.trim() || DEFAULT_SUBJECT_TEMPLATE

		if (!host) {
			this.log?.("Email notifications are enabled but SMTP host is not configured.")
			return undefined
		}

		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			this.log?.("Email notifications are enabled but SMTP port is invalid.")
			return undefined
		}

		if (!from) {
			this.log?.("Email notifications are enabled but SMTP from address is not configured.")
			return undefined
		}

		if (recipients.length === 0) {
			this.log?.("Email notifications are enabled but no SMTP recipients are configured.")
			return undefined
		}

		if (username && !password) {
			this.log?.("Email notifications are enabled but SMTP password is not configured.")
			return undefined
		}

		return {
			transportOptions: {
				host,
				port,
				secure: settings.smtpSecure ?? false,
				requireTLS: settings.smtpRequireTls || undefined,
				...(username && password ? { auth: { user: username, pass: password } } : {}),
			},
			from,
			recipients,
			subjectTemplate,
		}
	}

	private normalizeRecipients(recipients: RooCodeSettings["smtpRecipients"]): string[] {
		return Array.from(new Set((recipients ?? []).map((recipient) => recipient.trim()).filter(Boolean)))
	}

	private renderSubject(subjectTemplate: string, payload: EmailNotificationPayload): string {
		return this.replaceTemplateTokens(subjectTemplate, this.getTemplateTokens(payload))
	}

	private renderBody(payload: EmailNotificationPayload): string {
		const tokens = this.getTemplateTokens(payload)
		const lines = [
			"C Code task notification",
			"",
			`Task ID: ${payload.taskId}`,
			`Status: ${tokens.status}`,
			`Workspace: ${tokens.workspace}`,
			`Mode: ${tokens.mode}`,
			`Total tokens in: ${tokens.totalTokensIn}`,
			`Total tokens out: ${tokens.totalTokensOut}`,
			`Context tokens: ${tokens.contextTokens}`,
			`Total cost: ${tokens.totalCost}`,
			`Tool attempts: ${tokens.toolAttempts}`,
			`Tool failures: ${tokens.toolFailures}`,
		]

		return lines.join("\n")
	}

	private getTemplateTokens(payload: EmailNotificationPayload): Record<string, string> {
		const tokenUsage = payload.tokenUsage
		const toolCounts = this.getToolUsageCounts(payload.toolUsage)
		const workspace = payload.workspacePath || "Unknown workspace"

		return {
			taskId: payload.taskId,
			outcome: payload.outcome,
			status: payload.outcome,
			workspace,
			workspacePath: workspace,
			mode: payload.mode || "unknown",
			totalTokensIn: this.formatNumber(tokenUsage?.totalTokensIn),
			totalTokensOut: this.formatNumber(tokenUsage?.totalTokensOut),
			totalTokens: this.formatNumber(
				tokenUsage ? tokenUsage.totalTokensIn + tokenUsage.totalTokensOut : undefined,
			),
			contextTokens: this.formatNumber(tokenUsage?.contextTokens),
			totalCost: this.formatCost(tokenUsage?.totalCost),
			toolAttempts: this.formatNumber(toolCounts.attempts),
			toolFailures: this.formatNumber(toolCounts.failures),
		}
	}

	private replaceTemplateTokens(template: string, tokens: Record<string, string>): string {
		return template.replace(/\{\{?([a-zA-Z0-9_]+)\}?\}/g, (match, tokenName: string) => tokens[tokenName] ?? match)
	}

	private getToolUsageCounts(toolUsage: ToolUsage | undefined): { attempts: number; failures: number } {
		return Object.values(toolUsage ?? {}).reduce(
			(counts, usage) => ({
				attempts: counts.attempts + usage.attempts,
				failures: counts.failures + usage.failures,
			}),
			{ attempts: 0, failures: 0 },
		)
	}

	private formatNumber(value: number | undefined): string {
		return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "n/a"
	}

	private formatCost(value: number | undefined): string {
		return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(6)}` : "n/a"
	}

	private hasNotificationBeenSent(notificationKey: string): boolean {
		return this.sentNotificationKeys.has(notificationKey)
	}

	private rememberNotificationKey(notificationKey: string): void {
		this.sentNotificationKeys.add(notificationKey)
		this.sentNotificationKeyOrder.push(notificationKey)

		while (this.sentNotificationKeyOrder.length > MAX_SENT_NOTIFICATION_KEYS) {
			const oldestKey = this.sentNotificationKeyOrder.shift()

			if (oldestKey) {
				this.sentNotificationKeys.delete(oldestKey)
			}
		}
	}

	private logError(message: string, error: unknown): void {
		if (!this.log) {
			return
		}

		this.log(`${message}: ${this.sanitizeErrorMessage(error)}`)
	}

	private sanitizeErrorMessage(error: unknown): string {
		const password = this.contextProxy.getSecret("smtpPassword")
		const message = error instanceof Error ? error.message : String(error)

		return password ? message.replaceAll(password, "[redacted]") : message
	}
}

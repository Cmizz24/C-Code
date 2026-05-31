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
	html?: string
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

const OUTCOME_LABELS: Record<EmailNotificationOutcome, string> = {
	success: "Completed",
	failed: "Failed",
	aborted: "Aborted",
}

const OUTCOME_COLORS: Record<EmailNotificationOutcome, string> = {
	success: "#2da44e",
	failed: "#cf222e",
	aborted: "#bf8700",
}

type NotificationBodyRow = {
	label: string
	value: string
}

export class EmailNotificationService {
	private readonly log?: (message: string) => void
	private readonly transportFactory: (options: EmailTransportOptions) => EmailTransport
	private readonly sentTaskOutcomes = new Map<string, EmailNotificationOutcome>()
	private readonly sentTaskOutcomeOrder: string[] = []

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

			if (this.hasNotificationBeenSent(payload)) {
				return
			}

			this.rememberNotification(payload)

			const transport = this.transportFactory(config.transportOptions)

			await transport.sendMail({
				from: config.from,
				to: config.recipients,
				subject: this.renderSubject(config.subjectTemplate, payload),
				text: this.renderTextBody(payload),
				html: this.renderHtmlBody(payload),
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

	private renderTextBody(payload: EmailNotificationPayload): string {
		const tokens = this.getTemplateTokens(payload)
		const rows = this.getBodyRows(payload)
		const lines = [
			"C Code task notification",
			"",
			`${tokens.status}: ${payload.taskId}`,
			"",
			...rows.map(({ label, value }) => `${label}: ${value}`),
			"",
			"Task transcripts and SMTP secrets are not included in this notification.",
		]

		return lines.join("\n")
	}

	private renderHtmlBody(payload: EmailNotificationPayload): string {
		const tokens = this.getTemplateTokens(payload)
		const rows = this.getBodyRows(payload)
		const accentColor = OUTCOME_COLORS[payload.outcome]
		const escapedStatus = this.escapeHtml(tokens.status)
		const escapedTaskId = this.escapeHtml(payload.taskId)
		const preheader = this.escapeHtml(`C Code task ${tokens.status}: ${payload.taskId}`)
		const rowMarkup = rows
			.map(
				({ label, value }) => `
					<tr>
						<td style="padding:10px 0;color:#57606a;font-size:13px;line-height:18px;border-bottom:1px solid #d8dee4;">${this.escapeHtml(label)}</td>
						<td style="padding:10px 0;color:#24292f;font-size:13px;line-height:18px;text-align:right;border-bottom:1px solid #d8dee4;font-weight:600;">${this.escapeHtml(value)}</td>
					</tr>`,
			)
			.join("")

		return `<!doctype html>
<html lang="en">
	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>C Code task notification</title>
	</head>
	<body style="margin:0;padding:0;background-color:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#24292f;">
		<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${preheader}</div>
		<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f6f8fa;margin:0;padding:24px 0;">
			<tr>
				<td align="center" style="padding:0 12px;">
					<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background-color:#ffffff;border:1px solid #d8dee4;border-radius:12px;overflow:hidden;">
						<tr>
							<td style="background-color:#24292f;color:#ffffff;padding:20px 24px;">
								<div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#c9d1d9;margin-bottom:8px;">C Code notification</div>
								<div style="font-size:24px;line-height:30px;font-weight:700;margin:0;">Task ${escapedStatus}</div>
							</td>
						</tr>
						<tr>
							<td style="padding:24px;">
								<div style="display:inline-block;background-color:${accentColor};color:#ffffff;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;margin-bottom:16px;">${escapedStatus}</div>
								<div style="font-size:16px;line-height:24px;font-weight:700;margin-bottom:4px;">Task ID</div>
								<div style="font-family:Consolas,'Liberation Mono',Menlo,monospace;font-size:14px;line-height:20px;color:#57606a;word-break:break-all;margin-bottom:20px;">${escapedTaskId}</div>
								<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
${rowMarkup}
								</table>
								<div style="margin-top:20px;padding:12px 14px;background-color:#f6f8fa;border:1px solid #d8dee4;border-radius:8px;color:#57606a;font-size:12px;line-height:18px;">
									Task transcripts and SMTP secrets are not included in this notification.
								</div>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>`
	}

	private getBodyRows(payload: EmailNotificationPayload): NotificationBodyRow[] {
		const tokens = this.getTemplateTokens(payload)

		return [
			{ label: "Task ID", value: payload.taskId },
			{ label: "Status", value: tokens.status },
			{ label: "Workspace", value: tokens.workspace },
			{ label: "Mode", value: tokens.mode },
			{ label: "Total tokens in", value: tokens.totalTokensIn },
			{ label: "Total tokens out", value: tokens.totalTokensOut },
			{ label: "Context tokens", value: tokens.contextTokens },
			{ label: "Total cost", value: tokens.totalCost },
			{ label: "Tool attempts", value: tokens.toolAttempts },
			{ label: "Tool failures", value: tokens.toolFailures },
		]
	}

	private getTemplateTokens(payload: EmailNotificationPayload): Record<string, string> {
		const tokenUsage = payload.tokenUsage
		const toolCounts = this.getToolUsageCounts(payload.toolUsage)
		const workspace = payload.workspacePath || "Unknown workspace"

		return {
			taskId: payload.taskId,
			outcome: payload.outcome,
			status: OUTCOME_LABELS[payload.outcome],
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
		const normalizedTokens = Object.entries(tokens).reduce<Record<string, string>>((acc, [tokenName, value]) => {
			acc[this.normalizeTemplateTokenName(tokenName)] = value
			return acc
		}, {})

		return template.replace(/\{\{?([a-zA-Z0-9_]+)\}?\}/g, (match, tokenName: string) => {
			return tokens[tokenName] ?? normalizedTokens[this.normalizeTemplateTokenName(tokenName)] ?? match
		})
	}

	private normalizeTemplateTokenName(tokenName: string): string {
		return tokenName.replaceAll("_", "").toLowerCase()
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

	private hasNotificationBeenSent(payload: EmailNotificationPayload): boolean {
		const previousOutcome = this.sentTaskOutcomes.get(payload.taskId)

		if (!previousOutcome) {
			return false
		}

		if (previousOutcome === "success") {
			return true
		}

		return payload.outcome !== "success"
	}

	private rememberNotification(payload: EmailNotificationPayload): void {
		if (!this.sentTaskOutcomes.has(payload.taskId)) {
			this.sentTaskOutcomeOrder.push(payload.taskId)
		}

		this.sentTaskOutcomes.set(payload.taskId, payload.outcome)

		while (this.sentTaskOutcomeOrder.length > MAX_SENT_NOTIFICATION_KEYS) {
			const oldestKey = this.sentTaskOutcomeOrder.shift()

			if (oldestKey) {
				this.sentTaskOutcomes.delete(oldestKey)
			}
		}
	}

	private escapeHtml(value: string): string {
		return value.replace(/[&<>'"]/g, (character) => {
			switch (character) {
				case "&":
					return "&amp;"
				case "<":
					return "&lt;"
				case ">":
					return "&gt;"
				case "'":
					return "&#39;"
				case '"':
					return "&quot;"
				default:
					return character
			}
		})
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

import nodemailer from "nodemailer"

import type { RooCodeSettings, TokenUsage, ToolUsage } from "@roo-code/types"

import type { ContextProxy } from "../../core/config/ContextProxy"

export type EmailNotificationOutcome = "success" | "failed" | "aborted"

export type EmailNotificationPayload = {
	taskId: string
	outcome: EmailNotificationOutcome
	summary?: string
	workflowSummary?: string
	usageScope?: string
	workspacePath?: string
	mode?: string
	notificationType?: "delegated-child" | "parallel-workflow" | "final-parent"
	parentTaskId?: string
	rootTaskId?: string
	agentId?: string
	tokenUsage?: TokenUsage
	toolUsage?: ToolUsage
	requestCount?: number
}

type EmailNotificationScope = NonNullable<EmailNotificationPayload["notificationType"]> | "task"

export type EmailNotificationSendResult = {
	attempted: boolean
	sent: boolean
	skippedReason?: "disabled" | "invalid-config" | "duplicate" | "completion-only"
	error?: string
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
const DEFAULT_TEST_SUBJECT = "C Code SMTP test"
const MAX_SENT_NOTIFICATION_KEYS = 500
const MAX_NOTIFICATION_SUMMARY_LENGTH = 600

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

const ZERO_USAGE: TokenUsage = {
	totalTokensIn: 0,
	totalTokensOut: 0,
	totalCacheWrites: 0,
	totalCacheReads: 0,
	totalCost: 0,
	contextTokens: 0,
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

	public async sendTaskNotification(payload: EmailNotificationPayload): Promise<EmailNotificationSendResult> {
		let attempted = false

		try {
			const settings = this.contextProxy.getValues()

			if (payload.outcome !== "success") {
				return { attempted: false, sent: false, skippedReason: "completion-only" }
			}

			if (!this.shouldNotify(settings, payload.outcome)) {
				return { attempted: false, sent: false, skippedReason: "disabled" }
			}

			const config = this.buildConfig(settings)

			if (!config) {
				return { attempted: false, sent: false, skippedReason: "invalid-config" }
			}

			if (this.hasNotificationBeenSent(payload)) {
				return { attempted: false, sent: false, skippedReason: "duplicate" }
			}

			const transport = this.transportFactory(config.transportOptions)
			const mailOptions = {
				from: config.from,
				to: config.recipients,
				subject: this.renderSubject(config.subjectTemplate, payload),
				text: this.renderTextBody(payload),
				html: this.renderHtmlBody(payload),
			}

			attempted = true
			await transport.sendMail(mailOptions)
			this.rememberNotification(payload)

			return { attempted: true, sent: true }
		} catch (error) {
			this.logError("Failed to send task completion email notification", error)
			return { attempted, sent: false }
		}
	}

	public async sendTestNotification(): Promise<EmailNotificationSendResult> {
		let attempted = false

		try {
			const settings = this.contextProxy.getValues()
			const config = this.buildConfig(settings, "test")

			if (!config) {
				return {
					attempted: false,
					sent: false,
					skippedReason: "invalid-config",
					error: "SMTP settings are incomplete or invalid. Check the extension output for details.",
				}
			}

			this.log?.(
				`[email-notifications] Sending SMTP test email to ${config.recipients.length} recipient(s) using ${config.transportOptions.host}:${config.transportOptions.port}.`,
			)

			const transport = this.transportFactory(config.transportOptions)
			const mailOptions = {
				from: config.from,
				to: config.recipients,
				subject: DEFAULT_TEST_SUBJECT,
				text: this.renderTestTextBody(),
				html: this.renderTestHtmlBody(),
			}

			attempted = true
			await transport.sendMail(mailOptions)
			this.log?.("[email-notifications] SMTP test email sent successfully.")

			return { attempted: true, sent: true }
		} catch (error) {
			const sanitizedError = this.sanitizeErrorMessage(error)
			this.log?.(`Failed to send SMTP test email notification: ${sanitizedError}`)
			return { attempted, sent: false, error: sanitizedError }
		}
	}

	private shouldNotify(settings: RooCodeSettings, outcome: EmailNotificationOutcome): boolean {
		if (!settings.emailNotificationsEnabled) {
			return false
		}

		if (outcome === "success") {
			return settings.emailNotifyOnSuccess ?? true
		}

		return false
	}

	private buildConfig(
		settings: RooCodeSettings,
		context: "notification" | "test" = "notification",
	):
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
			this.logInvalidConfig("SMTP host is not configured.", context)
			return undefined
		}

		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			this.logInvalidConfig("SMTP port is invalid.", context)
			return undefined
		}

		if (!from) {
			this.logInvalidConfig("SMTP from address is not configured.", context)
			return undefined
		}

		if (recipients.length === 0) {
			this.logInvalidConfig("no SMTP recipients are configured.", context)
			return undefined
		}

		if (username && !password) {
			this.logInvalidConfig("SMTP password is not configured.", context)
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

	private logInvalidConfig(reason: string, context: "notification" | "test"): void {
		const prefix =
			context === "test" ? "SMTP test email cannot be sent because" : "Email notifications are enabled but"
		this.log?.(`${prefix} ${reason}`)
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

	private renderTestTextBody(): string {
		return [
			"C Code SMTP test email",
			"",
			"Your saved SMTP settings can send email successfully.",
			"Task transcripts and SMTP secrets are not included in this test email.",
		].join("\n")
	}

	private renderTestHtmlBody(): string {
		return `<!doctype html>
<html lang="en">
	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>C Code SMTP test</title>
	</head>
	<body style="margin:0;padding:0;background-color:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#24292f;">
		<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f6f8fa;margin:0;padding:24px 0;">
			<tr>
				<td align="center" style="padding:0 12px;">
					<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background-color:#ffffff;border:1px solid #d8dee4;border-radius:12px;overflow:hidden;">
						<tr>
							<td style="background-color:#24292f;color:#ffffff;padding:20px 24px;">
								<div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#c9d1d9;margin-bottom:8px;">C Code notification</div>
								<div style="font-size:24px;line-height:30px;font-weight:700;margin:0;">SMTP test email</div>
							</td>
						</tr>
						<tr>
							<td style="padding:24px;font-size:14px;line-height:22px;">
								<p style="margin:0 0 12px;">Your saved SMTP settings can send email successfully.</p>
								<div style="margin-top:20px;padding:12px 14px;background-color:#f6f8fa;border:1px solid #d8dee4;border-radius:8px;color:#57606a;font-size:12px;line-height:18px;">
									Task transcripts and SMTP secrets are not included in this test email.
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
		const summary = this.formatSummary(payload.summary)
		const workflowSummary = this.formatSummary(payload.workflowSummary)
		const usageScope = this.formatSummary(payload.usageScope)

		return [
			{ label: "Task ID", value: payload.taskId },
			{ label: "Status", value: tokens.status },
			...(payload.notificationType ? [{ label: "Notification type", value: tokens.notificationLabel }] : []),
			...(summary ? [{ label: "Completion summary", value: summary }] : []),
			...(workflowSummary ? [{ label: "Workflow summary", value: workflowSummary }] : []),
			...(usageScope ? [{ label: "Usage scope", value: usageScope }] : []),
			...(tokens.parentTaskId ? [{ label: "Parent task ID", value: tokens.parentTaskId }] : []),
			...(tokens.rootTaskId ? [{ label: "Root task ID", value: tokens.rootTaskId }] : []),
			...(tokens.agentId ? [{ label: "Agent ID", value: tokens.agentId }] : []),
			{ label: "Workspace", value: tokens.workspace },
			{ label: "Mode", value: tokens.mode },
			{ label: "Requests", value: tokens.requests },
			{ label: "Total tokens in", value: tokens.totalTokensIn },
			{ label: "Total tokens out", value: tokens.totalTokensOut },
			{ label: "Cache write tokens", value: tokens.totalCacheWrites },
			{ label: "Cache read tokens", value: tokens.totalCacheReads },
			{ label: "Total tokens", value: tokens.totalTokens },
			{ label: "Context tokens", value: tokens.contextTokens },
			{ label: "Total cost", value: tokens.totalCost },
			{ label: "Tool attempts", value: tokens.toolAttempts },
			{ label: "Tool failures", value: tokens.toolFailures },
		]
	}

	private getTemplateTokens(payload: EmailNotificationPayload): Record<string, string> {
		const tokenUsage = this.normalizeTokenUsage(payload.tokenUsage)
		const toolCounts = this.getToolUsageCounts(payload.toolUsage)
		const workspace = payload.workspacePath || "Unknown workspace"
		const summary = this.formatSummary(payload.summary) || ""
		const workflowSummary = this.formatSummary(payload.workflowSummary) || ""
		const usageScope = this.formatSummary(payload.usageScope) || ""
		const totalTokens = tokenUsage.totalTokensIn + tokenUsage.totalTokensOut
		const notificationType = payload.notificationType || "task"

		return {
			taskId: payload.taskId,
			outcome: payload.outcome,
			status: OUTCOME_LABELS[payload.outcome],
			notificationType,
			notificationLabel: this.getNotificationTypeLabel(notificationType),
			parentTaskId: this.sanitizeNotificationText(payload.parentTaskId) || "",
			rootTaskId: this.sanitizeNotificationText(payload.rootTaskId) || "",
			agentId: this.sanitizeNotificationText(payload.agentId) || "",
			summary,
			completionSummary: summary,
			workflowSummary,
			usageScope,
			workspace,
			workspacePath: workspace,
			mode: payload.mode || "unknown",
			requests: this.formatNumber(payload.requestCount),
			totalTokensIn: this.formatNumber(tokenUsage.totalTokensIn),
			totalTokensOut: this.formatNumber(tokenUsage.totalTokensOut),
			totalCacheWrites: this.formatNumber(tokenUsage.totalCacheWrites),
			totalCacheReads: this.formatNumber(tokenUsage.totalCacheReads),
			totalTokens: this.formatNumber(totalTokens),
			contextTokens: this.formatNumber(tokenUsage.contextTokens),
			totalCost: this.formatCost(tokenUsage.totalCost),
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

	private getNotificationTypeLabel(notificationType: string): string {
		switch (notificationType) {
			case "delegated-child":
				return "Delegated child task"
			case "parallel-workflow":
				return "Parallel agent workflow"
			case "final-parent":
				return "Final parent task workflow"
			default:
				return "Task"
		}
	}

	private normalizeTokenUsage(tokenUsage: TokenUsage | undefined): TokenUsage {
		return {
			totalTokensIn: this.toFiniteNotificationNumber(tokenUsage?.totalTokensIn),
			totalTokensOut: this.toFiniteNotificationNumber(tokenUsage?.totalTokensOut),
			totalCacheWrites: this.toFiniteNotificationNumber(tokenUsage?.totalCacheWrites),
			totalCacheReads: this.toFiniteNotificationNumber(tokenUsage?.totalCacheReads),
			totalCost: this.toFiniteNotificationNumber(tokenUsage?.totalCost),
			contextTokens: this.toFiniteNotificationNumber(tokenUsage?.contextTokens),
		}
	}

	private getToolUsageCounts(toolUsage: ToolUsage | undefined): { attempts: number; failures: number } {
		if (!toolUsage || typeof toolUsage !== "object") {
			return { attempts: 0, failures: 0 }
		}

		return Object.values(toolUsage).reduce(
			(counts, usage) => ({
				attempts: counts.attempts + this.toFiniteNotificationNumber(usage?.attempts),
				failures: counts.failures + this.toFiniteNotificationNumber(usage?.failures),
			}),
			{ attempts: 0, failures: 0 },
		)
	}

	private toFiniteNotificationNumber(value: unknown): number {
		return typeof value === "number" && Number.isFinite(value) ? value : 0
	}

	private formatNumber(value: number | undefined): string {
		return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "0"
	}

	private formatCost(value: number | undefined): string {
		return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(6)}` : "$0.000000"
	}

	private formatSummary(summary: string | undefined): string | undefined {
		const sanitizedSummary = this.sanitizeNotificationText(summary)

		if (!sanitizedSummary) {
			return undefined
		}

		if (sanitizedSummary.length <= MAX_NOTIFICATION_SUMMARY_LENGTH) {
			return sanitizedSummary
		}

		return `${sanitizedSummary.slice(0, MAX_NOTIFICATION_SUMMARY_LENGTH - 1).trimEnd()}…`
	}

	private sanitizeNotificationText(value: string | undefined): string | undefined {
		const normalizedValue = value?.replace(/\s+/g, " ").trim()

		if (!normalizedValue) {
			return undefined
		}

		const password = this.contextProxy.getSecret("smtpPassword")
		return password ? normalizedValue.replaceAll(password, "[redacted]") : normalizedValue
	}

	private hasNotificationBeenSent(payload: EmailNotificationPayload): boolean {
		const previousOutcome = this.sentTaskOutcomes.get(this.getNotificationKey(payload))

		if (!previousOutcome) {
			return false
		}

		if (previousOutcome === "success") {
			return true
		}

		return payload.outcome !== "success"
	}

	private rememberNotification(payload: EmailNotificationPayload): void {
		const notificationKey = this.getNotificationKey(payload)

		if (!this.sentTaskOutcomes.has(notificationKey)) {
			this.sentTaskOutcomeOrder.push(notificationKey)
		}

		this.sentTaskOutcomes.set(notificationKey, payload.outcome)

		while (this.sentTaskOutcomeOrder.length > MAX_SENT_NOTIFICATION_KEYS) {
			const oldestKey = this.sentTaskOutcomeOrder.shift()

			if (oldestKey) {
				this.sentTaskOutcomes.delete(oldestKey)
			}
		}
	}

	private getNotificationKey(payload: Pick<EmailNotificationPayload, "taskId" | "notificationType">): string {
		return `${this.getNotificationScope(payload.notificationType)}:${payload.taskId}`
	}

	private getNotificationScope(
		notificationType: EmailNotificationPayload["notificationType"],
	): EmailNotificationScope {
		return notificationType ?? "task"
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

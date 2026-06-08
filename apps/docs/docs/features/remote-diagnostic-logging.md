---
description: Configure opt-in remote diagnostic logging for C-Code, including the default cmtesting.site endpoint, privacy safeguards, payload format, and server-side receiver examples.
keywords:
    - remote diagnostic logging
    - debug logging
    - diagnostics endpoint
    - cmtesting.site
    - extension diagnostics
    - troubleshooting
    - privacy
    - server integration
---

# Remote Diagnostic Logging

Remote diagnostic logging lets you opt in to sending sanitized C-Code extension diagnostics to an HTTPS endpoint for troubleshooting. It is disabled by default and does not send any remote requests until you explicitly enable it in Settings.

---

## Key Properties

- **Opt-in only:** Remote diagnostic logging is off by default.
- **Default endpoint:** `https://cmtesting.site/api/extension/debug-log`
- **Editable endpoint:** You can replace the default with another HTTPS endpoint.
- **Local debug unchanged:** The existing local debug mode remains separate.
- **Fail closed:** Invalid, non-HTTPS, unreachable, or failing endpoints do not interrupt extension workflows.
- **Non-blocking delivery:** Events are queued, batched, rate limited, retried with backoff, and dropped silently after retry limits.

---

## Configure in C-Code

1. Open C-Code Settings.
2. Go to **About**.
3. Enable **Remote diagnostic logging**.
4. Keep the default endpoint or enter your own HTTPS endpoint.
5. Optionally enter an authentication token. If present, C-Code sends it as a Bearer token.
6. Click **Save**.

No remote request is made unless the setting is enabled and saved.

---

## Privacy Safeguards

Remote diagnostic logging is designed for operational troubleshooting, not content collection.

C-Code does **not** send these by default:

- API keys, auth tokens, passwords, cookies, credentials, private keys, or other secrets
- Raw prompts, user messages, transcripts, or conversation history
- Full file contents or raw request/response bodies
- Workspace paths, file paths, current working directories, or environment variables
- Raw headers or images

Safe fields may include:

- Extension version
- Anonymous install/session identifiers
- Platform metadata such as operating system, architecture, and VS Code version
- Event type, timestamp, severity, and feature area
- Safe mode/provider/tool/model names
- Redacted error message and stack details
- Safe token, cost, and tool-usage summaries
- Hashed task/agent identifiers

Sensitive-looking values are redacted before sending. Task and agent identifiers are hashed, so the receiver can correlate related diagnostic events without receiving the original IDs.

---

## Request Format

C-Code sends HTTPS `POST` requests with JSON bodies.

Headers:

```http
Content-Type: application/json
X-C-Code-Diagnostics-Version: 1
Authorization: Bearer <optional-token>
```

Example body:

```json
{
	"version": 1,
	"source": "c-code-vscode-extension",
	"sentAt": "2026-06-08T23:00:00.000Z",
	"installId": "anonymous-install-id",
	"sessionId": "anonymous-session-id",
	"extensionVersion": "3.53.0",
	"platform": {
		"os": "win32",
		"arch": "x64",
		"vscodeVersion": "1.100.0"
	},
	"events": [
		{
			"type": "task.completed",
			"severity": "info",
			"timestamp": "2026-06-08T23:00:00.000Z",
			"featureArea": "task",
			"taskId": "7f2a1d0e8b9c4a11",
			"mode": "code",
			"provider": "anthropic",
			"modelId": "claude-sonnet-4",
			"tokenUsage": {
				"totalTokensIn": 1234,
				"totalTokensOut": 567
			},
			"toolUsage": {
				"read_file": {
					"attempts": 2,
					"failures": 0
				}
			},
			"properties": {
				"outcome": "completed",
				"background": false
			}
		}
	]
}
```

Treat the schema as versioned by `version` and `X-C-Code-Diagnostics-Version`. Receivers should ignore unknown fields for forward compatibility.

---

## Server-Side Receiver Requirements

Your endpoint should:

- Accept `POST` with `Content-Type: application/json`.
- Return any `2xx` status for successful ingestion.
- Return `401` or `403` for invalid optional Bearer tokens.
- Return `429` when intentionally rate limiting.
- Keep responses small; C-Code does not need a response body.
- Avoid logging the optional `Authorization` header in your server logs.
- Store diagnostic payloads with access controls and retention limits appropriate for troubleshooting data.

C-Code retries transient failures, including `429` and `5xx` responses, with backoff. Other non-2xx responses are treated as terminal for that batch.

---

## Example Express Receiver

```ts
import express from "express"

const app = express()
const expectedToken = process.env.C_CODE_DIAGNOSTICS_TOKEN

app.use(express.json({ limit: "256kb" }))

app.post("/api/extension/debug-log", (req, res) => {
	if (expectedToken) {
		const authHeader = req.header("authorization") ?? ""
		if (authHeader !== `Bearer ${expectedToken}`) {
			return res.sendStatus(401)
		}
	}

	const payload = req.body

	if (payload?.version !== 1 || !Array.isArray(payload?.events)) {
		return res.status(400).json({ error: "Invalid diagnostics payload" })
	}

	for (const event of payload.events) {
		console.log("C-Code diagnostic event", {
			installId: payload.installId,
			sessionId: payload.sessionId,
			extensionVersion: payload.extensionVersion,
			platform: payload.platform,
			type: event.type,
			severity: event.severity,
			timestamp: event.timestamp,
			featureArea: event.featureArea,
		})
	}

	return res.sendStatus(204)
})

app.listen(3000)
```

---

## Example Next.js Route Handler

```ts
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
	const expectedToken = process.env.C_CODE_DIAGNOSTICS_TOKEN

	if (expectedToken && request.headers.get("authorization") !== `Bearer ${expectedToken}`) {
		return new NextResponse(null, { status: 401 })
	}

	const payload = await request.json()

	if (payload?.version !== 1 || !Array.isArray(payload?.events)) {
		return NextResponse.json({ error: "Invalid diagnostics payload" }, { status: 400 })
	}

	// Persist to your log pipeline, database, or observability tool.
	// Do not log Authorization headers or expand payloads into unsafe raw logs.
	console.log(
		payload.events.map((event: any) => ({
			installId: payload.installId,
			sessionId: payload.sessionId,
			extensionVersion: payload.extensionVersion,
			type: event.type,
			severity: event.severity,
			timestamp: event.timestamp,
			featureArea: event.featureArea,
		})),
	)

	return new NextResponse(null, { status: 204 })
}
```

---

## Operational Notes

- Use HTTPS. Non-HTTPS endpoints are rejected by the extension.
- Keep authentication tokens short-lived or rotate them periodically when possible.
- Apply server-side rate limits and return `429` when needed.
- Keep payload limits modest; C-Code batches structured metadata, not content.
- Prefer storing only the fields you need for troubleshooting.
- Use retention policies to delete old diagnostic events.

---

## Troubleshooting

- If no events arrive, confirm remote diagnostic logging is enabled and saved.
- Confirm the endpoint starts with `https://`.
- Confirm your server returns a `2xx` status on success.
- If you configured an optional token, confirm the receiver expects `Authorization: Bearer <token>`.
- Remember that C-Code fails closed: network failures, rejected requests, and validation failures are not surfaced to users during normal workflows.

---
description: Understand opt-in remote diagnostic logging for C-Code, including the About debug toggle, fixed cmtesting.site endpoint, no-token behavior, privacy safeguards, payload format, and server-side receiver hardening.
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

Remote diagnostic logging sends sanitized C-Code extension diagnostics to the fixed C-Code troubleshooting endpoint only after you explicitly enable debug mode. It is disabled by default and does not send remote diagnostic requests until the About tab debug toggle is enabled and saved.

---

## Key Properties

- **Opt-in only:** Remote diagnostic logging is off by default.
- **Single user-facing opt-in:** The About tab **Enable debug mode** checkbox controls both local debug helpers and sanitized remote diagnostics.
- **Fixed endpoint:** C-Code sends only to `https://cmtesting.site/api/extension/debug-log`.
- **No user-entered endpoint:** The diagnostics endpoint is not configurable in Settings.
- **No user-entered token:** C-Code does not expose, store, or send a diagnostics auth token.
- **No Authorization header:** Diagnostic requests do not include a Bearer token or other user-provided secret.
- **Fail closed:** Disabled debug mode, invalid internal endpoint configuration, unreachable servers, and failed sends never interrupt extension workflows.
- **Non-blocking delivery:** Events are queued, batched, rate limited, retried with backoff, and dropped silently after retry limits.

---

## Enable in C-Code

1. Open C-Code Settings.
2. Go to **About**.
3. Enable **Enable debug mode**.
4. Click **Save**.

No remote diagnostic request is made unless debug mode is enabled and saved. Turning the same debug checkbox off and saving stops future remote diagnostic sends.

---

## Privacy Safeguards

Remote diagnostic logging is designed for operational troubleshooting, not content collection.

C-Code does **not** send these by default:

- API keys, auth tokens, passwords, cookies, credentials, private keys, or other secrets
- Raw prompts, user messages, transcripts, or conversation history
- Full file contents or raw request/response bodies
- Workspace paths, file paths, current working directories, or environment variables
- Raw URLs, raw headers, or images
- User-entered diagnostics tokens, because there is no diagnostics token setting

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

C-Code sends HTTPS `POST` requests with JSON bodies to the fixed endpoint `https://cmtesting.site/api/extension/debug-log`.

Headers:

```http
Content-Type: application/json
X-C-Code-Diagnostics-Version: 1
```

No `Authorization` header is sent.

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

The fixed receiver at `https://cmtesting.site/api/extension/debug-log` should:

- Accept only `POST` with `Content-Type: application/json`.
- Require TLS and redirect or reject cleartext HTTP.
- Validate `version`, `source`, `sentAt`, top-level metadata, event array size, and event field types.
- Enforce small payload limits; C-Code sends structured metadata, not content.
- Return any `2xx` status for successful ingestion.
- Return `429` when intentionally rate limiting.
- Use rate limiting by IP, anonymous install ID, session ID, and aggregate request volume.
- Apply abuse controls such as payload-size caps, event-count caps, schema validation, anomaly detection, and temporary blocks.
- Use strict CORS if browser requests are supported, and reject unnecessary browser origins.
- Store diagnostic payloads with access controls and retention limits appropriate for troubleshooting data.
- Optionally allowlist server-side install IDs or session IDs for controlled diagnostic sessions.

C-Code does not send user-entered tokens, so the receiver must not depend on per-user Bearer tokens from the extension. If stronger access control is needed, use server-side allowlisting, deployment-level authentication, network controls, or temporary incident-specific server rules.

C-Code retries transient failures, including `429` and `5xx` responses, with backoff. Other non-2xx responses are treated as terminal for that batch.

---

## Example Express Receiver

```ts
import express from "express"

const app = express()
const allowedInstallIds = new Set((process.env.C_CODE_DIAGNOSTICS_INSTALL_ALLOWLIST ?? "").split(",").filter(Boolean))

app.use(express.json({ limit: "256kb" }))

app.post("/api/extension/debug-log", (req, res) => {
	const payload = req.body

	if (payload?.version !== 1 || payload?.source !== "c-code-vscode-extension" || !Array.isArray(payload?.events)) {
		return res.status(400).json({ error: "Invalid diagnostics payload" })
	}

	if (payload.events.length > 50) {
		return res.status(413).json({ error: "Too many diagnostic events" })
	}

	if (allowedInstallIds.size > 0 && !allowedInstallIds.has(String(payload.installId ?? ""))) {
		return res.sendStatus(403)
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

const allowedInstallIds = new Set((process.env.C_CODE_DIAGNOSTICS_INSTALL_ALLOWLIST ?? "").split(",").filter(Boolean))

export async function POST(request: NextRequest) {
	const payload = await request.json()

	if (payload?.version !== 1 || payload?.source !== "c-code-vscode-extension" || !Array.isArray(payload?.events)) {
		return NextResponse.json({ error: "Invalid diagnostics payload" }, { status: 400 })
	}

	if (payload.events.length > 50) {
		return NextResponse.json({ error: "Too many diagnostic events" }, { status: 413 })
	}

	if (allowedInstallIds.size > 0 && !allowedInstallIds.has(String(payload.installId ?? ""))) {
		return new NextResponse(null, { status: 403 })
	}

	// Persist to your log pipeline, database, or observability tool.
	// Store sanitized metadata only and avoid expanding payloads into unsafe raw logs.
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

- Keep TLS enabled and reject non-HTTPS traffic.
- Do not ask users to enter diagnostics tokens; the extension has no diagnostics-token setting.
- Apply server-side rate limits and return `429` when needed.
- Validate every payload before storage or forwarding.
- Keep payload limits modest; C-Code batches structured metadata, not content.
- Prefer storing only the fields you need for troubleshooting.
- Use retention policies to delete old diagnostic events.
- Consider optional server-side install/session allowlisting when investigating a specific incident.

---

## Troubleshooting

- If no events arrive, confirm **Enable debug mode** is enabled and saved in the About settings tab.
- Confirm the server returns a `2xx` status on success.
- Confirm the receiver is not requiring a user-provided Bearer token; C-Code does not send one.
- Remember that C-Code fails closed: network failures, rejected requests, and validation failures are not surfaced to users during normal workflows.

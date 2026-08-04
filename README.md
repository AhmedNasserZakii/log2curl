# Log2Curl

**Convert copied API logs into cURL, or edit and run them in an in-editor API client.**

Log2Curl reads raw HTTP request logs from your clipboard and turns them into an editable request. Generate a safe cURL command as before, or use Request Studio to inspect the URL, params, headers, and body, send the request, and view the response without leaving VS Code or Cursor.

---

## Features

- **Framework-agnostic** — Supports Flutter/Dart (including PrettyDioLogger), Laravel/PHP, Node/NestJS, Nginx reverse-proxy logs, and generic HTTP logs.
- **Smart extraction** — Infers URL (full URL, base+path, or host+path), HTTP method, Authorization token, custom headers, and request body from unstructured text.
- **Semantic body detection** — Identifies the request body using labels (e.g. `REQUEST BODY/DATA:`, `request_body="..."`) and key analysis, not “last `{}` block.”
- **Log-style JSON → valid JSON** — Normalizes unquoted keys, unquoted values, and empty fields so broken log output becomes valid JSON for `--data`.
- **Custom headers** — Parses plain and box-formatted header sections, including multiline bearer tokens and API keys.
- **Request Studio** — Postman-style Params, Headers, Body, cURL, source-log, and response views inside the editor.
- **Safe local execution** — Explicit Run, cancellation, timeouts, response limits, safe redirects, credential prompts, and Workspace Trust protection.
- **Reusable workflows** — Saved requests, redacted history, environments with `{{variables}}`, encrypted secret storage, and native JSON import/export.
- **Cross-platform** — Runs on macOS, Windows, and Linux. Parsing and cURL generation are offline; only Run sends a network request.

---

## Convert, Open, and Run

1. Copy raw API logs from your app, server logs, or debug console.
2. Open the Command Palette: **`Cmd+Shift+P`** (macOS) or **`Ctrl+Shift+P`** (Windows/Linux).
3. Run **“Log → Convert to cURL & Run in Request Studio”**.
4. Log2Curl copies the generated cURL, opens the parsed request in Request Studio, and runs it.
5. Edit the request and press **Run** or **Cmd/Ctrl+Enter** to try it again.

Requests with credentials require a one-time confirmation for the editor session. POST, PUT, PATCH, and DELETE also require confirmation by default. In Restricted Mode, the request opens but is not sent.

If the clipboard is unavailable (e.g. some remote setups), the extension opens the cURL in a new editor tab instead.

## Request Studio

1. Copy a request log.
2. Open the Command Palette and run **“Log2Curl: Open Request Studio”** to import it without automatically sending it.
3. Review and edit the method, URL, query parameters, headers, and body.
4. Select **Run** or press **Cmd/Ctrl+Enter**.
5. Inspect the status, final URL, timing, size, headers, formatted body, raw response, or network error.

Request Studio never sends a request from ordinary clipboard detection. The explicit **Convert to cURL & Run** command sends after opening Studio; clipboard watching only offers an import while the panel is visible. The optional restricted auto-run experiment is off by default and requires an exact hostname allowlist, a safe method, a visible panel, a trusted local workspace, and confirmation for each editor session.

Sensitive request and response headers are masked by default. Environment secrets and credentials in named requests use the editor's encrypted `SecretStorage`. Persistent history is off by default and stores only redacted metadata—never query values, headers, or bodies. **Clear Stored Data** removes history, environments, saved requests, and their encrypted secrets. Exporting a request containing credentials requires confirmation and writes those credentials unencrypted to the selected JSON file; source logs are excluded from native request exports.

Requests execute from the extension host shown in Request Studio. In a normal window that is your local machine; in a remote extension host it may be the remote machine. Automatic execution is disabled remotely. Explicit requests require Workspace Trust, use normal TLS validation, reject embedded URL credentials, block HTTPS-to-HTTP redirects, and strip sensitive headers on cross-origin redirects.

---

## Supported Log Formats

| Source | What Log2Curl extracts |
|--------|------------------------|
| **Flutter / Dio** | `FULL URL:`, `BASE URL:` + `PATH:`, `Request ║ GET`, PrettyDioLogger box output, multiline headers, `REQUEST BODY/DATA:` |
| **Laravel / PHP** | Full URL, method, token, body from JSON or log-style blocks |
| **Node / NestJS** | Method, URL, body; log prefixes stripped |
| **Nginx / logfmt** | `host=...` + path from request line, `request_body="{...}"`, `authorization="Bearer ..."` |
| **Generic HTTP** | First `http(s)://` URL, method from request line or labels, body from balanced `{}` blocks |

---

## What Gets Extracted

- **URL** — Prefers labeled `FULL URL:` or `REQUEST URL:`; otherwise base URL + path, or first `http(s)://` URL, or host + path from request line.
- **HTTP method** — From `Method: POST`, `Request ║ GET`, `POST REQUEST DETAILS`, `POST /api HTTP/1.1`, or framework hints (`postRequest`, `http.post`, `axios.post`, etc.). If none is found, you can pick from a list.
- **Authorization** — From single-line or wrapped `Authorization: Bearer ...` values, `user token ...`, or `authorization="Bearer ..."`.
- **Custom headers** — From plain `HEADERS:` sections or PrettyDioLogger's `╔ Headers`, `╟ Key: Value`, and `║ continuation` lines.
- **Request body** — From labeled body/data sections, logfmt `request_body="..."`, or the highest-scoring `{...}` block (excluding headers/metadata).

---

## Requirements

- **VS Code** `^1.105.0` (or Cursor / compatible editor).
- No extra runtime dependencies. Parsing and cURL generation are offline; network access occurs only when you explicitly run a request.

---

## Extension Settings

- `log2curl.requestStudio.timeoutMs` — timeout, default 30 seconds.
- `log2curl.requestStudio.maxResponseBytes` — retained response limit, default 10 MiB.
- `log2curl.requestStudio.followRedirects` / `maxRedirects` — redirect behavior and limit.
- `log2curl.requestStudio.watchClipboard` — detect request logs only while the panel is visible.
- `log2curl.requestStudio.confirmUnsafeMethods` — confirm POST, PUT, PATCH, and DELETE.
- `log2curl.requestStudio.persistHistory` — opt in to redacted metadata history.
- `log2curl.requestStudio.autoRun` — restricted experimental auto-run, off by default.
- `log2curl.requestStudio.autoRunAllowedHosts` — exact eligible hostnames; empty by default.

---

## Known Issues

- Very large logs (e.g. huge JSON bodies) may slow parsing; consider trimming the pasted text to the relevant request.
- Multi-line unquoted values in log-style bodies are parsed up to the next structural delimiter (comma, `}`, newline); complex edge cases may need manual tweaking.
- Request Studio currently supports JSON, raw text, and URL-encoded form bodies. Multipart and binary request bodies are planned later.
- It does not maintain a cookie jar or provide a setting to bypass TLS certificate validation.
- Custom HTTP proxy configuration is not currently exposed; requests use the networking behavior of the local or remote extension host.

---

The full Request Studio architecture, safety model, test plan, and release checklist are documented in the [implementation plan](docs/request-studio/README.md).

---

## Release Notes

### 0.1.2

- Replaced the MIT license with a proprietary, all-rights-reserved license for new releases.

### 0.1.0

- Added Request Studio: editable requests, local execution, cancellation, and response inspection.
- Added secure redirects, limits, Workspace Trust checks, secret masking, and explicit credential/unsafe-method confirmation.
- Added clipboard-assisted import, environments, encrypted named requests, redacted history, and restricted opt-in auto-run.
- Hardened generated cURL commands with POSIX shell escaping.

### 0.0.3

- Added PrettyDioLogger box-format support.
- Detects request methods from lines such as `╔╣ Request ║ GET`.
- Reassembles wrapped Authorization tokens and API-key values.
- Stops header parsing cleanly when another request begins.

### 0.0.2

- Added Marketplace artwork, repository metadata, license, and expanded documentation.
- Improved packaging and publishing configuration.

### 0.0.1

- Initial release.
- URL extraction (full URL, base+path, host+path).
- HTTP method inference (explicit + framework hints).
- Token extraction (Bearer, user token, access_token).
- Semantic body extraction (logfmt, balanced-brace scoring, body markers).
- Custom headers from `HEADERS:` section (Flutter-style logs).
- Body normalization (log-style → valid JSON).
- cURL generation with optional `--data` and custom headers.
- Clipboard copy with fallback to new tab when clipboard is unavailable.
- Top-level error handling to avoid extension host crashes.

---

## Repository

[https://github.com/AhmedNasserZakii/log2curl](https://github.com/AhmedNasserZakii/log2curl)

Copyright © 2026 Ahmed Nasser Zaki. All rights reserved. This project is not offered under an open-source license.

---

**Enjoy!** If you find Log2Curl useful, consider leaving a rating or feedback.

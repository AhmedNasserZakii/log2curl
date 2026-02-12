# Log2Curl

**Convert any copied API log into a ready-to-use cURL command.**

Log2Curl reads raw HTTP request logs from your clipboard and generates a valid `curl` command you can run in a terminal or share with your team. It works with logs from Flutter, Laravel, Node.js, Nginx, and generic HTTP clients—no manual copy-pasting of URLs, headers, or bodies.

---

## Features

- **Framework-agnostic** — Supports Flutter/Dart, Laravel/PHP, Node/NestJS, Nginx reverse-proxy logs, and generic HTTP logs.
- **Smart extraction** — Infers URL (full URL, base+path, or host+path), HTTP method, Authorization token, custom headers, and request body from unstructured text.
- **Semantic body detection** — Identifies the request body using labels (e.g. `REQUEST BODY/DATA:`, `request_body="..."`) and key analysis, not “last `{}` block.”
- **Log-style JSON → valid JSON** — Normalizes unquoted keys, unquoted values, and empty fields so broken log output becomes valid JSON for `--data`.
- **Custom headers** — Parses non-JSON header sections (e.g. `HEADERS:` followed by `Key: Value` lines) and adds them to the cURL command.
- **Offline & cross-platform** — No network calls; runs on macOS, Windows, and Linux.

---

## How to Use

1. Copy raw API logs from your app, server logs, or debug console.
2. Open the Command Palette: **`Cmd+Shift+P`** (macOS) or **`Ctrl+Shift+P`** (Windows/Linux).
3. Run **“Log → Convert to cURL”**.
4. The generated cURL is copied to your clipboard. Paste it into a terminal to run the request.

If the clipboard is unavailable (e.g. some remote setups), the extension opens the cURL in a new editor tab instead.

---

## Supported Log Formats

| Source | What Log2Curl extracts |
|--------|------------------------|
| **Flutter** | `FULL URL:`, `BASE URL:` + `PATH:`, `POST REQUEST DETAILS`, `HEADERS:` (line-by-line), `REQUEST BODY/DATA:` |
| **Laravel / PHP** | Full URL, method, token, body from JSON or log-style blocks |
| **Node / NestJS** | Method, URL, body; log prefixes stripped |
| **Nginx / logfmt** | `host=...` + path from request line, `request_body="{...}"`, `authorization="Bearer ..."` |
| **Generic HTTP** | First `http(s)://` URL, method from request line or labels, body from balanced `{}` blocks |

---

## What Gets Extracted

- **URL** — Prefers labeled `FULL URL:` or `REQUEST URL:`; otherwise base URL + path, or first `http(s)://` URL, or host + path from request line.
- **HTTP method** — From `Method: POST`, `POST REQUEST DETAILS`, `POST /api HTTP/1.1`, or framework hints (`postRequest`, `http.post`, `axios.post`, etc.). If none found, you can pick from a list.
- **Authorization** — From `Authorization: Bearer ...`, `user token ...`, or `authorization="Bearer ..."`.
- **Custom headers** — From a `HEADERS:` (or `HEADER:`) section with `Key: Value` lines.
- **Request body** — From labeled body/data sections, logfmt `request_body="..."`, or the highest-scoring `{...}` block (excluding headers/metadata).

---

## Requirements

- **VS Code** `^1.105.0` (or Cursor / compatible editor).
- No extra dependencies or network access; the extension runs fully offline.

---

## Extension Settings

Log2Curl does not add any configurable settings. It uses the clipboard and the single command **“Log → Convert to cURL.”**

---

## Known Issues

- Very large logs (e.g. huge JSON bodies) may slow parsing; consider trimming the pasted text to the relevant request.
- Multi-line unquoted values in log-style bodies are parsed up to the next structural delimiter (comma, `}`, newline); complex edge cases may need manual tweaking.

---

## Release Notes

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

---

**Enjoy!** If you find Log2Curl useful, consider leaving a rating or feedback.

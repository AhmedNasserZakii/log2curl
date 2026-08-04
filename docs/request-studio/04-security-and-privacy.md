# 04 — Security and Privacy

Request Studio handles bearer tokens, cookies, API keys, private URLs, and response data. Security is part of the product behavior, not a later hardening task.

## Threat model

Protect against:

- Accidental replay of destructive requests.
- Clipboard content triggering network activity without informed consent.
- Credentials leaking through logs, history, error reporting, screenshots, or cross-origin redirects.
- Malicious response content executing script in the webview.
- Requests hanging indefinitely or consuming unbounded memory.
- Untrusted workspace settings changing network behavior.
- Secrets being bundled into the published VSIX.

## Execution consent

- Explicit Run is mandatory for the MVP.
- Confirm the first request in each session when credentials are present.
- Confirm unsafe methods when `confirmUnsafeMethods` is enabled.
- Show method and destination origin in confirmation text.
- Never label a network request as a harmless preview.
- Never execute on extension activation or window startup.

## URL validation

- Accept only `http:` and `https:`.
- Reject URLs containing embedded username/password credentials.
- Normalize and display the final origin before Run.
- Keep TLS verification enabled.
- Do not add an `allowUnauthorizedCertificates` setting in the MVP.
- Warn before HTTPS-to-HTTP redirects.

Localhost and private-network requests are valid developer use cases, so do not block them for explicit Run. Auto-run must require an exact host allowlist.

## Headers and credentials

Treat these names as sensitive case-insensitively:

- `Authorization`
- `Proxy-Authorization`
- `Cookie`
- `Set-Cookie`
- Names containing `api-key`, `apikey`, `token`, `secret`, or `credential`

Rules:

- Mask sensitive values by default.
- Never write values to the output channel or console.
- Never include them in thrown error messages.
- Strip credentials on cross-origin redirects.
- Do not persist them in history by default.
- Use `ExtensionContext.secrets` for named environment secrets.
- Ensure test fixtures contain unmistakably fake values.

## Webview security

- Use a nonce-based Content Security Policy.
- Set `default-src 'none'` and permit only the minimum script/style sources.
- Restrict `localResourceRoots`.
- Load no CDN assets.
- Validate every inbound message.
- Send plain data transfer objects to the webview, not Node objects.
- Render response and log content using text nodes.
- Never inject response HTML, SVG, Markdown HTML, or script into the DOM.
- Do not expose the full VS Code API handle on `window`.

## Resource limits

- Default timeout: 30 seconds.
- Default maximum response: 10 MiB.
- Default maximum redirects: 10.
- One active request per panel in the MVP.
- Cancel the active request when the panel closes.
- Stream and stop reading once the size limit is reached.
- Truncate display and clearly label truncation; do not silently discard data.

## Workspace Trust

Declare limited support for untrusted workspaces:

- Parsing, editing, and copying cURL remain available.
- Running requests is disabled until the workspace is trusted.
- Workspace-scoped settings that influence execution are restricted.
- Add trusted and untrusted integration-test configurations.

## Privacy policy

- No request, response, URL, header, body, or source log telemetry.
- No cloud service is required by Log2Curl.
- Network traffic goes only to the destination the user runs.
- History is off by default.
- Users can clear all persisted data.
- Documentation must explain whether execution occurs locally or in a remote extension host.

## Publishing checks

Before every release:

- Inspect `npx vsce ls`.
- Package with `vsce` secret scanning enabled.
- Inspect the VSIX file list.
- Search source and compiled output for real tokens and private endpoints.
- Confirm `.env`, fixtures with secrets, history, and local storage are excluded.
- Publish the same verified VSIX to both stores.

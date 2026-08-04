# 01 — Product Specification

## Objective

Add a Postman/Apidog-style request editor and response viewer inside VS Code and Cursor. A user should be able to copy a log, inspect the parsed request, edit it, run it repeatedly, and review the response in the same editor window.

## Primary user flow

1. Copy a log containing one HTTP request.
2. Run `Log2Curl: Open Request Studio` from the Command Palette or a keyboard shortcut.
3. Log2Curl parses the clipboard into a request draft.
4. Request Studio opens in an editor tab.
5. Review or edit the request.
6. Select **Run** or press `Cmd/Ctrl+Enter`.
7. Inspect the response.
8. Edit fields and run again.

If the clipboard contains multiple requests, the MVP imports the first complete request and shows a notice. A later release can offer a request picker and multiple tabs.

## Request editor

The top bar contains:

- Method selector: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
- URL input.
- Run button.
- Cancel button while a request is running.
- Import Clipboard button.
- Copy cURL button.

The request area contains these tabs:

### Params

- Editable key/value rows.
- Enabled checkbox per row.
- Add and remove row controls.
- Changes update the URL preview.
- Existing query-string values are decoded into rows without losing duplicates.

### Headers

- Editable name/value rows.
- Enabled checkbox per row.
- Add and remove row controls.
- Sensitive values such as `Authorization`, `Cookie`, and API keys are masked by default.
- A reveal control requires an intentional click.

### Body

MVP body modes:

- None
- JSON
- Raw text
- `application/x-www-form-urlencoded`

Later body modes:

- Multipart form data
- Binary/file upload

JSON mode provides formatting and validation before Run. Invalid JSON blocks execution until the user fixes it or switches to Raw text.

### Generated cURL

- Read-only preview generated from the current editor state.
- Copy button.
- Regenerated whenever method, URL, headers, query, or body changes.

### Source Log

- Read-only original clipboard text.
- Collapsed by default because it may contain secrets.

## Response viewer

The response summary shows:

- HTTP status and status text.
- Duration in milliseconds.
- Downloaded response size.
- Final URL after redirects.
- Timestamp.

Response tabs:

### Body

- Pretty-print JSON when valid.
- Plain-text fallback.
- Search within response.
- Copy response.
- Save response to file.

### Headers

- Header name/value table.
- Preserve repeated headers where the runtime exposes them.

### Raw

- Status line, headers, blank line, and raw body representation.

### Error

For failed requests, show a useful category:

- Invalid URL
- DNS failure
- Connection refused
- TLS failure
- Timeout
- Cancelled
- Response too large
- Redirect policy violation

Never display a stack trace as the primary user message.

## Panel states

- Empty: explain how to copy/import a log.
- Parsed: draft is ready but not sent.
- Dirty: user changed the parsed draft.
- Running: disable duplicate Run and enable Cancel.
- Success: response is available.
- HTTP error: non-2xx response is still a valid response and must be displayed normally.
- Network error: show structured diagnostics and keep the request editable.

## Clipboard behavior

VS Code provides clipboard read and write operations but no clipboard-change event. Therefore:

- Always support explicit `Import Clipboard`.
- Optionally poll once per second only while Request Studio is visible.
- Compare a hash/fingerprint instead of reparsing unchanged content.
- Stop polling when the panel is hidden or disposed.
- When a new valid log is detected, show `New request detected — Import`.
- Never replace a dirty request without confirmation.
- Never execute merely because clipboard content changed under default settings. Restricted auto-run requires explicit configuration and per-session confirmation.

## Settings

MVP settings:

- `log2curl.requestStudio.timeoutMs`: default `30000`.
- `log2curl.requestStudio.maxResponseBytes`: default `10485760` (10 MiB).
- `log2curl.requestStudio.followRedirects`: default `true`.
- `log2curl.requestStudio.watchClipboard`: default `true`, active only while the panel is visible.
- `log2curl.requestStudio.confirmUnsafeMethods`: default `true`.
- `log2curl.requestStudio.persistHistory`: default `false`.

Future auto-run settings must remain off by default:

- `log2curl.requestStudio.autoRun`: default `false`.
- `log2curl.requestStudio.autoRunMethods`: default `["GET", "HEAD", "OPTIONS"]`.
- `log2curl.requestStudio.autoRunAllowedHosts`: default `[]`.

Auto-run is unavailable unless at least one host is explicitly allowlisted.

## Commands

- `log2curl.openRequestStudio` — import clipboard and open/focus the panel.
- `log2curl.requestStudio.importClipboard` — import into the open panel.
- `log2curl.requestStudio.run` — run the current request.
- `log2curl.convert` — copy cURL, open the parsed request directly in Studio, and explicitly run it subject to trust and confirmation safeguards.

## MVP acceptance criteria

- A PrettyDioLogger GET log opens as an editable request.
- Wrapped Authorization and API-key values remain complete.
- Query parameters can be edited without duplication.
- JSON POST/PUT/PATCH bodies can be edited and validated.
- Run and Cancel work.
- JSON and text responses render correctly.
- Non-2xx responses render as responses, not network failures.
- Timing, status, size, final URL, and headers are shown.
- Copy cURL matches the edited draft.
- No request is sent before an explicit Run action.
- Closing the panel cancels polling and any in-flight request.
- `Log → Convert to cURL & Run in Request Studio` copies cURL and executes the same parsed draft without reparsing the overwritten clipboard.

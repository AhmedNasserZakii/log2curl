# 05 — Testing and Release

## Test layers

### Unit tests

Parser:

- PrettyDioLogger GET and POST.
- Wrapped Authorization and API-key headers.
- Multiple consecutive requests.
- Duplicate query keys.
- Empty and malformed headers.
- JSON, text, and absent bodies.
- Invalid URLs and unknown methods.

Request model and cURL:

- Enabled/disabled query and header rows.
- Header case-insensitive deduplication.
- Proper shell escaping.
- Edited drafts regenerate correct cURL.
- Sensitive-field classification.

Executor:

- URL and method validation.
- Timeout and cancellation.
- Response-size enforcement.
- Same-origin redirect.
- Cross-origin credential stripping.
- HTTPS downgrade protection.
- JSON, text, empty, and binary-like responses.
- Network error categorization.

### Local integration server

Create a test-only HTTP server bound to `127.0.0.1` with endpoints:

- `/echo` — returns method, query, headers, and body.
- `/status/:code` — returns the selected status.
- `/json` — returns JSON.
- `/text` — returns plain text.
- `/delay` — waits for timeout/cancel tests.
- `/large` — exceeds the response limit.
- `/redirect/same-origin` — verifies ordinary redirect behavior.
- `/redirect/cross-origin` — verifies credential removal using a second local port.

Tests must never call public services.

### Webview tests

- Initial hydration.
- Editing request fields.
- Switching body modes.
- Invalid JSON state.
- Run/cancel button states.
- Clipboard candidate notice.
- Dirty-draft replacement confirmation.
- Sensitive value mask/reveal.
- Response JSON formatting and text fallback.
- Malicious HTML response is displayed as text.
- Keyboard navigation and shortcuts.

### Extension-host integration tests

- Command registration.
- Singleton panel behavior.
- Clipboard import.
- Message validation.
- Request lifecycle.
- Timer and AbortController cleanup.
- Trusted versus untrusted workspace behavior.
- Existing cURL command regression.

## Manual compatibility matrix

Test the packaged VSIX in:

| Host | Local workspace | Empty window | Remote workspace |
|---|---:|---:|---:|
| VS Code stable | Required | Required | Remote SSH or container |
| Cursor stable | Required | Required | If supported by test environment |

Also test:

- macOS, Windows, and Linux when release infrastructure is available.
- Light, dark, and high-contrast themes.
- Narrow split editor and full-width editor.
- Keyboard-only usage.
- System proxy environment if supported.

## Performance targets

- Panel opens in under 500 ms on a typical development machine.
- Editing remains responsive with a 1 MiB body.
- Clipboard polling stops while hidden and causes no steady CPU spike.
- No unbounded arrays of response chunks, history, or timers.
- Extension activation remains lazy until a Log2Curl command is invoked.

## MVP definition of done

- All `01-product-spec.md` MVP acceptance criteria pass.
- Compile and lint have no errors.
- Unit and integration suites pass.
- No real endpoints or credentials exist in source, tests, maps, or VSIX.
- Request contents are absent from logs and telemetry.
- Workspace Trust behavior is tested.
- Cancellation releases sockets and timers.
- Webview CSP blocks inline and remote scripts.
- README documents execution, privacy, and limitations.
- Changelog describes the feature and security defaults.

## Release procedure

1. Run `npm ci`.
2. Run compile, lint, and all tests.
3. Run `git diff --check`.
4. Update README and CHANGELOG.
5. Bump the minor version to `0.1.0` for the MVP.
6. Run `npx vsce ls` and inspect every included file.
7. Create one VSIX.
8. Install the VSIX into clean VS Code and Cursor profiles.
9. Complete the manual compatibility matrix.
10. Calculate and record the SHA-256 checksum.
11. Commit and tag the exact source used to build the VSIX.
12. Publish that identical VSIX to Visual Studio Marketplace:
    `npx vsce publish --packagePath ./log2curl-0.1.1.vsix`.
13. Sign in to Open VSX with `npx ovsx login ahmednasserzaki`, then publish the same file:
    `npx ovsx publish --packagePath ./log2curl-0.1.1.vsix`.
14. Verify both store APIs and install paths report the new version.

## Post-release validation

- Import a real redacted Flutter/Dio fixture from the clipboard.
- Execute against a controlled test API.
- Confirm response status, headers, body, timing, and size.
- Confirm Cursor and VS Code receive the same version.
- Confirm the Convert command copies cURL, opens the same draft in Studio, and runs it through the configured safety prompts.
- Confirm disabling/uninstalling the extension leaves no active timers or requests.

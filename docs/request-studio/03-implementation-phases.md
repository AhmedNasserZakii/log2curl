# 03 — Implementation Phases

Complete phases sequentially. Do not begin a later phase until the current phase's tests and acceptance checks pass.

## Phase 0 — Guardrails and baseline

- [ ] Confirm `npm ci`, compile, lint, and current tests pass.
- [ ] Add fixture logs for GET, JSON POST, wrapped headers, multiple requests, and malformed input.
- [ ] Record current `log2curl.convert` outputs as regression fixtures.
- [ ] Add Workspace Trust capability metadata with limited request execution in Restricted Mode.
- [ ] Add an output channel that logs lifecycle events without headers, bodies, URLs with query values, or response content.

Exit condition: existing cURL behavior has stable regression coverage.

## Phase 1 — Shared request model and parser

- [ ] Add `requestStudio/model.ts`.
- [ ] Add the `parseLogToRequestDraft` facade.
- [ ] Convert URL query strings into editable rows.
- [ ] Merge token extraction into the header model without duplication.
- [ ] Mark sensitive headers.
- [ ] Return parser warnings and multiple-request diagnostics.
- [ ] Refactor `log2curl.convert` to consume `RequestDraft`.
- [ ] Update `buildCurl` to accept the shared request model or an adapter.
- [ ] Add unit tests for every fixture.

Exit condition: the old command produces equivalent cURL while RequestDraft tests pass.

## Phase 2 — Request Studio shell

- [ ] Add `log2curl.openRequestStudio` to `package.json`.
- [ ] Create `RequestStudioPanel` with singleton/reveal behavior.
- [ ] Add secure CSP, nonce, restricted resources, and theme-aware CSS.
- [ ] Add the typed message protocol and runtime validators.
- [ ] Render method, URL, Params, Headers, Body, cURL, and Source Log.
- [ ] Implement dirty-state tracking.
- [ ] Implement Import Clipboard and Copy cURL.
- [ ] Add webview build output to `.vscodeignore` rules correctly.
- [ ] Add panel lifecycle integration tests.

Exit condition: a copied log opens as a fully editable request, but Run remains disabled.

## Phase 3 — HTTP executor and response viewer

- [ ] Add `RequestTransport` and the initial implementation.
- [ ] Validate schemes, method, headers, body, and timeout.
- [ ] Implement cancellation using `AbortController`.
- [ ] Enforce the response-size limit while streaming.
- [ ] Implement redirect and credential-stripping policies.
- [ ] Measure duration and response size.
- [ ] Render status, headers, formatted JSON, text, and raw response.
- [ ] Categorize timeout, DNS, connection, TLS, cancellation, and policy errors.
- [ ] Treat non-2xx statuses as valid responses.
- [ ] Add Run and `Cmd/Ctrl+Enter`.

Exit condition: local fixture servers validate GET, POST, timeout, cancel, redirects, large responses, JSON, and text.

## Phase 4 — Clipboard-assisted workflow

- [ ] Implement the visibility-scoped clipboard watcher.
- [ ] Add text fingerprinting and self-write suppression.
- [ ] Show a non-blocking new-request notice.
- [ ] Protect dirty drafts from replacement.
- [ ] Add the `watchClipboard` setting.
- [ ] Verify timer cleanup on hide, close, reload, and deactivation.

Exit condition: clipboard detection consumes negligible resources and never sends a request.

## Phase 5 — Product polish

- [ ] Add accessible labels, keyboard navigation, and visible focus states.
- [ ] Add responsive layouts for narrow and wide editor groups.
- [ ] Add response search and copy controls.
- [ ] Add syntax-aware JSON formatting without unsafe HTML.
- [ ] Add `Running from` network-location indicator.
- [ ] Add empty, loading, error, and cancelled states.
- [ ] Add first-run safety explanation.
- [ ] Update README with screenshots and instructions.

Exit condition: keyboard-only use is possible and layouts work in Cursor and VS Code.

## Phase 6 — History and environments (included in `0.1.0`)

- [ ] Define environment variables such as `{{baseUrl}}`.
- [ ] Store secret variables in `ExtensionContext.secrets`.
- [ ] Add opt-in redacted request history.
- [ ] Add clear/delete/export controls.
- [ ] Add duplicate request and named request support.
- [ ] Add import/export using a Log2Curl JSON schema.
- [ ] Consider Postman collection import only after the native schema is stable.

Exit condition: persisted data is opt-in, redacted, deletable, and documented.

## Phase 7 — Restricted auto-run experiment (included in `0.1.0`)

This phase was included after explicit product direction to implement the complete plan. It remains experimental, telemetry-free, and disabled by default.

- [ ] Keep `autoRun` disabled by default.
- [ ] Require an explicit host allowlist.
- [ ] Default to safe methods only: GET, HEAD, OPTIONS.
- [ ] Require a once-per-session confirmation.
- [ ] Require Request Studio to be visible.
- [ ] Add a cooldown and duplicate-request suppression.
- [ ] Disable in Restricted Mode and remote workspaces unless explicitly enabled.
- [ ] Show a persistent Auto-run enabled indicator.
- [ ] Add a one-click emergency disable control.
- [ ] Add security tests proving disallowed methods and hosts never run.

Exit condition: no clipboard content can trigger an unapproved host or method.

## Phase 8 — Release

- [ ] Run the full checklist in `05-testing-and-release.md`.
- [ ] Bump to `0.1.0` for the Request Studio MVP.
- [ ] Build one VSIX and test it in clean VS Code and Cursor profiles.
- [ ] Publish the identical VSIX to Marketplace and Open VSX.
- [ ] Verify install/update from both registries.
- [ ] Monitor issues without logging user request contents.

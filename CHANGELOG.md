# Changelog

All notable changes to the "log2curl" extension will be documented in this file.

## [0.1.0] - 2026-08-04

- Changed the primary Convert command to copy cURL, open the exact parsed request in Request Studio, and run it with the existing trust and confirmation safeguards.
- Added Request Studio with editable URL, query, headers, JSON/text/form bodies, cURL preview, and source-log views.
- Added explicit local HTTP execution, cancellation, timeouts, streaming response limits, redirect limits, and non-2xx response display.
- Added response status, final URL, timing, size, headers, formatted JSON/text, raw content, search, copy, and save controls.
- Added visibility-scoped clipboard detection with dirty-draft protection and self-copy suppression.
- Added encrypted environment secrets and named-request credentials, redacted opt-in history, and native JSON import/export.
- Added one-click deletion of all persisted Request Studio data and encrypted secrets.
- Added restricted auto-run, off by default, with exact hostname allowlists, safe methods, session confirmation, cooldown, and local trusted-workspace checks.
- Added Workspace Trust restrictions, sensitive-header masking, cross-origin credential stripping, HTTPS downgrade protection, and safer POSIX cURL escaping.
- Added local-only integration coverage for execution, timeout, cancellation, redirects, response limits, persistence, and safety policy.

## [0.0.3] - 2026-08-04

- Added support for PrettyDioLogger's box-formatted request lines, including `Request ║ GET`.
- Added support for `╔ Headers` sections and `╟ Key: Value` header entries.
- Fixed wrapped `Authorization` bearer tokens and other multiline header values.
- Prevented headers from a following request from being merged into the current request.
- Added regression coverage for complete cURL generation from consecutive PrettyDioLogger requests.

## [0.0.2] - 2026-02-12

- Added the extension icon, repository metadata, license, and expanded documentation.
- Improved extension packaging and publishing configuration.

## [0.0.1] - 2026-02-11

- Initial release with URL, method, token, body, and custom-header extraction.
- Added log-style JSON normalization and cURL generation.

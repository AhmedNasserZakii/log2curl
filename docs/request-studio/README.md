# Log2Curl Request Studio

## Feasibility

This feature is feasible as a VS Code/Cursor extension. Log2Curl can turn a copied log into an editable request, display it in a webview panel, execute it from the extension host, and show the response without leaving the editor.

The recommended product behavior is:

1. The user copies an HTTP log.
2. `Log2Curl: Open Request Studio` reads and parses the clipboard.
3. A panel opens with editable method, URL, query parameters, headers, and body.
4. The user reviews the request and selects **Run**.
5. The panel displays status, duration, response size, headers, and body.
6. The user changes any field and runs the request again.

Clipboard changes are detected only while the panel is visible and populate a draft by default. Restricted auto-run is an explicit experiment: it remains off until the user configures an exact host allowlist and confirms the feature for the current session. Unsafe methods are never eligible.

## Plan documents

Implement these documents in order:

1. [Product specification](01-product-spec.md)
2. [Technical architecture](02-architecture.md)
3. [Implementation phases](03-implementation-phases.md)
4. [Security and privacy](04-security-and-privacy.md)
5. [Testing and release](05-testing-and-release.md)
6. [Implementation status](06-implementation-status.md)

## Release scope

- `0.1.0`: Request Studio, explicit execution, response inspection, environments, named requests, redacted history, native import/export, and restricted opt-in clipboard auto-run.
- Future: multipart/file bodies, binary uploads, multi-request tabs, cookie jars, and other advanced HTTP behavior.

## Non-negotiable decisions

- Only `http://` and `https://` URLs can be executed.
- Network calls run in the extension host, never inside the webview.
- Explicit Run is the default and remains available even if an auto-run option is later added.
- Authorization values and cookies are masked in the UI by default.
- Secrets and response bodies are not persisted unless the user opts in.
- Redirects must not forward credentials to a different origin.
- TLS certificate validation remains enabled.
- The response renderer treats all server content as untrusted text.

## Official platform references

- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code webview UX guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews)
- [VS Code Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)
- [VS Code extension capabilities and SecretStorage](https://code.visualstudio.com/api/extension-capabilities/common-capabilities)

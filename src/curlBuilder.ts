// ─────────────────────────────────────────────────────────────
// curlBuilder.ts — Assembles a valid cURL command from the
// extracted HTTP components.
// ─────────────────────────────────────────────────────────────

export interface CurlComponents {
  url: string;
  method: string;
  token: string | null;
  body: string | null;       // pretty-printed JSON string, or null
  /** Extra headers extracted from a HEADERS: section in the log. */
  customHeaders?: { key: string; value: string }[];
}

/**
 * Builds a multi-line cURL command string.
 *
 * Header priority:
 *   1. Default Accept + Content-Type (unless overridden by custom headers).
 *   2. Custom headers extracted from the log.
 *   3. Authorization: Bearer <token> (unless already in custom headers).
 *
 * Includes --data only when a body is present.
 */
export function buildCurl(c: CurlComponents): string {
  const lines: string[] = [
    `curl --location "${c.url}" \\`,
    `  --request ${c.method}`,
  ];

  // ---- Collect headers ----
  const custom = c.customHeaders ?? [];
  const customLower = new Set(custom.map(h => h.key.toLowerCase()));

  const allHeaders: { key: string; value: string }[] = [];

  // Defaults (skip if the log already supplies them)
  if (!customLower.has('accept')) {
    allHeaders.push({ key: 'Accept', value: 'application/json' });
  }
  if (!customLower.has('content-type')) {
    allHeaders.push({ key: 'Content-Type', value: 'application/json' });
  }

  // Custom headers from the log
  allHeaders.push(...custom);

  // Authorization from token (only if not already present in custom headers)
  if (c.token && !customLower.has('authorization')) {
    allHeaders.push({ key: 'Authorization', value: `Bearer ${c.token}` });
  }

  // ---- Emit headers ----
  for (const h of allHeaders) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --header "${h.key}: ${h.value}"`);
  }

  // ---- Body ----
  if (c.body) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --data '${c.body}'`);
  }

  return lines.join('\n');
}

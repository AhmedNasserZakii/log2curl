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

import {
  buildRequestUrl,
  enabledPairs,
  RequestDraft,
} from './requestStudio/model';

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
    `curl --location ${shellQuote(c.url)} \\`,
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
    lines.push(`  --header ${shellQuote(`${h.key}: ${h.value}`)}`);
  }

  // ---- Body ----
  if (c.body) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --data ${shellQuote(c.body)}`);
  }

  return lines.join('\n');
}

/** Quotes one POSIX shell argument without allowing interpolation or injection. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export interface DraftCurlOptions {
  /** Preserve the pre-Request-Studio default Accept/Content-Type behavior. */
  legacyDefaults?: boolean;
}

/** Converts an editable request into cURL. Request Studio uses exact draft semantics. */
export function buildCurlFromDraft(
  draft: RequestDraft,
  options: DraftCurlOptions = {}
): string {
  if (!options.legacyDefaults) {
    return buildExactDraftCurl(draft);
  }
  const authorization = enabledPairs(draft.headers).find(
    header => header.name.toLowerCase() === 'authorization'
  );
  const tokenMatch = authorization?.value.match(/^Bearer\s+(.+)$/i);
  const customHeaders = enabledPairs(draft.headers).filter(
    header => header.name.toLowerCase() !== 'authorization'
  ).map(header => ({ key: header.name, value: header.value }));

  if (authorization && !tokenMatch) {
    customHeaders.push({ key: authorization.name, value: authorization.value });
  }

  return buildCurl({
    url: buildRequestUrl(draft),
    method: draft.method,
    token: tokenMatch?.[1] ?? null,
    body: draft.body.mode === 'none' ? null : draft.body.text,
    customHeaders,
  });
}

function buildExactDraftCurl(draft: RequestDraft): string {
  const lines = [
    `curl --location ${shellQuote(buildRequestUrl(draft))} \\`,
    `  --request ${draft.method}`,
  ];
  const headers = enabledPairs(draft.headers).map(header => ({ ...header }));
  const hasContentType = headers.some(
    header => header.name.toLowerCase() === 'content-type'
  );
  if (!hasContentType && draft.body.mode !== 'none') {
    headers.push({
      id: 'generated-content-type',
      name: 'Content-Type',
      value: draft.body.contentType ?? (
        draft.body.mode === 'json'
          ? 'application/json'
          : draft.body.mode === 'form'
            ? 'application/x-www-form-urlencoded'
            : 'text/plain'
      ),
      enabled: true,
    });
  }
  for (const header of headers) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --header ${shellQuote(`${header.name}: ${header.value}`)}`);
  }
  if (draft.body.mode !== 'none' && !['GET', 'HEAD'].includes(draft.method)) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --data ${shellQuote(draft.body.text)}`);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// extractors.ts — Framework-agnostic extraction of URL, HTTP
// method, authorization token, request body, and custom headers
// from raw logs.
// ─────────────────────────────────────────────────────────────

// ======================== Types ========================

export interface TextBlock {
  /** The raw content including outer braces */
  content: string;
  /** Start index in original text */
  startIndex: number;
  /** End index in original text */
  endIndex: number;
  /** Up to 300 chars of text preceding this block (for marker detection) */
  precedingText: string;
}

export interface CustomHeader {
  key: string;
  value: string;
}

interface ScoredBlock {
  block: TextBlock;
  score: number;
  reason: string;
}

// ======================== URL ========================

/**
 * Extracts a URL from the text.
 *
 * Strategy (in priority order):
 *   0. Labeled "FULL URL" / "REQUEST URL" / "ENDPOINT" — highest confidence.
 *   1. Labeled "BASE URL" optionally combined with "PATH".
 *   2. First raw http/https URL found in the text.
 *   3. Reconstruct from HTTP request-line path + host field.
 */
export function extractUrl(text: string): string | null {
  // --- 0. Labeled URL (highest priority) ---
  // "FULL URL:", "REQUEST URL:", "ENDPOINT:"
  const labeledMatch = text.match(
    /\b(?:FULL\s+URL|REQUEST\s+URL|ENDPOINT)\s*:\s*(https?:\/\/\S+)/i
  );
  if (labeledMatch) {
    return labeledMatch[1].replace(/[,;'")\]}>]+$/, '');
  }

  // --- 1. BASE URL + optional PATH ---
  const baseMatch = text.match(/\bBASE\s+URL\s*:\s*(https?:\/\/\S+)/i);
  if (baseMatch) {
    const base = baseMatch[1].replace(/[,;'")\]}>\/]+$/, '');
    const pathMatch = text.match(/\bPATH\s*:\s*(\/\S*)/i);
    const path = pathMatch ? pathMatch[1].replace(/[,;'")\]}>]+$/, '') : '';
    return `${base}${path}`;
  }

  // --- 2. First raw full URL ---
  const fullMatch = text.match(
    /https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+/
  );
  if (fullMatch) {
    return fullMatch[0].replace(/[,;'")\]}>]+$/, '');
  }

  // --- 3. Reconstruct from HTTP request line + host ---
  const pathMatch = text.match(
    /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S+)\s+HTTP/i
  );
  const hostMatch = text.match(
    /\b(?:host|server_name|server)\s*[:=]\s*"?([a-zA-Z0-9\-._]+(?::\d+)?)"?/i
  );

  if (pathMatch && hostMatch) {
    const path = pathMatch[1];
    const host = hostMatch[1];
    const scheme = /:\d*80$/.test(host) ? 'http' : 'https';
    return `${scheme}://${host}${path}`;
  }

  if (hostMatch) {
    return `https://${hostMatch[1]}`;
  }

  return null;
}

// ======================== HTTP Method ========================

/** Explicit patterns: "Method: POST", "POST /api HTTP/1.1", etc. */
const EXPLICIT_METHOD_PATTERNS: RegExp[] = [
  /\bmethod\s*[:=]\s*["']?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']?\b/i,
  /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/\S+\s+HTTP/i,
  /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+https?:\/\//im,
  // "📤 POST REQUEST DETAILS" / "GET REQUEST" / "DELETE REQUEST SENT"
  /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+REQUEST\b/i,
];

/** Framework-specific hints mapped to HTTP methods. */
const FRAMEWORK_HINTS: [RegExp, string][] = [
  // Generic / Dart / Flutter
  [/\bpost[-_]?request\b/i, 'POST'],
  [/\bput[-_]?request\b/i, 'PUT'],
  [/\bpatch[-_]?request\b/i, 'PATCH'],
  [/\bdelete[-_]?request\b/i, 'DELETE'],
  [/\bget[-_]?request\b/i, 'GET'],
  // Dart http package
  [/\bhttp\.post\b/i, 'POST'],
  [/\bhttp\.put\b/i, 'PUT'],
  [/\bhttp\.patch\b/i, 'PATCH'],
  [/\bhttp\.delete\b/i, 'DELETE'],
  [/\bhttp\.get\b/i, 'GET'],
  // Axios / Node
  [/\baxios\.post\b/i, 'POST'],
  [/\baxios\.put\b/i, 'PUT'],
  [/\baxios\.patch\b/i, 'PATCH'],
  [/\baxios\.delete\b/i, 'DELETE'],
  [/\baxios\.get\b/i, 'GET'],
  // Fetch API
  [/\bmethod\s*:\s*['"]POST['"]/i, 'POST'],
  [/\bmethod\s*:\s*['"]PUT['"]/i, 'PUT'],
  [/\bmethod\s*:\s*['"]PATCH['"]/i, 'PATCH'],
  [/\bmethod\s*:\s*['"]DELETE['"]/i, 'DELETE'],
  // Laravel / PHP
  [/\bHttp::post\b/i, 'POST'],
  [/\bHttp::put\b/i, 'PUT'],
  [/\bHttp::patch\b/i, 'PATCH'],
  [/\bHttp::delete\b/i, 'DELETE'],
  [/\bHttp::get\b/i, 'GET'],
  // DATA in postRequest (Flutter Dio style)
  [/\bDATA\s+in\s+post/i, 'POST'],
  [/\bDATA\s+in\s+put/i, 'PUT'],
  [/\bDATA\s+in\s+patch/i, 'PATCH'],
  [/\bDATA\s+in\s+delete/i, 'DELETE'],
];

/**
 * Infers HTTP method from log text.
 * Returns null if no method can be determined (caller should ask user).
 */
export function extractMethod(text: string): string | null {
  for (const pattern of EXPLICIT_METHOD_PATTERNS) {
    const m = text.match(pattern);
    if (m) { return m[1].toUpperCase(); }
  }
  for (const [pattern, method] of FRAMEWORK_HINTS) {
    if (pattern.test(text)) { return method; }
  }
  return null;
}

// ======================== Token ========================

const TOKEN_PATTERNS: RegExp[] = [
  // Authorization header / logfmt field (handles optional quotes around value)
  //   Authorization: Bearer xxx  |  authorization="Bearer xxx"
  /authorization\s*[:=]\s*['"]?bearer\s+([^\s,;'"}\]]+)/i,
  // "user token xxxxx"
  /\buser\s+token\s+([^\s,;'"}\]]+)/i,
  // "token: xxxxx" or token=xxxxx (min 10 chars to avoid false matches)
  /\btoken\s*[:=]\s*['"]?([a-zA-Z0-9|._\-/+=]{10,})['"]?/i,
  // "access_token: xxxxx"
  /\baccess[-_]?token\s*[:=]\s*['"]?([a-zA-Z0-9|._\-/+=]{10,})['"]?/i,
  // Standalone "Bearer xxxxx"
  /\bBearer\s+([a-zA-Z0-9|._\-/+=]{10,})/,
];

/**
 * Extracts an authorization token from log text.
 * Returns null if no token is found — caller should omit the header.
 */
export function extractToken(text: string): string | null {
  for (const pattern of TOKEN_PATTERNS) {
    const m = text.match(pattern);
    if (m) { return m[1]; }
  }
  return null;
}

// ======================== Custom Header Extraction ========================

/**
 * Returns true if a line is a visual separator (───, ----, ═══, blank, etc.)
 */
function isSeparatorLine(line: string): boolean {
  const stripped = line.trim();
  if (!stripped) { return true; }
  // Box-drawing chars (U+2500–U+257F), dashes, equals, asterisks, underscores, tildes
  return /^[\u2500-\u257F\-=*_~+\s]+$/.test(stripped);
}

/**
 * Extracts headers from a labelled **HEADERS:** section where each header
 * is a plain `Key: Value` line (NOT inside `{ }`).
 *
 * Stops reading at the first separator line, blank line, or section label
 * (a line whose "key" contains spaces, like "REQUEST BODY:").
 *
 * Example input section:
 *   flutter: 📋 HEADERS:
 *   flutter:    Server-Key: QH6bbax5Nqsq9q1z…
 *   flutter: ───────────────────────────────
 */
export function extractCustomHeaders(text: string): CustomHeader[] {
  const headers: CustomHeader[] = [];
  const lines = text.split('\n');

  // ---- Find the "HEADERS:" line ----
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    // Strip log prefix, then check if the line ENDS with "HEADERS:" or "HEADER:"
    const cleaned = stripLogPrefixes(lines[i]).trim();
    if (/HEADERS?\s*:\s*$/i.test(cleaned)) {
      sectionStart = i + 1;
      break;
    }
  }

  if (sectionStart === -1) { return headers; }

  // ---- Read key-value lines until a boundary ----
  for (let i = sectionStart; i < lines.length; i++) {
    const cleaned = stripLogPrefixes(lines[i]).trim();

    // Stop at separator or blank line
    if (isSeparatorLine(cleaned)) { break; }

    // Parse "Key: Value" — the first colon splits key from value
    const colonIdx = cleaned.indexOf(':');
    if (colonIdx <= 0) { break; }

    const key = cleaned.substring(0, colonIdx).trim();
    const value = cleaned.substring(colonIdx + 1).trim();

    // A valid HTTP header key has no spaces (e.g. "Server-Key").
    // If the key has spaces (e.g. "REQUEST BODY"), it is a new section → stop.
    if (/^[\w\-]+$/.test(key)) {
      headers.push({ key, value });
    } else {
      break;
    }
  }

  return headers;
}

// ======================== Body Extraction ========================

// -------- Balanced-brace extraction --------

/**
 * Scans the entire text and extracts every top-level `{ … }` block,
 * correctly handling nested braces, double-quoted strings, and escapes.
 */
export function extractBalancedBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let depth = 0;
  let blockStart = -1;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // Inside a quoted string — skip until closing quote
    if (inString) {
      if (ch === '\\') { i++; continue; }       // skip escaped char
      if (ch === stringChar) { inString = false; }
      continue;
    }

    // Opening a string
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) { blockStart = i; }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && blockStart !== -1) {
        const lookback = Math.max(0, blockStart - 300);
        blocks.push({
          content: text.substring(blockStart, i + 1),
          startIndex: blockStart,
          endIndex: i,
          precedingText: text.substring(lookback, blockStart),
        });
        blockStart = -1;
      }
      // Guard against malformed input
      if (depth < 0) { depth = 0; }
    }
  }

  return blocks;
}

// -------- Scoring constants --------

/** Patterns that PRECEDE a body block in logs */
const BODY_MARKERS: RegExp[] = [
  /\bbody\s*[:=]\s*$/i,
  /\brequest[-_ ]?body\s*[:=]\s*$/i,
  /\bbody\s*\/\s*data\s*[:=]\s*$/i,         // "BODY/DATA:"
  /\brequest[-_ ]?body\s*\/\s*data\s*[:=]\s*$/i, // "REQUEST BODY/DATA:"
  /\bpayload\s*[:=]\s*$/i,
  /\bdata\s*[:=]\s*$/i,
  /\bpost[-_ ]?data\s*[:=]\s*$/i,
  /\bparams\s*[:=]\s*$/i,
  /\bDATA\s+in\s+\w+\s*$/i,
  /\b--data(?:-raw|-binary)?\s+['"]?$/i,
  /\brequest\s*[:=]\s*$/i,
];

/** Patterns that PRECEDE a headers block in logs */
const HEADER_MARKERS: RegExp[] = [
  /\bheaders?\s*[:=]\s*$/i,
  /\brequest[-_ ]?headers?\s*[:=]\s*$/i,
  /\bresponse[-_ ]?headers?\s*[:=]\s*$/i,
  /\bbaseOptions\.headers\s*[:=]\s*$/i,
];

/** Patterns that PRECEDE metadata/config blocks in logs */
const META_MARKERS: RegExp[] = [
  /\bconfig\s*[:=]\s*$/i,
  /\boptions\s*[:=]\s*$/i,
  /\bresponse\s*[:=]\s*$/i,
  /\bextra\s*[:=]\s*$/i,
  /\bquery[-_ ]?parameters?\s*[:=]\s*$/i,
];

/** Keys that are characteristic of HTTP headers */
const HEADER_KEYS = new Set([
  'authorization', 'content-type', 'accept', 'user-agent',
  'cache-control', 'x-requested-with', 'cookie', 'set-cookie',
  'host', 'connection', 'accept-encoding', 'accept-language',
  'content-length', 'origin', 'referer', 'x-csrf-token',
  'x-xsrf-token', 'x-forwarded-for', 'x-forwarded-proto',
  'pragma', 'expires', 'etag', 'if-none-match', 'if-modified-since',
  'access-control-allow-origin', 'access-control-allow-methods',
  'access-control-allow-headers', 'vary', 'transfer-encoding',
]);

/** Keys that are characteristic of request/response metadata */
const META_KEYS = new Set([
  'statuscode', 'statusmessage', 'responsetype', 'extra',
  'connecttimeout', 'receivetimeout', 'sendtimeout',
  'followredirects', 'maxredirects', 'baseurl',
  'validatestatus', 'httpclientadapter', 'listformat',
  'contenttype', 'responseheaders', 'isredirect',
]);

// -------- Key extraction (lightweight, for scoring only) --------

/**
 * Quickly extract top-level-ish key names from a raw block.
 * Does NOT need to be a perfect parser — it is used only for scoring.
 */
function extractRawKeys(block: string): string[] {
  const keys: string[] = [];
  const re = /(?:["']?)([\w][\w\-.]*)(?:["']?)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    keys.push(m[1].toLowerCase());
  }
  return keys;
}

// -------- Scoring logic --------

function scoreBlock(block: TextBlock): ScoredBlock {
  let score = 0;
  const reasons: string[] = [];

  // Strip log prefixes from preceding text so "flutter: 📦 DATA:" becomes "📦 DATA:"
  // This ensures markers like /\bdata\s*[:=]\s*$/i can see the label.
  const preceding = stripLogPrefixes(block.precedingText).trimEnd();

  const keys = extractRawKeys(block.content);

  // Empty / trivially small blocks are useless
  if (keys.length === 0) {
    return { block, score: -100, reason: 'empty block' };
  }

  // --- Preceding-text markers ---

  for (const re of BODY_MARKERS) {
    if (re.test(preceding)) {
      score += 50;
      reasons.push('body marker');
      break;
    }
  }

  for (const re of HEADER_MARKERS) {
    if (re.test(preceding)) {
      score -= 50;
      reasons.push('header marker');
      break;
    }
  }

  for (const re of META_MARKERS) {
    if (re.test(preceding)) {
      score -= 30;
      reasons.push('metadata marker');
      break;
    }
  }

  // --- Key-content analysis ---

  const headerCount = keys.filter(k => HEADER_KEYS.has(k)).length;
  const metaCount = keys.filter(k => META_KEYS.has(k)).length;
  const total = keys.length;

  if (total > 0 && headerCount / total > 0.5) {
    score -= 40;
    reasons.push('majority header keys');
  } else if (headerCount === 0 && metaCount === 0) {
    score += 10;
    reasons.push('no header/meta keys');
  }

  if (total > 0 && metaCount / total > 0.3) {
    score -= 30;
    reasons.push('significant meta keys');
  }

  // Bodies tend to have several fields
  if (total >= 3) {
    score += 5;
    reasons.push('multi-key');
  }

  return { block, score, reason: reasons.join(', ') || 'default' };
}

// -------- Logfmt / key=value extraction --------

/**
 * Extracts the body from key=value (logfmt / Nginx) style logs.
 *
 * Handles patterns like:
 *   request_body="{order_status: delivered}"
 *   body='{"name": "John"}'
 *   payload={"id":1}
 *
 * This runs BEFORE balanced-brace extraction because in logfmt the
 * body's braces are often inside quotes, which the brace scanner skips.
 */
const LOGFMT_BODY_PATTERNS: RegExp[] = [
  // request_body="{ ... }"  or  request_body='{ ... }'
  /\brequest[-_]?body\s*=\s*"(\{[^"]*\})"/i,
  /\brequest[-_]?body\s*=\s*'(\{[^']*\})'/i,
  /\brequest[-_]?body\s*=\s*(\{[^\n]*\})/i,
  // body="{ ... }"
  /\bbody\s*=\s*"(\{[^"]*\})"/i,
  /\bbody\s*=\s*'(\{[^']*\})'/i,
  /\bbody\s*=\s*(\{[^\n]*\})/i,
  // payload="{ ... }"
  /\bpayload\s*=\s*"(\{[^"]*\})"/i,
  /\bpayload\s*=\s*'(\{[^']*\})'/i,
  // data="{ ... }"
  /\bdata\s*=\s*"(\{[^"]*\})"/i,
  /\bdata\s*=\s*'(\{[^']*\})'/i,
  // post_data="{ ... }"
  /\bpost[-_]?data\s*=\s*"(\{[^"]*\})"/i,
  /\bpost[-_]?data\s*=\s*'(\{[^']*\})'/i,
];

function extractBodyFromKeyValue(text: string): string | null {
  for (const pattern of LOGFMT_BODY_PATTERNS) {
    const m = text.match(pattern);
    if (m) { return m[1]; }
  }
  return null;
}

// -------- Public API --------

/**
 * Semantically extracts the most likely request-body block from raw log text.
 *
 * Strategy (in order):
 * 1. **Logfmt / key=value** — If the text contains an explicit
 *    `request_body="..."` (or similar) field, extract its value directly.
 *    This is the highest-confidence signal and covers Nginx / reverse-proxy logs.
 * 2. **Balanced-brace extraction + scoring** — Find all top-level `{ … }`
 *    blocks, score each by preceding markers and key analysis, pick the best.
 *
 * Returns null when no plausible body block exists.
 */
export function extractBody(text: string): string | null {
  // --- 1. Logfmt / key=value (highest confidence) ---
  const kvBody = extractBodyFromKeyValue(text);
  if (kvBody) { return kvBody; }

  // --- 2. Balanced-brace extraction + scoring ---
  const blocks = extractBalancedBlocks(text);

  if (blocks.length === 0) { return null; }
  if (blocks.length === 1) { return blocks[0].content; }

  const scored = blocks
    .map(b => scoreBlock(b))
    .sort((a, b) => b.score - a.score);

  // Clear winner
  if (scored[0].score > scored[1].score) {
    return scored[0].block.content;
  }

  // Tied — pick the one with fewest header-like keys
  const topScore = scored[0].score;
  const tied = scored.filter(s => s.score === topScore);
  const best = tied.reduce((prev, curr) => {
    const prevH = extractRawKeys(prev.block.content).filter(k => HEADER_KEYS.has(k)).length;
    const currH = extractRawKeys(curr.block.content).filter(k => HEADER_KEYS.has(k)).length;
    return currH < prevH ? curr : prev;
  });

  return best.block.content;
}

// ======================== Body Unwrapping ========================

/**
 * If the parsed body is actually a request-config wrapper
 * (contains method/url/headers alongside a body/data key),
 * extract and return only the nested body value.
 */
export function unwrapBodyIfNeeded(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return parsed;
  }

  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  const lowerKeys = keys.map(k => k.toLowerCase());

  // Does this look like a request config?
  const CONFIG_INDICATORS = [
    'method', 'url', 'baseurl', 'headers',
    'timeout', 'responsetype',
  ];
  const hasConfigShape = CONFIG_INDICATORS.filter(
    ci => lowerKeys.includes(ci)
  ).length >= 2;

  if (!hasConfigShape) { return parsed; }

  // Try to pull out the nested body
  const BODY_KEYS = ['body', 'data', 'payload', 'requestbody', 'request_body'];
  for (const bk of BODY_KEYS) {
    const realKey = keys.find(k => k.toLowerCase() === bk);
    if (realKey && typeof obj[realKey] === 'object' && obj[realKey] !== null) {
      return obj[realKey];
    }
  }

  return parsed;
}

// ======================== Log-prefix Stripping ========================

/**
 * Strips common per-line log prefixes so the normalizer sees clean data.
 *
 * Handles:
 *   - Flutter:   flutter:                        (debugPrint / print)
 *   - Flutter:   I/flutter ( 1234):              (Android logcat)
 *   - Laravel:   [2024-01-15 10:23:45] local.INFO:
 *   - NestJS:    [Nest] 38453  - 01/15/2024, 10:23:45 AM   LOG
 *   - ISO ts:    2024-01-15T10:23:45.123Z
 *   - Generic:   > (shell prompt)
 */
export function stripLogPrefixes(text: string): string {
  return text
    .split('\n')
    .map(line =>
      line
        // Flutter debugPrint / print:  "flutter: "
        .replace(/^flutter:\s*/i, '')
        // Flutter logcat: I/flutter (12345):  or  D/OkHttp (12345):
        .replace(/^[IDWEV]\/[\w.]+\s*\(\s*\d+\):\s*/g, '')
        // Laravel: [2024-01-15 10:23:45] local.INFO:
        .replace(/^\[\d{4}[^\]]*\]\s*[\w.]*:\s*/g, '')
        // ISO timestamp prefix
        .replace(
          /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[\d.]*Z?\s*/g,
          ''
        )
        // NestJS: [Nest] 38453  -  01/15/2024, 10:23:45 AM     LOG [Context]
        .replace(/^\[Nest\]\s*\d+\s*-\s*[^[]+(?:\[[\w]+\]\s*)?/g, '')
        // Shell prompt
        .replace(/^>\s*/g, '')
    )
    .join('\n');
}

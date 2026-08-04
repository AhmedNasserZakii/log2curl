import {
  extractBody,
  extractCustomHeaders,
  extractMethod,
  extractToken,
  extractUrl,
  stripLogPrefixes,
  unwrapBodyIfNeeded,
} from './extractors';
import { normalizeBody } from './normalizer';
import {
  createId,
  EditablePair,
  HttpMethod,
  isHttpMethod,
  isSensitiveHeader,
  ParseDiagnostic,
  ParseResult,
  RequestBody,
  RequestDraft,
} from './requestStudio/model';

const REQUEST_MARKER = /\bRequest\s*[\u2500-\u257F|:]*\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i;

interface RequestSlice {
  text: string;
  requestCount: number;
}

function stripBoxPrefix(line: string): string {
  return line.replace(/^[\u2500-\u257F]+\s*/, '').trim();
}

/** Isolates the first PrettyDioLogger request so later requests cannot leak in. */
export function isolateFirstRequest(text: string): RequestSlice {
  const lines = text.split(/\r?\n/);
  const markers: number[] = [];

  for (let index = 0; index < lines.length; index++) {
    const cleaned = stripBoxPrefix(stripLogPrefixes(lines[index]).trim());
    if (REQUEST_MARKER.test(cleaned)) {
      markers.push(index);
    }
  }

  if (markers.length === 0) {
    return { text, requestCount: 1 };
  }

  const start = markers[0];
  const end = markers[1] ?? lines.length;
  return {
    text: lines.slice(start, end).join('\n'),
    requestCount: markers.length,
  };
}

function parseUrl(rawUrl: string): { url: string; query: EditablePair[] } {
  const parsed = new URL(rawUrl);
  const query: EditablePair[] = [];
  for (const [name, value] of parsed.searchParams.entries()) {
    query.push({ id: createId(), name, value, enabled: true });
  }
  parsed.search = '';
  return { url: parsed.toString(), query };
}

function parseHeaders(text: string): EditablePair[] {
  const extracted = extractCustomHeaders(text);
  const headers = extracted.map(header => ({
    id: createId(),
    name: header.key,
    value: header.value,
    enabled: true,
    sensitive: isSensitiveHeader(header.key),
  }));

  const hasAuthorization = headers.some(
    header => header.name.toLowerCase() === 'authorization'
  );
  if (!hasAuthorization) {
    const token = extractToken(text);
    if (token) {
      headers.push({
        id: createId(),
        name: 'Authorization',
        value: `Bearer ${token}`,
        enabled: true,
        sensitive: true,
      });
    }
  }
  return headers;
}

function parseBody(
  text: string,
  headers: EditablePair[],
  warnings: ParseDiagnostic[]
): RequestBody {
  const rawBody = extractBody(text);
  if (!rawBody) {
    return { mode: 'none', text: '' };
  }

  const contentType = headers.find(
    header => header.name.toLowerCase() === 'content-type'
  )?.value;

  try {
    const normalized = normalizeBody(stripLogPrefixes(rawBody));
    const unwrapped = unwrapBodyIfNeeded(JSON.parse(normalized));
    return {
      mode: 'json',
      text: JSON.stringify(unwrapped, null, 2),
      contentType: contentType ?? 'application/json',
    };
  } catch {
    warnings.push({
      code: 'body-normalization-failed',
      message: 'The request body could not be normalized as JSON and was imported as raw text.',
    });
    return {
      mode: 'text',
      text: stripLogPrefixes(rawBody).trim(),
      contentType,
    };
  }
}

export function parseLogToRequestDraft(
  text: string,
  fallbackMethod?: HttpMethod
): ParseResult {
  const errors: ParseDiagnostic[] = [];
  const warnings: ParseDiagnostic[] = [];
  const sliced = isolateFirstRequest(text);
  const rawUrl = extractUrl(sliced.text);
  const rawMethod = extractMethod(sliced.text) ?? fallbackMethod;

  if (!rawUrl) {
    errors.push({ code: 'url-missing', message: 'No HTTP/HTTPS URL was found.' });
  }
  if (!rawMethod || !isHttpMethod(rawMethod)) {
    errors.push({ code: 'method-missing', message: 'No supported HTTP method was found.' });
  }
  if (errors.length > 0 || !rawUrl || !rawMethod || !isHttpMethod(rawMethod)) {
    return { ok: false, errors };
  }

  let parsedUrl: { url: string; query: EditablePair[] };
  try {
    parsedUrl = parseUrl(rawUrl);
  } catch {
    return {
      ok: false,
      errors: [{ code: 'url-missing', message: 'The extracted URL is invalid.' }],
    };
  }

  if (sliced.requestCount > 1) {
    warnings.push({
      code: 'multiple-requests',
      message: `Detected ${sliced.requestCount} requests and imported the first one.`,
    });
  }

  const headers = parseHeaders(sliced.text);
  const body = parseBody(sliced.text, headers, warnings);
  const draft: RequestDraft = {
    id: createId(),
    method: rawMethod.toUpperCase() as HttpMethod,
    url: parsedUrl.url,
    query: parsedUrl.query,
    headers,
    body,
    sourceLog: sliced.text,
    importedAt: Date.now(),
  };

  return { ok: true, draft, warnings };
}

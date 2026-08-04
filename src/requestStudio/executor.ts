import { performance } from 'node:perf_hooks';
import {
  buildRequestUrl,
  createId,
  EditablePair,
  enabledPairs,
  ExecutionOptions,
  isHttpMethod,
  isSensitiveHeader,
  RequestDraft,
  RequestFailure,
  ResponseSnapshot,
} from './model';
import {
  assertRedirectAllowed,
  headersForRedirect,
  isRedirectStatus,
  redirectedMethod,
  RedirectPolicyError,
} from './redirectPolicy';
import { readResponseBody } from './responseReader';

export interface RequestTransport {
  execute(
    draft: RequestDraft,
    options: ExecutionOptions,
    signal: AbortSignal
  ): Promise<ResponseSnapshot>;
}

const TRANSPORT_HEADERS = new Set([
  'connection', 'content-length', 'host', 'transfer-encoding',
]);

function validateUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RequestValidationError('Enter a valid request URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new RequestValidationError('Only HTTP and HTTPS requests are supported.');
  }
  if (url.username || url.password) {
    throw new RequestValidationError('URLs containing embedded credentials are not allowed.');
  }
  return url;
}

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export class RequestTimeoutError extends Error {
  constructor() {
    super('The request timed out.');
    this.name = 'RequestTimeoutError';
  }
}

function prepareHeaders(draft: RequestDraft): EditablePair[] {
  const headers = enabledPairs(draft.headers)
    .filter(header => !TRANSPORT_HEADERS.has(header.name.toLowerCase()))
    .map(header => ({ ...header }));

  const hasContentType = headers.some(
    header => header.name.toLowerCase() === 'content-type'
  );
  if (!hasContentType && draft.body.mode !== 'none') {
    headers.push({
      id: createId(),
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
  try {
    new Headers(toFetchHeaders(headers));
  } catch {
    throw new RequestValidationError('One or more request headers are invalid.');
  }
  return headers;
}

function validateBody(draft: RequestDraft): string | undefined {
  if (draft.body.mode === 'none' || draft.method === 'GET' || draft.method === 'HEAD') {
    return undefined;
  }
  if (draft.body.mode === 'json') {
    try {
      JSON.parse(draft.body.text);
    } catch {
      throw new RequestValidationError('The JSON request body is invalid.');
    }
  }
  return draft.body.text;
}

function toFetchHeaders(headers: EditablePair[]): Array<[string, string]> {
  return headers.map(header => [header.name, header.value]);
}

function responseHeaders(response: Response): EditablePair[] {
  const result: EditablePair[] = [];
  const exposedSetCookies = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.() ?? [];
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() === 'set-cookie' && exposedSetCookies.length > 0) {
      return;
    }
    result.push({
      id: createId(),
      name,
      value,
      enabled: true,
      sensitive: isSensitiveHeader(name),
    });
  });
  for (const value of exposedSetCookies) {
    result.push({
      id: createId(),
      name: 'set-cookie',
      value,
      enabled: true,
      sensitive: true,
    });
  }
  return result;
}

export class FetchRequestTransport implements RequestTransport {
  async execute(
    draft: RequestDraft,
    options: ExecutionOptions,
    signal: AbortSignal
  ): Promise<ResponseSnapshot> {
    if (!isHttpMethod(draft.method)) {
      throw new RequestValidationError('Select a supported HTTP method.');
    }
    if (!Number.isFinite(options.maxResponseBytes) || options.maxResponseBytes < 0) {
      throw new RequestValidationError('The response-size limit is invalid.');
    }
    if (!Number.isInteger(options.maxRedirects) || options.maxRedirects < 0) {
      throw new RequestValidationError('The redirect limit is invalid.');
    }
    validateUrl(draft.url);
    let requestUrl: string;
    try {
      requestUrl = buildRequestUrl(draft);
    } catch {
      throw new RequestValidationError('Enter a valid request URL.');
    }
    let currentUrl = validateUrl(requestUrl);
    let currentMethod: string = draft.method;
    let currentHeaders = prepareHeaders(draft);
    let currentBody = validateBody(draft);
    let redirectCount = 0;
    const startedAt = performance.now();

    while (true) {
      const response = await fetch(currentUrl, {
        method: currentMethod,
        headers: toFetchHeaders(currentHeaders),
        body: currentBody,
        redirect: 'manual',
        signal,
      });

      const location = response.headers.get('location');
      if (
        options.followRedirects &&
        location &&
        isRedirectStatus(response.status)
      ) {
        if (redirectCount >= options.maxRedirects) {
          throw new RedirectPolicyError(
            `Stopped after ${options.maxRedirects} redirects.`
          );
        }
        const nextUrl = new URL(location, currentUrl);
        assertRedirectAllowed(
          currentUrl,
          nextUrl,
          options.allowHttpsDowngrade === true
        );
        currentHeaders = headersForRedirect(currentHeaders, currentUrl, nextUrl);
        const redirected = redirectedMethod(response.status, currentMethod);
        currentMethod = redirected.method;
        if (redirected.dropBody) {
          currentBody = undefined;
          currentHeaders = currentHeaders.filter(header =>
            !['content-type', 'content-length'].includes(header.name.toLowerCase())
          );
        }
        currentUrl = nextUrl;
        redirectCount++;
        await response.body?.cancel();
        continue;
      }

      const body = await readResponseBody(response, options.maxResponseBytes);
      return {
        requestId: draft.id,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders(response),
        bodyText: body.bodyText,
        contentType: response.headers.get('content-type') ?? undefined,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        sizeBytes: body.sizeBytes,
        finalUrl: response.url || currentUrl.toString(),
        redirectCount,
        receivedAt: Date.now(),
        truncated: body.truncated,
      };
    }
  }
}

function nestedErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') { return undefined; }
  const direct = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (direct) { return direct; }
  return 'cause' in error ? nestedErrorCode(error.cause) : undefined;
}

export function categorizeRequestError(
  requestId: string,
  error: unknown,
  timedOut: boolean
): RequestFailure {
  if (timedOut) {
    return { requestId, category: 'timeout', message: 'The request timed out.' };
  }
  if (error instanceof RequestTimeoutError) {
    return { requestId, category: 'timeout', message: error.message };
  }
  if (error instanceof RedirectPolicyError) {
    return { requestId, category: 'redirect-policy', message: error.message };
  }
  if (error instanceof RequestValidationError) {
    return { requestId, category: 'validation', message: error.message };
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { requestId, category: 'cancelled', message: 'The request was cancelled.' };
  }

  const code = nestedErrorCode(error);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { requestId, category: 'dns', message: 'The host name could not be resolved.' };
  }
  if (code === 'ECONNREFUSED') {
    return { requestId, category: 'connection-refused', message: 'The connection was refused.' };
  }
  if (code?.startsWith('CERT_') || code?.includes('TLS')) {
    return { requestId, category: 'tls', message: 'TLS certificate validation failed.' };
  }
  const message = error instanceof Error ? error.message : 'The request failed.';
  return { requestId, category: 'network', message };
}

export class RequestExecutionController {
  private controller: AbortController | undefined;

  constructor(private readonly transport: RequestTransport) {}

  get running(): boolean {
    return this.controller !== undefined;
  }

  cancel(): void {
    this.controller?.abort();
  }

  async execute(
    draft: RequestDraft,
    options: ExecutionOptions
  ): Promise<ResponseSnapshot> {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new RequestValidationError('The request timeout is invalid.');
    }
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
    try {
      return await this.transport.execute(draft, options, controller.signal);
    } catch (error) {
      if (timedOut) { throw new RequestTimeoutError(); }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) {
        this.controller = undefined;
      }
    }
  }
}

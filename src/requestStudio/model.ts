import { randomUUID } from 'node:crypto';

export const HTTP_METHODS = [
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
] as const;

export type HttpMethod = typeof HTTP_METHODS[number];
export type BodyMode = 'none' | 'json' | 'text' | 'form';

export interface EditablePair {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
  sensitive?: boolean;
}

export interface RequestBody {
  mode: BodyMode;
  text: string;
  contentType?: string;
}

export interface RequestDraft {
  id: string;
  name?: string;
  method: HttpMethod;
  url: string;
  query: EditablePair[];
  headers: EditablePair[];
  body: RequestBody;
  sourceLog?: string;
  importedAt: number;
}

export interface ResponseSnapshot {
  requestId: string;
  status: number;
  statusText: string;
  headers: EditablePair[];
  bodyText: string;
  contentType?: string;
  durationMs: number;
  sizeBytes: number;
  finalUrl: string;
  redirectCount: number;
  receivedAt: number;
  truncated: boolean;
}

export type RequestErrorCategory =
  | 'invalid-url'
  | 'dns'
  | 'connection-refused'
  | 'tls'
  | 'timeout'
  | 'cancelled'
  | 'response-too-large'
  | 'redirect-policy'
  | 'network'
  | 'validation';

export interface RequestFailure {
  requestId: string;
  category: RequestErrorCategory;
  message: string;
}

export interface ParseDiagnostic {
  code:
    | 'multiple-requests'
    | 'body-normalization-failed'
    | 'method-missing'
    | 'url-missing';
  message: string;
}

export type ParseResult =
  | { ok: true; draft: RequestDraft; warnings: ParseDiagnostic[] }
  | { ok: false; errors: ParseDiagnostic[] };

export interface ExecutionOptions {
  timeoutMs: number;
  maxResponseBytes: number;
  followRedirects: boolean;
  maxRedirects: number;
  allowHttpsDowngrade?: boolean;
}

export interface HistoryEntry {
  id: string;
  name?: string;
  method: HttpMethod;
  origin: string;
  path: string;
  status?: number;
  durationMs?: number;
  executedAt: number;
}

export interface EnvironmentVariable {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
  secret: boolean;
}

export interface RequestEnvironment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
}

export function createId(): string {
  return randomUUID();
}

export function isHttpMethod(value: unknown): value is HttpMethod {
  return typeof value === 'string' &&
    (HTTP_METHODS as readonly string[]).includes(value.toUpperCase());
}

export function isSensitiveHeader(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === 'authorization' ||
    normalized === 'proxy-authorization' ||
    normalized === 'cookie' ||
    normalized === 'set-cookie' ||
    /api[-_]?key|apikey|token|secret|credential/i.test(normalized);
}

export function enabledPairs(pairs: EditablePair[]): EditablePair[] {
  return pairs.filter(pair => pair.enabled && pair.name.trim());
}

export function buildRequestUrl(draft: RequestDraft): string {
  const url = new URL(draft.url);
  url.search = '';
  for (const pair of enabledPairs(draft.query)) {
    url.searchParams.append(pair.name, pair.value);
  }
  return url.toString();
}

export function cloneDraft(draft: RequestDraft): RequestDraft {
  return {
    ...draft,
    query: draft.query.map(pair => ({ ...pair })),
    headers: draft.headers.map(pair => ({
      ...pair,
      sensitive: isSensitiveHeader(pair.name),
    })),
    body: { ...draft.body },
  };
}

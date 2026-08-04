import {
  EnvironmentVariable,
  HistoryEntry,
  HTTP_METHODS,
  RequestDraft,
  RequestEnvironment,
  ResponseSnapshot,
} from './model';

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'importClipboard' }
  | { type: 'acceptClipboardCandidate' }
  | { type: 'updateDraft'; draft: RequestDraft; clearResponse?: boolean }
  | { type: 'runRequest'; draft: RequestDraft; automatic?: boolean }
  | { type: 'cancelRequest' }
  | { type: 'copyCurl'; draft: RequestDraft }
  | { type: 'previewCurl'; draft: RequestDraft }
  | { type: 'copyResponse'; text: string }
  | { type: 'saveResponse'; text: string; contentType?: string }
  | { type: 'clearHistory' }
  | { type: 'clearStoredData' }
  | { type: 'deleteHistoryEntry'; entryId: string }
  | { type: 'exportHistory' }
  | { type: 'saveNamedRequest'; draft: RequestDraft; name: string }
  | { type: 'loadNamedRequest'; requestId: string }
  | { type: 'deleteNamedRequest'; requestId: string }
  | { type: 'saveEnvironment'; environment: RequestEnvironment }
  | { type: 'deleteEnvironment'; environmentId: string }
  | { type: 'selectEnvironment'; environmentId?: string }
  | { type: 'exportDraft'; draft: RequestDraft }
  | { type: 'importDraft' }
  | { type: 'disableAutoRun' };

export type HostToWebviewMessage =
  | { type: 'hydrate'; payload: StudioHydration }
  | {
    type: 'settingsChanged';
    settings: StudioSettingsSnapshot;
    workspaceTrusted: boolean;
    executionLocation: string;
  }
  | { type: 'draftImported'; draft: RequestDraft; warnings: string[] }
  | { type: 'clipboardCandidate'; draft: RequestDraft; warnings: string[]; automaticEligible: boolean }
  | { type: 'requestStarted'; requestId: string; automatic: boolean }
  | { type: 'requestSucceeded'; response: unknown }
  | { type: 'requestFailed'; failure: unknown }
  | { type: 'requestCancelled'; requestId: string }
  | { type: 'curlGenerated'; curl: string }
  | { type: 'historyChanged'; history: HistoryEntry[] }
  | { type: 'savedRequestsChanged'; savedRequests: RequestDraft[] }
  | { type: 'environmentsChanged'; environments: RequestEnvironment[]; activeEnvironmentId?: string }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; message: string };

export interface StudioSettingsSnapshot {
  timeoutMs: number;
  maxResponseBytes: number;
  followRedirects: boolean;
  maxRedirects: number;
  watchClipboard: boolean;
  confirmUnsafeMethods: boolean;
  persistHistory: boolean;
  autoRun: boolean;
  autoRunMethods: string[];
  autoRunAllowedHosts: string[];
}

export interface StudioHydration {
  draft?: RequestDraft;
  draftDirty: boolean;
  response?: ResponseSnapshot;
  settings: StudioSettingsSnapshot;
  history: HistoryEntry[];
  savedRequests: RequestDraft[];
  environments: RequestEnvironment[];
  activeEnvironmentId?: string;
  workspaceTrusted: boolean;
  executionLocation: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPair(value: unknown): boolean {
  return isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.value === 'string' &&
    typeof value.enabled === 'boolean' &&
    (value.sensitive === undefined || typeof value.sensitive === 'boolean');
}

export function isRequestDraft(value: unknown): value is RequestDraft {
  if (!isObject(value)) { return false; }
  if (
    typeof value.id !== 'string' ||
    typeof value.method !== 'string' ||
    !HTTP_METHODS.includes(value.method as typeof HTTP_METHODS[number]) ||
    typeof value.url !== 'string' ||
    !Array.isArray(value.query) ||
    !value.query.every(isPair) ||
    !Array.isArray(value.headers) ||
    !value.headers.every(isPair) ||
    !isObject(value.body) ||
    !['none', 'json', 'text', 'form'].includes(String(value.body.mode)) ||
    typeof value.body.text !== 'string' ||
    (value.body.contentType !== undefined && typeof value.body.contentType !== 'string') ||
    typeof value.importedAt !== 'number' ||
    (value.name !== undefined && typeof value.name !== 'string')
  ) {
    return false;
  }
  return value.sourceLog === undefined || typeof value.sourceLog === 'string';
}

function isEnvironmentVariable(value: unknown): value is EnvironmentVariable {
  return isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.value === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.secret === 'boolean';
}

function isEnvironment(value: unknown): value is RequestEnvironment {
  return isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.variables) &&
    value.variables.every(isEnvironmentVariable);
}

export function parseWebviewMessage(value: unknown): WebviewToHostMessage | undefined {
  if (!isObject(value) || typeof value.type !== 'string') { return undefined; }
  switch (value.type) {
    case 'ready':
    case 'importClipboard':
    case 'acceptClipboardCandidate':
    case 'cancelRequest':
    case 'clearHistory':
    case 'clearStoredData':
    case 'exportHistory':
    case 'importDraft':
    case 'disableAutoRun':
      return { type: value.type };
    case 'updateDraft':
    case 'copyCurl':
    case 'previewCurl':
    case 'exportDraft':
      return isRequestDraft(value.draft)
        ? {
          type: value.type,
          draft: value.draft,
          ...(value.type === 'updateDraft' && value.clearResponse === true
            ? { clearResponse: true }
            : {}),
        }
        : undefined;
    case 'runRequest':
      return isRequestDraft(value.draft)
        ? { type: value.type, draft: value.draft, automatic: value.automatic === true }
        : undefined;
    case 'copyResponse':
      return typeof value.text === 'string'
        ? { type: value.type, text: value.text }
        : undefined;
    case 'saveResponse':
      return typeof value.text === 'string'
        ? {
          type: value.type,
          text: value.text,
          contentType: typeof value.contentType === 'string' ? value.contentType : undefined,
        }
        : undefined;
    case 'deleteEnvironment':
      return typeof value.environmentId === 'string'
        ? { type: value.type, environmentId: value.environmentId }
        : undefined;
    case 'deleteHistoryEntry':
      return typeof value.entryId === 'string'
        ? { type: value.type, entryId: value.entryId }
        : undefined;
    case 'selectEnvironment':
      return value.environmentId === undefined || typeof value.environmentId === 'string'
        ? { type: value.type, environmentId: value.environmentId }
        : undefined;
    case 'saveEnvironment':
      return isEnvironment(value.environment)
        ? { type: value.type, environment: value.environment }
        : undefined;
    case 'saveNamedRequest':
      return isRequestDraft(value.draft) && typeof value.name === 'string'
        ? { type: value.type, draft: value.draft, name: value.name }
        : undefined;
    case 'loadNamedRequest':
    case 'deleteNamedRequest':
      return typeof value.requestId === 'string'
        ? { type: value.type, requestId: value.requestId }
        : undefined;
    default:
      return undefined;
  }
}

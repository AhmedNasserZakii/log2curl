import { RequestDraft } from './model';

const SAFE_AUTO_RUN_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AutoRunContext {
  enabled: boolean;
  visible: boolean;
  workspaceTrusted: boolean;
  remote: boolean;
  allowedMethods: string[];
  allowedHosts: string[];
}

export function isManualRunAllowed(workspaceTrusted: boolean): boolean {
  return workspaceTrusted;
}

export function isAutoRunAllowed(
  draft: RequestDraft,
  context: AutoRunContext
): boolean {
  if (
    !context.enabled ||
    !context.visible ||
    !context.workspaceTrusted ||
    context.remote ||
    !SAFE_AUTO_RUN_METHODS.has(draft.method) ||
    !context.allowedMethods.map(method => method.toUpperCase()).includes(draft.method)
  ) {
    return false;
  }
  if (context.allowedHosts.length === 0) { return false; }
  try {
    const url = new URL(draft.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return false;
    }
    const hostname = url.hostname.toLowerCase();
    return context.allowedHosts
      .map(host => host.trim().toLowerCase())
      .includes(hostname);
  } catch {
    return false;
  }
}

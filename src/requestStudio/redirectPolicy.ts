import { EditablePair, isSensitiveHeader } from './model';

export class RedirectPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedirectPolicyError';
  }
}

export function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

export function assertRedirectAllowed(
  from: URL,
  to: URL,
  allowHttpsDowngrade: boolean
): void {
  if (!['http:', 'https:'].includes(to.protocol)) {
    throw new RedirectPolicyError(`Redirect to unsupported scheme ${to.protocol}`);
  }
  if (to.username || to.password) {
    throw new RedirectPolicyError('Blocked a redirect containing embedded credentials.');
  }
  if (from.protocol === 'https:' && to.protocol === 'http:' && !allowHttpsDowngrade) {
    throw new RedirectPolicyError('Blocked an HTTPS to HTTP redirect.');
  }
}

export function headersForRedirect(
  headers: EditablePair[],
  from: URL,
  to: URL
): EditablePair[] {
  if (from.origin === to.origin) {
    return headers.map(header => ({ ...header }));
  }
  return headers
    .filter(header => !isSensitiveHeader(header.name))
    .map(header => ({ ...header }));
}

export function redirectedMethod(
  status: number,
  method: string
): { method: string; dropBody: boolean } {
  if (status === 303 && method !== 'HEAD') {
    return { method: 'GET', dropBody: true };
  }
  if ((status === 301 || status === 302) && method === 'POST') {
    return { method: 'GET', dropBody: true };
  }
  return { method, dropBody: false };
}

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { RequestDraft, ResponseSnapshot } from '../requestStudio/model';
import { StudioHydration } from '../requestStudio/messages';

interface Harness {
  dom: JSDOM;
  messages: Array<Record<string, unknown>>;
  send(data: unknown): void;
}

function requestDraft(): RequestDraft {
  return {
    id: 'request-1',
    method: 'POST',
    url: 'https://example.test/items',
    query: [{ id: 'query-1', name: 'page', value: '1', enabled: true }],
    headers: [{
      id: 'header-1',
      name: 'Authorization',
      value: 'Bearer fake-secret',
      enabled: true,
      sensitive: true,
    }],
    body: { mode: 'json', text: '{"hello":"world"}' },
    sourceLog: '<script>source must stay text</script>',
    importedAt: Date.now(),
  };
}

function hydration(): StudioHydration {
  return {
    draft: requestDraft(),
    draftDirty: false,
    settings: {
      timeoutMs: 30000,
      maxResponseBytes: 10485760,
      followRedirects: true,
      maxRedirects: 10,
      watchClipboard: true,
      confirmUnsafeMethods: true,
      persistHistory: false,
      autoRun: false,
      autoRunMethods: ['GET', 'HEAD', 'OPTIONS'],
      autoRunAllowedHosts: [],
    },
    history: [],
    savedRequests: [],
    environments: [],
    workspaceTrusted: true,
    executionLocation: 'Local extension host',
  };
}

function createHarness(): Harness {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    runScripts: 'outside-only',
    url: 'https://request-studio.test/',
  });
  const messages: Array<Record<string, unknown>> = [];
  let uiState: unknown;
  Object.defineProperty(dom.window, 'crypto', { value: webcrypto });
  Object.assign(dom.window, {
    structuredClone: <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
    acquireVsCodeApi: () => ({
      postMessage: (message: Record<string, unknown>) => messages.push(message),
      getState: () => uiState,
      setState: (state: unknown) => { uiState = state; },
    }),
    confirm: () => true,
    prompt: () => 'Saved request',
  });
  const bundle = fs.readFileSync(
    path.join(__dirname, '..', '..', 'media', 'requestStudio.js'),
    'utf8'
  );
  dom.window.eval(bundle);
  return {
    dom,
    messages,
    send: data => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data })),
  };
}

suite('Request Studio webview', () => {
  test('hydrates, edits fields, masks secrets, and blocks invalid JSON', () => {
    const harness = createHarness();
    try {
      assert.ok(harness.messages.some(message => message.type === 'ready'));
      harness.send({ type: 'hydrate', payload: hydration() });

      const document = harness.dom.window.document;
      const url = document.querySelector<HTMLInputElement>('#url');
      const secret = document.querySelector<HTMLInputElement>('#headersList input[type="password"]');
      assert.strictEqual(url?.value, 'https://example.test/items');
      assert.strictEqual(secret?.value, 'Bearer fake-secret');
      assert.strictEqual(document.querySelector('#sourceLog')?.textContent, '<script>source must stay text</script>');
      assert.strictEqual(document.querySelector('#sourceLog script'), null);

      const reveal = [...document.querySelectorAll<HTMLButtonElement>('#headersList button')]
        .find(item => item.textContent === 'Reveal');
      reveal?.click();
      assert.strictEqual(secret?.type, 'text');
      const headerName = document.querySelector<HTMLInputElement>(
        '#headersList .pair-row input[aria-label="headers name"]'
      );
      if (!headerName) { throw new Error('Header name control missing'); }
      headerName.value = 'X-Api-Key';
      headerName.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
      assert.strictEqual(secret?.type, 'password');

      if (!url) { throw new Error('URL control missing'); }
      url.value = 'https://example.test/edited';
      url.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
      const update = [...harness.messages].reverse()
        .find(message => message.type === 'updateDraft');
      assert.strictEqual((update?.draft as RequestDraft).url, 'https://example.test/edited');
      assert.strictEqual(document.querySelector('#draftState')?.textContent, 'Modified');
      harness.send({
        type: 'settingsChanged',
        settings: { ...hydration().settings, autoRun: true },
        workspaceTrusted: false,
        executionLocation: 'Remote: ssh-remote',
      });
      assert.strictEqual(document.querySelector('#draftState')?.textContent, 'Modified');
      assert.strictEqual(document.querySelector<HTMLButtonElement>('#runRequest')?.disabled, true);
      assert.strictEqual(document.querySelector('#autoRunBadge')?.classList.contains('hidden'), false);
      assert.match(document.querySelector('#executionLocation')?.textContent ?? '', /Remote/);

      harness.send({
        type: 'settingsChanged',
        settings: hydration().settings,
        workspaceTrusted: true,
        executionLocation: 'Local extension host',
      });

      const body = document.querySelector<HTMLTextAreaElement>('#bodyText');
      if (!body) { throw new Error('Body control missing'); }
      body.value = '{invalid';
      body.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
      const beforeRun = harness.messages.filter(message => message.type === 'runRequest').length;
      document.querySelector<HTMLButtonElement>('#runRequest')?.click();
      assert.strictEqual(
        harness.messages.filter(message => message.type === 'runRequest').length,
        beforeRun
      );
      assert.match(document.querySelector('#notice')?.textContent ?? '', /Fix the JSON body/);
    } finally {
      harness.dom.window.close();
    }
  });

  test('supports keyboard Run and dirty clipboard replacement confirmation', () => {
    const harness = createHarness();
    try {
      harness.send({ type: 'hydrate', payload: hydration() });
      const document = harness.dom.window.document;
      const body = document.querySelector<HTMLTextAreaElement>('#bodyText');
      if (!body) { throw new Error('Body control missing'); }
      body.value = '{"edited":true}';
      body.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
      harness.dom.window.dispatchEvent(new harness.dom.window.KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
      }));
      assert.ok(harness.messages.some(message => message.type === 'runRequest'));

      const candidate = { ...requestDraft(), id: 'candidate', url: 'https://example.test/new' };
      harness.send({
        type: 'clipboardCandidate',
        draft: candidate,
        warnings: [],
        automaticEligible: false,
      });
      Object.assign(harness.dom.window, { confirm: () => false });
      document.querySelector<HTMLButtonElement>('#candidateImport')?.click();
      assert.strictEqual(
        harness.messages.some(message => message.type === 'acceptClipboardCandidate'),
        false
      );
      Object.assign(harness.dom.window, { confirm: () => true });
      document.querySelector<HTMLButtonElement>('#candidateImport')?.click();
      assert.strictEqual(
        harness.messages.some(message => message.type === 'acceptClipboardCandidate'),
        true
      );
    } finally {
      harness.dom.window.close();
    }
  });

  test('renders malicious HTML responses as inert text and shows all summary metadata', () => {
    const harness = createHarness();
    try {
      harness.send({ type: 'hydrate', payload: hydration() });
      const response: ResponseSnapshot = {
        requestId: 'request-1',
        status: 418,
        statusText: "I'm a Teapot",
        headers: [{ id: 'h', name: 'set-cookie', value: 'fake=value', enabled: true, sensitive: true }],
        bodyText: '<img src=x onerror="globalThis.compromised=true"><script>bad()</script>',
        contentType: 'text/html',
        durationMs: 12.5,
        sizeBytes: 72,
        finalUrl: 'https://example.test/final',
        redirectCount: 1,
        receivedAt: Date.now(),
        truncated: false,
      };
      harness.send({ type: 'requestSucceeded', response });
      const document = harness.dom.window.document;
      assert.strictEqual(document.querySelector('#responseBody')?.textContent, response.bodyText);
      assert.strictEqual(document.querySelector('#responseBody img'), null);
      assert.strictEqual(document.querySelector('#responseBody script'), null);
      const summary = document.querySelector('#responseSummary')?.textContent ?? '';
      assert.match(summary, /418/);
      assert.match(summary, /12\.5 ms/);
      assert.match(summary, /72 B/);
      assert.match(summary, /example\.test\/final/);
      assert.strictEqual(document.querySelector('#responseHeaders code')?.textContent, '••••••••••••');
    } finally {
      harness.dom.window.close();
    }
  });

  test('shows running/cancelled states and formats and searches JSON responses', () => {
    const harness = createHarness();
    try {
      harness.send({ type: 'hydrate', payload: hydration() });
      const document = harness.dom.window.document;
      harness.send({ type: 'requestStarted', requestId: 'request-1', automatic: false });
      assert.strictEqual(document.querySelector<HTMLButtonElement>('#runRequest')?.disabled, true);
      assert.strictEqual(document.querySelector('#cancelRequest')?.classList.contains('hidden'), false);
      document.querySelector<HTMLButtonElement>('#cancelRequest')?.click();
      assert.ok(harness.messages.some(message => message.type === 'cancelRequest'));
      harness.send({ type: 'requestCancelled', requestId: 'request-1' });
      assert.strictEqual(document.querySelector<HTMLButtonElement>('#runRequest')?.disabled, false);
      assert.strictEqual(document.querySelector('#cancelRequest')?.classList.contains('hidden'), true);

      const response: ResponseSnapshot = {
        requestId: 'request-1',
        status: 200,
        statusText: 'OK',
        headers: [],
        bodyText: '{"alpha":1,"beta":2}',
        contentType: 'application/json',
        durationMs: 4,
        sizeBytes: 20,
        finalUrl: 'https://example.test/items',
        redirectCount: 0,
        receivedAt: Date.now(),
        truncated: false,
      };
      harness.send({ type: 'requestSucceeded', response });
      assert.match(document.querySelector('#responseBody')?.textContent ?? '', /\n  "alpha": 1/);
      const search = document.querySelector<HTMLInputElement>('#responseSearch');
      if (!search) { throw new Error('Response search control missing'); }
      search.value = 'beta';
      search.dispatchEvent(new harness.dom.window.Event('input', { bubbles: true }));
      assert.match(document.querySelector('#responseBody')?.textContent ?? '', /"beta": 2/);
      assert.doesNotMatch(document.querySelector('#responseBody')?.textContent ?? '', /alpha/);
    } finally {
      harness.dom.window.close();
    }
  });
});

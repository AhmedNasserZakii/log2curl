import * as assert from 'node:assert';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  categorizeRequestError,
  FetchRequestTransport,
  RequestExecutionController,
} from '../requestStudio/executor';
import {
  assertRedirectAllowed,
  headersForRedirect,
  redirectedMethod,
  RedirectPolicyError,
} from '../requestStudio/redirectPolicy';
import {
  createId,
  RequestDraft,
} from '../requestStudio/model';
import { parseWebviewMessage } from '../requestStudio/messages';
import { isAutoRunAllowed, isManualRunAllowed } from '../requestStudio/autoRunPolicy';
import { EnvironmentStore } from '../requestStudio/environments';
import { SavedRequestStore } from '../requestStudio/savedRequests';
import { ClipboardWatcher } from '../requestStudio/clipboardWatcher';
import { RequestStudioPanel } from '../requestStudio/panel';
import { HistoryStore } from '../requestStudio/history';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

function draft(url: string, overrides: Partial<RequestDraft> = {}): RequestDraft {
  return {
    id: createId(),
    method: 'GET',
    url,
    query: [],
    headers: [],
    body: { mode: 'none', text: '' },
    importedAt: Date.now(),
    ...overrides,
  };
}

const options = {
  timeoutMs: 2000,
  maxResponseBytes: 1024 * 1024,
  followRedirects: true,
  maxRedirects: 5,
};

suite('Request Studio transport', () => {
  let server: http.Server;
  let baseUrl: string;

  suiteSetup(async () => {
    server = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/delay') {
        setTimeout(() => {
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('late');
        }, 300);
        return;
      }
      if (url.pathname === '/large') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('x'.repeat(4096));
        return;
      }
      if (url.pathname === '/redirect') {
        response.writeHead(302, { location: '/echo?redirected=yes' });
        response.end();
        return;
      }
      if (url.pathname === '/status/422') {
        response.writeHead(422, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'validation' }));
        return;
      }
      if (url.pathname === '/text') {
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('plain response');
        return;
      }
      if (url.pathname === '/empty') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (url.pathname === '/binary') {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(Buffer.from([0, 1, 2, 255]));
        return;
      }
      if (url.pathname === '/cookies') {
        response.setHeader('set-cookie', ['first=fake; HttpOnly', 'second=fake; Secure']);
        response.end('cookies');
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
    });
    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  suiteTeardown(async () => {
    server.closeAllConnections();
    await close(server);
  });

  test('executes GET with duplicate query values', async () => {
    const transport = new FetchRequestTransport();
    const request = draft(`${baseUrl}/echo`, {
      query: [
        { id: createId(), name: 'tag', value: 'one', enabled: true },
        { id: createId(), name: 'tag', value: 'two', enabled: true },
      ],
    });
    const result = await transport.execute(request, options, new AbortController().signal);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.truncated, false);
    const body = JSON.parse(result.bodyText);
    assert.strictEqual(body.url, '/echo?tag=one&tag=two');
  });

  test('executes a JSON POST and keeps non-2xx responses', async () => {
    const transport = new FetchRequestTransport();
    const post = draft(`${baseUrl}/echo`, {
      method: 'POST',
      body: { mode: 'json', text: '{"hello":"world"}' },
    });
    const postResult = await transport.execute(post, options, new AbortController().signal);
    const postBody = JSON.parse(postResult.bodyText);
    assert.strictEqual(postBody.method, 'POST');
    assert.strictEqual(postBody.body, '{"hello":"world"}');

    const errorResult = await transport.execute(
      draft(`${baseUrl}/status/422`), options, new AbortController().signal
    );
    assert.strictEqual(errorResult.status, 422);
    assert.deepStrictEqual(JSON.parse(errorResult.bodyText), { error: 'validation' });
  });

  test('follows redirects and reports the final URL', async () => {
    const result = await new FetchRequestTransport().execute(
      draft(`${baseUrl}/redirect`), options, new AbortController().signal
    );
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.redirectCount, 1);
    assert.ok(result.finalUrl.endsWith('/echo?redirected=yes'));
  });

  test('truncates oversized responses', async () => {
    const result = await new FetchRequestTransport().execute(
      draft(`${baseUrl}/large`),
      { ...options, maxResponseBytes: 100 },
      new AbortController().signal
    );
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(Buffer.byteLength(result.bodyText), 100);
    assert.ok(result.sizeBytes > 100);
  });

  test('times out and categorizes the failure', async () => {
    const controller = new RequestExecutionController(new FetchRequestTransport());
    const request = draft(`${baseUrl}/delay`);
    let caught: unknown;
    try {
      await controller.execute(request, { ...options, timeoutMs: 30 });
    } catch (error) {
      caught = error;
    }
    const failure = categorizeRequestError(request.id, caught, false);
    assert.strictEqual(failure.category, 'timeout');
    assert.strictEqual(controller.running, false);
  });

  test('cancels an in-flight request and releases controller state', async () => {
    const controller = new RequestExecutionController(new FetchRequestTransport());
    const request = draft(`${baseUrl}/delay`);
    const pending = controller.execute(request, options);
    setTimeout(() => controller.cancel(), 20);
    let caught: unknown;
    try { await pending; } catch (error) { caught = error; }
    assert.strictEqual(categorizeRequestError(request.id, caught, false).category, 'cancelled');
    assert.strictEqual(controller.running, false);
  });

  test('renders text, empty, and binary-like responses without crashing', async () => {
    const transport = new FetchRequestTransport();
    const text = await transport.execute(draft(`${baseUrl}/text`), options, new AbortController().signal);
    const empty = await transport.execute(draft(`${baseUrl}/empty`), options, new AbortController().signal);
    const binary = await transport.execute(draft(`${baseUrl}/binary`), options, new AbortController().signal);
    assert.strictEqual(text.bodyText, 'plain response');
    assert.strictEqual(empty.bodyText, '');
    assert.strictEqual(binary.sizeBytes, 4);
  });

  test('preserves repeated Set-Cookie headers when the runtime exposes them', async () => {
    const response = await new FetchRequestTransport().execute(
      draft(`${baseUrl}/cookies`), options, new AbortController().signal
    );
    assert.strictEqual(
      response.headers.filter(header => header.name.toLowerCase() === 'set-cookie').length,
      2
    );
    assert.ok(response.headers
      .filter(header => header.name.toLowerCase() === 'set-cookie')
      .every(header => header.sensitive));
  });

  test('categorizes malformed URLs as validation failures', async () => {
    const request = draft('not a URL');
    let caught: unknown;
    try {
      await new FetchRequestTransport().execute(request, options, new AbortController().signal);
    } catch (error) { caught = error; }
    assert.strictEqual(categorizeRequestError(request.id, caught, false).category, 'validation');
  });

  test('validates method, headers, timeout, and execution limits', async () => {
    const transport = new FetchRequestTransport();
    const cases: Array<[RequestDraft, typeof options]> = [
      [{ ...draft(`${baseUrl}/echo`), method: 'TRACE' as RequestDraft['method'] }, options],
      [draft(`${baseUrl}/echo`, {
        headers: [{ id: createId(), name: 'Bad\nHeader', value: 'x', enabled: true }],
      }), options],
      [draft(`${baseUrl}/echo`), { ...options, maxResponseBytes: -1 }],
      [draft(`${baseUrl}/echo`), { ...options, maxRedirects: -1 }],
    ];
    for (const [request, executionOptions] of cases) {
      let caught: unknown;
      try {
        await transport.execute(request, executionOptions, new AbortController().signal);
      } catch (error) { caught = error; }
      assert.strictEqual(categorizeRequestError(request.id, caught, false).category, 'validation');
    }

    const controller = new RequestExecutionController(transport);
    const invalidTimeout = draft(`${baseUrl}/echo`);
    let timeoutError: unknown;
    try { await controller.execute(invalidTimeout, { ...options, timeoutMs: 0 }); }
    catch (error) { timeoutError = error; }
    assert.strictEqual(
      categorizeRequestError(invalidTimeout.id, timeoutError, false).category,
      'validation'
    );
  });

  test('removes credentials during a real cross-origin redirect', async () => {
    const destination = http.createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ authorization: request.headers.authorization ?? null }));
    });
    const destinationPort = await listen(destination);
    const redirector = http.createServer((_request, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${destinationPort}/target` });
      response.end();
    });
    const redirectorPort = await listen(redirector);
    try {
      const result = await new FetchRequestTransport().execute(draft(
        `http://127.0.0.1:${redirectorPort}/start`,
        { headers: [{ id: createId(), name: 'Authorization', value: 'Bearer fake', enabled: true }] }
      ), options, new AbortController().signal);
      assert.deepStrictEqual(JSON.parse(result.bodyText), { authorization: null });
    } finally {
      destination.closeAllConnections();
      redirector.closeAllConnections();
      await close(destination);
      await close(redirector);
    }
  });
});

suite('Request Studio safety policy', () => {
  test('manual execution is denied in Restricted Mode', () => {
    assert.strictEqual(isManualRunAllowed(false), false);
    assert.strictEqual(isManualRunAllowed(true), true);
  });

  test('strips credentials on cross-origin redirects', () => {
    const headers = [
      { id: createId(), name: 'Authorization', value: 'Bearer fake-token', enabled: true },
      { id: createId(), name: 'X-Api-Key', value: 'fake-key', enabled: true },
      { id: createId(), name: 'Accept', value: 'application/json', enabled: true },
    ];
    const result = headersForRedirect(
      headers,
      new URL('https://one.example/a'),
      new URL('https://two.example/b')
    );
    assert.deepStrictEqual(result.map(header => header.name), ['Accept']);
  });

  test('blocks HTTPS downgrade and unsupported schemes', () => {
    assert.throws(
      () => assertRedirectAllowed(
        new URL('https://example.test'),
        new URL('http://example.test'),
        false
      ),
      RedirectPolicyError
    );
    assert.throws(
      () => assertRedirectAllowed(
        new URL('https://example.test'),
        new URL('file:///tmp/data'),
        true
      ),
      RedirectPolicyError
    );
    assert.throws(
      () => assertRedirectAllowed(
        new URL('https://example.test'),
        new URL('https://user:password@example.test/next'),
        false
      ),
      RedirectPolicyError
    );
  });

  test('applies standard redirect method behavior', () => {
    assert.deepStrictEqual(redirectedMethod(303, 'PATCH'), { method: 'GET', dropBody: true });
    assert.deepStrictEqual(redirectedMethod(302, 'POST'), { method: 'GET', dropBody: true });
    assert.deepStrictEqual(redirectedMethod(307, 'POST'), { method: 'POST', dropBody: false });
  });

  test('rejects malformed webview messages', () => {
    assert.strictEqual(parseWebviewMessage({ type: 'runRequest', draft: null }), undefined);
    assert.strictEqual(parseWebviewMessage({ type: 'unknown' }), undefined);
    assert.deepStrictEqual(parseWebviewMessage({ type: 'cancelRequest' }), { type: 'cancelRequest' });
    const malformedName = { ...draft('https://example.test'), name: { unsafe: true } };
    assert.strictEqual(
      parseWebviewMessage({ type: 'updateDraft', draft: malformedName }),
      undefined
    );
  });

  test('auto-run requires every safety gate and an exact hostname', () => {
    const request = draft('https://api.example.test/items');
    const allowed = {
      enabled: true,
      visible: true,
      workspaceTrusted: true,
      remote: false,
      allowedMethods: ['GET'],
      allowedHosts: ['api.example.test'],
    };
    assert.strictEqual(isAutoRunAllowed(request, allowed), true);
    assert.strictEqual(isAutoRunAllowed(request, { ...allowed, workspaceTrusted: false }), false);
    assert.strictEqual(isAutoRunAllowed(request, { ...allowed, visible: false }), false);
    assert.strictEqual(isAutoRunAllowed(request, { ...allowed, remote: true }), false);
    assert.strictEqual(isAutoRunAllowed(request, { ...allowed, allowedHosts: ['example.test'] }), false);
    assert.strictEqual(isAutoRunAllowed({ ...request, method: 'POST' }, allowed), false);
    assert.strictEqual(isAutoRunAllowed(
      { ...request, method: 'POST' },
      { ...allowed, allowedMethods: ['POST'] }
    ), false);
    assert.strictEqual(isAutoRunAllowed(
      { ...request, url: 'https://user:password@api.example.test/items' },
      allowed
    ), false);
  });

  test('categorizes common nested network errors without exposing raw details', () => {
    assert.strictEqual(
      categorizeRequestError('id', { cause: { code: 'ENOTFOUND' } }, false).category,
      'dns'
    );
    assert.strictEqual(
      categorizeRequestError('id', { cause: { code: 'ECONNREFUSED' } }, false).category,
      'connection-refused'
    );
    assert.strictEqual(
      categorizeRequestError('id', { cause: { code: 'CERT_HAS_EXPIRED' } }, false).category,
      'tls'
    );
  });
});

class MemoryState {
  private readonly values = new Map<string, unknown>();
  get<T>(key: string, fallback?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T | undefined;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) { this.values.delete(key); } else { this.values.set(key, value); }
  }
  keys(): readonly string[] { return [...this.values.keys()]; }
}

class MemorySecrets {
  readonly values = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.values.get(key); }
  async store(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

suite('Request Studio persistence', () => {
  test('records repeated executions as separate redacted history entries', async () => {
    const state = new MemoryState();
    const store = new HistoryStore(state as unknown as vscode.Memento);
    const request = draft('https://example.test/private/path?token=must-not-persist');
    await store.record(request);
    await store.record(request);
    assert.strictEqual(store.list().length, 2);
    assert.notStrictEqual(store.list()[0].id, store.list()[1].id);
    assert.deepStrictEqual(
      store.list().map(item => ({ origin: item.origin, path: item.path })),
      [
        { origin: 'https://example.test', path: '/private/path' },
        { origin: 'https://example.test', path: '/private/path' },
      ]
    );
    assert.strictEqual(JSON.stringify(store.list()).includes('must-not-persist'), false);
    const removedId = store.list()[0].id;
    await store.delete(removedId);
    assert.strictEqual(store.list().length, 1);
    assert.strictEqual(store.list().some(item => item.id === removedId), false);
  });

  test('stores environment secrets separately and resolves variables', async () => {
    const state = new MemoryState();
    const secrets = new MemorySecrets();
    const store = new EnvironmentStore(
      state as unknown as vscode.Memento,
      secrets as unknown as vscode.SecretStorage
    );
    await store.save({
      id: 'env', name: 'Test', variables: [
        { id: 'base', name: 'baseUrl', value: 'https://example.test', enabled: true, secret: false },
        { id: 'token', name: 'token', value: 'fake-secret', enabled: true, secret: true },
      ],
    });
    await store.select('env');
    assert.ok([...secrets.values.values()].includes('fake-secret'));
    const resolved = await store.resolve(draft('{{baseUrl}}/items', {
      headers: [{ id: createId(), name: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
    }));
    assert.strictEqual(resolved.url, 'https://example.test/items');
    assert.strictEqual(resolved.headers[0].value, 'Bearer fake-secret');
    await store.clear();
    assert.strictEqual((await store.list()).length, 0);
    assert.strictEqual(store.activeId(), undefined);
    assert.strictEqual(secrets.values.size, 0);
  });

  test('stores saved-request credentials in SecretStorage and restores them', async () => {
    const state = new MemoryState();
    const secrets = new MemorySecrets();
    const store = new SavedRequestStore(
      state as unknown as vscode.Memento,
      secrets as unknown as vscode.SecretStorage
    );
    const request = draft('https://example.test/items', {
      name: 'Items',
      sourceLog: 'must not persist',
      headers: [{ id: 'auth', name: 'Authorization', value: 'Bearer fake-secret', enabled: true }],
    });
    await store.save(request);
    assert.ok([...secrets.values.values()].includes('Bearer fake-secret'));
    const restored = (await store.list())[0];
    assert.strictEqual(restored.headers[0].value, 'Bearer fake-secret');
    assert.strictEqual(restored.sourceLog, undefined);
    await store.delete(request.id);
    assert.strictEqual(secrets.values.size, 0);
    await store.save({ ...request, id: 'second-request' });
    assert.strictEqual(secrets.values.size, 1);
    await store.clear();
    assert.strictEqual((await store.list()).length, 0);
    assert.strictEqual(secrets.values.size, 0);
  });
});

suite('Request Studio extension integration', () => {
  test('registers all public commands and declares Restricted Mode support', async () => {
    const extension = vscode.extensions.getExtension('AhmedNasserZaki.log2curl');
    assert.ok(extension);
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      'log2curl.convert',
      'log2curl.openRequestStudio',
      'log2curl.requestStudio.importClipboard',
      'log2curl.requestStudio.run',
    ]) {
      assert.ok(commands.includes(command), `${command} should be registered`);
    }
    assert.strictEqual(
      extension.packageJSON.capabilities.untrustedWorkspaces.supported,
      'limited'
    );
  });

  test('Convert to cURL opens Studio with the parsed draft and runs it', async () => {
    RequestStudioPanel.getCurrent()?.dispose();
    const originalClipboard = await vscode.env.clipboard.readText();
    let requestedUrl = '';
    const server = http.createServer((request, response) => {
      requestedUrl = request.url ?? '';
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
    const port = await listen(server);
    const url = `http://127.0.0.1:${port}/converted?type=express&page=1`;

    try {
      await vscode.env.clipboard.writeText(`Method: GET\nFULL URL: ${url}`);
      await vscode.commands.executeCommand('log2curl.convert');

      assert.ok(RequestStudioPanel.getCurrent(), 'Request Studio should be open');
      assert.strictEqual(requestedUrl, '/converted?type=express&page=1');
      const clipboard = await vscode.env.clipboard.readText();
      assert.ok(clipboard.startsWith('curl '));
      assert.ok(clipboard.includes(url));
    } finally {
      RequestStudioPanel.getCurrent()?.dispose();
      await vscode.env.clipboard.writeText(originalClipboard);
      server.closeAllConnections();
      await close(server);
    }
  });

  test('webview renders untrusted content through textContent and has no innerHTML sink', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'webview', 'main.ts'),
      'utf8'
    );
    assert.strictEqual(source.includes('innerHTML'), false);
    assert.ok(source.includes('target.textContent = text'));
    assert.ok(source.includes('required(\'responseRaw\').textContent'));
  });

  test('keeps one panel instance and cleans it up when disposed', async () => {
    await vscode.commands.executeCommand('log2curl.openRequestStudio');
    const first = RequestStudioPanel.getCurrent();
    assert.ok(first);
    await vscode.commands.executeCommand('log2curl.openRequestStudio');
    assert.strictEqual(RequestStudioPanel.getCurrent(), first);
    first.dispose();
    assert.strictEqual(RequestStudioPanel.getCurrent(), undefined);
  });

  test('clipboard watcher owns at most one timer and stops synchronously', () => {
    const watcher = new ClipboardWatcher(() => undefined, 60_000);
    watcher.start();
    watcher.start();
    assert.strictEqual(watcher.active, true);
    watcher.stop();
    assert.strictEqual(watcher.active, false);
    watcher.dispose();
    assert.strictEqual(watcher.active, false);
  });
});

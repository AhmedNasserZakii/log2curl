import { createHash, randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { buildCurlFromDraft } from '../curlBuilder';
import { parseLogToRequestDraft } from '../requestParser';
import { ClipboardWatcher } from './clipboardWatcher';
import { isAutoRunAllowed, isManualRunAllowed } from './autoRunPolicy';
import { EnvironmentStore } from './environments';
import {
  categorizeRequestError,
  FetchRequestTransport,
  RequestExecutionController,
} from './executor';
import { HistoryStore } from './history';
import { SavedRequestStore } from './savedRequests';
import {
  HostToWebviewMessage,
  parseWebviewMessage,
  StudioSettingsSnapshot,
} from './messages';
import {
  cloneDraft,
  createId,
  isSensitiveHeader,
  ParseResult,
  RequestDraft,
  RequestEnvironment,
  ResponseSnapshot,
} from './model';

const VIEW_TYPE = 'log2curl.requestStudio';
const CONFIG_SECTION = 'log2curl.requestStudio';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class RequestStudioPanel implements vscode.Disposable {
  private static current: RequestStudioPanel | undefined;

  static async open(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    importClipboard = true,
    clipboardTextsToIgnore: string[] = []
  ): Promise<RequestStudioPanel> {
    if (this.current) {
      for (const text of clipboardTextsToIgnore) {
        this.current.ignoreClipboardText(text);
      }
      this.current.panel.reveal(vscode.ViewColumn.Active);
      if (importClipboard) { await this.current.importClipboard(); }
      return this.current;
    }

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Log2Curl Request Studio',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      }
    );
    this.current = new RequestStudioPanel(
      context,
      output,
      panel,
      clipboardTextsToIgnore
    );
    context.subscriptions.push(this.current);
    if (importClipboard) { await this.current.importClipboard(); }
    return this.current;
  }

  static getCurrent(): RequestStudioPanel | undefined {
    return this.current;
  }

  private draft: RequestDraft | undefined;
  private response: ResponseSnapshot | undefined;
  private clipboardCandidate: { draft: RequestDraft; warnings: string[] } | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly executor = new RequestExecutionController(new FetchRequestTransport());
  private readonly watcher: ClipboardWatcher;
  private readonly history: HistoryStore;
  private readonly environments: EnvironmentStore;
  private readonly savedRequests: SavedRequestStore;
  private credentialConsentGranted = false;
  private autoRunSessionApproved = false;
  private lastAutoRunFingerprint = '';
  private lastAutoRunAt = 0;
  private disposed = false;
  private executionGeneration = 0;
  private draftDirty = false;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly panel: vscode.WebviewPanel,
    clipboardTextsToIgnore: string[]
  ) {
    this.history = new HistoryStore(context.globalState);
    this.environments = new EnvironmentStore(context.globalState, context.secrets);
    this.savedRequests = new SavedRequestStore(context.globalState, context.secrets);
    this.watcher = new ClipboardWatcher(result => {
      void this.handleClipboardCandidate(result).catch(() => {
        this.output.appendLine('Clipboard candidate handling failed.');
      });
    });
    for (const text of clipboardTextsToIgnore) {
      this.watcher.ignoreNext(text);
    }
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose(false)),
      this.panel.onDidChangeViewState(event => {
        this.syncWatcher(event.webviewPanel.visible);
      }),
      this.panel.webview.onDidReceiveMessage(value => {
        void this.handleMessage(value).catch(() => {
          this.output.appendLine('Request Studio message handling failed.');
          void this.notice('error', 'Request Studio could not complete that action.');
        });
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(CONFIG_SECTION)) {
          this.syncWatcher(this.panel.visible);
          void this.postSettings();
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        void this.postSettings();
      })
    );
    this.syncWatcher(this.panel.visible);
  }

  async importClipboard(): Promise<void> {
    try {
      if (this.draftDirty) {
        const choice = await vscode.window.showWarningMessage(
          'Replace the edited Request Studio draft with the current clipboard request?',
          { modal: true },
          'Replace Draft'
        );
        if (choice !== 'Replace Draft') { return; }
      }
      const text = await vscode.env.clipboard.readText();
      if (!text.trim()) {
        await this.notice('warning', 'Clipboard is empty.');
        return;
      }
      const result = parseLogToRequestDraft(text);
      if (!result.ok) {
        await this.notice('error', result.errors.map(error => error.message).join(' '));
        return;
      }
      this.draft = result.draft;
      this.draftDirty = false;
      this.response = undefined;
      this.clipboardCandidate = undefined;
      await this.post({
        type: 'draftImported',
        draft: cloneDraft(result.draft),
        warnings: result.warnings.map(warning => warning.message),
      });
    } catch {
      await this.notice('error', 'Could not read the clipboard.');
    }
  }

  ignoreClipboardText(text: string): void {
    this.watcher.ignoreNext(text);
  }

  async acceptConvertedDraft(
    draft: RequestDraft,
    warnings: string[] = []
  ): Promise<boolean> {
    if (this.draftDirty) {
      const choice = await vscode.window.showWarningMessage(
        'Replace the edited Request Studio draft with the converted clipboard request?',
        { modal: true },
        'Replace Draft'
      );
      if (choice !== 'Replace Draft') { return false; }
    }

    this.executor.cancel();
    this.executionGeneration++;
    this.draft = cloneDraft(draft);
    this.draftDirty = false;
    this.response = undefined;
    this.clipboardCandidate = undefined;
    await this.post({
      type: 'draftImported',
      draft: cloneDraft(draft),
      warnings,
    });
    return true;
  }

  async runCurrent(): Promise<void> {
    if (!this.draft) {
      await this.notice('warning', 'Import or create a request first.');
      return;
    }
    await this.runDraft(this.draft, false);
  }

  dispose(closePanel = true): void {
    if (this.disposed) { return; }
    this.disposed = true;
    if (RequestStudioPanel.current === this) {
      RequestStudioPanel.current = undefined;
    }
    this.executor.cancel();
    this.executionGeneration++;
    this.watcher.dispose();
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
    if (closePanel) { this.panel.dispose(); }
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = parseWebviewMessage(value);
    if (!message) {
      await this.notice('error', 'Ignored an invalid Request Studio message.');
      return;
    }
    switch (message.type) {
      case 'ready':
        await this.postHydration();
        break;
      case 'importClipboard':
        await this.importClipboard();
        break;
      case 'acceptClipboardCandidate':
        if (this.clipboardCandidate) {
          this.draft = this.clipboardCandidate.draft;
          this.draftDirty = false;
          this.response = undefined;
          await this.post({
            type: 'draftImported',
            draft: cloneDraft(this.clipboardCandidate.draft),
            warnings: this.clipboardCandidate.warnings,
          });
          this.clipboardCandidate = undefined;
        }
        break;
      case 'updateDraft':
        this.draft = cloneDraft(message.draft);
        this.draftDirty = true;
        if (message.clearResponse) { this.response = undefined; }
        break;
      case 'runRequest':
        this.draft = cloneDraft(message.draft);
        await this.runDraft(this.draft, message.automatic === true);
        break;
      case 'cancelRequest':
        this.executor.cancel();
        break;
      case 'copyCurl':
        await this.copyCurl(message.draft);
        break;
      case 'previewCurl':
        try {
          await this.post({
            type: 'curlGenerated',
            curl: buildCurlFromDraft(message.draft),
          });
        } catch {
          await this.post({
            type: 'curlGenerated',
            curl: '# Enter a valid HTTP/HTTPS URL to generate cURL.',
          });
        }
        break;
      case 'copyResponse':
        await vscode.env.clipboard.writeText(message.text);
        this.watcher.ignoreNext(message.text);
        await this.notice('info', 'Response copied to clipboard.');
        break;
      case 'saveResponse':
        await this.saveResponse(message.text, message.contentType);
        break;
      case 'clearHistory':
        await this.history.clear();
        await this.post({ type: 'historyChanged', history: [] });
        break;
      case 'clearStoredData':
        await Promise.all([
          this.history.clear(),
          this.savedRequests.clear(),
          this.environments.clear(),
        ]);
        await this.post({ type: 'historyChanged', history: [] });
        await this.post({ type: 'savedRequestsChanged', savedRequests: [] });
        await this.post({
          type: 'environmentsChanged',
          environments: [],
          activeEnvironmentId: undefined,
        });
        await this.notice('info', 'All persisted Request Studio data was cleared.');
        break;
      case 'deleteHistoryEntry':
        await this.history.delete(message.entryId);
        await this.post({ type: 'historyChanged', history: this.history.list() });
        break;
      case 'exportHistory':
        await this.exportHistory();
        break;
      case 'saveNamedRequest': {
        const named = cloneDraft(message.draft);
        named.name = message.name.trim() || 'Saved Request';
        await this.savedRequests.save(named);
        await this.post({
          type: 'savedRequestsChanged',
          savedRequests: await this.savedRequests.list(),
        });
        await this.notice('info', `Saved “${named.name}”.`);
        break;
      }
      case 'loadNamedRequest': {
        const saved = (await this.savedRequests.list())
          .find(request => request.id === message.requestId);
        if (saved) {
          this.draft = cloneDraft(saved);
          this.draftDirty = false;
          this.response = undefined;
          await this.post({
            type: 'draftImported',
            draft: cloneDraft(saved),
            warnings: [],
          });
        }
        break;
      }
      case 'deleteNamedRequest':
        await this.savedRequests.delete(message.requestId);
        await this.post({
          type: 'savedRequestsChanged',
          savedRequests: await this.savedRequests.list(),
        });
        break;
      case 'saveEnvironment':
        await this.environments.save(message.environment);
        await this.postEnvironments();
        break;
      case 'deleteEnvironment':
        await this.environments.delete(message.environmentId);
        await this.postEnvironments();
        break;
      case 'selectEnvironment':
        await this.environments.select(message.environmentId);
        await this.postEnvironments();
        break;
      case 'exportDraft':
        await this.exportDraft(message.draft);
        break;
      case 'importDraft':
        await this.importDraft();
        break;
      case 'disableAutoRun':
        await vscode.workspace.getConfiguration(CONFIG_SECTION)
          .update('autoRun', false, vscode.ConfigurationTarget.Global);
        this.autoRunSessionApproved = false;
        await this.notice('info', 'Clipboard auto-run disabled.');
        break;
    }
  }

  private async runDraft(draft: RequestDraft, automatic: boolean): Promise<void> {
    if (!isManualRunAllowed(vscode.workspace.isTrusted)) {
      await this.notice('error', 'Running requests is disabled in Restricted Mode.');
      return;
    }

    const resolved = await this.environments.resolve(draft);

    if (automatic && (
      !this.isAutoRunEligible(draft) || !this.isAutoRunEligible(resolved)
    )) {
      await this.notice('warning', 'Automatic execution was blocked by the host or method policy.');
      return;
    }

    if (!automatic && !await this.confirmManualRun(resolved)) { return; }

    const settings = this.settings();
    const generation = ++this.executionGeneration;
    this.response = undefined;
    await this.post({
      type: 'requestStarted',
      requestId: draft.id,
      automatic,
    });
    this.output.appendLine(`Request started (${draft.method}).`);

    try {
      const response = await this.executor.execute(resolved, {
        timeoutMs: settings.timeoutMs,
        maxResponseBytes: settings.maxResponseBytes,
        followRedirects: settings.followRedirects,
        maxRedirects: settings.maxRedirects,
      });
      if (generation !== this.executionGeneration) { return; }
      response.requestId = draft.id;
      this.response = response;
      await this.post({ type: 'requestSucceeded', response });
      if (settings.persistHistory) {
        await this.history.record(resolved, response);
        await this.post({ type: 'historyChanged', history: this.history.list() });
      }
      this.output.appendLine(`Request completed (${response.status}).`);
    } catch (error) {
      if (generation !== this.executionGeneration) { return; }
      const failure = categorizeRequestError(draft.id, error, false);
      if (failure.category === 'cancelled') {
        await this.post({ type: 'requestCancelled', requestId: draft.id });
      } else {
        await this.post({ type: 'requestFailed', failure });
      }
      this.output.appendLine(`Request failed (${failure.category}).`);
    }
  }

  private async confirmManualRun(draft: RequestDraft): Promise<boolean> {
    let origin: string;
    try {
      origin = new URL(draft.url).origin;
    } catch {
      origin = 'the entered destination';
    }
    const hasCredentials = draft.headers.some(
      header => header.enabled && isSensitiveHeader(header.name) && header.value
    );
    const unsafe = !SAFE_METHODS.has(draft.method) && this.settings().confirmUnsafeMethods;
    const needsCredentialConsent = hasCredentials && !this.credentialConsentGranted;
    if (!unsafe && !needsCredentialConsent) { return true; }

    const reasons = [
      unsafe ? `${draft.method} may modify server data.` : '',
      needsCredentialConsent ? 'The request contains credentials.' : '',
    ].filter(Boolean).join(' ');
    const choice = await vscode.window.showWarningMessage(
      `${reasons} Send ${draft.method} to ${origin}?`,
      { modal: true },
      'Run Request'
    );
    if (choice === 'Run Request' && needsCredentialConsent) {
      this.credentialConsentGranted = true;
    }
    return choice === 'Run Request';
  }

  private async handleClipboardCandidate(result: ParseResult): Promise<void> {
    if (!result.ok) { return; }
    const warnings = result.warnings.map(warning => warning.message);
    const eligible = this.isAutoRunEligible(result.draft);
    this.clipboardCandidate = { draft: result.draft, warnings };
    await this.post({
      type: 'clipboardCandidate',
      draft: cloneDraft(result.draft),
      warnings,
      automaticEligible: eligible,
    });

    if (!eligible || !await this.confirmAutoRunSession()) { return; }
    const fingerprint = this.autoRunFingerprint(result.draft);
    const now = Date.now();
    if (fingerprint === this.lastAutoRunFingerprint || now - this.lastAutoRunAt < 1500) {
      return;
    }
    this.lastAutoRunFingerprint = fingerprint;
    this.lastAutoRunAt = now;
    this.draft = result.draft;
    this.draftDirty = false;
    this.response = undefined;
    await this.post({
      type: 'draftImported',
      draft: cloneDraft(result.draft),
      warnings,
    });
    await this.runDraft(result.draft, true);
  }

  private isAutoRunEligible(draft: RequestDraft): boolean {
    const settings = this.settings();
    return isAutoRunAllowed(draft, {
      enabled: settings.autoRun,
      visible: this.panel.visible,
      workspaceTrusted: vscode.workspace.isTrusted,
      remote: vscode.env.remoteName !== undefined,
      allowedMethods: settings.autoRunMethods,
      allowedHosts: settings.autoRunAllowedHosts,
    });
  }

  private async confirmAutoRunSession(): Promise<boolean> {
    if (this.autoRunSessionApproved) { return true; }
    const choice = await vscode.window.showWarningMessage(
      'Allow Log2Curl to automatically run eligible clipboard requests for this session?',
      { modal: true },
      'Enable for Session'
    );
    this.autoRunSessionApproved = choice === 'Enable for Session';
    return this.autoRunSessionApproved;
  }

  private autoRunFingerprint(draft: RequestDraft): string {
    return createHash('sha256').update(JSON.stringify({
      method: draft.method,
      url: draft.url,
      query: draft.query,
      headers: draft.headers,
      body: draft.body,
    })).digest('hex');
  }

  private async copyCurl(draft: RequestDraft): Promise<void> {
    let curl: string;
    try {
      curl = buildCurlFromDraft(draft);
    } catch {
      await this.notice('error', 'Enter a valid HTTP/HTTPS URL before copying cURL.');
      return;
    }
    await vscode.env.clipboard.writeText(curl);
    this.watcher.ignoreNext(curl);
    await this.post({ type: 'curlGenerated', curl });
    await this.notice('info', 'cURL copied to clipboard.');
  }

  private async saveResponse(text: string, contentType?: string): Promise<void> {
    const extension = contentType?.includes('json') ? 'json' : 'txt';
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`log2curl-response.${extension}`),
      filters: extension === 'json'
        ? { JSON: ['json'], Text: ['txt'] }
        : { Text: ['txt'], JSON: ['json'] },
    });
    if (!uri) { return; }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
    await this.notice('info', 'Response saved.');
  }

  private async exportDraft(draft: RequestDraft): Promise<void> {
    const exported = cloneDraft(draft);
    exported.sourceLog = undefined;
    const includesSecrets = exported.headers.some(
      header => header.enabled && isSensitiveHeader(header.name) && header.value
    );
    if (includesSecrets) {
      const choice = await vscode.window.showWarningMessage(
        'This export contains unencrypted credentials. Save it only in a secure location?',
        { modal: true },
        'Export with Credentials'
      );
      if (choice !== 'Export with Credentials') { return; }
    }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('request.log2curl.json'),
      filters: { 'Log2Curl Request': ['json'] },
    });
    if (!uri) { return; }
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify({ schemaVersion: 1, request: exported }, null, 2), 'utf8')
    );
    await this.notice('info', 'Request exported.');
  }

  private async exportHistory(): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('log2curl-history.json'),
      filters: { JSON: ['json'] },
    });
    if (!uri) { return; }
    await vscode.workspace.fs.writeFile(
      uri,
      Buffer.from(JSON.stringify({
        schemaVersion: 1,
        redacted: true,
        history: this.history.list(),
      }, null, 2), 'utf8')
    );
    await this.notice('info', 'Redacted history exported.');
  }

  private async importDraft(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Log2Curl Request': ['json'] },
    });
    if (!uris?.[0]) { return; }
    try {
      const content = await vscode.workspace.fs.readFile(uris[0]);
      const parsed: unknown = JSON.parse(Buffer.from(content).toString('utf8'));
      if (
        typeof parsed !== 'object' || parsed === null ||
        !('schemaVersion' in parsed) || parsed.schemaVersion !== 1 ||
        !('request' in parsed)
      ) {
        throw new Error('Unsupported file format.');
      }
      const message = parseWebviewMessage({ type: 'updateDraft', draft: parsed.request });
      if (!message || message.type !== 'updateDraft') {
        throw new Error('Invalid request data.');
      }
      this.draft = cloneDraft(message.draft);
      this.draftDirty = false;
      this.response = undefined;
      await this.post({
        type: 'draftImported',
        draft: cloneDraft(message.draft),
        warnings: [],
      });
    } catch (error) {
      await this.notice(
        'error',
        error instanceof Error ? error.message : 'Could not import the request.'
      );
    }
  }

  private settings(): StudioSettingsSnapshot {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return {
      timeoutMs: config.get('timeoutMs', 30000),
      maxResponseBytes: config.get('maxResponseBytes', 10485760),
      followRedirects: config.get('followRedirects', true),
      maxRedirects: config.get('maxRedirects', 10),
      watchClipboard: config.get('watchClipboard', true),
      confirmUnsafeMethods: config.get('confirmUnsafeMethods', true),
      persistHistory: config.get('persistHistory', false),
      autoRun: config.get('autoRun', false),
      autoRunMethods: config.get('autoRunMethods', ['GET', 'HEAD', 'OPTIONS']),
      autoRunAllowedHosts: config.get('autoRunAllowedHosts', []),
    };
  }

  private syncWatcher(visible: boolean): void {
    if (visible && this.settings().watchClipboard) {
      this.watcher.start();
    } else {
      this.watcher.stop();
    }
  }

  private async postHydration(): Promise<void> {
    const environments = await this.environments.list();
    await this.post({
      type: 'hydrate',
      payload: {
        draft: this.draft ? cloneDraft(this.draft) : undefined,
        draftDirty: this.draftDirty,
        response: this.response,
        settings: this.settings(),
        history: this.history.list(),
        savedRequests: await this.savedRequests.list(),
        environments,
        activeEnvironmentId: this.environments.activeId(),
        workspaceTrusted: vscode.workspace.isTrusted,
        executionLocation: this.executionLocation(),
      },
    });
  }

  private async postSettings(): Promise<void> {
    await this.post({
      type: 'settingsChanged',
      settings: this.settings(),
      workspaceTrusted: vscode.workspace.isTrusted,
      executionLocation: this.executionLocation(),
    });
  }

  private executionLocation(): string {
    return vscode.env.remoteName
      ? `Remote: ${vscode.env.remoteName}`
      : 'Local extension host';
  }

  private async postEnvironments(): Promise<void> {
    await this.post({
      type: 'environmentsChanged',
      environments: await this.environments.list(),
      activeEnvironmentId: this.environments.activeId(),
    });
  }

  private async notice(
    level: 'info' | 'warning' | 'error',
    message: string
  ): Promise<void> {
    await this.post({ type: 'notice', level, message });
  }

  private async post(message: HostToWebviewMessage): Promise<void> {
    await this.panel.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'requestStudio.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'requestStudio.css')
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Log2Curl Request Studio</title>
</head>
<body>
  <div id="app" aria-live="polite"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export function createEmptyEnvironment(): RequestEnvironment {
  return {
    id: createId(),
    name: 'New Environment',
    variables: [],
  };
}

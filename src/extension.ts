// ─────────────────────────────────────────────────────────────
// extension.ts — Log2Curl entry point.
//
// Reads clipboard → parses a shared RequestDraft → builds cURL
// → copies to clipboard. Request Studio uses the same draft model.
// ─────────────────────────────────────────────────────────────

import * as vscode from 'vscode';
import { buildCurlFromDraft } from './curlBuilder';
import { parseLogToRequestDraft } from './requestParser';
import { HttpMethod } from './requestStudio/model';
import { RequestStudioPanel } from './requestStudio/panel';

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Log2Curl');
  const convertCommand = vscode.commands.registerCommand(
    'log2curl.convert',
    async () => {
      try {
        // ──────── 1. Read clipboard ────────
        let text: string;
        try {
          text = await vscode.env.clipboard.readText();
        } catch {
          vscode.window.showErrorMessage(
            'Log2Curl: Could not read clipboard. Copy your logs and try again.'
          );
          return;
        }

        if (!text || !text.trim()) {
          vscode.window.showErrorMessage('Log2Curl: Clipboard is empty.');
          return;
        }

        // ──────── 2. Parse a shared editable request draft ────────
        let parsed = parseLogToRequestDraft(text);
        if (!parsed.ok && parsed.errors.some(error => error.code === 'method-missing')) {
          const picked = await vscode.window.showQuickPick(
            ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            { placeHolder: 'Could not detect HTTP method — please select one' }
          );
          if (!picked) { return; } // user cancelled
          parsed = parseLogToRequestDraft(text, picked as HttpMethod);
        }

        if (!parsed.ok) {
          vscode.window.showErrorMessage(
            `Log2Curl: ${parsed.errors.map(error => error.message).join(' ')}`
          );
          return;
        }

        if (parsed.warnings.length > 0) {
          output.appendLine(
            `Parsed clipboard with ${parsed.warnings.length} non-sensitive warning(s).`
          );
        }

        // ──────── 3. Open Studio with the exact parsed request ────────
        // Ignore the source log before the watcher starts so it cannot
        // compete with this explicit conversion flow.
        const studio = await RequestStudioPanel.open(
          context,
          output,
          false,
          [text]
        );
        const accepted = await studio.acceptConvertedDraft(
          parsed.draft,
          parsed.warnings.map(warning => warning.message)
        );

        // ──────── 4. Build and copy cURL from the shared request model ────────
        const curl = buildCurlFromDraft(parsed.draft, { legacyDefaults: true });
        studio.ignoreClipboardText(curl);

        let copied = true;
        try {
          await vscode.env.clipboard.writeText(curl);
        } catch {
          copied = false;
          // Clipboard write can fail on some OS / remote setups.
          // Fall back to opening the cURL in an untitled editor.
          const doc = await vscode.workspace.openTextDocument({
            content: curl,
            language: 'shellscript',
          });
          await vscode.window.showTextDocument(doc);
          vscode.window.showInformationMessage(
            'Log2Curl: Clipboard unavailable — opened cURL in a new tab.'
          );
        }

        if (copied) {
          vscode.window.showInformationMessage(
            accepted
              ? 'Log2Curl: cURL copied. Request opened in Studio.'
              : 'Log2Curl: cURL copied. The edited Studio draft was kept.'
          );
        }

        output.appendLine('Generated a cURL command from clipboard input.');

        // The command itself explicitly promises to run the request. Request
        // Studio still enforces Workspace Trust and its credential/unsafe-method
        // confirmation prompts before any network traffic is sent.
        if (accepted) { await studio.runCurrent(); }

      } catch (err) {
        // Top-level safety net — prevents crashing the Extension Host
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`Unexpected error: ${msg}`);
        vscode.window.showErrorMessage(`Log2Curl: ${msg}`);
      }
    }
  );

  const openStudioCommand = vscode.commands.registerCommand(
    'log2curl.openRequestStudio',
    () => RequestStudioPanel.open(context, output, true)
  );
  const importStudioCommand = vscode.commands.registerCommand(
    'log2curl.requestStudio.importClipboard',
    async () => {
      const studio = RequestStudioPanel.getCurrent() ??
        await RequestStudioPanel.open(context, output, false);
      await studio.importClipboard();
    }
  );
  const runStudioCommand = vscode.commands.registerCommand(
    'log2curl.requestStudio.run',
    async () => {
      const studio = RequestStudioPanel.getCurrent();
      if (!studio) {
        vscode.window.showInformationMessage(
          'Log2Curl: Open Request Studio and import a request first.'
        );
        return;
      }
      await studio.runCurrent();
    }
  );

  context.subscriptions.push(
    output,
    convertCommand,
    openStudioCommand,
    importStudioCommand,
    runStudioCommand
  );
}

export function deactivate() {}

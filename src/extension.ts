// ─────────────────────────────────────────────────────────────
// extension.ts — Log2Curl entry point.
//
// Reads clipboard → extracts HTTP components → normalizes body
// → builds cURL → copies to clipboard.
// ─────────────────────────────────────────────────────────────

import * as vscode from 'vscode';
import {
  extractUrl,
  extractMethod,
  extractToken,
  extractBody,
  extractCustomHeaders,
  unwrapBodyIfNeeded,
  stripLogPrefixes,
} from './extractors';
import { normalizeBody } from './normalizer';
import { buildCurl } from './curlBuilder';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
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

        // ──────── 2. Extract URL (required) ────────
        const url = extractUrl(text);
        if (!url) {
          vscode.window.showErrorMessage(
            'Log2Curl: No HTTP/HTTPS URL found in clipboard.'
          );
          return;
        }

        // ──────── 3. Extract HTTP method ────────
        let method: string | null = extractMethod(text);

        if (!method) {
          const picked = await vscode.window.showQuickPick(
            ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            { placeHolder: 'Could not detect HTTP method — please select one' }
          );
          if (!picked) { return; } // user cancelled
          method = picked;
        }

        // ──────── 4. Extract authorization token (optional) ────────
        const token = extractToken(text);

        // ──────── 4b. Extract custom headers from HEADERS: section ────────
        const customHeaders = extractCustomHeaders(text);

        // ──────── 5. Extract & normalize body ────────
        let bodyJson: string | null = null;

        const rawBody = extractBody(text);

        if (rawBody) {
          try {
            // Strip log-line prefixes before normalizing
            const cleaned = stripLogPrefixes(rawBody);
            const normalized = normalizeBody(cleaned);

            // If normalized result is a wrapper (has url + method + body),
            // pull out the nested body.
            let parsed: unknown = JSON.parse(normalized);
            parsed = unwrapBodyIfNeeded(parsed);

            bodyJson = JSON.stringify(parsed, null, 2);
          } catch (e) {
            console.error('Log2Curl: body normalization failed', e);
            const choice = await vscode.window.showWarningMessage(
              'Log2Curl: Could not parse the request body. Generate cURL without body?',
              'Yes',
              'Cancel'
            );
            if (choice !== 'Yes') { return; }
          }
        } else {
          // No body found — only warn for methods that usually need one
          const needsBody = ['POST', 'PUT', 'PATCH'].includes(method);
          if (needsBody) {
            const choice = await vscode.window.showWarningMessage(
              `Log2Curl: No request body found for ${method}. Generate cURL without body?`,
              'Yes',
              'Cancel'
            );
            if (choice !== 'Yes') { return; }
          }
        }

        // ──────── 6. Build cURL ────────
        const curl = buildCurl({ url, method, token, body: bodyJson, customHeaders });

        // ──────── 7. Copy & notify ────────
        try {
          await vscode.env.clipboard.writeText(curl);
        } catch {
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
          return;
        }

        vscode.window.showInformationMessage(
          'Log2Curl: cURL copied to clipboard!'
        );

        console.log('Log2Curl — generated cURL:\n', curl);

      } catch (err) {
        // Top-level safety net — prevents crashing the Extension Host
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Log2Curl: unexpected error', err);
        vscode.window.showErrorMessage(`Log2Curl: ${msg}`);
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}

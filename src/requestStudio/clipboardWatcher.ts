import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { parseLogToRequestDraft } from '../requestParser';
import { ParseResult } from './model';

export class ClipboardWatcher implements vscode.Disposable {
  private timer: NodeJS.Timeout | undefined;
  private lastFingerprint = '';
  private readonly ignoredFingerprints = new Set<string>();
  private reading = false;

  constructor(
    private readonly onCandidate: (result: ParseResult) => void,
    private readonly intervalMs = 1000
  ) {}

  get active(): boolean {
    return this.timer !== undefined;
  }

  start(): void {
    if (this.timer) { return; }
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    void this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  ignoreNext(text: string): void {
    this.ignoredFingerprints.add(this.fingerprint(text));
    if (this.ignoredFingerprints.size > 10) {
      const oldest = this.ignoredFingerprints.values().next().value;
      if (oldest) { this.ignoredFingerprints.delete(oldest); }
    }
  }

  dispose(): void {
    this.stop();
  }

  private fingerprint(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private async poll(): Promise<void> {
    if (this.reading) { return; }
    this.reading = true;
    try {
      const text = await vscode.env.clipboard.readText();
      if (!text.trim()) { return; }
      const fingerprint = this.fingerprint(text);
      if (fingerprint === this.lastFingerprint) {
        return;
      }
      if (this.ignoredFingerprints.delete(fingerprint)) { return; }
      this.lastFingerprint = fingerprint;
      const result = parseLogToRequestDraft(text);
      if (result.ok) {
        this.onCandidate(result);
      }
    } catch {
      // Clipboard polling is best-effort; explicit Import reports errors.
    } finally {
      this.reading = false;
    }
  }
}

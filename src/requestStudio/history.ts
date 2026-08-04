import * as vscode from 'vscode';
import { createId, HistoryEntry, RequestDraft, ResponseSnapshot } from './model';

const HISTORY_KEY = 'requestStudio.history.v1';
const MAX_HISTORY = 100;

export class HistoryStore {
  constructor(private readonly state: vscode.Memento) {}

  list(): HistoryEntry[] {
    return this.state.get<HistoryEntry[]>(HISTORY_KEY, []);
  }

  async record(draft: RequestDraft, response?: ResponseSnapshot): Promise<void> {
    let url: URL;
    try {
      url = new URL(draft.url);
    } catch {
      return;
    }
    const entry: HistoryEntry = {
      id: createId(),
      name: draft.name,
      method: draft.method,
      origin: url.origin,
      path: url.pathname,
      status: response?.status,
      durationMs: response?.durationMs,
      executedAt: Date.now(),
    };
    const next = [entry, ...this.list()].slice(0, MAX_HISTORY);
    await this.state.update(HISTORY_KEY, next);
  }

  async clear(): Promise<void> {
    await this.state.update(HISTORY_KEY, undefined);
  }

  async delete(entryId: string): Promise<void> {
    await this.state.update(
      HISTORY_KEY,
      this.list().filter(entry => entry.id !== entryId)
    );
  }
}

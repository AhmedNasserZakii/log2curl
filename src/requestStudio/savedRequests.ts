import * as vscode from 'vscode';
import { cloneDraft, isSensitiveHeader, RequestDraft } from './model';

const SAVED_REQUESTS_KEY = 'requestStudio.savedRequests.v1';
const SECRET_PREFIX = 'requestStudio.savedRequest.secret.';

export class SavedRequestStore {
  constructor(
    private readonly state: vscode.Memento,
    private readonly secrets: vscode.SecretStorage
  ) {}

  async list(): Promise<RequestDraft[]> {
    const stored = this.state.get<RequestDraft[]>(SAVED_REQUESTS_KEY, []);
    return Promise.all(stored.map(async item => {
      const draft = cloneDraft(item);
      draft.headers = await Promise.all(draft.headers.map(async header => ({
        ...header,
        value: isSensitiveHeader(header.name)
          ? await this.secrets.get(this.secretKey(draft.id, header.id)) ?? ''
          : header.value,
      })));
      return draft;
    }));
  }

  async save(input: RequestDraft): Promise<void> {
    const draft = cloneDraft(input);
    const existing = this.state.get<RequestDraft[]>(SAVED_REQUESTS_KEY, []);
    const previous = existing.find(item => item.id === draft.id);
    const retainedSecretIds = new Set(
      draft.headers.filter(header => isSensitiveHeader(header.name)).map(header => header.id)
    );
    for (const header of previous?.headers ?? []) {
      if (isSensitiveHeader(header.name) && !retainedSecretIds.has(header.id)) {
        await this.secrets.delete(this.secretKey(draft.id, header.id));
      }
    }
    for (const header of draft.headers) {
      if (isSensitiveHeader(header.name)) {
        await this.secrets.store(this.secretKey(draft.id, header.id), header.value);
        header.value = '';
      }
    }
    draft.sourceLog = undefined;
    const candidates = [draft, ...existing.filter(item => item.id !== draft.id)];
    const next = candidates.slice(0, 100);
    const retainedIds = new Set(next.map(item => item.id));
    for (const removed of candidates.filter(item => !retainedIds.has(item.id))) {
      for (const header of removed.headers) {
        if (isSensitiveHeader(header.name)) {
          await this.secrets.delete(this.secretKey(removed.id, header.id));
        }
      }
    }
    await this.state.update(SAVED_REQUESTS_KEY, next);
  }

  async delete(requestId: string): Promise<void> {
    const requests = await this.list();
    const target = requests.find(item => item.id === requestId);
    for (const header of target?.headers ?? []) {
      if (isSensitiveHeader(header.name)) {
        await this.secrets.delete(this.secretKey(requestId, header.id));
      }
    }
    await this.state.update(
      SAVED_REQUESTS_KEY,
      this.state.get<RequestDraft[]>(SAVED_REQUESTS_KEY, [])
        .filter(item => item.id !== requestId)
    );
  }

  async clear(): Promise<void> {
    const requests = await this.list();
    for (const request of requests) {
      for (const header of request.headers) {
        if (isSensitiveHeader(header.name)) {
          await this.secrets.delete(this.secretKey(request.id, header.id));
        }
      }
    }
    await this.state.update(SAVED_REQUESTS_KEY, undefined);
  }

  private secretKey(requestId: string, headerId: string): string {
    return `${SECRET_PREFIX}${requestId}.${headerId}`;
  }
}

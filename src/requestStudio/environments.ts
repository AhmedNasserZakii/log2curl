import * as vscode from 'vscode';
import {
  cloneDraft,
  EnvironmentVariable,
  RequestDraft,
  RequestEnvironment,
} from './model';

const ENVIRONMENTS_KEY = 'requestStudio.environments.v1';
const ACTIVE_ENVIRONMENT_KEY = 'requestStudio.activeEnvironment.v1';
const SECRET_PREFIX = 'requestStudio.environment.secret.';

type StoredVariable = Omit<EnvironmentVariable, 'value'> & { value?: string };
type StoredEnvironment = Omit<RequestEnvironment, 'variables'> & {
  variables: StoredVariable[];
};

export class EnvironmentStore {
  constructor(
    private readonly state: vscode.Memento,
    private readonly secrets: vscode.SecretStorage
  ) {}

  activeId(): string | undefined {
    return this.state.get<string>(ACTIVE_ENVIRONMENT_KEY);
  }

  async list(): Promise<RequestEnvironment[]> {
    const stored = this.state.get<StoredEnvironment[]>(ENVIRONMENTS_KEY, []);
    return Promise.all(stored.map(async environment => ({
      ...environment,
      variables: await Promise.all(environment.variables.map(async variable => ({
        ...variable,
        value: variable.secret
          ? await this.secrets.get(this.secretKey(environment.id, variable.id)) ?? ''
          : variable.value ?? '',
      }))),
    })));
  }

  async save(environment: RequestEnvironment): Promise<void> {
    const environments = this.state.get<StoredEnvironment[]>(ENVIRONMENTS_KEY, []);
    const previous = environments.find(item => item.id === environment.id);
    const retainedSecretIds = new Set(
      environment.variables.filter(variable => variable.secret).map(variable => variable.id)
    );
    for (const variable of previous?.variables ?? []) {
      if (variable.secret && !retainedSecretIds.has(variable.id)) {
        await this.secrets.delete(this.secretKey(environment.id, variable.id));
      }
    }
    const storedVariables: StoredVariable[] = [];
    for (const variable of environment.variables) {
      if (variable.secret) {
        await this.secrets.store(
          this.secretKey(environment.id, variable.id),
          variable.value
        );
        storedVariables.push({ ...variable, value: undefined });
      } else {
        await this.secrets.delete(this.secretKey(environment.id, variable.id));
        storedVariables.push({ ...variable });
      }
    }
    const stored: StoredEnvironment = { ...environment, variables: storedVariables };
    const next = [
      ...environments.filter(item => item.id !== environment.id),
      stored,
    ];
    await this.state.update(ENVIRONMENTS_KEY, next);
  }

  async delete(environmentId: string): Promise<void> {
    const all = await this.list();
    const target = all.find(environment => environment.id === environmentId);
    for (const variable of target?.variables ?? []) {
      await this.secrets.delete(this.secretKey(environmentId, variable.id));
    }
    await this.state.update(
      ENVIRONMENTS_KEY,
      this.state.get<StoredEnvironment[]>(ENVIRONMENTS_KEY, [])
        .filter(environment => environment.id !== environmentId)
    );
    if (this.activeId() === environmentId) {
      await this.select(undefined);
    }
  }

  async select(environmentId: string | undefined): Promise<void> {
    await this.state.update(ACTIVE_ENVIRONMENT_KEY, environmentId);
  }

  async clear(): Promise<void> {
    const environments = await this.list();
    for (const environment of environments) {
      for (const variable of environment.variables) {
        if (variable.secret) {
          await this.secrets.delete(this.secretKey(environment.id, variable.id));
        }
      }
    }
    await this.state.update(ENVIRONMENTS_KEY, undefined);
    await this.state.update(ACTIVE_ENVIRONMENT_KEY, undefined);
  }

  async resolve(draft: RequestDraft): Promise<RequestDraft> {
    const environments = await this.list();
    const active = environments.find(environment => environment.id === this.activeId());
    if (!active) { return cloneDraft(draft); }
    const values = new Map(
      active.variables
        .filter(variable => variable.enabled)
        .map(variable => [variable.name, variable.value])
    );
    const replace = (value: string) => value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,
      (full, name: string) => values.has(name) ? values.get(name)! : full
    );
    const resolved = cloneDraft(draft);
    resolved.url = replace(resolved.url);
    resolved.query = resolved.query.map(pair => ({
      ...pair,
      name: replace(pair.name),
      value: replace(pair.value),
    }));
    resolved.headers = resolved.headers.map(pair => ({
      ...pair,
      name: replace(pair.name),
      value: replace(pair.value),
    }));
    resolved.body.text = replace(resolved.body.text);
    return resolved;
  }

  private secretKey(environmentId: string, variableId: string): string {
    return `${SECRET_PREFIX}${environmentId}.${variableId}`;
  }
}

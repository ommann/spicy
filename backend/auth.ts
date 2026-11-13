import { randomUUID } from 'node:crypto';
import { getCodexUsage } from './codex-usage.ts';
import { ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';

type Interaction = Parameters<ModelRuntime['login']>[2];
type AuthPrompt = Parameters<Interaction['prompt']>[0];
type AuthEvent = Parameters<Interaction['notify']>[0];
type VisiblePrompt = AuthPrompt & { id: string };
interface LoginFlow {
  controller: AbortController;
  view: { id: string; providerId: string; status: string; events: AuthEvent[]; prompt?: VisiblePrompt; error?: string };
  done?: Promise<void>;
  pending?: { resolve(value: string): void; reject(error: Error): void };
}

// Pi owns OAuth, callback navigation, refresh locking and credential persistence.
// This bridge only carries its interaction messages between Pi and the browser.
export class LoginBridge {
  declare loadRuntime: () => Promise<ModelRuntime>;
  declare loadSettings: () => SettingsManager;
  declare runtimePromise: Promise<ModelRuntime> | undefined;
  declare settings: SettingsManager | undefined;
  declare flow: LoginFlow | undefined;

  constructor(
    loadRuntime = () => ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false }),
    loadSettings = () => SettingsManager.create(process.env.PI_CWD || process.cwd()),
  ) {
    this.loadRuntime = loadRuntime;
    this.loadSettings = loadSettings;
  }

  runtime() {
    this.runtimePromise ||= this.loadRuntime().catch(error => {
      this.runtimePromise = undefined;
      throw error;
    });
    return this.runtimePromise;
  }

  async providers() {
    const runtime = await this.runtime();
    const credentials = await runtime.listCredentials();
    return runtime.getProviders().flatMap(provider => {
      const methods = [];
      if (provider.auth?.oauth) methods.push({ type: 'oauth', name: provider.auth.oauth.name });
      if (provider.auth?.apiKey?.login) methods.push({ type: 'api_key', name: provider.auth.apiKey.name });
      if (!methods.length) return [];
      return [{ id: provider.id, name: provider.name, methods,
        configured: credentials.some(credential => credential.providerId === provider.id) }];
    });
  }

  async codexUsage(signal?: AbortSignal) {
    return getCodexUsage(await this.runtime(), { signal });
  }

  state(): Omit<LoginFlow['view'], 'id' | 'providerId'> & Partial<Pick<LoginFlow['view'], 'id' | 'providerId'>> {
    return this.flow?.view || { status: 'idle', events: [] };
  }

  async start(providerId: string, type: Parameters<ModelRuntime['login']>[1]) {
    const runtime = await this.runtime();
    const provider = runtime.getProvider(providerId);
    const method = type === 'oauth' ? provider?.auth?.oauth : type === 'api_key' ? provider?.auth?.apiKey : undefined;
    if (!method?.login) throw new Error('Unknown provider or unsupported login method');
    if (this.flow?.view.status === 'pending') throw new Error('A login is already in progress');

    const flow: LoginFlow = {
      controller: new AbortController(),
      view: { id: randomUUID(), providerId, status: 'pending', events: [] },
    };
    this.flow = flow;
    flow.done = runtime.login(providerId, type, {
      signal: flow.controller.signal,
      notify: event => { flow.view.events = [...flow.view.events.slice(-19), event]; },
      prompt: prompt => this.prompt(flow, prompt),
    }, {
      agentName: 'spicy',
      getDeviceId: () => {
        this.settings ||= this.loadSettings();
        return this.settings.getOrCreateDeviceId();
      },
    }).then(async () => {
      await this.settings?.flush();
      flow.view.status = 'success';
    }).catch(error => {
      flow.view.status = flow.controller.signal.aborted ? 'cancelled' : 'error';
      if (!flow.controller.signal.aborted) flow.view.error = error.message || 'Login failed';
    }).finally(() => {
      flow.pending?.reject(new Error('Login ended'));
      delete flow.view.prompt;
    });
    return this.state();
  }

  prompt(flow: LoginFlow, prompt: AuthPrompt): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const id = randomUUID();
      const cancel = () => finish(undefined, new Error('Login prompt cancelled'));
      const finish = (value?: string, error?: Error) => {
        flow.controller.signal.removeEventListener('abort', cancel);
        prompt.signal?.removeEventListener('abort', cancel);
        if (flow.view.prompt?.id === id) {
          delete flow.view.prompt;
          delete flow.pending;
        }
        if (error) reject(error);
        else resolve(value!);
      };
      const { signal, ...visible } = prompt;
      flow.view.prompt = { ...visible, id };
      flow.pending = { resolve: value => finish(value), reject: error => finish(undefined, error) };
      flow.controller.signal.addEventListener('abort', cancel, { once: true });
      signal?.addEventListener('abort', cancel, { once: true });
      if (flow.controller.signal.aborted || signal?.aborted) cancel();
    });
  }

  reply(id: string, promptId: string, value: string) {
    const flow = this.flow;
    if (flow?.view.id !== id || !flow.pending || flow.view.prompt?.id !== promptId) {
      throw new Error('This login prompt is no longer active');
    }
    if (typeof value !== 'string') throw new Error('A text response is required');
    if (flow.view.prompt.type === 'select' && !flow.view.prompt.options.some(option => option.id === value)) {
      throw new Error('Invalid login option');
    }
    flow.pending.resolve(value);
    return this.state();
  }

  async cancel(id?: string) {
    if (id !== undefined && this.flow?.view.id !== id) throw new Error('This login is no longer active');
    this.flow?.controller.abort();
    await this.flow?.done;
    return this.state();
  }
}

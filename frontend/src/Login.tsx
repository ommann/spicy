import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import Dialog from './Dialog';
import Input from './Input';
import ScrollArea from './ScrollArea';
import './login.css';
import { api } from './api';

type Provider = { id: string; name: string; configured: boolean; methods: { type: string; name: string }[] };
type LoginEvent = {
  type: string;
  message?: string;
  instructions?: string;
  url?: string;
  userCode?: string;
  verificationUri?: string;
  links?: { url: string; label?: string }[];
};
type Prompt = { id: string; type: string; message: string; placeholder?: string; options?: { id: string; label: string }[] };
type LoginState = { id?: string; status: string; events: LoginEvent[]; prompt?: Prompt; error?: string };
type Props = { ready: Promise<void>; options: NonNullable<Parameters<typeof api.auth.login>[1]> };

export default function Login(props: Props) {
  let dialog!: HTMLDialogElement;
  let controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const [providers, setProviders] = createSignal<Provider[]>([]);
  const [state, setState] = createSignal<LoginState>({ status: 'idle', events: [] });
  const [answer, setAnswer] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const promptId = createMemo(() => state().prompt?.id);
  createEffect(on(promptId, () => setAnswer('')));

  function poll() {
    clearTimeout(timer);
    if (state().status !== 'pending' || !dialog.open) return;
    timer = setTimeout(async () => {
      try {
        setState(await api.auth.state({}, { signal: controller.signal }));
        poll();
      } catch (cause) {
        if (!controller.signal.aborted) setError(String(cause));
      }
    }, 500);
  }

  async function open() {
    controller = new AbortController();
    dialog.showModal();
    setError('');
    setBusy(true);
    try {
      setProviders(await api.auth.providers({}, { signal: controller.signal }));
      setState(await api.auth.state({}, { signal: controller.signal }));
      poll();
    } catch (cause) {
      if (!controller.signal.aborted) setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function begin(providerId: string, type: string) {
    setBusy(true);
    setError('');
    try {
      if (type !== 'oauth' && type !== 'api_key') throw new Error('Unsupported login method');
      await props.ready;
      const next = await api.auth.login({ providerId, type }, props.options);
      if (!dialog.open) {
        await api.auth.cancel({ id: next.id }, props.options);
        return;
      }
      setState(next);
      poll();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function reply(value: string) {
    setBusy(true);
    setError('');
    try {
      const id = state().id;
      const promptId = state().prompt?.id;
      if (!id || !promptId) throw new Error('This login prompt is no longer active');
      await props.ready;
      setState(await api.auth.reply({ id, promptId, value }, props.options));
      poll();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    controller.abort();
    clearTimeout(timer);
    if (state().status === 'pending') {
      const id = state().id;
      void props.ready.then(() => api.auth.cancel({ id }, props.options)).catch(() => {});
    }
    setAnswer('');
    setState({ status: 'idle', events: [] });
  }
  onCleanup(close);

  function link(url?: string) {
    if (url?.startsWith('https://') || url?.startsWith('http://')) return url;
  }

  return <>
    <button onClick={open}>Login</button>
    <Dialog ref={dialog} title="Login" class="chat-dialog login-dialog" onClose={close}>
      <Show when={error()}><p class="chat-error" role="alert">{error()}</p></Show>
      <Show when={state().status !== 'pending'} fallback={<>
        <div class="login-events" aria-live="polite">
          <For each={state().events}>{event => <div>
            <Show when={event.message || event.instructions}><p>{event.message || event.instructions}</p></Show>
            <Show when={event.url || event.verificationUri}><a href={link(event.url || event.verificationUri)} target="_blank" rel="noopener noreferrer">Open login</a></Show>
            <Show when={event.userCode}><p>{event.userCode}</p></Show>
            <For each={event.links}>{item => <a href={link(item.url)} target="_blank" rel="noopener noreferrer">{item.label || item.url}</a>}</For>
          </div>}</For>
        </div>
        <Show when={state().prompt?.id} keyed>{_promptId => {
          const prompt = state().prompt!;
          return <Show when={prompt.type === 'select'} fallback={
          <form onSubmit={event => { event.preventDefault(); void reply(answer()); }}>
            <label>{prompt.message}<Input type={prompt.type === 'secret' ? 'password' : 'text'} value={answer()}
              placeholder={prompt.placeholder} onInput={event => setAnswer(event.currentTarget.value)} required autofocus autocomplete="off" /></label>
            <button disabled={busy()} type="submit">Continue</button>
          </form>
        }>
          <p>{prompt.message}</p>
          <For each={prompt.options}>{option => <button disabled={busy()} onClick={() => reply(option.id)}>{option.label}</button>}</For>
        </Show>;
        }}</Show>
        <p role="status">Waiting for login…</p>
      </>}>
        <Show when={state().status === 'success'}><p role="status">Logged in.</p></Show>
        <Show when={state().error}><p class="chat-error" role="alert">{state().error}</p></Show>
        <ScrollArea class="login-providers" vertical>
          <For each={providers()}>{provider => <For each={provider.methods}>{method =>
            <button disabled={busy()} onClick={() => begin(provider.id, method.type)}>{method.name || provider.name}{provider.configured ? ' — sign in again' : ''}</button>
          }</For>}</For>
        </ScrollArea>
      </Show>
    </Dialog>
  </>;
}

export { createColumnInteraction } from '../src/column-interaction';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';
import SystemPromptRoute from '../src/SystemPromptRoute';
import App from '../src/App';
import SystemPrompts from '../src/SystemPrompts';
import SystemPromptContent from '../src/SystemPromptContent';
import ChatContent from '../src/ChatContent';
import ScrollArea from '../src/ScrollArea';

export function mountScrollArea(root: HTMLElement) {
  return render(() => <ScrollArea vertical><pre>Wide content</pre></ScrollArea>, root);
}

export function mountApp(root: HTMLElement, path = '/') {
  const history = createMemoryHistory();
  history.set({ value: path, replace: true });

  const dispose = render(() => <MemoryRouter root={App} history={history}>
    <Route path="/" component={() => null} />
    <Route path="/system-prompts/:number?" component={SystemPromptRoute} />
  </MemoryRouter>, root);

  return Object.assign(dispose, { history });
}

export function mountPrompts(root: HTMLElement, props: any) {
  return render(() => <SystemPrompts {...props} />, root);
}

export function mountChatContent(root: HTMLElement, entries: any[]) {
  return render(() => <ChatContent entries={entries} />, root);
}

export function mountContent(root: HTMLElement, entry: any) {
  const [expandAll, setExpandAll] = createSignal(false);
  const [current, setCurrent] = createSignal(entry);
  const dispose = render(() => <SystemPromptContent entry={current()} expandAll={expandAll()} />, root);
  return { dispose, setExpandAll, setEntry: setCurrent };
}

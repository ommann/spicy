export { createColumnInteraction } from '../src/column-interaction';
import { createSignal, type JSX } from 'solid-js';
import Input from '../src/Input';
import MessageComposer from '../src/MessageComposer';
import Login from '../src/Login';
import { render } from 'solid-js/web';
import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';
import SystemPromptRoute from '../src/SystemPromptRoute';
import App from '../src/App';
import ChatRoute from '../src/ChatRoute';
import { SessionsRoute } from '../src/Sessions';
import SystemPrompts from '../src/SystemPrompts';
import SystemPromptContent from '../src/SystemPromptContent';
import ChatContent from '../src/ChatContent';
import { TreeCard } from '../src/Conversation';

export function mountStreamingCard(root: HTMLElement, initial: any) {
  const [node, setNode] = createSignal(initial);
  const dispose = render(() => <TreeCard id="stream-test" node={node()} position={{ span: 720, cardLeft: 0, top: 0 }}
    gridStyle={{}} scrollTop={0} promptRowTop={0} width={720}
    registerSection={() => () => {}} onBranch={() => {}} onDismiss={() => {}}
    measure={() => {}} unmeasure={() => {}} />, root);
  return { dispose, setNode };
}
import ScrollArea from '../src/ScrollArea';
import SystemPromptCreator from '../src/SystemPromptCreator';
import { SystemPromptCreatorContext, type PromptDocumentSnapshot, type CreatedPrompt } from '../src/SystemPromptCreatorContext';

export function mountCreator(root: HTMLElement, snapshot: PromptDocumentSnapshot, save: (prompt: Omit<CreatedPrompt, 'id'>) => void) {
  return render(() => <MemoryRouter root={props => <SystemPromptCreatorContext.Provider value={{ load: async () => snapshot, save }}>{props.children}</SystemPromptCreatorContext.Provider>}>
    <Route path="/" component={SystemPromptCreator} />
  </MemoryRouter>, root);
}

export function mountLogin(root: HTMLElement) {
  return render(() => <Login ready={Promise.resolve()} options={{ context: { token: 'test' } }} />, root);
}

export function mountInput(root: HTMLElement, props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [value, setValue] = createSignal('initial');
  const dispose = render(() => <Input {...props} value={value()} />, root);
  return Object.assign(dispose, { setValue });
}

export function mountComposer(root: HTMLElement, onSubmit?: Parameters<typeof MessageComposer>[0]['onSubmit']) {
  const [running, setRunning] = createSignal(false);
  const [health, setHealth] = createSignal<'ready' | 'socket-lost'>('ready');
  const [value, setValue] = createSignal('');
  const [contextUsage, setContextUsage] = createSignal<Parameters<typeof MessageComposer>[0]['contextUsage']>();
  const dispose = render(() => <MessageComposer value={value()} onChange={setValue} running={running()} health={health()} contextUsage={contextUsage()} onSubmit={onSubmit} />, root);
  return Object.assign(dispose, { setRunning, setHealth, setContextUsage });
}

export function mountScrollArea(root: HTMLElement) {
  return render(() => <ScrollArea vertical><pre>Wide content</pre></ScrollArea>, root);
}

export function mountApp(root: HTMLElement, path = '/chat') {
  const history = createMemoryHistory();
  history.set({ value: path, replace: true });

  const dispose = render(() => <MemoryRouter root={App} history={history}>
    <Route path="/" component={SessionsRoute} />
    <Route path="/chat" component={ChatRoute} />
    <Route path="/system-prompts/:id?" component={SystemPromptRoute} />
    <Route path="/system-prompt-creator" component={SystemPromptCreator} />
    <Route path="/:sessionUrlId" component={ChatRoute} />
    <Route path="/:sessionUrlId/system-prompts/:id?" component={SystemPromptRoute} />
    <Route path="/:sessionUrlId/system-prompt-creator" component={SystemPromptCreator} />
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

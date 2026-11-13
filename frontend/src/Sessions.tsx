import { For, Show, createContext, createMemo, createSignal, onCleanup, onMount, useContext, type Component } from 'solid-js';
import Navigation from './Navigation';
import MessageComposer from './MessageComposer';
import Input from './Input';
import AgentHealth from './AgentHealth';
import ScrollArea from './ScrollArea';
import type { Wire } from './types';
import { activityTime, createActivityClock } from './session-activity';
import './sessions.css';

export const SessionsRouteContext = createContext<Component>();
export function SessionsRoute() {
  const View = useContext(SessionsRouteContext);
  return View ? <View /> : null;
}

export default function Sessions(props: {
  load: () => Promise<Wire[]>;
  draft: string;
  onDraft: (value: string) => void;
  projectQuery: string;
  onProjectQuery: (value: string) => void;
  nameQuery: string;
  onNameQuery: (value: string) => void;
  onSubmit: (images?: import('./image-attachments').ImageAttachment[]) => void | boolean | Promise<boolean>;
  onEditPrompt: () => void;
  onOpen: (session: Wire) => void;
  busy: boolean;
  notification: { message: string; isError: boolean };
}) {
  const now = createActivityClock();
  const [sessions, setSessions] = createSignal<Wire[]>([]);
  const [error, setError] = createSignal('');
  onMount(() => {
    let active = true;
    props.load().then(value => { if (active) setSessions(value); })
      .catch(failure => { if (active) setError(String(failure.message || failure)); });
    onCleanup(() => { active = false; });
  });
  const projects = createMemo(() => {
    const groups = new Map<string, Wire[]>();
    const path = props.projectQuery.toLocaleLowerCase();
    const name = props.nameQuery.toLocaleLowerCase();
    for (const session of sessions()) {
      if (!session.cwd.toLocaleLowerCase().includes(path) || !session.name.toLocaleLowerCase().includes(name)) continue;
      const group = groups.get(session.cwd) || [];
      group.push(session);
      groups.set(session.cwd, group);
    }
    return [...groups].map(([path, sessions]) => ({ path, sessions }));
  });
  function activity(session: Wire) {
    if (session.running) return 'running';
    return activityTime(session.modified, now());
  }
  return <div class="sessions-view">
    <Navigation />
    <ScrollArea class="startup-session-scroll" vertical>
    <main class="startup-sessions" aria-label="Sessions">
      <section class="startup-empty-chat" aria-label="New chat">
        <button class="branch-draft system-prompt-reference empty-placeholder" aria-label="Edit system prompt" disabled={props.busy} onClick={() => props.onEditPrompt()}><span>#1</span><AgentHealth placeholder /></button>
        <section class="branch-draft" />
        <MessageComposer value={props.draft} onChange={props.onDraft} onSubmit={props.onSubmit} busy={props.busy} />
      </section>
      <div class="startup-searches">
        <Input class="startup-search" aria-label="Search project paths" placeholder="Project path" value={props.projectQuery} onInput={event => props.onProjectQuery(event.currentTarget.value)} />
        <Input class="startup-search" aria-label="Search session names" placeholder="Session name" value={props.nameQuery} onInput={event => props.onNameQuery(event.currentTarget.value)} />
      </div>
      <Show when={error() || props.notification.isError && props.notification.message}>{message => <p role="alert">{message()}</p>}</Show>
      <For each={projects()}>{project => <section class="startup-project" aria-label={project.path}>
        <h2 class="startup-project-path">{project.path}</h2>
        <div class="startup-session-row">
          <For each={project.sessions}>{session => <button class="startup-session" disabled={props.busy} onClick={() => props.onOpen(session)}>
            <span class="session-name">{session.name}</span>
            <span class="session-activity" classList={{ 'session-running': session.running }}>{activity(session)}</span>
          </button>}</For>
        </div>
      </section>}</For>
    </main>
    </ScrollArea>
  </div>;
}

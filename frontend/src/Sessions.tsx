import { Show, createContext, useContext, type Component, type ComponentProps } from 'solid-js';
import Navigation from './Navigation';
import MessageComposer from './MessageComposer';
import Input from './Input';
import SystemPromptPlaceholder from './SystemPromptPlaceholder';
import ScrollArea from './ScrollArea';
import SessionHistory from './SessionHistory';
import './sessions.css';
import './session-history.css';

export const SessionsRouteContext = createContext<Component>();
export function SessionsRoute() {
  const View = useContext(SessionsRouteContext);
  return <Show when={View} keyed>{Component => <Component />}</Show>;
}

export default function Sessions(props: {
  model?: ComponentProps<typeof SystemPromptPlaceholder>['model'];
  thinking?: ComponentProps<typeof SystemPromptPlaceholder>['thinking'];
  draft: string;
  onDraft: (value: string) => void;
  projectQuery: string;
  onProjectQuery: (value: string) => void;
  onSubmit: (images?: import('./image-attachments').ImageAttachment[]) => void | boolean | Promise<boolean>;
  onEditPrompt: () => void;
  onOptions: () => void;
  busy: boolean;
  notification: { message: string; isError: boolean };
}) {
  return <div class="sessions-view">
    <Navigation options={<button type="button" onClick={props.onOptions}>Options</button>} />
    <ScrollArea class="startup-session-scroll" vertical>
      <main class="startup-sessions" aria-label="Sessions">
        <section class="startup-empty-chat" aria-label="New chat">
          <SystemPromptPlaceholder model={props.model} thinking={props.thinking} onEditPrompt={() => { if (!props.busy) props.onEditPrompt(); }} />
          <section class="branch-draft" />
          <MessageComposer value={props.draft} onChange={props.onDraft} onSubmit={props.onSubmit} busy={props.busy} />
        </section>
        <div class="startup-searches">
          <Input class="startup-search" aria-label="Search project paths" placeholder="Project path" value={props.projectQuery} onInput={event => props.onProjectQuery(event.currentTarget.value)} />
          <Input class="startup-search" aria-label="Search session names" placeholder="Session name" disabled />
        </div>
        <Show when={props.notification.isError && props.notification.message}>{message => <p role="alert">{message()}</p>}</Show>
        <SessionHistory projectQuery={props.projectQuery} />
      </main>
    </ScrollArea>
  </div>;
}

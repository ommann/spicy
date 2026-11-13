import { createSignal } from 'solid-js';
import MessageComposer from './MessageComposer';
import AgentHealth from './AgentHealth';
import Input from './Input';
import Navigation from './Navigation';
import ScrollArea from './ScrollArea';
import HistoryConcept from './HistoryConcept';
import './sessions.css';
import './sessions-concept.css';

export default function SessionsConcept() {
  const [projectQuery, setProjectQuery] = createSignal('');
  const [nameQuery, setNameQuery] = createSignal('');
  const [draft, setDraft] = createSignal('');
  return <div class="sessions-view">
    <Navigation />
    <ScrollArea class="startup-session-scroll" vertical>
      <main class="startup-sessions">
        <section class="startup-empty-chat" aria-label="New chat">
          <button class="branch-draft system-prompt-reference empty-placeholder" aria-label="System prompt" disabled><span>#1</span><AgentHealth placeholder /></button>
          <section class="branch-draft" />
          <MessageComposer value={draft()} onChange={setDraft} onSubmit={() => false} busy={false} />
        </section>
        <div class="startup-searches">
          <Input class="startup-search" aria-label="Search project paths" placeholder="Project path" value={projectQuery()} onInput={event => setProjectQuery(event.currentTarget.value)} />
          <Input class="startup-search" aria-label="Search session names" placeholder="Session name" disabled value={nameQuery()} onInput={event => setNameQuery(event.currentTarget.value)} />
        </div>
        <HistoryConcept projectQuery={projectQuery()} nameQuery={nameQuery()} />
      </main>
    </ScrollArea>
  </div>;
}

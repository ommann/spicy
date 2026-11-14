import { For, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import Navigation from './Navigation';
import { NavigationLinksContext } from './navigation-context';
import MessageComposer from './MessageComposer';
import Input from './Input';
import AgentHealth from './AgentHealth';
import ScrollArea from './ScrollArea';
import './style.css';
import './sessions.css';

// Visual mock only. Sample sessions, not links into real histories.
const projects = [
  { path: '~/Development/spicy', sessions: [
    { name: 'Session URLs & startup page', activity: '2 min ago' },
    { name: 'Independent agent columns', activity: 'running' },
    { name: 'Why is the first reply slower?', activity: '3 hr ago' },
    { name: 'Prompt history & tools', activity: 'yesterday' },
    { name: 'Read through the existing tests first', activity: '3 days ago' },
  ] },
  { path: '~/Development/pi-extensions', sessions: [
    { name: 'Extension cleanup', activity: '2 days ago' },
    { name: 'Resource loading', activity: '3 days ago' },
  ] },
];

const [draft, setDraft] = createSignal('');

render(() => <div class="startup-preview">
  <NavigationLinksContext.Provider value={() => <>
    <button class="tree-title">/home/olli/Development/spicy</button>
    <button>Sessions</button>
    <div class="view-switch" role="group" aria-label="Views">
      <button class="state-toggle" aria-pressed="false">Chat</button>
      <button class="state-toggle" aria-pressed="false">System prompts</button>
      <button class="state-toggle" aria-pressed="false">Editor</button>
    </div>
  </>}>
    <Navigation />
  </NavigationLinksContext.Provider>
  <ScrollArea class="startup-session-scroll" vertical>
  <main class="startup-sessions" aria-label="Sessions — visual mock with sample data">
    <section class="startup-empty-chat" aria-label="New chat">
      <button class="branch-draft system-prompt-reference empty-placeholder" aria-label="Edit system prompt"><span>#1</span><AgentHealth placeholder /></button>
      <section class="branch-draft" />
      <MessageComposer value={draft()} onChange={setDraft} />
    </section>
    <div class="startup-searches">
      <Input class="startup-search" aria-label="Search project paths" placeholder="Project path" />
      <Input class="startup-search" aria-label="Search session names" placeholder="Session name" />
    </div>
    <For each={projects}>{project => <section class="startup-project" aria-label={project.path}>
      <h2 class="startup-project-path">{project.path}</h2>
      <div class="startup-session-row">
        <For each={project.sessions}>{session => <button class="startup-session">
          <span class="session-name">{session.name}</span>
          <span class="session-activity" classList={{ 'session-running': session.activity === 'running' }}>{session.activity}</span>
        </button>}</For>
      </div>
    </section>}</For>
  </main>
  </ScrollArea>
</div>, document.getElementById('root')!);

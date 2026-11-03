import ScrollableTextarea from './ScrollableTextarea';
import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type ParentProps,
} from "solid-js";
import { useLocation, useNavigate } from '@solidjs/router';
import Dialog from './Dialog';
import SelectWithDialog from './SelectWithDialog';
import Conversation, { type ConversationController, type ViewOptions } from './Conversation';
import { createConversationGraph, continuationTarget } from './conversation-model.mjs';
import { applyRecord } from "./stream.mjs";
import { hasCommittedDraft } from "./branch-drafts.mjs";
import { createSystemPromptCatalog } from "./lilim/system-prompts.js";
import { createPromptNumberRegistry, reservePromptNumber } from './prompt-numbers';
import { SystemPromptContext, type PromptVersion } from './SystemPromptRoute';
import type { Snapshot, Wire } from "./types";
import { branchEntries } from './session-entries.mjs';
import ImagePreview, { type PreviewImage } from './ImagePreview';
import Handoffs from './Handoffs';
import { SystemPromptCreatorContext, type CreatedPrompt, type PromptDocumentSnapshot } from './SystemPromptCreatorContext';
import Checkbox from './Checkbox';
import { ToolbarActionsContext } from './ToolbarActions';
import { renderSystemPromptDocument, systemPromptDocumentFromState } from '../../packages/coding-agent/src/core/system-prompt-document';

const empty: Snapshot = {
  entries: [],
  leafId: null,
  state: null,
  live: [],
  dialogs: [],
  connected: false,
  running: false,
  cwd: "",
  diagnostic: "",
};

/** Solid owns session state, navigation, controls, and JSX message content.
 * The pure conversation model retains the established branch geometry.
 * Source text stays source text; syntax highlighting does not render Markdown.
 */
interface DraftBranch {
  id: string;
  sourceId: string;
  anchorId?: string;
  prompt?: { key: string; content: string; sections: Record<string, string> };
  parentId: string | null;
  text?: string;
  sentAt?: number;
}

export default function App(props: ParentProps) {
  const location = useLocation();
  const [toolbarActions, setToolbarActions] = createSignal<HTMLElement>();
  const navigate = useNavigate();
  const showingPrompts = () => location.pathname.startsWith('/system-prompt');
  const openSystemPrompt = (number: number) => navigate(`/system-prompts/${number}`);

  const [snapshot, setSnapshot] = createSignal<Snapshot>(empty);
  const sessionEntries = createMemo(() => snapshot().entries);
  const streamedMessages = createMemo(() => snapshot().live);
  const sessionId = createMemo(() => snapshot().state?.sessionId || '');
  const sessionCwd = createMemo(() => snapshot().cwd);
  const sessionPromptNumbers = createPromptNumberRegistry();
  function promptNumbers() { return sessionPromptNumbers(sessionId()); }
  const sessionLeafId = createMemo(() => snapshot().leafId);

  const [live, setLive] = createSignal(false);
  const [draftBranches, setDraftBranches] = createSignal<Record<string, DraftBranch[]>>({});
  const branchKey = createMemo(() => live() ? `live:${sessionId()}` : '');
  const [focusRequest, setFocusRequest] = createSignal<{ id: string; revision: number }>();

  const [notification, setNotification] = createSignal({ message: "", isError: false });
  const [busy, setBusy] = createSignal(false);
  const [extensionDialogs, setExtensionDialogs] = createSignal<Wire[]>([]);
  const [models, setModels] = createSignal<Wire[]>([]);
  const [previewImage, setPreviewImage] = createSignal<PreviewImage | null>(null);
  const [createdPrompts, setCreatedPrompts] = createSignal<Record<string, CreatedPrompt[]>>((() => {
    try { return JSON.parse(localStorage.getItem('spicy.created-system-prompts') || '{}') || {}; }
    catch { return {}; }
  })());
  function createdPromptEntry(prompt: CreatedPrompt): Wire {
    return { id: prompt.id, systemPromptKey: prompt.id, parentId: null, type: 'message', message: { role: 'system', ...renderSystemPromptDocument(prompt.document, prompt.excludedIds), toolsAdded: prompt.toolsAdded } };
  }
  const [resumeSessions, setResumeSessions] = createSignal<Wire[]>([]);
  const [resumeSearch, setResumeSearch] = createSignal("");
  const filteredResumeSessions = createMemo(() => {
    const query = resumeSearch().trim().toLocaleLowerCase();
    return resumeSessions().filter(session => !query || session.name.toLocaleLowerCase().includes(query));
  });

  let chatDialog!: HTMLDialogElement;
  let resumeDialog!: HTMLDialogElement;
  let optionsDialog!: HTMLDialogElement;
  const [viewOptions, setViewOptions] = createSignal<ViewOptions | null>(null);
  const [codeLinewrap, setCodeLinewrap] = createSignal(false);

  const appLifecycle = new AbortController();
  let token = "";
  let markBridgeReady!: () => void;
  const bridgeReady = new Promise<void>(resolve => { markBridgeReady = resolve; });
  let events: EventSource | undefined;
  let conversation: ConversationController | undefined;

  const actualEntries = createMemo<Wire[]>(() => {
    if (!live()) return [];

    let parentId = sessionLeafId();
    const streaming = streamedMessages().map((message, index) => {
      const id = `stream-${index}`;
      const entry = { type: "message", id, parentId, message };
      parentId = id;
      return entry;
    });

    return [
      { type: "session", cwd: sessionCwd() },
      ...sessionEntries(),
      ...streaming,
    ];
  });

  const viewEntries = createMemo<Wire[]>(() => {
    const actual = actualEntries();
    const drafts = (draftBranches()[branchKey()] || []).filter(draft => !hasCommittedDraft(actual, draft));
    return [...actual, ...drafts.map(draft => ({
      id: draft.id, parentId: draft.parentId, draftSourceId: draft.sourceId, draftAnchorId: draft.anchorId, draftPromptKey: draft.prompt?.key,
      type: draft.text === undefined ? 'branch_draft' : 'message',
      optimistic: true,
      ...(draft.text === undefined ? {} : { message: { role: 'user', content: draft.text, timestamp: draft.sentAt } }),
    }))];
  });

  const systemPrompts = createMemo<PromptVersion[]>((previous = []) => {
    const entries: Wire[] = [...actualEntries()];
    const created = createdPrompts()[sessionId()] || [];
    for (const prompt of created) if (prompt.number && !promptNumbers().has(prompt.id)) promptNumbers().set(prompt.id, prompt.number);
    entries.push(...created.map(createdPromptEntry));
    const versions: PromptVersion[] = createSystemPromptCatalog(entries, promptNumbers()).versions.map((version: PromptVersion) => {
      const saved = created.find(item => item.id === version.key || item.id === version.full?.id);
      return saved ? { ...version, title: saved.title } : version;
    });
    const existing = new Map(previous.map(version => [version.key, version]));
    return versions.map(version => {
      const saved = existing.get(version.key);
      return saved && saved.number === version.number && saved.previousKey === version.previousKey && saved.candidateKey === version.candidateKey ? saved : version;
    });
  }, [], {
    equals: (previous, next) => previous.length === next.length && previous.every((version, index) => version === next[index]),
  });

  const graph = createMemo(() => createConversationGraph(viewEntries(), promptNumbers(), systemPrompts()));

  function createBranch(sourceId: string, anchorId?: string) {
    const source = actualEntries().find(entry => entry.id === sourceId && entry.message?.role === 'user');
    if (!source) return;

    const key = branchKey();
    const drafts = draftBranches()[key] || [];
    const existing = drafts.find(draft => draft.sourceId === sourceId && draft.text === undefined);
    const draft = existing || { id: `draft-${crypto.randomUUID()}`, sourceId, anchorId, parentId: source.parentId };

    batch(() => {
      setDraftBranches(previous => ({ ...previous, [key]: existing ? [...drafts] : [...drafts, draft] }));
      setFocusRequest(previous => ({ id: draft.id, revision: (previous?.revision || 0) + 1 }));
    });
  }

  function selectBranchPrompt(id: string, promptKey?: string) {
    const version = systemPrompts().find(prompt => prompt.key === promptKey);
    const message = version?.full?.message;
    const prompt = version && message ? {
      key: version.key,
      content: typeof message.content === 'string' ? message.content
        : (message.content || []).filter((block: Wire) => block.type === 'text').map((block: Wire) => block.text).join('\n'),
      sections: Object.fromEntries(Object.entries(message.sections || {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    } : undefined;
    const key = branchKey();
    setDraftBranches(previous => ({ ...previous, [key]: (previous[key] || []).map(draft =>
      draft.id === id && draft.text === undefined ? { ...draft, prompt } : draft) }));
  }

  function dismissBranch(id: string) {
    const key = branchKey();
    const draft = (draftBranches()[key] || []).find(item => item.id === id && item.text === undefined);
    if (!draft) return;
    const target = draft.anchorId || graph().activeLeaf?.id;
    batch(() => {
      setDraftBranches(previous => ({ ...previous, [key]: previous[key].filter(item => item.id !== id) }));
      if (target) setFocusRequest(previous => ({ id: target, revision: (previous?.revision || 0) + 1 }));
    });
  }

  async function post(endpoint: string, data: Wire = {}) {
    const response = await fetch(`/api/${endpoint}`, {
      method: "POST",
      signal: appLifecycle.signal,
      headers: { "Content-Type": "application/json", "X-Lilim-Token": token },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (!response.ok) throw new Error(result.error || response.statusText);

    return result;
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);

    try {
      await work();
    } catch (failure) {
      if (appLifecycle.signal.aborted) return;

      const message = failure instanceof Error ? failure.message : String(failure);
      setNotification({ message, isError: true });
    } finally {
      setBusy(false);
    }
  }

  function accept(value: Snapshot) {
    batch(() => {
      setSnapshot(value);
      setExtensionDialogs(value.dialogs || []);
    });
  }

  function openImage(image: PreviewImage) {
    setPreviewImage(image);
  }

  function openOptions() {
    if (!conversation) return;
    setViewOptions(conversation.options());
    optionsDialog.showModal();
  }

  function widthChoices(mode: 'focused' | 'side') {
    const options = viewOptions();
    if (!options) return [];
    const custom = mode === 'focused' && options.focusedFitsWindow ? [] : [options.widths[mode]];
    return [...new Set([...options.presets, ...custom])].sort((a, b) => a - b);
  }

  function changeWidth(mode: 'focused' | 'side', value: string) {
    if (!conversation) return;
    conversation.setModeWidth(mode, value === 'auto' ? 'auto' : Number(value));
    setViewOptions(conversation.options());
  }

  async function openResume() {
    await act(async () => {
      const response = await fetch("/api/sessions?scope=cwd", { signal: appLifecycle.signal });
      if (!response.ok) throw new Error("Could not list chats");
      setResumeSessions(await response.json());
      setResumeSearch("");
      resumeDialog.showModal();
    });
  }

  async function start(sessionId?: string) {
    await act(async () => {
      const result = await post("start", sessionId ? { sessionId } : {});
      accept(result);
      setLive(true);
      chatDialog.close();
      resumeDialog.close();
      const available = await post("command", { type: "get_available_models" });
      setModels(available.models || []);
    });
  }

  async function newSession() {
    if (!snapshot().connected) return start();
    await act(async () => {
      const result = await post("command", { type: "new_session" });
      if (result.cancelled) return;
      setLive(true);
      resumeDialog.close();
      chatDialog.close();
    });
  }

  async function abort() {
    await act(async () => {
      const queue = await post("command", { type: "clear_queue" });
      conversation?.setDraft([...(queue.steering || []), ...(queue.followUp || [])].join('\n'));
      await post("command", { type: "abort" });
    });
  }

  async function send(message: string, leafId: string): Promise<boolean> {
    if (!message.trim() || busy()) return false;
    if (!snapshot().connected) await start();
    if (!snapshot().connected) return false;

    const key = branchKey();
    const draft = (draftBranches()[key] || []).find(item => item.id === leafId);
    const target = !draft && leafId && leafId !== graph().activeLeaf?.id ? continuationTarget(graph(), leafId) : undefined;
    let accepted = false;

    if (draft) setDraftBranches(previous => ({ ...previous, [key]: previous[key].map(item =>
      item.id === draft.id ? { ...item, text: message, sentAt: Date.now() } : item) }));

    await act(async () => {
      try {
        const systemPrompt = { choice: 'current', ...(draft?.prompt ? { selected: draft.prompt } : {}) };
        if (message.trim().startsWith('/')) await post('command', { type: 'prompt', message, systemPrompt });
        else if (draft) await post('branch', { entryId: draft.sourceId, message, systemPrompt });
        else if (target) await post('continue', { entryId: target, message, systemPrompt });
        else await post('command', { type: 'prompt', message, systemPrompt, ...(snapshot().running ? { streamingBehavior: 'steer' } : {}) });
        accepted = true;
      } catch (failure) {
        if (draft) batch(() => {
          setDraftBranches(previous => ({ ...previous, [key]: previous[key].map(item =>
            item.id === draft.id ? { ...item, text: undefined, sentAt: undefined } : item) }));
          setFocusRequest(previous => ({ id: draft.id, revision: (previous?.revision || 0) + 1 }));
        });
        else conversation?.setDraft(message);
        throw failure;
      }
    });

    return accepted;
  }

  createEffect(() => {
    document.title = `Pi — ${live() ? sessionCwd().split('/').filter(Boolean).at(-1) || 'chat' : 'chat'}`;
  });

  onMount(() => {
    act(async () => {
      const response = await fetch("/api/info", { signal: appLifecycle.signal });
      if (!response.ok)
        throw new Error("Could not connect to the local bridge");
      const info = await response.json();
      token = info.token;
      accept(info);
      if (info.connected) setLive(true);
      events = new EventSource("/api/events");
      events.addEventListener("snapshot", (event) =>
        accept(JSON.parse((event as MessageEvent).data)),
      );
      events.addEventListener("record", (event) => {
        const record = JSON.parse((event as MessageEvent).data);
        setSnapshot(previous => {
          const live = applyRecord(previous.live, record);
          const running = record.type === 'agent_start' ? true
            : record.type === 'agent_settled' ? false : previous.running;

          return live === previous.live && running === previous.running ? previous : { ...previous, live, running };
        });
        if (record.type === "extension_ui_request") {
          if (["confirm", "select", "input", "editor"].includes(record.method))
            setExtensionDialogs((previous) => [...previous, record]);
          else if (record.method === "set_editor_text") {
            conversation?.setDraft(record.text || '');
          } else if (record.method === "notify") {
            setNotification({ message: record.message || "", isError: record.notifyType === "error" });
          }
        }
      });
      events.addEventListener("disconnected", (event) => {
        setSnapshot((previous) => ({
          ...previous,
          connected: false,
          running: false,
        }));
        setNotification({ message: JSON.parse((event as MessageEvent).data), isError: true });
      });
      const reconnectingMessage = "Local bridge disconnected; reconnecting…";
      events.onopen = () => setNotification(previous =>
        previous.message === reconnectingMessage ? { message: "", isError: false } : previous);
      events.onerror = () =>
        setNotification({ message: reconnectingMessage, isError: true });
    }).finally(markBridgeReady);
  });
  onCleanup(() => {
    appLifecycle.abort();
    events?.close();
  });

  return (
    <div class="app-settings" style={{
      '--code-white-space': codeLinewrap() ? 'pre-wrap' : 'pre',
      '--code-overflow-wrap': codeLinewrap() ? 'anywhere' : 'normal',
      '--code-content-width': codeLinewrap() ? '100%' : 'max-content',
    }}>
      <header class="tree-toolbar app-toolbar" aria-label="Application navigation">
        <button class="tree-title" onClick={() => chatDialog.showModal()}>{sessionCwd()}</button>
        <button onClick={openResume}>Sessions</button>
        <div class="view-switch" role="group" aria-label="Views">
          <button class="state-toggle" aria-pressed={location.pathname === '/'} onClick={() => navigate('/')}>Chat</button>
          <button class="state-toggle" aria-pressed={location.pathname.startsWith('/system-prompts')} onClick={() => navigate('/system-prompts')}>System prompts</button>
          <button class="state-toggle" aria-pressed={location.pathname === '/system-prompt-creator'} onClick={() => navigate('/system-prompt-creator')}>Editor</button>
        </div>
        <div class="app-toolbar-actions" ref={setToolbarActions} />
      </header>
      <ToolbarActionsContext.Provider value={toolbarActions}>
      <SystemPromptCreatorContext.Provider value={{
        load: async () => {
          await bridgeReady;
          if (!token) throw new Error('Could not connect to the local bridge');
          if (!snapshot().connected) await start();
          const promptSnapshot = await post('command', { type: 'get_system_prompt_document' }) as PromptDocumentSnapshot;
          const current = createSystemPromptCatalog([{ id: 'editor-source', parentId: null, type: 'message',
            message: { role: 'system', ...promptSnapshot.current } }], promptNumbers()).versions[0];
          const sources = [
            ...systemPrompts().filter(version => !version.title).map(version => ({ id: version.key, label: `System Prompt ${version.number}`, document: systemPromptDocumentFromState({ content: version.full?.message?.content || '', sections: version.full?.message?.sections || {} }), toolsAdded: version.full?.message?.toolsAdded || [] })),
            ...(createdPrompts()[sessionId()] || []).map(prompt => ({ ...prompt, label: `System Prompt ${promptNumbers().get(prompt.id)} — ${prompt.title}` })),
          ].filter(source => source.id !== current.key);
          sources.unshift({ id: current.key, label: `System Prompt ${current.number}`, document: promptSnapshot.document, toolsAdded: promptSnapshot.current.toolsAdded || [] });
          return { ...promptSnapshot, sources, currentSourceId: current.key };
        },
        reserveNumber: requested => reservePromptNumber(promptNumbers(), requested),
        save: value => {
          const prompt = { ...value, id: `created-prompt-${crypto.randomUUID()}` };
          if (prompt.number) promptNumbers().set(prompt.id, prompt.number);
          const next = { ...createdPrompts(), [sessionId()]: [...(createdPrompts()[sessionId()] || []), prompt] };
          localStorage.setItem('spicy.created-system-prompts', JSON.stringify(next));
          setCreatedPrompts(next);
          const key = createSystemPromptCatalog([createdPromptEntry(prompt)]).versions[0]?.key;
          const number = systemPrompts().find(version => version.key === key)?.number;
          navigate(`/system-prompts/${number || 1}`);
        },
      }}>
      <SystemPromptContext.Provider value={systemPrompts}>
        <Handoffs sessionKey={branchKey()}>
        <Show when={branchKey() || 'empty'} keyed>{_sessionKey => (
          <Conversation graph={graph()} active={!showingPrompts()}
            running={snapshot().running} busy={busy()} focusRequest={focusRequest()} notification={notification()}
            onReady={value => { conversation = value; }} onSubmit={send} onBranch={createBranch} onDismissBranch={dismissBranch}
            prompts={systemPrompts()} onSelectBranchPrompt={selectBranchPrompt}
            onOpenSystemPrompt={openSystemPrompt} onImage={openImage} onAbort={abort}
            onOptions={openOptions} />
        )}</Show>
        {props.children}
        </Handoffs>
      </SystemPromptContext.Provider>
      </SystemPromptCreatorContext.Provider>
      </ToolbarActionsContext.Provider>
      <Dialog ref={optionsDialog} class="chat-dialog options-dialog" title="Options">
        <For each={['focused', 'side'] as const}>{mode =>
          <label class="width-option">
            <span>{mode === 'focused' ? 'Focused' : 'Side by side'}</span>
            <SelectWithDialog label={`${mode === 'focused' ? 'Focused' : 'Side by side'} width`}
              value={mode === 'focused' && viewOptions()?.focusedFitsWindow ? 'auto' : String(viewOptions()?.widths[mode])}
              options={[
                ...(mode === 'focused' ? [{ value: 'auto', label: 'Fit' }] : []),
                ...widthChoices(mode).map(width => ({ value: String(width), label: `${width}px` })),
              ]}
              onChange={value => changeWidth(mode, value)} />
          </label>
        }</For>
        <label class="width-option">
          <span>Code linewrap</span>
          <Checkbox checked={codeLinewrap()} onChange={event => setCodeLinewrap(event.currentTarget.checked)} />
        </label>
      </Dialog>
      <Dialog
        ref={resumeDialog}
        class="chat-dialog resume-dialog"
        aria-label="Sessions"
      >
        <div class="chat-dialog-heading">
          <span>Sessions</span>
          <button disabled={busy() || snapshot().running} onClick={newSession}>New session</button>
          <button onClick={() => resumeDialog.close()}>Close</button>
        </div>
        <input class="resume-search" aria-label="Search chats" value={resumeSearch()} onInput={event => setResumeSearch(event.currentTarget.value)} />
        <Show
          when={resumeSessions().length}
          fallback={<p>No chats in this directory.</p>}
        >
          <div class="resume-list">
            <For each={filteredResumeSessions()}>
              {(session) => (
                <button disabled={busy()} onClick={() => start(session.id)}>
                  <span class="resume-title">{session.name}</span>
                  <span class="chat-muted">{session.messageCount}</span>
                  <span class="chat-muted resume-age">{relativeAge(session.modified)}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Dialog>
      <Dialog
        ref={chatDialog}
        class="chat-dialog"
        aria-label="Pi chat controls"
      >
        <div class="chat-dialog-heading">
          <span>Pi chat</span>
          <button onClick={() => chatDialog.close()}>Close</button>
        </div>
        <div class="chat-actions">
          <button disabled={busy() || snapshot().running} onClick={newSession}>New session</button>
          <Show when={snapshot().connected}>
                <button disabled={busy()} onClick={abort}>
                  Stop agent
                </button>
                <button
                  disabled={busy()}
                  onClick={() =>
                    act(async () => {
                      await post("stop");
                      chatDialog.close();
                    })
                  }
                >
                  Disconnect
                </button>
          </Show>
        </div>
        <Show when={live() && snapshot().connected}>
          <label>
            Fork from{" "}
            <SelectWithDialog
              label="Fork from user message"
              value=""
              placeholder="Choose message"
              options={branchEntries(viewEntries()).filter(
                (entry: Wire) => entry.message?.role === "user" && !entry.id.startsWith("stream-"),
              ).map((entry: Wire) => ({
                value: entry.id,
                label: typeof entry.message.content === "string" ? entry.message.content.slice(0, 100) : entry.id,
              }))}
              disabled={busy() || snapshot().running}
              onChange={entryId => {
                if (!entryId) return;
                act(async () => {
                  const result = await post("command", {
                    type: "fork",
                    entryId,
                  });
                  if (!result.cancelled) {
                    const response = await fetch('/api/info', { signal: appLifecycle.signal });
                    if (!response.ok) throw new Error('Could not refresh the forked session');
                    accept(await response.json());
                    conversation?.setDraft(result.text || '');
                  }
                  chatDialog.close();
                });
              }}
            />
          </label>
          <Show when={models().length}>
            <label>
              Model{" "}
              <SelectWithDialog
                label="Model"
                disabled={busy() || snapshot().running}
                value={`${snapshot().state?.model?.provider}/${snapshot().state?.model?.id}`}
                options={models().map(model => ({
                  value: `${model.provider}/${model.id}`,
                  label: `${model.provider}/${model.name || model.id}`,
                }))}
                onChange={value => {
                  const model = models().find(model => `${model.provider}/${model.id}` === value);
                  if (model)
                    act(async () => {
                      await post("command", {
                        type: "set_model",
                        provider: model.provider,
                        modelId: model.id,
                      });
                    });
                }}
              />
            </label>
          </Show>
        </Show>
      </Dialog>
      <For each={extensionDialogs()}>
        {(dialog) => (
          <ExtensionDialog
            dialog={dialog}
            reply={(response) =>
              act(async () => {
                await post("ui", { id: dialog.id, ...response });
                setExtensionDialogs((previous) =>
                  previous.filter((item) => item.id !== dialog.id),
                );
              })
            }
          />
        )}
      </For>
      <Show when={previewImage()} keyed>{image => (
        <ImagePreview image={image} onClose={() => setPreviewImage(null)} />
      )}</Show>
    </div>
  );
}

function relativeAge(modified: number) {
  const seconds = Math.max(0, (Date.now() - modified) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return `${Math.floor(seconds / 604800)}w`;
}

function ExtensionDialog(props: {
  dialog: Wire;
  reply: (response: Wire) => void;
}) {
  const [value, setValue] = createSignal(untrack(() => props.dialog.prefill || ""));
  return (
    <Dialog
      open
      class="chat-dialog"
      aria-label={props.dialog.title}
      onCancel={(event) => {
        event.preventDefault();
        props.reply({ cancelled: true });
      }}
    >
      <p>{props.dialog.title}</p>
      <p>{props.dialog.message}</p>
      <Show
        when={props.dialog.method === "select"}
        fallback={
          <Show when={props.dialog.method !== "confirm"}>
            <ScrollableTextarea
              aria-label="Response"
              value={value()}
              onInput={(event) => setValue(event.currentTarget.value)}
            />
          </Show>
        }
      >
        <For each={props.dialog.options}>
          {(option) => (
            <button onClick={() => props.reply({ value: option })}>
              {option}
            </button>
          )}
        </For>
      </Show>
      <Show when={props.dialog.method !== "select"}>
        <button
          onClick={() =>
            props.reply(
              props.dialog.method === "confirm"
                ? { confirmed: true }
                : { value: value() },
            )
          }
        >
          Confirm
        </button>
      </Show>
      <button onClick={() => props.reply({ cancelled: true })}>Cancel</button>
    </Dialog>
  );
}

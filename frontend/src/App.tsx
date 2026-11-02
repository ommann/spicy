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
import { openModal, closeModal, trackModal } from './modal-state';
import Conversation, { type ConversationController, type ViewOptions } from './Conversation';
import { createConversationGraph, continuationTarget } from './conversation-model.mjs';
import { applyRecord } from "./stream.mjs";
import { hasCommittedDraft } from "./branch-drafts.mjs";
import { createSystemPromptCatalog } from "./lilim/system-prompts.js";
import { SystemPromptContext, SystemPromptPolicyContext, type PromptVersion } from './SystemPromptRoute';
import type { Snapshot, Wire } from "./types";
import { branchEntries } from './session-entries.mjs';
import ImagePreview, { type PreviewImage } from './ImagePreview';
import Handoffs from './Handoffs';

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
  parentId: string | null;
  text?: string;
  sentAt?: number;
}

export default function App(props: ParentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const showingPrompts = () => location.pathname.startsWith('/system-prompts');
  const openSystemPrompt = (number: number) => navigate(`/system-prompts/${number}`);

  const [snapshot, setSnapshot] = createSignal<Snapshot>(empty);
  const sessionEntries = createMemo(() => snapshot().entries);
  const streamedMessages = createMemo(() => snapshot().live);
  const sessionId = createMemo(() => snapshot().state?.sessionId || '');
  const sessionCwd = createMemo(() => snapshot().cwd);
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
  const [promptCandidates, setPromptCandidates] = createSignal<Record<string, Wire[]>>({});
  const [pendingPrompt, setPendingPrompt] = createSignal<{ candidate: Wire; message: string; leafId: string; sessionId: string }>();
  const [ignoredPrompts, setIgnoredPrompts] = createSignal<Record<string, boolean>>((() => {
    try { return JSON.parse(localStorage.getItem('spicy.ignored-system-prompts') || '{}') || {}; }
    catch { return {}; }
  })());
  const ignoredPrompt = (key: string) => !!ignoredPrompts()[`${sessionId()}:${key}`];
  function ignorePrompt(key: string, ignored: boolean) {
    setIgnoredPrompts(previous => ({ ...previous, [`${sessionId()}:${key}`]: ignored }));
    try { localStorage.setItem('spicy.ignored-system-prompts', JSON.stringify(ignoredPrompts())); } catch { /* Storage may be unavailable. */ }
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
  let promptDialog!: HTMLDialogElement;
  onMount(() => {
    const dispose = [chatDialog, resumeDialog, optionsDialog, promptDialog].map(trackModal);
    onCleanup(() => dispose.forEach(cleanup => cleanup()));
  });
  const [viewOptions, setViewOptions] = createSignal<ViewOptions | null>(null);
  const [codeLinewrap, setCodeLinewrap] = createSignal(false);

  const appLifecycle = new AbortController();
  let token = "";
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
      id: draft.id, parentId: draft.parentId, draftSourceId: draft.sourceId,
      type: draft.text === undefined ? 'branch_draft' : 'message',
      optimistic: true,
      ...(draft.text === undefined ? {} : { message: { role: 'user', content: draft.text, timestamp: draft.sentAt } }),
    }))];
  });

  const graph = createMemo(() => createConversationGraph(viewEntries()));

  function createBranch(sourceId: string) {
    const source = actualEntries().find(entry => entry.id === sourceId && entry.message?.role === 'user');
    if (!source) return;

    const key = branchKey();
    const drafts = draftBranches()[key] || [];
    const existing = drafts.find(draft => draft.sourceId === sourceId && draft.text === undefined);
    const draft = existing || { id: `draft-${crypto.randomUUID()}`, sourceId, parentId: source.parentId };

    batch(() => {
      setDraftBranches(previous => ({ ...previous, [key]: existing ? [...drafts] : [...drafts, draft] }));
      setFocusRequest(previous => ({ id: draft.id, revision: (previous?.revision || 0) + 1 }));
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

  const systemPrompts = createMemo<PromptVersion[]>((previous = []) => {
    const candidates = promptCandidates()[sessionId()] || [];
    const entries = live() ? [...sessionEntries(), ...candidates.map(candidate => ({
      type: 'message', id: `candidate-${candidate.key}`, parentId: candidate.parentId,
      message: { role: 'system', content: '', sections: candidate.sections },
    }))] : [];
    const versions: PromptVersion[] = createSystemPromptCatalog(entries).versions.map((version: PromptVersion) => {
      const sections = JSON.stringify(version.full?.message?.sections || {});
      const candidate = candidates.find(item => JSON.stringify(item.sections) === sections);
      return candidate ? { ...version, candidateKey: candidate.key } : version;
    });
    const existing = new Map(previous.map(version => [version.key, version]));

    return versions.map(version => {
      const saved = existing.get(version.key);
      return saved && saved.number === version.number && saved.previousKey === version.previousKey && saved.candidateKey === version.candidateKey ? saved : version;
    });
  }, [], {
    equals: (previous, next) => previous.length === next.length && previous.every((version, index) => version === next[index]),
  });

  createEffect(() => {
    const pending = pendingPrompt();
    if (pending && pending.sessionId !== sessionId()) { setPendingPrompt(undefined); return; }
    if (!promptDialog) return;
    if (!pending || showingPrompts() || ignoredPrompt(pending.candidate.key)) closeModal(promptDialog);
    else if (!promptDialog.open) openModal(promptDialog);
  });

  const pendingPromptNumber = () => systemPrompts().find(version => version.candidateKey === pendingPrompt()?.candidate.key)?.number;
  async function choosePrompt(choice: string) {
    const pending = pendingPrompt();
    if (!pending) return;
    closeModal(promptDialog);
    if (await send(pending.message, pending.leafId, choice)) {
      setPendingPrompt(undefined);
      conversation?.setDraft('');
    } else if (pendingPrompt()) setPendingPrompt({ ...pendingPrompt()! });
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

  async function send(message: string, leafId: string, promptChoice?: string): Promise<boolean> {
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
        const systemPrompt = { choice: promptChoice, ignored: Object.keys(ignoredPrompts()).filter(key => key.startsWith(`${sessionId()}:`) && ignoredPrompts()[key]).map(key => key.slice(sessionId().length + 1)) };
        let response: Wire;
        if (message.trim().startsWith('/')) response = await post('command', { type: 'prompt', message, systemPrompt });
        else if (draft) response = await post('branch', { entryId: draft.sourceId, message, systemPrompt });
        else if (target) response = await post('continue', { entryId: target, message, systemPrompt });
        else response = await post('command', { type: 'prompt', message, systemPrompt, ...(snapshot().running ? { streamingBehavior: 'steer' } : {}) });
        if (response.disposition === 'approval_required' && response.candidate) {
          const candidate = response.candidate;
          setPromptCandidates(previous => ({ ...previous, [sessionId()]: [...(previous[sessionId()] || []).filter(item => item.key !== candidate.key), candidate] }));
          if (draft) setDraftBranches(previous => ({ ...previous, [key]: previous[key].map(item => item.id === draft.id ? { ...item, sentAt: undefined } : item) }));
          setPendingPrompt({ candidate, message, leafId, sessionId: sessionId() });
          return;
        }
        setPendingPrompt(undefined);
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
        if (record.type === 'system_prompt_priority') setNotification({ message: record.reason, isError: false });
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
    });
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
      <SystemPromptPolicyContext.Provider value={{ ignored: ignoredPrompt, setIgnored: ignorePrompt }}>
      <SystemPromptContext.Provider value={systemPrompts}>
        <Handoffs sessionKey={branchKey()}>
        <Show when={branchKey() || 'empty'} keyed>{_sessionKey => (
          <Conversation graph={graph()} path={sessionCwd()} active={!showingPrompts()}
            running={snapshot().running} busy={busy()} focusRequest={focusRequest()} notification={notification()}
            onReady={value => { conversation = value; }} onSubmit={send} onBranch={createBranch}
            onOpenSystemPrompt={openSystemPrompt} onImage={openImage} onAbort={abort}
            onResume={openResume} onOptions={openOptions} onChatControls={() => chatDialog.showModal()} />
        )}</Show>
        {props.children}
        </Handoffs>
      </SystemPromptContext.Provider>
      </SystemPromptPolicyContext.Provider>
      <dialog ref={promptDialog} class="chat-dialog" aria-label="New system prompts available">
        <h2>New system prompts available</h2>
        <p>The current branch keeps its accepted prompt unless you choose the new version.</p>
        <button disabled={busy()} onClick={() => void choosePrompt(pendingPrompt()?.candidate.key || '')}>
          Use System Prompt {pendingPromptNumber()}
        </button>
        <button disabled={busy()} onClick={() => void choosePrompt('current')}>Use current System Prompt</button>
        <button onClick={() => closeModal(promptDialog)}>Cancel</button>
        <button onClick={() => { closeModal(promptDialog); openSystemPrompt(pendingPromptNumber() || 1); }}>View system prompts</button>
      </dialog>
      <dialog ref={optionsDialog} class="chat-dialog options-dialog" aria-label="Options">
        <div class="chat-dialog-heading"><span>Options</span><button onClick={() => optionsDialog.close()}>Close</button></div>
        <For each={['focused', 'side'] as const}>{mode =>
          <label class="width-option">
            <span>{mode === 'focused' ? 'Focused' : 'Side by side'}</span>
            <select aria-label={`${mode === 'focused' ? 'Focused' : 'Side by side'} width`}
              value={mode === 'focused' && viewOptions()?.focusedFitsWindow ? 'auto' : String(viewOptions()?.widths[mode])}
              onChange={event => changeWidth(mode, event.currentTarget.value)}>
              <Show when={mode === 'focused'}><option value="auto">Fit</option></Show>
              <For each={widthChoices(mode)}>{width => <option value={String(width)}>{width}px</option>}</For>
            </select>
          </label>
        }</For>
        <label class="width-option tui-checkbox">
          <span>Code linewrap</span>
          <input type="checkbox" checked={codeLinewrap()} onChange={event => setCodeLinewrap(event.currentTarget.checked)} />
          <span class="tui-checkbox-mark" aria-hidden="true">{codeLinewrap() ? '[x]' : '[ ]'}</span>
        </label>
      </dialog>
      <dialog
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
      </dialog>
      <dialog
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
            <select
              aria-label="Fork from user message"
              disabled={busy() || snapshot().running}
              onChange={(event) => {
                const entryId = event.currentTarget.value;
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
            >
              <option value="" />
              <For
                each={branchEntries(viewEntries()).filter(
                  (entry: Wire) =>
                    entry.message?.role === "user" &&
                    !entry.id.startsWith("stream-"),
                )}
              >
                {(entry: Wire) => (
                  <option value={entry.id}>
                    {typeof entry.message.content === "string"
                      ? entry.message.content.slice(0, 100)
                      : entry.id}
                  </option>
                )}
              </For>
            </select>
          </label>
          <Show when={models().length}>
            <label>
              Model{" "}
              <select
                aria-label="Model"
                disabled={busy() || snapshot().running}
                value={`${snapshot().state?.model?.provider}/${snapshot().state?.model?.id}`}
                onChange={(event) => {
                  const model = models().find(
                    (model) =>
                      `${model.provider}/${model.id}` ===
                      event.currentTarget.value,
                  );
                  if (model)
                    act(async () => {
                      await post("command", {
                        type: "set_model",
                        provider: model.provider,
                        modelId: model.id,
                      });
                    });
                }}
              >
                <For each={models()}>
                  {(model) => (
                    <option value={`${model.provider}/${model.id}`}>
                      {model.provider}/{model.name || model.id}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>
        </Show>
      </dialog>
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
  let element!: HTMLDialogElement;
  onMount(() => openModal(element));
  onCleanup(() => closeModal(element));
  return (
    <dialog
      ref={element}
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
    </dialog>
  );
}

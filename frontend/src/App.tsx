import ScrollableTextarea from './ScrollableTextarea';
import Input from './Input';
import Login from './Login';
import { ChatRouteContext } from './ChatRoute';
import Sessions, { SessionsRouteContext } from './Sessions';
import { setViewMode } from './view-mode';
import { sessionPath, sessionUrlIdFromPath, sessionViewPath } from './session-urls';
import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type ParentProps,
} from "solid-js";
import { useLocation, useNavigate } from '@solidjs/router';
import { createStore } from 'solid-js/store';
import Dialog from './Dialog';
import SelectWithDialog from './SelectWithDialog';
import Conversation, { type ConversationController, type ViewOptions } from './Conversation';
import { createConversationGraph, continuationTarget, isUnstartedCompaction, matchConversationLanes } from './conversation-model.mjs';
import { applyRecord } from "./stream.mjs";
import { traceRecord } from './stream-timing';
import { createAgentEvents } from './agent-events.mjs';
import { agentForEntry, agentForLeaf, mergeAgentEntries } from './agent-conversations.mjs';
import { hasCommittedDraft } from "./branch-drafts.mjs";
import { createMemoizedSystemPromptCatalog, createSystemPromptCatalog } from "./system-prompts.js";
import { promptLabel } from './prompt-numbers';
import { SystemPromptContext, type PromptVersion } from './SystemPromptRoute';
import type { Snapshot, Wire } from "./types";
import { branchEntries } from './session-entries.mjs';
import ImagePreview, { type PreviewImage } from './ImagePreview';
import Handoffs from './Handoffs';
import { SystemPromptCreatorContext, type CreatedPrompt, type PromptDocumentSnapshot } from './SystemPromptCreatorContext';
import CodeLinewrapOption from './CodeLinewrapOption';
import StreamingContentOption from './StreamingContentOption';
import ImagePasteOption from './ImagePasteOption';
import SyntaxOptions from './SyntaxOptions';
import { streamingContent } from './streaming-content';
import type { AgentHealthStatus } from './AgentHealth';
import { codeLinewrap } from './code-linewrap';
import { NavigationLinksContext } from './Navigation';
import { SAVED_SYSTEM_PROMPT_ENTRY, type SystemPromptBuilder, systemPromptDocumentFromState, systemPromptOutputMatches, systemPromptBuilderForOutput } from '../../packages/coding-agent/src/core/system-prompt-document';

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
  prompt?: { key: string; content: string; sections: Record<string, string>; promptBuilder?: SystemPromptBuilder };
  parentId: string | null;
  text?: string;
  sentAt?: number;
}

export default function App(props: ParentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const routeSessionId = createMemo(() => sessionUrlIdFromPath(location.pathname));
  const viewPath = () => sessionViewPath(location.pathname);
  const navigateView = (path: string) => navigate(sessionPath(path, snapshot().state?.sessionUrlId || routeSessionId()));
  const openSystemPrompt = (id: string) => navigateView(`/system-prompts/${encodeURIComponent(id)}`);

  let saved: { agents?: string[]; selected?: string } = {};
  try { saved = JSON.parse(window.sessionStorage.getItem('pi-agent-view') || '{}'); } catch { /* Start with an empty selection. */ }
  const [visibleAgentIds, setVisibleAgentIds] = createSignal<string[]>(Array.isArray(saved.agents) ? saved.agents.filter(id => typeof id === 'string') : []);
  const [selectedAgentId, setSelectedAgentId] = createSignal(typeof saved.selected === 'string' ? saved.selected : '');
  const [agentSnapshots, setAgentSnapshots] = createSignal<Record<string, Snapshot>>({});
  const [disconnectedStreams, setDisconnectedStreams] = createSignal<string[]>([]);
  const [bridgeCwd, setBridgeCwd] = createSignal('');
  const [availableAgents, setAvailableAgents] = createSignal<Wire[]>([]);
  const [projectCwd, setProjectCwd] = createSignal('');
  const [sending, setSending] = createSignal<string[]>([]);
  const visibleAgents = createMemo(() => visibleAgentIds().map(id => agentSnapshots()[id]).filter((value): value is Snapshot => !!value));
  const snapshot = createMemo(() => agentSnapshots()[selectedAgentId()] ?? { ...empty, cwd: bridgeCwd() });
  const selectedSessionUrlId = createMemo(() => snapshot().state?.sessionUrlId);
  const sessionEntries = createMemo(() => mergeAgentEntries(visibleAgents().map(agent => ({ ...agent, live: [] }))));
  const sessionCwd = createMemo(() => snapshot().cwd);

  const [live, setLive] = createSignal(false);
  const [draftBranches, setDraftBranches] = createSignal<Record<string, DraftBranch[]>>({});
  const [laneOrigins, setLaneOrigins] = createSignal<Record<string, { draftId: string; baseline: string[] }>>({});
  const branchKey = createMemo(() => live() ? `live:${visibleAgentIds()[0] || 'empty'}` : '');
  const [focusRequest, setFocusRequest] = createSignal<{ id: string; revision: number }>();

  const [notification, setNotification] = createSignal({ message: "", isError: false });
  const [busy, setBusy] = createSignal(false);
  const extensionDialogs = createMemo<Wire[]>(() => visibleAgents().flatMap(agent => agent.dialogs.map(dialog => ({ ...dialog, agentId: agent.agentId! }))));
  const [models, setModels] = createSignal<Wire[]>([]);
  const [previewImage, setPreviewImage] = createSignal<PreviewImage | null>(null);
  const createdPrompts = createMemo<CreatedPrompt[]>(() => sessionEntries()
    .filter(entry => entry.type === 'custom' && entry.customType === SAVED_SYSTEM_PROMPT_ENTRY)
    .map(entry => ({ ...entry.data, id: entry.id })));
  const [homeDraft, setHomeDraft] = createSignal('');
  const [pendingPrompts, setPendingPrompts] = createSignal<Record<string, DraftBranch['prompt']>>({});
  const [projectQuery, setProjectQuery] = createSignal('');
  const [sessionNameQuery, setSessionNameQuery] = createSignal('');
  let homeAgent: Snapshot | undefined;
  const openFocusedChat = () => navigate(sessionPath('/', selectedSessionUrlId()) === '/' ? '/chat' : sessionPath('/', selectedSessionUrlId()));

  let chatDialog!: HTMLDialogElement;
  let optionsDialog!: HTMLDialogElement;
  const [viewOptions, setViewOptions] = createSignal<ViewOptions | null>(null);

  const appLifecycle = new AbortController();
  let token = "";
  let markBridgeReady!: () => void;
  const bridgeReady = new Promise<void>(resolve => { markBridgeReady = resolve; });
  const streams = new Map<string, EventTarget & { close: () => void }>();
  const agentEvents = createAgentEvents({
    onReset: () => {
      const urlId = routeSessionId() || selectedSessionUrlId();
      if (!urlId) return;
      void (async () => {
        const response = await fetch('/api/info', { signal: appLifecycle.signal });
        if (!response.ok) throw new Error('Could not reconnect to the local bridge');
        token = (await response.json()).token;
        await openSessionUrl(urlId, () => appLifecycle.signal.aborted);
      })().catch(reportFailure);
    },
    onError: () => {
      setDisconnectedStreams([...streams.keys()]);
      setNotification({ message: 'Local bridge disconnected; reconnecting…', isError: true });
    },
    onOpen: () => {
      setDisconnectedStreams([]);
      setNotification(previous => previous.message === 'Local bridge disconnected; reconnecting…'
        ? { message: '', isError: false } : previous);
    },
  });
  let conversation: ConversationController | undefined;

  const actualEntries = createMemo<Wire[]>(() => {
    if (!live()) return [];

    const agents = visibleAgents().map(agent => ({ ...agent, streamUserOnly: !streamingContent() }));
    return [{ type: 'session', cwd: sessionCwd() }, ...mergeAgentEntries(agents, laneOrigins())];
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

  const promptCatalog = createMemoizedSystemPromptCatalog();
  const systemPrompts = createMemo<PromptVersion[]>((previous = []) => {
    const entries: Wire[] = [...actualEntries()];
    const created = createdPrompts();
    const versions: PromptVersion[] = promptCatalog(entries).versions.map((version: PromptVersion) => {
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

  const graph = createMemo(() => {
    const value = createConversationGraph(viewEntries(), systemPrompts());
    const agent = agentSnapshots()[selectedAgentId()];
    const selected = agent && value.leaves.find((leaf: Wire) => agentForLeaf(value, [agent], leaf.id));
    if (selected) value.activeLeaf = selected;
    return value;
  });

  const composerStates = new Map<string, {
    drafts: Record<string, string>; setDraft: (key: string, text: string) => void; lanes: Wire[];
  }>();
  const composerScope = createMemo(() => JSON.stringify([
    branchKey(), agentSnapshots()[visibleAgentIds()[0]]?.state?.sessionId || '',
  ]));
  const composerState = createMemo(() => {
    const scope = composerScope();
    let state = composerStates.get(scope);
    if (!state) {
      const [drafts, setDraft] = createStore<Record<string, string>>({});
      state = { drafts, setDraft, lanes: [] };
      composerStates.set(scope, state);
    }
    return state;
  });
  const composerLanes = createMemo(() => {
    const state = composerState();
    return state.lanes = matchConversationLanes(graph(), state.lanes);
  });

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
      promptBuilder: message.promptBuilder,
    } : undefined;
    if (isUnstartedCompaction(graph(), id)) {
      setPendingPrompts(previous => ({ ...previous, [id]: prompt }));
      return;
    }
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
      headers: { "Content-Type": "application/json", "X-Spicy-Token": token },
      body: JSON.stringify({ ...(selectedAgentId() ? { agentId: selectedAgentId() } : {}), ...data }),
    });

    const result = await response.json();

    if (!response.ok) throw new Error(result.error || response.statusText);

    return result;
  }

  function reportFailure(failure: unknown) {
    if (appLifecycle.signal.aborted) return;
    const message = failure instanceof Error ? failure.message : String(failure);
    setNotification({ message, isError: true });
  }

  async function requestLogin(endpoint: string, data?: Record<string, unknown>) {
    await bridgeReady;
    return post(endpoint, data);
  }

  function accept(value: Snapshot) {
    if (value.agentId) {
      setAgentSnapshots(previous => ({ ...previous, [value.agentId!]: value }));
      if (value.connected) watchAgent(value.agentId);
    }
  }

  function updateAgent(id: string, update: (previous: Snapshot) => Snapshot) {
    setAgentSnapshots(previous => previous[id] ? { ...previous, [id]: update(previous[id]) } : previous);
  }

  function infoUrl(id = selectedAgentId()) {
    return `/api/info?agentId=${encodeURIComponent(id)}`;
  }

  function watchAgent(id: string) {
    if (streams.has(id)) return;
    const events: EventTarget & { close: () => void } = agentEvents.watch(id);
    streams.set(id, events);
    events.addEventListener('snapshot', event => accept(JSON.parse((event as MessageEvent).data)));
    events.addEventListener('record', event => {
      const record = JSON.parse((event as MessageEvent).data);
      const finishTiming = traceRecord(id, record);
      updateAgent(id, previous => {
        const live = record.type === 'history_root' ? [] : applyRecord(previous.live, record);
        const generating = record.type === 'agent_start' ? true : record.type === 'agent_settled' ? false
          : previous.generating ?? (previous.running && !previous.compacting);
        const compacting = record.type === 'compaction_start' ? true : record.type === 'compaction_end' ? false : !!previous.compacting;
        const running = generating || compacting;
        const dialogs = record.type === 'extension_ui_request' && ['confirm', 'select', 'input', 'editor'].includes(record.method)
          ? [...previous.dialogs.filter(dialog => dialog.id !== record.id), record] : previous.dialogs;
        const providerConnection = record.type === 'provider_connection' ? record.state : previous.providerConnection;
        return { ...previous, live, running, generating, compacting, dialogs, providerConnection,
          ...(record.type === 'history_root' ? { entries: record.entries, leafId: record.leafId } : {}),
        };
      });
      if (record.type === 'history_root' && id === selectedAgentId()) {
        setFocusRequest(previous => ({ id: record.rootId, revision: (previous?.revision || 0) + 1 }));
      }
      if (record.type === 'compaction_end' && record.errorMessage) setNotification({ message: record.errorMessage, isError: true });
      if (record.type === 'auto_retry_start') setNotification({ message: `Connection failed. Retrying in ${Math.ceil(record.delayMs / 1000)} seconds…`, isError: true });
      if (record.type === 'auto_retry_end') setNotification({ message: record.success ? '' : record.finalError || 'Reply failed.', isError: !record.success });
      if (record.type === 'extension_ui_request') {
        if (record.method === 'set_editor_text' && id === selectedAgentId()) conversation?.setDraft(record.text || '');
        if (record.method === 'notify') setNotification({ message: record.message || '', isError: record.notifyType === 'error' });
      }
      finishTiming();
    });
    events.addEventListener('disconnected', event => {
      updateAgent(id, previous => ({ ...previous, connected: false, running: false, dialogs: [], connectionError: JSON.parse((event as MessageEvent).data) }));
      setNotification({ message: JSON.parse((event as MessageEvent).data), isError: true });
    });
  }

  function showAgent(value: Snapshot & { relatedAgents?: Snapshot[] }, replace: boolean) {
    const views = [value, ...(value.relatedAgents || [])];
    const ids = views.map(agent => agent.agentId!);
    batch(() => {
      for (const agent of views) accept(agent);
      setSelectedAgentId(value.agentId!);
      setVisibleAgentIds(previous => replace ? ids : [...new Set([...previous, ...ids])]);
      setLive(true);
      const target = graph().ancestors(value.leafId).find((id: string) => graph().nodes.has(id));
      if (replace && target) setFocusRequest(previous => ({ id: target, revision: (previous?.revision || 0) + 1 }));
    });
    if (replace) for (const [id, stream] of streams) {
      if (!ids.includes(id)) { stream.close(); streams.delete(id); }
    }
  }

  async function openChat() {
    setProjectCwd(sessionCwd());
    chatDialog.showModal();
    setBusy(true);
    try {
      const response = await fetch('/api/agents', { signal: appLifecycle.signal });
      if (!response.ok) throw new Error('Could not list agents');
      setAvailableAgents(await response.json());
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  async function chooseAgent(id: string) {
    setBusy(true);
    try {
      const response = await fetch(infoUrl(id), { signal: appLifecycle.signal });
      if (!response.ok) throw new Error('Could not load the agent');
      const info = await response.json();
      const value = info.state?.sessionUrlId ? await post('agents', { sessionUrlId: info.state.sessionUrlId }) : info;
      showAgent(value, true);
      setModels([]);
      if (value.connected) {
        const available = await post('command', { agentId: id, type: 'get_available_models' });
        setModels(available.models || []);
      }
      chatDialog.close();
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  createEffect(() => {
    try { window.sessionStorage.setItem('pi-agent-view', JSON.stringify({ agents: visibleAgentIds(), selected: selectedAgentId() })); }
    catch { /* The selection still works when browser storage is unavailable. */ }
  });

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

  async function loadHomeSessions() {
    await bridgeReady;
    const response = await fetch('/api/sessions?scope=all', { signal: appLifecycle.signal });
    if (!response.ok) throw new Error('Could not list sessions');
    const sessions: Wire[] = await response.json();
    const listed = await fetch('/api/agents', { signal: appLifecycle.signal });
    if (!listed.ok) throw new Error('Could not list agents');
    const agents: Wire[] = await listed.json();
    return sessions.map(session => ({ ...session, running: agents.some(agent =>
      agent.running && session.urlId && agent.state?.sessionUrlId === session.urlId) }));
  }

  async function prepareHomeChat() {
    await bridgeReady;
    if (!homeAgent) homeAgent = await post('agents', { cwd: sessionCwd() || bridgeCwd() });
    return homeAgent!;
  }

  async function sendHomeChat(images: import('./image-attachments').ImageAttachment[] = []) {
    const message = homeDraft();
    if (busy() || (!message.trim() && !images.length)) return false;
    setBusy(true);
    try {
      const agent = await prepareHomeChat();
      await post('command', { agentId: agent.agentId, type: 'prompt', message, images, systemPrompt: { choice: 'current' } });
      showAgent(agent, true);
      homeAgent = undefined;
      if (homeDraft() === message) setHomeDraft('');
      setNotification({ message: '', isError: false });
      setViewMode('focused');
      openFocusedChat();
      return true;
    } catch (failure) { reportFailure(failure); return false; }
    finally { setBusy(false); }
  }

  async function editHomePrompt() {
    if (busy()) return;
    setBusy(true);
    try {
      const agent = await prepareHomeChat();
      showAgent(agent, true);
      navigateView('/system-prompt-creator');
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  async function openHomeSession(session: Wire) {
    if (busy()) return;
    setBusy(true);
    try {
      const agent = await post('agents', { openSessionId: session.id });
      showAgent(agent, true);
      setViewMode('focused');
      openFocusedChat();
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  async function start(sessionId?: string, cwd = sessionCwd()) {
    await bridgeReady;
    setBusy(true);
    try {
      const result = await post('agents', { ...(cwd ? { cwd } : {}), ...(sessionId ? { sessionId } : {}) });
      showAgent(result, true);
      chatDialog.close();
      const available = await post('command', { agentId: result.agentId, type: 'get_available_models' });
      setModels(available.models || []);
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  async function newSession() { await start(); }

  function leafAgent(leafId: string) {
    return agentForLeaf(graph(), visibleAgents(), leafId, selectedAgentId()) as Snapshot | undefined;
  }

  function agentHealth(leafId: string): AgentHealthStatus {
    const agent = leafAgent(leafId);
    if (agent && disconnectedStreams().includes(agent.agentId!)) return 'disconnected';
    if (agent?.connectionError) return 'error';
    if (!agent?.connected) return 'inactive';
    return agent.providerConnection || 'ready';
  }

  function focusLeaf(leafId: string) {
    const agent = leafAgent(leafId);
    if (agent?.agentId) setSelectedAgentId(agent.agentId);
  }

  function leafBusy(leafId: string) {
    return sending().includes(leafId) || sending().includes(leafAgent(leafId)?.agentId || '');
  }

  async function abort(leafId?: string) {
    const id = leafId ? leafAgent(leafId)?.agentId : selectedAgentId();
    if (!id) return;
    setBusy(true);
    try {
      const queue = await post('command', { agentId: id, type: 'clear_queue' });
      if (id === selectedAgentId()) conversation?.setDraft([...(queue.steering || []), ...(queue.followUp || [])].join('\n'));
      await post('command', { agentId: id, type: 'abort' });
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  async function forkFromEntry(entryId: string) {
    if (!entryId) return;
    const agentId = selectedAgentId();
    setBusy(true);
    try {
      const result = await post('command', { type: 'fork', agentId, entryId });
      if (!result.cancelled) {
        const response = await fetch(infoUrl(agentId), { signal: appLifecycle.signal });
        if (!response.ok) throw new Error('Could not refresh the forked session');
        accept(await response.json());
        conversation?.setDraft(result.text || '');
      }
      chatDialog.close();
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  async function selectModel(value: string) {
    const model = models().find(model => `${model.provider}/${model.id}` === value);
    if (!model) return;
    setBusy(true);
    try {
      await post('command', { type: 'set_model', provider: model.provider, modelId: model.id });
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  async function replyToDialog(dialog: Wire, response: Wire) {
    const { agentId, id } = dialog;
    setBusy(true);
    try {
      await post('ui', { agentId, id, ...response });
      updateAgent(agentId, previous => ({ ...previous, dialogs: previous.dialogs.filter(item => item.id !== id) }));
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  async function send(message: string, leafId: string, images: import('./image-attachments').ImageAttachment[] = []): Promise<boolean> {
    if ((!message.trim() && !images.length) || leafBusy(leafId)) return false;
    const originatingConversation = conversation;
    if (!selectedAgentId()) {
      setSending(previous => [...previous, leafId]);
      await start();
      if (!selectedAgentId()) {
        setSending(previous => previous.filter(id => id !== leafId));
        return false;
      }
    }

    const key = branchKey();
    const compact = /^\/compact(?:\s|$)/.test(message.trim());
    const draft = (draftBranches()[key] || []).find(item => item.id === leafId);
    let agent = !draft ? leafAgent(leafId) : undefined;
    const target = !draft && !agent && leafId !== 'empty-chat-draft' ? continuationTarget(graph(), leafId) : undefined;
    if (!draft && !target && !agent) agent = snapshot();
    let accepted = false;
    let sendingAgentId = agent?.agentId;
    setSending(previous => [...previous, leafId, ...(sendingAgentId ? [sendingAgentId] : [])]);

    if (draft && !compact) setDraftBranches(previous => ({ ...previous, [key]: previous[key].map(item =>
      item.id === draft.id ? { ...item, text: message, sentAt: Date.now() } : item) }));

    try {
      if (draft || target) {
        const entryId = draft?.sourceId || target;
        const source = agentForEntry(visibleAgents(), entryId, selectedAgentId());
        if (!source) throw new Error('Could not find the source agent for this branch');
        agent = await post('agents', { sourceAgentId: source.agentId, entryId });
        if (draft) setLaneOrigins(previous => ({ ...previous, [agent!.agentId!]: { draftId: draft.id, baseline: agent!.entries.map(entry => entry.id) } }));
        if (branchKey() === key) showAgent(agent!, false);
        sendingAgentId = agent!.agentId;
        setSending(previous => [...previous, sendingAgentId!]);
      }
      if (!agent?.agentId) throw new Error('No agent selected');
      if (!agent.connected) {
        watchAgent(agent.agentId);
        agent = await post('start', { agentId: agent.agentId });
        accept(agent!);
      }
      if (!agent?.agentId) throw new Error('Agent did not start');
      if (compact) {
        const result = await post('command', { agentId: agent.agentId, type: 'compact',
          customInstructions: message.trim().slice('/compact'.length).trim() || undefined });
        accept(result.snapshot);
        const targetId = graph().ancestors(result.snapshot.leafId).find((id: string) => graph().nodes.has(id));
        if (targetId) setFocusRequest(previous => ({ id: targetId, revision: (previous?.revision || 0) + 1 }));
        if (draft) setDraftBranches(previous => ({ ...previous, [key]: previous[key].filter(item => item.id !== draft.id) }));
      } else {
        const prompt = draft?.prompt ?? pendingPrompts()[leafId];
        const systemPrompt = { choice: 'current', ...(prompt ? { selected: prompt } : {}) };
        await post('command', { agentId: agent.agentId, type: 'prompt', message, images, systemPrompt,
          ...(agent.running ? { streamingBehavior: 'steer' } : {}) });
      }
      accepted = true;
    } catch (failure) {
      if (draft) batch(() => {
        setDraftBranches(previous => ({ ...previous, [key]: previous[key].map(item =>
          item.id === draft.id ? { ...item, text: undefined, sentAt: undefined } : item) }));
        setFocusRequest(previous => ({ id: draft.id, revision: (previous?.revision || 0) + 1 }));
      });
      if (!draft && branchKey() === key && selectedAgentId() === agent?.agentId && conversation !== originatingConversation) conversation?.setDraft(message);
      if (!appLifecycle.signal.aborted) setNotification({ message: failure instanceof Error ? failure.message : String(failure), isError: true });
    } finally {
      setSending(previous => previous.filter(id => id !== leafId && id !== sendingAgentId));
    }

    return accepted;
  }

  createEffect(() => {
    document.title = `${live() ? sessionCwd().split('/').filter(Boolean).at(-1) || 'chat' : 'chat'} — Spicy`;
  });

  async function openSessionUrl(urlId: string, isCancelled: () => boolean) {
    setBusy(true);
    try {
      const value = await post('agents', { sessionUrlId: urlId }) as Snapshot;
      if (!isCancelled()) showAgent(value, true);
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  const [sessionRoutingReady, setSessionRoutingReady] = createSignal(false);
  createEffect(on([sessionRoutingReady, routeSessionId], ([ready, urlId]) => {
    if (!ready || !urlId || snapshot().state?.sessionUrlId === urlId) return;
    let cancelled = false;
    onCleanup(() => { cancelled = true; });
    void openSessionUrl(urlId, () => cancelled);
  }));
  createEffect(on([sessionRoutingReady, selectedSessionUrlId], ([ready, urlId]) => {
    if (!ready || !urlId || location.pathname === '/' || routeSessionId() === urlId) return;
    navigate(sessionPath(viewPath() === '/chat' ? '/' : location.pathname, urlId) + location.search, { replace: !routeSessionId() });
  }));

  async function restoreBridge() {
    setBusy(true);
    try {
      const response = await fetch('/api/info', { signal: appLifecycle.signal });
      if (!response.ok) throw new Error('Could not connect to the local bridge');
      const info = await response.json();
      token = info.token;
      setBridgeCwd(info.cwd);
      const listed = await fetch('/api/agents', { signal: appLifecycle.signal });
      if (!listed.ok) throw new Error('Could not list agents');
      const agents: Wire[] = await listed.json();
      setAvailableAgents(agents);
      // A copied link takes precedence over the tab's previous agent selection.
      if (routeSessionId()) {
        setVisibleAgentIds([]);
        setSelectedAgentId('');
        return;
      }
      const ids = visibleAgentIds().filter(id => agents.some(agent => agent.agentId === id));
      setVisibleAgentIds(ids);
      if (!ids.includes(selectedAgentId())) setSelectedAgentId(ids[0] || '');
      const pending = [];
      for (const id of ids) {
        pending.push(fetch(infoUrl(id), { signal: appLifecycle.signal }).then(async response => {
          if (!response.ok) throw new Error('Could not restore the selected agent');
          accept(await response.json());
        }));
      }
      await Promise.all(pending);
      if (ids.length) setLive(true);
    } catch (failure) { reportFailure(failure); }
    finally {
      setBusy(false);
      markBridgeReady();
      setSessionRoutingReady(true);
    }
  }
  onMount(() => { void restoreBridge(); });
  onCleanup(() => {
    appLifecycle.abort();
    agentEvents.close();
    streams.clear();
  });

  return (
    <div class="app-settings" style={{
      '--code-white-space': codeLinewrap() ? 'pre-wrap' : 'pre',
      '--code-overflow-wrap': codeLinewrap() ? 'anywhere' : 'normal',
      '--code-content-width': codeLinewrap() ? '100%' : 'max-content',
    }}>
      <NavigationLinksContext.Provider value={() => <>
        <button class="tree-title" onClick={openChat}>{sessionCwd()}</button>
        <div class="view-switch" role="group" aria-label="Views">
          <button class="state-toggle" aria-pressed={location.pathname === '/'} onClick={() => navigate('/')}>Sessions</button>
          <button class="state-toggle" aria-pressed={location.pathname !== '/' && (viewPath() === '/' || viewPath() === '/chat')} onClick={openFocusedChat}>Chat</button>
          <button class="state-toggle" aria-pressed={viewPath().startsWith('/system-prompts')} onClick={() => navigateView('/system-prompts')}>System prompts</button>
          <button class="state-toggle" aria-pressed={viewPath() === '/system-prompt-creator'} onClick={() => navigateView('/system-prompt-creator')}>Editor</button>
        </div>
        <Login request={requestLogin} />
      </>}>
      <SystemPromptCreatorContext.Provider value={{
        load: async () => {
          await bridgeReady;
          if (!token) throw new Error('Could not connect to the local bridge');
          if (!snapshot().connected) {
            if (selectedAgentId()) accept(await post('start'));
            else await start();
          }
          const promptSnapshot = await post('command', { type: 'get_system_prompt_document' }) as PromptDocumentSnapshot;
          const current = createSystemPromptCatalog([{ id: 'editor-source', parentId: null, type: 'message',
            message: { role: 'system', ...promptSnapshot.current } }]).versions[0];
          const sources = [
            ...systemPrompts().filter(version => !version.title).map(version => {
              const message = version.full?.message;
              const builder = message?.promptBuilder ? systemPromptBuilderForOutput(message.promptBuilder, message) : undefined;
              return { id: version.key, label: promptLabel(version.number),
                document: builder?.document ?? systemPromptDocumentFromState({ content: message?.content || '', sections: message?.sections || {} }),
                excludedIds: builder?.excludedIds, toolsAdded: message?.toolsAdded || [],
                diagnostic: builder
                  ? (systemPromptOutputMatches(builder, { content: message?.content || '', sections: message?.sections })
                    ? undefined : 'Builder output differs from the saved prompt.')
                  : 'Original Builder data is missing. Loaded the saved text.' };
            }),
            ...createdPrompts().map(prompt => ({ ...prompt,
              label: promptLabel(systemPrompts().find(version => version.key === prompt.id)!.number, prompt.title),
              diagnostic: systemPromptOutputMatches(prompt, prompt.output) ? undefined : 'Builder output differs from the saved prompt.',
            })),
          ].filter(source => source.id !== current.key);
          sources.unshift({ id: current.key, label: promptLabel(systemPrompts().find(version => version.key === current.key)?.number ?? systemPrompts().length + 1), document: promptSnapshot.document, excludedIds: promptSnapshot.excludedIds, toolsAdded: promptSnapshot.current.toolsAdded || [], diagnostic: promptSnapshot.diagnostic });
          return { ...promptSnapshot, sources, currentSourceId: current.key };
        },
        save: async value => {
          const prompt = await post('command', { type: 'save_system_prompt', prompt: value }) as CreatedPrompt;
          const response = await fetch(infoUrl(), { signal: appLifecycle.signal });
          if (!response.ok) throw new Error('Could not reload the saved prompt');
          accept(await response.json());
          openSystemPrompt(prompt.id);
        },
      }}>
      <SystemPromptContext.Provider value={systemPrompts}>
        <Handoffs sessionKey={branchKey()}>
        <SessionsRouteContext.Provider value={() => <Sessions load={loadHomeSessions}
          draft={homeDraft()} onDraft={setHomeDraft} projectQuery={projectQuery()} onProjectQuery={setProjectQuery}
          nameQuery={sessionNameQuery()} onNameQuery={setSessionNameQuery} onSubmit={sendHomeChat}
          onEditPrompt={editHomePrompt} onOpen={openHomeSession} busy={busy()} notification={notification()} />}>
        <ChatRouteContext.Provider value={() => {
          onCleanup(() => { conversation = undefined; });
          return <Show when={composerScope()} keyed>{_sessionKey => (
          <Conversation graph={graph()} active lanes={composerLanes()}
            drafts={composerState().drafts} onDraftChange={composerState().setDraft}
            running={id => !!leafAgent(id)?.running} health={agentHealth} busy={leafBusy} onFocusLeaf={focusLeaf} focusRequest={focusRequest()} notification={notification()}
            onReady={value => { conversation = value; }} onSubmit={send} onBranch={createBranch} onDismissBranch={dismissBranch}
            prompts={systemPrompts()} onSelectBranchPrompt={selectBranchPrompt} pendingPromptKey={id => pendingPrompts()[id]?.key}
            onOpenSystemPrompt={openSystemPrompt} onImage={openImage} onAbort={abort}
            onOptions={openOptions} />
        )}</Show>;
        }}>
          {props.children}
        </ChatRouteContext.Provider>
        </SessionsRouteContext.Provider>
        </Handoffs>
      </SystemPromptContext.Provider>
      </SystemPromptCreatorContext.Provider>
      </NavigationLinksContext.Provider>
      <Dialog ref={optionsDialog} class="chat-dialog options-dialog" title="Options">
        <For each={['focused', 'side'] as const}>{mode =>
          <label class="width-option">
            <span>{mode === 'focused' ? 'Single' : 'Tree'}</span>
            <SelectWithDialog label={`${mode === 'focused' ? 'Single' : 'Tree'} width`}
              value={mode === 'focused' && viewOptions()?.focusedFitsWindow ? 'auto' : String(viewOptions()?.widths[mode])}
              options={[
                ...(mode === 'focused' ? [{ value: 'auto', label: 'Fit' }] : []),
                ...widthChoices(mode).map(width => ({ value: String(width), label: `${width}px` })),
              ]}
              onChange={value => changeWidth(mode, value)} />
          </label>
        }</For>
        <CodeLinewrapOption />
        <StreamingContentOption />
        <ImagePasteOption />
        <SyntaxOptions />
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
        <label>Agent
          <SelectWithDialog label="Agent" value={selectedAgentId()} placeholder="Choose a running agent"
            options={availableAgents().map(agent => ({ value: agent.agentId,
              label: `${agent.cwd} — ${agent.agentId.slice(0, 8)}${agent.running ? ' (working)' : agent.connected ? '' : ' (disconnected)'}` }))}
            disabled={busy()} onChange={chooseAgent} />
        </label>
        <label>Project directory
          <Input aria-label="Project directory" value={projectCwd()} onInput={event => setProjectCwd(event.currentTarget.value)} />
        </label>
        <div class="chat-actions">
          <button disabled={busy() || !projectCwd().trim()} onClick={() => start(undefined, projectCwd().trim())}>Open project</button>
          <button disabled={busy()} onClick={newSession}>New session</button>
          <Show when={snapshot().connected}>
                <button disabled={busy()} onClick={() => abort()}>
                  Stop agent
                </button>
                <button
                  disabled={busy()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await post("stop");
                      chatDialog.close();
                    } catch (failure) { reportFailure(failure); }
                    finally { setBusy(false); }
                  }}
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
              onChange={forkFromEntry}
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
                onChange={selectModel}
              />
            </label>
          </Show>
        </Show>
      </Dialog>
      <For each={extensionDialogs()}>
        {(dialog) => (
          <ExtensionDialog
            dialog={dialog}
            reply={response => { void replyToDialog(dialog, response); }}
          />
        )}
      </For>
      <Show when={previewImage()} keyed>{image => (
        <ImagePreview image={image} onClose={() => setPreviewImage(null)} />
      )}</Show>
    </div>
  );
}

function ExtensionDialog(props: {
  dialog: Wire;
  reply: (response: Wire) => void;
}) {
  const [editedValue, setValue] = createSignal<string>();
  const value = () => editedValue() ?? props.dialog.prefill ?? '';
  createEffect(on(() => props.dialog.id, () => setValue(undefined)));
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

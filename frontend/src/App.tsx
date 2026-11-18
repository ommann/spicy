import { loadUiOptions } from './ui-options';
import { inheritedBranchModel, inheritedThinkingLevel, type BranchModel } from './branch-model';
import ScrollableTextarea from './ScrollableTextarea';
import { FileLinkCwdContext } from './file-link';
import Input from './Input';
import Login from './Login';
import { ChatRouteContext } from './ChatRoute';
import Sessions, { SessionsRouteContext } from './Sessions';
import ScrollArea from './ScrollArea';
import { chatViewPath, setViewMode } from './view-mode';
import { Dynamic } from 'solid-js/web';
import { createConversationViewState, type ConversationViewState } from './conversation-view-state';
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
import { A, useLocation, useNavigate } from '@solidjs/router';
import { createStore } from 'solid-js/store';
import Dialog from './Dialog';
import SelectWithDialog from './SelectWithDialog';
import { type ConversationController, type ViewOptions } from './Conversation';
import SingleConversation from './SingleConversation';
import TreeConversation from './TreeConversation';
import { createConversationGraph, continuationTarget, isUnstartedCompaction, matchConversationLanes, type ConversationLane } from './conversation-model.ts';
import { applyRecord } from "./stream.ts";
import { traceRecord } from './stream-timing';
import { createAgentEvents } from './agent-events.ts';
import { agentForEntry, agentForLeaf, mergeAgentEntries } from './agent-conversations.ts';
import { hasCommittedDraft } from "./branch-drafts.ts";
import { createMemoizedSystemPromptCatalog, createSystemPromptCatalog } from "./system-prompts.ts";
import { promptLabel } from './prompt-numbers';
import { SystemPromptContext, type PromptVersion } from './SystemPromptRoute';
import type { Snapshot, Wire } from "./types";
import ImagePreview, { type PreviewImage } from './ImagePreview';
import ToolApps from './ToolApps';
import { api, type UiReply } from './api';
import { SystemPromptCreatorContext, type CreatedPrompt, type PromptDocumentSnapshot } from './SystemPromptCreatorContext';
import CodeLinewrapOption from './CodeLinewrapOption';
import StreamingContentOption from './StreamingContentOption';
import ThinkingOptions from './ThinkingOptions';
import HiddenBranchesOption from './HiddenBranchesOption';
import { parseCompactionCommand } from './compaction-command.ts';
import { parseBashCommand } from './bash-command.ts';
import { transferBranchLabel } from './branch-labels';
import { createBranchVisibility, showOnlyHiddenBranches } from './branch-visibility';
import { filterConversationBranches } from './branch-visibility-model.ts';
import ChatToolbar from './ChatToolbar';
import ImagePasteOption from './ImagePasteOption';
import SyntaxOptions from './SyntaxOptions';
import CursorOption from './CursorOption';
import { chatArrowCursor } from './chat-cursor';
import { streamingContent } from './streaming-content';
import type { AgentHealthStatus } from './AgentHealth';
import { codeLinewrap } from './code-linewrap';
import { NavigationLinksContext } from './navigation-context';
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
type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
interface DraftBranch {
  id: string;
  sourceId: string;
  anchorId?: string;
  prompt?: { key: string; content: string; sections: Record<string, string>; promptBuilder?: SystemPromptBuilder };
  parentId: string | null;
  thinkingLevel?: string;
  model?: { provider: string; id: string; name?: string };
  text?: string;
  sentAt?: number;
}

export default function App(props: ParentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const routeSessionId = createMemo(() => sessionUrlIdFromPath(location.pathname));
  const viewPath = () => sessionViewPath(location.pathname);
  const [treeId, setTreeId] = createSignal<string>();
  const viewHref = (path: string) => sessionPath(path, routeSessionId(), treeId());
  const navigateView = (path: string) => navigate(viewHref(path));
  const openSystemPrompt = (id: string) => navigateView(`/system-prompts/${encodeURIComponent(id)}`);

  const [visibleAgentIds, setVisibleAgentIds] = createSignal<string[]>([]);
  const [selectedAgentId, setSelectedAgentId] = createSignal('');
  const [agentSnapshots, setAgentSnapshots] = createSignal<Record<string, Snapshot>>({});
  const [disconnectedStreams, setDisconnectedStreams] = createSignal<string[]>([]);
  const [bridgeCwd, setBridgeCwd] = createSignal('');
  const [availableAgents, setAvailableAgents] = createSignal<Wire[]>([]);
  const [projectCwd, setProjectCwd] = createSignal('');
  const [homeCwd, setHomeCwd] = createSignal('');
  const [recentProjects, setRecentProjects] = createSignal<string[]>([]);
  const projectPaths = () => [...new Set([bridgeCwd(), ...recentProjects(), ...availableAgents().map(agent => agent.cwd)])]
    .filter(cwd => cwd && cwd.toLowerCase().includes(projectCwd().trim().toLowerCase()));
  function chooseProject(cwd: string) {
    if (isSessionsPage()) {
      setHomeCwd(cwd);
      homeAgent = undefined;
      chatDialog.close();
    } else void start(undefined, cwd);
  }
  const isSessionsPage = () => location.pathname === '/' || viewPath() === '/sessions';
  const displayedCwd = () => isSessionsPage() ? homeCwd() || bridgeCwd() : sessionCwd();
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
  let homeAgent: Snapshot | undefined;
  let homeAgentPending: Promise<Snapshot> | undefined;
  const [homeModel, setHomeModel] = createSignal<Wire>();
  const [homeThinking, setHomeThinking] = createSignal('');
  const [homeInitialModel, setHomeInitialModel] = createSignal<Wire>();
  const [homeInitialThinking, setHomeInitialThinking] = createSignal('');
  const modelOptions = () => models().map(model => ({ value: `${model.provider}/${model.id}`, label: `${model.provider}/${model.name || model.id}` }));
  function thinkingOptions(model?: Wire) {
    const levels = model?.thinkingLevelMap ? Object.keys(model.thinkingLevelMap).filter(level => model.thinkingLevelMap[level] !== null)
      : model?.reasoning ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : [];
    return levels.map(value => ({ value, label: value }));
  }
  function branchThinking(id: string) {
    const draft = (draftBranches()[branchKey()] || []).find(item => item.id === id);
    const selected = branchModel(id);
    return { value: draft?.thinkingLevel ?? selected?.thinkingLevel ?? '', label: draft?.thinkingLevel ?? selected?.thinkingLevel, options: thinkingOptions(models().find(model => model.provider === selected?.provider && model.id === selected?.id)),
      onChange: (value: string) => setDraftBranches(previous => ({ ...previous, [branchKey()]: (previous[branchKey()] || []).map(item => item.id === id ? { ...item, thinkingLevel: value || undefined } : item) })) };
  }
  async function loadHomeModels() {
    try {
      await bridgeReady;
      const selection = await api.auth.modelSelection({}, rpcOptions);
      setModels([...(selection.models || [])]);
      setHomeInitialModel(selection.model);
      setHomeInitialThinking(selection.thinkingLevel);
      setHomeModel(previous => previous ?? selection.model);
    } catch (failure) { reportFailure(failure); }
  }
  const openFocusedChat = () => navigate(sessionPath(chatViewPath(), selectedSessionUrlId(), treeId()));

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
        token = (await api.info({}, { signal: appLifecycle.signal })).token;
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
    drafts: Record<string, string>; setDraft: (key: string, text: string) => void; lanes: ConversationLane[]; view: ConversationViewState;
  }>();
  const composerScope = createMemo(() => JSON.stringify([
    branchKey(), agentSnapshots()[visibleAgentIds()[0]]?.state?.sessionId || '',
  ]));
  const composerState = createMemo(() => {
    const scope = composerScope();
    let state = composerStates.get(scope);
    if (!state) {
      const [drafts, setDraft] = createStore<Record<string, string>>({});
      state = { drafts, setDraft, lanes: [], view: createConversationViewState() };
      composerStates.set(scope, state);
    }
    return state;
  });
  const visibility = createBranchVisibility(reportFailure);
  const composerLanes = createMemo<ConversationLane[]>(() => {
    const state = composerState();
    const next = matchConversationLanes(graph(), state.lanes);
    visibility.follow(state.lanes, next);
    return state.lanes = next;
  });
  const shownLanes = createMemo(() => composerLanes().filter(lane => visibility.hiddenLeaves().has(lane.leafId) === showOnlyHiddenBranches()));
  const shownGraph = createMemo(() => filterConversationBranches(graph(), shownLanes().map(lane => lane.leafId)));

  function createBranch(sourceId: string, anchorId?: string) {
    const source = actualEntries().find(entry => entry.id === sourceId && entry.message?.role === 'user');
    if (!source) return;

    const sourceAgent = agentForEntry(visibleAgents(), sourceId, selectedAgentId());
    setModels([]);
    const availableModels = sourceAgent?.connected
      ? api.command({ agentId: sourceAgent.agentId, type: 'get_available_models' }, rpcOptions).then(available => available.models || [])
      : api.auth.models({});
    void availableModels.then(setModels).catch(reportFailure);
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

  const rpcOptions = {
    signal: appLifecycle.signal,
    context: { get token() { return token; } },
  };

  function reportFailure(failure: unknown) {
    if (appLifecycle.signal.aborted) return;
    const message = failure instanceof Error ? failure.message : String(failure);
    setNotification({ message, isError: true });
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

  function loadInfo(id = selectedAgentId()) {
    return api.info({ agentId: id || undefined }, { signal: appLifecycle.signal });
  }

  function watchAgent(id: string) {
    if (streams.has(id)) return;
    const events: EventTarget & { close: () => void } = agentEvents.watch(id);
    streams.set(id, events);
    events.addEventListener('snapshot', event => accept(JSON.parse((event as MessageEvent).data)));
    events.addEventListener('record', event => {
      const record = JSON.parse((event as MessageEvent).data);
      const finishTiming = traceRecord(id, record);
      const labelSource = record.type === 'history_root'
        ? composerLanes().find(lane => leafAgent(lane.leafId)?.agentId === id)?.key
        : undefined;
      updateAgent(id, previous => {
        const live = record.type === 'history_root' ? [] : applyRecord(previous.live, record);
        const generating = record.type === 'agent_start' ? true : record.type === 'agent_settled' ? false
          : previous.generating ?? (previous.running && !previous.compacting);
        const compacting = record.type === 'compaction_start' ? true : record.type === 'compaction_end' ? false : !!previous.compacting;
        const shellRunning = record.type === 'bash_execution_start' ? true : record.type === 'bash_execution_end' ? false : !!previous.shellRunning;
        const running = generating || compacting || shellRunning;
        const dialogs = record.type === 'extension_ui_request' && ['confirm', 'select', 'input', 'editor'].includes(record.method)
          ? [...previous.dialogs.filter(dialog => dialog.id !== record.id), record] : previous.dialogs;
        const providerConnection = record.type === 'provider_connection' ? record.state : previous.providerConnection;
        return { ...previous, live, running, generating, compacting, shellRunning, dialogs, providerConnection,
          ...(record.type === 'history_root' ? { entries: record.entries, leafId: record.leafId } : {}),
          ...(record.type === 'context_usage' ? { state: { ...previous.state, contextUsage: record.usage } } : {}),
        };
      });
      if (labelSource) {
        const destination = composerLanes().find(lane => lane.path.includes(record.rootId));
        if (destination) {
          void transferBranchLabel(labelSource, destination.key).catch(() => {
            setNotification({ message: 'Could not transfer the branch label.', isError: true });
          });
        }
      }
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

  function showAgent(value: Snapshot & { relatedAgents?: Snapshot[]; treeId?: string; familyOrder?: string[] }, replace: boolean) {
    if (value.treeId || replace) setTreeId(value.treeId || value.state?.sessionUrlId);
    const order = value.familyOrder || [];
    const views = [value, ...(value.relatedAgents || [])].sort((a, b) =>
      order.indexOf(a.state?.sessionFile || '') - order.indexOf(b.state?.sessionFile || ''));
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
    setProjectCwd('');
    chatDialog.showModal();
    const folderInput = chatDialog.querySelector<HTMLInputElement>('[aria-label="Project directory"]');
    folderInput?.focus();
    folderInput?.select();
    setBusy(true);
    try {
      setAvailableAgents(await api.agents.list({}, { signal: appLifecycle.signal }));
      const sessions = await api.sessions({ scope: 'all' }, { signal: appLifecycle.signal });
      setRecentProjects([...new Set(sessions.map(session => session.cwd))]);
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  async function chooseAgent(id: string) {
    setBusy(true);
    try {
      const info = await loadInfo(id);
      const value = info.state?.sessionUrlId ? await api.agents.create({ sessionUrlId: info.state.sessionUrlId }, rpcOptions) : info;
      showAgent(value, true);
      setModels([]);
      if (value.connected) {
        const available = await api.command({ agentId: id, type: 'get_available_models' }, rpcOptions);
        setModels(available.models || []);
      }
      chatDialog.close();
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  function openImage(image: PreviewImage) {
    setPreviewImage(image);
  }

  function openOptions() {
    setViewOptions(conversation?.options() ?? null);
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

  async function prepareHomeChat() {
    await bridgeReady;
    if (!homeAgent) {
      homeAgentPending ??= api.agents.create({ cwd: homeCwd() || bridgeCwd() }, rpcOptions);
      try { homeAgent = await homeAgentPending; }
      finally { homeAgentPending = undefined; }
    }
    return homeAgent;
  }

  async function sendHomeChat(images: import('./image-attachments').ImageAttachment[] = []) {
    const message = homeDraft();
    if (busy() || (!message.trim() && !images.length)) return false;
    setBusy(true);
    try {
      const bash = parseBashCommand(message, images.length > 0);
      const agent = await prepareHomeChat();
      if (!bash && homeModel()) await api.command({ agentId: agent.agentId, type: 'set_model', provider: homeModel()!.provider, modelId: homeModel()!.id }, rpcOptions);
      if (!bash && homeThinking()) await api.command({ agentId: agent.agentId, type: 'set_thinking_level', level: homeThinking() as ThinkingLevel }, rpcOptions);
      if (bash) {
        showAgent(agent, true);
        setViewMode('focused');
        openFocusedChat();
      }
      const result = await api.command({ agentId: agent.agentId, ...(bash ?? { type: 'prompt', message, images, systemPrompt: { choice: 'current' } }) }, rpcOptions);
      showAgent(bash ? result.snapshot : agent, true);
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
      navigate(sessionPath('/system-prompt-creator', agent.state?.sessionUrlId));
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  async function start(sessionId?: string, cwd = sessionCwd()) {
    await bridgeReady;
    setBusy(true);
    try {
      const result = await api.agents.create({ ...(cwd ? { cwd } : {}), ...(sessionId ? { sessionId } : {}) }, rpcOptions);
      showAgent(result, true);
      chatDialog.close();
      const available = await api.command({ agentId: result.agentId, type: 'get_available_models' }, rpcOptions);
      setModels(available.models || []);
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

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

  function leafBusy(leafId: string) {
    return sending().includes(leafId) || sending().includes(leafAgent(leafId)?.agentId || '');
  }

  async function abort(leafId?: string) {
    const id = leafId ? leafAgent(leafId)?.agentId : selectedAgentId();
    if (!id) return;
    setBusy(true);
    try {
      const queue = await api.command({ agentId: id, type: 'clear_queue' }, rpcOptions);
      if (id === selectedAgentId()) conversation?.setDraft([...(queue.steering || []), ...(queue.followUp || [])].join('\n'));
      await api.command({ agentId: id, type: 'abort_bash' }, rpcOptions);
      await api.command({ agentId: id, type: 'abort' }, rpcOptions);
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  function branchModel(id: string): BranchModel | undefined {
    const draft = (draftBranches()[branchKey()] || []).find(item => item.id === id);
    const parentId = draft ? draft.parentId : id;
    const model = draft?.model ?? inheritedBranchModel(actualEntries(), parentId);
    return model ? { ...model, thinkingLevel: draft?.thinkingLevel ?? inheritedThinkingLevel(actualEntries(), parentId) } : undefined;
  }

  function selectBranchModel(id: string, value: string) {
    const model = models().find(item => `${item.provider}/${item.id}` === value);
    const key = branchKey();
    setDraftBranches(previous => ({ ...previous, [key]: (previous[key] || []).map(draft =>
      draft.id === id && draft.text === undefined ? { ...draft, thinkingLevel: undefined, model: model ? { provider: model.provider, id: model.id, name: model.name } : undefined } : draft) }));
  }

  async function replyToDialog(dialog: Wire, response: UiReply) {
    const { agentId, id } = dialog;
    setBusy(true);
    try {
      await api.ui({ agentId, id, ...response }, rpcOptions);
      updateAgent(agentId, previous => ({ ...previous, dialogs: previous.dialogs.filter(item => item.id !== id) }));
    } catch (failure) { reportFailure(failure); }
    finally { setBusy(false); }
  }

  async function send(message: string, leafId: string, images: import('./image-attachments').ImageAttachment[] = []): Promise<boolean> {
    if (message.trim() === '/hide') {
      const lane = composerLanes().find(lane => lane.leafId === leafId);
      if (lane) {
        composerState().setDraft(lane.key, '');
        visibility.toggle(leafId);
      }
      // No prompt or attachments were sent. Keep this column's attachments.
      return false;
    }
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
      const bash = parseBashCommand(message, images.length > 0);
      const compaction = parseCompactionCommand(message);
      if (draft || target) {
        const entryId = draft?.sourceId || target;
        if (!entryId) throw new Error('Could not find the source entry for this branch');
        const source = agentForEntry(visibleAgents(), entryId, selectedAgentId());
        if (!source) throw new Error('Could not find the source agent for this branch');
        agent = await api.agents.create({ sourceAgentId: source.agentId, entryId }, rpcOptions);
        if (draft) setLaneOrigins(previous => ({ ...previous, [agent!.agentId!]: { draftId: draft.id, baseline: agent!.entries.map(entry => entry.id) } }));
        if (branchKey() === key) showAgent(agent!, false);
        sendingAgentId = agent!.agentId;
        setSending(previous => [...previous, sendingAgentId!]);
      }
      if (!agent?.agentId) throw new Error('No agent selected');
      if (!agent.connected) {
        watchAgent(agent.agentId);
        agent = await api.start({ agentId: agent.agentId }, rpcOptions);
        accept(agent!);
      }
      if (!agent?.agentId) throw new Error('Agent did not start');
      if (bash) {
        const result = await api.command({ agentId: agent.agentId, ...bash }, rpcOptions);
        accept(result.snapshot);
        if (draft) setDraftBranches(previous => ({ ...previous, [key]: previous[key].filter(item => item.id !== draft.id) }));
      } else if (compaction) {
        const result = await api.command({ agentId: agent.agentId, type: 'compact', ...compaction }, rpcOptions);
        accept(result.snapshot);
        const targetId = graph().ancestors(result.snapshot.leafId).find((id: string) => graph().nodes.has(id));
        if (targetId) setFocusRequest(previous => ({ id: targetId, revision: (previous?.revision || 0) + 1 }));
        if (draft) setDraftBranches(previous => ({ ...previous, [key]: previous[key].filter(item => item.id !== draft.id) }));
      } else {
        if (draft?.model) {
          await api.command({ agentId: agent.agentId, type: 'set_model', provider: draft.model.provider, modelId: draft.model.id }, rpcOptions);
        }
        if (draft?.thinkingLevel) await api.command({ agentId: agent.agentId, type: 'set_thinking_level', level: draft.thinkingLevel as ThinkingLevel }, rpcOptions);
        const prompt = draft?.prompt ?? pendingPrompts()[leafId];
        const systemPrompt = { choice: 'current', ...(prompt ? { selected: prompt } : {}) };
        await api.command({ agentId: agent.agentId, type: 'prompt', message, images, systemPrompt,
          ...(agent.running ? { streamingBehavior: 'steer' } : {}) }, rpcOptions);
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
      const value = await api.agents.create({ sessionUrlId: urlId }, rpcOptions);
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

  createEffect(() => {
    const urlId = selectedSessionUrlId();
    const rootId = treeId();
    if (!sessionRoutingReady() || !rootId || !urlId || routeSessionId() !== urlId) return;
    if (viewPath() !== '/tree') return;
    const canonical = sessionPath('/tree', urlId, rootId);
    if (location.pathname !== canonical) navigate(canonical + location.search, { replace: true });
  });

  async function restoreBridge() {
    setBusy(true);
    try {
      const info = await api.info({}, { signal: appLifecycle.signal });
      token = info.token;
      setBridgeCwd(info.cwd);
      const agents = await api.agents.list({}, { signal: appLifecycle.signal });
      setAvailableAgents(agents);
      if (location.pathname === '/') {
        const sessions = await api.sessions({ scope: 'all' }, { signal: appLifecycle.signal });
        const latest = sessions.filter(session => session.urlId).sort((a, b) => b.modified - a.modified)[0];
        if (latest?.urlId && location.pathname === '/') navigate(`/b/${latest.urlId}`, { replace: true });
      }
    } catch (failure) { reportFailure(failure); }
    finally {
      setBusy(false);
      markBridgeReady();
      setSessionRoutingReady(true);
    }
  }
  onMount(() => {
    void loadUiOptions().catch(reportFailure);
    void restoreBridge();
  });
  onCleanup(() => {
    appLifecycle.abort();
    agentEvents.close();
    streams.clear();
  });

  return (
    <div class="app-settings" classList={{ 'chat-arrow-cursor': chatArrowCursor() }} style={{
      '--code-white-space': codeLinewrap() ? 'pre-wrap' : 'pre',
      '--code-overflow-wrap': codeLinewrap() ? 'anywhere' : 'normal',
      '--code-content-width': codeLinewrap() ? '100%' : 'max-content',
    }}>
      <NavigationLinksContext.Provider value={(navigation, controls) => <>
        <Show when={isSessionsPage()} fallback={<span class="tree-title">{sessionCwd()}</span>}>
          <button class="tree-title" onClick={openChat}>{displayedCwd()}</button>
        </Show>
        <div class="app-toolbar-right">
        <div class="app-toolbar-controls">
          <Login ready={bridgeReady} options={rpcOptions} />
          {controls}
        </div>
        <div class="view-switch" role="group" aria-label="Views">
          <A class="state-toggle" href={routeSessionId() ? viewHref('/sessions') : '/'} aria-current={isSessionsPage() ? 'page' : undefined}>Sessions</A>
          <For each={[
            { label: 'S-Prompts', path: '/system-prompts', active: () => viewPath().startsWith('/system-prompts') },
            { label: 'Editor', path: '/system-prompt-creator', active: () => viewPath() === '/system-prompt-creator' },
            { label: 'Single', path: '/single', active: () => viewPath() === '/single' },
            { label: 'Tree', path: '/tree', active: () => viewPath() === '/tree' },
          ]}>{item => <Show when={routeSessionId()} fallback={<span class="state-toggle" aria-disabled="true">{item.label}</span>}>
            <A class="state-toggle" href={viewHref(item.path)} aria-current={item.active() ? 'page' : undefined}
              onClick={() => { if (item.path === '/single' || item.path === '/tree') setViewMode(item.path === '/single' ? 'focused' : 'side'); }}>{item.label}</A>
          </Show>}</For>
          {navigation}
        </div>
        </div>
      </>}>
      <SystemPromptCreatorContext.Provider value={{
        load: async () => {
          await bridgeReady;
          if (!token) throw new Error('Could not connect to the local bridge');
          if (!snapshot().connected) {
            if (selectedAgentId()) accept(await api.start({ agentId: selectedAgentId() || undefined }, rpcOptions));
            else await start();
          }
          const promptSnapshot = await api.command({ agentId: selectedAgentId() || undefined, type: 'get_system_prompt_document' }, rpcOptions) as PromptDocumentSnapshot;
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
          const prompt = await api.command({ agentId: selectedAgentId() || undefined, type: 'save_system_prompt', prompt: value }, rpcOptions) as CreatedPrompt;
          accept(await loadInfo());
          openSystemPrompt(prompt.id);
        },
      }}>
      <FileLinkCwdContext.Provider value={sessionCwd}>
      <SystemPromptContext.Provider value={systemPrompts}>
        <ToolApps sessionKey={branchKey()}>
        <SessionsRouteContext.Provider value={() => { onMount(() => { void loadHomeModels(); }); return <Sessions
          model={{ label: homeModel()?.name || homeModel()?.id || '...', value: homeModel() ? `${homeModel()!.provider}/${homeModel()!.id}` : '', leadingOption: { value: '', label: homeInitialModel()?.name || homeInitialModel()?.id || '...' }, options: modelOptions(), onOpen: () => { void loadHomeModels(); }, onChange: value => { setHomeModel(models().find(model => `${model.provider}/${model.id}` === value)); setHomeThinking(''); } }}
          thinking={{ value: homeThinking() || homeInitialThinking(), options: thinkingOptions(homeModel()), onChange: setHomeThinking }}
          draft={homeDraft()} onDraft={setHomeDraft} projectQuery={projectQuery()} onProjectQuery={setProjectQuery}
          onSubmit={sendHomeChat}
          onEditPrompt={editHomePrompt} onOptions={openOptions} busy={busy()} notification={notification()} />; }}>
        <ChatRouteContext.Provider value={route => {
          onCleanup(() => { conversation = undefined; });
          return <Show when={composerScope()} keyed>{_sessionKey => (
          <Show when={selectedSessionUrlId() && (!routeSessionId() || selectedSessionUrlId() === routeSessionId()) && shownLanes().length} fallback={
            <div class="spicy-host" classList={{ 'single-mode': route.mode === 'focused' }}>
              <ChatToolbar active mode={route.mode} notification={notification()} onOptions={openOptions}
                modeHref={mode => viewHref(chatViewPath(mode))}
                onModeLink={setViewMode} onMode={mode => { setViewMode(mode); navigateView(chatViewPath(mode)); }} />
            </div>
          }>
          <Dynamic component={route.mode === 'focused' ? SingleConversation : TreeConversation}
            graph={shownGraph()} active lanes={shownLanes()} viewState={composerState().view}
            modeHref={mode => viewHref(chatViewPath(mode))}
            onMode={mode => navigateView(chatViewPath(mode))}
            drafts={composerState().drafts} onDraftChange={composerState().setDraft}
            running={id => !!leafAgent(id)?.running} health={agentHealth} contextUsage={id => leafAgent(id)?.state?.contextUsage} busy={leafBusy} focusRequest={focusRequest()} notification={notification()}
            onReady={value => { conversation = value; }} onSubmit={send} onBranch={createBranch} onDismissBranch={dismissBranch}
            prompts={systemPrompts()} onSelectBranchPrompt={selectBranchPrompt} pendingPromptKey={id => pendingPrompts()[id]?.key}
            model={branchModel} modelOptions={modelOptions()} thinkingSelection={branchThinking}
            inheritedModel={id => {
              const draft = (draftBranches()[branchKey()] || []).find(item => item.id === id);
              return inheritedBranchModel(actualEntries(), draft ? draft.parentId : id);
            }}
            pendingModelKey={id => {
              const model = (draftBranches()[branchKey()] || []).find(draft => draft.id === id)?.model;
              return model ? `${model.provider}/${model.id}` : undefined;
            }} onSelectBranchModel={selectBranchModel}
            systemPromptHref={id => viewHref(`/system-prompts/${encodeURIComponent(id)}`)} onImage={openImage} onAbort={abort}
            onOptions={openOptions} />
          </Show>
        )}</Show>;
        }}>
          {props.children}
        </ChatRouteContext.Provider>
        </SessionsRouteContext.Provider>
        </ToolApps>
      </SystemPromptContext.Provider>
      </FileLinkCwdContext.Provider>
      </SystemPromptCreatorContext.Provider>
      </NavigationLinksContext.Provider>
      <Dialog ref={optionsDialog} class="chat-dialog options-dialog" title="Options">
        <Show when={viewOptions()}>
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
        </Show>
        <CodeLinewrapOption />
        <HiddenBranchesOption />
        <StreamingContentOption />
        <ThinkingOptions />
        <ImagePasteOption />
        <SyntaxOptions />
        <CursorOption />
      </Dialog>
      <Dialog
        ref={chatDialog}
        class="chat-dialog project-dialog"
        title="Project folder"
      >
        <Input class="startup-search" aria-label="Project directory" placeholder="Project path" value={projectCwd()} onInput={event => setProjectCwd(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              const typed = projectCwd().trim();
              const cwd = projectPaths().find(path => path === typed) || projectPaths()[0] || (typed.startsWith('/') ? typed : '');
              if (cwd && !busy()) chooseProject(cwd);
            }
            if (event.key === 'Escape' && projectCwd()) { event.preventDefault(); event.stopPropagation(); setProjectCwd(''); }
          }} />
        <ScrollArea class="project-folders" vertical>
          <div role="listbox" aria-label="Project folders">
            <For each={projectPaths()} fallback={<p class="project-folders-empty">No matching folders</p>}>
              {cwd => <button type="button" role="option" aria-selected={projectCwd() === cwd}
                class="project-folder" disabled={busy()} onClick={() => chooseProject(cwd)}>{cwd}</button>}
            </For>
          </div>
        </ScrollArea>
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
  reply: (response: UiReply) => void;
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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseSessionEntries, SessionManager } from '@earendil-works/pi-coding-agent';
import { PiRpc } from './rpc.mjs';
import { applyRecord } from '../frontend/src/stream.mjs';

export class AgentConnection {
  rpc = new PiRpc();
  clients = new Set();
  snapshot = { entries: [], leafId: null, state: null };
  live = [];
  dialogs = new Map();
  mutating = false;
  diagnostic = '';
  source = null;
  historySnapshot = null;
  connectionError = '';
  providerConnection = 'ready';
  stopping = false;

  constructor(id, cwd) {
    this.id = id;
    this.cwd = cwd;
    this.rpc.on('record', record => {
      // A retry also emits agent_start. Keep the visible turn until its saved
      // snapshot arrives rather than erasing the user's message between attempts.
      this.live = applyRecord(this.live, record);
      if (record.type === 'history_root') {
        this.snapshot = { ...this.snapshot, entries: record.entries, leafId: record.leafId };
        this.live = [];
      }
      if (record.type === 'provider_connection') this.providerConnection = record.state;
      if (record.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(record.method)) {
        this.dialogs.set(record.id, record);
      }
      this.broadcast('record', record);
      if (record.type === 'agent_settled') this.refresh().catch(error => this.broadcast('error', error.message));
    });
    this.rpc.on('diagnostic', text => { this.diagnostic = (this.diagnostic + text).slice(-4000); });
    this.rpc.on('exit', message => {
      this.dialogs.clear();
      if (!this.stopping) this.connectionError = message;
      this.broadcast('snapshot', this.payload());
    });
  }

  payload() {
    return { agentId: this.id, ...this.snapshot, live: this.live, dialogs: [...this.dialogs.values()], connected: !!this.rpc.child, running: this.rpc.running, generating: this.rpc.generating, compacting: this.rpc.compacting, cwd: this.cwd, diagnostic: this.diagnostic, source: this.source, connectionError: this.connectionError, providerConnection: this.providerConnection };
  }

  broadcast(type, data) {
    const wire = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) client.write(wire);
  }

  async loadSession(selected) {
    const session = SessionManager.open(selected.file, undefined, selected.cwd);
    const context = session.buildSessionContext();
    this.live = [];
    this.dialogs.clear();
    this.snapshot = {
      entries: session.getEntries(), leafId: session.getLeafId(),
      state: {
        sessionId: session.getSessionId(), sessionUrlId: session.getHeader()?.urlId,
        sessionFile: path.resolve(selected.file), isStreaming: false,
        model: context.model?.provider && context.model.modelId ? { provider: context.model.provider, id: context.model.modelId } : null,
        thinkingLevel: context.thinkingLevel,
      },
    };
  }

  async captureHistory() {
    if (this.historySnapshot) return this.historySnapshot;
    if (this.mutating) throw new Error('Source agent is not ready');
    if (!this.rpc.child) {
      await this.loadSession({ file: this.snapshot.state.sessionFile, cwd: this.cwd });
      return [{ entries: this.snapshot.entries, leafId: this.snapshot.leafId }, this.snapshot.state];
    }
    this.mutating = true;
    this.historySnapshot = Promise.all([this.rpc.command({ type: 'get_entries' }), this.rpc.command({ type: 'get_state' })]);
    try { return await this.historySnapshot; }
    finally { this.historySnapshot = null; this.mutating = false; }
  }

  async refresh() {
    const [entries, state] = await Promise.all([this.rpc.command({ type: 'get_entries' }), this.rpc.command({ type: 'get_state' })]);
    if (this.snapshot.state && this.snapshot.state.sessionFile !== state.sessionFile) this.source = null;
    this.snapshot = { ...entries, state };
    if (!this.rpc.running) this.live = [];
    this.broadcast('snapshot', this.payload());
  }
}

export class AgentRegistry {
  agents = new Map();
  // Reserve session files before awaiting startup/switching: never give two
  // processes independent in-memory indexes over the same writable JSONL.
  owners = new Map();
  opening = new Map();

  constructor({ cwd, managed, cli, resolver, extension, fixture, extraExtension }) {
    Object.assign(this, { cwd, managed, cli, resolver, extension, fixture, extraExtension });
    const agent = new AgentConnection('default', cwd);
    agent.rpc.on('exit', () => this.release(agent));
    this.agents.set(agent.id, agent);
  }

  get(id = 'default') {
    if (typeof id !== 'string' || !this.agents.has(id)) throw new Error('Agent not found');
    return this.agents.get(id);
  }

  release(agent) {
    for (const [file, owner] of this.owners) if (owner === agent.id) this.owners.delete(file);
  }

  claim(agent, file) {
    if (!file) return;
    const key = path.resolve(file);
    const owner = this.owners.get(key);
    if (owner && owner !== agent.id) throw new Error('Session is active in another agent; create a branch instead');
    this.owners.set(key, agent.id);
  }

  async start(agent, selected) {
    if (agent.mutating || agent.rpc.running) throw new Error('Agent is busy');
    agent.mutating = true;
    const previousFile = agent.snapshot.state?.sessionFile;
    if (!agent.rpc.child && !selected && previousFile) selected = { file: previousFile, cwd: agent.cwd };
    let starting = false;
    let switching = false;
    try {
      if (selected && path.resolve(selected.cwd) !== agent.cwd) throw new Error('Session belongs to a different project');
      this.claim(agent, selected?.file);
      if (agent.rpc.child) {
        if (!selected) throw new Error('Agent is already connected');
        switching = true;
        const result = await agent.rpc.command({ type: 'switch_session', sessionPath: selected.file });
        if (result?.cancelled) { switching = false; throw new Error('Pi cancelled the session switch'); }
      } else {
        await mkdir(this.managed, { recursive: true });
        const args = ['--mode', 'rpc', '--session-dir', this.managed, '--extension', this.extension];
        if (this.extraExtension) args.push('--extension', this.extraExtension);
        if (selected) args.push('--session', selected.file);
        starting = true;
        await agent.rpc.start(process.execPath, this.fixture ? ['--import', this.resolver, this.fixture, ...args] : ['--import', this.resolver, this.cli, ...args], agent.cwd);
      }
      await agent.refresh();
      agent.connectionError = '';
      agent.broadcast('snapshot', agent.payload());
      this.release(agent);
      this.claim(agent, agent.snapshot.state?.sessionFile || selected?.file);
      return agent.payload();
    } catch (error) {
      if (starting || switching) await agent.rpc.stop();
      this.release(agent);
      if (agent.rpc.child) this.claim(agent, previousFile);
      agent.connectionError = error.message;
      agent.broadcast('snapshot', agent.payload());
      throw error;
    } finally { agent.mutating = false; }
  }

  async openSession(selected) {
    const file = path.resolve(selected.file);
    const pending = this.opening.get(file);
    if (pending) return pending;
    const owner = this.owners.get(file);
    if (owner) return this.get(owner);
    const existing = [...this.agents.values()].find(agent => agent.snapshot.state?.sessionFile === file);
    if (existing) {
      await existing.loadSession(selected);
      return existing;
    }
    const agent = new AgentConnection(randomUUID(), selected.cwd);
    agent.rpc.on('exit', () => this.release(agent));
    this.agents.set(agent.id, agent);
    const opening = agent.loadSession(selected).then(() => agent).catch(async error => {
      await agent.rpc.stop();
      this.release(agent);
      this.agents.delete(agent.id);
      throw error;
    });
    this.opening.set(file, opening);
    try { return await opening; }
    finally { this.opening.delete(file); }
  }

  async create(options, selected) {
    const { cwd = this.cwd, sourceAgentId, entryId } = options;
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('cwd must be an absolute path');
    if (sourceAgentId !== undefined && selected) throw new Error('Choose sourceAgentId or sessionId, not both');
    if (entryId !== undefined && typeof entryId !== 'string') throw new Error('entryId must be a string');
    const agent = new AgentConnection(randomUUID(), path.resolve(cwd));
    agent.rpc.on('exit', () => this.release(agent));
    let branch;
    let sourceModel;
    if (sourceAgentId !== undefined || selected) {
      let entries, parentSession, sourceCwd, leafId;
      const owner = selected && this.owners.get(path.resolve(selected.file));
      const source = sourceAgentId !== undefined ? this.get(sourceAgentId) : owner ? this.get(owner) : null;
      if (source) {
        // RPC returns completed entries, not a partial file read racing an
        // append. Parallel forks can share this immutable history snapshot.
        const [history, state] = await source.captureHistory();
        entries = history.entries;
        leafId = history.leafId;
        parentSession = state.sessionFile;
        sourceModel = state.model;
        sourceCwd = source.cwd;
      } else {
        // Migrate in memory only: forking must not rewrite the source file.
        const session = SessionManager.inMemory(selected.cwd, undefined, parseSessionEntries(await readFile(selected.file, 'utf8'), selected.file));
        entries = session.getEntries();
        leafId = session.getLeafId();
        const model = session.buildSessionContext().model;
        if (model) sourceModel = { provider: model.provider, id: model.modelId };
        parentSession = selected.file;
        sourceCwd = selected.cwd;
      }
      if (!Object.hasOwn(options, 'cwd')) agent.cwd = sourceCwd;
      const byId = new Map(entries.map(entry => [entry.id, entry]));
      const selectedEntry = entryId !== undefined ? byId.get(entryId) : null;
      if (entryId !== undefined && !selectedEntry) throw new Error('Branch entry not found');
      const target = selectedEntry ? (selectedEntry.message?.role === 'user' ? selectedEntry.parentId : selectedEntry.id) : leafId;
      const history = [];
      const seen = new Set();
      for (let id = target; id != null;) {
        const entry = byId.get(id);
        if (!entry || seen.has(id)) throw new Error('Invalid source branch ancestry');
        seen.add(id);
        history.push(entry);
        id = entry.parentId;
      }
      history.reverse();
      await mkdir(this.managed, { recursive: true });
      const session = SessionManager.create(agent.cwd, this.managed);
      const file = session.getSessionFile();
      await writeFile(file, [JSON.stringify({ ...session.getHeader(), parentSession }), ...history.map(entry => JSON.stringify(entry))].join('\n') + '\n', { flag: 'wx', mode: 0o600 });
      branch = { file, cwd: agent.cwd };
      agent.source = { agentId: source?.id ?? null, sessionId: selected?.id ?? (parentSession ? Buffer.from(parentSession).toString('base64url') : null), entryId: target };
    } else if (entryId !== undefined) throw new Error('entryId requires a source agent or session');
    this.agents.set(agent.id, agent);
    try {
      await this.start(agent, branch);

      // Copy history from the selected point, but keep the source's current model.
      // An older model_change entry must not resurrect obsolete credentials.
      const restoredModel = agent.snapshot.state?.model;
      if (sourceModel && (restoredModel?.provider !== sourceModel.provider || restoredModel?.id !== sourceModel.id)) {
        await agent.rpc.command({ type: 'set_model', provider: sourceModel.provider, modelId: sourceModel.id });
        await agent.refresh();
      }

      return agent;
    } catch (error) {
      await agent.rpc.stop();
      this.release(agent);
      this.agents.delete(agent.id);
      throw error;
    }
  }

  async navigate(agent, entryId) {
    if (agent.rpc.running) throw new Error('Stop the agent before changing the branch');
    const before = await agent.rpc.command({ type: 'get_entries' });
    const source = before.entries.find(entry => entry.id === entryId);
    if (!source) throw new Error('Branch entry not found');
    const commands = await agent.rpc.command({ type: 'get_commands' });
    if (!commands.commands.some(entry => entry.name === 'lilim-tree')) throw new Error('Reconnect Pi to enable tree navigation');
    let navigationError;
    const observe = record => {
      if (record.type === 'extension_error' && record.extensionPath === 'command:lilim-tree') navigationError = record.error;
    };
    agent.rpc.on('record', observe);
    try { await agent.rpc.command({ type: 'prompt', message: `/lilim-tree ${source.id}` }); }
    finally { agent.rpc.off('record', observe); }
    if (navigationError) throw new Error(navigationError);
    const navigated = await agent.rpc.command({ type: 'get_entries' });
    const target = source.message?.role === 'user' ? source.parentId : source.id;
    if (navigated.leafId !== target) throw new Error('Tree navigation did not reach the selected branch');
    await agent.refresh();
  }

  async stop(agent) {
    if (agent.mutating) throw new Error('Agent is busy');
    agent.mutating = true;
    agent.stopping = true;
    try { await agent.rpc.stop(); this.release(agent); }
    finally { agent.stopping = false; agent.mutating = false; }
  }

  async shutdown() {
    for (const agent of this.agents.values()) {
      for (const client of agent.clients) client.end();
      agent.clients.clear();
    }
    await Promise.all([...this.agents.values()].map(agent => agent.rpc.stop()));
  }
}

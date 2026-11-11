import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { SessionManager } from '@earendil-works/pi-coding-agent';

export class OperationError extends Error {
  constructor(message, reason = 'invalid') {
    super(message);
    this.reason = reason;
  }
}
const fail = (message, reason) => { throw new OperationError(message, reason); };

export function createOperations({ agents, cwd, managed }) {
  const getAgent = input => agents.get(input.agentId);
  async function allSessions() {
    return [...new Map([...await SessionManager.listAll(), ...await SessionManager.listAll(managed)]
      .map(session => [path.resolve(session.path), session])).values()];
  }
  async function openSessionView(session, sessions) {
    const selectedPath = path.resolve(session.path);
    const family = new Set([selectedPath]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of sessions) {
        if (!candidate.parentSessionPath) continue;
        const file = path.resolve(candidate.path);
        const parent = path.resolve(candidate.parentSessionPath);
        if (!family.has(file) && !family.has(parent)) continue;
        if (!family.has(file) || !family.has(parent)) changed = true;
        family.add(file); family.add(parent);
      }
    }
    const opened = await agents.openSession({ file: session.path, cwd: session.cwd });
    const relatedAgents = [];
    for (const candidate of sessions) {
      const file = path.resolve(candidate.path);
      if (file === selectedPath || !family.has(file)) continue;
      const related = await agents.openSession({ file: candidate.path, cwd: candidate.cwd });
      relatedAgents.push(related.payload());
    }
    return { ...opened.payload(), relatedAgents };
  }
  async function catalog(projectCwd = cwd) {
    const directories = [{
      directory: path.join(os.homedir(), '.pi/agent/sessions', `--${projectCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`),
      project: projectCwd, managed: false,
    }, { directory: managed, project: projectCwd, managed: true }];
    const found = [];
    for (const location of directories) {
      for (const session of await SessionManager.list(location.project, location.directory)) {
        const sessionCwd = session.cwd || location.project;
        if (path.resolve(sessionCwd) !== projectCwd) continue;
        const title = (session.name || session.firstMessage || 'Empty chat').replace(/\s+/g, ' ').trim();
        found.push({
          id: Buffer.from(session.path).toString('base64url'), file: session.path,
          cwd: sessionCwd, project: path.relative(path.join(os.homedir(), 'Development'), sessionCwd),
          label: title, name: title, urlId: session.urlId,
          messageCount: session.messageCount, modified: session.modified.getTime(), managed: location.managed,
        });
      }
    }
    return found.sort((a, b) => b.modified - a.modified);
  }
  async function createAgent(command) {
    if (command.openSessionId !== undefined) {
      const sessions = await allSessions();
      const session = sessions.find(session => Buffer.from(session.path).toString('base64url') === command.openSessionId);
      if (!session) fail('Session not found', 'not-found');
      return openSessionView(session, sessions);
    }
    if (command.sessionUrlId !== undefined) {
      if (typeof command.sessionUrlId !== 'string' || !/^[abcdefghjkmnopqrstuvwxyz23456789]{8}$/.test(command.sessionUrlId)) fail('Invalid session URL ID');
      const active = [...agents.agents.values()].filter(agent => agent.snapshot.state?.sessionUrlId === command.sessionUrlId);
      const sessions = await allSessions();
      const matches = [...new Map(sessions.filter(session => session.urlId === command.sessionUrlId).map(session => [path.resolve(session.path), session])).values()];
      const files = new Set([...matches.map(session => path.resolve(session.path)), ...active.map(agent => path.resolve(agent.snapshot.state.sessionFile))]);
      if (files.size > 1) fail('Session URL ID is ambiguous', 'conflict');
      if (active.length) return openSessionView({ path: active[0].snapshot.state.sessionFile, cwd: active[0].cwd }, sessions);
      if (!matches.length) fail('Session not found', 'not-found');
      return openSessionView(matches[0], sessions);
    }
    const source = command.sourceAgentId !== undefined ? agents.get(command.sourceAgentId) : null;
    const projectCwd = path.resolve(command.cwd ?? source?.cwd ?? cwd);
    const selected = command.sessionId ? (await catalog(projectCwd)).find(entry => entry.id === command.sessionId) : null;
    if (command.sessionId && !selected) fail('Session not found', 'not-found');
    return (await agents.create(command, selected)).payload();
  }
  async function navigate(input, continuation) {
    const { agentId: _agentId, ...command } = input;
    const agent = getAgent(input);
    const { rpc } = agent;
    if (agent.mutating || rpc.running) fail('Agent is busy');
    agent.mutating = true;
    try {
      const before = await rpc.command({ type: 'get_entries' });
      const source = before.entries.find(entry => entry.id === command.entryId && (continuation || entry.message?.role === 'user'));
      if (!source) fail('Branch entry not found');
      if (typeof command.message !== 'string' || (!command.message.trim() && !command.images?.length)) fail('Message is empty');
      await agents.navigate(agent, source.id);
      return await rpc.command({ type: 'prompt', message: command.message, images: command.images, systemPrompt: command.systemPrompt });
    } finally { agent.mutating = false; }
  }
  return {
    info: input => getAgent(input).payload(),
    sessions: async input => {
      const agent = getAgent(input);
      const available = input.scope === 'all' ? (await allSessions()).map(session => ({
        id: Buffer.from(session.path).toString('base64url'), urlId: session.urlId,
        cwd: session.cwd, name: session.name || session.firstMessage || 'Empty chat', modified: session.modified.getTime(),
      })).sort((a, b) => b.modified - a.modified) : await catalog(agent.cwd);
      return available.filter(entry => input.scope !== 'cwd' || entry.cwd === agent.cwd).map(({ file: _file, ...entry }) => entry);
    },
    session: async input => {
      const entry = (await catalog(getAgent(input).cwd)).find(entry => entry.id === input.id);
      if (!entry) fail('Session not found', 'not-found');
      return readFile(entry.file, 'utf8');
    },
    listAgents: () => [...agents.agents.values()].map(agent => {
      const { agentId, cwd, connected, running, state, source } = agent.payload();
      return { agentId, cwd, connected, running, state, source };
    }),
    createAgent,
    eventAgents: ids => ids.some(id => !agents.agents.has(id)) ? null : ids.map(id => agents.get(id)),
    attachments: async input => {
      const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
      if (!Array.isArray(input.images) || !input.images.length) fail('No images supplied');
      const images = input.images.map(image => {
        const extension = extensions[image?.mimeType];
        if (!extension || image.type !== 'image' || typeof image.data !== 'string' || !image.data.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) fail('Invalid image attachment');
        return { extension, bytes: Buffer.from(image.data, 'base64') };
      });
      const directory = path.join(managed, 'attachments');
      await mkdir(directory, { recursive: true });
      const paths = [];
      for (const image of images) {
        const file = path.join(directory, `${randomUUID()}.${image.extension}`);
        await writeFile(file, image.bytes, { flag: 'wx', mode: 0o600 });
        paths.push(file);
      }
      return { paths };
    },
    ui: async input => {
      const agent = getAgent(input);
      if (!agent.dialogs.has(input.id)) fail('Dialog expired');
      await agent.rpc.write({ type: 'extension_ui_response', id: input.id, value: input.value, confirmed: input.confirmed, cancelled: input.cancelled });
      agent.dialogs.delete(input.id);
      return {};
    },
    stop: async input => { await agents.stop(getAgent(input)); return {}; },
    start: async input => {
      const agent = getAgent(input);
      const selected = input.sessionId ? (await catalog(agent.cwd)).find(entry => entry.id === input.sessionId) : null;
      if (input.sessionId && !selected) fail('Session not found', 'not-found');
      return agents.start(agent, selected);
    },
    branch: input => navigate(input, false),
    continue: input => navigate(input, true),
    command: async input => {
      const { agentId: _agentId, ...command } = input;
      const agent = getAgent(input);
      const { rpc } = agent;
      const reload = command.type === 'prompt' && command.message?.trim() === '/reload';
      if (reload && rpc.running) fail('Stop the agent before reloading');
      const changesBranch = reload || ['fork', 'new_session', 'set_model', 'set_thinking_level', 'save_system_prompt', 'compact'].includes(command.type);
      if ((changesBranch || command.type === 'prompt') && agent.mutating) fail('Another command is in progress');
      if (changesBranch && command.type !== 'compact' && rpc.running) fail('Stop the agent before changing the session');
      if (changesBranch || command.type === 'prompt') agent.mutating = true;
      try {
        if (reload) {
          const available = await rpc.command({ type: 'get_commands' });
          if (!available.commands.some(entry => entry.name === 'spicy-reload')) fail('Reconnect Pi to enable /reload');
          command.message = '/spicy-reload';
        }
        const result = await rpc.command(command);
        if (changesBranch) {
          await agent.refresh();
          agents.release(agent);
          agents.claim(agent, agent.snapshot.state?.sessionFile);
        }
        return command.type === 'compact' ? { ...result, snapshot: agent.payload() } : result || {};
      } finally { if (changesBranch || command.type === 'prompt') agent.mutating = false; }
    },
  };
}

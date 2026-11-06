// Deterministic protocol fixture. No model calls or filesystem tools.
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const option = name => process.argv[process.argv.indexOf(name) + 1];
const temporary = !process.argv.includes('--session-dir') && mkdtempSync(join(tmpdir(), 'spicy-fake-pi-'));
const directory = temporary || option('--session-dir');
let session = process.argv.includes('--session') ? SessionManager.open(option('--session'), directory) : SessionManager.create(process.cwd(), directory);
let buffer = '';
let running = false;
let timer;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const append = message => session.appendMessage(message);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const command = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    const response = data => send({ type: 'response', id: command.id, command: command.type, success: true, data });
    if (command.type === 'get_state') response({ sessionId: session.getSessionId(), sessionUrlId: session.getHeader()?.urlId, sessionFile: session.getSessionFile(), isStreaming: running, model: { provider: 'test', id: 'fake' } });
    else if (command.type === 'get_entries') response({ entries: session.getEntries(), leafId: session.getLeafId() });
    else if (command.type === 'get_available_models') response({ models: [{ provider: 'test', id: 'fake', name: 'Fake model' }] });
    else if (command.type === 'get_available_thinking_levels') response({ levels: ['off'] });
    else if (command.type === 'get_commands') response({ commands: [{ name: 'spicy-tree', source: 'extension' }] });
    else if (command.type === 'echo') response(command.value);
    else if (command.type === 'clear_queue') response({ steering: [], followUp: [] });
    else if (command.type === 'fork') {
      const target = session.getEntry(command.entryId);
      if (target.parentId) session.branch(target.parentId); else session.resetLeaf();
      response({ cancelled: false, text: target.message.content });
    } else if (command.type === 'switch_session') { session = SessionManager.open(command.sessionPath, directory); response({ cancelled: false }); }
    else if (command.type === 'new_session') { session = SessionManager.create(process.cwd(), directory); response({ cancelled: false }); }
    else if (command.type === 'prompt' && command.message.startsWith('/spicy-tree ')) {
      const source = session.getEntry(command.message.slice('/spicy-tree '.length));
      const target = source.message?.role === 'user' ? source.parentId : source.id;
      if (target) session.branch(target); else session.resetLeaf();
      response({ disposition: 'handled' });
    }
    else if (command.type === 'prompt') {
      response({ disposition: 'started' }); running = true; send({ type: 'agent_start' });
      const user = { role: 'user', content: command.message, timestamp: Date.now() };
      send({ type: 'message_start', message: user }); append(user); send({ type: 'message_end', message: user });
      const partial = { role: 'assistant', content: [], timestamp: Date.now() + 1, stopReason: 'pending' };
      send({ type: 'message_start', message: partial });
      send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello\u2028' } });
      timer = setTimeout(() => {
        const message = { ...partial, stopReason: 'stop', content: [{ type: 'text', text: 'Hello\u2028from fake Pi.' }] };
        append(message); send({ type: 'message_end', message }); running = false;
        send({ type: 'agent_end' }); send({ type: 'agent_settled' });
      }, 300);
    } else if (command.type === 'abort') { clearTimeout(timer); running = false; send({ type: 'agent_settled' }); response({}); }
    else if (command.type === 'extension_ui_response') { /* UI responses are one-way notifications. */ }
    else send({ type: 'response', id: command.id, command: command.type, success: false, error: 'Unsupported fixture command' });
  }
});
process.stdin.on('end', () => { clearTimeout(timer); if (temporary) rmSync(temporary, { recursive: true, force: true }); process.exit(0); });

// Deterministic protocol fixture. No model calls or filesystem tools.
let buffer = '';
let entries = [];
let leafId = null;
let running = false;
let sequence = 0;
let timer;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const append = message => {
  const entry = { type: 'message', id: `entry-${++sequence}`, parentId: leafId, message };
  entries.push(entry); leafId = entry.id;
};
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const command = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    const response = data => send({ type: 'response', id: command.id, command: command.type, success: true, data });
    if (command.type === 'get_state') response({ sessionId: 'fixture', isStreaming: running, model: { provider: 'test', id: 'fake' } });
    else if (command.type === 'get_entries') response({ entries, leafId });
    else if (command.type === 'get_available_models') response({ models: [{ provider: 'test', id: 'fake', name: 'Fake model' }] });
    else if (command.type === 'get_available_thinking_levels') response({ levels: ['off'] });
    else if (command.type === 'get_commands') response({ commands: [{ name: 'lilim-tree', source: 'extension' }] });
    else if (command.type === 'echo') response(command.value);
    else if (command.type === 'clear_queue') response({ steering: [], followUp: [] });
    else if (command.type === 'fork') {
      const target = entries.find(entry => entry.id === command.entryId);
      leafId = target.parentId;
      response({ cancelled: false, text: target.message.content });
    } else if (command.type === 'new_session') { entries = []; leafId = null; response({ cancelled: false }); }
    else if (command.type === 'prompt' && command.message.startsWith('/lilim-tree ')) {
      const source = entries.find(entry => entry.id === command.message.slice('/lilim-tree '.length));
      leafId = source.message?.role === 'user' ? source.parentId : source.id;
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
process.stdin.on('end', () => { clearTimeout(timer); process.exit(0); });

/** RPC deltas have no cumulative message snapshot. Reconstruct by contentIndex. */
export function applyRecord(messages, record) {
  if (record.type === 'message_start') return [...messages, structuredClone(record.message)];
  if (record.type === 'message_end') {
    const index = messages.findLastIndex(message => message.role === record.message.role
      && message.timestamp === record.message.timestamp);
    if (index < 0) return [...messages, record.message];
    return messages.map((message, i) => i === index ? record.message : message);
  }
  if (record.type !== 'message_update') return messages;
  const index = messages.findLastIndex(message => message.role === 'assistant' && message.stopReason === 'pending');
  if (index < 0) return messages;
  const event = record.assistantMessageEvent;
  if (!Number.isInteger(event?.contentIndex)) return messages;
  const message = structuredClone(messages[index]);
  if (!Array.isArray(message.content)) message.content = [];
  const i = event.contentIndex;
  if (event.type.startsWith('text_')) {
    const previous = message.content[i]?.text || '';
    message.content[i] = { type: 'text', text: event.type === 'text_end' ? event.content : previous + (event.delta || '') };
  } else if (event.type.startsWith('thinking_')) {
    const previous = message.content[i]?.thinking || '';
    message.content[i] = { ...message.content[i], type: 'thinking', thinking: event.type === 'thinking_end' ? event.content : previous + (event.delta || '') };
  } else if (event.type === 'toolcall_start') {
    message.content[i] = { type: 'toolCall', id: event.id, name: event.toolName, arguments: {}, partial: '' };
  } else if (event.type === 'toolcall_delta') {
    const block = message.content[i];
    if (block) block.partial = (block.partial || '') + event.delta;
  } else if (event.type === 'toolcall_end') message.content[i] = event.toolCall;
  return messages.map((previous, i) => i === index ? message : previous);
}

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import Handoffs from '../src/Handoffs';
import { ChatEntryPart } from '../src/ChatContent';
import type { Wire } from '../src/types';

export function mount(root: HTMLElement) {
  const [sessionKey, setSessionKey] = createSignal('session-1');
  const [result, setResult] = createSignal<Wire>({ details: { task_id: 'joke-7k3m9p' } });
  const [fetchedResult, setFetchedResult] = createSignal<Wire>({ content: [{ type: 'text', text: 'Result' }] });
  const call = { name: 'handoff_task_to_user', arguments: { tool: 'joke', instructions: 'Choose a joke', inputs: { topic: { value: 'cats' } } } };
  const dispose = render(() => <Handoffs sessionKey={sessionKey()}>
    <ChatEntryPart part={{ kind: 'tool', call, result: result(), entryId: 'call-1' }} />
    <ChatEntryPart part={{ kind: 'tool', call: { name: 'get_handoff_result', arguments: { task_id: 'joke-7k3m9p' } }, result: fetchedResult(), entryId: 'call-2' }} />
  </Handoffs>, root);
  return { dispose, setSessionKey, setResult, setFetchedResult };
}

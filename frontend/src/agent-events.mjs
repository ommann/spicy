/** One SSE socket per tab. Reopening always starts with authoritative snapshots. */
export function createAgentEvents({ onError, onOpen, onReset = () => {}, timeoutMs = 45000 }) {
  const channels = new Map();
  let source;
  let timer;
  let revision = 0;
  let disposed = false;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { onError(); reconnect(); }, timeoutMs);
  };
  function reconnect() {
    source?.close();
    source = undefined;
    clearTimeout(timer);
    if (disposed || !channels.size) return;
    const current = new EventSource(`/api/events?${new URLSearchParams({ agentIds: [...channels.keys()].join(',') })}`);
    source = current;
    current.addEventListener('agent', event => {
      if (source !== current) return;
      arm();
      const envelope = JSON.parse(event.data);
      channels.get(envelope.agentId)?.dispatchEvent(new MessageEvent(envelope.event, { data: JSON.stringify(envelope.data) }));
    });
    current.addEventListener('reset', () => {
      if (source !== current) return;
      current.close();
      source = undefined;
      clearTimeout(timer);
      onReset();
    });
    current.addEventListener('heartbeat', () => { if (source === current) arm(); });
    current.onopen = () => { if (source === current) { arm(); onOpen(); } };
    current.onerror = () => { if (source === current) { arm(); onError(); } };
    arm();
  }
  function schedule() {
    const next = ++revision;
    queueMicrotask(() => { if (revision === next && !disposed) reconnect(); });
  }
  return {
    watch(id) {
      if (channels.has(id)) return channels.get(id);
      const channel = new EventTarget();
      channel.close = () => { if (channels.get(id) === channel) { channels.delete(id); schedule(); } };
      channels.set(id, channel);
      schedule();
      return channel;
    },
    close() {
      disposed = true;
      ++revision;
      clearTimeout(timer);
      source?.close();
      channels.clear();
    },
  };
}

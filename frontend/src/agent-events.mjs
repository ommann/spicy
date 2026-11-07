import { api } from './api.ts';

/** One oRPC SSE iterator per tab; reconnecting always obtains fresh snapshots. */
export function createAgentEvents({ onError, onOpen, onReset = () => {}, timeoutMs = 45000 }) {
  const channels = new Map();
  let source;
  let timer;
  let retryTimer;
  let revision = 0;
  let disposed = false;
  let retryMs = 500;
  function retry() {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    if (disposed || !channels.size) return;
    retryTimer = setTimeout(reconnect, retryMs);
    retryMs = Math.min(10000, retryMs * 2);
  }
  function arm(current) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (source !== current) return;
      source = undefined;
      current.abort();
      onError();
      retry();
    }, timeoutMs);
  }
  function reconnect() {
    source?.abort();
    source = undefined;
    clearTimeout(timer);
    clearTimeout(retryTimer);
    if (disposed || !channels.size) return;
    const current = new AbortController();
    source = current;
    arm(current);
    void (async () => {
      try {
        const events = await api.events({ agentIds: [...channels.keys()] }, { signal: current.signal });
        if (source !== current) { await events.return(); return; }
        onOpen();
        for await (const envelope of events) {
          if (source !== current) return;
          arm(current);
          retryMs = 500;
          if (envelope.type === 'reset') {
            source = undefined;
            clearTimeout(timer);
            current.abort();
            onReset();
            return;
          }
          if (envelope.type === 'agent') {
            channels.get(envelope.agentId)?.dispatchEvent(new MessageEvent(envelope.event, { data: JSON.stringify(envelope.data) }));
          }
        }
      } catch {
        if (source !== current || current.signal.aborted) return;
      }
      if (source !== current) return;
      source = undefined;
      current.abort();
      onError();
      retry();
    })();
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
      clearTimeout(retryTimer);
      source?.abort();
      source = undefined;
      channels.clear();
    },
  };
}

import type { ChannelListener } from 'node:diagnostics_channel';
import { channel } from 'node:diagnostics_channel';

// Observe the provider transport. Never open, retry, or keep a connection alive.
export function observeProviderConnection(send: (state: string) => void) {
  let baseUrl: URL | undefined;
  let socket: WebSocket | undefined;
  let socketAttempted = false;
  let socketOpened = false;
  let state = 'ready';
  const subscriptions: (() => void)[] = [];

  function update(next: string) {
    if (state === next) return;
    state = next;
    send(next);
  }

  function matches(address: string, origin?: string) {
    if (!baseUrl) return false;
    try {
      const url = new URL(address, origin);
      url.protocol = url.protocol.replace('ws', 'http');
      const prefix = baseUrl.pathname.replace(/\/$/, '');
      return url.origin === baseUrl.origin && (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
    } catch { return false; }
  }

  function providerRequest(request: { path: string; origin: string } | undefined) {
    return request && matches(request.path, request.origin);
  }

  function subscribe(name: string, listener: (message: { request: { path: string; origin: string; upgrade?: string }; response: { statusCode: number }; error?: { name?: string; code?: string }; websocket?: WebSocket }) => void) {
    const subscription = channel(name);
    subscription.subscribe(listener as ChannelListener);
    subscriptions.push(() => subscription.unsubscribe(listener as ChannelListener));
  }

  const socketError = () => update('socket-lost');
  function forgetSocket() {
    socket?.removeEventListener('error', socketError);
    socket = undefined;
  }

  subscribe('undici:request:create', ({ request }) => {
    if (providerRequest(request) && request.upgrade) {
      socketAttempted = true;
      socketOpened = false;
    }
  });
  subscribe('undici:request:headers', ({ request, response }) => {
    if (providerRequest(request) && response.statusCode >= 400) update('error');
  });
  subscribe('undici:request:error', ({ request, error }) => {
    if (!providerRequest(request) || error?.name === 'AbortError' || ['UND_ERR_ABORTED', 'ABORT_ERR'].includes(error?.code ?? '')) return;
    update(request.upgrade && socketOpened ? 'socket-lost' : 'error');
  });
  subscribe('undici:websocket:open', ({ websocket }) => {
    if (!websocket || !matches(websocket.url)) return;
    forgetSocket();
    socket = websocket;
    socketAttempted = true;
    socketOpened = true;
    socket.addEventListener('error', socketError);
    update('ready');
  });
  subscribe('undici:websocket:close', ({ websocket }) => {
    if (!socket || websocket !== socket) return;
    forgetSocket();
    if (state !== 'error') update('socket-lost');
  });

  return {
    setModel(model?: { baseUrl?: string }) {
      forgetSocket();
      baseUrl = model?.baseUrl ? new URL(model.baseUrl) : undefined;
      socketAttempted = false;
      socketOpened = false;
      state = 'ready';
      send(state);
    },
    response(status: number) {
      if (status >= 400) update('error');
      else if (status >= 200 && status < 300) {
        update(socketAttempted && socket?.readyState !== 1 ? 'socket-lost' : 'ready');
      }
    },
    close() {
      forgetSocket();
      for (const unsubscribe of subscriptions) unsubscribe();
    },
  };
}

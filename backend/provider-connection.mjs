import { channel } from 'node:diagnostics_channel';

// Observe the provider transport. Never open, retry, or keep a connection alive.
export function observeProviderConnection(send) {
  let baseUrl;
  let socket;
  let socketAttempted = false;
  let socketOpened = false;
  let state = 'ready';
  const subscriptions = [];

  function update(next) {
    if (state === next) return;
    state = next;
    send(next);
  }

  function matches(address, origin) {
    if (!baseUrl) return false;
    try {
      const url = new URL(address, origin);
      url.protocol = url.protocol.replace('ws', 'http');
      const prefix = baseUrl.pathname.replace(/\/$/, '');
      return url.origin === baseUrl.origin && (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
    } catch { return false; }
  }

  function providerRequest(request) {
    return request && matches(request.path, request.origin);
  }

  function subscribe(name, listener) {
    const subscription = channel(name);
    subscription.subscribe(listener);
    subscriptions.push(() => subscription.unsubscribe(listener));
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
    if (!providerRequest(request) || error?.name === 'AbortError' || ['UND_ERR_ABORTED', 'ABORT_ERR'].includes(error?.code)) return;
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
    setModel(model) {
      forgetSocket();
      baseUrl = model?.baseUrl ? new URL(model.baseUrl) : undefined;
      socketAttempted = false;
      socketOpened = false;
      state = 'ready';
      send(state);
    },
    response(status) {
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

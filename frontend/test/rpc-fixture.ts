import { EventPublisher, os } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';

// Exercise the real oRPC wire format, errors and iterators without a listening server.
export function createRpcFixture(router) {
  const requests = [];
  const connections = [];
  const streams = new Map();
  const lifetime = new AbortController();
  // A real fetch keeps its request alive while the response streams. The in-process
  // transport must do the same so Node does not collect the request's abort forwarding.
  const activeRequests = new Set<Request>();
  const recorded = os.use(({ path, next }, input) => {
    requests.push({ path: path.join('/'), input });
    return next();
  });
  const handler = new RPCHandler(recorded.router({
    branchLabels: { list: os.handler(() => ({})) },
    ...router,
    events: os.handler(async function* ({ input, signal }) {
      const publisher = new EventPublisher({ maxBufferedEvents: Infinity });
      const combined = AbortSignal.any([signal, lifetime.signal]);
      const iterator = publisher.subscribe('message', { signal: combined });
      const connection = {
        agentIds: input.agentIds,
        signal: combined,
        get closed() { return combined.aborted; },
        emit(envelope) { publisher.publish('message', envelope); },
      };
      connections.push(connection);
      for (const agentId of input.agentIds) streams.set(agentId, {
        emit(event, data) { connection.emit({ type: 'agent', agentId, event, data }); },
        get closed() { return connection.closed; },
      });
      try { yield* iterator; }
      catch (error) { if (!combined.aborted) throw error; }
      finally { await iterator.return(); }
    }),
  }));
  return {
    requests, connections, streams,
    async fetch(request) {
      if (request.url.endsWith('/events') && !request.signal.aborted) {
        activeRequests.add(request);
        request.signal.addEventListener('abort', () => activeRequests.delete(request), { once: true });
      }
      const result = await handler.handle(request, { prefix: '/rpc' });
      if (!result.matched) throw new Error(`Unexpected RPC request: ${request.url}`);
      return result.response;
    },
    close() { lifetime.abort(); activeRequests.clear(); },
  };
}

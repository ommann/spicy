import { EventPublisher, os } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';

// Exercise the real oRPC wire format, errors and iterators without a listening server.
export function createRpcFixture(router) {
  const requests = [];
  const connections = [];
  const streams = new Map();
  const lifetime = new AbortController();
  const recorded = os.use(({ path, next }, input) => {
    requests.push({ path: path.join('/'), input });
    return next();
  });
  const handler = new RPCHandler(recorded.router({
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
      const result = await handler.handle(request, { prefix: '/rpc' });
      if (!result.matched) throw new Error(`Unexpected RPC request: ${request.url}`);
      return result.response;
    },
    close() { lifetime.abort(); },
  };
}

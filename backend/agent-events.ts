import { EventPublisher } from '@orpc/server';

/** One oRPC event iterator per tab, with snapshots on every subscription. */
export async function* agentEvents(agents, signal) {
  const controller = new AbortController();
  const lifetime = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const publisher = new EventPublisher({ maxBufferedEvents: Infinity });
  const events = publisher.subscribe('message', { signal: lifetime });
  let pending = 0;
  const send = message => {
    // Never silently discard RPC deltas. A slow client must reconnect to snapshots.
    if (++pending > 2048) { controller.abort(new Error('Event consumer fell behind')); return; }
    publisher.publish('message', message);
  };
  const subscriptions = [];
  let heartbeat;
  try {
    for (const agent of agents) {
      const client = { send: (event, data) => send({ type: 'agent', agentId: agent.id, event, data }) };
      agent.clients.add(client);
      subscriptions.push({ agent, client });
      client.send('snapshot', agent.payload());
    }
    heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15000);
    heartbeat.unref?.();
    for await (const message of events) {
      pending--;
      yield message;
    }
  } finally {
    clearInterval(heartbeat);
    for (const { agent, client } of subscriptions) agent.clients.delete(client);
    controller.abort();
    await events.return();
  }
}

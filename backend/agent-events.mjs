export function serveAgentEvents(req, res, agents) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const subscriptions = agents.map(agent => {
    const client = { send(event, data) {
      res.write(`event: agent\ndata: ${JSON.stringify({ agentId: agent.id, event, data })}\n\n`);
    } };
    agent.clients.add(client);
    client.send('snapshot', agent.payload());
    return { agent, client };
  });
  const heartbeat = setInterval(() => res.write('event: heartbeat\ndata: {}\n\n'), 15000);
  heartbeat.unref?.();
  const close = () => {
    clearInterval(heartbeat);
    for (const { agent, client } of subscriptions) agent.clients.delete(client);
  };
  res.on('close', close);
  req.on('close', close);
}

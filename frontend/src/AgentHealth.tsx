import './agent-health.css';

export type AgentHealthStatus = 'inactive' | 'ready' | 'socket-lost' | 'error' | 'disconnected';

const labels = {
  inactive: 'Saved branch — no agent process',
  ready: 'Provider connection normal',
  'socket-lost': 'Provider socket lost — reconnect needed',
  error: 'Connection failed',
  disconnected: 'Agent disconnected',
};

export default function AgentHealth(props: { placeholder?: boolean; status?: AgentHealthStatus }) {
  const label = () => props.placeholder || !props.status ? 'No agent yet' : labels[props.status];
  return <span class="agent-health" classList={{ 'agent-health-placeholder': props.placeholder || !props.status }}
    data-status={props.placeholder ? undefined : props.status} role="img" aria-label={label()} title={label()} />;
}

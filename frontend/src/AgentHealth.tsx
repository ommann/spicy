import './agent-health.css';

export default function AgentHealth(props: { placeholder?: boolean }) {
  const label = () => props.placeholder ? 'No agent yet' : 'Agent health preview: ready (status not connected yet)';
  return <span class="agent-health" classList={{ 'agent-health-placeholder': props.placeholder }}
    role="img" aria-label={label()} title={label()} />;
}

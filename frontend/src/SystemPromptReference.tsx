import { promptLabel } from './prompt-numbers';
import AgentHealth, { type AgentHealthStatus } from './AgentHealth';

interface Props {
  entryId: string;
  promptId: string;
  number: number;
  title?: string;
  health: AgentHealthStatus;
  onOpen: (id: string) => void;
}

export default function SystemPromptReference(props: Props) {
  return (
    <section class="message system-message system-prompt-reference"
      data-entry-id={props.entryId} data-system-prompt={props.number}
      role="button" tabIndex={0}
      onClick={() => props.onOpen(props.promptId)}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        props.onOpen(props.promptId);
      }}>
      <span>{promptLabel(props.number, props.title)}</span>
      <AgentHealth status={props.health} />
    </section>
  );
}

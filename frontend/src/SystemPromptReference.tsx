import { A } from '@solidjs/router';
import { promptLabel } from './prompt-numbers';
import AgentHealth, { type AgentHealthStatus } from './AgentHealth';

interface Props {
  entryId: string;
  promptId: string;
  number: number;
  title?: string;
  health: AgentHealthStatus;
  href: string;
}

export default function SystemPromptReference(props: Props) {
  return (
    <A href={props.href} class="message system-message system-prompt-reference"
      data-entry-id={props.entryId} data-system-prompt={props.number}>
      <span>{promptLabel(props.number, props.title)}</span>
      <AgentHealth status={props.health} />
    </A>
  );
}

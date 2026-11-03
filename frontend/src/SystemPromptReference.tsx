import { promptLabel } from './prompt-numbers';

interface Props {
  entryId: string;
  promptId: string;
  number: number;
  title?: string;
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
      {promptLabel(props.number, props.title)}
    </section>
  );
}

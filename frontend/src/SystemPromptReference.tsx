interface Props {
  entryId: string;
  number: number;
  onOpen: (number: number) => void;
}

export default function SystemPromptReference(props: Props) {
  return (
    <section class="message system-message system-prompt-reference"
      data-entry-id={props.entryId} data-system-prompt={props.number}
      role="button" tabIndex={0}
      onClick={() => props.onOpen(props.number)}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        props.onOpen(props.number);
      }}>
      System prompt {props.number}
    </section>
  );
}

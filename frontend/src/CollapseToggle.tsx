export default function CollapseToggle(props: {
  expanded: boolean;
  onToggle: () => void;
  label?: string;
  text?: string;
  class?: string;
}) {
  return <button type="button" class={`collapse-toggle${props.class ? ` ${props.class}` : ''}`}
    aria-label={props.label} aria-expanded={props.expanded} onClick={() => props.onToggle()}>
    {props.text ?? (props.expanded ? 'Show less' : 'Show more')}
  </button>;
}

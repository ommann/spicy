export default function TreeDisclosure(props: {
  expanded: boolean;
  label: string;
  onToggle: () => void;
}) {
  return <button type="button" class="creator-tree-disclosure"
    aria-label={props.label} aria-expanded={props.expanded} onClick={props.onToggle}>
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d={props.expanded ? 'M 2 4 H 14 L 8 12 Z' : 'M 4 2 L 12 8 L 4 14 Z'} />
    </svg>
  </button>;
}

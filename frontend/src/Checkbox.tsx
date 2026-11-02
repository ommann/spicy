import type { JSX } from 'solid-js';

type Props = Pick<JSX.InputHTMLAttributes<HTMLInputElement>, 'checked' | 'onChange' | 'disabled' | 'aria-label'>;

export default function Checkbox(props: Props) {
  return <span class="checkbox">
    <input type="checkbox" checked={props.checked} onChange={props.onChange}
      disabled={props.disabled} aria-label={props['aria-label']} />
    <span class="checkbox-mark" aria-hidden="true">{props.checked ? '[X]' : '[ ]'}</span>
  </span>;
}

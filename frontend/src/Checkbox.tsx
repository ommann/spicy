import { createEffect, type JSX } from 'solid-js';

type Props = Pick<JSX.InputHTMLAttributes<HTMLInputElement>, 'checked' | 'onChange' | 'disabled' | 'aria-label'> & { indeterminate?: boolean };

export default function Checkbox(props: Props) {
  let input!: HTMLInputElement;
  createEffect(() => { input.indeterminate = !!props.indeterminate; });
  return <span class="checkbox">
    <input ref={input} type="checkbox" checked={props.checked} onChange={props.onChange}
      disabled={props.disabled} aria-label={props['aria-label']} />
    <span class="checkbox-mark" aria-hidden="true">{props.indeterminate ? '[-]' : props.checked ? '[X]' : '[ ]'}</span>
  </span>;
}

import { A } from '@solidjs/router';
import { Show, type JSX } from 'solid-js';
import SelectWithDialog, { type SelectOption } from './SelectWithDialog';

export default function SystemPromptPlaceholder(props: {
  number?: number;
  stickyOffset?: number;
  rowOffset?: number;
  selection?: { value: string; options: SelectOption[]; onChange: (value: string) => void };
}) {
  const style = (): JSX.CSSProperties | undefined => props.stickyOffset === undefined ? undefined : {
    position: props.rowOffset === undefined ? 'relative' : 'absolute', 'z-index': 1,
    top: props.rowOffset === undefined ? undefined : `${props.rowOffset}px`,
    width: props.rowOffset === undefined ? undefined : '100%',
    transform: `translateY(max(0px, calc(${props.stickyOffset}px + 1lh)))`,
  };
  const label = () => <>System prompt {props.number ?? 1}</>;
  return <Show when={props.selection} fallback={
    <A class="branch-draft system-prompt-reference empty-placeholder" style={style()}
      href="/system-prompt-creator" aria-label={`Edit System prompt ${props.number ?? 1}`}>{label()}</A>
  }>{selection => <SelectWithDialog label="Select system prompt" value={selection().value} options={selection().options}
    onChange={value => selection().onChange(value)} class="branch-draft system-prompt-reference empty-placeholder" style={style()}>{label()}</SelectWithDialog>}
  </Show>;
}

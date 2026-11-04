import { A, useLocation } from '@solidjs/router';
import { sessionPath, sessionUrlIdFromPath } from './session-urls';
import { promptLabel } from './prompt-numbers';
import { Show, type JSX } from 'solid-js';
import SelectWithDialog, { type SelectOption } from './SelectWithDialog';

export default function SystemPromptPlaceholder(props: {
  number?: number;
  title?: string;
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
  const location = useLocation();
  const label = () => promptLabel(props.number ?? 1, props.title);
  return <Show when={props.selection} fallback={
    <A class="branch-draft system-prompt-reference empty-placeholder" style={style()}
      href={sessionPath('/system-prompt-creator', sessionUrlIdFromPath(location.pathname))} aria-label={`Edit ${label()}`}>{label()}</A>
  }>{selection => <SelectWithDialog label="Select system prompt" value={selection().value} options={selection().options}
    onChange={value => selection().onChange(value)} class="branch-draft system-prompt-reference empty-placeholder" style={style()}>{label()}</SelectWithDialog>}
  </Show>;
}

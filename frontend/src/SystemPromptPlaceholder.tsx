import { A, useLocation } from '@solidjs/router';
import { sessionPath, sessionUrlIdFromPath } from './session-urls';
import { promptLabel } from './prompt-numbers';
import { Show, type JSX } from 'solid-js';
import SelectWithDialog, { type SelectOption } from './SelectWithDialog';
import AgentHealth from './AgentHealth';

export default function SystemPromptPlaceholder(props: {
  model?: { label: string; value: string; inheritedLabel: string; options: SelectOption[]; onChange: (value: string) => void };
  number?: number;
  title?: string;
  stickyOffset?: number;
  rowOffset?: number;
  selection?: { value: string; leadingOption?: SelectOption; options: SelectOption[]; onChange: (value: string) => void };
}) {
  const style = (): JSX.CSSProperties | undefined => props.stickyOffset === undefined ? undefined : {
    position: props.rowOffset === undefined ? 'relative' : 'absolute', 'z-index': 1,
    top: props.rowOffset === undefined ? undefined : `${props.rowOffset}px`,
    width: props.rowOffset === undefined ? undefined : '100%',
    transform: `translateY(max(0px, ${props.stickyOffset}px))`,
  };
  const location = useLocation();
  const label = () => promptLabel(props.number ?? 1, props.title);
  return <div class="branch-configuration branch-draft" style={style()}><Show when={props.selection} fallback={
    <A class="system-prompt-reference empty-placeholder"
      href={sessionPath('/system-prompt-creator', sessionUrlIdFromPath(location.pathname))} aria-label={`Edit ${label()}`}><span>{label()}</span><AgentHealth placeholder /></A>
  }>{selection => <SelectWithDialog label="Select system prompt" value={selection().value} leadingOption={selection().leadingOption} options={selection().options}
    onChange={value => selection().onChange(value)} class="system-prompt-reference empty-placeholder"><span>{label()}</span></SelectWithDialog>}
  </Show><Show when={props.model}>{model => <SelectWithDialog label="Select branch model" value={model().value}
    options={model().options} leadingOption={{ value: '', label: model().inheritedLabel }} onChange={value => model().onChange(value)} class="text-action branch-model">
    <span>{model().label}</span><AgentHealth placeholder />
  </SelectWithDialog>}</Show></div>;
}

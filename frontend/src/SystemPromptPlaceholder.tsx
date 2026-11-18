import { A } from '@solidjs/router';
import { promptLabel } from './prompt-numbers';
import { Show, type JSX } from 'solid-js';
import SelectWithDialog, { type SelectOption } from './SelectWithDialog';
import AgentHealth from './AgentHealth';

export interface PlaceholderSelection {
  value: string;
  label?: string;
  leadingOption?: SelectOption;
  options: SelectOption[];
  onChange: (value: string) => void;
  onOpen?: () => void;
}

export default function SystemPromptPlaceholder(props: {
  model?: PlaceholderSelection;
  thinking?: PlaceholderSelection;
  editPromptHref?: string;
  onEditPrompt?: () => void;
  number?: number;
  title?: string;
  stickyOffset?: number;
  rowOffset?: number;
  selection?: PlaceholderSelection;
}) {
  const style = (): JSX.CSSProperties | undefined => props.stickyOffset === undefined ? undefined : {
    position: props.rowOffset === undefined ? 'relative' : 'absolute', 'z-index': 1,
    top: props.rowOffset === undefined ? undefined : `${props.rowOffset}px`,
    width: props.rowOffset === undefined ? undefined : '100%',
    transform: `translateY(max(0px, ${props.stickyOffset}px))`,
  };
  const label = () => promptLabel(props.number ?? 1, props.title);
  return <div class="branch-configuration branch-draft" style={style()}><Show when={props.selection} fallback={
    <Show when={props.onEditPrompt} fallback={<A class="system-prompt-reference empty-placeholder"
      href={props.editPromptHref ?? '/system-prompt-creator'} aria-label={`Edit ${label()}`}><span>{label()}</span><Show when={!props.model}><AgentHealth placeholder /></Show></A>}>
      <button class="system-prompt-reference empty-placeholder" aria-label="Edit system prompt" onClick={() => props.onEditPrompt?.()}><span>{label()}</span></button>
    </Show>
  }>{selection => <SelectWithDialog label="Select system prompt" value={selection().value} leadingOption={selection().leadingOption} options={selection().options}
    onChange={value => selection().onChange(value)} class="system-prompt-reference empty-placeholder"><span>{label()}</span></SelectWithDialog>}
  </Show><Show when={props.model}>{model => <span class="branch-model"><SelectWithDialog label="Select branch model" value={model().value}
    onOpen={model().onOpen} options={model().options} leadingOption={model().leadingOption} onChange={value => model().onChange(value)} class="text-action">
    <span>{model().label ?? model().value}</span>
  </SelectWithDialog><Show when={props.thinking}>{thinking => <SelectWithDialog label="Thinking level" value={thinking().value}
    options={thinking().options} onChange={thinking().onChange} class="text-action branch-thinking"><span>({thinking().label ?? thinking().value})</span></SelectWithDialog>}</Show><AgentHealth placeholder /></span>}</Show></div>;
}

import { Show, type JSX } from 'solid-js';
import Navigation from './Navigation';

interface Props {
  active?: boolean;
  label: string;
  children: JSX.Element;
  actions?: JSX.Element;
  onOptions?: () => void;
  hasContent: boolean;
  mode: 'focused' | 'side';
  onMode: (mode: 'focused' | 'side') => void;
}

export default function ColumnToolbar(props: Props) {
  return <Navigation active={props.active} options={
    <Show when={props.onOptions}>
      <button onClick={() => props.onOptions?.()}>Options</button>
    </Show>
  }><nav class="tree-toolbar" aria-label={props.label}>
    {props.children}
    <Show when={props.hasContent}>
      <div class="view-switch" role="group" aria-label="View mode">
        <button class="view-mode state-toggle" aria-pressed={props.mode === 'focused'} onClick={() => props.onMode('focused')}>Single</button>
        <button class="view-mode state-toggle" aria-pressed={props.mode === 'side'} onClick={() => props.onMode('side')}>Tree</button>
      </div>
    </Show>
    {props.actions}
  </nav></Navigation>;
}

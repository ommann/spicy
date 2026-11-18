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
  modeHref?: (mode: 'focused' | 'side') => string;
  onModeLink?: (mode: 'focused' | 'side') => void;
}

export default function ColumnToolbar(props: Props) {
  return <Navigation active={props.active} options={
    <Show when={props.onOptions}>
      <button onClick={() => props.onOptions?.()}>Options</button>
    </Show>
  }><nav class="tree-toolbar" aria-label={props.label}>
    {props.children}
    {props.actions}
  </nav></Navigation>;
}

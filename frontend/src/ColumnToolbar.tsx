import { For, Show, type JSX } from 'solid-js';
import Navigation from './Navigation';
import { A } from '@solidjs/router';

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
    <Show when={props.hasContent}>
      <div class="view-switch" role="group" aria-label="View mode">
        <Show when={props.modeHref} fallback={<>
          <button class="view-mode state-toggle" aria-pressed={props.mode === 'focused'} onClick={() => props.onMode('focused')}>Single</button>
          <button class="view-mode state-toggle" aria-pressed={props.mode === 'side'} onClick={() => props.onMode('side')}>Tree</button>
        </>}>
          <For each={['focused', 'side'] as const}>{mode => <A class="view-mode state-toggle"
            href={props.modeHref!(mode)} aria-current={props.mode === mode ? 'page' : undefined}
            onClick={event => {
              if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              props.onModeLink?.(mode);
            }}>{mode === 'focused' ? 'Single' : 'Tree'}</A>}</For>
        </Show>
      </div>
    </Show>
    {props.actions}
  </nav></Navigation>;
}

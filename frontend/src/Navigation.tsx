import { Show, createSignal, useContext, type JSX } from 'solid-js';
import { NavigationLinksContext } from './navigation-context';

import Usage from './Usage';

/** Shared navigation layout; each view supplies its own options and controls. */
export default function Navigation(props: { children?: JSX.Element; options?: JSX.Element; active?: boolean }) {
  const links = useContext(NavigationLinksContext);
  const [usageOpen, setUsageOpen] = createSignal(false);
  return <Show when={props.active !== false}>
    <header class="tree-toolbar app-toolbar" aria-label="Application navigation">
      {links()}
      <button type="button" onClick={() => setUsageOpen(true)}>Usage</button>
      {props.options}
      <div class="app-toolbar-actions">{props.children}</div>
      <Show when={usageOpen()}><Usage onClose={() => setUsageOpen(false)} /></Show>
    </header>
  </Show>;
}

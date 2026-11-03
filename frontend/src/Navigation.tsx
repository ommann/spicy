import { Show, createContext, useContext, type JSX } from 'solid-js';

export const NavigationLinksContext = createContext<() => JSX.Element>(() => null);

/** Shared navigation layout; each view supplies its own options and controls. */
export default function Navigation(props: { children?: JSX.Element; options?: JSX.Element; active?: boolean }) {
  const links = useContext(NavigationLinksContext);
  return <Show when={props.active !== false}>
    <header class="tree-toolbar app-toolbar" aria-label="Application navigation">
      {links()}
      {props.options}
      <div class="app-toolbar-actions">{props.children}</div>
    </header>
  </Show>;
}

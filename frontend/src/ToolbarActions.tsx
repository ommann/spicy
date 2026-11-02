import { Show, createContext, useContext, type Accessor, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

export const ToolbarActionsContext = createContext<Accessor<HTMLElement | undefined>>();

export default function ToolbarActions(props: { children: JSX.Element; active?: boolean }) {
  const target = useContext(ToolbarActionsContext);
  return <Show when={props.active !== false}>
    <Show when={target?.()} fallback={target ? null : props.children}>{element =>
      <Portal mount={element()}>{props.children}</Portal>
    }</Show>
  </Show>;
}

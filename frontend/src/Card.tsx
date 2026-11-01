import { For, splitProps, type JSX } from 'solid-js';

type Props = JSX.HTMLAttributes<HTMLElement> & { anchors?: string[] };

export default function Card(props: Props) {
  const [local, attributes] = splitProps(props, ['children', 'class', 'anchors']);

  return <section {...attributes} class={`tree-card${local.class ? ` ${local.class}` : ''}`}>
    <div class="tree-card-body">{local.children}</div>
    <For each={local.anchors || []}>{label => (
      <div class="anchor-marker" data-anchor={label}>{label.replace(/^anchor:/, '')}</div>
    )}</For>
  </section>;
}

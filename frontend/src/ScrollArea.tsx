import { Show, createSignal, createUniqueId, onCleanup, onMount, type JSX } from 'solid-js';
import ScrollBar from './ScrollBar';

interface Props {
  children: JSX.Element;
  class?: string;
  contentClass?: string;
  contentStyle?: JSX.CSSProperties;
  contentClassList?: Record<string, boolean>;
  vertical?: boolean;
  viewportRef?: (element: HTMLDivElement) => void;
  events?: JSX.HTMLAttributes<HTMLDivElement>;
}

export default function ScrollArea(props: Props) {
  const id = `scroll-area-${createUniqueId()}`;
  let viewport!: HTMLDivElement;
  let content!: HTMLDivElement;
  const [metrics, setMetrics] = createSignal({ left: 0, top: 0, width: 0, height: 0, clientWidth: 0, clientHeight: 0 });
  function measure() {
    setMetrics(previous => {
      const next = { left: viewport.scrollLeft, top: viewport.scrollTop, width: viewport.scrollWidth,
        height: viewport.scrollHeight, clientWidth: viewport.clientWidth, clientHeight: viewport.clientHeight };
      return Object.keys(next).every(key => next[key as keyof typeof next] === previous[key as keyof typeof next]) ? previous : next;
    });
  }
  onMount(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    const mutations = new MutationObserver(measure);
    mutations.observe(content, { childList: true, subtree: true, characterData: true, attributes: true });
    measure();
    onCleanup(() => { observer.disconnect(); mutations.disconnect(); });
  });
  const horizontal = () => metrics().width > metrics().clientWidth;
  const vertical = () => !!props.vertical && metrics().height > metrics().clientHeight;

  return <div class={`custom-scroll-area${props.class ? ` ${props.class}` : ''}`}
    classList={{ 'scroll-area-horizontal': horizontal(), 'scroll-area-vertical': vertical() }}>
    <div {...props.events} id={id} class="scroll-area-viewport" ref={element => { viewport = element; props.viewportRef?.(element); }}
      onScroll={event => {
        measure();
        const handler = props.events?.onScroll;
        if (typeof handler === 'function') handler(event);
      }}>
      <div ref={content} style={props.contentStyle} class={`scroll-area-content${props.contentClass ? ` ${props.contentClass}` : ''}`} classList={props.contentClassList}>
        {props.children}
      </div>
    </div>
    <Show when={horizontal()}><ScrollBar controls={id} position={metrics().left} client={metrics().clientWidth} extent={metrics().width}
      onChange={left => { viewport.scrollLeft = left; measure(); }} /></Show>
    <Show when={vertical()}><ScrollBar controls={id} vertical position={metrics().top} client={metrics().clientHeight} extent={metrics().height}
      onChange={top => { viewport.scrollTop = top; measure(); }} /></Show>
  </div>;
}

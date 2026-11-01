import { Show, createEffect, createSignal, createUniqueId, on, onCleanup, onMount, splitProps, type JSX } from 'solid-js';
import ScrollBar from './ScrollBar';

export default function ScrollableTextarea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [local, rest] = splitProps(props, ['ref']);
  const id = createUniqueId();
  let input!: HTMLTextAreaElement;
  const [metrics, setMetrics] = createSignal({ top: 0, left: 0, height: 0, width: 0, clientHeight: 0, clientWidth: 0 });
  function measure() {
    if (!input) return;
    const next = { top: input.scrollTop, left: input.scrollLeft, height: input.scrollHeight, width: input.scrollWidth,
      clientHeight: input.clientHeight, clientWidth: input.clientWidth };
    setMetrics(previous => Object.keys(next).every(key => next[key as keyof typeof next] === previous[key as keyof typeof next]) ? previous : next);
  }
  createEffect(on([() => props.value, () => props.style], () => queueMicrotask(measure)));
  onMount(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(input);
    input.addEventListener('scroll', measure);
    input.addEventListener('input', measure);
    measure();
    onCleanup(() => { observer.disconnect(); input.removeEventListener('scroll', measure); input.removeEventListener('input', measure); });
  });
  const vertical = () => metrics().height > metrics().clientHeight;
  const horizontal = () => metrics().width > metrics().clientWidth;
  return <div class="custom-scroll-area textarea-scroll-area" classList={{ 'scroll-area-vertical': vertical(), 'scroll-area-horizontal': horizontal() }}>
    <textarea {...rest} id={props.id || id} ref={element => {
      input = element;
      if (typeof local.ref === 'function') local.ref(element);
    }} />
    <Show when={vertical()}><ScrollBar controls={props.id || id} vertical position={metrics().top} client={metrics().clientHeight} extent={metrics().height}
      onChange={top => { input.scrollTop = top; measure(); }} /></Show>
    <Show when={horizontal()}><ScrollBar controls={props.id || id} position={metrics().left} client={metrics().clientWidth} extent={metrics().width}
      onChange={left => { input.scrollLeft = left; measure(); }} /></Show>
  </div>;
}

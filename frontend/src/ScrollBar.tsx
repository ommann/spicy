import { createMemo, createSignal, onCleanup, onMount } from 'solid-js';

interface Props {
  vertical?: boolean;
  controls?: string;
  position: number;
  client: number;
  extent: number;
  onChange: (position: number) => void;
}

export default function ScrollBar(props: Props) {
  const [length, setLength] = createSignal(0);
  let track!: HTMLDivElement;
  let thumb!: HTMLDivElement;
  let drag: { coordinate: number; position: number } | undefined;
  const geometry = createMemo(() => {
    const size = Math.min(length(), Math.max(28, length() * props.client / Math.max(1, props.extent)));
    const max = Math.max(0, props.extent - props.client);

    return { size, max, travel: length() - size, offset: max ? props.position / max * (length() - size) : 0 };
  });

  onMount(() => {
    const measure = () => setLength(props.vertical ? track.clientHeight : track.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    measure();
    onCleanup(() => observer.disconnect());
  });

  const coordinate = (event: PointerEvent) => props.vertical ? event.clientY : event.clientX;

  return <div ref={track} class={`canvas-scrollbar ${props.vertical ? 'vertical' : 'horizontal'}`} tabIndex={0}
    role="scrollbar" aria-controls={props.controls || 'trace-viewport'} aria-label={props.vertical ? 'Vertical scroll' : 'Horizontal scroll'}
    aria-orientation={props.vertical ? 'vertical' : 'horizontal'} aria-valuemin={0}
    aria-valuemax={Math.round(geometry().max)} aria-valuenow={Math.round(props.position)}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (event.target !== thumb) {
        const rect = thumb.getBoundingClientRect();
        props.onChange(props.position + (coordinate(event) < (props.vertical ? rect.top : rect.left) ? -1 : 1) * props.client * .9);
        return;
      }
      drag = { coordinate: coordinate(event), position: props.position };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      if (drag && geometry().travel) props.onChange(drag.position + (coordinate(event) - drag.coordinate) / geometry().travel * geometry().max);
    }}
    onPointerUp={() => { drag = undefined; }} onPointerCancel={() => { drag = undefined; }}
    onWheel={event => { event.preventDefault(); props.onChange(props.position + (props.vertical ? event.deltaY : event.deltaX || event.deltaY)); }}
    onKeyDown={event => {
      const backward = props.vertical ? 'ArrowUp' : 'ArrowLeft';
      const forward = props.vertical ? 'ArrowDown' : 'ArrowRight';
      if (![backward, forward, 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      props.onChange(event.key === 'Home' ? 0 : event.key === 'End' ? geometry().max
        : props.position + (event.key === backward || event.key === 'PageUp' ? -1 : 1) * (event.key.startsWith('Page') ? props.client * .9 : 40));
    }}>
    <div ref={thumb} class="canvas-scroll-thumb" style={props.vertical
      ? { height: `${geometry().size}px`, top: `${geometry().offset}px` }
      : { width: `${geometry().size}px`, left: `${geometry().offset}px` }} />
  </div>;
}

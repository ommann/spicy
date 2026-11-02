import { createSignal } from 'solid-js';

interface Options {
  viewport: () => HTMLElement;
  enabled: () => boolean;
  columns?: () => { inset: number; starts: number[]; width: number };
  onColumn?: (index: number) => void;
  onScroll?: () => void;
}

// Both trace views use viewport-relative pointer tracking. Scrolling under a
// stationary mouse changes the active column without moving focus or scrolling.
export function createColumnInteraction(options: Options) {
  const [space, setSpace] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);
  const [jumping, setJumping] = createSignal(false);
  let pointerX: number | null = null;
  let drag: { x: number; y: number; left: number; top: number } | undefined;

  function followPointer() {
    if (!options.enabled() || !options.columns || !options.onColumn || pointerX === null || dragging() || jumping()) return;
    const { inset, starts, width } = options.columns();
    const x = options.viewport().scrollLeft + pointerX - inset;
    const lane = starts.findIndex(start => x < start + width + 24);
    if (x >= 0 && lane >= 0) options.onColumn(lane);
  }

  function resetPointer() { pointerX = null; }
  function release() { drag = undefined; setDragging(false); }
  function blur() { setSpace(false); release(); resetPointer(); }

  const handlers = {
    onScroll: () => { options.onScroll?.(); followPointer(); },
    onScrollEnd: () => setJumping(false),
    onWheel: (event: WheelEvent) => {
      setJumping(false);
      if (event.shiftKey && event.deltaY && !event.deltaX) {
        event.preventDefault();
        options.viewport().scrollLeft += event.deltaY;
        options.onScroll?.();
        followPointer();
      }
    },
    onPointerDown: (event: PointerEvent) => {
      setJumping(false);
      if (!space() && event.button !== 1) return;
      event.preventDefault();
      const viewport = options.viewport();
      drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
      viewport.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    onPointerMove: (event: PointerEvent) => {
      const viewport = options.viewport();
      if (drag) {
        event.preventDefault();
        viewport.scrollTo({ left: drag.left - event.clientX + drag.x, top: drag.top - event.clientY + drag.y, behavior: 'instant' });
        options.onScroll?.();
      } else if (event.pointerType === 'mouse' && !jumping()) {
        pointerX = event.clientX - viewport.getBoundingClientRect().left;
        followPointer();
      }
    },
    onPointerLeave: resetPointer,
    onPointerUp: release,
    onPointerCancel: release,
  };

  function keydown(event: KeyboardEvent) {
    if (event.code !== 'Space' || event.defaultPrevented || event.isComposing ||
      (event.target as Element).closest('input, textarea, button, select, summary, [contenteditable="true"]')) return false;
    event.preventDefault();
    setSpace(true);
    return true;
  }

  return { handlers, space, dragging, setJumping, resetPointer, blur, keydown,
    keyup: (event: KeyboardEvent) => { if (event.code === 'Space') setSpace(false); } };
}

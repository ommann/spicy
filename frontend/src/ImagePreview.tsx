import Dialog from './Dialog';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';

export interface PreviewImage {
  src: string;
  alt: string;
  caption: string;
  opener: HTMLElement;
  images?: { src: string; alt: string; caption: string }[];
  index?: number;
}

export default function ImagePreview(props: { image: PreviewImage; onClose: () => void }) {
  let dialog!: HTMLDialogElement;
  const [index, setIndex] = createSignal(0);
  const images = () => props.image.images?.length ? props.image.images : [props.image];
  createEffect(() => setIndex(Math.max(0, Math.min(props.image.index ?? 0, images().length - 1))));
  const current = () => images()[index()] || props.image;
  function move(delta: number) {
    setIndex(value => Math.max(0, Math.min(images().length - 1, value + delta)));
  }

  onCleanup(() => {
    props.image.opener.focus({ preventScroll: true });
  });

  return <Dialog open class="" id="image-preview" ref={dialog} aria-label="Image preview" onClose={() => props.onClose()}
    onKeyDown={event => {
      if (images().length < 2 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      event.stopPropagation();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    }}
    onClick={event => {
      if (event.target !== dialog) return;

      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) props.onClose();
    }}>
    <div class="image-preview-header">
      <span class="image-preview-caption">{current().caption}</span>
      <Show when={images().length > 1}>
        <span class="image-preview-count" aria-live="polite" aria-atomic="true">{index() + 1}/{images().length}</span>
        <button type="button" aria-label="Previous image" disabled={index() === 0} onClick={() => move(-1)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M 12 2 L 4 8 L 12 14 Z" /></svg>
        </button>
        <button type="button" aria-label="Next image" disabled={index() === images().length - 1} onClick={() => move(1)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M 4 2 L 12 8 L 4 14 Z" /></svg>
        </button>
      </Show>
      <button onClick={() => props.onClose()}>Close</button>
    </div>
    <img class="image-preview-image" src={current().src} alt={current().alt} />
  </Dialog>;
}

import Dialog from './Dialog';
import { onCleanup } from 'solid-js';

export interface PreviewImage {
  src: string;
  alt: string;
  caption: string;
  opener: HTMLElement;
}

export default function ImagePreview(props: { image: PreviewImage; onClose: () => void }) {
  let dialog!: HTMLDialogElement;

  onCleanup(() => {
    props.image.opener.focus({ preventScroll: true });
  });

  return <Dialog open class="" id="image-preview" ref={dialog} aria-label="Image preview" onClose={() => props.onClose()}
    onClick={event => {
      if (event.target !== dialog) return;

      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) props.onClose();
    }}>
    <div class="image-preview-header">
      <span class="image-preview-caption">{props.image.caption}</span>
      <button onClick={() => props.onClose()}>Close</button>
    </div>
    <img class="image-preview-image" src={props.image.src} alt={props.image.alt} />
  </Dialog>;
}

import { createContext } from 'solid-js';
import type { PreviewImage } from './ImagePreview';

export const ImageContext = createContext<(image: PreviewImage) => void>();
export const SectionContext = createContext<(element: HTMLElement) => void>();

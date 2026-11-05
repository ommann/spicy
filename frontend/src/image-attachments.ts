export interface ImageAttachment { type: 'image'; data: string; mimeType: string }
export const imageSource = (image: ImageAttachment) => `data:${image.mimeType};base64,${image.data}`;
export async function clipboardImages(items: DataTransferItemList): Promise<ImageAttachment[]> {
  const files = Array.from(items).filter(item => item.kind === 'file' && /^image\/(png|jpeg|webp|gif)$/.test(item.type)).map(item => item.getAsFile()).filter((file): file is File => !!file);
  return Promise.all(files.map(file => new Promise<ImageAttachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read pasted image'));
    reader.onload = () => resolve({ type: 'image', mimeType: file.type, data: String(reader.result).split(',')[1] });
    reader.readAsDataURL(file);
  })));
}

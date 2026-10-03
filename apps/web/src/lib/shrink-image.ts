/**
 * Shrinks a photo on the device before it travels.
 *
 * A twelve-megapixel photo is three megabytes of paper texture. Redrawn with
 * its longest side at `maxSide`, it keeps every line a reader needs and fits in
 * one request. Anything that is not an image, is already small, or would come
 * out heavier is returned as it was.
 */
export async function shrinkImage(file: File, maxSide = 2000): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 1_200_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.85);
    });
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

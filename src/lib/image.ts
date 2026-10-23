'use client';

/**
 * Shrinks a photo before upload (longest side 2000px, JPEG) so moodboards load quickly on phones. GIFs are kept as
 * they are so they still move. Returns the file to upload and its extension.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; ext: 'jpg' | 'png' | 'webp' | 'gif'; type: string }> {
  if (file.type === 'image/gif') return { blob: file, ext: 'gif', type: 'image/gif' };
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) throw new Error(`${file.name} is not a photo.`);
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error(`${file.name} could not be read. Try saving it as a JPEG first.`); });
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not prepare the image'))), 'image/jpeg', 0.86));
  return { blob, ext: 'jpg', type: 'image/jpeg' };
}

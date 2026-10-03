export const PHOTO_LIMIT = 5 * 1024 * 1024;
export const AUDIO_LIMIT = 10 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4'];

export function validateAttachment(file, kind) {
  const mime = file?.type?.split(';')[0];
  const allowed = kind === 'photo' ? PHOTO_TYPES : AUDIO_TYPES;
  const limit = kind === 'photo' ? PHOTO_LIMIT : AUDIO_LIMIT;
  if (!file || !allowed.includes(mime) || !file.size || file.size > limit) {
    throw new Error(kind === 'photo' ? 'Choose a JPG, PNG or WebP photo up to 5 MB.' : 'Voice must be WebM, Ogg or MP4 and at most 10 MB.');
  }
  return mime;
}

export async function validatePhoto(file) {
  validateAttachment(file, 'photo');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte);
  const webp = String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (!(file.type === 'image/jpeg' && jpeg || file.type === 'image/png' && png || file.type === 'image/webp' && webp)) {
    throw new Error('The selected file is not a supported image.');
  }
}

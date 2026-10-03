// New rows use semantic kinds; recognize old MIME-valued rows without rewriting them.
export function evidenceKind(file) {
  if (file?.media_type === 'image' || file?.media_type === 'audio') return file.media_type;
  const mime = file?.mime_type || file?.media_type || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

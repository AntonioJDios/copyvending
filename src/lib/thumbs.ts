import { useEffect, useState } from 'react';
import { uploadService } from './uploads';
import { dataUrlToFile } from './imageDownscale';

/**
 * Order thumbnails (the little previews of each document and of the mug/badge
 * artwork) live in R2 like every other file, NOT inside the order row.
 *
 * They used to travel as data URLs inside the order's JSON, which meant the
 * database — the most expensive storage here, and the one with the tightest free
 * tier — filled up with images instead of data. They are small individually
 * (~10-60 KB) but they are the bulk of what an order weighs, and every listing
 * query dragged them along even when nothing was displayed.
 *
 * Old orders keep their inline `thumb`/`preview`, so both paths must work: prefer
 * the key, fall back to the inline image.
 */

/** Upload a thumbnail data URL and return its storage key (null if it can't). */
export async function uploadThumb(dataUrl: string, projectId: string, name = 'thumb.jpg'): Promise<string | null> {
  if (!dataUrl.startsWith('data:')) return null;
  try {
    const file = await dataUrlToFile(dataUrl, name);
    const { key } = await uploadService.upload(file, { projectId });
    return key;
  } catch {
    // Never block adding to the cart because a preview failed to upload: the
    // order is what matters, and the caller keeps the inline image as fallback.
    return null;
  }
}

// Signed URLs cost a round-trip and last an hour, so resolve each key once per
// page load and share it between every component that shows the same image.
const cache = new Map<string, Promise<string | undefined>>();

function resolve(key: string, token?: string): Promise<string | undefined> {
  const id = `${key}|${token ?? ''}`;
  let p = cache.get(id);
  if (!p) {
    p = uploadService.getObjectURL(key, token).catch(() => undefined);
    cache.set(id, p);
  }
  return p;
}

/**
 * Resolve a stored thumbnail to a displayable URL.
 *
 * @param key      storage key, when the thumbnail lives in R2
 * @param token    the project's capability token (see api/presign)
 * @param fallback inline data URL of older orders
 */
export function useStoredImage(key: string | undefined, token: string | undefined, fallback?: string): string | undefined {
  const [url, setUrl] = useState<string | undefined>(fallback);

  useEffect(() => {
    if (!key) {
      setUrl(fallback);
      return;
    }
    let alive = true;
    void resolve(key, token).then((u) => {
      // Keep showing the fallback if the signed URL can't be obtained.
      if (alive && u) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [key, token, fallback]);

  return url;
}

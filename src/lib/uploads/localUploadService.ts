import { createStore, del, get, set } from 'idb-keyval';
import type { UploadResult, UploadService } from './types';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Persistent local store so the demo survives reloads and works when deployed
// (e.g. on Vercel) without any backend. Same browser only — the Vercel Blob /
// R2 adapter will make files reachable across devices.
const store = createStore('copisteria-uploads', 'blobs');

/**
 * Development / demo adapter: persists blobs in IndexedDB and simulates chunked
 * progress so the real upload UX can be built and shown without a backend. The
 * R2/Blob adapter will implement this same interface.
 */
export class LocalUploadService implements UploadService {
  async upload(file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<UploadResult> {
    const key = `local/${crypto.randomUUID()}`;
    const steps = 15;
    const mb = file.size / (1024 * 1024);
    const total = Math.min(2500, Math.max(400, mb * 50));
    onProgress?.(0);
    for (let i = 1; i <= steps; i++) {
      if (signal?.aborted) throw new DOMException('Subida cancelada', 'AbortError');
      await delay(total / steps);
      onProgress?.(i / steps);
    }
    await set(key, file, store);
    return { key };
  }

  async getBlob(key: string): Promise<Blob | undefined> {
    return (await get<Blob>(key, store)) ?? undefined;
  }

  async getObjectURL(key: string): Promise<string | undefined> {
    const blob = await this.getBlob(key);
    return blob ? URL.createObjectURL(blob) : undefined;
  }

  async remove(key: string): Promise<void> {
    await del(key, store);
  }
}

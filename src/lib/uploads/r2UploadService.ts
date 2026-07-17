import type { UploadResult, UploadService } from './types';

/**
 * Real adapter: asks the signing Worker for a presigned URL and uploads the
 * file directly to R2 (the bytes never pass through the Worker → no size
 * limits). Downloads/deletes also go through short-lived presigned URLs.
 */
export class R2UploadService implements UploadService {
  private api: string;
  constructor(api: string) {
    this.api = api;
  }

  private async presign<T>(body: unknown): Promise<T> {
    const res = await fetch(`${this.api}/presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error || `Error ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async upload(file: File, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<UploadResult> {
    const { key, url } = await this.presign<{ key: string; url: string }>({
      op: 'put',
      name: file.name,
      type: file.type,
      size: file.size,
    });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      if (file.type) xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Error ${xhr.status}`)));
      xhr.onerror = () => reject(new Error('Fallo de red al subir'));
      xhr.onabort = () => reject(new DOMException('Subida cancelada', 'AbortError'));
      signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(file);
    });
    return { key };
  }

  async getObjectURL(key: string): Promise<string | undefined> {
    const { url } = await this.presign<{ url: string }>({ op: 'get', key });
    return url;
  }

  async getBlob(key: string): Promise<Blob | undefined> {
    const url = await this.getObjectURL(key);
    if (!url) return undefined;
    const res = await fetch(url);
    return res.ok ? await res.blob() : undefined;
  }

  async remove(key: string): Promise<void> {
    await this.presign({ op: 'delete', key });
  }
}

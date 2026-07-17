/**
 * Storage abstraction so the UI never talks to a provider directly. Today a
 * local (in-browser) adapter backs it; swapping in a Vercel Blob adapter later
 * (client uploads with a signed token) must not require any UI changes.
 */
export interface UploadResult {
  /** Opaque storage key/URL the backend understands. */
  key: string;
}

export interface UploadService {
  /** Upload a file, reporting progress (0..1). Rejects on abort/error. */
  upload(file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<UploadResult>;
  /** Resolve a displayable/downloadable URL for a stored key (if available). */
  getObjectURL(key: string): Promise<string | undefined>;
  /** Fetch the raw blob for a stored key (used to build the ZIP download). */
  getBlob(key: string): Promise<Blob | undefined>;
  /** Delete a stored object (used on remove / abandoned cleanup). */
  remove(key: string): Promise<void>;
}

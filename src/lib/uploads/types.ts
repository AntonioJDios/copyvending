/**
 * Storage abstraction so the UI never talks to a provider directly. A local
 * (IndexedDB) adapter and an API/R2 adapter both implement it; swapping between
 * them (VITE_API_BASE) requires no UI changes.
 */
export interface UploadResult {
  /** Opaque storage key the backend understands. */
  key: string;
}

export interface UploadOptions {
  /** UUID that groups a project's files into jobs/<projectId>/… in R2. */
  projectId?: string;
  /** Progress callback, 0..1. */
  onProgress?: (fraction: number) => void;
  /** Abort the in-flight upload. */
  signal?: AbortSignal;
}

export interface UploadService {
  /** Upload a file. Rejects on abort/error. */
  upload(file: File, opts?: UploadOptions): Promise<UploadResult>;
  /** Resolve a displayable/downloadable URL for a stored key (if available). */
  getObjectURL(key: string): Promise<string | undefined>;
  /** Fetch the raw blob for a stored key (used to build the ZIP download). */
  getBlob(key: string): Promise<Blob | undefined>;
  /** Delete a stored object (used on remove / abandoned cleanup). */
  remove(key: string): Promise<void>;
}

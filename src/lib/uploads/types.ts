/**
 * Storage abstraction so the UI never talks to a provider directly. A local
 * (IndexedDB) adapter and an API/R2 adapter both implement it; swapping between
 * them (VITE_API_BASE) requires no UI changes.
 */
export interface UploadResult {
  /** Opaque storage key the backend understands. */
  key: string;
  /**
   * Capability token for this project's folder, returned by the signing API.
   * Required to read or delete the project's files later (so a leaked key alone
   * grants nothing). Travels with the project into the cart and the order.
   * Absent in local mode, where files never leave the browser.
   */
  token?: string;
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
  getObjectURL(key: string, token?: string): Promise<string | undefined>;
  /** Fetch the raw blob for a stored key (used to build the ZIP download). */
  getBlob(key: string, token?: string): Promise<Blob | undefined>;
  /** Delete a stored object (used on remove / abandoned cleanup). */
  remove(key: string, token?: string): Promise<void>;
}

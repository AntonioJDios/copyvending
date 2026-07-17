import { API_BASE } from '../api';
import { LocalUploadService } from './localUploadService';
import { R2UploadService } from './r2UploadService';
import type { UploadService } from './types';

export type { UploadService, UploadResult, UploadOptions } from './types';

/** Max upload size and accepted types (shop policy; move to catalog later). */
export const MAX_FILE_MB = 300;
const ACCEPTED_PREFIXES = ['application/pdf', 'image/'];

/** Returns an error message if the file is not acceptable, else null. */
export function validateFile(file: File): string | null {
  const okType = ACCEPTED_PREFIXES.some((p) => file.type.startsWith(p));
  if (!okType) return 'formato no admitido (solo PDF o imagen)';
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `supera ${MAX_FILE_MB} MB`;
  if (file.size === 0) return 'archivo vacío';
  return null;
}

/** The single upload service used across the app. With a backend (VITE_API_BASE
 *  → /api/presign → R2) files are reachable across devices; otherwise the local
 *  IndexedDB adapter runs (demo without a backend). No UI changes either way. */
export const uploadService: UploadService = API_BASE ? new R2UploadService(API_BASE) : new LocalUploadService();

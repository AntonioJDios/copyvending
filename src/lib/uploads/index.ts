import { LocalUploadService } from './localUploadService';
import type { UploadService } from './types';

export type { UploadService, UploadResult } from './types';

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

/** The single upload service used across the app. Swap this line for the
 *  Vercel Blob adapter when the backend is ready — no UI changes needed. */
export const uploadService: UploadService = new LocalUploadService();

import type { CartProject } from '../store/useCart';
import { uploadService } from './uploads';

/** Delete every uploaded file that a project references from storage. Call this
 *  when the project is removed for good (cart "Quitar", empty cart, delete
 *  order) — NOT when merely editing it (the files are still needed). */
export async function deleteProjectFiles(project: CartProject): Promise<void> {
  if (project.kind !== 'copias') return;
  await Promise.all(project.docs.filter((d) => d.storageKey).map((d) => uploadService.remove(d.storageKey!)));
}

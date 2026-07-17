import { create } from 'zustand';
import type { Configuracion, DocFile } from '../domain/types';

/** A document as stored in the cart (no live File handle, just what we draw). */
export interface CartDoc {
  id: string;
  name: string;
  pages: number;
  thumb?: string;
  color: DocFile['color'];
  /** Storage key of the uploaded file (so the shop can fetch it to print). */
  storageKey?: string;
}

interface CartBase {
  id: string;
  nombre: string;
  total: number;
}

/** A copy-shop print project (documents + print options). */
export interface CopiasProject extends CartBase {
  kind: 'copias';
  config: Configuracion;
  docs: CartDoc[];
  copias: number;
  comentario: string;
  colorAnillas: string;
  colorContraportada: string;
}

/** A personalised mug. */
export interface TazaProject extends CartBase {
  kind: 'taza';
  /** Cropped photo preview (data URL). */
  preview: string;
  cantidad: number;
}

/** A personalised badge/pin. */
export interface ChapaProject extends CartBase {
  kind: 'chapa';
  preview: string;
  back: string;
  sizeMm: number;
  cantidad: number;
}

export type CartProject = CopiasProject | TazaProject | ChapaProject;

interface CartState {
  items: CartProject[];
  add: (project: CartProject) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useCart = create<CartState>()((set) => ({
  items: [],
  add: (project) => set((s) => ({ items: [...s.items, project] })),
  remove: (id) => set((s) => ({ items: s.items.filter((p) => p.id !== id) })),
  clear: () => set({ items: [] }),
}));

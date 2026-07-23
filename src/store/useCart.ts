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
  /** Small display preview (downscaled data URL) — e.g. the 3D render snapshot. */
  preview: string;
  /** Storage key of the print-ready edited artwork (full-res, in R2/local). */
  printImageKey?: string;
  /** Legacy inline artwork (older orders); prefer printImageKey. */
  printImage?: string;
  cantidad: number;
}

/** A personalised badge/pin. */
export interface ChapaProject extends CartBase {
  kind: 'chapa';
  preview: string;
  /** Storage key of the print-ready edited artwork (full-res, in R2/local). */
  printImageKey?: string;
  /** Legacy inline artwork (older orders); prefer printImageKey. */
  printImage?: string;
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

// Persist the cart so a page refresh (or coming back from the Redsys redirect)
// doesn't lose the in-progress order. Files live in R2 by storageKey; the cart
// only holds their metadata + small thumbnails, so it's safe to store.
const KEY = 'copisteria/cart/v1';
function loadCart(): CartProject[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as CartProject[];
  } catch {
    /* corrupt/unavailable storage → empty cart */
  }
  return [];
}
function saveCart(items: CartProject[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* quota exceeded / unavailable → cart just won't persist (non-fatal) */
  }
}

export const useCart = create<CartState>()((set) => ({
  items: loadCart(),
  add: (project) =>
    set((s) => {
      const items = [...s.items, project];
      saveCart(items);
      return { items };
    }),
  remove: (id) =>
    set((s) => {
      const items = s.items.filter((p) => p.id !== id);
      saveCart(items);
      return { items };
    }),
  clear: () => {
    saveCart([]);
    set({ items: [] });
  },
}));

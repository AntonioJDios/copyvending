import { create } from 'zustand';
import { DEFAULT_CATALOG, type Catalog } from '../domain/catalog';
import { normalize } from '../domain/rules';
import type { Configuracion, DocFile } from '../domain/types';
import type { CartProject } from './useCart';
import { uploadService } from '../lib/uploads';

const CATALOG_KEY = 'copisteria/catalog/v6';

/** Load the admin-edited catalog from localStorage, or the defaults. */
export function loadCatalog(): Catalog {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Catalog;
      if (parsed && parsed.version === 6) return parsed;
    }
  } catch {
    /* ignore corrupt storage */
  }
  return DEFAULT_CATALOG;
}

export function saveCatalog(catalog: Catalog): void {
  localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
}

const DEFAULT_CONFIG: Configuracion = {
  size: 'A4',
  color: 'BN',
  grosor: 90,
  dobleCara: '0',
  orientacion: 'vertical',
  paginasPorHoja: 1,
  acabado: 'sinencuadernacion',
  acabadoFolios: 'normal',
  juntos: 'agrupados',
  sinMargenes: false,
  ladoEncuadernacion: 'largo',
  foliosDelante: 0,
  foliosDetras: 0,
};

interface ConfiguratorState {
  catalog: Catalog;
  config: Configuracion;
  files: DocFile[];
  copias: number;
  comentario: string;
  /** Customer-facing name for this print project. */
  nombreProyecto: string;
  /** Selected ring and back-cover colors (only meaningful for AnillasColores). */
  colorAnillas: string;
  colorContraportada: string;
  setCatalog: (catalog: Catalog) => void;
  setColorAnillas: (name: string) => void;
  setColorContraportada: (name: string) => void;
  setField: <K extends keyof Configuracion>(key: K, value: Configuracion[K]) => void;
  applyPreset: (id: string) => void;
  addFiles: (docs: DocFile[]) => void;
  removeFile: (id: string) => void;
  patchFile: (id: string, patch: Partial<DocFile>) => void;
  setFileColor: (id: string, color: DocFile['color']) => void;
  reorder: (fromId: string, toId: string) => void;
  setCopias: (n: number) => void;
  setComentario: (s: string) => void;
  setNombreProyecto: (s: string) => void;
  /** Clear the working project (files/name/comment) after adding to cart. */
  clearProject: () => void;
  /** Load a cart project snapshot back into the configurator for editing. */
  loadProject: (project: CartProject) => void;
}

const initialCatalog = loadCatalog();

export const useConfigurator = create<ConfiguratorState>()((set) => ({
  catalog: initialCatalog,
  config: DEFAULT_CONFIG,
  files: [],
  copias: 1,
  comentario: '',
  nombreProyecto: '',
  colorAnillas: initialCatalog.ringColors[0]?.name ?? '',
  colorContraportada: initialCatalog.coverColors[0]?.name ?? '',

  setCatalog: (catalog) => set((s) => ({ catalog, config: normalize(s.config, catalog) })),
  setColorAnillas: (colorAnillas) => set({ colorAnillas }),
  setColorContraportada: (colorContraportada) => set({ colorContraportada }),

  setField: (key, value) =>
    set((s) => ({ config: normalize({ ...s.config, [key]: value }, s.catalog) })),

  applyPreset: (id) =>
    set((s) => {
      const preset = s.catalog.presets.find((p) => p.id === id);
      if (!preset) return {};
      return { config: normalize({ ...s.config, ...preset.config }, s.catalog) };
    }),

  addFiles: (docs) => set((s) => ({ files: [...s.files, ...docs] })),
  removeFile: (id) => set((s) => ({ files: s.files.filter((f) => f.id !== id) })),
  patchFile: (id, patch) => set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
  setFileColor: (id, color) =>
    set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, color } : f)) })),

  reorder: (fromId, toId) =>
    set((s) => {
      const from = s.files.findIndex((f) => f.id === fromId);
      const to = s.files.findIndex((f) => f.id === toId);
      if (from < 0 || to < 0 || from === to) return {};
      const files = s.files.slice();
      const [moved] = files.splice(from, 1);
      files.splice(to, 0, moved);
      return { files };
    }),

  setCopias: (n) => set({ copias: Math.max(1, Math.floor(n) || 1) }),
  setComentario: (comentario) => set({ comentario }),
  setNombreProyecto: (nombreProyecto) => set({ nombreProyecto }),
  clearProject: () => set({ files: [], copias: 1, comentario: '', nombreProyecto: '' }),
  loadProject: (p) => {
    if (p.kind !== 'copias') return;
    set((s) => ({
      config: normalize({ ...p.config }, s.catalog),
      files: p.docs.map((d) => ({
        id: d.id,
        name: d.name,
        pages: d.pages,
        thumb: d.thumb,
        color: d.color,
        storageKey: d.storageKey,
        uploadStatus: d.storageKey ? ('done' as const) : undefined,
      })),
      copias: p.copias,
      comentario: p.comentario,
      nombreProyecto: p.nombre,
      colorAnillas: p.colorAnillas,
      colorContraportada: p.colorContraportada,
    }));
    // Files are persisted → rehydrate the original blob so preview/page-flip work.
    for (const d of p.docs) {
      if (!d.storageKey) continue;
      void uploadService.getBlob(d.storageKey).then((blob) => {
        if (!blob) return;
        const file = new File([blob], d.name, { type: blob.type || 'application/octet-stream' });
        set((s) => ({ files: s.files.map((f) => (f.id === d.id ? { ...f, source: file } : f)) }));
      });
    }
  },
}));

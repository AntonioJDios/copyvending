import { create } from 'zustand';
import { DEFAULT_CATALOG, type Catalog } from '../domain/catalog';
import { normalize } from '../domain/rules';
import type { Configuracion, DocFile } from '../domain/types';
import type { CartProject } from './useCart';
import { uploadService } from '../lib/uploads';
import { API_BASE, apiSend } from '../lib/api';

const CATALOG_KEY = 'copisteria/catalog/v6';

/** Load the admin-edited catalog from localStorage, or the defaults. Used as a
 *  fast local cache; when a backend is wired, fetchCatalog refreshes it from
 *  the shared settings so every device sees the same prices. */
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

/** Persist the catalog locally and, if a backend is wired, to the shared
 *  settings so the kiosk and backoffice stay in sync. */
export function saveCatalog(catalog: Catalog): void {
  localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
  if (API_BASE) void apiSend('PUT', '/catalog', catalog).catch(() => {/* offline cache still valid */});
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
  /** UUID that ties this working project's uploads into one R2 folder and, once
   *  added to the cart, becomes the project/order-item id. */
  proyectoId: string;
  /** Customer-facing name for this print project. */
  nombreProyecto: string;
  /** AI proposal for the uploaded files (config + explanation), or null. */
  suggestion: { reply: string; changes: Record<string, unknown> } | null;
  /** True while the uploaded files are being analysed for a suggestion. */
  analyzing: boolean;
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
  /** Refresh the catalog from the shared backend (if wired). */
  fetchCatalog: () => Promise<void>;
  setAnalyzing: (b: boolean) => void;
  setSuggestion: (s: { reply: string; changes: Record<string, unknown> } | null) => void;
  /** Apply the current AI suggestion to the config and clear it. */
  applySuggestion: () => void;
  dismissSuggestion: () => void;
}

const initialCatalog = loadCatalog();

export const useConfigurator = create<ConfiguratorState>()((set) => ({
  catalog: initialCatalog,
  config: DEFAULT_CONFIG,
  files: [],
  copias: 1,
  comentario: '',
  proyectoId: crypto.randomUUID(),
  nombreProyecto: '',
  suggestion: null,
  analyzing: false,
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
  clearProject: () =>
    set({ files: [], copias: 1, comentario: '', nombreProyecto: '', proyectoId: crypto.randomUUID(), suggestion: null, analyzing: false }),
  loadProject: (p) => {
    if (p.kind !== 'copias') return;
    set((s) => ({
      proyectoId: p.id,
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
  fetchCatalog: async () => {
    if (!API_BASE) return;
    try {
      const remote = (await (await fetch(`${API_BASE}/catalog`)).json()) as Catalog | null;
      if (remote && remote.version === 6) {
        localStorage.setItem(CATALOG_KEY, JSON.stringify(remote));
        set((s) => ({ catalog: remote, config: normalize(s.config, remote) }));
      }
    } catch {
      /* keep the local cache */
    }
  },

  setAnalyzing: (analyzing) => set({ analyzing }),
  setSuggestion: (suggestion) => set({ suggestion }),
  dismissSuggestion: () => set({ suggestion: null }),
  applySuggestion: () =>
    set((s) => {
      const ch = s.suggestion?.changes;
      if (!ch) return { suggestion: null };
      const cfgPatch: Record<string, unknown> = {};
      let copias = s.copias;
      let colorAnillas = s.colorAnillas;
      let colorContraportada = s.colorContraportada;
      let files = s.files;
      for (const [k, v] of Object.entries(ch)) {
        if (k === 'copias') copias = Math.max(1, Math.floor(Number(v)) || 1);
        else if (k === 'colorAnillas') colorAnillas = String(v);
        else if (k === 'colorContraportada') colorContraportada = String(v);
        else if (k === 'docColor') {
          const c = v === 'cover' || v === 'all' ? v : 'no';
          files = files.map((f) => ({ ...f, color: c }));
        } else cfgPatch[k] = v;
      }
      const config = normalize({ ...s.config, ...cfgPatch }, s.catalog);
      return { config, copias, colorAnillas, colorContraportada, files, suggestion: null };
    }),
}));

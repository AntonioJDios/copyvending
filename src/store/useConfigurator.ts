import { create } from 'zustand';
import { EMPTY_CATALOG, catalogForSource, type Catalog } from '../domain/catalog';
import { CURRENT_SOURCE } from '../lib/source';
import { normalize } from '../domain/rules';
import type { Configuracion, DocFile } from '../domain/types';
import type { CartProject } from './useCart';
import { uploadService } from '../lib/uploads';
import { API_BASE, apiSend } from '../lib/api';

const CATALOG_KEY = 'copisteria/catalog/v6';

/** True when a catalog actually carries prices (i.e. it came from the DB, not
 *  the empty skeleton). Prices live only in the DB, so an empty pagePrices map
 *  means "not loaded yet" — the shop must not price anything. */
export const hasPrices = (c: Catalog): boolean => Object.keys(c.pagePrices ?? {}).length > 0;

/** Load the last catalog seen by THIS browser (fast local cache only). The
 *  authoritative copy is always the one in the DB, which fetchCatalog pulls on
 *  every start; without a cache we begin with the price-less skeleton. */
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
  return EMPTY_CATALOG;
}

/** Persist the catalog locally and, if a backend is wired, to the shared
 *  settings so the kiosk and backoffice stay in sync. */
export function saveCatalog(catalog: Catalog): void {
  localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
  if (API_BASE) void apiSend('PUT', '/catalog', catalog).catch(() => {/* offline cache still valid */});
}

export const DEFAULT_CONFIG: Configuracion = {
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
  /** Effective catalog for THIS front's source (prices already resolved). Used
   *  by the configurator + pricing. */
  catalog: Catalog;
  /** Raw catalog with all sources' overrides — edited by the admin. */
  rawCatalog: Catalog;
  /** Whether a real (priced) catalog is available. False = prices unknown, so
   *  the UI must not show totals nor let an order through. */
  catalogLoaded: boolean;
  /** Set when the catalog could not be loaded, to explain it in the UI. */
  catalogError: string | null;
  config: Configuracion;
  files: DocFile[];
  copias: number;
  comentario: string;
  /** UUID that ties this working project's uploads into one R2 folder and, once
   *  added to the cart, becomes the project/order-item id. */
  proyectoId: string;
  /** Capability token for this project's uploaded files (set on first upload).
   *  Carried into the cart/order so the files can be re-read or deleted later. */
  proyectoToken?: string;
  setProyectoToken: (token: string | undefined) => void;
  /** Customer-facing name for this print project. */
  nombreProyecto: string;
  /** AI proposal for the uploaded files (config + explanation), or null. */
  suggestion: { reply: string; changes: Record<string, unknown> } | null;
  /** True while the uploaded files are being analysed for a suggestion. */
  analyzing: boolean;
  /** Deterministic pre-flight quality warnings for the uploaded files. */
  preflight: string[];
  /** When set, the configurator is editing an existing order (not a new project). */
  editingOrderId: string | null;
  /** Email the order was placed with — the server requires it (with the code) as
   *  proof of ownership before letting the customer rewrite the order. */
  editingOrderEmail: string | null;
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
  setEditingOrderEmail: (email: string | null) => void;
  /** Clear the working project (files/name/comment) after adding to cart. */
  clearProject: () => void;
  /** Load a cart project snapshot back into the configurator for editing. */
  loadProject: (project: CartProject) => void;
  /** Refresh the catalog from the shared backend (if wired). */
  fetchCatalog: () => Promise<void>;
  setAnalyzing: (b: boolean) => void;
  setPreflight: (w: string[]) => void;
  setSuggestion: (s: { reply: string; changes: Record<string, unknown> } | null) => void;
  /** Apply the current AI suggestion to the config and clear it. */
  applySuggestion: () => void;
  dismissSuggestion: () => void;
  setEditingOrderId: (id: string | null) => void;
}

const initialRaw = loadCatalog();
const initialCatalog = catalogForSource(initialRaw, CURRENT_SOURCE);

export const useConfigurator = create<ConfiguratorState>()((set) => ({
  catalog: initialCatalog,
  rawCatalog: initialRaw,
  catalogLoaded: hasPrices(initialCatalog),
  catalogError: null,
  config: DEFAULT_CONFIG,
  files: [],
  copias: 1,
  comentario: '',
  proyectoId: crypto.randomUUID(),
  proyectoToken: undefined,
  nombreProyecto: '',
  suggestion: null,
  analyzing: false,
  preflight: [],
  editingOrderId: null,
  editingOrderEmail: null,
  colorAnillas: initialCatalog.ringColors[0]?.name ?? '',
  colorContraportada: initialCatalog.coverColors[0]?.name ?? '',

  // Admin saves the RAW catalog; derive the effective one for this front.
  setCatalog: (raw) => set((s) => { const catalog = catalogForSource(raw, CURRENT_SOURCE); return { rawCatalog: raw, catalog, catalogLoaded: hasPrices(catalog), config: normalize(s.config, catalog) }; }),
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

  setProyectoToken: (proyectoToken) => set((s) => (s.proyectoToken ? {} : { proyectoToken })),
  setCopias: (n) => set({ copias: Math.max(1, Math.floor(n) || 1) }),
  setComentario: (comentario) => set({ comentario }),
  setNombreProyecto: (nombreProyecto) => set({ nombreProyecto }),
  clearProject: () =>
    set({ files: [], copias: 1, comentario: '', nombreProyecto: '', proyectoId: crypto.randomUUID(), proyectoToken: undefined, suggestion: null, analyzing: false, preflight: [], editingOrderId: null, editingOrderEmail: null }),
  setEditingOrderId: (editingOrderId) => set({ editingOrderId }),
  setEditingOrderEmail: (editingOrderEmail) => set({ editingOrderEmail }),
  loadProject: (p) => {
    if (p.kind !== 'copias') return;
    set((s) => ({
      proyectoId: p.id,
      proyectoToken: p.storageToken,
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
      void uploadService.getBlob(d.storageKey, p.storageToken).then((blob) => {
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
      if (remote && remote.version === 6 && hasPrices(remote)) {
        localStorage.setItem(CATALOG_KEY, JSON.stringify(remote));
        const catalog = catalogForSource(remote, CURRENT_SOURCE);
        set((s) => ({ rawCatalog: remote, catalog, catalogLoaded: true, catalogError: null, config: normalize(s.config, catalog) }));
      } else {
        // The DB has no priced catalog. We do NOT seed it from the browser: the
        // shop owner sets prices in the admin panel, and until then there is no
        // price to show. (Seeding from here would make the client the source of
        // truth for prices, which is exactly what we don't want.)
        set({ catalogLoaded: false, catalogError: 'Los precios aún no están configurados en el panel de administración.' });
      }
    } catch {
      // Network/API failure: keep whatever cache we had, but say so if it has no prices.
      set((s) => ({ catalogError: s.catalogLoaded ? null : 'No se han podido cargar los precios. Inténtalo de nuevo en unos segundos.' }));
    }
  },

  setAnalyzing: (analyzing) => set({ analyzing }),
  setPreflight: (preflight) => set({ preflight }),
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

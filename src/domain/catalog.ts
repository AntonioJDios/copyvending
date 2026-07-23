import { DEFAULT_PRESETS, type Preset } from './presets';
import type { Acabado, AcabadoFolios, ColorMode, DobleCara, Grosor, Size } from './types';

/**
 * Everything the shop owner can configure. The domain (pricing, rules) reads
 * from a Catalog; the admin panel edits it and persists it. In production this
 * lives on the server, which also re-validates prices — the browser copy is
 * only for instant feedback.
 */
export interface ColorOption {
  name: string;
  /** Swatch color for the UI (and the drawn coil). */
  hex: string;
  /** Optional swatch photo (e.g. the real spiral color). */
  img?: string;
  /** Whether it is offered to the customer (admin toggle). Default true. */
  enabled?: boolean;
  /** Extra price for choosing this colour (per binding). Default 0. */
  extra?: number;
}

/** Payment methods offered at checkout (admin-configurable). Extensible: Redsys
 *  (card / Bizum) will be added here with its own config. */
export interface PaymentMethodConfig {
  enabled: boolean;
  label: string;
}
export interface PaymentsConfig {
  /** Pay in person at the counter when picking up the order. */
  local: PaymentMethodConfig;
}
export const DEFAULT_PAYMENTS: PaymentsConfig = {
  local: { enabled: true, label: 'Pagar al recoger' },
};

/** Owner-editable behaviour of the AI assistant (from the admin panel). */
export interface AssistantConfig {
  /** Show the chat assistant to customers. */
  enabled: boolean;
  /** Auto-propose a configuration when files are uploaded. */
  suggestEnabled: boolean;
  /** Free-text guidance injected into the assistant/suggestion prompts. */
  instructions: string;
}

export interface Catalog {
  version: 6;
  /** Quick-start profiles shown above the options. */
  presets: Preset[];
  /** AI assistant behaviour (optional; absent = defaults on). */
  assistant?: AssistantConfig;
  /** Payment methods (optional; absent = only "pay at counter"). */
  payments?: PaymentsConfig;
  /** Paper sizes offered to the customer. */
  enabledSizes: Size[];
  /** Ring/spiral colors offered when the finish is AnillasColores. */
  ringColors: ColorOption[];
  /** Back-cover colors offered when the finish is AnillasColores. */
  coverColors: ColorOption[];
  /** Grammages offered per size. */
  grosoresBySize: Record<Size, Grosor[]>;
  /** Finishing (binding) options offered. */
  enabledFinishes: Acabado[];
  /** Sheet finishing options offered. */
  enabledFolios: AcabadoFolios[];
  /** Per-printed-side price, keyed `${size}-${grosor}-${color}-${dobleCara}`. */
  pagePrices: Record<string, number>;
  /** Price per binding, by finish. */
  bindingPrices: Record<Acabado, number>;
  /** Max sheets allowed per binding (absent = no limit). */
  bindingMaxSheets: Partial<Record<Acabado, number>>;
  /** Color surcharge per printed side, by size. */
  colorSurcharge: Record<Size, number>;
  /** Laminate surcharge per sheet, by size. */
  laminateSurcharge: Record<Size, number>;
  coverColorSurcharge: number;
  perforatePrice: number;
  holesPrice: number;
  stickerPrice: number;
  noMarginsPrice: number;
  /** Price per blank sheet added before/after a binding. */
  extraFolioPrice: number;
  /** Unit price for a personalised mug. */
  mugPrice: number;
  /** Unit price for a personalised Ø58 mm badge. */
  badgePrice: number;
}

export const ALL_SIZES: Size[] = ['A4', 'A3', 'A5'];
export const ALL_FINISHES: Acabado[] = [
  'sinencuadernacion',
  'grapado',
  'AnillasColores',
  'dos_agujeros',
  'cuatro_agujeros',
  'perforado',
];
export const ALL_FOLIOS: AcabadoFolios[] = ['normal', 'plastificar', 'pegatinas'];

export const FINISH_LABEL: Record<Acabado, string> = {
  sinencuadernacion: 'Sin acabado',
  grapado: 'Grapado',
  AnillasColores: 'Anillas de colores',
  dos_agujeros: '2 agujeros',
  cuatro_agujeros: '4 agujeros',
  perforado: 'Perforado',
};
export const FOLIO_LABEL: Record<AcabadoFolios, string> = {
  normal: 'Normal',
  plastificar: 'Plastificar',
  pegatinas: 'Pegatinas',
};
export const SIZE_LABEL: Record<Size, string> = {
  A4: 'A4 (folio)',
  A3: 'A3 (doble folio)',
  A5: 'A5 (medio folio)',
};

/** Default catalog = the exact values from the legacy copisteria.js. */
export const DEFAULT_CATALOG: Catalog = {
  version: 6,
  presets: DEFAULT_PRESETS,
  assistant: {
    enabled: true,
    suggestEnabled: true,
    instructions: '',
  },
  payments: DEFAULT_PAYMENTS,
  enabledSizes: ['A4', 'A3', 'A5'],
  ringColors: [
    { name: 'Transparente', hex: '#f2f2f2', img: '/anillas/transparente.png', enabled: true },
    { name: 'Negro', hex: '#111111', img: '/anillas/negro.png', enabled: true },
    { name: 'Verde Menta', hex: '#90d0bd', img: '/anillas/menta.png', enabled: true },
    { name: 'Amarillo Golden', hex: '#f3b614', img: '/anillas/golden.png', enabled: true },
    { name: 'Turquesa', hex: '#80e8ec', img: '/anillas/turquesa.png', enabled: true },
    { name: 'Rosa Pastel', hex: '#eebfe4', img: '/anillas/rosa-pastel.png', enabled: true },
    { name: 'Azul Pastel', hex: '#aedbfb', img: '/anillas/azul-pastel.png', enabled: true },
    { name: 'Lila', hex: '#7c69b2', img: '/anillas/lila.png', enabled: true },
    { name: 'Azul Purpurina', hex: '#6a5acd', img: '/anillas/azul-purpurina.jpg', enabled: true },
  ],
  coverColors: [
    { name: 'Plástico Negro', hex: '#111111', img: '/contraportadas/negro.png', enabled: true },
    { name: 'Plástico Rojo', hex: '#c0392b', img: '/contraportadas/rojo.png', enabled: true },
    { name: 'Plástico Transparente', hex: '#f2f2f2', img: '/contraportadas/transparente.png', enabled: true },
    { name: 'Plástico Verde Pastel', hex: '#bfe3c0', img: '/contraportadas/verde.png', enabled: true },
    { name: 'Plástico Amarillo Pastel', hex: '#f5e6a8', img: '/contraportadas/amarilla.png', enabled: true },
    { name: 'Plástico Azul Pastel', hex: '#aedbfb', img: '/contraportadas/azul.png', enabled: true },
    { name: 'Plástico Naranja Pastel', hex: '#f7c59f', img: '/contraportadas/naranja.png', enabled: true },
    { name: 'Plástico Rosa Pastel', hex: '#eebfe4', img: '/contraportadas/rosa.png', enabled: true },
    { name: 'Plástico Lila Pastel', hex: '#c9b8e8', img: '/contraportadas/lila.png', enabled: true },
  ],
  grosoresBySize: {
    A4: [80, 90, 100, 120, 250],
    A3: [100, 250],
    A5: [90],
  },
  enabledFinishes: ['sinencuadernacion', 'grapado', 'AnillasColores', 'dos_agujeros', 'cuatro_agujeros', 'perforado'],
  enabledFolios: ['normal', 'plastificar', 'pegatinas'],
  pagePrices: {
    'A3-80-BN-0': 0.07, 'A3-80-BN-1': 0.06, 'A3-80-Color-0': 0.22, 'A3-80-Color-1': 0.2,
    'A3-100-BN-0': 0.1, 'A3-100-BN-1': 0.08, 'A3-100-Color-0': 0.24, 'A3-100-Color-1': 0.22,
    'A3-250-BN-0': 0.4, 'A3-250-Color-0': 0.6,
    'A4-80-BN-0': 0.025, 'A4-80-BN-1': 0.0215, 'A4-80-Color-0': 0.085, 'A4-80-Color-1': 0.08,
    'A4-90-BN-0': 0.04, 'A4-90-BN-1': 0.0319, 'A4-90-Color-0': 0.119, 'A4-90-Color-1': 0.109,
    'A4-100-BN-0': 0.075, 'A4-100-BN-1': 0.05, 'A4-100-Color-0': 0.135, 'A4-100-Color-1': 0.12,
    'A4-120-BN-0': 0.099, 'A4-120-BN-1': 0.079, 'A4-120-Color-0': 0.169, 'A4-120-Color-1': 0.159,
    'A4-160-BN-0': 0.08, 'A4-160-BN-1': 0.07, 'A4-160-Color-0': 0.18, 'A4-160-Color-1': 0.16,
    'A4-250-BN-0': 0.25, 'A4-250-Color-0': 0.4,
    'A5-80-BN-0': 0.026, 'A5-80-BN-1': 0.02, 'A5-80-Color-0': 0.085, 'A5-80-Color-1': 0.08,
    'A5-90-BN-0': 0.04, 'A5-90-BN-1': 0.03, 'A5-90-Color-0': 0.1, 'A5-90-Color-1': 0.09,
    'A5-100-BN-0': 0.05, 'A5-100-BN-1': 0.04, 'A5-100-Color-0': 0.12, 'A5-100-Color-1': 0.11,
    'A5-120-BN-0': 0.06, 'A5-120-BN-1': 0.05, 'A5-120-Color-0': 0.135, 'A5-120-Color-1': 0.12,
    'A5-160-BN-0': 0.08, 'A5-160-BN-1': 0.07, 'A5-160-Color-0': 0.18, 'A5-160-Color-1': 0.16,
    'A5-250-BN-0': 0.15, 'A5-250-Color-0': 0.25,
  },
  bindingPrices: {
    sinencuadernacion: 0,
    grapado: 0.05,
    AnillasColores: 1.99,
    dos_agujeros: 0.25,
    cuatro_agujeros: 0.25,
    perforado: 0,
  },
  bindingMaxSheets: { AnillasColores: 350, grapado: 100 },
  colorSurcharge: { A4: 0.08, A5: 0.08, A3: 0.15 },
  laminateSurcharge: { A4: 0.99, A5: 0.99, A3: 1.5 },
  coverColorSurcharge: 0.3,
  perforatePrice: 0.5,
  holesPrice: 0.1,
  stickerPrice: 0.15,
  noMarginsPrice: 0.8,
  extraFolioPrice: 0.1,
  mugPrice: 9.95,
  badgePrice: 2.5,
};

export const GROSORES: Grosor[] = [80, 90, 100, 120, 160, 250];
export const COLORS: ColorMode[] = ['BN', 'Color'];
export const CARAS: DobleCara[] = ['0', '1'];

/** Build the pagePrices key. */
export const priceKey = (size: Size, grosor: Grosor, color: ColorMode, cara: DobleCara) =>
  `${size}-${grosor}-${color}-${cara}`;

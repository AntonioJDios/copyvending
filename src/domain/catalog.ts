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
/** Which payment methods are allowed for a given delivery mode. */
export interface DeliveryPayMethods {
  local: boolean;
  redsys: boolean;
}
export interface PaymentsConfig {
  /** Pay in person at the counter when picking up the order. */
  local: PaymentMethodConfig;
  /** Online payment via Redsys (card + Bizum). Credentials live in server env. */
  redsys?: { enabled: boolean };
  /** Matrix: payment methods allowed per delivery mode (pickup / home delivery). */
  matrix?: { recoger: DeliveryPayMethods; envio: DeliveryPayMethods };
}
export const DEFAULT_PAY_MATRIX = {
  recoger: { local: true, redsys: true },
  envio: { local: false, redsys: true }, // home delivery = prepaid only, by default
};
export const DEFAULT_PAYMENTS: PaymentsConfig = {
  local: { enabled: true, label: 'Pagar al recoger' },
  redsys: { enabled: false },
  matrix: DEFAULT_PAY_MATRIX,
};

/** The shop's own identity/contact data, shared by invoices and the privacy
 *  policy (edited once in the admin). */
export interface BusinessConfig {
  name: string;
  nif: string;
  address: string;
  email: string;
  /**
   * Logo de la tienda como data URL, o vacío para usar la marca dibujada.
   *
   * Va aquí dentro y no en el almacenamiento a propósito: las URLs firmadas de R2
   * caducan en una hora y el logo tiene que verlo cualquier visitante sin permiso
   * alguno. Un logo son unos pocos kilobytes, la configuración ya se carga en cada
   * página, y así no hay ni una petición extra ni nada que se rompa al migrar de
   * proveedor de almacenamiento. El admin limita el tamaño al guardarlo.
   */
  logo?: string;
}
export const DEFAULT_BUSINESS: BusinessConfig = { name: '', nif: '', address: '', email: '', logo: '' };

/** Tamaño máximo del logo. Viaja dentro del catálogo, que se pide en cada carga
 *  de página: un logo de 2 MB penalizaría a todos los clientes de la tienda. */
export const MAX_LOGO_BYTES = 64 * 1024;

/** Invoicing (optional). Uses the shop's `business` data for the header. */
export interface InvoicingConfig {
  enabled: boolean;
  /**
   * VAT rate applied to the documents, as a percentage (21 = 21%). Set by the
   * shop, not hardcoded: the rate can change by law, and books/printing can fall
   * under a reduced rate. Absent → DEFAULT_VAT_PERCENT.
   */
  vatPercent?: number;
}
/** Spanish general rate today. Only a starting value for the admin field — the
 *  effective rate is whatever the shop saved (see vatRateOf). */
export const DEFAULT_VAT_PERCENT = 21;
export const DEFAULT_INVOICING: InvoicingConfig = { enabled: false, vatPercent: DEFAULT_VAT_PERCENT };

/** Effective VAT rate as a fraction (0.21), from the shop's config. */
export function vatRateOf(invoicing: InvoicingConfig | undefined): number {
  const pct = Number(invoicing?.vatPercent);
  return (Number.isFinite(pct) && pct >= 0 ? pct : DEFAULT_VAT_PERCENT) / 100;
}

/** Home delivery (optional). Prices by zone (from the postal code); Canarias is
 *  not served. Free over `freeThreshold` (0 = never free). */
export interface ShippingConfig {
  enabled: boolean;
  peninsula: number;
  baleares: number;
  freeThreshold: number;
  info: string;
}
/** Structure only — the real shipping rates live in the DB catalog (see
 *  EMPTY_CATALOG), never in code. */
export const DEFAULT_SHIPPING: ShippingConfig = {
  enabled: false,
  peninsula: 0,
  baleares: 0,
  freeThreshold: 0,
  info: '',
};

/**
 * Legal texts, editable by the shop from the admin panel and stored in the DB
 * (like prices — the code holds no shop-specific wording it can't change).
 *
 * Two levels:
 *  - the CONSENT sentences and the shop-specific details (phone, deadlines…),
 *    which fill the drafted templates;
 *  - optional FULL-TEXT overrides: if one is set, that document renders as typed
 *    instead of the template, so the owner (or their lawyer) can replace it
 *    wholesale without a deploy.
 *
 * All of it is rendered as PLAIN TEXT, never as HTML.
 */
export interface LegalConfig {
  /** Checkbox text for the privacy consent (account creation / checkout). */
  consentPrivacy: string;
  /** Checkbox text accepting the terms + the withdrawal-right exclusion. */
  consentTerms: string;
  /** Shop details that the drafted templates need. */
  phone: string;
  /** Companies only: Registro Mercantil details. */
  registro: string;
  /** e.g. "24-48 h laborables". */
  prepTime: string;
  /** e.g. "24-72 h laborables". */
  deliveryTime: string;
  /** How long a ready order is held at the shop, e.g. "30 días". */
  custodyDays: string;
  /** Date shown as "last updated" on the legal pages. */
  updatedAt: string;
  /** Full-text overrides (empty = use the drafted template). */
  legalNoticeText: string;
  termsText: string;
  privacyText: string;
}

export const DEFAULT_LEGAL: LegalConfig = {
  consentPrivacy: 'He leído y acepto la política de privacidad y el tratamiento de mis datos.',
  consentTerms:
    'He leído y acepto las condiciones de venta y entiendo que los trabajos se producen según mis propias especificaciones, por lo que no admiten devolución ni derecho de desistimiento una vez producidos.',
  phone: '',
  registro: '',
  prepTime: '',
  deliveryTime: '',
  custodyDays: '',
  updatedAt: '',
  legalNoticeText: '',
  termsText: '',
  privacyText: '',
};

/** Effective legal config (stored values over the defaults). */
export function legalOf(catalog: Pick<Catalog, 'legal'> | undefined): LegalConfig {
  return { ...DEFAULT_LEGAL, ...(catalog?.legal ?? {}) };
}

/**
 * Home page texts.
 *
 * In the database, not in the code: the same build has to be able to dress up as
 * any shop, and «cámbiame la frase de la portada» must not require a deploy — ni
 * una llamada al desarrollador. Plain text only, never HTML: it is rendered as
 * text by React, like the legal overrides, so a stored XSS is impossible.
 */
export interface Notice {
  title: string;
  text: string;
}

/**
 * Plantillas de portada.
 *
 * Un juego pequeño y CERRADO de diseños con nombre, y cualquier tienda puede
 * elegir cualquiera. Eso es una función del producto; un componente hecho para una
 * tienda concreta sería un fork disfrazado, y con seis de esos el mantenimiento se
 * vuelve imposible. Regla: dos o tres, y ninguna con nada de un cliente dentro.
 *
 * Las dos leen EXACTAMENTE los mismos datos (ver useLandingData): solo cambia la
 * presentación. Añadir un campo obliga a tocar las dos, y ese es el precio.
 */
export type LandingTemplate = 'clara' | 'oscura';

export interface LandingConfig {
  /** Diseño de la portada. */
  template: LandingTemplate;
  /** Frase principal de la portada. */
  claim: string;
  /** Frase de apoyo, debajo del claim. */
  subclaim: string;
  /** Frase corta de confianza (vacía = no se muestra). */
  trust: string;
  /**
   * Aviso en la tira superior de la web (vacío = no aparece la tira).
   *
   * Para lo urgente y temporal: cerrado por vacaciones, un cupón, un cambio de
   * horario. Separado del tablón porque esto se ve sin bajar la página.
   */
  banner: string;
  /** Tablón de anuncios de la tienda. Vacío = no se muestra la sección. */
  notices: Notice[];
  /**
   * Mostrar «desde X € la página» con el precio más bajo de la tarifa.
   *
   * Sale de los precios reales, no de un texto: un precio escrito a mano acaba
   * desactualizado y un precio desactualizado en la portada es publicidad
   * engañosa. Se puede apagar si la tienda prefiere no competir por precio.
   */
  showPriceFrom: boolean;
  /** Mostrar la tarjeta de tazas personalizadas. */
  showMugs: boolean;
  /** Mostrar la tarjeta de chapas personalizadas. */
  showBadges: boolean;
}

export const DEFAULT_LANDING: LandingConfig = {
  // La clara por defecto: es la sobria, y una tienda que no ha elegido nada no
  // debería encontrarse de repente con una portada en negro y neón.
  template: 'clara',
  claim: 'Tu copistería online',
  subclaim:
    'Sube tus PDF o imágenes, elige cómo imprimirlos y el precio se calcula al instante. Recíbelos en casa o recógelos en tienda.',
  trust: '',
  banner: '',
  notices: [],
  showPriceFrom: true,
  showMugs: true,
  showBadges: true,
};

/**
 * Precio por página más bajo de la tarifa, para el «desde X €» de la portada.
 *
 * Null si la tienda no tiene precios cargados: es preferible no decir nada a
 * anunciar un cero. Solo mira el precio por página (sin encuadernado ni
 * recargos), que es justo lo que significa «desde».
 */
export function cheapestPagePrice(catalog: Pick<Catalog, 'pagePrices'> | undefined): number | null {
  const prices = Object.values(catalog?.pagePrices ?? {}).filter((n) => Number.isFinite(n) && n > 0);
  return prices.length > 0 ? Math.min(...prices) : null;
}

export function landingOf(catalog: Pick<Catalog, 'landing'> | undefined): LandingConfig {
  return { ...DEFAULT_LANDING, ...(catalog?.landing ?? {}) };
}

/** Owner-editable behaviour of the AI assistant (from the admin panel). */
export interface AssistantConfig {
  /** Show the chat assistant to customers. */
  enabled: boolean;
  /** Auto-propose a configuration when files are uploaded. */
  suggestEnabled: boolean;
  /** Free-text guidance injected into the assistant/suggestion prompts. */
  instructions: string;
}

/** The three fixed sources: Web (online), Papelería (mostrador) and Email. */
export type SourceKey = 'online' | 'mostrador' | 'email';

/** Per-source ON/OFF of the shared modules (absent → follows the global config). */
export interface SourceModules {
  payments?: boolean;
  invoicing?: boolean;
  shipping?: boolean;
  coupons?: boolean;
  assistant?: boolean;
}

/** Per-source PRICE overrides. Any field absent → falls back to the base value.
 *  The colour SETS (ring/cover) are shared; only their € surcharge varies here. */
export interface SourcePricing {
  pagePrices?: Record<string, number>;
  bindingPrices?: Record<string, number>;
  colorSurcharge?: Record<string, number>;
  laminateSurcharge?: Record<string, number>;
  coverColorSurcharge?: number;
  perforatePrice?: number;
  holesPrice?: number;
  stickerPrice?: number;
  noMarginsPrice?: number;
  extraFolioPrice?: number;
  mugPrice?: number;
  badgePrice?: number;
  /** € surcharge per ring/cover colour, by colour name. */
  ringExtras?: Record<string, number>;
  coverExtras?: Record<string, number>;
  /** Per-source module on/off. */
  modules?: SourceModules;
}

export interface Catalog {
  version: 6;
  /** Quick-start profiles shown above the options. */
  presets: Preset[];
  /** AI assistant behaviour (optional; absent = defaults on). */
  assistant?: AssistantConfig;
  /** Payment methods (optional; absent = only "pay at counter"). */
  payments?: PaymentsConfig;
  /** Invoicing config (optional; absent = disabled). */
  invoicing?: InvoicingConfig;
  /** Shop identity/contact (for tickets + legal pages). */
  business?: BusinessConfig;
  /** Legal texts and consent wording (editable in the admin). */
  legal?: LegalConfig;
  /** Home page texts (optional; absent = the generic defaults). */
  landing?: LandingConfig;
  /** Home delivery config (optional; absent = disabled). */
  shipping?: ShippingConfig;
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
  /** Per-source price overrides (absent → every source uses the base prices). */
  sources?: Partial<Record<SourceKey, SourcePricing>>;
  /** Whether coupons apply for THIS source — set by catalogForSource (effective). */
  couponsEnabled?: boolean;
  /** Global: whether the email order source is active at all (not per-source). */
  emailEnabled?: boolean;
}

/** Effective catalog for a source: base with that source's PRICE overrides and
 *  its MODULE on/off applied (prices, ring/cover € and enabled flags). The rest
 *  (sizes, colours, presets…) is shared. */
export function catalogForSource(catalog: Catalog, source: SourceKey): Catalog {
  const o = catalog.sources?.[source];
  const m = o?.modules;
  const eff: Catalog = {
    ...catalog,
    pagePrices: { ...catalog.pagePrices, ...(o?.pagePrices ?? {}) },
    bindingPrices: { ...catalog.bindingPrices, ...(o?.bindingPrices ?? {}) },
    colorSurcharge: { ...catalog.colorSurcharge, ...(o?.colorSurcharge ?? {}) },
    laminateSurcharge: { ...catalog.laminateSurcharge, ...(o?.laminateSurcharge ?? {}) },
    coverColorSurcharge: o?.coverColorSurcharge ?? catalog.coverColorSurcharge,
    perforatePrice: o?.perforatePrice ?? catalog.perforatePrice,
    holesPrice: o?.holesPrice ?? catalog.holesPrice,
    stickerPrice: o?.stickerPrice ?? catalog.stickerPrice,
    noMarginsPrice: o?.noMarginsPrice ?? catalog.noMarginsPrice,
    extraFolioPrice: o?.extraFolioPrice ?? catalog.extraFolioPrice,
    mugPrice: o?.mugPrice ?? catalog.mugPrice,
    badgePrice: o?.badgePrice ?? catalog.badgePrice,
    ringColors: catalog.ringColors.map((c) => ({ ...c, extra: o?.ringExtras?.[c.name] ?? c.extra })),
    coverColors: catalog.coverColors.map((c) => ({ ...c, extra: o?.coverExtras?.[c.name] ?? c.extra })),
    couponsEnabled: m?.coupons ?? catalog.couponsEnabled ?? true,
  } as Catalog;
  // Resolve the shared modules' enabled flag for this source (default: follow global).
  if (catalog.payments?.local) eff.payments = { ...catalog.payments, local: { ...catalog.payments.local, enabled: m?.payments ?? catalog.payments.local.enabled } };
  if (catalog.invoicing) eff.invoicing = { ...catalog.invoicing, enabled: m?.invoicing ?? catalog.invoicing.enabled };
  if (catalog.shipping) eff.shipping = { ...catalog.shipping, enabled: m?.shipping ?? catalog.shipping.enabled };
  if (catalog.assistant) eff.assistant = { ...catalog.assistant, enabled: m?.assistant ?? catalog.assistant.enabled };
  return eff;
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

/**
 * Structural skeleton of the catalog: what the shop OFFERS (sizes, grammages,
 * finishes, colours, presets) with every monetary value left empty/zero.
 *
 * PRICES ARE NOT IN THE CODE. The single source of truth for every price is the
 * `catalog` row of the `settings` table (edited in the admin panel, read by the
 * configurator and — authoritatively — by the server when pricing an order).
 * This skeleton only exists so the UI has a valid shape before the real catalog
 * arrives from the backend; until then `catalogLoaded` is false and the shop
 * refuses to price or take orders (see store/useConfigurator).
 */
export const EMPTY_CATALOG: Catalog = {
  version: 6,
  presets: DEFAULT_PRESETS,
  assistant: {
    enabled: true,
    suggestEnabled: true,
    instructions: '',
  },
  payments: DEFAULT_PAYMENTS,
  invoicing: DEFAULT_INVOICING,
  business: DEFAULT_BUSINESS,
  legal: DEFAULT_LEGAL,
  shipping: DEFAULT_SHIPPING,
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
  // ── No prices here, on purpose. Every value below is set in the admin panel
  // and persisted in the DB (`settings.catalog`). See the comment above.
  pagePrices: {},
  bindingPrices: {
    sinencuadernacion: 0,
    grapado: 0,
    AnillasColores: 0,
    dos_agujeros: 0,
    cuatro_agujeros: 0,
    perforado: 0,
  },
  bindingMaxSheets: { AnillasColores: 350, grapado: 100 }, // physical limits, not prices
  colorSurcharge: { A4: 0, A5: 0, A3: 0 },
  laminateSurcharge: { A4: 0, A5: 0, A3: 0 },
  coverColorSurcharge: 0,
  perforatePrice: 0,
  holesPrice: 0,
  stickerPrice: 0,
  noMarginsPrice: 0,
  extraFolioPrice: 0,
  mugPrice: 0,
  badgePrice: 0,
};

export const GROSORES: Grosor[] = [80, 90, 100, 120, 160, 250];
export const COLORS: ColorMode[] = ['BN', 'Color'];
export const CARAS: DobleCara[] = ['0', '1'];

/** Build the pagePrices key. */
export const priceKey = (size: Size, grosor: Grosor, color: ColorMode, cara: DobleCara) =>
  `${size}-${grosor}-${color}-${cara}`;

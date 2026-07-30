import { useEffect, useState } from 'react';
import { loadGlsSettings, saveGlsSettings, DEFAULT_GLS_SETTINGS, type GlsSettings } from '../lib/glsSettings';
import { loadCoupons, saveCoupons } from '../lib/coupons';
import { NEW_COUPON, type Coupon, type CouponType } from '../domain/coupons';
import { monthWindow, pivotCouponAgg, type CouponAnalytics } from '../lib/stats';
import { deleteStoredFile, fetchCouponAgg, fetchFiles, fetchStorage, runPurge, type StoredFile, type StorageReport as StorageReportData } from '../lib/statsApi';
import {
  ALL_FINISHES,
  ALL_FOLIOS,
  ALL_SIZES,
  CARAS,
  COLORS,
  EMPTY_CATALOG,
  DEFAULT_PAYMENTS,
  DEFAULT_PAY_MATRIX,
  DEFAULT_INVOICING,
  DEFAULT_VAT_PERCENT,
  DEFAULT_BUSINESS,
  DEFAULT_LANDING,
  DEFAULT_LEGAL,
  landingOf,
  type Notice,
  MAX_LOGO_BYTES,
  DEFAULT_SHIPPING,
  FINISH_LABEL,
  FOLIO_LABEL,
  GROSORES,
  SIZE_LABEL,
  priceKey,
  type Catalog,
  type ColorOption,
  type PaymentMethodConfig,
  type SourceKey,
  type SourceModules,
  type SourcePricing,
} from '../domain/catalog';

const SRC_LABEL: Record<SourceKey, string> = { online: 'Web', mostrador: 'Papelería', email: 'Email' };
const SRC_ORDER: SourceKey[] = ['online', 'mostrador', 'email'];

/** Per-source on/off toggles for a shared module (default: follows the global). */
function SourceToggles({ draft, change, mod, label, sources = ['online', 'mostrador', 'email'] }: {
  draft: Catalog;
  change: (fn: (d: Catalog) => void) => void;
  mod: keyof SourceModules;
  label: string;
  sources?: SourceKey[];
}) {
  const get = (s: SourceKey) => draft.sources?.[s]?.modules?.[mod] ?? true;
  const set = (s: SourceKey, v: boolean) =>
    change((d) => {
      const src = (d.sources ??= {});
      const o = (src[s] ??= {});
      (o.modules ??= {})[mod] = v;
    });
  return (
    <section className="card">
      <h3 style={{ margin: '0 0 8px' }}>{label} · activar por canal</h3>
      <div className="src-toggles">
        {sources.map((s) => (
          <label key={s} className="chk">
            <input type="checkbox" checked={get(s)} onChange={(e) => set(s, e.target.checked)} /> {SRC_LABEL[s]}
          </label>
        ))}
      </div>
    </section>
  );
}

/**
 * Configuration sections. `''` is the dashboard.
 *
 * The section lives in the hash (`#admin/precios`), not in component state, so the
 * tablet's back gesture returns to the dashboard instead of leaving the backoffice,
 * and a section can be linked to directly.
 */
type AdminSection =
  | ''
  | 'producto'
  | 'precios'
  | 'pagos'
  | 'envios'
  | 'cupones'
  | 'legal'
  | 'portada'
  | 'asistente'
  | 'almacenamiento'
  | 'registro'
  | 'herramientas';

/** Reads the section from `#admin/<section>` and follows navigation. */
function useSection(): AdminSection {
  const read = () => (window.location.hash.match(/^#admin\/([a-z]+)/)?.[1] ?? '') as AdminSection;
  const [section, setSection] = useState<AdminSection>(read);
  useEffect(() => {
    const on = () => setSection(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return section;
}

/** Sections that edit the shared catalog draft, so they need the save bar. */
const EDITS_CATALOG: AdminSection[] = ['producto', 'precios', 'pagos', 'envios', 'legal', 'portada', 'asistente'];

import type { Acabado, Configuracion, DobleCara, Grosor, Size } from '../domain/types';
import type { Preset } from '../domain/presets';
import { saveCatalog, useConfigurator } from '../store/useConfigurator';
import { API_BASE, apiSend } from '../lib/api';
import { AdminNav } from './AdminNav';
import { LogViewer } from './LogViewer';
import { fetchEvents } from '../lib/statsApi';
import { downloadBackup, downloadDbExport, parseBackup, restoreBackup } from '../lib/catalogBackup';
import { downscaleDataUrl } from '../lib/imageDownscale';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('No se pudo leer la imagen'));
    fr.onload = () => resolve(String(fr.result));
    fr.readAsDataURL(file);
  });
}

const num = (v: string) => (v === '' ? 0 : Number(v));

export function AdminPanel() {
  const catalog = useConfigurator((s) => s.rawCatalog);
  const setCatalog = useConfigurator((s) => s.setCatalog);
  const [draft, setDraft] = useState<Catalog>(() => structuredClone(catalog));
  const [dirty, setDirty] = useState(false);
  const section = useSection();
  // Error count for the dashboard tile. A log only helps if you notice it without
  // opening it, so the badge does the noticing.
  const [logErrors, setLogErrors] = useState<number | null>(null);
  useEffect(() => {
    if (!API_BASE || section !== '') return;
    void fetchEvents('error')
      .then((page) => setLogErrors(page.counts.error))
      .catch(() => setLogErrors(null)); // sin registro todavía: la tarjeta no alarma
  }, [section]);
  const [priceSrc, setPriceSrc] = useState<SourceKey>('online');
  const [slideDir, setSlideDir] = useState<'r' | 'l'>('r');
  const pickSrc = (s: SourceKey) => {
    setSlideDir(SRC_ORDER.indexOf(s) >= SRC_ORDER.indexOf(priceSrc) ? 'r' : 'l');
    setPriceSrc(s);
  };

  const edit = (fn: (d: Catalog) => void) =>
    setDraft((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  const change = (fn: (d: Catalog) => void) => {
    edit(fn);
    setDirty(true);
  };

  // ── Precios POR SOURCE: leen (override de la source ?? base) y escriben en
  //    draft.sources[priceSrc]. Perfiles/tamaños/colores son comunes (no aquí). ──
  const so = () => draft.sources?.[priceSrc];
  const setSrc = (fn: (o: SourcePricing) => void) =>
    change((d) => {
      const src = (d.sources ??= {});
      const o = (src[priceSrc] ??= {});
      fn(o);
    });
  type RecField = 'pagePrices' | 'bindingPrices' | 'colorSurcharge' | 'laminateSurcharge';
  type ScField = 'coverColorSurcharge' | 'perforatePrice' | 'holesPrice' | 'stickerPrice' | 'noMarginsPrice' | 'extraFolioPrice' | 'mugPrice' | 'badgePrice';
  const gRec = (f: RecField, k: string): number =>
    (so() as Record<RecField, Record<string, number>> | undefined)?.[f]?.[k] ?? (draft[f] as Record<string, number>)[k] ?? 0;
  const sRec = (f: RecField, k: string, v: number) =>
    setSrc((o) => { const rec = ((o as Record<string, Record<string, number>>)[f] ??= {}); rec[k] = v; });
  const gSc = (f: ScField): number => ((so() as Record<ScField, number> | undefined)?.[f]) ?? (draft[f] as number);
  const sSc = (f: ScField, v: number) => setSrc((o) => { (o as Record<string, number>)[f] = v; });
  const gRing = (name: string, base: number) => so()?.ringExtras?.[name] ?? base;
  const sRing = (name: string, v: number) => setSrc((o) => { (o.ringExtras ??= {})[name] = v; });
  const gCover = (name: string, base: number) => so()?.coverExtras?.[name] ?? base;
  const sCover = (name: string, v: number) => setSrc((o) => { (o.coverExtras ??= {})[name] = v; });

  const save = () => {
    saveCatalog(draft);
    setCatalog(draft);
    setDirty(false);
  };
  // Restores the OFFER (profiles, sizes, grammages, finishes, colours) to the
  // factory structure while keeping every price untouched: prices live only in
  // the DB and are the shop's own data — a "restore defaults" must never wipe
  // them (there are no default prices in the code to restore them from).
  const restore = () => {
    if (window.confirm('¿Restaurar perfiles, tamaños, gramajes, acabados y colores a los valores de fábrica?\n\nLos precios NO se tocan.')) {
      setDraft((d) => ({
        ...structuredClone(EMPTY_CATALOG),
        // Keep all pricing + business configuration from the current catalog.
        pagePrices: d.pagePrices,
        bindingPrices: d.bindingPrices,
        colorSurcharge: d.colorSurcharge,
        laminateSurcharge: d.laminateSurcharge,
        coverColorSurcharge: d.coverColorSurcharge,
        perforatePrice: d.perforatePrice,
        holesPrice: d.holesPrice,
        stickerPrice: d.stickerPrice,
        noMarginsPrice: d.noMarginsPrice,
        extraFolioPrice: d.extraFolioPrice,
        mugPrice: d.mugPrice,
        badgePrice: d.badgePrice,
        sources: d.sources,
        payments: d.payments,
        invoicing: d.invoicing,
        business: d.business,
        legal: d.legal,
        shipping: d.shipping,
      }));
      setDirty(true);
    }
  };

  // One-line status per card, from the draft itself (no extra requests): the point
  // of a dashboard is seeing what is left to configure without opening everything.
  const priced = Object.keys(draft.pagePrices ?? {}).length;
  const legalMissing = !draft.legal?.phone?.trim() || !draft.legal?.updatedAt?.trim();
  const pays = [
    draft.payments?.local?.enabled !== false ? 'mostrador' : null,
    draft.payments?.redsys?.enabled ? 'tarjeta' : null,
  ].filter(Boolean);
  const CARDS: { id: AdminSection; icon: string; label: string; hint: string; warn?: boolean }[] = [
    { id: 'producto', icon: '📐', label: 'Producto', hint: `${draft.enabledSizes.length} tamaños · ${draft.presets.length} perfiles` },
    { id: 'precios', icon: '🏷️', label: 'Precios', hint: priced > 0 ? `${priced} tarifas` : 'sin configurar', warn: priced === 0 },
    { id: 'pagos', icon: '💳', label: 'Pagos y docs', hint: pays.length ? pays.join(' · ') : 'sin métodos de pago', warn: pays.length === 0 },
    { id: 'envios', icon: '🚚', label: 'Envíos', hint: draft.shipping?.enabled ? 'activados' : 'desactivados' },
    { id: 'cupones', icon: '🎟️', label: 'Cupones', hint: 'descuentos por código' },
    { id: 'portada', icon: '🏠', label: 'Portada', hint: 'textos de la página de inicio' },
    { id: 'legal', icon: '⚖️', label: 'Legal', hint: legalMissing ? 'faltan datos' : 'textos y consentimientos', warn: legalMissing },
    { id: 'asistente', icon: '✨', label: 'Asistente', hint: draft.assistant?.enabled ? 'activado' : 'desactivado' },
    { id: 'almacenamiento', icon: '🗄️', label: 'Almacenamiento', hint: 'archivos de los clientes' },
    {
      id: 'registro',
      icon: '📋',
      label: 'Registro',
      hint: logErrors === null ? 'avisos de la tienda' : logErrors > 0 ? `${logErrors} ${logErrors === 1 ? 'error' : 'errores'}` : 'sin incidencias',
      warn: (logErrors ?? 0) > 0,
    },
    { id: 'herramientas', icon: '🧰', label: 'Herramientas', hint: 'copias de seguridad y email' },
  ];
  const current = CARDS.find((c) => c.id === section);

  /** Back to the dashboard, warning if there are unsaved changes. */
  const backToDashboard = () => {
    if (dirty && !window.confirm('Tienes cambios sin guardar. ¿Salir de todas formas y perderlos?')) return;
    if (dirty) setDraft(structuredClone(catalog));
    setDirty(false);
    window.location.hash = 'admin';
  };

  return (
    <div className="app admin">
      <AdminNav title={current ? `Configuración · ${current.label}` : 'Configuración'} current="#admin" />

      <div className="admin-body">
        {!section ? (
          <>
            <p className="muted">Elige qué quieres configurar.</p>
            <div className="config-grid">
              {CARDS.filter((c) => API_BASE || (c.id !== 'cupones' && c.id !== 'almacenamiento' && c.id !== 'registro' && c.id !== 'herramientas')).map((c) => (
                <a key={c.id} className={`config-card${c.warn ? ' warn' : ''}`} href={`#admin/${c.id}`}>
                  <span className="config-card-icon" aria-hidden>{c.icon}</span>
                  <span className="config-card-label">{c.label}</span>
                  <span className="config-card-hint">{c.hint}</span>
                </a>
              ))}
            </div>
          </>
        ) : (
          <button type="button" className="btn config-back" onClick={backToDashboard}>
            ← Configuración
          </button>
        )}

        {section === 'producto' && (
          <>
        <section className="card">
          <p className="muted">Estas opciones son <b>comunes</b> a Web, Papelería y Email (los precios se ponen en la pestaña “Precios”).</p>
        </section>

        {/* Perfiles rápidos */}
        <PresetsEditor presets={draft.presets} onChange={(presets) => change((d) => { d.presets = presets; })} />

        {/* Tamaños y gramajes */}
        <section className="card">
          <h2>Tamaños y gramajes aceptados</h2>
          <div className="admin-sizes">
            {ALL_SIZES.map((size) => {
              const enabled = draft.enabledSizes.includes(size);
              return (
                <div key={size} className="admin-size">
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) =>
                        change((d) => {
                          d.enabledSizes = e.target.checked
                            ? [...d.enabledSizes, size]
                            : d.enabledSizes.filter((s) => s !== size);
                        })
                      }
                    />
                    <b>{SIZE_LABEL[size]}</b>
                  </label>
                  <div className="chk-row">
                    {GROSORES.map((g) => (
                      <label key={g} className="chk">
                        <input
                          type="checkbox"
                          checked={draft.grosoresBySize[size].includes(g)}
                          onChange={(e) =>
                            change((d) => {
                              const cur = new Set(d.grosoresBySize[size]);
                              if (e.target.checked) cur.add(g);
                              else cur.delete(g);
                              d.grosoresBySize[size] = GROSORES.filter((x) => cur.has(x));
                            })
                          }
                        />
                        {g} gr
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
          </>
        )}

        {section === 'precios' && (
          <>
        {/* Selector de canal para los PRECIOS (lo demás es común) */}
        <section className="card src-price-bar">
          <div className="stats-card-head">
            <h2>💶 Tarifa que estás editando</h2>
            <div className="seg-toggle sm">
              {(['online', 'mostrador', 'email'] as SourceKey[]).map((s) => (
                <button key={s} type="button" className={priceSrc === s ? 'on' : ''} onClick={() => pickSrc(s)}>{SRC_LABEL[s]}</button>
              ))}
            </div>
          </div>
          <p className="muted">
            Los perfiles, tamaños, gramajes y los colores de anillas/contraportadas son <b>los mismos</b> en Web, Papelería y Email.
            Lo que cambias abajo (<b>precios</b> por página, encuadernación, suplementos, taza/chapa y el € de cada color) es la tarifa de <b>{SRC_LABEL[priceSrc]}</b>.
          </p>
        </section>

        {/* Secciones de PRECIO (dependen del canal). key={priceSrc} → se
            re-monta y desliza al cambiar de canal, para que se note el cambio. */}
        <div key={priceSrc} className={`price-slide slide-${slideDir}`}>
        {/* Precios por página */}
        <section className="card">
          <h2>Precio por página impresa (€) · {SRC_LABEL[priceSrc]}</h2>
          <p className="muted">Por combinación tamaño · gramaje · color · caras.</p>
          {ALL_SIZES.map((size) => (
            <div key={size} className="price-table">
              <h3>{SIZE_LABEL[size]}</h3>
              <table>
                <thead>
                  <tr>
                    <th>Gramaje</th>
                    {COLORS.map((c) => CARAS.map((cara) => <th key={`${c}-${cara}`}>{c} · {cara === '0' ? '1 cara' : '2 caras'}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {GROSORES.map((g) => {
                    const keys = COLORS.flatMap((c) => CARAS.map((cara) => priceKey(size, g as Grosor, c, cara)));
                    if (!keys.some((k) => k in draft.pagePrices)) return null;
                    return (
                      <tr key={g}>
                        <td>{g} gr</td>
                        {keys.map((k) =>
                          k in draft.pagePrices ? (
                            <td key={k}>
                              <input
                                type="number"
                                step="0.001"
                                min="0"
                                value={gRec('pagePrices', k)}
                                onChange={(e) => sRec('pagePrices', k, num(e.target.value))}
                              />
                            </td>
                          ) : (
                            <td key={k} className="na">—</td>
                          )
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        {/* Acabados */}
        <section className="card">
          <h2>Acabados (encuadernación)</h2>
          <table>
            <thead>
              <tr>
                <th>Activo</th>
                <th>Acabado</th>
                <th>Precio (€)</th>
                <th>Máx. folios</th>
              </tr>
            </thead>
            <tbody>
              {ALL_FINISHES.map((f) => (
                <tr key={f}>
                  <td>
                    <input
                      type="checkbox"
                      checked={draft.enabledFinishes.includes(f)}
                      onChange={(e) =>
                        change((d) => {
                          d.enabledFinishes = e.target.checked
                            ? [...d.enabledFinishes, f]
                            : d.enabledFinishes.filter((x) => x !== f);
                        })
                      }
                    />
                  </td>
                  <td>{FINISH_LABEL[f]}</td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={gRec('bindingPrices', f)}
                      onChange={(e) => sRec('bindingPrices', f, num(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      placeholder="—"
                      value={draft.bindingMaxSheets[f] ?? ''}
                      onChange={(e) =>
                        change((d) => {
                          if (e.target.value === '') delete d.bindingMaxSheets[f as Acabado];
                          else d.bindingMaxSheets[f as Acabado] = num(e.target.value);
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Acabado de folios activo</h3>
          <div className="chk-row">
            {ALL_FOLIOS.map((f) => (
              <label key={f} className="chk">
                <input
                  type="checkbox"
                  checked={draft.enabledFolios.includes(f)}
                  onChange={(e) =>
                    change((d) => {
                      d.enabledFolios = e.target.checked ? [...d.enabledFolios, f] : d.enabledFolios.filter((x) => x !== f);
                    })
                  }
                />
                {FOLIO_LABEL[f]}
              </label>
            ))}
          </div>
        </section>

        {/* Suplementos */}
        <section className="card">
          <h2>Suplementos (€)</h2>
          <div className="admin-grid">
            {ALL_SIZES.map((s) => (
              <label key={`col-${s}`} className="field-inline">
                Color/cara {s}
                <input type="number" step="0.01" min="0" value={gRec('colorSurcharge', s)} onChange={(e) => sRec('colorSurcharge', s, num(e.target.value))} />
              </label>
            ))}
            {ALL_SIZES.map((s) => (
              <label key={`lam-${s}`} className="field-inline">
                Plastificar/folio {s}
                <input type="number" step="0.01" min="0" value={gRec('laminateSurcharge', s)} onChange={(e) => sRec('laminateSurcharge', s, num(e.target.value))} />
              </label>
            ))}
            <label className="field-inline">
              Portada a color
              <input type="number" step="0.01" min="0" value={gSc('coverColorSurcharge')} onChange={(e) => sSc('coverColorSurcharge', num(e.target.value))} />
            </label>
            <label className="field-inline">
              Perforado
              <input type="number" step="0.01" min="0" value={gSc('perforatePrice')} onChange={(e) => sSc('perforatePrice', num(e.target.value))} />
            </label>
            <label className="field-inline">
              Agujeros
              <input type="number" step="0.01" min="0" value={gSc('holesPrice')} onChange={(e) => sSc('holesPrice', num(e.target.value))} />
            </label>
            <label className="field-inline">
              Pegatinas
              <input type="number" step="0.01" min="0" value={gSc('stickerPrice')} onChange={(e) => sSc('stickerPrice', num(e.target.value))} />
            </label>
            <label className="field-inline">
              Sin márgenes
              <input type="number" step="0.01" min="0" value={gSc('noMarginsPrice')} onChange={(e) => sSc('noMarginsPrice', num(e.target.value))} />
            </label>
            <label className="field-inline">
              Folio en blanco (delante/detrás)
              <input type="number" step="0.01" min="0" value={gSc('extraFolioPrice')} onChange={(e) => sSc('extraFolioPrice', num(e.target.value))} />
            </label>
            <label className="field-inline">
              Taza personalizada (ud.)
              <input type="number" step="0.01" min="0" value={gSc('mugPrice')} onChange={(e) => sSc('mugPrice', num(e.target.value))} />
            </label>
            <label className="field-inline">
              Chapa Ø58 mm (ud.)
              <input type="number" step="0.01" min="0" value={gSc('badgePrice')} onChange={(e) => sSc('badgePrice', num(e.target.value))} />
            </label>
          </div>
        </section>

        {/* Colores */}
        <ColorEditor title="Colores de anillas" items={draft.ringColors} onChange={(items) => change((d) => { d.ringColors = items; })} extraOf={(c) => gRing(c.name, c.extra ?? 0)} onExtra={(c, v) => sRing(c.name, v)} />
        <ColorEditor title="Colores de contraportada" items={draft.coverColors} onChange={(items) => change((d) => { d.coverColors = items; })} extraOf={(c) => gCover(c.name, c.extra ?? 0)} onExtra={(c, v) => sCover(c.name, v)} />
        </div>
          </>
        )}

        {section === 'pagos' && (
          <>
            <BusinessEditor draft={draft} change={change} />
            <PaymentsEditor draft={draft} change={change} />
            <SourceToggles draft={draft} change={change} mod="payments" label="Pago en local" />
            <InvoicingEditor draft={draft} change={change} />
            <SourceToggles draft={draft} change={change} mod="invoicing" label="Tickets y albaranes" />
          </>
        )}

        {section === 'portada' && <LandingEditor draft={draft} change={change} />}

        {section === 'legal' && <LegalEditor draft={draft} change={change} />}

        {section === 'envios' && (
          <>
            <ShippingEditor draft={draft} change={change} />
            <SourceToggles draft={draft} change={change} mod="shipping" label="Envíos" sources={['online', 'mostrador']} />
            <GlsEditor />
          </>
        )}

        {section === 'cupones' && <CouponsEditor />}

        {section === 'asistente' && (
        <>
        <SourceToggles draft={draft} change={change} mod="assistant" label="Asistente" sources={['online', 'mostrador']} />
        <section className="card">
          <h2>Asistente (IA)</h2>
          <p className="muted">Controla el chat de ayuda y las sugerencias automáticas al subir documentos.</p>
          {(() => {
            const a = draft.assistant ?? { enabled: true, suggestEnabled: true, instructions: '' };
            const setA = (patch: Partial<typeof a>) =>
              change((d) => {
                d.assistant = { enabled: true, suggestEnabled: true, instructions: '', ...d.assistant, ...patch };
              });
            return (
              <>
                <div className="chk-row">
                  <label className="chk">
                    <input type="checkbox" checked={a.enabled} onChange={(e) => setA({ enabled: e.target.checked })} />
                    Mostrar el chat de ayuda a los clientes
                  </label>
                  <label className="chk">
                    <input type="checkbox" checked={a.suggestEnabled} onChange={(e) => setA({ suggestEnabled: e.target.checked })} />
                    Proponer configuración automáticamente al subir
                  </label>
                </div>
                <label className="field-block">
                  Instrucciones para el asistente (texto libre)
                  <textarea
                    className="assistant-instructions"
                    rows={5}
                    placeholder={'Ej.: "Para un TFM recomienda anillas y doble cara. En un CV sugiere 120 g y color. No propongas color salvo que sea una foto. Si son más de 200 páginas, avisa de que puede tardar."'}
                    value={a.instructions}
                    onChange={(e) => setA({ instructions: e.target.value })}
                  />
                </label>
                <p className="muted">
                  El asistente sigue estas indicaciones, pero nunca puede saltarse los precios ni las opciones válidas del catálogo.
                </p>
              </>
            );
          })()}
        </section>
        </>
        )}

        {section === 'registro' && API_BASE && <LogViewer />}

        {section === 'almacenamiento' && API_BASE && (
          <>
            <StorageReport />
            <FileList />
          </>
        )}

        {section === 'herramientas' && API_BASE && (
          <>
            <CatalogBackupTool onRestored={(c) => { setDraft(c); setCatalog(c); setDirty(false); }} />
            <section className="card">
              <h2>Entrada de pedidos por email</h2>
              <label className="chk">
                <input type="checkbox" checked={draft.emailEnabled !== false} onChange={(e) => change((d) => { d.emailEnabled = e.target.checked; })} />
                Leer el buzón de email y crear pedidos
              </label>
              <p className="muted">Si lo desactivas, el backoffice deja de leer el correo (la fuente Email queda apagada). No afecta a Web ni Papelería.</p>
            </section>
            <EmailTestTool />
          </>
        )}
      </div>

      {EDITS_CATALOG.includes(section) && (
        <footer className="admin-actions">
          <button type="button" className="btn" onClick={restore}>
            Restaurar valores por defecto
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty}>
            {dirty ? 'Guardar cambios' : 'Guardado'}
          </button>
        </footer>
      )}
    </div>
  );
}

function PresetsEditor({ presets, onChange }: { presets: Preset[]; onChange: (p: Preset[]) => void }) {
  const patch = (i: number, cfg: Partial<Configuracion>) =>
    onChange(presets.map((p, j) => (j === i ? { ...p, config: { ...p.config, ...cfg } } : p)));
  const setLabel = (i: number, label: string) => onChange(presets.map((p, j) => (j === i ? { ...p, label } : p)));

  return (
    <section className="card">
      <h2>Perfiles rápidos</h2>
      <p className="muted">Atajos que fijan la configuración de un clic (se muestran arriba del configurador).</p>
      <div className="presets-editor">
        {presets.map((p, i) => (
          <div key={p.id} className={`preset-edit${p.enabled === false ? ' preset-off' : ''}`}>
            <input
              type="checkbox"
              title="Activar/desactivar"
              checked={p.enabled !== false}
              onChange={(e) => onChange(presets.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))}
            />
            <input className="preset-name" type="text" value={p.label} onChange={(e) => setLabel(i, e.target.value)} />
            <select value={p.config.size ?? 'A4'} onChange={(e) => patch(i, { size: e.target.value as Size })}>
              {ALL_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select value={p.config.color ?? 'BN'} onChange={(e) => patch(i, { color: e.target.value as Configuracion['color'] })}>
              {COLORS.map((c) => (
                <option key={c} value={c}>{c === 'BN' ? 'B/N' : 'Color'}</option>
              ))}
            </select>
            <select value={String(p.config.grosor ?? 90)} onChange={(e) => patch(i, { grosor: Number(e.target.value) as Grosor })}>
              {GROSORES.map((g) => (
                <option key={g} value={g}>{g} gr</option>
              ))}
            </select>
            <select value={p.config.dobleCara ?? '0'} onChange={(e) => patch(i, { dobleCara: e.target.value as DobleCara })}>
              <option value="0">1 cara</option>
              <option value="1">2 caras</option>
            </select>
            <select value={p.config.acabado ?? 'sinencuadernacion'} onChange={(e) => patch(i, { acabado: e.target.value as Acabado })}>
              {ALL_FINISHES.map((a) => (
                <option key={a} value={a}>{FINISH_LABEL[a]}</option>
              ))}
            </select>
            <select value={p.config.acabadoFolios ?? 'normal'} onChange={(e) => patch(i, { acabadoFolios: e.target.value as Configuracion['acabadoFolios'] })}>
              {ALL_FOLIOS.map((a) => (
                <option key={a} value={a}>{FOLIO_LABEL[a]}</option>
              ))}
            </select>
            <button type="button" className="chip chip-danger" onClick={() => onChange(presets.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="chip"
          onClick={() =>
            onChange([
              ...presets,
              { id: crypto.randomUUID(), label: 'Nuevo perfil', enabled: true, config: { size: 'A4', color: 'BN', grosor: 90, dobleCara: '0', acabado: 'sinencuadernacion', acabadoFolios: 'normal' } },
            ])
          }
        >
          + Añadir perfil
        </button>
      </div>
    </section>
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** Dev tool: builds a fake email with a sample PDF and sends it to the email
 *  ingestion endpoint, to test the whole pipeline before Gmail is wired. */
const GB = 1024 ** 3;
const humanBytes = (b: number) => (b >= GB ? `${(b / GB).toFixed(2)} GB` : `${Math.max(0, Math.round(b / 1024 / 1024))} MB`);
const monthLabel = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return `${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][m - 1]} ${y}`;
};

/**
 * Storage report, from the upload registry. Answers the question you would
 * otherwise open the Cloudflare dashboard for: how much is stored, how fast it
 * grows and what it costs.
 */
function StorageReport() {
  const [data, setData] = useState<StorageReportData | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    fetchStorage()
      .then(setData)
      .catch(() => {});
  };
  useEffect(load, []);

  const clean = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await runPurge();
      setMsg(
        r
          ? `Limpieza hecha: ${r.orders.files} archivos de ${r.orders.orders} pedidos terminados y ${r.orphans.deleted} de pedidos que nunca se completaron.`
          : 'No se pudo ejecutar la limpieza.'
      );
      load();
    } finally {
      setBusy(false);
    }
  };

  const bytes = data?.totals.bytes ?? 0;

  return (
    <section className="card">
      <h2>Almacenamiento</h2>
      {!data ? (
        <p className="muted">Cargando…</p>
      ) : (
        <>
          <div className="admin-grid">
            <div className="field-inline">
              Archivos guardados<b>{data.totals.files.toLocaleString('es-ES')}</b>
            </div>
            <div className="field-inline">
              Espacio ocupado<b>{humanBytes(bytes)}</b>
            </div>
          </div>
          <p className="muted">
            Son los documentos e imágenes que suben tus clientes con sus pedidos. Se borran solos cuando el pedido ya
            está terminado, así no se guardan más tiempo del necesario.
          </p>

          {data.byMonth.length > 0 && (
            <>
              <h3 style={{ margin: '16px 0 6px', fontSize: 15 }}>Por mes de subida</h3>
              <div className="stats-break">
                {data.byMonth.map((m) => (
                  <div key={m.period} className="statbar">
                    <span className="statbar-label">{monthLabel(m.period)}</span>
                    <span className="statbar-track">
                      <span
                        className="statbar-fill"
                        style={{ width: `${(m.bytes / Math.max(1, ...data.byMonth.map((x) => x.bytes))) * 100}%` }}
                      />
                    </span>
                    <span className="statbar-val">
                      {humanBytes(m.bytes)} <em>{m.files} arch.</em>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="block-actions">
            <button type="button" className="btn" onClick={() => void clean()} disabled={busy}>
              {busy ? 'Limpiando…' : '🧹 Limpiar ahora'}
            </button>
            <button type="button" className="chip" onClick={load}>
              Actualizar
            </button>
          </div>
          {msg && <p className="muted">{msg}</p>}
          <p className="muted">
            La limpieza borra los archivos de los pedidos ya terminados y los de quien nunca llegó a pedir. Se ejecuta
            sola al abrir Pedidos; este botón solo la adelanta.
          </p>
          {data.totals.since && (
            <p className="muted">
              El recuento empieza el {new Date(data.totals.since).toLocaleDateString('es-ES')}; los archivos anteriores a
              esa fecha no aparecen aquí.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Paginated list of stored files, with per-file deletion.
 *
 * Each row says whether an order references the file, because deleting one that
 * does leaves that order unprintable — the shop has to see that before clicking,
 * not discover it when a customer asks for a reprint.
 */
function FileList() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [cursor, setCursor] = useState<{ at: number; key: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [err, setErr] = useState('');

  const load = (next?: { at: number; key: string } | null) => {
    setLoading(true);
    fetchFiles(next)
      .then((r) => {
        if (!r) return;
        setFiles((prev) => (next ? [...prev, ...r.files] : r.files));
        setCursor(r.nextCursor);
      })
      .catch(() => setErr('No se pudo cargar la lista de archivos.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), []);

  const del = async (f: StoredFile) => {
    const warn = f.inOrder
      ? '\n\n⚠ Este archivo PERTENECE A UN PEDIDO. Si lo borras, ese pedido ya no se podrá imprimir.'
      : '';
    if (!window.confirm(`¿Borrar este archivo de forma permanente?${warn}`)) return;
    setBusyKey(f.key);
    setErr('');
    try {
      await deleteStoredFile(f.key);
      setFiles((prev) => prev.filter((x) => x.key !== f.key));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo borrar.');
    } finally {
      setBusyKey('');
    }
  };

  // The stored name is a uuid; what identifies the file for a human is its date,
  // its size and which order it belongs to.
  const shortName = (key: string) => key.split('/').pop() ?? key;

  return (
    <section className="card">
      <h2>Archivos guardados</h2>
      <p className="muted">
        Los más recientes primero. Los que pertenecen a un pedido están <b>protegidos</b>: hacen falta para reimprimirlo
        y solo se borran desde el propio pedido. Los que no pertenecen a ninguno (alguien subió algo y no llegó a pedir)
        se pueden borrar aquí.
      </p>
      {err && <p className="admin-login-err">⚠ {err}</p>}
      {files.length === 0 && !loading ? (
        <p className="muted">No hay archivos registrados.</p>
      ) : (
        <div className="file-rows">
          {files.map((f) => (
            <div key={f.key} className="file-row">
              <span className="file-row-main">
                <b>{new Date(f.at).toLocaleString('es-ES')}</b>
                <span className="muted">{shortName(f.key)}</span>
              </span>
              <span className="muted">{humanBytes(f.size || 0)}</span>
              <span className={f.inOrder ? 'file-row-tag' : 'muted'}>{f.inOrder ? 'de un pedido' : 'sin pedido'}</span>
              {f.inOrder ? (
                <span className="muted" title="Pertenece a un pedido. Para borrarlo, hazlo desde el pedido.">
                  protegido
                </span>
              ) : (
                <button type="button" className="chip chip-danger" disabled={busyKey === f.key} onClick={() => void del(f)}>
                  {busyKey === f.key ? '…' : 'Borrar'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {loading && <p className="muted">Cargando…</p>}
      {cursor && !loading && (
        <button type="button" className="btn" onClick={() => load(cursor)}>
          Ver más archivos
        </button>
      )}
    </section>
  );
}

/**
 * Catalog backup. Prices exist ONLY in the database (there are no default prices
 * in the code), so the owner needs a file of their own: without it, losing that
 * row means losing every price with no way back.
 */
function CatalogBackupTool({ onRestored }: { onRestored: (c: Catalog) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const doExport = async () => {
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const name = await downloadBackup();
      setMsg(`Copia descargada: ${name}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo exportar.');
    } finally {
      setBusy(false);
    }
  };

  /** Everything in the database, not just the configuration. */
  const doFullExport = async () => {
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const name = await downloadDbExport();
      setMsg(`Copia completa descargada: ${name}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo exportar.');
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const parsed = parseBackup(await file.text());
      const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('es-ES') : 'fecha desconocida';
      const ok = window.confirm(
        `Vas a SUSTITUIR los precios y los cupones actuales por los de esta copia.\n\n` +
          `Copia del: ${when}\nPrecios que contiene: ${parsed.priceCount}\nCupones: ${parsed.coupons.length}\n\n` +
          `Esta acción no se puede deshacer. ¿Continuar?`
      );
      if (!ok) return;
      await restoreBackup(parsed);
      onRestored(parsed.catalog);
      setMsg('Catálogo y cupones restaurados.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo restaurar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Copia de seguridad del catálogo</h2>
      <p className="muted">
        Los precios viven <b>solo en la base de datos</b>: no hay copia en el código. Descarga una copia cada vez que
        cambies precios y guárdala fuera de aquí — es tu única red de seguridad si se pierde la configuración.
      </p>
      <div className="block-actions">
        <button type="button" className="btn btn-primary" onClick={() => void doExport()} disabled={busy}>
          ⬇ Descargar copia (JSON)
        </button>
        <button type="button" className="btn" onClick={() => void doFullExport()} disabled={busy}>
          ⬇ Copia completa (todo)
        </button>
        <label className="btn" style={{ cursor: busy ? 'default' : 'pointer' }}>
          ⬆ Restaurar desde archivo
          <input
            type="file"
            accept="application/json,.json"
            hidden
            disabled={busy}
            onChange={(e) => {
              void doImport(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {msg && <p className="muted">✓ {msg}</p>}
      {err && <p className="admin-login-err">⚠ {err}</p>}
      <p className="muted">
        <b>Descargar copia</b> guarda la configuración: precios de todos los canales, perfiles, colores, envíos, datos
        del negocio y cupones. Es la que puedes volver a restaurar aquí. No incluye la credencial de GLS ni ningún
        secreto del servidor.
      </p>
      <p className="muted">
        <b>Copia completa</b> descarga además <b>todos los pedidos y clientes</b>. Es la que importa si se pierde la base
        de datos: con ella se puede reconstruir la tienda entera. Guárdala fuera de aquí y renuévala de vez en cuando.
      </p>
      <p className="admin-login-err">
        ⚠ La copia completa contiene <b>datos personales de tus clientes y la credencial de GLS</b>. Guárdala en un sitio
        seguro y no la envíes por correo ni la subas a ningún sitio compartido.
      </p>
    </section>
  );
}

function EmailTestTool() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>('');
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState(
    'Hola, os envío un archivo. Quiero imprimirlo a color, A4, a doble cara y encuadernado en anillas. Gracias, Antonio.'
  );

  /** Attachments: the files the user picked, or a generated sample PDF. */
  const buildAttachments = async () => {
    if (files.length > 0) {
      return Promise.all(
        files.map(async (f) => ({
          filename: f.name,
          contentType: f.type || 'application/octet-stream',
          dataBase64: bytesToBase64(new Uint8Array(await f.arrayBuffer())),
        }))
      );
    }
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 3; i++) {
      const page = pdf.addPage([595, 842]);
      page.drawText(`Documento de prueba — página ${i}`, { x: 60, y: 760, size: 22, font });
    }
    return [{ filename: 'documento-de-prueba.pdf', contentType: 'application/pdf', dataBase64: bytesToBase64(await pdf.save()) }];
  };

  const run = async () => {
    setBusy(true);
    setResult('');
    try {
      const attachments = await buildAttachments();
      const email = {
        messageId: `test-${Date.now()}`,
        from: 'cliente@example.com',
        fromName: 'Cliente de Prueba',
        subject: 'Trabajo de impresión',
        text,
        attachments,
      };
      // Admin-only endpoint → apiSend attaches the backoffice token.
      const data = await apiSend<{ orderId?: string; error?: string; docs?: number }>('POST', '/ingest-email', { email });
      setResult(`✅ Pedido creado: ${data.orderId} (${data.docs} doc.). Míralo en #pedidos (origen 📧 Email).`);
    } catch (e) {
      setResult(`⚠ ${e instanceof Error ? e.message : 'Error'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Prueba: pedido por email</h2>
      <p className="muted">
        Simula un email entrante. Crea un pedido real con origen “Email”, la IA interpreta el texto y el precio se calcula
        con este catálogo. La lectura del buzón real (Gmail) se conecta después.
      </p>
      <label className="field-block">
        Texto del email (instrucciones del cliente)
        <textarea className="assistant-instructions" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="field-block">
        Adjuntos (PDF o imágenes) — si no eliges ninguno, se envía un PDF de muestra
        <input
          type="file"
          accept="application/pdf,image/*"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </label>
      {files.length > 0 && (
        <p className="muted">{files.length} archivo{files.length !== 1 ? 's' : ''}: {files.map((f) => f.name).join(', ')}</p>
      )}
      <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
        {busy ? 'Enviando…' : '🧪 Simular email de prueba'}
      </button>
      {result && <p className="muted" style={{ marginTop: 10 }}>{result}</p>}
    </section>
  );
}

function ColorEditor({ title, items, onChange, extraOf, onExtra }: { title: string; items: ColorOption[]; onChange: (items: ColorOption[]) => void; extraOf?: (c: ColorOption) => number; onExtra?: (c: ColorOption, v: number) => void }) {
  const [open, setOpen] = useState(false);
  const patch = (i: number, p: Partial<ColorOption>) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const uploadImg = async (i: number, file?: File) => {
    if (!file) return;
    try {
      const raw = await fileToDataUrl(file);
      const img = await downscaleDataUrl(raw, 240, 0.85, 'image/png'); // PNG conserva transparencia
      patch(i, { img });
    } catch {
      /* imagen inválida → se ignora */
    }
  };
  return (
    <section className="card">
      <button type="button" className="collapse-head" onClick={() => setOpen((o) => !o)}>
        <h2 style={{ margin: 0 }}>{title} <span className="muted" style={{ fontWeight: 400 }}>({items.length})</span></h2>
        <span className="collapse-caret">{open ? '▾ ocultar' : '▸ editar'}</span>
      </button>
      {open && (
      <div className="color-editor" style={{ marginTop: 12 }}>
        {items.map((c, i) => (
          <div key={i} className={`color-row${c.enabled === false ? ' color-off' : ''}`}>
            <input
              type="checkbox"
              title="Activar/desactivar"
              checked={c.enabled !== false}
              onChange={(e) => patch(i, { enabled: e.target.checked })}
            />
            {c.img ? (
              <img className="color-thumb" src={c.img} alt="" />
            ) : (
              <input type="color" value={c.hex} onChange={(e) => patch(i, { hex: e.target.value })} />
            )}
            <input type="text" value={c.name} onChange={(e) => patch(i, { name: e.target.value })} />
            <label className="color-extra" title="Suplemento por este color (€)">
              +€
              <input
                type="number"
                step="0.01"
                min="0"
                value={extraOf ? extraOf(c) : c.extra ?? 0}
                onChange={(e) => {
                  const v = num(e.target.value);
                  if (onExtra) onExtra(c, v);
                  else onChange(items.map((x, j) => (j === i ? { ...x, extra: v } : x)));
                }}
              />
            </label>
            <span className="color-actions">
              <label className="chip icon-chip color-upload" title="Subir imagen del color">
                📷
                <input type="file" accept="image/*" hidden onChange={(e) => void uploadImg(i, e.target.files?.[0])} />
              </label>
              {c.img && (
                <button type="button" className="chip icon-chip" title="Quitar imagen (volver a color)" onClick={() => patch(i, { img: undefined })}>
                  🚫
                </button>
              )}
              <button type="button" className="chip icon-chip chip-danger" title="Eliminar color" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                🗑
              </button>
            </span>
          </div>
        ))}
        <button type="button" className="chip" onClick={() => onChange([...items, { name: 'Nuevo color', hex: '#cccccc', enabled: true, extra: 0 }])}>
          + Añadir color
        </button>
      </div>
      )}
    </section>
  );
}

/** Payment methods offered at checkout. "Pay at counter" now; Redsys later. */
function PaymentsEditor({ draft, change }: { draft: Catalog; change: (fn: (d: Catalog) => void) => void }) {
  const p = draft.payments ?? DEFAULT_PAYMENTS;
  const setLocal = (patch: Partial<PaymentMethodConfig>) =>
    change((d) => {
      const cur = d.payments ?? structuredClone(DEFAULT_PAYMENTS);
      d.payments = { ...cur, local: { ...cur.local, ...patch } };
    });
  return (
    <section className="card">
      <h2>Métodos de pago</h2>
      <p className="muted">Cómo pueden pagar tus clientes al tramitar el pedido.</p>

      <div className="pay-method">
        <label className="chk">
          <input type="checkbox" checked={p.local.enabled} onChange={(e) => setLocal({ enabled: e.target.checked })} />
          <b>Pagar al recoger</b> <span className="muted">(en el mostrador)</span>
        </label>
        <label className="field-inline">
          Texto para el cliente
          <input type="text" maxLength={40} value={p.local.label} onChange={(e) => setLocal({ label: e.target.value })} />
        </label>
      </div>

      <div className="pay-method">
        <label className="chk">
          <input
            type="checkbox"
            checked={p.redsys?.enabled ?? false}
            onChange={(e) => change((d) => {
              const cur = d.payments ?? structuredClone(DEFAULT_PAYMENTS);
              d.payments = { ...cur, redsys: { enabled: e.target.checked } };
            })}
          />
          <b>Pago online · tarjeta y Bizum (Redsys)</b>
        </label>
        <p className="muted">Las credenciales (comercio, terminal, clave, entorno) se configuran en las variables del servidor <code>REDSYS_*</code>. Necesario para el envío a domicilio (exige pago previo).</p>
      </div>

      {(() => {
        const matrix = p.matrix ?? DEFAULT_PAY_MATRIX;
        const setCell = (mode: 'recoger' | 'envio', method: 'local' | 'redsys', val: boolean) =>
          change((d) => {
            const cur = d.payments ?? structuredClone(DEFAULT_PAYMENTS);
            const m = cur.matrix ?? structuredClone(DEFAULT_PAY_MATRIX);
            d.payments = { ...cur, matrix: { ...m, [mode]: { ...m[mode], [method]: val } } };
          });
        return (
          <div className="pay-matrix">
            <h3>Métodos permitidos según la entrega</h3>
            <table>
              <thead>
                <tr>
                  <th>Entrega</th>
                  <th>Pagar al recoger</th>
                  <th>Pago online</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Recoger en tienda</td>
                  <td><input type="checkbox" checked={matrix.recoger.local} onChange={(e) => setCell('recoger', 'local', e.target.checked)} /></td>
                  <td><input type="checkbox" checked={matrix.recoger.redsys} onChange={(e) => setCell('recoger', 'redsys', e.target.checked)} /></td>
                </tr>
                <tr>
                  <td>Envío a domicilio</td>
                  <td><input type="checkbox" checked={matrix.envio.local} onChange={(e) => setCell('envio', 'local', e.target.checked)} /></td>
                  <td><input type="checkbox" checked={matrix.envio.redsys} onChange={(e) => setCell('envio', 'redsys', e.target.checked)} /></td>
                </tr>
              </tbody>
            </table>
            <p className="muted">Por defecto, el envío a domicilio solo permite pago online (pago previo). "Pagar al recoger" en envío equivaldría a contra reembolso.</p>
          </div>
        );
      })()}

      {!p.local.enabled && !(p.redsys?.enabled) && (
        <p className="muted">⚠ Con "Pagar al recoger" desactivado y sin pago online, los clientes no podrán finalizar el pedido.</p>
      )}
    </section>
  );
}

/** Shop identity used by invoices and the privacy policy. */
function BusinessEditor({ draft, change }: { draft: Catalog; change: (fn: (d: Catalog) => void) => void }) {
  const b = draft.business ?? DEFAULT_BUSINESS;
  const set = (patch: Partial<typeof b>) => change((d) => { d.business = { ...DEFAULT_BUSINESS, ...d.business, ...patch }; });
  return (
    <section className="card">
      <h2>Datos del negocio</h2>
      <p className="muted">Se usan en los tickets/albaranes y en la política de privacidad.</p>
      <div className="admin-grid">
        <label className="field-inline">
          Nombre / razón social
          <input type="text" value={b.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field-inline">
          NIF
          <input type="text" value={b.nif} onChange={(e) => set({ nif: e.target.value })} />
        </label>
        <label className="field-inline">
          Email de contacto
          <input type="email" value={b.email} onChange={(e) => set({ email: e.target.value })} />
        </label>
      </div>
      <label className="field-block" style={{ marginTop: 10 }}>
        Dirección
        <textarea className="assistant-instructions" rows={2} value={b.address} onChange={(e) => set({ address: e.target.value })} />
      </label>
    </section>
  );
}

/**
 * Legal texts. Lives in the DB like everything else the shop owns, so the wording
 * can be corrected (or replaced by what a lawyer sends) without a deploy.
 *
 * Two levels: the consent sentences + the details the templates need, and a
 * full-text override per document for when the shop wants its own wording.
 */
/**
 * Textos de la portada.
 *
 * Están aquí y no en el código para que la tienda pueda cambiar la frase de
 * bienvenida o quitar un producto de la portada sin esperar a un despliegue. Solo
 * texto plano: la web lo pinta como texto, nunca como HTML.
 */
/**
 * Logo de la tienda.
 *
 * Se guarda dentro de la configuración como data URL, no en el almacenamiento de
 * archivos: las URLs firmadas de R2 caducan en una hora y el logo tiene que verlo
 * cualquier visitante. Como la configuración se descarga en cada carga de página,
 * el tamaño se limita de verdad — un logo de 2 MB lo pagarían todos los clientes.
 */
function LogoField({ draft, change }: { draft: Catalog; change: (fn: (d: Catalog) => void) => void }) {
  const [error, setError] = useState('');
  const logo = draft.business?.logo ?? '';

  const pick = (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
      setError('El logo debe ser una imagen PNG, JPG, WEBP o SVG.');
      return;
    }
    // El data URL crece ~33% respecto al archivo, así que se comprueba el
    // resultado final y no el tamaño del fichero original.
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      if (url.length > MAX_LOGO_BYTES) {
        setError(
          `La imagen es demasiado grande (${Math.round(url.length / 1024)} kB). El máximo es ${Math.round(MAX_LOGO_BYTES / 1024)} kB: el logo se descarga en cada visita. Un PNG de unos 300 px de ancho suele sobrar.`
        );
        return;
      }
      change((d) => { d.business = { ...DEFAULT_BUSINESS, ...d.business, logo: url }; });
    };
    reader.onerror = () => setError('No se pudo leer el archivo.');
    reader.readAsDataURL(file);
  };

  return (
    <div className="field-block">
      Logo de la tienda
      {logo ? (
        <div className="logo-preview">
          <img src={logo} alt="Logo de la tienda" />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => change((d) => { d.business = { ...DEFAULT_BUSINESS, ...d.business, logo: '' }; })}
          >
            Quitar logo
          </button>
        </div>
      ) : (
        <p className="muted">
          Sin logo se muestra el nombre de la tienda con una marca de color. Sube un PNG con fondo transparente si lo
          tienes.
        </p>
      )}
      <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => pick(e.target.files?.[0])} />
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function LandingEditor({ draft, change }: { draft: Catalog; change: (fn: (d: Catalog) => void) => void }) {
  const t = landingOf(draft);
  const set = (patch: Partial<typeof t>) => change((d) => { d.landing = { ...DEFAULT_LANDING, ...d.landing, ...patch }; });

  return (
    <section className="card">
      <h2>Página de inicio</h2>
      <p className="muted">
        Lo que ve quien entra en la web por primera vez. El nombre, la dirección y el teléfono no se ponen aquí: salen
        de los datos del negocio y de la ficha legal, para no tenerlos escritos en dos sitios distintos.
      </p>
      <LogoField draft={draft} change={change} />
      <label className="field-block">
        Frase principal
        <input value={t.claim} onChange={(e) => set({ claim: e.target.value })} maxLength={70} />
      </label>
      <label className="field-block">
        Frase de apoyo
        <textarea rows={3} value={t.subclaim} onChange={(e) => set({ subclaim: e.target.value })} maxLength={300} />
      </label>
      <label className="field-block">
        Frase de confianza (opcional)
        <input
          value={t.trust}
          onChange={(e) => set({ trust: e.target.value })}
          maxLength={120}
          placeholder="Ej.: Miles de opositores ya imprimen sus temarios con nosotros"
        />
      </label>
      <label className="field-block">
        Aviso en la tira superior (vacío = no se muestra)
        <input
          value={t.banner}
          onChange={(e) => set({ banner: e.target.value })}
          maxLength={140}
          placeholder="Ej.: Cerrado del 15 al 22 de agosto · Los pedidos se preparan a la vuelta"
        />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={t.showPriceFrom} onChange={(e) => set({ showPriceFrom: e.target.checked })} />
        Mostrar «imprime desde X € la página» con el precio más bajo de tu tarifa
      </label>
      <label className="check-row">
        <input type="checkbox" checked={t.showMugs} onChange={(e) => set({ showMugs: e.target.checked })} />
        Mostrar tazas personalizadas en la portada
      </label>
      <label className="check-row">
        <input type="checkbox" checked={t.showBadges} onChange={(e) => set({ showBadges: e.target.checked })} />
        Mostrar chapas personalizadas en la portada
      </label>
      <NoticeBoardEditor draft={draft} change={change} />
    </section>
  );
}

/**
 * Tablón de anuncios de la portada.
 *
 * Para lo que la tienda quiera contar y no cabe en una tarifa: material nuevo,
 * horarios de exámenes, promociones de temporada. Se guarda en la base de datos,
 * así que lo cambia el dueño cuando quiera y sin desplegar.
 */
function NoticeBoardEditor({ draft, change }: { draft: Catalog; change: (fn: (d: Catalog) => void) => void }) {
  const t = landingOf(draft);
  const write = (notices: Notice[]) => change((d) => { d.landing = { ...DEFAULT_LANDING, ...d.landing, notices }; });
  const edit = (i: number, patch: Partial<Notice>) =>
    write(t.notices.map((n, j) => (j === i ? { ...n, ...patch } : n)));

  return (
    <div className="field-block">
      Tablón de anuncios
      <p className="muted">
        Aparece como una sección propia en la portada. Sin anuncios no se muestra nada, así que se puede dejar vacío.
      </p>
      {t.notices.map((n, i) => (
        <div className="notice-edit" key={i}>
          <input
            value={n.title}
            onChange={(e) => edit(i, { title: e.target.value })}
            maxLength={80}
            placeholder="Título del anuncio"
          />
          <textarea
            rows={3}
            value={n.text}
            onChange={(e) => edit(i, { text: e.target.value })}
            maxLength={600}
            placeholder="Texto del anuncio"
          />
          <div className="block-actions">
            <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => {
              const next = [...t.notices];
              [next[i - 1], next[i]] = [next[i], next[i - 1]];
              write(next);
            }}>
              ↑ Subir
            </button>
            <button type="button" className="btn btn-sm" onClick={() => write(t.notices.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
        </div>
      ))}
      <div className="block-actions">
        <button type="button" className="btn" onClick={() => write([...t.notices, { title: '', text: '' }])}>
          + Añadir anuncio
        </button>
      </div>
    </div>
  );
}

function LegalEditor({ draft, change }: { draft: Catalog; change: (fn: (d: Catalog) => void) => void }) {
  const l = { ...DEFAULT_LEGAL, ...(draft.legal ?? {}) };
  const set = (patch: Partial<typeof l>) => change((d) => { d.legal = { ...DEFAULT_LEGAL, ...d.legal, ...patch }; });

  return (
    <>
      <section className="card">
        <h2>Textos de consentimiento</h2>
        <p className="muted">
          Lo que el cliente marca antes de comprar. El enlace al documento lo añade la web; aquí solo va el texto.
        </p>
        <label className="field-block">
          Consentimiento de privacidad (alta de cuenta y pedido)
          <textarea rows={2} value={l.consentPrivacy} onChange={(e) => set({ consentPrivacy: e.target.value })} />
        </label>
        <label className="field-block">
          Aceptación de condiciones y renuncia a devolución (pago)
          <textarea rows={3} value={l.consentTerms} onChange={(e) => set({ consentTerms: e.target.value })} />
        </label>
        <p className="muted">
          ⚠ El segundo es el que hace válida la <b>exclusión del derecho de desistimiento</b> en trabajos
          personalizados: debe decir claramente que el pedido se produce según las especificaciones del cliente y que no
          admite devolución. Si lo suavizas, pierdes la excepción.
        </p>
      </section>

      <section className="card">
        <h2>Datos para los documentos legales</h2>
        <p className="muted">
          Rellenan los huecos de las plantillas de <a href="#aviso-legal" target="_blank" rel="noopener noreferrer">aviso legal</a> y{' '}
          <a href="#condiciones" target="_blank" rel="noopener noreferrer">condiciones de venta</a>. Lo que dejes vacío
          aparecerá entre corchetes en la web.
        </p>
        <div className="admin-grid">
          <label className="field-inline">
            Teléfono de contacto
            <input type="text" value={l.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="900 000 000" />
          </label>
          <label className="field-inline">
            Fecha de última actualización
            <input type="text" value={l.updatedAt} onChange={(e) => set({ updatedAt: e.target.value })} placeholder="29/07/2026" />
          </label>
          <label className="field-inline">
            Plazo de preparación
            <input type="text" value={l.prepTime} onChange={(e) => set({ prepTime: e.target.value })} placeholder="24-48 h laborables" />
          </label>
          <label className="field-inline">
            Plazo de entrega (envíos)
            <input type="text" value={l.deliveryTime} onChange={(e) => set({ deliveryTime: e.target.value })} placeholder="24-72 h laborables" />
          </label>
          <label className="field-inline">
            Custodia del pedido en tienda
            <input type="text" value={l.custodyDays} onChange={(e) => set({ custodyDays: e.target.value })} placeholder="30 días" />
          </label>
        </div>
        <label className="field-block">
          Datos registrales (solo si es sociedad)
          <input type="text" value={l.registro} onChange={(e) => set({ registro: e.target.value })} placeholder="Registro Mercantil de …, tomo …, folio …, hoja …" />
        </label>
      </section>

      <section className="card">
        <h2>Reescribir los documentos completos</h2>
        <p className="muted">
          Opcional. Si escribes algo aquí, <b>sustituye por completo</b> el texto redactado por defecto (por ejemplo,
          para poner el que te dé tu abogado). Déjalo vacío para seguir usando la plantilla, que se rellena sola con tus
          precios, zonas de envío y formas de pago. Se muestra como texto plano: se respetan los saltos de línea.
        </p>
        <label className="field-block">
          Aviso legal
          <textarea rows={6} value={l.legalNoticeText} onChange={(e) => set({ legalNoticeText: e.target.value })} placeholder="(vacío = usar la plantilla)" />
        </label>
        <label className="field-block">
          Condiciones de venta
          <textarea rows={6} value={l.termsText} onChange={(e) => set({ termsText: e.target.value })} placeholder="(vacío = usar la plantilla)" />
        </label>
        <label className="field-block">
          Política de privacidad
          <textarea rows={6} value={l.privacyText} onChange={(e) => set({ privacyText: e.target.value })} placeholder="(vacío = usar la plantilla)" />
        </label>
        <p className="muted">
          ⚠ Si reescribes las condiciones de venta, sube la <b>versión</b> en el código (<code>TERMS_VERSION</code>) para
          que quede registrado con los pedidos qué texto aceptó cada cliente.
        </p>
      </section>
    </>
  );
}

/** Invoicing: on/off + VAT rate (the header uses the shop's business data). */
function InvoicingEditor({ draft, change }: { draft: Catalog; change: (fn: (d: Catalog) => void) => void }) {
  const inv = draft.invoicing ?? DEFAULT_INVOICING;
  const set = (patch: Partial<typeof inv>) => change((d) => { d.invoicing = { ...DEFAULT_INVOICING, ...d.invoicing, ...patch }; });
  return (
    <section className="card">
      <h2>Tickets y albaranes</h2>
      <p className="muted">
        Genera un documento descargable por pedido (ticket si está pagado, albarán si no) con los datos del negocio de
        arriba.
      </p>
      <label className="chk">
        <input type="checkbox" checked={inv.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Activar la generación de tickets y albaranes
      </label>
      <div className="admin-grid" style={{ marginTop: 12 }}>
        <label className="field-inline">
          IVA aplicado (%)
          <input
            type="number"
            step="1"
            min="0"
            max="100"
            value={inv.vatPercent ?? DEFAULT_VAT_PERCENT}
            onChange={(e) => set({ vatPercent: num(e.target.value) })}
          />
        </label>
      </div>
      <p className="muted">
        Los precios del catálogo se introducen <b>con IVA incluido</b>; este tipo se usa para desglosar base y cuota en
        los documentos y en el resumen fiscal.
      </p>
      {inv.enabled && (!(draft.business?.name) || !(draft.business?.nif)) && (
        <p className="muted">⚠ Completa el nombre y el NIF en "Datos del negocio" para que los documentos salgan correctos.</p>
      )}
      {inv.enabled && (
        <p className="muted">
          Se emite <b>TICKET</b> si el pedido está pagado y <b>ALBARÁN</b> si no. <b>No son facturas</b> y el propio
          documento lo dice: si un cliente necesita factura, emítesela con tu programa de facturación.
        </p>
      )}
    </section>
  );
}

/** Home delivery config: prices by zone + free-shipping threshold + info text. */
function ShippingEditor({ draft, change }: { draft: Catalog; change: (fn: (d: Catalog) => void) => void }) {
  const s = draft.shipping ?? DEFAULT_SHIPPING;
  const set = (patch: Partial<typeof s>) => change((d) => { d.shipping = { ...DEFAULT_SHIPPING, ...d.shipping, ...patch }; });
  return (
    <section className="card">
      <h2>Envíos a domicilio</h2>
      <label className="chk">
        <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Activar envíos a domicilio
      </label>
      {s.enabled && (
        <>
          <div className="admin-grid" style={{ marginTop: 12 }}>
            <label className="field-inline">
              Precio Península (€)
              <input type="number" step="0.01" min="0" value={s.peninsula} onChange={(e) => set({ peninsula: num(e.target.value) })} />
            </label>
            <label className="field-inline">
              Precio Baleares / islas (€)
              <input type="number" step="0.01" min="0" value={s.baleares} onChange={(e) => set({ baleares: num(e.target.value) })} />
            </label>
            <label className="field-inline">
              Envío gratis a partir de (€ · 0 = nunca)
              <input type="number" step="0.01" min="0" value={s.freeThreshold} onChange={(e) => set({ freeThreshold: num(e.target.value) })} />
            </label>
          </div>
          <label className="field-block" style={{ marginTop: 10 }}>
            Texto informativo (se muestra al cliente)
            <textarea className="assistant-instructions" rows={3} value={s.info} onChange={(e) => set({ info: e.target.value })} />
          </label>
          <p className="muted">Canarias no está permitido (se detecta por el código postal). Baleares usa el precio de islas.</p>
        </>
      )}
    </section>
  );
}

/** GLS courier config — stored separately from the price catalog (backoffice
 *  only; the customer configurator never loads it). The GUID is write-only:
 *  saved to the server but never sent back to the browser. */
function GlsEditor() {
  const [s, setS] = useState<GlsSettings>(DEFAULT_GLS_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    loadGlsSettings()
      .then((v) => { if (alive) setS(v); })
      .catch(() => { /* keep defaults */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const set = (patch: Partial<GlsSettings>) => { setS((p) => ({ ...p, ...patch })); setSaved(false); };
  const onSave = async () => {
    setSaving(true);
    setErr('');
    try {
      await saveGlsSettings(s);
      setS(await loadGlsSettings()); // refresh (clears the typed guid, updates hasGuid)
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="card">
        <h2>Envíos GLS</h2>
        <p className="muted">Cargando…</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Envíos GLS</h2>
      <p className="muted">Config del transportista. No forma parte del catálogo de precios: solo se usa en el backoffice para generar etiquetas.</p>
      <label className="chk" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Activar generación de etiquetas GLS
      </label>
      {s.enabled && (
        <>
          <label className="field-block" style={{ marginTop: 12 }}>
            GUID de tu cuenta GLS (credencial)
            <input
              type="password"
              autoComplete="off"
              placeholder={s.hasGuid ? '•••••••• (guardado — escribe para cambiarlo)' : 'Pega aquí el GUID de GLS'}
              value={s.guid ?? ''}
              onChange={(e) => set({ guid: e.target.value })}
            />
          </label>
          <p className="muted">Se guarda en el servidor y nunca se muestra de vuelta, por seguridad.</p>
          <div className="admin-grid" style={{ marginTop: 12 }}>
            <label className="field-inline">
              Nombre remitente
              <input value={s.senderName} onChange={(e) => set({ senderName: e.target.value })} />
            </label>
            <label className="field-inline">
              Teléfono remitente
              <input value={s.senderPhone} onChange={(e) => set({ senderPhone: e.target.value })} />
            </label>
            <label className="field-inline">
              Dirección remitente
              <input value={s.senderStreet} onChange={(e) => set({ senderStreet: e.target.value })} />
            </label>
            <label className="field-inline">
              CP remitente
              <input value={s.senderCp} onChange={(e) => set({ senderCp: e.target.value })} />
            </label>
            <label className="field-inline">
              Población remitente
              <input value={s.senderCity} onChange={(e) => set({ senderCity: e.target.value })} />
            </label>
            <label className="field-inline">
              Servicio (96 = BusinessParcel)
              <input value={s.service} onChange={(e) => set({ service: e.target.value })} />
            </label>
            <label className="field-inline">
              Horario (18)
              <input value={s.horario} onChange={(e) => set({ horario: e.target.value })} />
            </label>
            <label className="field-inline">
              Peso por bulto (kg)
              <input value={s.weight} onChange={(e) => set({ weight: e.target.value })} />
            </label>
          </div>
        </>
      )}
      <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar GLS'}
        </button>
        {saved && <span className="muted">✓ Guardado</span>}
        {err && <span className="price-flag">{err}</span>}
      </div>
    </section>
  );
}

/** Discount coupons: CRUD + usage report (uses counted from real orders). */
function CouponsEditor() {
  const [list, setList] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  const [visible, setVisible] = useState(12);
  const [agg, setAgg] = useState<CouponAnalytics | null>(null);

  useEffect(() => {
    let alive = true;
    loadCoupons()
      .then((c) => { if (alive) setList(c); })
      .catch(() => { /* keep empty */ })
      .finally(() => { if (alive) setLoading(false); });
    // Usage counts come from SQL over the whole history: counting the loaded page
    // would show a coupon as unused just because its orders are older.
    const { months, from, to } = monthWindow(1);
    fetchCouponAgg(from, to, 'all')
      .then((r) => { if (alive && r) setAgg(pivotCouponAgg(r.rows, months, r.ordersTotal)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Total uses ever, and uses this month, per coupon.
  const usage = (code: string) => {
    const c = code.trim().toUpperCase();
    if (!c || !agg) return { total: 0, month: 0 };
    const row = agg.rows.find((r) => r.code === c);
    if (!row) return { total: 0, month: 0 };
    return { total: row.uses, month: row.byMonth[agg.months[0]]?.uses ?? 0 };
  };

  const update = (i: number, patch: Partial<Coupon>) => {
    setList((l) => l.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
    setSaved(false);
  };
  const add = () => {
    // Prepend so the new (empty) coupon is always visible at the top, even with
    // pagination or an active search.
    setList((l) => [{ code: '', ...NEW_COUPON, createdAt: Date.now() }, ...l]);
    setFilter('');
    setSaved(false);
  };
  const removeAt = (i: number) => { setList((l) => l.filter((_, idx) => idx !== i)); setSaved(false); };

  const dateToInput = (ts?: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');
  const inputToDate = (s: string) => (s ? new Date(s + 'T23:59:59').getTime() : undefined);

  const onSave = async () => {
    const clean = list.map((c) => ({ ...c, code: c.code.trim().toUpperCase() })).filter((c) => c.code);
    const codes = clean.map((c) => c.code);
    if (new Set(codes).size !== codes.length) { setErr('Hay códigos repetidos.'); return; }
    setSaving(true);
    setErr('');
    try {
      await saveCoupons(clean);
      setList(clean);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="card">
        <h2>Cupones de descuento</h2>
        <p className="muted">Cargando…</p>
      </section>
    );
  }

  // Keep real indices (edit/delete operate by index) while filtering + paginating.
  const matches = list.map((c, i) => ({ c, i })).filter(({ c }) => !filter || c.code.toUpperCase().includes(filter.toUpperCase()));
  const shown = matches.slice(0, visible);

  return (
    <section className="card">
      <h2>Cupones de descuento</h2>
      <p className="muted">Los usos se cuentan sobre los pedidos reales. El descuento se aplica al subtotal de productos (antes del envío) y se valida en el servidor.</p>
      {list.length === 0 && <p className="muted">Aún no hay cupones. Añade el primero abajo.</p>}
      {list.length > 1 && (
        <input
          className="coupon-search"
          type="search"
          placeholder="🔎 Buscar cupón por código…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      {shown.map(({ c, i }) => {
        const u = usage(c.code);
        return (
          <div className="coupon-row" key={i}>
            <div className="admin-grid">
              <label className="field-inline">
                Código
                <input value={c.code} onChange={(e) => update(i, { code: e.target.value.toUpperCase() })} placeholder="HOLA10" />
              </label>
              <label className="field-inline">
                Tipo
                <select value={c.type} onChange={(e) => update(i, { type: e.target.value as CouponType })}>
                  <option value="percent">Porcentaje (%)</option>
                  <option value="fixed">Importe fijo (€)</option>
                </select>
              </label>
              <label className="field-inline">
                {c.type === 'percent' ? 'Descuento (%)' : 'Descuento (€)'}
                <input type="number" step="0.01" min="0" value={c.value} onChange={(e) => update(i, { value: num(e.target.value) })} />
              </label>
              <label className="field-inline">
                Mínimo pedido (€)
                <input type="number" step="0.01" min="0" value={c.minSubtotal ?? 0} onChange={(e) => update(i, { minSubtotal: num(e.target.value) })} />
              </label>
              <label className="field-inline">
                Límite total (0 = ∞)
                <input type="number" step="1" min="0" value={c.maxUses ?? 0} onChange={(e) => update(i, { maxUses: num(e.target.value) })} />
              </label>
              <label className="field-inline">
                Límite por cliente (0 = ∞)
                <input type="number" step="1" min="0" value={c.maxUsesPerCustomer ?? 0} onChange={(e) => update(i, { maxUsesPerCustomer: num(e.target.value) })} />
              </label>
              <label className="field-inline">
                Caduca
                <input type="date" value={dateToInput(c.expiresAt)} onChange={(e) => update(i, { expiresAt: inputToDate(e.target.value) })} />
              </label>
              <label className="chk" style={{ alignSelf: 'end' }}>
                <input type="checkbox" checked={c.active} onChange={(e) => update(i, { active: e.target.checked })} />
                Activo
              </label>
              <div className="field-inline">
                Canales (dónde aplica)
                <span className="coupon-src-toggles">
                  {(['online', 'mostrador'] as const).map((s) => {
                    const list = c.sources ?? ['online', 'mostrador'];
                    return (
                      <label key={s} className="chk">
                        <input
                          type="checkbox"
                          checked={list.includes(s)}
                          onChange={(e) => {
                            const base = c.sources ?? ['online', 'mostrador'];
                            const next = e.target.checked ? Array.from(new Set([...base, s])) : base.filter((x) => x !== s);
                            update(i, { sources: next as ('online' | 'mostrador')[] });
                          }}
                        />
                        {s === 'online' ? 'Web' : 'Papelería'}
                      </label>
                    );
                  })}
                </span>
              </div>
            </div>
            <div className="coupon-meta">
              <span className="muted">
                Usos: <b>{u.total}</b>
                {c.maxUses ? ` / ${c.maxUses}` : ''} · este mes: <b>{u.month}</b>
              </span>
              <span className="coupon-meta-actions">
                {c.code.trim() && (
                  <a className="chip" href={`#estadisticas/cupon/${encodeURIComponent(c.code.trim().toUpperCase())}`}>📊 Estadística</a>
                )}
                <button type="button" className="chip chip-danger" onClick={() => removeAt(i)}>Eliminar</button>
              </span>
            </div>
          </div>
        );
      })}
      {matches.length > visible && (
        <button type="button" className="btn coupon-more" onClick={() => setVisible((v) => v + 12)}>
          Ver más ({matches.length - visible})
        </button>
      )}
      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="chip" onClick={add}>+ Añadir cupón</button>
        <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cupones'}
        </button>
        {saved && <span className="muted">✓ Guardado</span>}
        {err && <span className="price-flag">{err}</span>}
      </div>
    </section>
  );
}

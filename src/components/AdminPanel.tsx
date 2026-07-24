import { useEffect, useState } from 'react';
import { loadGlsSettings, saveGlsSettings, DEFAULT_GLS_SETTINGS, type GlsSettings } from '../lib/glsSettings';
import { loadCoupons, saveCoupons } from '../lib/coupons';
import { NEW_COUPON, type Coupon, type CouponType } from '../domain/coupons';
import { useOrders } from '../store/useOrders';
import {
  ALL_FINISHES,
  ALL_FOLIOS,
  ALL_SIZES,
  CARAS,
  COLORS,
  DEFAULT_CATALOG,
  DEFAULT_PAYMENTS,
  DEFAULT_PAY_MATRIX,
  DEFAULT_INVOICING,
  DEFAULT_BUSINESS,
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
      <h3 style={{ margin: '0 0 8px' }}>{label} · activar por fuente</h3>
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

type AdminTab = 'catalogo' | 'pagos' | 'envios' | 'cupones' | 'asistente' | 'herramientas';
import type { Acabado, Configuracion, DobleCara, Grosor, Size } from '../domain/types';
import type { Preset } from '../domain/presets';
import { saveCatalog, useConfigurator } from '../store/useConfigurator';
import { API_BASE } from '../lib/api';
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
  const [tab, setTab] = useState<AdminTab>('catalogo');
  const [priceSrc, setPriceSrc] = useState<SourceKey>('online');

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
  const restore = () => {
    if (window.confirm('¿Restaurar todos los valores por defecto?')) {
      setDraft(structuredClone(DEFAULT_CATALOG));
      setDirty(true);
    }
  };

  return (
    <div className="app admin">
      <header className="topbar">
        <h1>Administración</h1>
        <nav className="topnav">
          <a className="btn" href="#pedidos">
            Pedidos
          </a>
          <a className="btn" href="#estadisticas">
            📊 Estadísticas
          </a>
          <a className="btn" href="#">
            ← Volver a la tienda
          </a>
        </nav>
      </header>

      <div className="admin-body">
        <nav className="admin-tabs">
          <button type="button" className={`admin-tab${tab === 'catalogo' ? ' on' : ''}`} onClick={() => setTab('catalogo')}>Catálogo y precios</button>
          <button type="button" className={`admin-tab${tab === 'pagos' ? ' on' : ''}`} onClick={() => setTab('pagos')}>Pagos y facturación</button>
          <button type="button" className={`admin-tab${tab === 'envios' ? ' on' : ''}`} onClick={() => setTab('envios')}>Envíos</button>
          {API_BASE && (
            <button type="button" className={`admin-tab${tab === 'cupones' ? ' on' : ''}`} onClick={() => setTab('cupones')}>Cupones</button>
          )}
          <button type="button" className={`admin-tab${tab === 'asistente' ? ' on' : ''}`} onClick={() => setTab('asistente')}>Asistente</button>
          {API_BASE && (
            <button type="button" className={`admin-tab${tab === 'herramientas' ? ' on' : ''}`} onClick={() => setTab('herramientas')}>Herramientas</button>
          )}
        </nav>

        {tab === 'catalogo' && (
          <>
        {/* Selector de source para los PRECIOS (lo demás es común) */}
        <section className="card src-price-bar">
          <div className="stats-card-head">
            <h2>💶 Precios por source</h2>
            <div className="seg-toggle sm">
              {(['online', 'mostrador', 'email'] as SourceKey[]).map((s) => (
                <button key={s} type="button" className={priceSrc === s ? 'on' : ''} onClick={() => setPriceSrc(s)}>{SRC_LABEL[s]}</button>
              ))}
            </div>
          </div>
          <p className="muted">
            Perfiles rápidos, tamaños, gramajes y los colores de anillas/contraportadas son <b>comunes</b> a todas las sources.
            Los <b>precios</b> (por página, encuadernación, suplementos, taza/chapa y el € de cada color) son los de <b>{SRC_LABEL[priceSrc]}</b>.
          </p>
        </section>

        {/* Perfiles rápidos */}
        <PresetsEditor presets={draft.presets} onChange={(presets) => change((d) => { d.presets = presets; })} />

        {/* Tamaños y gramajes */}
        <section className="card">
          <h2>Tamaños y gramajes</h2>
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

        {/* Precios por página */}
        <section className="card">
          <h2>Precio por página impresa (€)</h2>
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
          </>
        )}

        {tab === 'pagos' && (
          <>
            <BusinessEditor draft={draft} change={change} />
            <PaymentsEditor draft={draft} change={change} />
            <SourceToggles draft={draft} change={change} mod="payments" label="Pago en local" />
            <InvoicingEditor draft={draft} change={change} />
            <SourceToggles draft={draft} change={change} mod="invoicing" label="Facturación" />
          </>
        )}

        {tab === 'envios' && (
          <>
            <ShippingEditor draft={draft} change={change} />
            <SourceToggles draft={draft} change={change} mod="shipping" label="Envíos" sources={['online', 'mostrador']} />
            <GlsEditor />
          </>
        )}

        {tab === 'cupones' && (
          <>
            <SourceToggles draft={draft} change={change} mod="coupons" label="Cupones" />
            <CouponsEditor />
          </>
        )}

        {tab === 'asistente' && (
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

        {tab === 'herramientas' && API_BASE && (
          <>
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

      <footer className="admin-actions">
        <button type="button" className="btn" onClick={restore}>
          Restaurar valores por defecto
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty}>
          {dirty ? 'Guardar cambios' : 'Guardado'}
        </button>
      </footer>
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
      const res = await fetch(`${API_BASE}/ingest-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { orderId?: string; error?: string; docs?: number };
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
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
      <h2>{title}</h2>
      <div className="color-editor">
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
      <p className="muted">Se usan en las facturas y en la política de privacidad.</p>
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

/** Invoicing: just on/off (the header uses the shop's business data). */
function InvoicingEditor({ draft, change }: { draft: Catalog; change: (fn: (d: Catalog) => void) => void }) {
  const inv = draft.invoicing ?? DEFAULT_INVOICING;
  const set = (patch: Partial<typeof inv>) => change((d) => { d.invoicing = { ...DEFAULT_INVOICING, ...d.invoicing, ...patch }; });
  return (
    <section className="card">
      <h2>Facturación</h2>
      <p className="muted">Genera facturas (proforma o factura según el pago) descargables desde los pedidos. Usa los datos del negocio de arriba.</p>
      <label className="chk">
        <input type="checkbox" checked={inv.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Activar la generación de facturas
      </label>
      {inv.enabled && (!(draft.business?.name) || !(draft.business?.nif)) && (
        <p className="muted">⚠ Completa el nombre y el NIF en "Datos del negocio" para que las facturas salgan correctas.</p>
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
  const orders = useOrders((s) => s.orders);
  const fetchOrders = useOrders((s) => s.fetchOrders);

  useEffect(() => {
    let alive = true;
    loadCoupons()
      .then((c) => { if (alive) setList(c); })
      .catch(() => { /* keep empty */ })
      .finally(() => { if (alive) setLoading(false); });
    void fetchOrders(); // usage is derived from orders
    return () => { alive = false; };
  }, [fetchOrders]);

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const usage = (code: string) => {
    const c = code.trim().toUpperCase();
    if (!c) return { total: 0, month: 0 };
    const used = orders.filter((o) => (o.couponCode ?? '').toUpperCase() === c);
    return { total: used.length, month: used.filter((o) => o.createdAt >= monthStart).length };
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

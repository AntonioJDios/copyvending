import { useState } from 'react';
import {
  ALL_FINISHES,
  ALL_FOLIOS,
  ALL_SIZES,
  CARAS,
  COLORS,
  DEFAULT_CATALOG,
  FINISH_LABEL,
  FOLIO_LABEL,
  GROSORES,
  SIZE_LABEL,
  priceKey,
  type Catalog,
  type ColorOption,
} from '../domain/catalog';
import type { Acabado, Configuracion, DobleCara, Grosor, Size } from '../domain/types';
import type { Preset } from '../domain/presets';
import { saveCatalog, useConfigurator } from '../store/useConfigurator';
import { API_BASE } from '../lib/api';

const num = (v: string) => (v === '' ? 0 : Number(v));

export function AdminPanel() {
  const catalog = useConfigurator((s) => s.catalog);
  const setCatalog = useConfigurator((s) => s.setCatalog);
  const [draft, setDraft] = useState<Catalog>(() => structuredClone(catalog));
  const [dirty, setDirty] = useState(false);

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
        <h1>Administración · catálogo</h1>
        <nav className="topnav">
          <a className="btn" href="#pedidos">
            Pedidos
          </a>
          <a className="btn" href="#">
            ← Volver a la tienda
          </a>
        </nav>
      </header>

      <div className="admin-body">
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
                                value={draft.pagePrices[k]}
                                onChange={(e) => change((d) => { d.pagePrices[k] = num(e.target.value); })}
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
                      value={draft.bindingPrices[f]}
                      onChange={(e) => change((d) => { d.bindingPrices[f] = num(e.target.value); })}
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
                <input type="number" step="0.01" min="0" value={draft.colorSurcharge[s as Size]} onChange={(e) => change((d) => { d.colorSurcharge[s as Size] = num(e.target.value); })} />
              </label>
            ))}
            {ALL_SIZES.map((s) => (
              <label key={`lam-${s}`} className="field-inline">
                Plastificar/folio {s}
                <input type="number" step="0.01" min="0" value={draft.laminateSurcharge[s as Size]} onChange={(e) => change((d) => { d.laminateSurcharge[s as Size] = num(e.target.value); })} />
              </label>
            ))}
            <label className="field-inline">
              Portada a color
              <input type="number" step="0.01" min="0" value={draft.coverColorSurcharge} onChange={(e) => change((d) => { d.coverColorSurcharge = num(e.target.value); })} />
            </label>
            <label className="field-inline">
              Perforado
              <input type="number" step="0.01" min="0" value={draft.perforatePrice} onChange={(e) => change((d) => { d.perforatePrice = num(e.target.value); })} />
            </label>
            <label className="field-inline">
              Agujeros
              <input type="number" step="0.01" min="0" value={draft.holesPrice} onChange={(e) => change((d) => { d.holesPrice = num(e.target.value); })} />
            </label>
            <label className="field-inline">
              Pegatinas
              <input type="number" step="0.01" min="0" value={draft.stickerPrice} onChange={(e) => change((d) => { d.stickerPrice = num(e.target.value); })} />
            </label>
            <label className="field-inline">
              Sin márgenes
              <input type="number" step="0.01" min="0" value={draft.noMarginsPrice} onChange={(e) => change((d) => { d.noMarginsPrice = num(e.target.value); })} />
            </label>
            <label className="field-inline">
              Folio en blanco (delante/detrás)
              <input type="number" step="0.01" min="0" value={draft.extraFolioPrice} onChange={(e) => change((d) => { d.extraFolioPrice = num(e.target.value); })} />
            </label>
            <label className="field-inline">
              Taza personalizada (ud.)
              <input type="number" step="0.01" min="0" value={draft.mugPrice} onChange={(e) => change((d) => { d.mugPrice = num(e.target.value); })} />
            </label>
            <label className="field-inline">
              Chapa Ø58 mm (ud.)
              <input type="number" step="0.01" min="0" value={draft.badgePrice} onChange={(e) => change((d) => { d.badgePrice = num(e.target.value); })} />
            </label>
          </div>
        </section>

        {/* Colores */}
        <ColorEditor title="Colores de anillas" items={draft.ringColors} onChange={(items) => change((d) => { d.ringColors = items; })} />
        <ColorEditor title="Colores de contraportada" items={draft.coverColors} onChange={(items) => change((d) => { d.coverColors = items; })} />

        {/* Asistente IA */}
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

        {API_BASE && <EmailTestTool />}
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
  const [text, setText] = useState(
    'Hola, os envío un archivo. Quiero imprimirlo a color, A4, a doble cara y encuadernado en anillas. Gracias, Antonio.'
  );

  const run = async () => {
    setBusy(true);
    setResult('');
    try {
      const { PDFDocument, StandardFonts } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (let i = 1; i <= 3; i++) {
        const page = pdf.addPage([595, 842]);
        page.drawText(`Documento de prueba — página ${i}`, { x: 60, y: 760, size: 22, font });
      }
      const b64 = bytesToBase64(await pdf.save());
      const email = {
        messageId: `test-${Date.now()}`,
        from: 'cliente@example.com',
        fromName: 'Cliente de Prueba',
        subject: 'Trabajo de impresión',
        text,
        attachments: [{ filename: 'documento-de-prueba.pdf', contentType: 'application/pdf', dataBase64: b64 }],
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
        Simula un email entrante con un PDF de muestra (3 páginas). Crea un pedido real con origen “Email”, la IA
        interpreta el texto y el precio se calcula con este catálogo. La lectura del buzón real (Gmail) se conecta después.
      </p>
      <label className="field-block">
        Texto del email (instrucciones del cliente)
        <textarea className="assistant-instructions" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
        {busy ? 'Enviando…' : '🧪 Simular email de prueba'}
      </button>
      {result && <p className="muted" style={{ marginTop: 10 }}>{result}</p>}
    </section>
  );
}

function ColorEditor({ title, items, onChange }: { title: string; items: ColorOption[]; onChange: (items: ColorOption[]) => void }) {
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
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))}
            />
            {c.img ? (
              <img className="color-thumb" src={c.img} alt="" />
            ) : (
              <input type="color" value={c.hex} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))} />
            )}
            <input type="text" value={c.name} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <button type="button" className="chip chip-danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="chip" onClick={() => onChange([...items, { name: 'Nuevo color', hex: '#cccccc', enabled: true }])}>
          + Añadir color
        </button>
      </div>
    </section>
  );
}

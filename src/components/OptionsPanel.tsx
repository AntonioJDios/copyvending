import { useEffect, useRef, useState, type ReactNode } from 'react';
import { COLORS, FINISH_LABEL, FOLIO_LABEL } from '../domain/catalog';
import { allowedGrosores, doubleSidedAllowed } from '../domain/rules';
import type { PaginasPorHoja } from '../domain/types';
import { useConfigurator } from '../store/useConfigurator';

/** Small "(i)" affordance that reveals an explanatory popover on click. */
function InfoHint({ children, label }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <span className="info-hint" ref={ref}>
      <button
        type="button"
        className="info-btn"
        aria-label={label ?? 'Más información'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        i
      </button>
      {open && (
        <span className="info-pop" role="tooltip">
          {children}
        </span>
      )}
    </span>
  );
}

// --- Descriptive icons (stroke follows text color) ---
const svg = (children: ReactNode) => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round">
    {children}
  </svg>
);
const IconPortrait = svg(
  <>
    <rect x="6" y="3" width="12" height="18" rx="1.5" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="9" y1="11" x2="15" y2="11" />
  </>
);
const IconLandscape = svg(
  <>
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
    <line x1="6" y1="10" x2="18" y2="10" />
    <line x1="6" y1="13" x2="14" y2="13" />
  </>
);
/** N mini-pages laid out inside one sheet, following the chosen orientation. */
function nupIcon(n: number, orient: 'vertical' | 'horizontal'): ReactNode {
  const portrait = orient === 'vertical';
  const outer = portrait ? { x: 6, y: 3.5, w: 12, h: 17 } : { x: 3.5, y: 6, w: 17, h: 12 };
  const pad = 2;
  const gap = 1;
  const ix = outer.x + pad;
  const iy = outer.y + pad;
  const iw = outer.w - pad * 2;
  const ih = outer.h - pad * 2;
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  if (n === 1) {
    cells.push({ x: ix, y: iy, w: iw, h: ih });
  } else if (n === 2) {
    if (portrait) {
      const ch = (ih - gap) / 2;
      cells.push({ x: ix, y: iy, w: iw, h: ch }, { x: ix, y: iy + ch + gap, w: iw, h: ch });
    } else {
      const cw = (iw - gap) / 2;
      cells.push({ x: ix, y: iy, w: cw, h: ih }, { x: ix + cw + gap, y: iy, w: cw, h: ih });
    }
  } else {
    const cw = (iw - gap) / 2;
    const ch = (ih - gap) / 2;
    for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      cells.push({ x: ix + c * (cw + gap), y: iy + r * (ch + gap), w: cw, h: ch });
    }
  }
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round">
      <rect x={outer.x} y={outer.y} width={outer.w} height={outer.h} rx="1.5" />
      {cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} rx="0.6" strokeWidth="0.75" opacity="0.8" />
      ))}
    </svg>
  );
}
/** Page (real folio proportions) with the binding drawn on the bound edge —
 *  spiral loops for rings, black holes for perforate / 2·4-hole — matching the
 *  side + orientation. */
function bindIcon(side: 'largo' | 'corto', orient: 'vertical' | 'horizontal', acabado: string): ReactNode {
  const portrait = orient === 'vertical';
  const w = portrait ? 12 : 17;
  const h = portrait ? 17 : 12;
  const x = (24 - w) / 2;
  const y = (24 - h) / 2;
  const onLeft = side === 'largo' ? portrait : !portrait;

  const isRings = acabado === 'AnillasColores';
  const count = isRings ? 6 : acabado === 'dos_agujeros' ? 2 : acabado === 'cuatro_agujeros' ? 4 : 7;
  const edgeStart = (onLeft ? y : x) + 2.5;
  const edgeSpan = (onLeft ? h : w) - 5;
  const positions = Array.from({ length: count }, (_, i) => (count > 1 ? edgeStart + (edgeSpan * i) / (count - 1) : edgeStart + edgeSpan / 2));
  const r = 2.6;

  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round">
      <rect x={x} y={y} width={w} height={h} rx="1.5" />
      {positions.map((p, i) =>
        isRings ? (
          onLeft ? (
            <path key={i} d={`M ${x} ${p - r} A ${r} ${r} 0 0 0 ${x} ${p + r}`} strokeWidth="0.75" />
          ) : (
            <path key={i} d={`M ${p - r} ${y} A ${r} ${r} 0 0 1 ${p + r} ${y}`} strokeWidth="0.75" />
          )
        ) : (
          <circle
            key={i}
            cx={onLeft ? x + 2.2 : p}
            cy={onLeft ? p : y + 2.2}
            r="1.05"
            fill="currentColor"
            stroke="none"
          />
        )
      )}
    </svg>
  );
}

interface SegProps<T extends string | number> {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean; icon?: ReactNode }[];
  onChange: (v: T) => void;
  info?: ReactNode;
}

function Seg<T extends string | number>({ label, value, options, onChange, info }: SegProps<T>) {
  const hasIcons = options.some((o) => o.icon);
  return (
    <div className="opt-group">
      <span className="opt-label">
        {label}
        {info}
      </span>
      <div className="seg">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            className={`seg-btn${o.value === value ? ' seg-on' : ''}${hasIcons ? ' seg-btn-icon' : ''}`}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <span className="seg-ic">{o.icon}</span>}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface StepperProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}

function Stepper({ label, value, min = 0, max = 99, onChange }: StepperProps) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="stepper-row">
      <span className="stepper-label">{label}</span>
      <div className="stepper">
        <button type="button" aria-label="Menos" disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
          −
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(clamp(Math.floor(Number(e.target.value)) || 0))}
        />
        <button type="button" aria-label="Más" disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>
          +
        </button>
      </div>
    </div>
  );
}

interface PaletteProps {
  label: string;
  options: { name: string; hex: string; img?: string; enabled?: boolean }[];
  value: string;
  onChange: (name: string) => void;
}

function Palette({ label, options, value, onChange }: PaletteProps) {
  const available = options.filter((o) => o.enabled !== false);
  return (
    <div className="opt-group">
      <span className="opt-label">
        {label}
        {value ? <span className="opt-value"> · {value}</span> : null}
      </span>
      <div className="swatches">
        {available.map((o) => (
          <button
            key={o.name}
            type="button"
            title={o.name}
            aria-label={o.name}
            className={`swatch${o.img ? ' has-img' : ''}${o.name === value ? ' swatch-on' : ''}`}
            style={o.img ? undefined : { background: o.hex }}
            onClick={() => onChange(o.name)}
          >
            {o.img && <img src={o.img} alt="" />}
          </button>
        ))}
      </div>
    </div>
  );
}

export function OptionsPanel({
  open = false,
  onClose,
  onCollapse,
}: {
  open?: boolean;
  onClose?: () => void;
  onCollapse?: () => void;
}) {
  const { catalog, config, setField, applyPreset, colorAnillas, colorContraportada, setColorAnillas, setColorContraportada } =
    useConfigurator();
  const [tab, setTab] = useState<'impresion' | 'acabado'>('impresion');

  return (
    <aside className={`options${open ? ' options-open' : ''}`}>
      {onCollapse && (
        <button
          type="button"
          className="options-collapse-btn"
          onClick={onCollapse}
          title="Ocultar opciones"
          aria-label="Ocultar opciones"
        >
          ‹
        </button>
      )}
      <div className="options-head">
        <span>Opciones de impresión</span>
        <button type="button" className="btn btn-small" onClick={onClose}>
          Hecho
        </button>
      </div>

      {catalog.presets.some((p) => p.enabled !== false) && (
        <div className="opt-group">
          <span className="opt-label">Perfiles rápidos</span>
          <div className="preset-row">
            {catalog.presets
              .filter((p) => p.enabled !== false)
              .map((p) => (
                <button key={p.id} type="button" className="chip" onClick={() => applyPreset(p.id)}>
                  {p.label}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="tabs">
        <button type="button" className={`tab${tab === 'impresion' ? ' tab-on' : ''}`} onClick={() => setTab('impresion')}>
          Impresión
        </button>
        <button type="button" className={`tab${tab === 'acabado' ? ' tab-on' : ''}`} onClick={() => setTab('acabado')}>
          Acabado
        </button>
      </div>

      {tab === 'impresion' && (
        <div className="tab-panel">
          <Seg
            label="Tamaño"
            value={config.size}
            options={catalog.enabledSizes.map((s) => ({ value: s, label: s }))}
            onChange={(v) => setField('size', v)}
            info={
              <InfoHint label="Qué es cada tamaño">
                <b>Tamaños de papel</b>
                <ul>
                  <li>
                    <b>A4</b> — folio estándar (21 × 29,7 cm)
                  </li>
                  <li>
                    <b>A3</b> — doble folio (29,7 × 42 cm)
                  </li>
                  <li>
                    <b>A5</b> — medio folio (14,8 × 21 cm)
                  </li>
                </ul>
              </InfoHint>
            }
          />
          <Seg
            label="Gramaje"
            value={config.grosor}
            options={allowedGrosores(catalog, config.size).map((g) => ({ value: g, label: `${g} gr` }))}
            onChange={(v) => setField('grosor', v)}
            info={
              <InfoHint label="Qué es el gramaje">
                Grosor del papel en g/m². <b>80 gr</b> es el folio normal; a más gramaje, papel más rígido. <b>250 gr</b> es
                cartulina (una cara).
              </InfoHint>
            }
          />
          <Seg
            label="Impresión"
            value={config.color}
            options={COLORS.map((c) => ({ value: c, label: c === 'BN' ? 'Blanco y negro' : 'Color' }))}
            onChange={(v) => setField('color', v)}
          />
          <Seg
            label="Caras"
            value={config.dobleCara}
            options={[
              { value: '0', label: 'Una cara' },
              { value: '1', label: 'Doble cara', disabled: !doubleSidedAllowed(config) },
            ]}
            onChange={(v) => setField('dobleCara', v)}
          />
          <Seg
            label="Orientación"
            value={config.orientacion}
            options={[
              { value: 'vertical', label: 'Vertical', icon: IconPortrait },
              { value: 'horizontal', label: 'Horizontal', icon: IconLandscape },
            ]}
            onChange={(v) => setField('orientacion', v)}
          />
          <Seg
            label="Páginas por cara"
            value={config.paginasPorHoja}
            options={([1, 2, 4] as PaginasPorHoja[]).map((n) => ({ value: n, label: String(n), icon: nupIcon(n, config.orientacion) }))}
            onChange={(v) => setField('paginasPorHoja', v)}
            info={
              <InfoHint label="Qué es páginas por cara">
                Cuántas páginas del documento se colocan en cada cara del folio. <b>2</b> o <b>4</b> reducen el número de folios y
                el coste, pero se ven más pequeñas.
              </InfoHint>
            }
          />
          <label className="opt-toggle">
            <input type="checkbox" checked={config.sinMargenes} onChange={(e) => setField('sinMargenes', e.target.checked)} />
            Sin márgenes (284 × 198 mm)
          </label>
        </div>
      )}

      {tab === 'acabado' && (
        <div className="tab-panel">
          <Seg
            label="Encuadernación"
            value={config.acabado}
            options={catalog.enabledFinishes.map((a) => ({ value: a, label: FINISH_LABEL[a] }))}
            onChange={(v) => setField('acabado', v)}
            info={
              <InfoHint label="Tipos de encuadernación">
                <b>Encuadernación</b>
                <ul>
                  <li>
                    <b>Sin acabado</b> — folios sueltos
                  </li>
                  <li>
                    <b>Grapado</b> — una grapa en la esquina
                  </li>
                  <li>
                    <b>Anillas de colores</b> — espiral de plástico, permite abrir del todo
                  </li>
                  <li>
                    <b>2 / 4 agujeros</b> — perforado para archivador
                  </li>
                  <li>
                    <b>Perforado</b> — taladrado múltiple
                  </li>
                </ul>
              </InfoHint>
            }
          />

          {config.acabado === 'AnillasColores' && (
            <>
              <Palette label="Color de anillas" options={catalog.ringColors} value={colorAnillas} onChange={setColorAnillas} />
              <Palette label="Contraportada" options={catalog.coverColors} value={colorContraportada} onChange={setColorContraportada} />
            </>
          )}

          {(config.acabado === 'AnillasColores' ||
            config.acabado === 'perforado' ||
            config.acabado === 'dos_agujeros' ||
            config.acabado === 'cuatro_agujeros') && (
            <Seg
              label="Encuadernar por el lado"
              value={config.ladoEncuadernacion}
              options={[
                { value: 'largo', label: 'Lado largo', icon: bindIcon('largo', config.orientacion, config.acabado) },
                { value: 'corto', label: 'Lado corto', icon: bindIcon('corto', config.orientacion, config.acabado) },
              ]}
              onChange={(v) => setField('ladoEncuadernacion', v)}
            />
          )}

          {config.acabado !== 'sinencuadernacion' && (
            <Seg
              label="Documentos"
              value={config.juntos}
              options={[
                { value: 'agrupados', label: 'Todo junto' },
                { value: 'individual', label: 'Por separado' },
              ]}
              onChange={(v) => setField('juntos', v)}
            />
          )}

          {config.acabado !== 'sinencuadernacion' && (
            <div className="opt-group">
              <span className="opt-label">Folios en blanco</span>
              <Stepper
                label="Delante de la encuadernación"
                value={config.foliosDelante}
                onChange={(v) => setField('foliosDelante', v)}
              />
              <Stepper
                label="Detrás de la encuadernación"
                value={config.foliosDetras}
                onChange={(v) => setField('foliosDetras', v)}
              />
            </div>
          )}

          <Seg
            label="Acabado de folios"
            value={config.acabadoFolios}
            options={catalog.enabledFolios.map((a) => ({ value: a, label: FOLIO_LABEL[a] }))}
            onChange={(v) => setField('acabadoFolios', v)}
          />
        </div>
      )}
    </aside>
  );
}

import { useConfigurator } from '../store/useConfigurator';

/** Deterministic pre-flight quality warnings (low-res, blank pages, mixed sizes). */
export function PreflightNotice() {
  const preflight = useConfigurator((s) => s.preflight);
  if (!preflight.length) return null;
  return (
    <div className="preflight" role="status">
      <div className="preflight-head">🔍 Revisa antes de imprimir</div>
      <ul className="preflight-list">
        {preflight.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

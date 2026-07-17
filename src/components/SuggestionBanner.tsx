import { useConfigurator } from '../store/useConfigurator';

/** Shows the AI's auto-configuration proposal after files are analysed. */
export function SuggestionBanner() {
  const analyzing = useConfigurator((s) => s.analyzing);
  const suggestion = useConfigurator((s) => s.suggestion);
  const applySuggestion = useConfigurator((s) => s.applySuggestion);
  const dismissSuggestion = useConfigurator((s) => s.dismissSuggestion);

  if (analyzing) {
    return (
      <div className="suggest-banner suggest-analyzing">
        <span className="suggest-spinner" aria-hidden />
        <span>Analizando tus documentos…</span>
      </div>
    );
  }
  if (!suggestion) return null;

  return (
    <div className="suggest-banner">
      <span className="suggest-icon" aria-hidden>💡</span>
      <p className="suggest-text">{suggestion.reply}</p>
      <div className="suggest-actions">
        <button type="button" className="btn btn-primary btn-small" onClick={() => applySuggestion()}>
          Aplicar
        </button>
        <button type="button" className="chip" onClick={() => dismissSuggestion()}>
          Descartar
        </button>
      </div>
    </div>
  );
}

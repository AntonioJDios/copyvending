import { useConfigurator } from '../store/useConfigurator';
import { useAssistant } from '../store/useAssistant';

/** Shows the AI's auto-configuration proposal after files are analysed. */
export function SuggestionBanner() {
  const analyzing = useConfigurator((s) => s.analyzing);
  const suggestion = useConfigurator((s) => s.suggestion);
  const applySuggestion = useConfigurator((s) => s.applySuggestion);
  const dismissSuggestion = useConfigurator((s) => s.dismissSuggestion);
  const chatEnabled = useConfigurator((s) => s.catalog.assistant?.enabled !== false);
  const openAssistant = useAssistant((s) => s.openWith);

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
        {chatEnabled && (
          <button
            type="button"
            className="btn btn-small suggest-ai"
            onClick={() => openAssistant([{ role: 'assistant', content: suggestion.reply }])}
          >
            ✨ Preguntar al asistente
          </button>
        )}
        <button type="button" className="chip" onClick={() => dismissSuggestion()}>
          Descartar
        </button>
      </div>
    </div>
  );
}

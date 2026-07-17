import { useConfigurator } from '../store/useConfigurator';

/** Editable, customer-facing name for the print project (shown above the
 *  configurator, travels with the order to the cart/backend). */
export function ProjectName() {
  const nombreProyecto = useConfigurator((s) => s.nombreProyecto);
  const setNombreProyecto = useConfigurator((s) => s.setNombreProyecto);

  return (
    <div className="project-name">
      <span className="project-name-tag">Proyecto</span>
      <div className="project-name-field">
        <input
          type="text"
          value={nombreProyecto}
          maxLength={80}
          placeholder="Nombra tu proyecto…"
          aria-label="Nombre del proyecto"
          onChange={(e) => setNombreProyecto(e.target.value)}
        />
        <span className="project-name-pencil" aria-hidden>
          ✎
        </span>
      </div>
    </div>
  );
}

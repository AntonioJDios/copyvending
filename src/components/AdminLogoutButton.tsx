import { adminLogout } from '../lib/adminAuth';
import { adminTokenValid } from '../lib/adminToken';

/**
 * Log out of the backoffice. Renders nothing when there is no session to end
 * (no backend, or a server with no ADMIN_PASSWORD, where the panel is not behind
 * a password at all) so it never shows a button that would do nothing.
 */
export function AdminLogoutButton() {
  if (!adminTokenValid()) return null;
  return (
    <button type="button" className="btn" title="Cerrar la sesión de administración" onClick={() => adminLogout()}>
      Salir
    </button>
  );
}

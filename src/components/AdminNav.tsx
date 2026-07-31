import { AdminLogoutButton } from './AdminLogoutButton';

/** The four areas of the backoffice. Shared so they can't drift apart per screen. */
const AREAS = [
  { hash: '#pedidos', label: 'Pedidos', icon: '🧾' },
  { hash: '#estadisticas', label: 'Estadísticas', icon: '📊' },
  { hash: '#clientes', label: 'Clientes', icon: '👥' },
  { hash: '#admin', label: 'Configuración', icon: '⚙' },
] as const;

/**
 * Backoffice header. One component instead of a hand-written nav per screen, so
 * the areas can't drift apart and the current one is always highlighted.
 */
export function AdminNav({ title, current }: { title: string; current: '#pedidos' | '#estadisticas' | '#clientes' | '#admin' }) {
  return (
    <header className="topbar">
      <h1>{title}</h1>
      <nav className="topnav admin-nav">
        {AREAS.map((a) => (
          <a key={a.hash} className={`btn admin-nav-btn${current === a.hash ? ' on' : ''}`} href={a.hash}>
            <span aria-hidden>{a.icon}</span> {a.label}
          </a>
        ))}
        <a className="btn" href="/">
          ← Tienda
        </a>
        <AdminLogoutButton />
      </nav>
    </header>
  );
}

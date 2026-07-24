// Which "source" this front represents. Set by the entry HTML
// (index.html → 'online' / Web; papeleria.html → 'mostrador' / Papelería).
// Email is server-side and never runs this app.
export type Source = 'online' | 'mostrador' | 'email';

declare global {
  interface Window {
    __SOURCE__?: string;
  }
}

export const CURRENT_SOURCE: Source =
  typeof window !== 'undefined' && window.__SOURCE__ === 'mostrador' ? 'mostrador' : 'online';

export const SOURCE_LABEL: Record<Source, string> = {
  online: 'Web',
  mostrador: 'Papelería',
  email: 'Email',
};

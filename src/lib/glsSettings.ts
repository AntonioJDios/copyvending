import { API_BASE } from './api';
import { getAdminToken } from './adminToken';

// Backoffice-only GLS config, stored under the 'gls' settings key (NOT in the
// price catalog, so the customer configurator never downloads it).
export interface GlsSettings {
  /** Offer the "generate GLS label" action on shipping orders. */
  enabled: boolean;
  /** GLS account credential. Write-only: sent on save, never returned by GET. */
  guid?: string;
  /** True when a guid is already stored server-side (returned by GET). */
  hasGuid?: boolean;
  /** Sender (shop) address printed on the label. */
  senderName: string;
  senderStreet: string;
  senderCp: string;
  senderCity: string;
  senderPhone: string;
  /** GLS service/schedule codes (96/18 = BusinessParcel 24/48h) + parcel weight (kg). */
  service: string;
  horario: string;
  weight: string;
}

export const DEFAULT_GLS_SETTINGS: GlsSettings = {
  enabled: false,
  senderName: '',
  senderStreet: '',
  senderCp: '',
  senderCity: '',
  senderPhone: '',
  service: '96',
  horario: '18',
  weight: '1',
};

export async function loadGlsSettings(): Promise<GlsSettings> {
  if (!API_BASE) return { ...DEFAULT_GLS_SETTINGS };
  const res = await fetch(`${API_BASE}/catalog?key=gls`);
  if (!res.ok) return { ...DEFAULT_GLS_SETTINGS };
  const v = (await res.json()) as Partial<GlsSettings> | null;
  return v ? { ...DEFAULT_GLS_SETTINGS, ...v } : { ...DEFAULT_GLS_SETTINGS };
}

export async function saveGlsSettings(s: GlsSettings): Promise<void> {
  if (!API_BASE) throw new Error('Guardar la config de GLS requiere el backend.');
  // Only send `guid` when the admin typed a new one; an empty string keeps the
  // stored value (the server preserves it).
  const body: Record<string, unknown> = { ...s };
  delete body.hasGuid;
  if (!s.guid || !s.guid.trim()) delete body.guid;
  const t = getAdminToken();
  const res = await fetch(`${API_BASE}/catalog?key=gls`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Error ${res.status}`);
  }
}

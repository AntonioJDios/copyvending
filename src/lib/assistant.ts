import type { Catalog } from '../domain/catalog';
import { FINISH_LABEL, FOLIO_LABEL, SIZE_LABEL } from '../domain/catalog';
import type { Configuracion } from '../domain/types';
import { API_BASE } from './api';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}
export interface AssistantReply {
  reply: string;
  changes: Record<string, unknown>;
}

/** Compact, admin-aware option list so the assistant only proposes values the
 *  shop currently offers. */
export function buildOptions(catalog: Catalog) {
  return {
    sizes: catalog.enabledSizes.map((s) => ({ key: s, label: SIZE_LABEL[s] })),
    grosoresBySize: catalog.grosoresBySize,
    finishes: catalog.enabledFinishes.map((f) => ({ key: f, label: FINISH_LABEL[f] })),
    folios: catalog.enabledFolios.map((f) => ({ key: f, label: FOLIO_LABEL[f] })),
    ringColors: catalog.ringColors.filter((c) => c.enabled !== false).map((c) => c.name),
    coverColors: catalog.coverColors.filter((c) => c.enabled !== false).map((c) => c.name),
  };
}

export interface PriceContext {
  total: number;
  sheets: number;
  hasFiles: boolean;
  pages: number;
}

export async function askAssistant(
  history: ChatMsg[],
  config: Configuracion,
  copias: number,
  catalog: Catalog,
  price: PriceContext
): Promise<AssistantReply> {
  const res = await fetch(`${API_BASE ?? ''}/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      history,
      config,
      copias,
      price,
      options: buildOptions(catalog),
      instructions: catalog.assistant?.instructions ?? '',
    }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Error ${res.status}`);
  }
  return res.json() as Promise<AssistantReply>;
}

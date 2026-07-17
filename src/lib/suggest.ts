import type { Catalog } from '../domain/catalog';
import { buildOptions } from './assistant';
import type { FileAnalysis } from './analyzePdf';
import { API_BASE } from './api';

export interface Suggestion {
  reply: string;
  changes: Record<string, unknown>;
}

/** Ask the assistant to propose the best/cheapest config for the analysed files. */
export async function suggestConfig(analyses: FileAnalysis[], catalog: Catalog): Promise<Suggestion> {
  const res = await fetch(`${API_BASE ?? ''}/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analyses, options: buildOptions(catalog), instructions: catalog.assistant?.instructions ?? '' }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Error ${res.status}`);
  }
  return res.json() as Promise<Suggestion>;
}

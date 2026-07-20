import { API_BASE } from './api';
import type { FileAnalysis } from './analyzePdf';

export interface PlanProject {
  files: string[];
  nombre?: string;
  changes: Record<string, unknown>;
  copias: number;
  docColor: 'no' | 'cover' | 'all';
  colorAnillas?: string;
  colorContraportada?: string;
}
export interface PlanResult {
  reply: string;
  projects: PlanProject[];
}
export interface PlanMsg {
  role: 'user' | 'assistant';
  content: string;
}

/** Ask the assistant to group the dropped files into print projects. */
export async function planProjects(analyses: FileAnalysis[], history: PlanMsg[], message: string): Promise<PlanResult> {
  const res = await fetch(`${API_BASE ?? ''}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      analyses: analyses.map((a) => ({
        name: a.name,
        pages: a.pages,
        orientation: a.orientation,
        hasColor: a.hasColor,
        colorPages: a.colorPages,
        title: a.title,
        textExcerpt: a.textExcerpt,
      })),
      history,
      message,
    }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error || `Error ${res.status}`);
  }
  return res.json() as Promise<PlanResult>;
}

import { API_BASE } from './api';

/** Send a recorded voice note to the server (Groq Whisper) and get its text.
 *  Transcription only — the assistants always answer in writing. */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('No se pudo leer el audio'));
    fr.onload = () => resolve(String(fr.result));
    fr.readAsDataURL(blob);
  });

  const res = await fetch(`${API_BASE ?? ''}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: dataUrl, mime: blob.type || 'audio/webm' }),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return (data.text || '').trim();
}

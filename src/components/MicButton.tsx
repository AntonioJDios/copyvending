import { useRef, useState } from 'react';
import { transcribeAudio } from '../lib/transcribe';

type State = 'idle' | 'recording' | 'working';

/** Push-to-talk mic: records a voice note, transcribes it server-side (Whisper)
 *  and hands the text to the parent. Click to start, click again to stop. The
 *  assistant always replies in writing — this is input only, never speech-out. */
export function MicButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<State>('idle');
  const [err, setErr] = useState('');
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const stop = () => {
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const start = async () => {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErr('Tu navegador no permite grabar audio.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErr('Sin permiso de micrófono.');
      return;
    }
    chunksRef.current = [];
    const rec = new MediaRecorder(stream);
    recRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
      if (blob.size === 0) {
        setState('idle');
        return;
      }
      setState('working');
      try {
        const text = await transcribeAudio(blob);
        if (text) onText(text);
        else setErr('No te he entendido, prueba otra vez.');
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'No se pudo transcribir.');
      } finally {
        setState('idle');
      }
    };
    rec.start();
    setState('recording');
  };

  const onClick = () => {
    if (disabled) return;
    if (state === 'recording') stop();
    else if (state === 'idle') void start();
  };

  const label = state === 'recording' ? 'Detener y transcribir' : state === 'working' ? 'Transcribiendo…' : 'Grabar audio';

  return (
    <span className="mic-wrap">
      {err && <span className="mic-err" role="alert">{err}</span>}
      <button
        type="button"
        className={`mic-btn mic-${state}`}
        onClick={onClick}
        disabled={disabled || state === 'working'}
        aria-label={label}
        title={label}
      >
        {state === 'working' ? '⏳' : state === 'recording' ? '■' : '🎤'}
      </button>
    </span>
  );
}

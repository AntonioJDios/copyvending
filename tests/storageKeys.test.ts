import { describe, expect, it } from 'vitest';

/**
 * The project id is extracted from the storage key to check the capability token
 * that lets a customer read or delete their own files. Two key layouts coexist:
 *
 *   jobs/<projectId>/<file>            (original)
 *   jobs/<YYYY-MM>/<projectId>/<file>  (current, grouped by upload month)
 *
 * Getting this wrong doesn't fail loudly: it silently denies every customer access
 * to their own documents (or, worse, grants it on a key it shouldn't). Hence the
 * copy of the function under test — api/presign is a self-contained Vercel
 * function and can't be imported here.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function projectOf(key: string): string | null {
  if (!key.startsWith('jobs/')) return null;
  for (const seg of key.slice(5).split('/')) {
    if (UUID_RE.test(seg)) return seg;
  }
  return null;
}

const ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('projectOf', () => {
  it('reads the id from the original layout', () => {
    expect(projectOf(`jobs/${ID}/abc.pdf`)).toBe(ID);
  });

  it('reads the id from the month-grouped layout', () => {
    expect(projectOf(`jobs/2026-07/${ID}/abc.pdf`)).toBe(ID);
  });

  it('works for thumbnails and product artwork too', () => {
    expect(projectOf(`jobs/2026-07/${ID}/thumb-doc.pdf.jpg`)).toBe(ID);
    expect(projectOf(`jobs/2026-07/${ID}/taza-preview.jpg`)).toBe(ID);
  });

  it('is not fooled by a month that looks like a folder', () => {
    // The month segment must never be taken for the project.
    expect(projectOf(`jobs/2026-07/${ID}/x.pdf`)).not.toBe('2026-07');
  });

  it('refuses keys outside the jobs/ prefix', () => {
    expect(projectOf(`other/${ID}/x.pdf`)).toBeNull();
    expect(projectOf(ID)).toBeNull();
    expect(projectOf('')).toBeNull();
  });

  it('refuses a key with no uuid at all (no token may match it)', () => {
    expect(projectOf('jobs/2026-07/not-a-uuid/x.pdf')).toBeNull();
    expect(projectOf('jobs/x.pdf')).toBeNull();
  });

  it('does not let a traversal attempt pick up an id', () => {
    expect(projectOf('jobs/../../etc/passwd')).toBeNull();
  });

  it('accepts uppercase uuids', () => {
    expect(projectOf(`jobs/2026-07/${ID.toUpperCase()}/x.pdf`)).toBe(ID.toUpperCase());
  });
});

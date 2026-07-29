import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards against the bug that has now caused three separate production failures.
 *
 * Postgres infers a parameter's type from its CONTEXT. In `where ${before} = 0`
 * the literal `0` is an `integer`, so Postgres decides `${before}` is an integer
 * too — and a millisecond timestamp (1784724538000) then blows up with
 * `value "1784724538000" is out of range for type integer`. It worked in testing
 * because small ids fit; it broke in production the moment a real cursor was used.
 *
 * The fix is always an explicit cast: `${before}::bigint = 0`. This test reads the
 * api/ sources and fails if a parameter is compared against a bare numeric
 * literal, because that mistake is invisible in review and only shows up as a 500
 * in front of a customer.
 */

const API_DIR = join(import.meta.dirname, '..', 'api');

/**
 * Parameter compared to a NUMERIC literal, e.g. `${x} = 0`.
 *
 * Only numbers: a string literal makes Postgres infer `text`, which is right and
 * cannot overflow (`${term} = ''` has always worked). It is the numeric case that
 * silently narrows a bigint to integer and takes the shop down.
 */
const UNCAST = /\$\{[^}]+\}\s*(?:=|<|>|<=|>=|<>|!=)\s*-?\d+(?:\.\d+)?/g;

/** Same but with a cast — `${x}::bigint = 0` — which is what we want. */
const CAST = /\$\{[^}]+\}::[a-z]+(?:\[\])?\s*(?:=|<|>|<=|>=|<>|!=)/;

function sqlLines(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const lines = src.split('\n');
  let inSql = false;
  lines.forEach((text, i) => {
    // Track whether we are inside a tagged template that reached the DB. Crude,
    // but it is enough to tell SQL apart from ordinary template strings.
    const lower = text.toLowerCase();
    if (/(?:sql|db\(\))`/.test(text)) inSql = true;
    if (inSql) {
      if (/\b(?:where|and|or|having|when)\b/.test(lower)) out.push({ line: i + 1, text });
      if (text.includes('`') && !/(?:sql|db\(\))`/.test(text)) inSql = false;
    }
  });
  return out;
}

describe('parámetros SQL', () => {
  const files = readdirSync(API_DIR).filter((f) => f.endsWith('.ts'));

  it('encuentra los endpoints', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  // Comprobar que el detector detecta: un test que pasa porque no mira nada es
  // peor que no tenerlo, porque da confianza falsa.
  it('detecta el fallo real que tumbó la lista de pedidos', () => {
    const bad = "       where (${beforeAt} = 0 or created_at < ${beforeAt})";
    const good = "       where (${beforeAt}::bigint = 0 or created_at < ${beforeAt}::bigint)";
    expect((bad.match(UNCAST) ?? []).filter((m) => !CAST.test(m))).toHaveLength(1);
    expect((good.match(UNCAST) ?? []).filter((m) => !CAST.test(m))).toHaveLength(0);
  });

  for (const file of files) {
    it(`${file}: compara parámetros con literales solo con cast explícito`, () => {
      const src = readFileSync(join(API_DIR, file), 'utf8');
      const offenders: string[] = [];
      for (const { line, text } of sqlLines(src)) {
        const matches = text.match(UNCAST);
        if (!matches) continue;
        for (const m of matches) {
          // `${x}::bigint = 0` matches UNCAST too (the cast is inside the group),
          // so only complain when there is no cast on that comparison.
          if (CAST.test(m)) continue;
          offenders.push(`${file}:${line}  ${m.trim()}`);
        }
      }
      expect(offenders, `Falta un cast explícito (::bigint, ::text…):\n${offenders.join('\n')}`).toEqual([]);
    });
  }
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_LEGAL, legalOf } from '../src/domain/catalog';
import { TERMS_VERSION } from '../src/lib/legal';

/**
 * The consent wording lives in the DB so the shop can edit it. Two things must
 * hold no matter what is (or isn't) stored:
 *  - a missing/partial config never leaves a consent checkbox with EMPTY text
 *    (an unlabelled checkbox is not informed consent, and the withdrawal-right
 *    exclusion depends on the customer actually being told);
 *  - stored values always win over the drafted defaults.
 */

describe('legalOf', () => {
  it('falls back to the drafted defaults when nothing is stored', () => {
    expect(legalOf(undefined)).toEqual(DEFAULT_LEGAL);
    expect(legalOf({ legal: undefined })).toEqual(DEFAULT_LEGAL);
  });

  it('always yields non-empty consent texts', () => {
    for (const cfg of [undefined, { legal: undefined }, { legal: {} as never }]) {
      const l = legalOf(cfg);
      expect(l.consentPrivacy.trim().length).toBeGreaterThan(0);
      expect(l.consentTerms.trim().length).toBeGreaterThan(0);
    }
  });

  it('lets the shop override a single text without losing the rest', () => {
    const l = legalOf({ legal: { ...DEFAULT_LEGAL, consentTerms: 'Acepto lo mío.' } });
    expect(l.consentTerms).toBe('Acepto lo mío.');
    expect(l.consentPrivacy).toBe(DEFAULT_LEGAL.consentPrivacy);
  });

  it('merges a partially stored config over the defaults', () => {
    // A catalog saved by an older version won't have every field.
    const l = legalOf({ legal: { phone: '900 000 000' } as never });
    expect(l.phone).toBe('900 000 000');
    expect(l.consentPrivacy).toBe(DEFAULT_LEGAL.consentPrivacy);
    expect(l.termsText).toBe('');
  });

  it('treats the full-text overrides as empty by default (templates are used)', () => {
    const l = legalOf(undefined);
    expect(l.legalNoticeText).toBe('');
    expect(l.termsText).toBe('');
    expect(l.privacyText).toBe('');
  });

  it('mentions the loss of the withdrawal right in the default terms consent', () => {
    // If this default is ever softened, the exclusion for personalised goods
    // stops being validly communicated.
    const t = DEFAULT_LEGAL.consentTerms.toLowerCase();
    expect(t).toContain('condiciones de venta');
    expect(t).toMatch(/desistimiento|devoluci/);
  });
});

describe('TERMS_VERSION', () => {
  it('is a non-empty version string stored with each order', () => {
    expect(TERMS_VERSION).toMatch(/^\d+\.\d+$/);
  });
});

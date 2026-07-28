/**
 * Order code generation.
 *
 * RANDOM, never derived from the clock: the code is what a customer shows to
 * look their order up, so a time-based (therefore guessable) code would let
 * anyone walk through other people's orders. Looking one up also requires the
 * order's email, but the code must be unguessable on its own.
 *
 * The alphabet drops look-alike characters (no 0/O, 1/I) because these codes get
 * read out loud and typed by hand at the counter.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 8; // 32^8 ≈ 1.1e12 combinations

export function newOrderCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `P-${out}`;
}

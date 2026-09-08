/*
 * Every board is generated from one 32-bit number, so two people who hold the
 * same number are playing the same board -- which is the whole of head-to-head
 * here. That number gets read aloud, typed, and pasted into messages, so it
 * travels as short uppercase base36 (1Z141Z4) rather than as ten digits.
 *
 * A seed alone is NOT a board. The generator is entered differently for a daily
 * than for a practice tier, and each tier has its own presets, so seed 4242 at
 * medium and seed 4242 at hard are unrelated puzzles. Anything that carries a
 * seed between people has to carry its tier with it, or both players will think
 * they raced the same board when they did not.
 */
export function encodeSeed(seed: number): string {
  return (seed >>> 0).toString(36).toUpperCase();
}

/** Null for anything that is not a seed, so a mistyped link can say so. */
export function decodeSeed(code: string): number | null {
  if (!/^[0-9a-z]{1,7}$/i.test(code)) return null;
  const value = parseInt(code, 36);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return value >>> 0;
}

/*
 * Math.random is seeded from a source we do not control and can repeat across
 * tabs restored together; crypto does not. It matters here only because a
 * repeated seed would look like a bug in the feature itself.
 */
export function randomSeed(): number {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0]! >>> 0;
  }
  return (Math.random() * 0x100000000) >>> 0;
}

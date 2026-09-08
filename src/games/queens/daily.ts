/*
 * Queens' daily board. Frozen, and deliberately detached from the tier table:
 * that table gets retuned when difficulty is rebalanced, and a daily whose
 * settings can move is a daily whose past results describe boards that no
 * longer exist.
 */
import { generate, mulberry32, type QueensPuzzle } from './engine.ts';

export const DAILY_N = 8;
export const DAILY_BAND = Object.freeze({ minGuesses: 0, maxGuesses: 2 });

export function generateDaily(seed: number): QueensPuzzle | null {
  const puzzle = generate({
    n: DAILY_N,
    minGuesses: DAILY_BAND.minGuesses,
    maxGuesses: DAILY_BAND.maxGuesses,
    rng: mulberry32(seed)
  });
  if (puzzle) puzzle.difficulty = 'hard';
  return puzzle;
}

export function fingerprint(puzzle: QueensPuzzle): string {
  let hash = 0x811c9dc5;
  const parts = `${puzzle.n}|${puzzle.regions.join(',')}`;
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

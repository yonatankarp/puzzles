/*
 * Patch's daily board. Frozen, and deliberately detached from the tier table:
 * that table gets retuned when difficulty is rebalanced, and a daily whose
 * settings can move is a daily whose past results describe boards that no
 * longer exist.
 */
import { generate, mulberry32, type PatchPuzzle } from './engine.ts';

export const DAILY_N = 7;
export const DAILY_BAND = Object.freeze({ minHard: 5, maxHard: 12 });

export function generateDaily(seed: number): PatchPuzzle | null {
  const rng = mulberry32(seed);
  let nearest: PatchPuzzle | null = null;
  for (let attempt = 0; attempt < 4000; attempt++) {
    const puzzle = generate(DAILY_N, rng);
    if (!puzzle) continue;
    if (puzzle.hard >= DAILY_BAND.minHard && puzzle.hard <= DAILY_BAND.maxHard) {
      puzzle.difficulty = 'hard';
      return puzzle;
    }
    if (!nearest || Math.abs(puzzle.hard - DAILY_BAND.minHard) < Math.abs(nearest.hard - DAILY_BAND.minHard)) {
      nearest = puzzle;
    }
  }
  if (nearest) nearest.difficulty = 'hard';
  return nearest;
}

/** Identifies the board: where the numbers are, and what they say. */
export function fingerprint(puzzle: PatchPuzzle): string {
  let hash = 0x811c9dc5;
  const parts = `${puzzle.n}|${puzzle.clues.map(c => `${c.cell}:${c.area}`).join(',')}`;
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

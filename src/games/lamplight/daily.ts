/*
 * Lamplight's daily board. Frozen, and deliberately detached from the tier
 * table: that table gets retuned when difficulty is rebalanced, and a daily
 * whose settings can move is a daily whose past results describe boards that no
 * longer exist.
 */
import { generate, mulberry32, type LampPuzzle } from './engine.ts';

export const DAILY_N = 7;
export const DAILY_BAND = Object.freeze({ minHard: 9, maxHard: 14 });

export function generateDaily(seed: number): LampPuzzle | null {
  const rng = mulberry32(seed);
  let nearest: LampPuzzle | null = null;
  for (let attempt = 0; attempt < 900; attempt++) {
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

/** Identifies the board: where the walls and lamps are, not how it is solved. */
export function fingerprint(puzzle: LampPuzzle): string {
  let hash = 0x811c9dc5;
  const parts = `${puzzle.n}|${puzzle.board.join(',')}`;
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/*
 * Comet's daily board. Frozen, and deliberately detached from the tier table:
 * that table gets retuned when difficulty is rebalanced, and a daily whose
 * settings can move is a daily whose past results describe boards that no
 * longer exist.
 */
import { analyze, generate, mulberry32, type CometPuzzle } from './engine.ts';

export const DAILY_N = 7;
export const DAILY_BAND = Object.freeze({ minHard: 14, maxHard: 26 });

export function generateDaily(seed: number): CometPuzzle | null {
  const rng = mulberry32(seed);
  let nearest: CometPuzzle | null = null;
  for (let attempt = 0; attempt < 400; attempt++) {
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

/*
 * Identifies the board, not the run. Both the head positions and the numbers
 * shown are part of it: two boards can be tiled the same way and still be
 * different puzzles if different lengths were withheld.
 */
export function fingerprint(puzzle: CometPuzzle): string {
  let hash = 0x811c9dc5;
  const parts = `${puzzle.n}|${puzzle.clues.map(c => `${c.cell}:${c.len}`).join(',')}`;
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export { analyze };

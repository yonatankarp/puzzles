/*
 * Zip's daily board.
 *
 * Frozen on purpose: this was once generated from DIFFICULTIES.medium, the same
 * table that gets retuned whenever the tiers are rebalanced. Retuning it once
 * already changed how many numbers a board carries, which would silently have
 * changed every past daily. Change these values and you change history.
 */
import { generate, mulberry32, type GenerateOptions, type Puzzle } from './engine.ts';

export const DAILY_PUZZLE: GenerateOptions = Object.freeze({
  rows: 6,
  cols: 6,
  wallBudget: 6,
  waypoints: 8,
  maxWaypoints: 11,
  minGuesses: 5,
  maxGuesses: 8
});

export function generateDaily(seed: number): Puzzle | null {
  const puzzle = generate({ ...DAILY_PUZZLE, rng: mulberry32(seed) });
  if (puzzle) puzzle.difficulty = 'medium';
  return puzzle;
}

/*
 * A cheap identity for a board, recorded with each result so that if the
 * generator ever does change, a stored result can be recognised as belonging to
 * a puzzle that no longer exists rather than being trusted blindly.
 */
export function fingerprint(puzzle: Puzzle): string {
  let hash = 0x811c9dc5;
  const parts = `${puzzle.rows}x${puzzle.cols}|${puzzle.waypoints.join(',')}|` +
    puzzle.walls.map(w => `${w[0]}-${w[1]}`).join(',');
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/*
 * The daily puzzle, shared by every game in the collection.
 *
 * Each game has its own day results, streak and saved run, keyed by game id.
 * Days are counted in UTC so a puzzle turns over at the same instant everywhere
 * rather than at each player's local midnight, and the generator is seeded from
 * the date, so no server is involved in everyone getting the same board.
 */
import type { DailyResult } from './types.ts';

export type { DailyResult };

/** Puzzle #1 is 1 January 2026. */
const EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;

/** The version stamped into anything written to storage. */
export const STORAGE_VERSION = 1;

/*
 * The clock, injectable so the UTC-midnight rollover can actually be tested --
 * the moment the whole daily hinges on.
 */
let clock: () => Date = () => new Date();
export function setClock(fn: () => Date): void { clock = fn; }

export function dayNumber(now: Date = clock()): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((midnight - EPOCH_UTC) / DAY_MS) + 1;
}

/** Spread consecutive days across the seed space so neighbouring days differ. */
export function seedForDay(gameId: string, day: number): number {
  let hash = 0x811c9dc5;
  for (const ch of `${gameId}:${day}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const resultKey = (gameId: string, day: number) => `${gameId}.daily.${day}`;
const progressKey = (gameId: string) => `${gameId}.progress`;

export function readResult(gameId: string, day: number): DailyResult | null {
  try {
    const raw = localStorage.getItem(resultKey(gameId, day));
    if (!raw) return null;
    const saved = JSON.parse(raw) as DailyResult;
    // Unversioned entries predate the stamp and share this shape, so they are
    // accepted and restamped. Anything newer is not understood, so it is
    // ignored rather than mis-read.
    if (saved.v !== undefined && saved.v > STORAGE_VERSION) return null;
    if (typeof saved.day !== 'number' || typeof saved.ms !== 'number') return null;
    return saved;
  } catch {
    return null;
  }
}

/** The first solve of a day is the one that counts; replays do not overwrite it. */
export function writeResult(gameId: string, result: DailyResult): void {
  if (readResult(gameId, result.day)) return;
  try {
    localStorage.setItem(resultKey(gameId, result.day),
      JSON.stringify({ ...result, v: STORAGE_VERSION }));
  } catch { /* storage full or blocked */ }
}

/*
 * Consecutive days solved. Counts back from today if today is done, otherwise
 * from yesterday -- a streak stands until a day is actually missed, so it is
 * visible, and at stake, before you have played.
 */
export function streak(gameId: string, today: number = dayNumber()): number {
  let day = readResult(gameId, today) ? today : today - 1;
  let count = 0;
  for (; day > 0 && readResult(gameId, day); day--) count++;
  return count;
}

export interface HistoryEntry { day: number; result: DailyResult | null }
export interface HistorySummary {
  entries: HistoryEntry[];
  solved: number;
  best: number | null;
  median: number | null;
}

export function history(gameId: string, today: number = dayNumber(), span = 30): HistorySummary {
  const entries: HistoryEntry[] = [];
  for (let day = Math.max(1, today - span + 1); day <= today; day++) {
    entries.push({ day, result: readResult(gameId, day) });
  }
  const times = entries
    .map(e => e.result?.ms)
    .filter((ms): ms is number => typeof ms === 'number')
    .sort((a, b) => a - b);
  return {
    entries,
    solved: times.length,
    best: times.length ? times[0]! : null,
    median: times.length ? times[(times.length - 1) >> 1]! : null
  };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s * 10) % 10)}`;
}

export function shareText(name: string, result: DailyResult, days: number, url: string): string {
  const lines = [
    `${name} #${result.day} — ${formatDuration(result.ms)}`,
    `↩ ${result.backtracks} backtrack${result.backtracks === 1 ? '' : 's'}` +
      (result.hinted ? ' · used a hint' : '') +
      (days >= 2 ? ` · 🔥 ${days} day streak` : '')
  ];
  return `${lines.join('\n')}\n${url}`;
}

/*
 * In-progress state for today's board. Without it, reloading mid-solve hands
 * you a fresh board and a zero clock -- the reset that Restart is deliberately
 * not allowed to give you.
 */
export interface DailyProgress {
  v?: number;
  board?: string;
  day: number;
  /** Whatever the game needs to replay the run; it validates its own shape. */
  moves: number[];
  elapsed: number;
  backtracks: number;
  hintsUsed: number;
}

export function readProgress(gameId: string, day: number): DailyProgress | null {
  try {
    const raw = localStorage.getItem(progressKey(gameId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as DailyProgress;
    if (saved.v !== undefined && saved.v > STORAGE_VERSION) return null;
    if (saved.day !== day || !Array.isArray(saved.moves)) return null;
    return saved;
  } catch {
    return null;
  }
}

export function writeProgress(gameId: string, progress: DailyProgress): void {
  try {
    localStorage.setItem(progressKey(gameId),
      JSON.stringify({ ...progress, v: STORAGE_VERSION }));
  } catch { /* storage full or blocked */ }
}

export function clearProgress(gameId: string): void {
  try { localStorage.removeItem(progressKey(gameId)); } catch { /* ignore */ }
}

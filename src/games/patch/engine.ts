/*
 * Patch: generation, solving, and how hard a board is.
 *
 * The rules, whole:
 *
 *   1. Draw a rectangle around every number.
 *   2. Its rectangle covers exactly as many squares as the number says.
 *   3. The rectangles cover the whole board and never overlap.
 *
 * Written after an attempt that did not work. That game hid most of its clues
 * to keep boards from solving themselves, and the result was a board you could
 * not get into: no obvious first move, and nothing that told you a move was
 * right until the very end. Everything here is arranged against that. Every
 * number is given. Every move is checked against ONE number -- count the
 * squares, compare -- so the whole board never has to be held in your head. And
 * a board is not published unless at least two of its numbers have exactly one
 * rectangle that fits before you have drawn anything: `openers` below is not a
 * statistic, it is a condition.
 */

export type Cell = number;

export interface PatchClue {
  cell: Cell;
  /** How many squares its rectangle covers. */
  area: number;
}

export interface Rect {
  r0: number;
  c0: number;
  h: number;
  w: number;
}

export interface PatchPuzzle {
  n: number;
  clues: PatchClue[];
  /** The one answer: the rectangle belonging to each clue, in clue order. */
  solution: Rect[];
  difficulty?: string;
  /** How many times the harder deduction is needed. See analyze(). */
  hard: number;
  /** Numbers whose rectangle is forced before a single move is made. */
  openers: number;
}

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cellsOf(n: number, rect: Rect): Cell[] {
  const cells: Cell[] = [];
  for (let r = rect.r0; r < rect.r0 + rect.h; r++) {
    for (let c = rect.c0; c < rect.c0 + rect.w; c++) cells.push(r * n + c);
  }
  return cells;
}

export const sameRect = (a: Rect, b: Rect): boolean =>
  a.r0 === b.r0 && a.c0 === b.c0 && a.h === b.h && a.w === b.w;

interface Candidate {
  rect: Rect;
  cells: Cell[];
}

/**
 * Every rectangle of the right size that covers this number and no other. Rule
 * 1 says a rectangle belongs to one number, so a box with two numbers in it is
 * not a candidate for either of them.
 */
export function candidatesFor(
  n: number, cell: Cell, area: number, numbered: ReadonlySet<Cell>
): Candidate[] {
  const out: Candidate[] = [];
  const r = (cell / n) | 0;
  const c = cell % n;
  for (let h = 1; h <= area; h++) {
    if (area % h) continue;
    const w = area / h;
    if (h > n || w > n) continue;
    for (let r0 = Math.max(0, r - h + 1); r0 <= Math.min(r, n - h); r0++) {
      for (let c0 = Math.max(0, c - w + 1); c0 <= Math.min(c, n - w); c0++) {
        const rect = { r0, c0, h, w };
        const cells = cellsOf(n, rect);
        if (cells.some(x => x !== cell && numbered.has(x))) continue;
        out.push({ rect, cells });
      }
    }
  }
  return out;
}

const numberedSet = (clues: readonly PatchClue[]) => new Set(clues.map(c => c.cell));

/** Up to `cap` solutions. Propagates before it branches, or it is far too slow. */
export function solveAll(n: number, clues: readonly PatchClue[], cap = 2): string[] {
  const size = n * n;
  const numbered = numberedSet(clues);
  const all = clues.map(c => candidatesFor(n, c.cell, c.area, numbered));
  if (all.some(a => a.length === 0)) return [];
  const found: string[] = [];

  const search = (cands: Candidate[][], used: Int32Array): void => {
    if (found.length >= cap) return;
    for (;;) {
      let moved = false;
      for (let i = 0; i < clues.length; i++) {
        if (cands[i]!.length === 0) return;
        const keep = cands[i]!.filter(o => o.cells.every(x => used[x] === -1 || used[x] === i));
        if (keep.length === 0) return;
        if (keep.length !== cands[i]!.length) { cands[i] = keep; moved = true; }
        if (keep.length === 1 && used[clues[i]!.cell] !== i) {
          for (const x of keep[0]!.cells) {
            if (used[x] !== -1 && used[x] !== i) return;
            used[x] = i;
          }
          moved = true;
        }
      }
      const owner = new Int32Array(size).fill(-2);
      for (let i = 0; i < clues.length; i++) {
        for (const o of cands[i]!) for (const x of o.cells) {
          owner[x] = owner[x] === -2 || owner[x] === i ? i : -1;
        }
      }
      for (let x = 0; x < size; x++) {
        if (used[x] !== -1) continue;
        if (owner[x] === -2) return;
        if (owner[x]! >= 0) {
          const i = owner[x]!;
          const keep = cands[i]!.filter(o => o.cells.includes(x));
          if (keep.length === 0) return;
          if (keep.length !== cands[i]!.length) { cands[i] = keep; moved = true; }
        }
      }
      if (!moved) break;
    }

    let best = -1;
    let bestCount = Infinity;
    for (let i = 0; i < clues.length; i++) {
      if (cands[i]!.length > 1 && cands[i]!.length < bestCount) { bestCount = cands[i]!.length; best = i; }
    }
    if (best === -1) {
      for (let x = 0; x < size; x++) if (used[x] === -1) return;
      found.push(cands.map(c => c[0]!.cells.join(',')).join('|'));
      return;
    }
    for (const o of cands[best]!) {
      const next = cands.map(c => c.slice());
      next[best] = [o];
      search(next, used.slice());
      if (found.length >= cap) return;
    }
  };

  search(all.map(a => a.slice()), new Int32Array(size).fill(-1));
  return found;
}

export interface Analysis {
  hard: number;
  openers: number;
  solved: boolean;
}

/*
 * How a person solves it, and how much work that is.
 *
 *   easy    a number with only one rectangle that fits. You look at the number,
 *           count squares, and there is nowhere else it can go.
 *   hard    a square that only one number can reach. You look at the square and
 *           work out which number is the only one that could still cover it.
 *
 * Difficulty is how often the hard one is needed. `openers` counts the numbers
 * settled by the easy rule from a blank board -- how many ways in there are.
 * A board that cannot be finished by reasoning is never published.
 */
export function analyze(n: number, clues: readonly PatchClue[]): Analysis {
  const size = n * n;
  const numbered = numberedSet(clues);
  const cands = clues.map(c => candidatesFor(n, c.cell, c.area, numbered));
  const openers = cands.filter(c => c.length === 1).length;
  const used = new Int32Array(size).fill(-1);
  let hard = 0;

  for (;;) {
    let easy = false;
    for (let i = 0; i < clues.length; i++) {
      if (cands[i]!.length === 0) return { hard, openers, solved: false };
      const keep = cands[i]!.filter(o => o.cells.every(x => used[x] === -1 || used[x] === i));
      if (keep.length === 0) return { hard, openers, solved: false };
      if (keep.length !== cands[i]!.length) { cands[i] = keep; easy = true; }
      if (keep.length === 1 && used[clues[i]!.cell] !== i) {
        for (const x of keep[0]!.cells) {
          if (used[x] !== -1 && used[x] !== i) return { hard, openers, solved: false };
          used[x] = i;
        }
        easy = true;
      }
    }
    if (easy) continue;

    let done = true;
    for (let x = 0; x < size; x++) if (used[x] === -1) { done = false; break; }
    if (done) return { hard, openers, solved: true };

    const owner = new Int32Array(size).fill(-2);
    for (let i = 0; i < clues.length; i++) {
      for (const o of cands[i]!) for (const x of o.cells) {
        owner[x] = owner[x] === -2 || owner[x] === i ? i : -1;
      }
    }
    let moved = false;
    for (let x = 0; x < size && !moved; x++) {
      if (used[x] !== -1 || owner[x]! < 0) continue;
      const i = owner[x]!;
      const keep = cands[i]!.filter(o => o.cells.includes(x));
      if (keep.length === 0) return { hard, openers, solved: false };
      if (keep.length !== cands[i]!.length) { cands[i] = keep; hard++; moved = true; }
    }
    if (!moved) return { hard, openers, solved: false };
  }
}

/**
 * Cut the board into rectangles by splitting it recursively, keeping every
 * piece inside a size range. One- and two-square pieces are dull to draw and
 * give too much away, so the floor matters as much as the ceiling.
 */
function partition(n: number, rng: Rng, minArea: number, maxArea: number): Rect[] {
  const out: Rect[] = [];
  const split = (r0: number, c0: number, h: number, w: number): void => {
    const area = h * w;
    if (area <= maxArea && area >= minArea) { out.push({ r0, c0, h, w }); return; }
    if (area <= minArea || (h === 1 && w === 1)) { out.push({ r0, c0, h, w }); return; }
    const horizontal = h === w ? rng() < 0.5 : h > w;
    const cuts: number[] = [];
    if (horizontal && h > 1) {
      for (let at = 1; at < h; at++) if (at * w >= minArea && (h - at) * w >= minArea) cuts.push(at);
      const at = cuts.length ? cuts[(rng() * cuts.length) | 0]! : 1 + ((rng() * (h - 1)) | 0);
      split(r0, c0, at, w);
      split(r0 + at, c0, h - at, w);
    } else if (w > 1) {
      for (let at = 1; at < w; at++) if (at * h >= minArea && (w - at) * h >= minArea) cuts.push(at);
      const at = cuts.length ? cuts[(rng() * cuts.length) | 0]! : 1 + ((rng() * (w - 1)) | 0);
      split(r0, c0, h, at);
      split(r0, c0 + at, h, w - at);
    } else {
      out.push({ r0, c0, h, w });
    }
  };
  split(0, 0, n, n);
  return out;
}

export const MIN_OPENERS = 2;

export function generate(n: number, rng: Rng, minArea = 3, maxArea = 6): PatchPuzzle | null {
  const rects = partition(n, rng, minArea, maxArea);
  // Where inside its own rectangle each number sits is the only lever there is.
  const clues: PatchClue[] = rects.map(rect => {
    const cells = cellsOf(n, rect);
    return { cell: cells[(rng() * cells.length) | 0]!, area: rect.h * rect.w };
  });

  for (let round = 0; round < 40; round++) {
    if (solveAll(n, clues, 2).length === 1) {
      const verdict = analyze(n, clues);
      if (!verdict.solved) return null;
      // No way in is no puzzle. This is a condition, not a measurement.
      if (verdict.openers < MIN_OPENERS) return null;
      return {
        n, clues, rects, solution: rects.slice(),
        hard: verdict.hard, openers: verdict.openers
      } as PatchPuzzle & { rects: Rect[] };
    }
    const i = (rng() * clues.length) | 0;
    const cells = cellsOf(n, rects[i]!);
    clues[i]!.cell = cells[(rng() * cells.length) | 0]!;
  }
  return null;
}

export interface Preset {
  n: number;
  label: string;
  minHard: number;
  maxHard: number;
}

export const DIFFICULTIES: Record<string, Preset> = {
  easy:   { n: 5, label: 'Easy',   minHard: 0,  maxHard: 2 },
  medium: { n: 6, label: 'Medium', minHard: 3,  maxHard: 6 },
  hard:   { n: 7, label: 'Hard',   minHard: 7,  maxHard: 11 },
  expert: { n: 8, label: 'Expert', minHard: 12, maxHard: Infinity }
};

export type DifficultyName = keyof typeof DIFFICULTIES;
export const DIFFICULTY_ORDER: DifficultyName[] = ['easy', 'medium', 'hard', 'expert'];

export function generateDifficulty(name: string, seed?: number): PatchPuzzle | null {
  const preset = DIFFICULTIES[name] ?? DIFFICULTIES.medium!;
  const rng = mulberry32(seed ?? ((Math.random() * 4294967296) >>> 0));
  let nearest: PatchPuzzle | null = null;
  for (let attempt = 0; attempt < 4000; attempt++) {
    const puzzle = generate(preset.n, rng);
    if (!puzzle) continue;
    if (puzzle.hard >= preset.minHard && puzzle.hard <= preset.maxHard) {
      puzzle.difficulty = name;
      return puzzle;
    }
    if (!nearest || Math.abs(puzzle.hard - preset.minHard) < Math.abs(nearest.hard - preset.minHard)) {
      nearest = puzzle;
    }
  }
  if (nearest) nearest.difficulty = name;
  return nearest;
}

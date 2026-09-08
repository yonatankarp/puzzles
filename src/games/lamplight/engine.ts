/*
 * Lamplight: generation, solving, and how hard a board is.
 *
 * The rules, whole:
 *
 *   1. Every lamp shines one way: up, down, left or right.
 *   2. Its beam runs until it meets a wall, another lamp, or the edge.
 *   3. Every square that is not a wall must end up lit, and none lit twice.
 *
 * Designed from the gesture outwards, unlike the two games that came before it
 * here and were thrown away: the move is turning a lamp, the answer is light
 * arriving, and nothing about a beam is hidden -- its length is on the board,
 * not in your head. An earlier attempt hid the lengths and became a board you
 * could only stare at.
 */

export type Cell = number;

/** Board squares. Anything else is an empty square waiting to be lit. */
export const WALL = -2;
export const EMPTY = -1;
export const LAMP = -3;

export interface Lamp {
  cell: Cell;
  /** The direction it shines in the one solution. */
  dir: number;
}

export interface LampPuzzle {
  n: number;
  /** WALL, LAMP or EMPTY, one per square. */
  board: number[];
  lamps: Lamp[];
  difficulty?: string;
  /** How many times the harder deduction is needed. See analyze(). */
  hard: number;
  /** Lamps with only one way to shine before anything is touched. */
  openers: number;
}

export interface Shape {
  dir: number;
  cells: Cell[];
}

/** up, down, left, right -- the order the arrow keys are read in. */
export const DIRS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
export const DIR_NAMES = ['up', 'down', 'left', 'right'] as const;

/** Round the compass, for turning a lamp on: up, right, down, left, then out. */
export const CLOCKWISE = [0, 3, 1, 2] as const;

export function nextRound(dir: number): number {
  if (dir < 0) return CLOCKWISE[0];
  const at = CLOCKWISE.indexOf(dir as 0 | 3 | 1 | 2);
  return at === CLOCKWISE.length - 1 ? -1 : CLOCKWISE[at + 1]!;
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

/**
 * Where a lamp's beam reaches. The length is never hidden: it is whatever the
 * walls and the other lamps allow, which is on the board for anyone to read.
 */
export function beamOf(n: number, board: readonly number[], lamp: Cell, dir: number): Cell[] {
  const [dr, dc] = DIRS[dir]!;
  const cells: Cell[] = [lamp];
  let r = ((lamp / n) | 0) + dr;
  let c = (lamp % n) + dc;
  while (r >= 0 && c >= 0 && r < n && c < n) {
    const cell = r * n + c;
    if (board[cell] === WALL || board[cell] === LAMP) break;
    cells.push(cell);
    r += dr;
    c += dc;
  }
  return cells;
}

/** Every distinct way a lamp could shine. Two ways that light the same one square count once. */
export function shapesFor(puzzle: Pick<LampPuzzle, 'n' | 'board'>, lamp: Cell): Shape[] {
  const seen = new Set<string>();
  const out: Shape[] = [];
  for (let dir = 0; dir < 4; dir++) {
    const cells = beamOf(puzzle.n, puzzle.board, lamp, dir);
    const key = cells.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dir, cells });
  }
  return out;
}

const litSquares = (puzzle: Pick<LampPuzzle, 'n' | 'board'>): Cell[] => {
  const out: Cell[] = [];
  for (let i = 0; i < puzzle.n * puzzle.n; i++) if (puzzle.board[i] !== WALL) out.push(i);
  return out;
};

interface Counter { hard: number }

/**
 * Narrow every lamp's options as far as the two deductions allow. Returns false
 * when the board has been made impossible.
 */
function propagate(
  puzzle: LampPuzzle, cands: Shape[][], used: Int32Array, needed: readonly Cell[], count: Counter | null
): boolean {
  const size = puzzle.n * puzzle.n;
  for (;;) {
    let easy = false;
    for (let i = 0; i < puzzle.lamps.length; i++) {
      if (cands[i]!.length === 0) return false;
      const keep = cands[i]!.filter(o => o.cells.every(c => used[c] === -1 || used[c] === i));
      if (keep.length === 0) return false;
      if (keep.length !== cands[i]!.length) { cands[i] = keep; easy = true; }
      if (keep.length === 1 && used[puzzle.lamps[i]!.cell] !== i) {
        for (const c of keep[0]!.cells) {
          if (used[c] !== -1 && used[c] !== i) return false;
          used[c] = i;
        }
        easy = true;
      }
    }
    if (easy) continue;

    const owner = new Int32Array(size).fill(-2);
    for (let i = 0; i < puzzle.lamps.length; i++) {
      for (const o of cands[i]!) for (const c of o.cells) {
        owner[c] = owner[c] === -2 || owner[c] === i ? i : -1;
      }
    }
    let moved = false;
    for (const cell of needed) {
      if (used[cell] !== -1) continue;
      if (owner[cell] === -2) return false;      // nothing can reach it
      if (owner[cell]! < 0) continue;
      const i = owner[cell]!;
      const keep = cands[i]!.filter(o => o.cells.includes(cell));
      if (keep.length === 0) return false;
      if (keep.length !== cands[i]!.length) {
        cands[i] = keep;
        if (count) count.hard++;
        moved = true;
        break;
      }
    }
    if (!moved) return true;
  }
}

/** Up to `cap` solutions, as a string per solution. */
export function solveAll(puzzle: LampPuzzle, cap = 2): string[] {
  const needed = litSquares(puzzle);
  const size = puzzle.n * puzzle.n;
  const start = puzzle.lamps.map(l => shapesFor(puzzle, l.cell));
  if (start.some(o => o.length === 0)) return [];
  const found: string[] = [];

  const search = (cands: Shape[][], used: Int32Array): void => {
    if (found.length >= cap) return;
    if (!propagate(puzzle, cands, used, needed, null)) return;
    let best = -1;
    let count = Infinity;
    for (let i = 0; i < puzzle.lamps.length; i++) {
      if (cands[i]!.length > 1 && cands[i]!.length < count) { count = cands[i]!.length; best = i; }
    }
    if (best === -1) {
      for (const cell of needed) if (used[cell] === -1) return;
      found.push(cands.map(c => c[0]!.dir).join(''));
      return;
    }
    for (const o of cands[best]!) {
      const next = cands.map(c => c.slice());
      next[best] = [o];
      search(next, used.slice());
      if (found.length >= cap) return;
    }
  };

  search(start.map(o => o.slice()), new Int32Array(size).fill(-1));
  return found;
}

export interface Analysis {
  hard: number;
  openers: number;
  solved: boolean;
}

/*
 * How a person plays it, and how much work that is. Two things you can see:
 *
 *   easy  a lamp with only one way left to shine. You look at the lamp.
 *   hard  a dark square only one lamp can still reach. You look at the square,
 *         and have to work out which lamp is the only one that could get there.
 *
 * Difficulty is how often the hard one is needed. `openers` is how many moves
 * are available before anything is touched -- a board with none of those is a
 * board you can only stare at, and is never published.
 */
export function analyze(puzzle: LampPuzzle): Analysis {
  const needed = litSquares(puzzle);
  const size = puzzle.n * puzzle.n;
  const cands = puzzle.lamps.map(l => shapesFor(puzzle, l.cell));
  const openers = cands.filter(c => c.length === 1).length;
  const used = new Int32Array(size).fill(-1);
  const count: Counter = { hard: 0 };
  const ok = propagate(puzzle, cands, used, needed, count);
  const solved = ok && needed.every(c => used[c] !== -1);
  return { hard: count.hard, openers, solved };
}

/**
 * Build a board by laying beams down one at a time and walling off their far
 * ends, so that every beam stops exactly where it is meant to.
 */
export function build(n: number, rng: Rng, maxLen = 5, stubChance = 0.25): LampPuzzle | null {
  /* A square already covered by a beam is spoken for. Leaving it EMPTY lets it
   * be chosen as the start of another run, and the board fills up with lamps
   * lighting nothing -- fourteen of them on a twenty-five square board. */
  const BEAM = -4;
  const grid = new Array<number>(n * n).fill(EMPTY);
  const lamps: Lamp[] = [];
  let guard = 0;

  for (;;) {
    if (guard++ > n * n * 4) return null;
    const open: Cell[] = [];
    for (let i = 0; i < n * n; i++) if (grid[i] === EMPTY) open.push(i);
    if (open.length === 0) break;

    /*
     * Start away from the lamps already standing. Two lamps side by side block
     * each other and the beam between them collapses to the single square the
     * lamp sits on.
     */
    const roomy = open.filter(cell => {
      const r = (cell / n) | 0;
      const c = cell % n;
      return !DIRS.some(([dr, dc]) => {
        const nr = r + dr;
        const nc = c + dc;
        return nr >= 0 && nc >= 0 && nr < n && nc < n && grid[nr * n + nc] === LAMP;
      });
    });
    const pool = roomy.length ? roomy : open;
    const start = pool[(rng() * pool.length) | 0]!;

    const runs: Array<{ dir: number; cells: Cell[]; beyond: Cell }> = [];
    for (let dir = 0; dir < 4; dir++) {
      const [dr, dc] = DIRS[dir]!;
      const cells: Cell[] = [start];
      let r = ((start / n) | 0) + dr;
      let c = (start % n) + dc;
      while (cells.length < maxLen && r >= 0 && c >= 0 && r < n && c < n && grid[r * n + c] === EMPTY) {
        cells.push(r * n + c);
        r += dr;
        c += dc;
      }
      const beyond = (r >= 0 && c >= 0 && r < n && c < n) ? r * n + c : -1;
      runs.push({ dir, cells, beyond });
    }
    /*
     * Longest run first. Taking a random length fragments the board: the
     * leftovers are scattered single squares, every one becomes its own lamp,
     * and the board ends up two thirds lamps with beams one square long.
     */
    runs.sort((a, b) => b.cells.length - a.cells.length || (rng() < 0.5 ? -1 : 1));

    let placed: { dir: number; cells: Cell[]; beyond: Cell } | null = null;
    for (const run of runs) {
      if (run.beyond >= 0 && grid[run.beyond] === BEAM) continue;
      // A lamp lighting only its own square offers no choice and says nothing.
      if (run.cells.length < 2 && rng() > stubChance) continue;
      if (run.beyond >= 0 && grid[run.beyond] === EMPTY) grid[run.beyond] = WALL;
      placed = run;
      break;
    }
    if (!placed) { grid[start] = WALL; continue; }

    for (const cell of placed.cells) grid[cell] = BEAM;
    grid[start] = LAMP;
    lamps.push({ cell: start, dir: placed.dir });
  }

  if (lamps.length < 3) return null;
  const board = new Array<number>(n * n).fill(EMPTY);
  for (let i = 0; i < n * n; i++) if (grid[i] === WALL) board[i] = WALL;
  for (const lamp of lamps) board[lamp.cell] = LAMP;
  return { n, board, lamps, hard: 0, openers: 0 };
}

/**
 * A board the walls alone pin down. An early version of this handed out a few
 * lamps already aimed and locked, because it could otherwise make only two
 * boards in two hundred with a single answer; laying the longest run first and
 * turning leftovers into wall fixed that, and the locked lamps were left behind
 * as a rule the player had to put up with for no reason. Nothing is locked.
 */
export function generate(n: number, rng: Rng): LampPuzzle | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const puzzle = build(n, rng);
    if (!puzzle) continue;
    if (solveAll(puzzle, 2).length !== 1) continue;
    const verdict = analyze(puzzle);
    if (!verdict.solved || verdict.openers < 1) continue;
    puzzle.hard = verdict.hard;
    puzzle.openers = verdict.openers;
    return puzzle;
  }
  return null;
}

export interface Preset {
  n: number;
  label: string;
  minHard: number;
  maxHard: number;
}

/*
 * Size sets the scale, the count of hard deductions sets the work. Bands are
 * taken from what boards of each size actually produce, not from round numbers.
 */
export const DIFFICULTIES: Record<string, Preset> = {
  easy:   { n: 5, label: 'Easy',   minHard: 0,  maxHard: 6 },
  medium: { n: 6, label: 'Medium', minHard: 7,  maxHard: 10 },
  hard:   { n: 7, label: 'Hard',   minHard: 11, maxHard: 14 },
  expert: { n: 8, label: 'Expert', minHard: 15, maxHard: Infinity }
};

export type DifficultyName = keyof typeof DIFFICULTIES;
export const DIFFICULTY_ORDER: DifficultyName[] = ['easy', 'medium', 'hard', 'expert'];

export function generateDifficulty(name: string, seed?: number): LampPuzzle | null {
  const preset = DIFFICULTIES[name] ?? DIFFICULTIES.medium!;
  const rng = mulberry32(seed ?? ((Math.random() * 4294967296) >>> 0));
  let nearest: LampPuzzle | null = null;
  for (let attempt = 0; attempt < 900; attempt++) {
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

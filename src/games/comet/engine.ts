/*
 * Comet: generation, solving, and how hard a board is.
 *
 * The rules, whole:
 *
 *   1. Every marked square is the head of a comet, flying one straight way.
 *   2. A number is how long that comet is, counting the head. A head with no
 *      number is one you have to work out.
 *   3. Every square belongs to exactly one comet.
 *
 * So a solved board is a tiling of the grid by straight 1xk pieces with one end
 * of each piece marked, and the puzzle is recovering which way each one flies.
 *
 * The second design. The first showed every length, and that board solved
 * itself: every head had one legal direction almost at once, so play was a scan
 * with nothing to work out and no difficulty to measure -- 0 hard deductions on
 * every board at every size. Withholding lengths is what makes it a puzzle, and
 * how many are withheld is a dial that can be measured rather than guessed at.
 */

export type Cell = number;

export interface CometClue {
  cell: Cell;
  /** Length counting the head, or 0 for a head whose length is withheld. */
  len: number;
}

export interface CometPuzzle {
  n: number;
  clues: CometClue[];
  /** The one solution: for each clue, the cells its comet covers. */
  solution: Cell[][];
  difficulty?: string;
  /** How many times the harder deduction is needed. See analyze(). */
  hard: number;
}

export interface Shape {
  dir: number;
  cells: Cell[];
}

/** up, down, left, right -- the order the arrow keys are read in. */
export const DIRS: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
export const DIR_NAMES = ['up', 'down', 'left', 'right'] as const;

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
 * Every shape a head could take. A tail may not pass through another head, so
 * the heads themselves do most of the work of constraining the board.
 */
export function shapesFor(n: number, head: Cell, len: number, isHead: Uint8Array): Shape[] {
  const out: Shape[] = [];
  const r0 = (head / n) | 0;
  const c0 = head % n;
  // A comet of length 1 is the head alone, and has no direction worth naming.
  if (len === 0 || len === 1) out.push({ dir: 0, cells: [head] });
  for (let d = 0; d < 4; d++) {
    const [dr, dc] = DIRS[d]!;
    const cells: Cell[] = [head];
    for (let k = 1; k <= n; k++) {
      const r = r0 + dr * k;
      const c = c0 + dc * k;
      if (r < 0 || c < 0 || r >= n || c >= n) break;
      const cell = r * n + c;
      if (isHead[cell]) break;
      cells.push(cell);
      if (len === 0) out.push({ dir: d, cells: cells.slice() });
      else if (cells.length === len) { out.push({ dir: d, cells: cells.slice() }); break; }
    }
  }
  return out;
}

const headMask = (n: number, clues: readonly CometClue[]): Uint8Array => {
  const isHead = new Uint8Array(n * n);
  for (const c of clues) isHead[c.cell] = 1;
  return isHead;
};

/**
 * Up to `cap` solutions. Propagates before it branches: a head with no number
 * has up to 4n shapes, and plain search over that is thousands of times slower
 * -- 1.4 seconds a board at 7x7 against under a millisecond with this.
 */
export function solveAll(n: number, clues: readonly CometClue[], cap = 2): string[] {
  const size = n * n;
  const isHead = headMask(n, clues);
  const all = clues.map(c => shapesFor(n, c.cell, c.len, isHead));
  if (all.some(o => o.length === 0)) return [];
  const found: string[] = [];

  const search = (cands: Shape[][], used: Int32Array): void => {
    if (found.length >= cap) return;
    for (;;) {
      let moved = false;
      for (let i = 0; i < clues.length; i++) {
        const list = cands[i]!;
        if (list.length === 0) return;
        if (list.length === 1 && used[clues[i]!.cell] !== i) {
          for (const cell of list[0]!.cells) {
            if (used[cell] !== -1 && used[cell] !== i) return;
            used[cell] = i;
          }
          moved = true;
        }
      }
      for (let i = 0; i < clues.length; i++) {
        if (cands[i]!.length === 1) continue;
        const keep = cands[i]!.filter(o => o.cells.every(c => used[c] === -1 || used[c] === i));
        if (keep.length === 0) return;
        if (keep.length !== cands[i]!.length) { cands[i] = keep; moved = true; }
      }
      const owner = new Int32Array(size).fill(-2);
      for (let i = 0; i < clues.length; i++) {
        for (const o of cands[i]!) {
          for (const cell of o.cells) owner[cell] = owner[cell] === -2 || owner[cell] === i ? i : -1;
        }
      }
      for (let cell = 0; cell < size; cell++) {
        if (used[cell] !== -1) continue;
        if (owner[cell] === -2) return;
        if (owner[cell]! >= 0) {
          const i = owner[cell]!;
          const keep = cands[i]!.filter(o => o.cells.includes(cell));
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
      for (let cell = 0; cell < size; cell++) if (used[cell] === -1) return;
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

  search(all.map(o => o.slice()), new Int32Array(size).fill(-1));
  return found;
}

export interface Analysis {
  /** How many times the harder deduction was needed. This is the difficulty. */
  hard: number;
  /** False if the board cannot be finished by deduction alone. */
  solved: boolean;
}

/*
 * How a person solves it, and how much work that is. Only two deductions, both
 * of which you can see on the board:
 *
 *   easy  a head with one shape left. You look at the comet.
 *   hard  a square only one comet can still reach. You look at the square, and
 *         you have to think about every comet that could get there.
 *
 * Difficulty is how often the hard one is needed. Boards that would need a
 * guess are never published: `solved` false is the line generation will not
 * cross, so no Comet board ever has to be guessed at.
 */
export function analyze(n: number, clues: readonly CometClue[]): Analysis {
  const size = n * n;
  const isHead = headMask(n, clues);
  const cands = clues.map(c => shapesFor(n, c.cell, c.len, isHead));
  const used = new Int32Array(size).fill(-1);
  let hard = 0;

  for (;;) {
    let easy = false;
    for (let i = 0; i < clues.length; i++) {
      if (cands[i]!.length === 0) return { hard, solved: false };
      const keep = cands[i]!.filter(o => o.cells.every(c => used[c] === -1 || used[c] === i));
      if (keep.length === 0) return { hard, solved: false };
      if (keep.length !== cands[i]!.length) { cands[i] = keep; easy = true; }
      if (keep.length === 1 && used[clues[i]!.cell] !== i) {
        for (const cell of keep[0]!.cells) {
          if (used[cell] !== -1 && used[cell] !== i) return { hard, solved: false };
          used[cell] = i;
        }
        easy = true;
      }
    }
    if (easy) continue;

    let covered = true;
    for (let cell = 0; cell < size; cell++) if (used[cell] === -1) { covered = false; break; }
    if (covered) return { hard, solved: true };

    const owner = new Int32Array(size).fill(-2);
    for (let i = 0; i < clues.length; i++) {
      for (const o of cands[i]!) {
        for (const cell of o.cells) owner[cell] = owner[cell] === -2 || owner[cell] === i ? i : -1;
      }
    }
    let progressed = false;
    for (let cell = 0; cell < size && !progressed; cell++) {
      if (used[cell] !== -1) continue;
      if (owner[cell] === -2) return { hard, solved: false };
      if (owner[cell]! < 0) continue;
      const i = owner[cell]!;
      const keep = cands[i]!.filter(o => o.cells.includes(cell));
      if (keep.length === 0) return { hard, solved: false };
      if (keep.length !== cands[i]!.length) { cands[i] = keep; hard++; progressed = true; }
      else if (keep.length === 1 && used[clues[i]!.cell] !== i) {
        for (const c of keep[0]!.cells) used[c] = i;
        hard++;
        progressed = true;
      }
    }
    if (!progressed) return { hard, solved: false };
  }
}

/**
 * Tile the grid with straight segments. Length 1 is legal, so a leftover single
 * square is never a dead end and tiling always completes -- which is why this
 * needs no backtracking.
 */
function tile(n: number, rng: Rng): Cell[][] {
  const owner = new Int32Array(n * n).fill(-1);
  const segments: Cell[][] = [];
  const order = [...Array(n * n).keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (const start of order) {
    if (owner[start] !== -1) continue;
    const r0 = (start / n) | 0;
    const c0 = start % n;
    const dirs = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [dirs[i], dirs[j]] = [dirs[j]!, dirs[i]!];
    }
    let placed: Cell[] | null = null;
    for (let len = n; len >= 1 && !placed; len--) {
      if (len > 1 && rng() < 0.12) continue;         // keep some variety in lengths
      for (const d of dirs) {
        const [dr, dc] = DIRS[d]!;
        const cells: Cell[] = [];
        let ok = true;
        for (let k = 0; k < len; k++) {
          const r = r0 + dr * k;
          const c = c0 + dc * k;
          if (r < 0 || c < 0 || r >= n || c >= n) { ok = false; break; }
          const cell = r * n + c;
          if (owner[cell] !== -1) { ok = false; break; }
          cells.push(cell);
        }
        if (ok && cells.length === len) { placed = cells; break; }
      }
    }
    const cells = placed ?? [start];
    const id = segments.length;
    for (const cell of cells) owner[cell] = id;
    segments.push(cells);
  }
  return segments;
}

/** One board: tile, number every head, then withhold every number that can be. */
export function generate(n: number, rng: Rng): CometPuzzle | null {
  const segments = tile(n, rng);
  const ends = segments.map(cells => [cells[0]!, cells[cells.length - 1]!] as const);
  const clues: CometClue[] = segments.map((cells, i) => ({
    cell: ends[i]![rng() < 0.5 ? 0 : 1]!,
    len: cells.length
  }));
  if (solveAll(n, clues, 2).length !== 1) return null;

  /*
   * Withhold a length only while the board stays unique AND stays solvable
   * without guessing. Both halves matter: uniqueness alone would let boards
   * through that can only be finished by trying something and seeing.
   */
  const order = [...clues.keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (const i of order) {
    const was = clues[i]!.len;
    clues[i]!.len = 0;
    const ok = solveAll(n, clues, 2).length === 1 && analyze(n, clues).solved;
    if (!ok) clues[i]!.len = was;
  }

  const verdict = analyze(n, clues);
  if (!verdict.solved) return null;
  const isHead = headMask(n, clues);
  const solution = segments.map((cells, i) => {
    const shapes = shapesFor(n, clues[i]!.cell, cells.length, isHead);
    const match = shapes.find(s => s.cells.length === cells.length &&
      s.cells.every(c => cells.includes(c)));
    return match ? match.cells : cells;
  });
  return { n, clues, solution, hard: verdict.hard };
}

export interface Preset {
  n: number;
  label: string;
  minHard: number;
  maxHard: number;
}

/*
 * Size sets the scale, the hard-deduction count sets the work. Both matter: a
 * big board of easy deductions is long rather than hard, and a small board that
 * demands the harder rule twenty times is the other way round.
 */
export const DIFFICULTIES: Record<string, Preset> = {
  easy:   { n: 5, label: 'Easy',   minHard: 1,  maxHard: 8 },
  medium: { n: 6, label: 'Medium', minHard: 9,  maxHard: 16 },
  hard:   { n: 7, label: 'Hard',   minHard: 17, maxHard: 25 },
  expert: { n: 8, label: 'Expert', minHard: 26, maxHard: Infinity }
};

export type DifficultyName = keyof typeof DIFFICULTIES;
export const DIFFICULTY_ORDER: DifficultyName[] = ['easy', 'medium', 'hard', 'expert'];

export function generateDifficulty(name: string, seed?: number): CometPuzzle | null {
  const preset = DIFFICULTIES[name] ?? DIFFICULTIES.medium!;
  const rng = mulberry32(seed ?? ((Math.random() * 4294967296) >>> 0));
  let nearest: CometPuzzle | null = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const puzzle = generate(preset.n, rng);
    if (!puzzle) continue;
    if (puzzle.hard >= preset.minHard && puzzle.hard <= preset.maxHard) {
      puzzle.difficulty = name;
      return puzzle;
    }
    // Keep the closest miss, so a hard seed still yields a board rather than none.
    if (!nearest || Math.abs(puzzle.hard - preset.minHard) < Math.abs(nearest.hard - preset.minHard)) {
      nearest = puzzle;
    }
  }
  if (nearest) nearest.difficulty = name;
  return nearest;
}

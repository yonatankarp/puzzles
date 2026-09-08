/*
 * Queens engine: generation, uniqueness checking, difficulty measurement.
 *
 * Place one queen in every row, every column and every colour region, with no
 * two queens touching — including diagonally. Regions are connected and there
 * are exactly as many of them as there are rows.
 *
 * Because one queen per row and one per column is already required, two queens
 * can only ever touch if they sit in adjacent rows with columns one apart. That
 * reduces the whole adjacency rule to |col[r] - col[r+1]| >= 2, which is what
 * makes both the solver and the generator fast.
 *
 * Nothing here touches the DOM.
 */
export type Rng = () => number;
export type DifficultyName = 'easy' | 'medium' | 'hard' | 'expert';

export interface QueensStats {
  /** Placements a solver could not deduce and had to guess. */
  guesses: number;
  /** How many were deduced without a guess. */
  deduced: number;
  attempts?: number;
  regrows?: number;
}

export interface QueensPuzzle {
  n: number;
  /** Region index (0..n-1) for each cell, row-major. */
  regions: number[];
  /** The solution as a column per row. */
  solution: number[];
  difficulty?: DifficultyName;
  stats?: QueensStats;
}

export interface Difficulty {
  label: string;
  n: number;
  minGuesses: number;
  maxGuesses: number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

// ------------------------------------------------------------------ placing

/**
 * A column for each row: all distinct, and never within one column of the row
 * above. Built by backtracking because rejection sampling stalls badly by n=8.
 */
export function samplePlacement(n: number, rng: Rng): number[] | null {
  const cols: number[] = [];
  const used = new Uint8Array(n);

  const place = (row: number): boolean => {
    if (row === n) return true;
    for (const col of shuffle(Array.from({ length: n }, (_, i) => i), rng)) {
      if (used[col]) continue;
      if (row > 0 && Math.abs(col - cols[row - 1]!) < 2) continue;
      used[col] = 1;
      cols.push(col);
      if (place(row + 1)) return true;
      cols.pop();
      used[col] = 0;
    }
    return false;
  };
  return place(0) ? cols : null;
}

/*
 * Grow one region from each queen until the board is covered. Growing outward
 * from the queens is what guarantees every region is connected and contains
 * exactly one of them -- carving the board up first and hoping would not.
 */
export function growRegions(n: number, cols: readonly number[], rng: Rng): number[] {
  const regions = new Array<number>(n * n).fill(-1);
  const frontiers: number[][] = [];
  for (let row = 0; row < n; row++) {
    const cell = row * n + cols[row]!;
    regions[cell] = row;
    frontiers.push([cell]);
  }

  let remaining = n * n - n;
  while (remaining > 0) {
    // Bias towards smaller regions so one does not swallow the board.
    const order = shuffle(Array.from({ length: n }, (_, i) => i), rng)
      .sort((a, b) => frontiers[a]!.length - frontiers[b]!.length);
    let grew = false;
    for (const region of order) {
      const frontier = frontiers[region]!;
      shuffle(frontier, rng);
      let picked = -1;
      for (let i = frontier.length - 1; i >= 0; i--) {
        const from = frontier[i]!;
        const row = (from / n) | 0;
        const col = from % n;
        const neighbours: number[] = [];
        if (row > 0) neighbours.push(from - n);
        if (row < n - 1) neighbours.push(from + n);
        if (col > 0) neighbours.push(from - 1);
        if (col < n - 1) neighbours.push(from + 1);
        const free = shuffle(neighbours.filter(c => regions[c] === -1), rng);
        if (free.length) { picked = free[0]!; break; }
        frontier.splice(i, 1);          // boxed in; stop looking at it
      }
      if (picked >= 0) {
        regions[picked] = region;
        frontier.push(picked);
        remaining--;
        grew = true;
        if (remaining === 0) break;
      }
    }
    if (!grew) break;                   // nothing can reach the rest
  }
  // Anything unreachable (only possible if the board disconnects) joins a
  // neighbour, keeping regions contiguous.
  for (let cell = 0; cell < regions.length; cell++) {
    if (regions[cell] !== -1) continue;
    const row = (cell / n) | 0;
    const col = cell % n;
    const around = [row > 0 ? cell - n : -1, row < n - 1 ? cell + n : -1,
                    col > 0 ? cell - 1 : -1, col < n - 1 ? cell + 1 : -1];
    const taken = around.find(c => c >= 0 && regions[c] !== -1);
    regions[cell] = taken !== undefined ? regions[taken]! : 0;
  }
  return regions;
}

// ------------------------------------------------------------------ solving

/** Every solution, up to `cap`. Two is enough to test uniqueness. */
export function findSolutions(n: number, regions: readonly number[], cap = 2): number[][] {
  const found: number[][] = [];
  const cols = new Array<number>(n);
  const usedCol = new Uint8Array(n);
  const usedRegion = new Uint8Array(n);

  const walk = (row: number): void => {
    if (found.length >= cap) return;
    if (row === n) { found.push(cols.slice()); return; }
    for (let col = 0; col < n; col++) {
      if (usedCol[col]) continue;
      if (row > 0 && Math.abs(col - cols[row - 1]!) < 2) continue;
      const region = regions[row * n + col]!;
      if (usedRegion[region]) continue;
      usedCol[col] = 1;
      usedRegion[region] = 1;
      cols[row] = col;
      walk(row + 1);
      usedCol[col] = 0;
      usedRegion[region] = 0;
      if (found.length >= cap) return;
    }
  };
  walk(0);
  return found;
}

export const countSolutions = (n: number, regions: readonly number[], cap = 2): number =>
  findSolutions(n, regions, cap).length;

/*
 * How hard it is by hand.
 *
 * A candidate grid is narrowed by the deductions a person actually makes: a
 * placed queen clears its row, column, region and the eight squares around it;
 * a row, column or region with one candidate left must hold a queen. When that
 * stalls, the solver is genuinely guessing, and those are what get counted --
 * the same measure Zip uses, so the two games' tiers mean the same thing.
 */
export function analyze(n: number, regions: readonly number[], solution: readonly number[]): QueensStats {
  const possible = new Uint8Array(n * n).fill(1);
  const queenAt = new Int32Array(n).fill(-1);
  let placedCount = 0;
  let guesses = 0;
  let deduced = 0;

  const place = (row: number, col: number): void => {
    queenAt[row] = col;
    placedCount++;
    const region = regions[row * n + col]!;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cell = r * n + c;
        if (!possible[cell]) continue;
        const touching = Math.abs(r - row) <= 1 && Math.abs(c - col) <= 1;
        if (r === row || c === col || regions[cell] === region || touching) possible[cell] = 0;
      }
    }
  };

  const onlyCandidate = (cells: number[]): number => {
    let found = -1;
    for (const cell of cells) {
      if (!possible[cell]) continue;
      if (found >= 0) return -1;
      found = cell;
    }
    return found;
  };

  while (placedCount < n) {
    let progressed = false;
    for (let group = 0; group < n && !progressed; group++) {
      const rowCells: number[] = [];
      const colCells: number[] = [];
      const regionCells: number[] = [];
      for (let i = 0; i < n * n; i++) {
        if (((i / n) | 0) === group) rowCells.push(i);
        if (i % n === group) colCells.push(i);
        if (regions[i] === group) regionCells.push(i);
      }
      for (const cells of [rowCells, colCells, regionCells]) {
        const cell = onlyCandidate(cells);
        if (cell < 0) continue;
        const row = (cell / n) | 0;
        if (queenAt[row] >= 0) continue;
        place(row, cell % n);
        deduced++;
        progressed = true;
        break;
      }
    }
    if (progressed) continue;

    // Stuck: a person would have to try something here.
    const row = queenAt.indexOf(-1);
    if (row < 0) break;
    guesses++;
    place(row, solution[row]!);
  }
  return { guesses, deduced };
}

// ---------------------------------------------------------------- refining

/*
 * Random carvings are never unique. Measured over 400 boards at each size, not
 * one had a single solution -- every one hit the solver's cap. So, exactly as
 * Zip does with walls, the board is refined against its own rival solutions.
 *
 * A rival must place a queen somewhere the intended solution does not. Move one
 * of those cells into a region the rival already uses elsewhere and the rival
 * now wants two queens in one region, which is illegal. The intended solution
 * survives untouched because a queen's own cell is never the one moved, so
 * every region keeps exactly the queen it started with.
 */
function neighbours(n: number, cell: number): number[] {
  const row = (cell / n) | 0;
  const col = cell % n;
  const out: number[] = [];
  if (row > 0) out.push(cell - n);
  if (row < n - 1) out.push(cell + n);
  if (col > 0) out.push(cell - 1);
  if (col < n - 1) out.push(cell + 1);
  return out;
}

/** Would the region still hold together, and still contain its queen, without `cell`? */
function survivesRemoval(
  n: number, regions: readonly number[], cell: number, queenCell: number
): boolean {
  const region = regions[cell]!;
  if (cell === queenCell) return false;
  const members = new Set<number>();
  for (let i = 0; i < regions.length; i++) if (regions[i] === region && i !== cell) members.add(i);
  if (!members.has(queenCell)) return false;
  const seen = new Set<number>([queenCell]);
  const stack = [queenCell];
  while (stack.length) {
    for (const next of neighbours(n, stack.pop()!)) {
      if (members.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return seen.size === members.size;
}

export function refine(
  n: number, solution: readonly number[], regions: number[], rng: Rng, maxSteps = 80
): boolean {
  const queenCell = (row: number) => row * n + solution[row]!;
  const queenOfRegion = new Int32Array(n);
  for (let row = 0; row < n; row++) queenOfRegion[regions[queenCell(row)]!] = queenCell(row);

  for (let step = 0; step < maxSteps; step++) {
    const solutions = findSolutions(n, regions, 2);
    if (solutions.length === 0) return false;         // over-constrained; should not happen
    if (solutions.length === 1) return true;

    const rival = solutions.find(s => s.some((col, row) => col !== solution[row])) ?? solutions[1]!;
    const rivalRegionAt = rival.map((col, row) => regions[row * n + col]!);

    // Cells the rival uses and the intended solution does not.
    const targets = shuffle(
      rival.map((col, row) => ({ row, cell: row * n + col }))
        .filter(({ row, cell }) => cell !== queenCell(row)),
      rng
    );

    let moved = false;
    for (const { row, cell } of targets) {
      for (const near of shuffle(neighbours(n, cell), rng)) {
        const into = regions[near]!;
        if (into === regions[cell]) continue;
        // Only useful if the rival already needs `into` for a different row:
        // giving it a second cell there is what makes the rival illegal.
        if (!rivalRegionAt.some((region, other) => region === into && other !== row)) continue;
        if (!survivesRemoval(n, regions, cell, queenOfRegion[regions[cell]!]!)) continue;
        regions[cell] = into;
        moved = true;
        break;
      }
      if (moved) break;
    }

    if (!moved) {
      // Nothing decisive available: nudge any movable cell so the next round
      // sees a different board rather than the same stalemate.
      const loose = shuffle(
        Array.from({ length: n * n }, (_, i) => i)
          .filter(i => i !== queenOfRegion[regions[i]!]),
        rng
      );
      for (const cell of loose) {
        const options = shuffle(neighbours(n, cell), rng)
          .filter(near => regions[near] !== regions[cell]);
        if (!options.length) continue;
        if (!survivesRemoval(n, regions, cell, queenOfRegion[regions[cell]!]!)) continue;
        regions[cell] = regions[options[0]!]!;
        moved = true;
        break;
      }
      if (!moved) return false;
    }
  }
  return findSolutions(n, regions, 2).length === 1;
}

// --------------------------------------------------------------- generation

export interface GenerateOptions {
  n: number;
  rng?: Rng;
  minGuesses?: number;
  maxGuesses?: number;
  maxAttempts?: number;
  /** How many different region carvings to try per placement. */
  regrows?: number;
}

export function generate(options: GenerateOptions): QueensPuzzle | null {
  const { n } = options;
  const rng = options.rng ?? mulberry32((Math.random() * 4294967296) >>> 0);
  const minGuesses = options.minGuesses ?? 0;
  const maxGuesses = options.maxGuesses ?? Infinity;
  const maxAttempts = options.maxAttempts ?? 200;
  const regrowLimit = options.regrows ?? 8;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const solution = samplePlacement(n, rng);
    if (!solution) continue;
    for (let regrow = 0; regrow < regrowLimit; regrow++) {
      const regions = growRegions(n, solution, rng);
      // The carving decides the puzzle: a placement can be right while the
      // regions around it leave the board wide open. Refine until it is not.
      if (!refine(n, solution, regions, rng)) continue;
      const stats = analyze(n, regions, solution);
      if (stats.guesses < minGuesses || stats.guesses > maxGuesses) continue;
      return {
        n, regions, solution,
        stats: { ...stats, attempts: attempt + 1, regrows: regrow + 1 }
      };
    }
  }
  return null;
}

export const DIFFICULTIES: Record<DifficultyName, Difficulty> = {
  easy: { label: 'Easy', n: 6, minGuesses: 0, maxGuesses: 0 },
  medium: { label: 'Medium', n: 7, minGuesses: 0, maxGuesses: 1 },
  hard: { label: 'Hard', n: 8, minGuesses: 1, maxGuesses: 2 },
  expert: { label: 'Expert', n: 9, minGuesses: 2, maxGuesses: 99 }
};

export const DIFFICULTY_ORDER: DifficultyName[] = ['easy', 'medium', 'hard', 'expert'];

export function generateDifficulty(name: DifficultyName, seed?: number): QueensPuzzle | null {
  const preset = DIFFICULTIES[name] ?? DIFFICULTIES.medium;
  const puzzle = generate({
    n: preset.n,
    minGuesses: preset.minGuesses,
    maxGuesses: preset.maxGuesses,
    rng: mulberry32(seed ?? ((Math.random() * 4294967296) >>> 0))
  });
  if (puzzle) puzzle.difficulty = name;
  return puzzle;
}

/*
 * Queens: the rules, and nothing else.
 *
 * Timing, the reveal gate, the daily, streaks, saved runs, preferences and
 * publishing all live in ShellCore. What is left here is what makes this game
 * Queens rather than Zip.
 */
import {
  DIFFICULTIES, DIFFICULTY_ORDER, generateDifficulty,
  type DifficultyName, type QueensPuzzle
} from './engine.ts';
import { QueensBoard, type Mark } from './board.ts';
import { fingerprint } from './daily.ts';
import { QueensSource } from './source.ts';
import { ShellCore, mergeHooks, type GameProgress, type TierInfo } from '../../shell/core.ts';

/** Marks are stored as cell * 3 + code, so a run is a flat list of numbers. */
const CODE: Record<Exclude<Mark, 'empty'>, number> = { blocked: 1, queen: 2 };

export class QueensCore extends ShellCore<QueensPuzzle> {
  readonly gameId = 'queens';
  readonly displayName = 'Queens';
  protected readonly dailyTier = 'hard';

  private readonly source = new QueensSource();
  private view: QueensBoard | null = null;
  private marks: Mark[] = [];
  private conflicts = new Set<number>();

  constructor() { super('queens', 'medium'); }

  // ---- what the shell asks for -------------------------------------------

  protected tiers(): TierInfo[] {
    return DIFFICULTY_ORDER.map(id => ({ id, label: DIFFICULTIES[id].label }));
  }
  protected tierLabel(id: string): string {
    return DIFFICULTIES[id as DifficultyName]?.label ?? id;
  }
  protected requestDaily(seed: number) { return this.source.requestDaily(seed); }
  protected requestTier(tier: string) { return this.source.requestTier(tier as DifficultyName); }
  protected fingerprint(puzzle: QueensPuzzle) { return fingerprint(puzzle); }

  protected resetState(puzzle: QueensPuzzle): void {
    this.marks = new Array<Mark>(puzzle.n * puzzle.n).fill('empty');
    this.conflicts = new Set();
  }

  protected applyPuzzle(puzzle: QueensPuzzle, covered: boolean): void {
    this.view?.setPuzzle(puzzle, covered);
  }

  protected redraw(): void {
    this.view?.draw(this.marks, this.conflicts, this.solved);
  }

  protected progress(): GameProgress {
    const n = this.puzzle?.n ?? DIFFICULTIES[this.difficulty as DifficultyName]?.n ?? 8;
    const placed = this.marks.filter(m => m === 'queen').length;
    return {
      done: placed,
      total: n,
      unit: 'queens placed',
      goal: `${Math.max(0, n - placed)} still to place.`,
      sizeLabel: `${n}×${n}`,
      progressColour: null
    };
  }

  protected encodeMoves(): number[] {
    const moves: number[] = [];
    this.marks.forEach((mark, cell) => {
      if (mark !== 'empty') moves.push(cell * 3 + CODE[mark]);
    });
    return moves;
  }

  protected decodeMoves(moves: number[]): boolean {
    const size = this.marks.length;
    // Reject wholesale rather than replay half of something that does not fit.
    for (const move of moves) {
      const cell = Math.floor(move / 3);
      const code = move % 3;
      if (!Number.isInteger(move) || cell < 0 || cell >= size || code < 1 || code > 2) return false;
    }
    for (const move of moves) {
      this.marks[Math.floor(move / 3)] = move % 3 === 1 ? 'blocked' : 'queen';
    }
    this.recomputeConflicts();
    return true;
  }

  protected celebrationCell(): number | null {
    const cell = this.marks.findIndex(m => m === 'queen');
    return cell < 0 ? null : cell;
  }

  protected attachInput(boardSvg: SVGSVGElement): Array<() => void> {
    this.view = new QueensBoard(boardSvg);
    this.board = this.view;
    const down = (e: PointerEvent) => {
      this.audio.markInteracted();
      this.view!.invalidateRect();
      const cell = this.view!.cellAt(e.clientX, e.clientY);
      if (cell < 0) return;
      this.cycle(cell);
      e.preventDefault();
    };
    const resize = () => this.view?.invalidateRect();
    boardSvg.addEventListener('pointerdown', down);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', resize, true);
    return [
      () => boardSvg.removeEventListener('pointerdown', down),
      () => window.removeEventListener('resize', resize),
      () => window.removeEventListener('scroll', resize, true)
    ];
  }

  protected onRestart(): void {
    this.marks.fill('empty');
    this.conflicts = new Set();
  }

  /** Undo takes back the most recent queen; a cross is not worth undoing. */
  protected onUndo(): void {
    if (this.phase !== 'playing' || this.solved) return;
    for (let cell = this.marks.length - 1; cell >= 0; cell--) {
      if (this.marks[cell] !== 'queen') continue;
      this.marks[cell] = 'empty';
      this.backtracks++;
      this.recomputeConflicts();
      this.setBanner(null);
      this.redraw();
      this.markDirty();
      return;
    }
  }

  protected onReveal(): void {
    const puzzle = this.puzzle!;
    this.marks.fill('empty');
    puzzle.solution.forEach((col, row) => { this.marks[row * puzzle.n + col] = 'queen'; });
    this.recomputeConflicts();
  }

  /*
   * A hint places the queen the solution wants next. Queens already standing
   * where the solution does not use come off first: the board cannot be
   * finished from there, and building a hint on a wreck helps nobody.
   */
  protected onHint(): void {
    if (!this.puzzle || this.solved || this.revealed || this.phase !== 'playing') return;
    const { n, solution } = this.puzzle;
    const wrong: number[] = [];
    this.marks.forEach((mark, cell) => {
      if (mark === 'queen' && solution[(cell / n) | 0] !== cell % n) wrong.push(cell);
    });
    if (wrong.length) {
      for (const cell of wrong) this.marks[cell] = 'empty';
      this.setBanner({ text: 'Off track — those queens cannot be right', kind: 'bad' }, 1500);
    }
    const row = solution.findIndex((col, r) => this.marks[r * n + col] !== 'queen');
    if (row >= 0) {
      const cell = row * n + solution[row]!;
      this.hintsUsed++;
      this.marks[cell] = 'queen';
      this.announce(`Hint: ${this.describe(cell).toLowerCase()}`);
      this.audio.blip();
    }
    this.startClock();
    this.recomputeConflicts();
    this.redraw();
    this.checkWin();
  }

  // ---- the rules -----------------------------------------------------------

  private describe(cell: number): string {
    const n = this.puzzle!.n;
    return `Queen at row ${((cell / n) | 0) + 1}, column ${(cell % n) + 1}`;
  }

  /*
   * Every queen breaking a rule, so the board can point at the problem rather
   * than just refusing to be finished. Two queens clash if they share a row, a
   * column or a region, or if they touch at all -- including corners.
   */
  private recomputeConflicts(): void {
    const puzzle = this.puzzle;
    this.conflicts = new Set();
    if (!puzzle) return;
    const queens: number[] = [];
    this.marks.forEach((mark, cell) => { if (mark === 'queen') queens.push(cell); });
    const { n, regions } = puzzle;
    for (let i = 0; i < queens.length; i++) {
      for (let j = i + 1; j < queens.length; j++) {
        const a = queens[i]!;
        const b = queens[j]!;
        const ar = (a / n) | 0, ac = a % n, br = (b / n) | 0, bc = b % n;
        const touching = Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1;
        if (ar === br || ac === bc || regions[a] === regions[b] || touching) {
          this.conflicts.add(a);
          this.conflicts.add(b);
        }
      }
    }
  }

  private checkWin(): void {
    const puzzle = this.puzzle;
    if (!puzzle) return;
    if (this.marks.filter(m => m === 'queen').length !== puzzle.n) return;
    if (this.conflicts.size) return;
    this.finish();
  }

  private cycle(cell: number): void {
    if (this.phase !== 'playing' || this.solved || this.revealed || !this.puzzle) return;
    const current = this.marks[cell] ?? 'empty';
    const next: Mark = current === 'empty' ? 'blocked' : current === 'blocked' ? 'queen' : 'empty';
    if (current === 'queen') {
      this.backtracks++;                       // taking a queen back is the retraction
      this.announce('Queen removed');
    } else if (next === 'queen') {
      this.audio.number(this.marks.filter(m => m === 'queen').length);
      this.announce(this.describe(cell));
    }
    this.marks[cell] = next;
    this.startClock();
    this.recomputeConflicts();
    this.redraw();
    this.markDirty();
    this.checkWin();
  }

  testHooks() {
    const core = this;
    return mergeHooks(this.baseHooks(), {
      cycle: (cell: number) => core.cycle(cell),
      place: (cell: number) => {
        core.marks[cell] = 'queen';
        core.recomputeConflicts();
        core.redraw();
        core.markDirty();
        core.checkWin();
      },
      generate: generateDifficulty,
      load: (puzzle: QueensPuzzle) => core.load(puzzle),
      get state() {
        return {
          get puzzle() { return core.puzzle; },
          get marks() { return core.marks; },
          get conflicts() { return [...core.conflicts]; },
          get elapsed() { return core.elapsed; },
          get running() { return core.running; },
          get solved() { return core.solved; },
          get mode() { return core.mode; }
        };
      }
    });
  }
}

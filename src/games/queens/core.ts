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
import { rampColour } from '../../shell/ramp.ts';
import { ShellCore, mergeHooks, type GameProgress, type TierInfo } from '../../shell/core.ts';

/** Marks are stored as cell * 3 + code, so a run is a flat list of numbers. */
const CODE: Record<Exclude<Mark, 'empty'>, number> = { blocked: 1, queen: 2 };

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]
};

export class QueensCore extends ShellCore<QueensPuzzle> {
  readonly gameId = 'queens';
  readonly displayName = 'Queens';
  protected readonly dailyTier = 'hard';

  private readonly source = new QueensSource();
  private view: QueensBoard | null = null;
  private marks: Mark[] = [];
  private conflicts = new Set<number>();
  /* The order queens were placed in. Cell index alone cannot answer
   * "which was last", and both undo and the celebration need to know. */
  private order: number[] = [];
  /* A drag that began by crossing a square off keeps crossing. Tapping a whole
   * row out one square at a time is the slowest part of playing. */
  private painting = false;
  private lastPainted = -1;
  private paintedRun = 0;
  /* Where the keyboard is standing. -1 until an arrow key asks for a cursor,
   * so a player using the pointer is never shown one. */
  private cursor = -1;

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
    this.cursor = -1;
  }

  protected applyPuzzle(puzzle: QueensPuzzle, covered: boolean): void {
    this.view?.setPuzzle(puzzle, covered);
  }

  protected redraw(): void {
    this.view?.draw(this.marks, this.conflicts, this.solved);
    // The cursor belongs to a board being played: no board, no gate, no cursor.
    this.view?.showCursor(this.phase === 'playing' ? this.cursor : -1);
  }

  protected onFrame(now: number): void { this.view?.tick(now); }

  /* Queens' answer to Zip's sweep down the finished route: the board pops and
   * the crowns rise in the order they were placed, replaying the run. */
  protected onSolvedEffects(): void {
    this.view?.celebrate(this.order, this.marks);
  }

  /*
   * A queen that clashes is not progress: the board rings it in red, and a
   * meter that counted it anyway would advance on an illegal move and say the
   * opposite of what the board says. Only queens standing legally count.
   */
  protected progress(): GameProgress {
    const n = this.puzzle?.n ?? DIFFICULTIES[this.difficulty as DifficultyName]?.n ?? 8;
    let settled = 0;
    let clashing = 0;
    this.marks.forEach((mark, cell) => {
      if (mark !== 'queen') return;
      if (this.conflicts.has(cell)) clashing++;
      else settled++;
    });
    return {
      done: settled,
      total: n,
      unit: 'queens settled',
      goal: clashing
        ? `${clashing} queen${clashing === 1 ? '' : 's'} clash${clashing === 1 ? 'es' : ''}.`
        : `${Math.max(0, n - settled)} still to place.`,
      sizeLabel: `${n}×${n}`,
      progressColour: rampColour(settled / Math.max(1, n))
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
    this.order = [];
    for (const move of moves) {
      const cell = Math.floor(move / 3);
      this.marks[cell] = move % 3 === 1 ? 'blocked' : 'queen';
      if (move % 3 === 2) this.order.push(cell);
    }
    this.recomputeConflicts();
    return true;
  }

  /* Burst from the queen that finished the board -- where the eye already is,
   * not the topmost-leftmost one, which is nowhere in particular. */
  protected celebrationCell(): number | null {
    return this.order[this.order.length - 1] ?? null;
  }

  protected attachInput(boardSvg: SVGSVGElement): Array<() => void> {
    this.view = new QueensBoard(boardSvg);
    this.board = this.view;
    const down = (e: PointerEvent) => {
      this.audio.markInteracted();
      this.view!.invalidateRect();
      const cell = this.view!.cellAt(e.clientX, e.clientY);
      if (cell < 0) return;
      const before = this.marks[cell] ?? 'empty';
      this.cycle(cell);
      /*
       * Only a drag that started by crossing a square off paints. Starting on a
       * queen, or on the tap that promotes a cross to a queen, must not drag
       * queens across the board or wipe work already done.
       */
      this.painting = before === 'empty' && this.marks[cell] === 'blocked';
      this.lastPainted = cell;
      this.paintedRun = 0;
      if (this.painting) boardSvg.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const move = (e: PointerEvent) => {
      if (!this.painting) return;
      const cell = this.view!.cellAt(e.clientX, e.clientY);
      if (cell < 0 || cell === this.lastPainted) return;
      this.paintFrom(this.lastPainted, cell);
      this.lastPainted = cell;
      e.preventDefault();
    };

    const up = (e: PointerEvent) => {
      if (this.painting && this.paintedRun > 0) {
        this.announce(`${this.paintedRun} square${this.paintedRun === 1 ? '' : 's'} crossed off`);
      }
      this.painting = false;
      this.lastPainted = -1;
      if (boardSvg.hasPointerCapture(e.pointerId)) boardSvg.releasePointerCapture(e.pointerId);
    };

    const resize = () => this.view?.invalidateRect();
    // Region tints are baked hues, so the board has to be told to repaint them
    // when the theme changes -- everything else on it is a var() and repaints
    // itself.
    const unwatchTheme = this.view.watchTheme(() => this.redraw());
    boardSvg.addEventListener('pointerdown', down);
    boardSvg.addEventListener('pointermove', move);
    boardSvg.addEventListener('pointerup', up);
    boardSvg.addEventListener('pointercancel', up);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', resize, true);
    return [
      () => boardSvg.removeEventListener('pointerdown', down),
      () => boardSvg.removeEventListener('pointermove', move),
      () => boardSvg.removeEventListener('pointerup', up),
      () => boardSvg.removeEventListener('pointercancel', up),
      () => window.removeEventListener('resize', resize),
      () => window.removeEventListener('scroll', resize, true),
      unwatchTheme
    ];
  }

  /*
   * Cross off every empty square between two cells. Walking the line rather
   * than taking only the cell under the pointer means a fast flick along a row
   * cannot leave gaps behind it -- the pointer is sampled, the grid is not.
   */
  private paintFrom(from: number, to: number): void {
    if (this.phase !== 'playing' || this.solved || this.revealed || !this.puzzle) return;
    const n = this.puzzle.n;
    const r0 = Math.floor(from / n), c0 = from % n;
    const r1 = Math.floor(to / n), c1 = to % n;
    const steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0));
    let painted = 0;
    for (let i = 1; i <= steps; i++) {
      const row = Math.round(r0 + ((r1 - r0) * i) / steps);
      const col = Math.round(c0 + ((c1 - c0) * i) / steps);
      const cell = row * n + col;
      if (this.marks[cell] !== 'empty') continue;   // never over a queen or a cross
      this.marks[cell] = 'blocked';
      painted++;
    }
    if (!painted) return;
    this.paintedRun += painted;
    this.audio.step(this.order.length / Math.max(1, n));
    this.redraw();
    this.markDirty();
  }

  protected onRestart(): void {
    this.marks.fill('empty');
    this.conflicts = new Set();
    this.order = [];
    this.painting = false;
    this.lastPainted = -1;
  }

  /** Undo takes back the most recent queen; a cross is not worth undoing. */
  protected onUndo(): void {
    if (this.phase !== 'playing' || this.solved) return;
    const cell = this.order.pop();
    if (cell === undefined) return;
    this.marks[cell] = 'empty';
    this.backtracks++;
    this.recomputeConflicts();
    this.setBanner(null);
    this.redraw();
    this.markDirty();
  }

  protected onReveal(): void {
    const puzzle = this.puzzle!;
    this.marks.fill('empty');
    this.order = [];
    puzzle.solution.forEach((col, row) => {
      const cell = row * puzzle.n + col;
      this.marks[cell] = 'queen';
      this.order.push(cell);
    });
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
      this.order.push(cell);        // a hinted queen is still takeable back
      this.announce(`Hint: ${this.describe(cell).toLowerCase()}`);
      this.audio.blip();
    }
    this.startClock();
    this.recomputeConflicts();
    this.redraw();
    this.checkWin();
  }

  // ---- the keyboard ---------------------------------------------------------

  /*
   * Playing without a pointer. The arrows walk a cursor around the grid, space
   * or enter takes the square under it through the same cycle a tap does, and X
   * crosses it off. Everything is spoken, because the cursor is the one thing
   * on this board a screen reader cannot see.
   *
   * The shape of the guards is Zip's: claim the key, then hand it straight back
   * if the board does not own the keyboard, so a focused button keeps its own
   * arrows and its own space bar rather than having them stolen by the grid.
   */
  protected onKeyExtra(e: KeyboardEvent): boolean {
    const arrow = ARROWS[e.key];
    const cycles = e.key === ' ' || e.key === 'Enter';
    const crosses = e.key === 'x' || e.key === 'X';
    if (!arrow && !cycles && !crosses) return false;
    if (!this.ownsKeyboard()) return true;
    e.preventDefault();
    // Nothing to stand on before the reveal, and a cursor there would read out
    // a board the gate is still holding back.
    if (!this.puzzle || this.phase !== 'playing' || this.solved || this.revealed) return true;
    if (arrow) { this.moveCursor(arrow); return true; }
    const cell = this.cursorCell();
    if (cycles) this.keyCycle(cell);
    else this.keyCross(cell);
    return true;
  }

  /** The square the keyboard is on, summoning a cursor if there is not one. */
  private cursorCell(): number {
    if (this.cursor < 0) this.cursor = 0;
    return this.cursor;
  }

  private moveCursor([dr, dc]: [number, number]): void {
    const n = this.puzzle!.n;
    if (this.cursor < 0) {
      this.cursor = 0;                     // the first arrow only asks for a cursor
    } else {
      const row = Math.min(n - 1, Math.max(0, ((this.cursor / n) | 0) + dr));
      const col = Math.min(n - 1, Math.max(0, (this.cursor % n) + dc));
      this.cursor = row * n + col;
    }
    this.view?.showCursor(this.cursor);
    this.announce(this.describeCursor(this.cursor));
  }

  /*
   * What is under the cursor. The region matters as much as the row and column
   * here -- it is a rule of the game and the one thing on this board carried
   * only by colour -- so it is named, by its number, alongside them.
   */
  private describeCursor(cell: number): string {
    const { regions } = this.puzzle!;
    const mark = this.marks[cell] ?? 'empty';
    const state = mark === 'queen'
      ? (this.conflicts.has(cell) ? 'queen, clashing' : 'queen')
      : mark === 'blocked' ? 'crossed off' : 'empty';
    return `${this.where(cell)}, region ${regions[cell]! + 1}, ${state}`;
  }

  private where(cell: number): string {
    const n = this.puzzle!.n;
    return `Row ${((cell / n) | 0) + 1}, column ${(cell % n) + 1}`;
  }

  /*
   * Space and enter run the tap cycle, which speaks for itself when a queen
   * goes down or comes off. Crossing a square off is the quiet move it does not
   * announce -- silent is right for a tap you can see, wrong for a key press.
   */
  private keyCycle(cell: number): void {
    const before = this.marks[cell] ?? 'empty';
    this.cycle(cell);
    if (before === 'empty' && this.marks[cell] === 'blocked') {
      this.announce(`${this.where(cell)}, crossed off`);
    }
  }

  /** X crosses a square off, and takes the cross back off again. */
  private keyCross(cell: number): void {
    if (this.phase !== 'playing' || this.solved || this.revealed) return;
    const mark = this.marks[cell] ?? 'empty';
    if (mark === 'queen') {
      this.announce(`${this.where(cell)} holds a queen. Press space to take it back`);
      return;
    }
    if (mark === 'empty') {
      this.cycle(cell);                    // empty -> crossed off, with its click
      this.announce(`${this.where(cell)}, crossed off`);
      return;
    }
    this.marks[cell] = 'empty';
    this.startClock();
    this.audio.step(this.order.length / Math.max(1, this.puzzle!.n));
    this.announce(`${this.where(cell)}, cross removed`);
    this.redraw();
    this.markDirty();
  }

  // ---- the rules -----------------------------------------------------------

  private describe(cell: number): string {
    const n = this.puzzle!.n;
    return `Queen at row ${((cell / n) | 0) + 1}, column ${(cell % n) + 1}`;
  }

  /*
   * Why a queen cannot stay where it was just put. Without this the board says
   * "Queen at row 3, column 2" whether the move was sound or hopeless, and the
   * red ring that carries the news is the one thing a screen reader cannot see.
   * Must be called after recomputeConflicts, which is what it reads.
   */
  private clashNote(cell: number): string {
    if (!this.conflicts.has(cell) || !this.puzzle) return '';
    const { n, regions } = this.puzzle;
    const row = (cell / n) | 0;
    const col = cell % n;
    const against: Array<{ cell: number; why: string }> = [];
    this.marks.forEach((mark, other) => {
      if (mark !== 'queen' || other === cell) return;
      const orow = (other / n) | 0;
      const ocol = other % n;
      // Order matters: two queens on a row are touching as well, and the row is
      // the more useful thing to be told.
      const why = orow === row ? 'same row'
        : ocol === col ? 'same column'
        : regions[other] === regions[cell] ? 'same colour region'
        : Math.abs(orow - row) <= 1 && Math.abs(ocol - col) <= 1 ? 'touching'
        : '';
      if (why) against.push({ cell: other, why });
    });
    const first = against[0];
    if (!first) return '';
    const where = `row ${((first.cell / n) | 0) + 1}, column ${(first.cell % n) + 1}`;
    return against.length === 1
      ? `. Clashes with the queen at ${where} — ${first.why}`
      : `. Clashes with ${against.length} queens, including ${where} — ${first.why}`;
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
      this.order = this.order.filter(c => c !== cell);
    } else if (next === 'queen') {
      this.order.push(cell);
    }
    this.marks[cell] = next;
    this.startClock();
    this.recomputeConflicts();

    /*
     * Sound and speech only once the rules have been re-checked. Playing the
     * rising chime first rewarded a queen that broke the board exactly as
     * warmly as one that finished a region.
     */
    if (current === 'queen') {
      this.announce('Queen removed');
    } else if (next === 'queen') {
      if (this.conflicts.has(cell)) this.audio.clash();
      else this.audio.number(this.order.length);
      this.announce(this.describe(cell) + this.clashNote(cell));
    } else {
      // Crossing a square off is the fine-grained move, the way filling one is
      // in Zip -- so it gets the quiet click that 'sparse' turns off, not a chime.
      this.audio.step(this.order.length / Math.max(1, this.puzzle.n));
    }
    this.redraw();
    this.markDirty();
    this.checkWin();
  }

  testHooks() {
    const core = this;
    return mergeHooks(this.baseHooks(), {
      cycle: (cell: number) => core.cycle(cell),
      place: (cell: number) => {
        if (core.marks[cell] !== 'queen') core.order.push(cell);
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
          get order() { return [...core.order]; },
          get cursor() { return core.cursor; },
          get phase() { return core.phase; },
          get elapsed() { return core.elapsed; },
          get running() { return core.running; },
          get solved() { return core.solved; },
          get mode() { return core.mode; }
        };
      }
    });
  }
}

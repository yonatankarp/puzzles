/*
 * Comet: the rules, and nothing else.
 *
 * Timing, the reveal gate, the daily, streaks, saved runs, preferences and
 * publishing all live in ShellCore. What is left here is what makes this game
 * Comet rather than Zip or Queens.
 */
import {
  DIFFICULTIES, DIFFICULTY_ORDER, DIRS, generateDifficulty,
  type CometPuzzle, type DifficultyName
} from './engine.ts';
import { CometBoard } from './board.ts';
import { fingerprint } from './daily.ts';
import { CometSource } from './source.ts';
import { rampColour } from '../../shell/ramp.ts';
import { ShellCore, mergeHooks, type GameProgress, type TierInfo } from '../../shell/core.ts';

const ARROWS: Record<string, number> = {
  ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3
};

export class CometCore extends ShellCore<CometPuzzle> {
  readonly gameId = 'comet';
  readonly displayName = 'Comet';
  protected readonly dailyTier = 'hard';

  constructor() { super('comet', 'medium'); }

  private readonly source = new CometSource();
  private view: CometBoard | null = null;

  /** Head cell -> the cells that comet currently covers, head first. */
  private flights = new Map<number, number[]>();
  /** Squares covered by more than one comet, plus the heads that did it. */
  private clash = new Set<number>();
  /** The order comets were flown in: what undo takes back, newest last. */
  private order: number[] = [];
  private isHead = new Uint8Array(0);
  /** Where the keyboard is standing, or -1 until an arrow asks for a cursor. */
  private cursor = -1;
  private dragFrom = -1;
  /*
   * What a drag is currently showing, which is not the same as what has been
   * committed. Previewing by writing into `flights` meant the drag had already
   * overwritten the comet it started from, so flying one back out to where it
   * already was could never be recognised as taking it back.
   */
  private preview: { head: number; cells: number[] } | null = null;

  protected tiers(): TierInfo[] {
    return DIFFICULTY_ORDER.map(id => ({ id, label: DIFFICULTIES[id]!.label }));
  }
  protected tierLabel(id: string): string {
    return DIFFICULTIES[id as DifficultyName]?.label ?? id;
  }
  protected requestDaily(seed: number) { return this.source.requestDaily(seed); }
  protected requestTier(tier: string, seed: number) {
    return this.source.requestTier(tier as DifficultyName, seed);
  }
  protected fingerprint(puzzle: CometPuzzle) { return fingerprint(puzzle); }

  protected resetState(puzzle: CometPuzzle): void {
    this.flights = new Map();
    this.clash = new Set();
    this.order = [];
    this.cursor = -1;
    this.isHead = new Uint8Array(puzzle.n * puzzle.n);
    for (const clue of puzzle.clues) this.isHead[clue.cell] = 1;
  }

  protected applyPuzzle(puzzle: CometPuzzle, covered: boolean): void {
    if (covered) this.view?.setPuzzle(puzzle, true);
    else this.view?.uncover();
  }

  protected redraw(): void {
    if (!this.preview) { this.view?.draw(this.flights, this.clash, this.solved); return; }
    const shown = new Map(this.flights);
    shown.set(this.preview.head, this.preview.cells);
    this.view?.draw(shown, this.clashesOf(shown), this.solved);
  }

  protected progress(): GameProgress {
    const n = this.puzzle?.n ?? DIFFICULTIES[this.difficulty as DifficultyName]?.n ?? 6;
    const total = n * n;
    let covered = 0;
    for (const cells of this.flights.values()) covered += cells.length;
    // Squares under two comets are not progress, however much board they cover.
    const done = this.clash.size > 0 ? Math.max(0, covered - this.clash.size) : covered;
    const left = this.puzzle ? this.puzzle.clues.length - this.flights.size : 0;
    return {
      done,
      total,
      unit: 'squares covered',
      goal: this.clash.size > 0
        ? `${this.clash.size} square${this.clash.size === 1 ? '' : 's'} claimed twice.`
        : `${left} comet${left === 1 ? '' : 's'} still to fly.`,
      sizeLabel: `${n}×${n}`,
      progressColour: rampColour(done / Math.max(1, total))
    };
  }

  /** A flight is a head and the cell its tail ends on: two numbers each. */
  protected encodeMoves(): number[] {
    const moves: number[] = [];
    for (const head of this.order) {
      const cells = this.flights.get(head);
      if (cells) moves.push(head, cells[cells.length - 1]!);
    }
    return moves;
  }

  protected decodeMoves(moves: number[]): boolean {
    const puzzle = this.puzzle;
    if (!puzzle || moves.length % 2 !== 0) return false;
    const size = puzzle.n * puzzle.n;
    // Reject wholesale rather than replay half of something that does not fit.
    for (let i = 0; i < moves.length; i += 2) {
      const head = moves[i]!;
      const tip = moves[i + 1]!;
      if (!Number.isInteger(head) || !Number.isInteger(tip)) return false;
      if (head < 0 || tip < 0 || head >= size || tip >= size) return false;
      if (!this.isHead[head]) return false;
      if (!this.cellsBetween(head, tip)) return false;
    }
    for (let i = 0; i < moves.length; i += 2) {
      const cells = this.cellsBetween(moves[i]!, moves[i + 1]!)!;
      this.flights.set(moves[i]!, cells);
      this.order.push(moves[i]!);
    }
    this.recomputeClashes();
    return true;
  }

  protected celebrationCell(): number | null {
    return this.order[this.order.length - 1] ?? null;
  }

  /**
   * The straight run from a head to a tip, or null if that is not a legal
   * flight: off the grid, not in line, or through another head.
   */
  private cellsBetween(head: number, tip: number): number[] | null {
    const puzzle = this.puzzle;
    if (!puzzle) return null;
    const n = puzzle.n;
    const r0 = (head / n) | 0, c0 = head % n;
    const r1 = (tip / n) | 0, c1 = tip % n;
    if (r0 !== r1 && c0 !== c1) return null;
    const steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0));
    const dr = Math.sign(r1 - r0), dc = Math.sign(c1 - c0);
    const cells = [head];
    for (let k = 1; k <= steps; k++) {
      const cell = (r0 + dr * k) * n + (c0 + dc * k);
      if (this.isHead[cell]) return null;
      cells.push(cell);
    }
    const clue = puzzle.clues.find(c => c.cell === head);
    if (!clue) return null;
    // A given number is a promise about length; an unnumbered head is free.
    if (clue.len > 0 && cells.length !== clue.len) return null;
    return cells;
  }

  private clashesOf(flights: ReadonlyMap<number, readonly number[]>): Set<number> {
    const seen = new Map<number, number>();
    const clash = new Set<number>();
    for (const [head, cells] of flights) {
      for (const cell of cells) {
        if (seen.has(cell)) { clash.add(cell); clash.add(head); clash.add(seen.get(cell)!); }
        else seen.set(cell, head);
      }
    }
    return clash;
  }

  private recomputeClashes(): void {
    this.clash = this.clashesOf(this.flights);
  }

  /** Fly a comet from `head` out to `tip`, or take it back if it is a repeat. */
  private fly(head: number, tip: number): void {
    if (this.phase !== 'playing' || this.solved || this.revealed || !this.puzzle) return;
    const existing = this.flights.get(head);
    if (existing && existing[existing.length - 1] === tip && existing.length > 1) {
      this.retract(head, 'Comet taken back');
      return;
    }
    const cells = this.cellsBetween(head, tip);
    if (!cells) {
      const clue = this.puzzle.clues.find(c => c.cell === head);
      this.setBanner({
        text: clue && clue.len > 0 ? `That comet is ${clue.len} long` : 'A comet flies in a straight line',
        kind: 'bad'
      });
      return;
    }
    if (existing) this.order = this.order.filter(h => h !== head);
    this.flights.set(head, cells);
    this.order.push(head);
    this.startClock();
    this.recomputeClashes();
    this.audio.number(this.flights.size);
    this.announce(this.describe(head, cells));
    this.setBanner(null);
    this.redraw();
    this.markDirty();
    this.checkWin();
  }

  private retract(head: number, why: string): void {
    if (!this.flights.has(head)) return;
    this.flights.delete(head);
    this.order = this.order.filter(h => h !== head);
    this.backtracks++;
    this.recomputeClashes();
    this.announce(why);
    this.setBanner(null);
    this.redraw();
    this.markDirty();
  }

  private describe(head: number, cells: readonly number[]): string {
    const n = this.puzzle!.n;
    const row = ((head / n) | 0) + 1;
    const col = (head % n) + 1;
    if (cells.length === 1) return `Comet at row ${row}, column ${col}, length 1`;
    const tip = cells[cells.length - 1]!;
    const dir = ((tip / n) | 0) === row - 1 ? (tip % n > col - 1 ? 'right' : 'left')
      : ((tip / n) | 0) > row - 1 ? 'down' : 'up';
    const note = this.clash.has(head) ? ', crossing another comet' : '';
    return `Comet at row ${row}, column ${col}, ${cells.length} long, flying ${dir}${note}`;
  }

  protected onRestart(): void {
    this.flights = new Map();
    this.clash = new Set();
    this.order = [];
    this.cursor = -1;
    this.view?.showCursor(-1);
  }

  /** Undo takes back the comet flown most recently. */
  protected onUndo(): void {
    if (this.phase !== 'playing' || this.solved) return;
    const head = this.order[this.order.length - 1];
    if (head === undefined) return;
    this.retract(head, 'Comet taken back');
  }

  protected onHint(): void {
    const puzzle = this.puzzle;
    if (!puzzle || this.solved) return;
    // The first comet that is missing or wrong, in reading order.
    for (let i = 0; i < puzzle.clues.length; i++) {
      const head = puzzle.clues[i]!.cell;
      const want = puzzle.solution[i]!;
      const have = this.flights.get(head);
      if (have && have.length === want.length && have.every((c, k) => c === want[k])) continue;
      this.hintsUsed++;
      this.flights.set(head, want.slice());
      this.order = this.order.filter(h => h !== head);
      this.order.push(head);
      this.startClock();
      this.recomputeClashes();
      this.announce(`Hint: ${this.describe(head, want).toLowerCase()}`);
      this.audio.blip();
      this.redraw();
      this.markDirty();
      this.checkWin();
      return;
    }
  }

  protected onReveal(): void {
    const puzzle = this.puzzle!;
    this.flights = new Map();
    this.order = [];
    puzzle.clues.forEach((clue, i) => {
      this.flights.set(clue.cell, puzzle.solution[i]!.slice());
      this.order.push(clue.cell);
    });
    this.recomputeClashes();
    this.redraw();
  }

  protected clearBoardExtras(): void { this.view?.showCursor(-1); }

  /** Solved when every square is covered exactly once. */
  private checkWin(): void {
    const puzzle = this.puzzle;
    if (!puzzle || this.solved) return;
    if (this.clash.size > 0) return;
    let covered = 0;
    for (const cells of this.flights.values()) covered += cells.length;
    if (covered !== puzzle.n * puzzle.n) return;
    this.finish();
  }

  protected onKeyExtra(event: KeyboardEvent): boolean {
    if (this.phase !== 'playing' || this.solved || !this.puzzle) return false;
    const dir = ARROWS[event.key];
    const n = this.puzzle.n;

    if (event.key === ' ') {
      if (!this.ownsKeyboard()) return true;
      // Space steps between circles: they are the only places you can act, so a
      // cursor that walked empty squares would mostly walk past nothing.
      const heads = this.puzzle.clues.map(c => c.cell).sort((a, b) => a - b);
      const at = heads.indexOf(this.cursor);
      this.cursor = heads[(at + 1) % heads.length] ?? heads[0]!;
      this.view?.showCursor(this.cursor);
      this.announce(this.headSummary(this.cursor));
      this.markDirty();
      return true;
    }

    if (event.key === 'Enter') {
      if (!this.ownsKeyboard()) return true;
      /*
       * A comet of one square has no direction, so no arrow can ask for it.
       * Without this the keyboard could not finish a board that has one --
       * and most boards have one.
       */
      if (this.cursor >= 0 && this.isHead[this.cursor]) this.fly(this.cursor, this.cursor);
      return true;
    }

    if (dir === undefined) return false;
    if (!this.ownsKeyboard()) return true;

    if (this.cursor < 0 || !this.isHead[this.cursor]) {
      // The first arrow summons the cursor rather than moving one that is not there.
      this.cursor = this.puzzle.clues[0]!.cell;
      this.view?.showCursor(this.cursor);
      this.announce(this.headSummary(this.cursor));
      this.markDirty();
      return true;
    }

    /*
     * An arrow on a head flies it that way. The length is the given number, or
     * -- for an unnumbered head -- one square further than it currently reaches,
     * so repeated presses grow the tail the way dragging does.
     */
    const clue = this.puzzle.clues.find(c => c.cell === this.cursor)!;
    const current = this.flights.get(this.cursor);
    const [dr, dc] = DIRS[dir]!;
    let want = clue.len > 0 ? clue.len : 2;
    if (clue.len === 0 && current && current.length > 1) {
      const tip = current[current.length - 1]!;
      const sameWay = Math.sign(((tip / n) | 0) - ((this.cursor / n) | 0)) === dr &&
        Math.sign((tip % n) - (this.cursor % n)) === dc;
      want = sameWay ? current.length + 1 : 2;
    }
    const r = ((this.cursor / n) | 0) + dr * (want - 1);
    const c = (this.cursor % n) + dc * (want - 1);
    if (r < 0 || c < 0 || r >= n || c >= n) {
      this.setBanner({ text: 'That comet would leave the board', kind: 'bad' });
      return true;
    }
    this.fly(this.cursor, r * n + c);
    return true;
  }

  private headSummary(cell: number): string {
    const n = this.puzzle!.n;
    const clue = this.puzzle!.clues.find(c => c.cell === cell)!;
    const length = clue.len > 0 ? `${clue.len} long` : 'length not given';
    const flown = this.flights.has(cell) ? ', flown' : '';
    return `Head at row ${((cell / n) | 0) + 1}, column ${(cell % n) + 1}, ${length}${flown}`;
  }

  protected attachInput(boardSvg: SVGSVGElement): Array<() => void> {
    this.view = new CometBoard(boardSvg);
    this.board = this.view;

    const down = (e: PointerEvent) => {
      this.audio.markInteracted();
      this.view!.invalidateRect();
      const cell = this.view!.cellAt(e.clientX, e.clientY);
      if (cell < 0) return;
      if (this.isHead[cell]) {
        // Dragging from a head aims its tail; a tap that goes nowhere is
        // handled on release, where a length-1 comet is the sensible reading.
        this.dragFrom = cell;
        this.cursor = cell;
        this.view!.showCursor(-1);
        try { boardSvg.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      } else if (this.phase === 'playing') {
        this.setBanner({ text: 'Start a comet from one of the circles', kind: 'wait' });
      }
      e.preventDefault();
    };

    const move = (e: PointerEvent) => {
      if (this.dragFrom < 0) return;
      const cell = this.view!.cellAt(e.clientX, e.clientY);
      if (cell < 0) return;
      const cells = this.cellsBetween(this.dragFrom, cell);
      if (!cells) return;
      // Shown, not committed: the tail follows the finger and nothing is
      // decided until it lifts.
      this.preview = { head: this.dragFrom, cells };
      this.redraw();
      e.preventDefault();
    };

    const up = (e: PointerEvent) => {
      if (this.dragFrom < 0) return;
      const head = this.dragFrom;
      this.dragFrom = -1;
      if (boardSvg.hasPointerCapture(e.pointerId)) boardSvg.releasePointerCapture(e.pointerId);
      const cell = this.view!.cellAt(e.clientX, e.clientY);
      this.preview = null;
      // A tap on the head is a comet of one square, which is a real answer.
      this.fly(head, cell < 0 || this.cellsBetween(head, cell) === null ? head : cell);
    };

    const resize = () => this.view?.invalidateRect();
    const retint = () => this.redraw();
    const stopWatching = this.view.watchTheme(retint);

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
      stopWatching
    ];
  }

  testHooks() {
    const core = this;
    return mergeHooks(this.baseHooks(), {
      fly: (head: number, tip: number) => core.fly(head, tip),
      generate: (tier: string, seed?: number) => generateDifficulty(tier, seed),
      load: (puzzle: CometPuzzle) => core.load(puzzle),
      get state() {
        return {
          get puzzle() { return core.puzzle; },
          get flights() { return [...core.flights].map(([h, cells]) => [h, cells.slice()]); },
          get clash() { return [...core.clash]; },
          get order() { return [...core.order]; },
          get cursor() { return core.cursor; },
          get elapsed() { return core.elapsed; },
          get running() { return core.running; },
          get solved() { return core.solved; },
          get mode() { return core.mode; },
          get phase() { return core.phase; }
        };
      }
    });
  }
}

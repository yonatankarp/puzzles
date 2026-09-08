/*
 * Patch: the rules, and nothing else.
 *
 * Timing, the reveal gate, the daily, streaks, saved runs, preferences and
 * publishing all live in ShellCore.
 */
import {
  DIFFICULTIES, DIFFICULTY_ORDER, cellsOf, generateDifficulty, sameRect,
  type DifficultyName, type PatchPuzzle, type Rect
} from './engine.ts';
import { PatchBoard } from './board.ts';
import { fingerprint } from './daily.ts';
import { PatchSource } from './source.ts';
import { rampColour } from '../../shell/ramp.ts';
import { ShellCore, mergeHooks, type GameProgress, type TierInfo } from '../../shell/core.ts';

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]
};

export class PatchCore extends ShellCore<PatchPuzzle> {
  readonly gameId = 'patch';
  readonly displayName = 'Patch';
  protected readonly dailyTier = 'hard';

  constructor() { super('patch', 'medium'); }

  private readonly source = new PatchSource();
  private view: PatchBoard | null = null;

  /** A number's cell -> the rectangle drawn round it. */
  private drawn = new Map<number, Rect>();
  /** The order they were drawn in: what undo takes back, newest last. */
  private order: number[] = [];
  private numbered = new Set<number>();
  private areaOf = new Map<number, number>();

  private anchor = -1;
  private cursor = -1;
  private preview: Rect | null = null;

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
  protected fingerprint(puzzle: PatchPuzzle) { return fingerprint(puzzle); }

  protected resetState(puzzle: PatchPuzzle): void {
    this.drawn = new Map();
    this.order = [];
    this.anchor = -1;
    this.cursor = -1;
    this.preview = null;
    this.numbered = new Set(puzzle.clues.map(c => c.cell));
    this.areaOf = new Map(puzzle.clues.map(c => [c.cell, c.area]));
  }

  protected applyPuzzle(puzzle: PatchPuzzle, covered: boolean): void {
    if (covered) this.view?.setPuzzle(puzzle, true);
    else this.view?.uncover();
  }

  protected redraw(): void {
    this.view?.draw(this.drawn, this.preview, this.solved);
  }

  protected progress(): GameProgress {
    const n = this.puzzle?.n ?? DIFFICULTIES[this.difficulty as DifficultyName]?.n ?? 6;
    const total = n * n;
    let done = 0;
    for (const rect of this.drawn.values()) done += rect.h * rect.w;
    const left = this.puzzle ? this.puzzle.clues.length - this.drawn.size : 0;
    return {
      done,
      total,
      unit: 'squares covered',
      goal: `${left} number${left === 1 ? '' : 's'} still to box in.`,
      sizeLabel: `${n}×${n}`,
      progressColour: rampColour(done / Math.max(1, total))
    };
  }

  /** Each patch is its number's cell and its top-left corner: two numbers. */
  protected encodeMoves(): number[] {
    const n = this.puzzle?.n ?? 0;
    const moves: number[] = [];
    for (const cell of this.order) {
      const rect = this.drawn.get(cell);
      if (rect) moves.push(cell, rect.r0 * n + rect.c0);
    }
    return moves;
  }

  protected decodeMoves(moves: number[]): boolean {
    const puzzle = this.puzzle;
    if (!puzzle || moves.length % 2 !== 0) return false;
    const rects: Array<[number, Rect]> = [];
    // Reject wholesale rather than replay half of something that does not fit.
    for (let i = 0; i < moves.length; i += 2) {
      const cell = moves[i]!;
      const corner = moves[i + 1]!;
      if (!Number.isInteger(cell) || !Number.isInteger(corner)) return false;
      if (!this.numbered.has(cell)) return false;
      const area = this.areaOf.get(cell)!;
      const rect = this.rectFromCorner(corner, cell, area);
      if (!rect) return false;
      rects.push([cell, rect]);
    }
    for (const [cell, rect] of rects) { this.drawn.set(cell, rect); this.order.push(cell); }
    return true;
  }

  /** The one rectangle of the right area with this corner that holds this number. */
  private rectFromCorner(corner: number, cell: number, area: number): Rect | null {
    const n = this.puzzle!.n;
    const r0 = (corner / n) | 0, c0 = corner % n;
    const r = (cell / n) | 0, c = cell % n;
    for (let h = 1; h <= area; h++) {
      if (area % h) continue;
      const w = area / h;
      if (r0 + h > n || c0 + w > n) continue;
      if (r < r0 || r >= r0 + h || c < c0 || c >= c0 + w) continue;
      const rect = { r0, c0, h, w };
      if (this.legal(rect, cell)) return rect;
    }
    return null;
  }

  protected celebrationCell(): number | null {
    return this.order[this.order.length - 1] ?? null;
  }

  /** Rule 1 and rule 2, together: one number inside, and the size it says. */
  private legal(rect: Rect, cell: number): boolean {
    const n = this.puzzle!.n;
    if (rect.r0 < 0 || rect.c0 < 0 || rect.r0 + rect.h > n || rect.c0 + rect.w > n) return false;
    if (rect.h * rect.w !== this.areaOf.get(cell)) return false;
    const cells = cellsOf(n, rect);
    if (!cells.includes(cell)) return false;
    return !cells.some(x => x !== cell && this.numbered.has(x));
  }

  private rectBetween(a: number, b: number): Rect {
    const n = this.puzzle!.n;
    const r0 = Math.min((a / n) | 0, (b / n) | 0);
    const r1 = Math.max((a / n) | 0, (b / n) | 0);
    const c0 = Math.min(a % n, b % n);
    const c1 = Math.max(a % n, b % n);
    return { r0, c0, h: r1 - r0 + 1, w: c1 - c0 + 1 };
  }

  /** The numbers inside a rectangle, so a refusal can say which rule it broke. */
  private numbersIn(rect: Rect): number[] {
    return cellsOf(this.puzzle!.n, rect).filter(x => this.numbered.has(x));
  }

  private commit(rect: Rect): void {
    if (this.phase !== 'playing' || this.solved || this.revealed || !this.puzzle) return;
    const inside = this.numbersIn(rect);
    const size = rect.h * rect.w;

    if (inside.length === 0) {
      this.setBanner({ text: 'Every patch needs a number in it', kind: 'bad' });
      return;
    }
    if (inside.length > 1) {
      this.setBanner({ text: `That patch holds ${inside.length} numbers`, kind: 'bad' });
      return;
    }
    const cell = inside[0]!;
    const want = this.areaOf.get(cell)!;
    if (size !== want) {
      this.setBanner({ text: `${size} square${size === 1 ? '' : 's'}, and that number wants ${want}`, kind: 'bad' });
      return;
    }

    /*
     * Drawing a box that is already there changes nothing. Making it toggle off
     * would mean the same gesture sometimes builds and sometimes destroys, with
     * only the board state to tell you which -- taking a patch back is a tap.
     */
    const existing = this.drawn.get(cell);
    if (existing && sameRect(existing, rect)) { this.setBanner(null); return; }

    /*
     * Drawing over patches clears them. Making someone undo before they can
     * correct themselves is the kind of friction that turns a quick game into
     * a chore, and rule 3 says they cannot overlap anyway.
     */
    const cells = new Set(cellsOf(this.puzzle.n, rect));
    for (const [other, otherRect] of [...this.drawn]) {
      if (other === cell) continue;
      if (cellsOf(this.puzzle.n, otherRect).some(x => cells.has(x))) {
        this.drawn.delete(other);
        this.order = this.order.filter(o => o !== other);
      }
    }

    this.drawn.set(cell, rect);
    this.order = this.order.filter(o => o !== cell);
    this.order.push(cell);
    this.startClock();
    this.audio.number(this.drawn.size);
    this.announce(this.describe(cell, rect));
    this.setBanner(null);
    this.redraw();
    this.markDirty();
    this.checkWin();
  }

  private remove(cell: number): void {
    if (!this.drawn.has(cell)) return;
    this.drawn.delete(cell);
    this.order = this.order.filter(o => o !== cell);
    this.backtracks++;
    this.announce('Patch taken back');
    this.setBanner(null);
    this.redraw();
    this.markDirty();
  }

  private describe(cell: number, rect: Rect): string {
    const n = this.puzzle!.n;
    const shape = rect.h === 1 && rect.w === 1 ? 'one square'
      : `${rect.h} by ${rect.w}`;
    return `${this.areaOf.get(cell)} boxed in at row ${((cell / n) | 0) + 1}, ` +
      `column ${(cell % n) + 1}: ${shape}`;
  }

  protected onRestart(): void {
    this.drawn = new Map();
    this.order = [];
    this.anchor = -1;
    this.preview = null;
    this.cursor = -1;
    this.view?.showCursor(-1);
  }

  protected onUndo(): void {
    if (this.phase !== 'playing' || this.solved) return;
    const cell = this.order[this.order.length - 1];
    if (cell === undefined) return;
    this.remove(cell);
  }

  protected onHint(): void {
    const puzzle = this.puzzle;
    if (!puzzle || this.solved) return;
    for (let i = 0; i < puzzle.clues.length; i++) {
      const cell = puzzle.clues[i]!.cell;
      const want = puzzle.solution[i]!;
      const have = this.drawn.get(cell);
      if (have && sameRect(have, want)) continue;
      this.hintsUsed++;
      const cells = new Set(cellsOf(puzzle.n, want));
      for (const [other, rect] of [...this.drawn]) {
        if (other !== cell && cellsOf(puzzle.n, rect).some(x => cells.has(x))) {
          this.drawn.delete(other);
          this.order = this.order.filter(o => o !== other);
        }
      }
      this.drawn.set(cell, want);
      this.order = this.order.filter(o => o !== cell);
      this.order.push(cell);
      this.startClock();
      this.announce(`Hint: ${this.describe(cell, want).toLowerCase()}`);
      this.audio.blip();
      this.redraw();
      this.markDirty();
      this.checkWin();
      return;
    }
  }

  protected onReveal(): void {
    const puzzle = this.puzzle!;
    this.drawn = new Map();
    this.order = [];
    puzzle.clues.forEach((clue, i) => {
      this.drawn.set(clue.cell, puzzle.solution[i]!);
      this.order.push(clue.cell);
    });
    this.redraw();
  }

  protected clearBoardExtras(): void {
    this.view?.showCursor(-1);
    this.preview = null;
  }

  /** Solved when every square is under a patch. Sizes are enforced on the way in. */
  private checkWin(): void {
    const puzzle = this.puzzle;
    if (!puzzle || this.solved) return;
    let covered = 0;
    for (const rect of this.drawn.values()) covered += rect.h * rect.w;
    if (covered !== puzzle.n * puzzle.n) return;
    this.finish();
  }

  protected onKeyExtra(event: KeyboardEvent): boolean {
    if (this.phase !== 'playing' || this.solved || !this.puzzle) return false;
    const n = this.puzzle.n;

    if (event.key === 'Escape' && this.anchor >= 0) {
      if (!this.ownsKeyboard()) return true;
      this.anchor = -1;
      this.preview = null;
      this.announce('Patch cancelled');
      this.redraw();
      return true;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      if (!this.ownsKeyboard()) return true;
      if (this.cursor < 0) {
        this.cursor = 0;
        this.view?.showCursor(this.cursor);
        this.announce(this.whereAmI());
        return true;
      }
      if (this.anchor < 0) {
        // First press pins one corner; the arrows then stretch the box.
        this.anchor = this.cursor;
        this.preview = this.rectBetween(this.anchor, this.cursor);
        this.announce('Corner set — use the arrows, then press enter again');
        this.redraw();
        return true;
      }
      const rect = this.rectBetween(this.anchor, this.cursor);
      this.anchor = -1;
      this.preview = null;
      this.commit(rect);
      this.redraw();
      return true;
    }

    const step = ARROWS[event.key];
    if (!step) return false;
    if (!this.ownsKeyboard()) return true;
    if (this.cursor < 0) {
      this.cursor = 0;
    } else {
      const r = Math.min(n - 1, Math.max(0, ((this.cursor / n) | 0) + step[0]));
      const c = Math.min(n - 1, Math.max(0, (this.cursor % n) + step[1]));
      this.cursor = r * n + c;
    }
    this.view?.showCursor(this.cursor);
    if (this.anchor >= 0) this.preview = this.rectBetween(this.anchor, this.cursor);
    this.announce(this.whereAmI());
    this.redraw();
    return true;
  }

  private whereAmI(): string {
    const n = this.puzzle!.n;
    const row = ((this.cursor / n) | 0) + 1;
    const col = (this.cursor % n) + 1;
    const number = this.areaOf.get(this.cursor);
    const here = number ? `, the number ${number}` : '';
    if (this.anchor >= 0 && this.preview) {
      return `Row ${row}, column ${col}${here}. Patch ${this.preview.h} by ${this.preview.w}`;
    }
    return `Row ${row}, column ${col}${here}`;
  }

  protected attachInput(boardSvg: SVGSVGElement): Array<() => void> {
    this.view = new PatchBoard(boardSvg);
    this.board = this.view;
    let from = -1;

    const down = (e: PointerEvent) => {
      this.audio.markInteracted();
      this.view!.invalidateRect();
      const cell = this.view!.cellAt(e.clientX, e.clientY);
      if (cell < 0) return;
      from = cell;
      this.preview = this.rectBetween(cell, cell);
      this.redraw();
      try { boardSvg.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      e.preventDefault();
    };

    const move = (e: PointerEvent) => {
      if (from < 0) return;
      const cell = this.view!.cellAt(e.clientX, e.clientY);
      if (cell < 0) return;
      this.preview = this.rectBetween(from, cell);
      this.redraw();
      e.preventDefault();
    };

    const up = (e: PointerEvent) => {
      if (from < 0) return;
      const start = from;
      from = -1;
      if (boardSvg.hasPointerCapture(e.pointerId)) boardSvg.releasePointerCapture(e.pointerId);
      const cell = this.view!.cellAt(e.clientX, e.clientY);
      this.preview = null;
      const rect = this.rectBetween(start, cell < 0 ? start : cell);
      // A tap inside a finished patch takes it back: the quickest correction there is.
      if (rect.h === 1 && rect.w === 1) {
        for (const [owner, drawnRect] of this.drawn) {
          if (cellsOf(this.puzzle!.n, drawnRect).includes(start)) {
            this.remove(owner);
            this.redraw();
            return;
          }
        }
      }
      this.commit(rect);
      this.redraw();
    };

    const resize = () => this.view?.invalidateRect();
    const stopWatching = this.view.watchTheme(() => this.redraw());

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
      box: (a: number, b: number) => { core.commit(core.rectBetween(a, b)); core.redraw(); },
      generate: (tier: string, seed?: number) => generateDifficulty(tier, seed),
      load: (puzzle: PatchPuzzle) => core.load(puzzle),
      get state() {
        return {
          get puzzle() { return core.puzzle; },
          get drawn() { return [...core.drawn].map(([cell, r]) => [cell, { ...r }]); },
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

/*
 * Zip: the rules, and nothing else.
 *
 * Timing, the reveal gate, the daily, streaks, saved runs, preferences and
 * publishing all live in ShellCore. What is left here is drawing the line.
 */
import {
  DIFFICULTIES, DIFFICULTY_ORDER, generateDifficulty, makeEngine,
  type Cell, type DifficultyName, type Engine, type Puzzle
} from './engine.ts';
import { BoardView, U, rampColour, type NumberState, type Tip } from './board.ts';
import { fingerprint } from './daily.ts';
import { PuzzleSource } from './source.ts';
import { ShellCore, mergeHooks, type GameProgress, type TierInfo } from '../../shell/core.ts';

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]
};

export class GameCore extends ShellCore<Puzzle> {
  readonly gameId = 'zip';
  readonly displayName = 'Zip';
  protected readonly dailyTier = 'medium';

  private readonly source = new PuzzleSource();
  private view: BoardView | null = null;
  private engine: Engine | null = null;
  private path: Cell[] = [];
  private inPath = new Uint8Array(0);
  private drag = {
    active: false,
    at: null as { x: number; y: number } | null,
    tip: null as Tip | null,
    settle: null as Tip | null
  };

  constructor() { super('zip', 'medium'); }

  // ---- what the shell asks for -------------------------------------------

  protected tiers(): TierInfo[] {
    return DIFFICULTY_ORDER.map(id => ({ id, label: DIFFICULTIES[id].label }));
  }
  protected tierLabel(id: string): string {
    return DIFFICULTIES[id as DifficultyName]?.label ?? id;
  }
  protected requestDaily(seed: number) { return this.source.requestDaily(seed); }
  protected requestTier(tier: string, seed: number) { return this.source.requestTier(tier as DifficultyName, seed); }
  protected fingerprint(puzzle: Puzzle) { return fingerprint(puzzle); }

  protected resetState(puzzle: Puzzle): void {
    this.engine = makeEngine(puzzle);
    this.path = [];
    this.inPath = new Uint8Array(puzzle.rows * puzzle.cols);
    this.drag = { active: false, at: null, tip: null, settle: null };
  }

  protected applyPuzzle(puzzle: Puzzle, covered: boolean): void {
    this.view?.setPuzzle(puzzle, covered);
  }

  protected redraw(): void {
    this.renderTrail();
    if (!this.puzzle || !this.engine) return;
    const total = this.puzzle.rows * this.puzzle.cols;
    const last = Math.max(1, total - 1);
    const flat = this.flatColour();
    const taken = this.numbersTaken();
    const live = !this.solved && !this.revealed;
    const states: NumberState[] = this.puzzle.waypoints.map((cell, index) => {
      const at = this.inPath[cell] ? this.path.indexOf(cell) : -1;
      return {
        fill: at >= 0 ? (flat ?? rampColour(at / last)) : 'var(--accent)',
        ink: at >= 0 ? 'var(--path-ink)' : 'var(--accent-ink)',
        next: live && index === taken
      };
    });
    this.view?.drawNumbers(states, rampColour(this.path.length / last));
  }

  protected progress(): GameProgress {
    const preset = DIFFICULTIES[this.difficulty as DifficultyName] ?? DIFFICULTIES.medium;
    const rows = this.puzzle?.rows ?? preset.rows;
    const cols = this.puzzle?.cols ?? preset.cols;
    const total = rows * cols;
    const next = Math.min(this.numbersTaken() + 1, this.puzzle?.waypoints.length ?? 1);
    return {
      done: this.path.length,
      total,
      unit: 'squares filled',
      goal: `Heading for number ${next}.`,
      sizeLabel: `${rows}×${cols}`,
      progressColour: rampColour(this.path.length / Math.max(1, total - 1))
    };
  }

  protected encodeMoves(): number[] { return this.path.slice(); }

  /** Replay a saved line, checking every step against the rules as it goes. */
  protected decodeMoves(moves: number[]): boolean {
    const engine = this.engine;
    if (!engine) return false;
    const path: Cell[] = [];
    const inPath = new Uint8Array(this.inPath.length);
    for (const cell of moves) {
      if (!engine.canStep(path, inPath, cell)) return false;
      path.push(cell);
      inPath[cell] = 1;
    }
    if (!path.length) return false;
    this.path = path;
    this.inPath = inPath;
    return true;
  }

  protected celebrationCell(): Cell | null {
    return this.path.length ? this.path[this.path.length - 1]! : null;
  }

  protected onRestart(): void {
    this.path = [];
    this.inPath.fill(0);
    this.drag.tip = null;
    this.drag.settle = null;
  }

  protected onUndo(): void { this.pop(); }

  protected onReveal(): void {
    this.path = this.puzzle!.solution.slice();
    this.inPath.fill(1);
  }

  protected clearBoardExtras(): void { this.view?.clearHint(); }

  /** A bright dash runs the finished route, and the board gives a small pop. */
  protected onSolvedEffects(): void {
    this.view?.startSweep(this.path.length);
    this.view?.pop();
  }

  protected onFrame(now: number): void {
    if (this.drag.settle) {                    // ease the tip back rather than snap
      this.drag.settle.amount *= 0.6;
      if (this.drag.settle.amount < 0.8) this.drag.settle = null;
      this.renderTrail();
    }
    this.view?.tick(now);
  }

  protected onKeyExtra(e: KeyboardEvent): boolean {
    const arrow = ARROWS[e.key];
    if (!arrow) return false;
    // Claiming the arrows unconditionally stopped the page scrolling and
    // hijacked them from focused controls.
    if (!this.ownsKeyboard()) return true;
    e.preventDefault();
    if (!this.puzzle) return true;
    if (!this.path.length) { this.step(this.puzzle.waypoints[0]!); return true; }
    const head = this.path[this.path.length - 1]!;
    const row = ((head / this.puzzle.cols) | 0) + arrow[0];
    const col = (head % this.puzzle.cols) + arrow[1];
    if (row < 0 || col < 0 || row >= this.puzzle.rows || col >= this.puzzle.cols) return true;
    this.step(row * this.puzzle.cols + col);
    return true;
  }

  /*
   * Because each puzzle has exactly one solution, any path that can still be
   * finished must be a prefix of it -- so one check answers both "what is the
   * next move" and "is this position already lost".
   */
  protected onHint(): void {
    if (!this.puzzle || this.solved || this.revealed || this.phase !== 'playing') return;
    const solution = this.puzzle.solution;
    const salvageable = this.path.length <= solution.length
      && this.path.every((cell, i) => cell === solution[i]);
    if (!salvageable) {
      this.restart();
      this.setBanner({ text: 'Off track — back to the start', kind: 'bad' }, 1500);
    }
    const from = this.path.length ? this.path[this.path.length - 1]! : solution[0]!;
    const to = this.path.length ? solution[this.path.length] : solution[1];
    if (to == null) return;
    this.hintsUsed++;
    this.view?.showHint(from, to);
    this.announce(`Hint: go to ${this.describe(to).toLowerCase()}`);
    this.audio.blip();
    this.markDirty();
  }

  // ---- input ----------------------------------------------------------------

  protected attachInput(boardSvg: SVGSVGElement): Array<() => void> {
    this.view = new BoardView(boardSvg);
    this.board = this.view;

    const down = (e: PointerEvent) => {
      this.audio.markInteracted();
      this.view!.invalidateRect();
      const point = this.view!.toBoard(e.clientX, e.clientY);
      if (!point) return;
      const cell = this.view!.cellAtBoard(point);
      if (cell < 0) return;
      this.drag = { active: true, at: point, tip: null, settle: null };
      boardSvg.setPointerCapture(e.pointerId);
      this.step(cell);
      this.drag.tip = this.tipFor(point);
      this.renderTrail();
      e.preventDefault();
    };

    const move = (e: PointerEvent) => {
      if (!this.drag.active) return;
      const point = this.view!.toBoard(e.clientX, e.clientY);
      if (!point) return;
      // Walk the segment travelled since the last event rather than sampling
      // only its endpoint, so a fast drag cannot jump a cell and stall.
      const from = this.drag.at ?? point;
      const span = Math.hypot(point.x - from.x, point.y - from.y);
      const samples = Math.min(32, Math.max(1, Math.ceil(span / (U * 0.34))));
      for (let i = 1; i <= samples; i++) {
        const cell = this.view!.cellAtBoard({
          x: from.x + (point.x - from.x) * i / samples,
          y: from.y + (point.y - from.y) * i / samples
        });
        if (cell >= 0) this.step(cell);
      }
      this.drag.at = point;
      this.drag.tip = this.tipFor(point);
      this.renderTrail();
    };

    const up = (e: PointerEvent) => {
      if (!this.drag.active) return;
      this.drag.active = false;
      this.drag.settle = this.drag.tip;        // let the tip ease home
      this.drag.tip = null;
      this.drag.at = null;
      if (e.pointerId != null && boardSvg.hasPointerCapture(e.pointerId)) {
        boardSvg.releasePointerCapture(e.pointerId);
      }
    };

    const resize = () => this.view?.invalidateRect();
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
      () => window.removeEventListener('scroll', resize, true)
    ];
  }

  // ---- the rules -------------------------------------------------------------

  private flatColour(): string | null {
    if (this.solved) return 'var(--good)';
    if (this.revealed) return 'var(--dim)';
    return null;
  }

  private numbersTaken(): number {
    if (!this.engine) return 0;
    let count = 0;
    for (const cell of this.path) if (this.engine.numAt[cell] !== 0) count++;
    return count;
  }

  private describe(cell: Cell): string {
    const cols = this.puzzle!.cols;
    const where = `Row ${((cell / cols) | 0) + 1}, column ${(cell % cols) + 1}`;
    const number = this.engine!.numAt[cell]!;
    return number ? `${where}, number ${number} of ${this.puzzle!.waypoints.length}` : where;
  }

  private renderTrail(): void {
    this.view?.drawTrail(this.path, this.drag.tip ?? this.drag.settle, this.flatColour());
  }

  /*
   * How far the line reaches past the last committed square. Half a square is
   * the ceiling: at exactly half, the pointer has crossed into the next one and
   * that step commits, so the handover is seamless in both directions.
   */
  private tipFor(point: { x: number; y: number }): Tip | null {
    if (!this.path.length || this.solved || this.revealed || !this.view || !this.engine) return null;
    const puzzle = this.puzzle!;
    const head = this.path[this.path.length - 1]!;
    const dx = point.x - this.view.cx(head);
    const dy = point.y - this.view.cy(head);
    let ux = 0;
    let uy = 0;
    let reach: number;
    if (Math.abs(dx) >= Math.abs(dy)) { ux = dx < 0 ? -1 : 1; reach = Math.abs(dx); }
    else { uy = dy < 0 ? -1 : 1; reach = Math.abs(dy); }
    if (reach < 1) return null;

    const col = (head % puzzle.cols) + ux;
    const row = ((head / puzzle.cols) | 0) + uy;
    if (col < 0 || row < 0 || col >= puzzle.cols || row >= puzzle.rows) return null;
    const neighbour = row * puzzle.cols + col;
    const retract = this.path.length > 1 && neighbour === this.path[this.path.length - 2];
    // A blocked direction still gives a little, so pushing at a wall feels like
    // resistance rather than a dead control.
    const limit = retract || this.engine.canStep(this.path, this.inPath, neighbour)
      ? U / 2
      : U * 0.13;
    return { ux, uy, amount: Math.min(reach, limit), retract };
  }

  private push(cell: Cell): void {
    this.path.push(cell);
    this.inPath[cell] = 1;
    this.view?.clearHint();
    const number = this.engine!.numAt[cell]!;
    if (number) {
      this.audio.number(number - 1);
      this.view?.popNumber(number - 1);
    } else {
      this.audio.step(this.path.length / this.engine!.n);
    }
    this.announce(this.describe(cell));
    this.startClock();
    this.redraw();
    this.markDirty();
    this.checkWin();
  }

  private pop(): void {
    if (this.path.length <= 1) return;
    const removed = this.path.pop()!;
    this.inPath[removed] = 0;
    this.backtracks++;
    this.announce(`Backed out of ${this.describe(removed).toLowerCase()}`);
    this.solved = false;
    this.view?.clearHint();
    this.setBanner(null);
    this.redraw();
    this.markDirty();
  }

  private step(cell: Cell): void {
    if (this.phase !== 'playing') return;      // nothing to draw on yet
    if (this.solved || this.revealed || !this.engine) return;
    if (!this.path.length) {
      if (this.engine.canStep(this.path, this.inPath, cell)) this.push(cell);
      return;
    }
    const head = this.path[this.path.length - 1]!;
    if (cell === head) return;
    if (this.path.length > 1 && cell === this.path[this.path.length - 2]) { this.pop(); return; }
    // Anything else already on the line is ignored. Letting the head jump back
    // to an arbitrary drawn square meant one stray movement erased everything
    // after it; the only way back is to retrace.
    if (this.inPath[cell]) return;
    if (this.engine.canStep(this.path, this.inPath, cell)) this.push(cell);
  }

  private checkWin(): void {
    if (!this.engine || this.path.length !== this.engine.n) return;
    // Checked against the rules, not against the stored solution, so a
    // generator bug cannot reject a legitimate solve.
    if (this.engine.validate(this.path)) {
      this.finish();
    } else {
      const message = 'Every cell filled, but the path must end on the last number.';
      this.setBanner({ text: message, kind: 'bad' });
    }
  }

  testHooks() {
    const core = this;
    return mergeHooks(this.baseHooks(), {
      step: (cell: Cell) => core.step(cell),
      load: (puzzle: Puzzle) => core.load(puzzle),
      cellAt: (x: number, y: number) => core.view?.cellAt(x, y) ?? -1,
      generate: generateDifficulty,
      U,
      PAD: 6,
      get state() {
        return {
          get puzzle() { return core.puzzle; },
          get engine() { return core.engine; },
          get path() { return core.path; },
          get inPath() { return core.inPath; },
          get elapsed() { return core.elapsed; },
          get running() { return core.running; },
          get solved() { return core.solved; },
          get difficulty() { return core.difficulty; },
          get phase() { return core.phase; },
          get mode() { return core.mode; }
        };
      }
    });
  }
}

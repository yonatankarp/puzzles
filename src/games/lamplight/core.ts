/*
 * Lamplight: the rules, and nothing else.
 *
 * Timing, the reveal gate, the daily, streaks, saved runs, preferences, board
 * codes and publishing all live in ShellCore.
 */
import {
  DIFFICULTIES, DIFFICULTY_ORDER, DIRS, LAMP, WALL, beamOf, generateDifficulty,
  nextRound, type DifficultyName, type LampPuzzle
} from './engine.ts';
import { LampBoard } from './board.ts';
import { fingerprint } from './daily.ts';
import { LampSource } from './source.ts';
import { rampColour } from '../../shell/ramp.ts';
import { ShellCore, mergeHooks, type GameProgress, type TierInfo } from '../../shell/core.ts';

const ARROWS: Record<string, number> = {
  ArrowUp: 0, ArrowDown: 1, ArrowLeft: 2, ArrowRight: 3
};

/** How far the finger must travel before it counts as aiming rather than tapping. */
const AIM_PX = 10;

/* The shell keeps this to itself, and the board needs to know: a sweep that
 * animates for someone who asked for stillness is the one thing they asked not
 * to have. */
const stillness = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class LampCore extends ShellCore<LampPuzzle> {
  readonly gameId = 'lamplight';
  readonly displayName = 'Lamplight';
  protected readonly dailyTier = 'hard';

  constructor() { super('lamplight', 'medium'); }

  private readonly source = new LampSource();
  private view: LampBoard | null = null;

  /** Which way each lamp is turned, or -1 for out. */
  private facing: number[] = [];
  /** The order lamps were turned in: what undo takes back, newest last. */
  private order: number[] = [];
  private lampAt = new Map<number, number>();
  /** Where the keyboard is standing, or -1 until an arrow asks for a cursor. */
  private cursor = -1;
  private preview: { lamp: number; dir: number } | null = null;
  private frameAt = 0;

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
  protected fingerprint(puzzle: LampPuzzle) { return fingerprint(puzzle); }

  protected resetState(puzzle: LampPuzzle): void {
    // The room starts dark: every lamp out, and you may start anywhere.
    this.facing = puzzle.lamps.map(() => -1);
    this.order = [];
    this.cursor = -1;
    this.preview = null;
    this.lampAt = new Map(puzzle.lamps.map((l, i) => [l.cell, i]));
  }

  protected applyPuzzle(puzzle: LampPuzzle, covered: boolean): void {
    if (covered) this.view?.setPuzzle(puzzle, true);
    else this.view?.uncover();
  }

  protected redraw(): void {
    this.view?.draw(this.facing, this.preview, this.solved);
    this.paint();
  }

  /** One frame of the sweeps, asking for another while anything is moving. */
  private paint(): void {
    const view = this.view;
    if (!view) return;
    const now = performance.now();
    const dt = this.frameAt ? Math.min(64, now - this.frameAt) : 16;
    this.frameAt = now;
    view.tick(now, dt, stillness());
  }

  protected onFrame(now: number): void {
    const view = this.view;
    if (!view) return;
    const dt = this.frameAt ? Math.min(64, now - this.frameAt) : 16;
    this.frameAt = now;
    view.tick(now, dt, stillness());
  }

  protected progress(): GameProgress {
    const n = this.puzzle?.n ?? DIFFICULTIES[this.difficulty as DifficultyName]?.n ?? 6;
    const tally = this.view?.tally(this.facing) ?? { once: 0, twice: 0, need: n * n };
    const need = this.puzzle
      ? this.puzzle.board.filter(x => x !== WALL).length
      : n * n;
    const out = this.puzzle ? this.puzzle.lamps.length - this.facing.filter(f => f >= 0).length : 0;
    return {
      done: tally.once,
      total: need,
      unit: 'squares lit',
      goal: tally.twice > 0
        ? `${tally.twice} square${tally.twice === 1 ? '' : 's'} lit twice.`
        : `${out} lamp${out === 1 ? '' : 's'} still out.`,
      sizeLabel: `${n}×${n}`,
      progressColour: rampColour(tally.once / Math.max(1, need))
    };
  }

  /** A lamp and the way it is turned: two numbers each. */
  protected encodeMoves(): number[] {
    const moves: number[] = [];
    for (const i of this.order) {
      if (this.facing[i]! >= 0) moves.push(i, this.facing[i]!);
    }
    return moves;
  }

  protected decodeMoves(moves: number[]): boolean {
    const puzzle = this.puzzle;
    if (!puzzle || moves.length % 2 !== 0) return false;
    // Reject wholesale rather than replay half of something that does not fit.
    for (let i = 0; i < moves.length; i += 2) {
      const lamp = moves[i]!;
      const dir = moves[i + 1]!;
      if (!Number.isInteger(lamp) || !Number.isInteger(dir)) return false;
      if (lamp < 0 || lamp >= puzzle.lamps.length) return false;
      if (dir < 0 || dir > 3) return false;
    }
    for (let i = 0; i < moves.length; i += 2) {
      this.facing[moves[i]!] = moves[i + 1]!;
      this.order.push(moves[i]!);
    }
    return true;
  }

  protected celebrationCell(): number | null {
    const last = this.order[this.order.length - 1];
    return last === undefined ? null : (this.puzzle?.lamps[last]?.cell ?? null);
  }

  /** Turn a lamp, or put it out with -1. */
  private aim(i: number, dir: number): void {
    if (this.phase !== 'playing' || this.solved || this.revealed || !this.puzzle) return;
    if (this.facing[i] === dir) return;
    const wasOn = this.facing[i]! >= 0;
    this.facing[i] = dir;
    this.order = this.order.filter(o => o !== i);
    if (dir >= 0) this.order.push(i);
    else this.backtracks++;
    // Aimed a new way: the beam sweeps out again rather than snapping across.
    if (dir >= 0 && wasOn) this.view?.restartSweep(i);
    this.startClock();
    if (dir >= 0) this.audio.number(this.order.length);
    else this.audio.step(this.order.length / Math.max(1, this.puzzle.lamps.length));
    this.announce(this.describe(i));
    this.setBanner(null);
    this.redraw();
    this.markDirty();
    this.checkWin();
  }

  private describe(i: number): string {
    const puzzle = this.puzzle!;
    const cell = puzzle.lamps[i]!.cell;
    const row = ((cell / puzzle.n) | 0) + 1;
    const col = (cell % puzzle.n) + 1;
    const dir = this.facing[i]!;
    if (dir < 0) return `Lamp at row ${row}, column ${col} put out`;
    const lit = beamOf(puzzle.n, puzzle.board, cell, dir).length;
    const way = ['up', 'down', 'left', 'right'][dir];
    const tally = this.view?.tally(this.facing);
    const note = tally && tally.twice > 0 ? `, ${tally.twice} lit twice` : '';
    return `Lamp at row ${row}, column ${col} shining ${way}, ${lit} square${lit === 1 ? '' : 's'}${note}`;
  }

  protected onRestart(): void {
    this.facing = this.puzzle ? this.puzzle.lamps.map(() => -1) : [];
    this.order = [];
    this.cursor = -1;
    this.preview = null;
    this.view?.showCursor(-1);
  }

  /** Undo takes back the lamp turned most recently. */
  protected onUndo(): void {
    if (this.phase !== 'playing' || this.solved) return;
    const i = this.order[this.order.length - 1];
    if (i === undefined) return;
    this.facing[i] = -1;
    this.order.pop();
    this.backtracks++;
    this.announce('Lamp put out');
    this.setBanner(null);
    this.redraw();
    this.markDirty();
  }

  protected onHint(): void {
    const puzzle = this.puzzle;
    if (!puzzle || this.solved) return;
    // The first lamp that is out or pointing the wrong way, in reading order.
    for (let i = 0; i < puzzle.lamps.length; i++) {
      if (this.facing[i] === puzzle.lamps[i]!.dir) continue;
      this.hintsUsed++;
      this.facing[i] = puzzle.lamps[i]!.dir;
      this.order = this.order.filter(o => o !== i);
      this.order.push(i);
      this.view?.restartSweep(i);
      this.startClock();
      this.announce(`Hint: ${this.describe(i).toLowerCase()}`);
      this.audio.blip();
      this.redraw();
      this.markDirty();
      this.checkWin();
      return;
    }
  }

  protected onReveal(): void {
    const puzzle = this.puzzle!;
    this.facing = puzzle.lamps.map(l => l.dir);
    this.order = puzzle.lamps.map((_, i) => i);
    this.redraw();
  }

  protected clearBoardExtras(): void {
    this.view?.showCursor(-1);
    this.preview = null;
  }

  protected onSolvedEffects(): void {
    this.view?.startWash(performance.now());
  }

  /** Solved when every square that is not a wall is lit exactly once. */
  private checkWin(): void {
    const puzzle = this.puzzle;
    if (!puzzle || this.solved) return;
    const tally = this.view?.tally(this.facing);
    if (!tally || tally.twice > 0) return;
    if (tally.once !== tally.need) return;
    this.finish();
  }

  protected onKeyExtra(event: KeyboardEvent): boolean {
    if (this.phase !== 'playing' || this.solved || !this.puzzle) return false;
    const puzzle = this.puzzle;

    if (event.key === ' ') {
      if (!this.ownsKeyboard()) return true;
      /*
       * Space steps between lamps. They are the only places you can act, so a
       * cursor that walked the empty squares would mostly walk past nothing.
       */
      const cells = puzzle.lamps.map(l => l.cell).sort((a, b) => a - b);
      const at = cells.indexOf(this.cursor);
      this.cursor = cells[(at + 1) % cells.length] ?? cells[0]!;
      this.view?.showCursor(this.cursor);
      this.announce(this.whereAmI());
      this.markDirty();
      return true;
    }

    if (event.key === 'Enter') {
      if (!this.ownsKeyboard()) return true;
      // Enter turns the lamp round the compass, the way a tap does.
      const i = this.lampAt.get(this.cursor);
      if (i !== undefined) this.aim(i, nextRound(this.facing[i]!));
      return true;
    }

    const dir = ARROWS[event.key];
    if (dir === undefined) return false;
    if (!this.ownsKeyboard()) return true;

    if (this.cursor < 0 || !this.lampAt.has(this.cursor)) {
      // The first arrow summons the cursor rather than moving one that is not there.
      this.cursor = puzzle.lamps[0]!.cell;
      this.view?.showCursor(this.cursor);
      this.announce(this.whereAmI());
      this.markDirty();
      return true;
    }
    // An arrow on a lamp shines it that way.
    this.aim(this.lampAt.get(this.cursor)!, dir);
    return true;
  }

  private whereAmI(): string {
    const puzzle = this.puzzle!;
    const row = ((this.cursor / puzzle.n) | 0) + 1;
    const col = (this.cursor % puzzle.n) + 1;
    const i = this.lampAt.get(this.cursor);
    if (i === undefined) return `Row ${row}, column ${col}`;
    const dir = this.facing[i]!;
    const way = dir < 0 ? 'out' : `shining ${['up', 'down', 'left', 'right'][dir]}`;
    return `Lamp at row ${row}, column ${col}, ${way}`;
  }

  protected attachInput(boardSvg: SVGSVGElement): Array<() => void> {
    this.view = new LampBoard(boardSvg);
    this.board = this.view;
    let from: { i: number; x: number; y: number; moved: boolean; id: number } | null = null;

    const down = (e: PointerEvent) => {
      this.audio.markInteracted();
      this.view!.invalidateRect();
      const cell = this.view!.cellAt(e.clientX, e.clientY);
      const i = this.lampAt.get(cell);
      /*
       * Always start a fresh gesture. Refusing one while the last was still
       * open meant a pointerup lost anywhere -- capture dropped, the finger
       * leaving the page -- latched that lamp, and every later press went to it
       * rather than the lamp actually under the finger.
       */
      from = null;
      this.preview = null;
      if (i === undefined) return;
      from = { i, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      try { boardSvg.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      e.preventDefault();
    };

    const move = (e: PointerEvent) => {
      if (!from || e.pointerId !== from.id) return;
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      /*
       * Ten pixels, not more. A short deliberate flick towards the side you
       * want was counted as a tap, so instead of aiming where you pulled, the
       * lamp stepped round to whatever came next.
       */
      if (Math.hypot(dx, dy) < AIM_PX) {
        if (this.preview) { this.preview = null; this.redraw(); }
        return;
      }
      from.moved = true;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 2) : (dy > 0 ? 1 : 0);
      if (!this.preview || this.preview.dir !== dir) {
        this.preview = { lamp: from.i, dir };
        this.redraw();
      }
      e.preventDefault();
    };

    const up = (e: PointerEvent) => {
      if (!from || e.pointerId !== from.id) return;
      const { i, moved } = from;
      const aimed = this.preview;
      from = null;
      this.preview = null;
      if (boardSvg.hasPointerCapture(e.pointerId)) boardSvg.releasePointerCapture(e.pointerId);
      if (aimed) { this.aim(i, aimed.dir); return; }
      /*
       * A drag pulled out and brought back is someone changing their mind, and
       * must leave the lamp alone. Treating it as a tap turns "never mind" into
       * a move nobody asked for.
       */
      if (moved) { this.redraw(); return; }
      this.aim(i, nextRound(this.facing[i]!));
    };

    const lost = () => { from = null; this.preview = null; this.redraw(); };
    const resize = () => this.view?.invalidateRect();

    boardSvg.addEventListener('pointerdown', down);
    boardSvg.addEventListener('pointermove', move);
    boardSvg.addEventListener('pointerup', up);
    boardSvg.addEventListener('pointercancel', lost);
    boardSvg.addEventListener('lostpointercapture', lost);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', resize, true);
    return [
      () => boardSvg.removeEventListener('pointerdown', down),
      () => boardSvg.removeEventListener('pointermove', move),
      () => boardSvg.removeEventListener('pointerup', up),
      () => boardSvg.removeEventListener('pointercancel', lost),
      () => boardSvg.removeEventListener('lostpointercapture', lost),
      () => window.removeEventListener('resize', resize),
      () => window.removeEventListener('scroll', resize, true)
    ];
  }

  testHooks() {
    const core = this;
    return mergeHooks(this.baseHooks(), {
      aim: (lamp: number, dir: number) => core.aim(lamp, dir),
      generate: (tier: string, seed?: number) => generateDifficulty(tier, seed),
      load: (puzzle: LampPuzzle) => core.load(puzzle),
      get state() {
        return {
          get puzzle() { return core.puzzle; },
          get facing() { return core.facing.slice(); },
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

export { LAMP, WALL, DIRS };

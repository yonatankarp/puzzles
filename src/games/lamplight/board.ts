/*
 * Imperative SVG renderer for a Lamplight board.
 *
 * Built once and mutated after that. Rebuilding the svg on every change tears
 * out the <defs> with it, and anything pointing at url(#bloom) renders
 * unfiltered for a frame while the filter is put back -- with one beam that is
 * invisible, from the second onwards it reads as the lights flickering.
 */
import { DIRS, LAMP, WALL, beamOf, type LampPuzzle } from './engine.ts';

export const U = 100;
export const PAD = 6;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** How long a beam takes to sweep out of its lamp, and the finishing wash. */
const SWEEP_MS = 165;
const WASH_MS = 1100;

/** Round the compass, in degrees, indexed by direction. */
const ANGLE: Record<number, number> = { 0: 0, 3: 90, 1: 180, 2: 270 };

function node<K extends keyof SVGElementTagNameMap>(
  name: K, attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

let idSeq = 0;

export class LampBoard {
  private puzzle: LampPuzzle | null = null;
  private rect: DOMRect | null = null;
  private covered = false;
  private cells: SVGRectElement[] = [];
  private beams: SVGLineElement[] = [];
  private lamps: Array<{ body: SVGCircleElement; swivel: SVGGElement }> = [];
  private cursorNode: SVGRectElement | null = null;
  /** Per lamp, how far its beam has swept out: 0 to 1. */
  private reach: number[] = [];
  private washAt = 0;
  private facing: number[] = [];
  private preview: { lamp: number; dir: number } | null = null;
  private solved = false;
  private cursor = -1;

  constructor(private readonly svg: SVGSVGElement) {}

  invalidateRect(): void { this.rect = null; }

  private boardRect(): DOMRect | null {
    if (!this.rect) this.rect = this.svg.getBoundingClientRect();
    return this.rect;
  }

  cellAt(clientX: number, clientY: number): number {
    const puzzle = this.puzzle;
    const rect = this.boardRect();
    if (!puzzle || !rect || !rect.width) return -1;
    const scale = rect.width / (puzzle.n * U + 2 * PAD);
    const col = Math.floor(((clientX - rect.left) / scale - PAD) / U);
    const row = Math.floor(((clientY - rect.top) / scale - PAD) / U);
    if (col < 0 || row < 0 || col >= puzzle.n || row >= puzzle.n) return -1;
    return row * puzzle.n + col;
  }

  centreInViewport(cell: number): { x: number; y: number } | null {
    const rect = this.boardRect();
    const puzzle = this.puzzle;
    if (!rect || !puzzle || !rect.width) return null;
    const scale = rect.width / (puzzle.n * U + 2 * PAD);
    return {
      x: rect.left + ((cell % puzzle.n) * U + U / 2 + PAD) * scale,
      y: rect.top + (((cell / puzzle.n) | 0) * U + U / 2 + PAD) * scale
    };
  }

  rectInViewport(): DOMRect | null { return this.boardRect(); }

  private cx(cell: number): number { return (cell % this.puzzle!.n) * U + U / 2; }
  private cy(cell: number): number { return ((cell / this.puzzle!.n) | 0) * U + U / 2; }

  /** `covered` withholds the walls and lamps, so a board cannot be read early. */
  setPuzzle(puzzle: LampPuzzle, covered = false): void {
    this.puzzle = puzzle;
    this.covered = covered;
    this.rect = null;
    this.cells = [];
    this.beams = [];
    this.lamps = [];
    this.cursorNode = null;
    this.reach = puzzle.lamps.map(() => 0);
    this.washAt = 0;
    const { n } = puzzle;
    const uid = `lamp${idSeq++}`;

    this.svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${n * U + 2 * PAD} ${n * U + 2 * PAD}`);
    this.svg.replaceChildren();

    const defs = node('defs', {});
    defs.innerHTML =
      `<filter id="${uid}-bloom" x="-60%" y="-60%" width="220%" height="220%">` +
        '<feGaussianBlur stdDeviation="9" result="b"/>' +
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      '</filter>' +
      /* Walls are hatched, not merely a paler square: a difference in colour
         alone does not say "this one never lights". */
      `<pattern id="${uid}-stone" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
        '<rect width="14" height="14" fill="var(--wall-fill)"/>' +
        '<line x1="0" y1="0" x2="0" y2="14" stroke="var(--board)" stroke-width="4" opacity="0.55"/>' +
      '</pattern>' +
      /* The corners of a lit room fall away. */
      `<radialGradient id="${uid}-vignette" cx="50%" cy="45%" r="72%">` +
        '<stop offset="55%" stop-color="#000" stop-opacity="0"/>' +
        '<stop offset="100%" stop-color="#000" stop-opacity="0.4"/>' +
      '</radialGradient>';
    this.svg.appendChild(defs);

    this.svg.appendChild(node('rect', {
      x: 0, y: 0, width: n * U, height: n * U, rx: 14,
      fill: 'var(--board)', stroke: 'var(--line)', 'stroke-width': 2
    }));

    // The first <g> is one rect per square, which the suites rely on.
    const cells = node('g', {});
    for (let cell = 0; cell < n * n; cell++) {
      const rect = node('rect', {
        x: (cell % n) * U + 2, y: ((cell / n) | 0) * U + 2,
        width: U - 4, height: U - 4, rx: 9,
        fill: covered || puzzle.board[cell] !== WALL ? 'var(--cell-dark)' : `url(#${uid}-stone)`
      });
      cells.appendChild(rect);
      this.cells.push(rect);
    }

    const beams = node('g', { filter: `url(#${uid}-bloom)` });
    for (let i = 0; i < puzzle.lamps.length; i++) {
      const line = node('line', {
        x1: 0, y1: 0, x2: 0, y2: 0, stroke: 'var(--beam)',
        'stroke-width': 26, 'stroke-linecap': 'round', opacity: 0
      });
      beams.appendChild(line);
      this.beams.push(line);
    }

    const grid = node('g', { stroke: 'var(--line)', 'stroke-width': 1.5, opacity: 0.5 });
    for (let i = 1; i < n; i++) {
      grid.appendChild(node('line', { x1: i * U, y1: 0, x2: i * U, y2: n * U }));
      grid.appendChild(node('line', { x1: 0, y1: i * U, x2: n * U, y2: i * U }));
    }

    const marks = node('g', {});
    for (const lamp of puzzle.lamps) {
      const x = this.cx(lamp.cell);
      const y = this.cy(lamp.cell);
      // The stalk gets its own group so the lamp turns rather than jumps.
      const swivel = node('g', { transform: `rotate(0 ${x} ${y})`, opacity: 0 });
      swivel.appendChild(node('line', {
        x1: x, y1: y, x2: x, y2: y - 30, stroke: 'var(--accent)',
        'stroke-width': 9, 'stroke-linecap': 'round'
      }));
      const body = node('circle', { cx: x, cy: y, r: 22, fill: 'var(--lamp-off)' });
      marks.append(swivel, body);
      this.lamps.push({ body, swivel });
    }

    this.svg.append(cells, beams, grid, marks);
    this.svg.appendChild(node('rect', {
      x: 0, y: 0, width: n * U, height: n * U, rx: 14,
      fill: `url(#${uid}-vignette)`, 'pointer-events': 'none'
    }));
    this.svg.classList.toggle('covered', covered);
  }

  /** Reveal the walls the cover was holding back. */
  uncover(): void {
    if (!this.puzzle || !this.covered) return;
    this.covered = false;
    this.svg.classList.remove('covered');
    // Re-running setPuzzle is the simplest honest way to repaint the walls.
    const facing = this.facing.slice();
    const reach = this.reach.slice();
    this.setPuzzle(this.puzzle, false);
    this.facing = facing;
    this.reach = reach;
  }

  showCursor(cell: number): void {
    if (!this.puzzle) return;
    if (!this.cursorNode) {
      this.cursorNode = node('rect', {
        x: 0, y: 0, width: U - 14, height: U - 14, rx: 8,
        fill: 'none', stroke: 'var(--accent)', 'stroke-width': 5,
        'stroke-dasharray': '14 10', opacity: 0
      });
      this.svg.appendChild(this.cursorNode);
    }
    this.cursor = cell;
    if (cell < 0) { this.cursorNode.setAttribute('opacity', '0'); return; }
    const n = this.puzzle.n;
    this.cursorNode.setAttribute('x', String((cell % n) * U + 7));
    this.cursorNode.setAttribute('y', String((((cell / n) | 0) * U) + 7));
    this.cursorNode.setAttribute('opacity', '1');
  }

  /** Turning a lamp a new way starts its beam again from the lamp. */
  restartSweep(lamp: number): void {
    if (lamp >= 0 && lamp < this.reach.length) this.reach[lamp] = 0;
  }

  /** The finishing wash of light across the room. */
  startWash(now: number): void { this.washAt = now; }

  draw(
    facing: readonly number[],
    preview: { lamp: number; dir: number } | null,
    solved: boolean
  ): void {
    this.facing = facing.slice();
    this.preview = preview;
    this.solved = solved;
  }

  /**
   * Advance the sweeps and paint. Returns true while anything is still moving,
   * so the core knows to keep asking for frames.
   */
  tick(now: number, dt: number, reduced: boolean): boolean {
    const puzzle = this.puzzle;
    if (!puzzle || !this.cells.length) return false;
    const n = puzzle.n;
    const dirs = this.shown();
    let moving = false;

    puzzle.lamps.forEach((_lamp, i) => {
      const want = dirs[i]! >= 0 ? 1 : 0;
      // A beam under the finger tracks it exactly; sweeping there lags the drag.
      if (reduced || (this.preview && this.preview.lamp === i)) { this.reach[i] = want; return; }
      const by = dt / SWEEP_MS;
      if (this.reach[i]! < want) { this.reach[i] = Math.min(want, this.reach[i]! + by); moving = true; }
      else if (this.reach[i]! > want) { this.reach[i] = Math.max(want, this.reach[i]! - by); moving = true; }
    });

    const counts = new Map<number, number>();
    puzzle.lamps.forEach((lamp, i) => {
      if (dirs[i]! < 0) return;
      for (const cell of beamOf(n, puzzle.board, lamp.cell, dirs[i]!)) {
        counts.set(cell, (counts.get(cell) ?? 0) + 1);
      }
    });

    const washing = this.washAt > 0 && now - this.washAt < WASH_MS && !reduced;
    const front = washing ? ((now - this.washAt) / WASH_MS) * (n * 2 + 4) - 2 : -99;
    const pulse = 0.5 + 0.5 * Math.sin(now / 190);
    let clashing = false;

    for (let cell = 0; cell < n * n; cell++) {
      if (!this.covered && puzzle.board[cell] === WALL) continue;
      const seen = counts.get(cell) ?? 0;
      const rect = this.cells[cell]!;
      if (seen > 1) {
        clashing = true;
        rect.setAttribute('fill', 'var(--bad)');
        rect.setAttribute('opacity', String(0.32 + 0.22 * pulse));
      } else if (seen === 1) {
        rect.setAttribute('fill', this.solved ? 'var(--cell-won)' : 'var(--cell-lit)');
        rect.setAttribute('opacity', '1');
      } else {
        rect.setAttribute('fill', 'var(--cell-dark)');
        rect.setAttribute('opacity', '1');
      }
    }

    const waveAt = (cell: number) => washing
      ? Math.max(0, 1 - Math.abs(((cell / n) | 0) + (cell % n) - front) / 2.4)
      : 0;

    puzzle.lamps.forEach((lamp, i) => {
      const line = this.beams[i]!;
      if (dirs[i]! < 0 && this.reach[i]! <= 0.001) { line.setAttribute('opacity', '0'); return; }
      const run = beamOf(n, puzzle.board, lamp.cell, dirs[i]! < 0 ? 0 : dirs[i]!);
      const last = run[run.length - 1]!;
      const x1 = this.cx(lamp.cell);
      const y1 = this.cy(lamp.cell);
      const grown = Math.max(0, Math.min(1, this.reach[i]!));
      /* A beam landing where another already reaches goes red -- both of them,
         so the pair that disagree are the pair you can see. */
      const clash = run.some(c => (counts.get(c) ?? 0) > 1);
      const wave = waveAt(lamp.cell);
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x1 + (this.cx(last) - x1) * grown));
      line.setAttribute('y2', String(y1 + (this.cy(last) - y1) * grown));
      line.setAttribute('stroke', this.solved ? 'var(--good)' : clash ? 'var(--bad)' : 'var(--beam)');
      line.setAttribute('stroke-width', String(26 + wave * 12));
      line.setAttribute('opacity', String(
        (this.preview && this.preview.lamp === i ? 0.85 : clash ? 0.5 : 0.62) * (0.35 + 0.65 * grown) + wave * 0.3
      ));
    });

    puzzle.lamps.forEach((lamp, i) => {
      const { body, swivel } = this.lamps[i]!;
      const on = dirs[i]! >= 0;
      body.setAttribute('fill', this.solved ? 'var(--good)' : on ? 'var(--accent)' : 'var(--lamp-off)');
      body.setAttribute('r', String(22 + waveAt(lamp.cell) * 4));
      swivel.setAttribute('opacity', on ? '1' : '0');
      if (on) {
        swivel.setAttribute('transform', `rotate(${ANGLE[dirs[i]!]} ${this.cx(lamp.cell)} ${this.cy(lamp.cell)})`);
        (swivel.firstChild as SVGLineElement).setAttribute(
          'stroke', this.solved ? 'var(--good)' : 'var(--accent)'
        );
      }
    });

    if (this.cursorNode && this.cursor >= 0) this.svg.appendChild(this.cursorNode);
    return moving || clashing || washing;
  }

  /** What each lamp is showing, with any drag preview standing in. */
  private shown(): number[] {
    const dirs = this.facing.slice();
    if (this.preview) dirs[this.preview.lamp] = this.preview.dir;
    return dirs;
  }

  /** How many squares are lit exactly once, and how many twice. */
  tally(facing: readonly number[]): { once: number; twice: number; need: number } {
    const puzzle = this.puzzle;
    if (!puzzle) return { once: 0, twice: 0, need: 0 };
    const counts = new Map<number, number>();
    puzzle.lamps.forEach((l, i) => {
      if (facing[i]! < 0) return;
      for (const cell of beamOf(puzzle.n, puzzle.board, l.cell, facing[i]!)) {
        counts.set(cell, (counts.get(cell) ?? 0) + 1);
      }
    });
    let once = 0;
    let twice = 0;
    for (const seen of counts.values()) {
      if (seen === 1) once++;
      else if (seen > 1) twice++;
    }
    const need = puzzle.board.filter(x => x !== WALL).length;
    return { once, twice, need };
  }
}

export { LAMP, WALL, DIRS };

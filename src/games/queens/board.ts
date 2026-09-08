/*
 * Imperative SVG renderer for a Queens board.
 *
 * Not React, for the same reason Zip's board is not: marks change on every tap
 * and conflicts are recomputed with them, which is a mutation workload. React
 * owns the chrome and hands this the <svg>.
 */
import type { QueensPuzzle } from './engine.ts';

export const U = 100;
export const PAD = 6;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** What a cell is currently marked as. */
export type Mark = 'empty' | 'blocked' | 'queen';

/*
 * Region tints. Distinct in hue but all low-saturation, so a queen or a cross
 * drawn on top stays readable and no region shouts louder than another.
 */
const REGION_HUES = [8, 42, 74, 152, 190, 214, 262, 292, 330, 20, 108, 240];

export function regionColour(index: number, dark: boolean): string {
  const hue = REGION_HUES[index % REGION_HUES.length]!;
  return dark ? `hsl(${hue} 42% 26%)` : `hsl(${hue} 62% 84%)`;
}

/*
 * The palette the CSS is actually serving. styles.css takes dark as the base
 * and applies light only when the system asks for it or the button pins it, so
 * a pin has to win over the media query here in exactly the same order. Asking
 * the media query first painted dark tints under the light palette for every
 * dark-system player who pressed the theme button once.
 */
function darkTheme(): boolean {
  const pinned = document.documentElement.dataset.theme;
  if (pinned === 'light') return false;
  if (pinned === 'dark') return true;
  return !matchMedia('(prefers-color-scheme: light)').matches;
}

/** Unique per board, so a clip path can never be captured by another svg. */
let clipSeq = 0;

function node<K extends keyof SVGElementTagNameMap>(
  name: K, attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

const CROWN = 'M -20 10 L -24 -13 L -11 -4 L 0 -17 L 11 -4 L 24 -13 L 20 10 Z';

interface CellNodes {
  fill: SVGRectElement;
  queen: SVGPathElement;
  cross: SVGGElement;
  danger: SVGRectElement;
}

/** One crown on its way up, `at` being when its turn comes. */
interface CrownPop {
  cell: number;
  at: number;
}

export class QueensBoard {
  private puzzle: QueensPuzzle | null = null;
  private cells: CellNodes[] = [];
  private rect: DOMRect | null = null;
  private covered = false;
  private dark = darkTheme();
  private pops: CrownPop[] = [];
  private fade: { cells: number[]; start: number } | null = null;
  /*
   * The keyboard cursor: the square the arrow keys are standing on. Two rects
   * rather than one, because a ring in any single colour is legible over some
   * region tints and lost in others -- the dark halo underneath is what keeps
   * it visible over a pale tint, a stepped-back region and a crown alike.
   * Drawn last so nothing paints over it, and left out of the fills group so
   * that group stays exactly one rect per cell.
   */
  private cursorHalo: SVGRectElement | null = null;
  private cursorRing: SVGRectElement | null = null;

  constructor(private readonly svg: SVGSVGElement) {}

  /*
   * Region tints are generated hues rather than palette tokens, so unlike every
   * other colour on this board they cannot be a var() the browser re-resolves
   * when the theme changes. Watching both routes to a theme -- the system
   * preference and the button's pin -- is what keeps them in step with the
   * palette around them instead of staying whatever they were baked as.
   */
  watchTheme(onChange: () => void): () => void {
    const query = matchMedia('(prefers-color-scheme: light)');
    const changed = () => {
      const dark = darkTheme();
      if (dark === this.dark) return;
      this.dark = dark;
      onChange();
    };
    query.addEventListener('change', changed);
    const observer = new MutationObserver(changed);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      query.removeEventListener('change', changed);
      observer.disconnect();
    };
  }

  invalidateRect(): void { this.rect = null; }

  private boardRect(): DOMRect | null {
    if (!this.rect) this.rect = this.svg.getBoundingClientRect();
    return this.rect;
  }

  /** One scale from the width serves both axes; the viewBox aspect matches. */
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

  /** The middle of a cell, in board units -- where a crown or a cross sits. */
  private centre(cell: number): string {
    const n = this.puzzle!.n;
    return `translate(${(cell % n) * U + U / 2},${((cell / n) | 0) * U + U / 2})`;
  }

  /** `covered` withholds the regions, so a board cannot be studied before the clock. */
  setPuzzle(puzzle: QueensPuzzle, covered = false): void {
    this.puzzle = puzzle;
    this.covered = covered;
    this.dark = darkTheme();
    this.pops = [];
    this.fade = null;
    this.invalidateRect();
    this.svg.classList.remove('won');
    const { n, regions } = puzzle;
    const dark = this.dark;

    this.svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${n * U + 2 * PAD} ${n * U + 2 * PAD}`);
    this.svg.style.aspectRatio = '1 / 1';
    this.svg.replaceChildren();
    this.svg.appendChild(node('rect', {
      x: 0, y: 0, width: n * U, height: n * U, rx: 14,
      fill: 'var(--board)', stroke: 'var(--line)', 'stroke-width': 2
    }));

    // The region fills are square and the board is not, so without a clip they
    // paint over its rounded corners and the board reads as a plain rectangle.
    const clipId = `queens-board-${++clipSeq}`;
    const defs = node('defs', {});
    const clip = node('clipPath', { id: clipId });
    clip.appendChild(node('rect', { x: 0, y: 0, width: n * U, height: n * U, rx: 14 }));
    defs.appendChild(clip);
    this.svg.appendChild(defs);

    this.cells = [];
    const fills = node('g', { 'clip-path': `url(#${clipId})` });
    const marks = node('g', {});
    for (let cell = 0; cell < n * n; cell++) {
      const x = (cell % n) * U;
      const y = ((cell / n) | 0) * U;
      const fill = node('rect', {
        x: x + 1, y: y + 1, width: U - 2, height: U - 2,
        fill: covered ? 'var(--board)' : regionColour(regions[cell]!, dark)
      });
      fills.appendChild(fill);

      const danger = node('rect', {
        x: x + 3, y: y + 3, width: U - 6, height: U - 6, rx: 8,
        fill: 'none', stroke: 'var(--bad)', 'stroke-width': 5, opacity: 0
      });
      marks.appendChild(danger);

      const queen = node('path', {
        d: CROWN, transform: this.centre(cell),
        fill: 'var(--ink)', opacity: 0
      });
      marks.appendChild(queen);

      const cross = node('g', {
        transform: this.centre(cell),
        stroke: 'var(--dim)', 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0
      });
      cross.appendChild(node('line', { x1: -11, y1: -11, x2: 11, y2: 11 }));
      cross.appendChild(node('line', { x1: 11, y1: -11, x2: -11, y2: 11 }));
      marks.appendChild(cross);

      this.cells.push({ fill, queen, cross, danger });
    }
    this.svg.appendChild(fills);

    // Region borders: drawn only where two different regions meet, which is
    // what makes the shapes legible at a glance.
    if (!covered) {
      const borders = node('g', {
        stroke: 'var(--ink)', 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.85
      });
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          const cell = row * n + col;
          if (col + 1 < n && regions[cell] !== regions[cell + 1]) {
            borders.appendChild(node('line', {
              x1: (col + 1) * U, y1: row * U, x2: (col + 1) * U, y2: (row + 1) * U
            }));
          }
          if (row + 1 < n && regions[cell] !== regions[cell + n]) {
            borders.appendChild(node('line', {
              x1: col * U, y1: (row + 1) * U, x2: (col + 1) * U, y2: (row + 1) * U
            }));
          }
        }
      }
      this.svg.appendChild(borders);
    }

    const grid = node('g', { stroke: 'var(--line)', 'stroke-width': 1.5, opacity: 0.6 });
    for (let i = 1; i < n; i++) {
      grid.appendChild(node('line', { x1: i * U, y1: 4, x2: i * U, y2: n * U - 4 }));
      grid.appendChild(node('line', { x1: 4, y1: i * U, x2: n * U - 4, y2: i * U }));
    }
    this.svg.appendChild(grid);
    this.svg.appendChild(marks);

    // Inside the conflict ring rather than over it: a cursor that covered the
    // red ring would hide the one thing the board says about the square it is
    // standing on.
    this.cursorHalo = node('rect', {
      x: 0, y: 0, width: U - 24, height: U - 24, rx: 10,
      fill: 'none', stroke: 'var(--ink)', 'stroke-width': 8,
      opacity: 0, 'pointer-events': 'none', 'data-cursor': 'halo'
    });
    this.cursorRing = node('rect', {
      x: 0, y: 0, width: U - 24, height: U - 24, rx: 10,
      fill: 'none', stroke: 'var(--accent)', 'stroke-width': 4,
      'stroke-dasharray': '14 10', 'stroke-linecap': 'round',
      opacity: 0, 'pointer-events': 'none', 'data-cursor': 'ring'
    });
    this.svg.appendChild(this.cursorHalo);
    this.svg.appendChild(this.cursorRing);
  }

  /*
   * Put the keyboard cursor on a square, or take it off the board with a
   * negative cell. Nothing shows it until an arrow key asks for it, so a player
   * using the pointer never sees a cursor they did not summon.
   */
  showCursor(cell: number): void {
    const puzzle = this.puzzle;
    const on = !!puzzle && cell >= 0 && cell < puzzle.n * puzzle.n;
    if (on) {
      const x = (cell % puzzle!.n) * U + 12;
      const y = (((cell / puzzle!.n) | 0)) * U + 12;
      for (const el of [this.cursorHalo, this.cursorRing]) {
        el?.setAttribute('x', String(x));
        el?.setAttribute('y', String(y));
      }
    }
    this.cursorHalo?.setAttribute('opacity', on ? '0.85' : '0');
    this.cursorRing?.setAttribute('opacity', on ? '1' : '0');
  }

  draw(marks: readonly Mark[], conflicts: ReadonlySet<number>, solved: boolean): void {
    /*
     * A region that already holds its one queen is settled, so it steps back.
     * This reports what you have done -- it never points at what to do next,
     * which is the hint button's job and would quietly make every board easier.
     * At the win everything comes back up, so the finished board is not muted.
     */
    const settled = new Set<number>();
    const regions = this.puzzle?.regions;
    if (regions && !solved) {
      const counts = new Map<number, number>();
      marks.forEach((mark, cell) => {
        if (mark !== 'queen') return;
        const region = regions[cell]!;
        counts.set(region, (counts.get(region) ?? 0) + 1);
      });
      for (const [region, count] of counts) if (count === 1) settled.add(region);
    }

    /*
     * How far back a settled region steps. Two things shape it.
     *
     * It eases off as the board fills. The cue is worth making loudly when one
     * region among eight has been dealt with; by seven of eight the settled
     * regions are the whole board, and crushing all of them leaves grey mud
     * exactly where the finish should be brightest. Easing it takes brightness
     * away from nothing and adds no information -- the crowns already say which
     * regions are done -- so it still never points at what to solve next.
     *
     * And dark starts shallower. Its tints are dark to begin with, so taking
     * another half off them loses them into the board altogether, which the
     * light palette's tints never do.
     */
    const total = this.puzzle?.n ?? 0;
    const share = settled.size / Math.max(1, total);
    const depth = (this.dark ? 0.3 : 0.55) * (1 - share * share);
    const stepped = (1 - depth).toFixed(3);

    this.cells.forEach((nodes, cell) => {
      const mark = marks[cell] ?? 'empty';
      nodes.queen.setAttribute('opacity', mark === 'queen' ? '1' : '0');
      nodes.queen.setAttribute('fill', solved ? 'var(--good)' : 'var(--ink)');
      // The crosses are working notes, not part of the answer, so a solved
      // board is not left wearing them. celebrate() fades them; with reduced
      // motion they simply go.
      nodes.cross.setAttribute('opacity', mark === 'blocked' && !solved ? '0.65' : '0');
      nodes.danger.setAttribute('opacity', conflicts.has(cell) ? '1' : '0');
      const region = regions?.[cell];
      if (region !== undefined && !this.covered) {
        nodes.fill.setAttribute('fill', regionColour(region, this.dark));
      }
      nodes.fill.setAttribute('opacity', region !== undefined && settled.has(region) ? stepped : '1');
    });
  }

  /*
   * The win. Zip finishes with a sweep down the route and a pop of the board;
   * this is Queens' equivalent. The board gives the same pop, the crowns rise
   * one after another in the order they were placed -- a replay of the run
   * rather than a single flash -- and the crossed-off squares clear away behind
   * them. Purely decorative: if the frames never run, no state is lost.
   */
  celebrate(order: readonly number[], marks: readonly Mark[]): void {
    if (!this.puzzle) return;
    const now = performance.now();
    this.svg.classList.remove('won');
    void this.svg.getBoundingClientRect();       // restart it if already mid-flight
    this.svg.classList.add('won');
    this.pops = order
      .filter(cell => this.cells[cell])
      .map((cell, i) => ({ cell, at: now + i * 70 }));
    const crossed: number[] = [];
    marks.forEach((mark, cell) => { if (mark === 'blocked') crossed.push(cell); });
    for (const cell of crossed) this.cells[cell]?.cross.setAttribute('opacity', '0.65');
    this.fade = crossed.length ? { cells: crossed, start: now } : null;
  }

  tick(now: number): void {
    if (this.pops.length) {
      this.pops = this.pops.filter(pop => {
        const nodes = this.cells[pop.cell];
        if (!nodes) return false;
        const k = (now - pop.at) / 320;
        if (k < 0) return true;                  // its turn has not come round yet
        const scale = k >= 1 ? 1 : 1 + 0.5 * Math.sin(Math.PI * k);
        nodes.queen.setAttribute('transform', `${this.centre(pop.cell)} scale(${scale.toFixed(3)})`);
        return k < 1;
      });
    }
    if (this.fade) {
      const k = (now - this.fade.start) / 520;
      const opacity = k >= 1 ? 0 : 0.65 * (1 - k);
      for (const cell of this.fade.cells) {
        this.cells[cell]?.cross.setAttribute('opacity', String(opacity));
      }
      if (k >= 1) this.fade = null;
    }
  }
}

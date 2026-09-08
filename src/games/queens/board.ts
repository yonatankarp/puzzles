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

export class QueensBoard {
  private puzzle: QueensPuzzle | null = null;
  private cells: CellNodes[] = [];
  private rect: DOMRect | null = null;

  constructor(private readonly svg: SVGSVGElement) {}

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

  /** `covered` withholds the regions, so a board cannot be studied before the clock. */
  setPuzzle(puzzle: QueensPuzzle, covered = false): void {
    this.puzzle = puzzle;
    this.invalidateRect();
    const { n, regions } = puzzle;
    const dark = !matchMedia('(prefers-color-scheme: light)').matches
      || document.documentElement.dataset.theme === 'dark';

    this.svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${n * U + 2 * PAD} ${n * U + 2 * PAD}`);
    this.svg.style.aspectRatio = '1 / 1';
    this.svg.replaceChildren();
    this.svg.appendChild(node('rect', {
      x: 0, y: 0, width: n * U, height: n * U, rx: 14,
      fill: 'var(--board)', stroke: 'var(--line)', 'stroke-width': 2
    }));

    this.cells = [];
    const fills = node('g', {});
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
        d: CROWN, transform: `translate(${x + U / 2},${y + U / 2})`,
        fill: 'var(--ink)', opacity: 0
      });
      marks.appendChild(queen);

      const cross = node('g', {
        transform: `translate(${x + U / 2},${y + U / 2})`,
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

    this.cells.forEach((nodes, cell) => {
      const mark = marks[cell] ?? 'empty';
      nodes.queen.setAttribute('opacity', mark === 'queen' ? '1' : '0');
      nodes.queen.setAttribute('fill', solved ? 'var(--good)' : 'var(--ink)');
      nodes.cross.setAttribute('opacity', mark === 'blocked' ? '0.65' : '0');
      nodes.danger.setAttribute('opacity', conflicts.has(cell) ? '1' : '0');
      const region = regions?.[cell];
      nodes.fill.setAttribute('opacity', region !== undefined && settled.has(region) ? '0.45' : '1');
    });
  }
}

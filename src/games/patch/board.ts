/*
 * Imperative SVG renderer for a Patch board.
 *
 * Not React, for the same reason the other boards are not: the rectangle under
 * the finger is redrawn on every pointer move, which is a mutation workload.
 * React owns the chrome and hands this the <svg>.
 */
import type { PatchPuzzle, Rect } from './engine.ts';

export const U = 100;
export const PAD = 6;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A hue per patch, taken from where its number sits so it never shifts. */
export function patchColour(cell: number, dark: boolean): string {
  const hue = (cell * 67 + 20) % 360;
  return dark ? `hsl(${hue} 60% 55%)` : `hsl(${hue} 62% 45%)`;
}

/*
 * The palette the CSS is actually serving: a pin wins over the media query, in
 * exactly the order styles.css applies them.
 */
function darkTheme(): boolean {
  const pinned = document.documentElement.dataset.theme;
  if (pinned === 'light') return false;
  if (pinned === 'dark') return true;
  return !matchMedia('(prefers-color-scheme: light)').matches;
}

function node<K extends keyof SVGElementTagNameMap>(
  name: K, attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

export class PatchBoard {
  private puzzle: PatchPuzzle | null = null;
  private rect: DOMRect | null = null;
  private dark = darkTheme();
  private patchLayer: SVGGElement | null = null;
  private previewNode: SVGRectElement | null = null;
  private cursorNode: SVGRectElement | null = null;
  private labels = new Map<number, SVGTextElement>();

  constructor(private readonly svg: SVGSVGElement) {}

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
    return () => { query.removeEventListener('change', changed); observer.disconnect(); };
  }

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

  setPuzzle(puzzle: PatchPuzzle, covered = false): void {
    this.puzzle = puzzle;
    this.rect = null;
    this.labels.clear();
    this.previewNode = null;
    this.cursorNode = null;
    const { n } = puzzle;

    this.svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${n * U + 2 * PAD} ${n * U + 2 * PAD}`);
    this.svg.replaceChildren();
    this.svg.appendChild(node('rect', {
      x: 0, y: 0, width: n * U, height: n * U, rx: 14,
      fill: 'var(--board)', stroke: 'var(--line)', 'stroke-width': 2
    }));

    // First <g>: the patches. Second: the grid. Third: the numbers.
    this.patchLayer = node('g', {});
    this.svg.appendChild(this.patchLayer);

    const grid = node('g', { stroke: 'var(--line)', 'stroke-width': 1.5, opacity: 0.55 });
    for (let i = 1; i < n; i++) {
      grid.appendChild(node('line', { x1: i * U, y1: 0, x2: i * U, y2: n * U }));
      grid.appendChild(node('line', { x1: 0, y1: i * U, x2: n * U, y2: i * U }));
    }
    this.svg.appendChild(grid);

    const marks = node('g', {});
    for (const clue of puzzle.clues) {
      const label = node('text', {
        x: (clue.cell % n) * U + U / 2, y: ((clue.cell / n) | 0) * U + U / 2,
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': U * 0.46, 'font-weight': 700, fill: 'var(--ink)'
      });
      label.textContent = covered ? '' : String(clue.area);
      marks.appendChild(label);
      this.labels.set(clue.cell, label);
    }
    this.svg.appendChild(marks);
    this.svg.classList.toggle('covered', covered);
  }

  uncover(): void {
    if (!this.puzzle) return;
    this.svg.classList.remove('covered');
    for (const clue of this.puzzle.clues) {
      const label = this.labels.get(clue.cell);
      if (label) label.textContent = String(clue.area);
    }
  }

  private box(rect: Rect, inset: number): Record<string, number> {
    return {
      x: rect.c0 * U + inset, y: rect.r0 * U + inset,
      width: rect.w * U - inset * 2, height: rect.h * U - inset * 2
    };
  }

  /** `drawn` maps a number's cell to the rectangle the player has put round it. */
  draw(
    drawn: ReadonlyMap<number, Rect>,
    preview: Rect | null,
    solved: boolean
  ): void {
    if (!this.puzzle || !this.patchLayer) return;
    this.patchLayer.replaceChildren();

    for (const [cell, rect] of drawn) {
      const colour = solved ? 'var(--good)' : patchColour(cell, this.dark);
      this.patchLayer.appendChild(node('rect', {
        ...this.box(rect, 3), rx: 10, fill: colour, opacity: 0.24
      }));
      this.patchLayer.appendChild(node('rect', {
        ...this.box(rect, 3), rx: 10, fill: 'none', stroke: colour, 'stroke-width': 5
      }));
    }

    if (preview) {
      this.previewNode = node('rect', {
        ...this.box(preview, 5), rx: 8, fill: 'var(--ink)', opacity: 0.12,
        stroke: 'var(--ink)', 'stroke-width': 4, 'stroke-dasharray': '12 8'
      });
      this.patchLayer.appendChild(this.previewNode);
    }

    // A number goes quiet once its own patch is round it: one glance says which
    // are still to do, which is most of what makes the board readable.
    for (const clue of this.puzzle.clues) {
      const label = this.labels.get(clue.cell);
      if (!label) continue;
      const done = drawn.has(clue.cell);
      label.setAttribute('fill', solved ? 'var(--good)' : done ? patchColour(clue.cell, this.dark) : 'var(--ink)');
      label.setAttribute('opacity', done && !solved ? '0.75' : '1');
    }

    if (this.cursorNode) this.patchLayer.appendChild(this.cursorNode);
  }

  showCursor(cell: number): void {
    if (!this.puzzle || !this.patchLayer) return;
    if (!this.cursorNode) {
      this.cursorNode = node('rect', {
        x: 0, y: 0, width: U - 14, height: U - 14, rx: 8,
        fill: 'none', stroke: 'var(--accent)', 'stroke-width': 5,
        'stroke-dasharray': '14 10', opacity: 0
      });
    }
    if (cell < 0) { this.cursorNode.setAttribute('opacity', '0'); return; }
    const n = this.puzzle.n;
    this.cursorNode.setAttribute('x', String((cell % n) * U + 7));
    this.cursorNode.setAttribute('y', String((((cell / n) | 0) * U) + 7));
    this.cursorNode.setAttribute('opacity', '1');
    this.patchLayer.appendChild(this.cursorNode);
  }
}

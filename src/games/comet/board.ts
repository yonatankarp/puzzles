/*
 * Imperative SVG renderer for a Comet board.
 *
 * Not React, for the same reason the other two boards are not: a comet's tail
 * is redrawn on every pointer move while a drag is in flight, which is a
 * mutation workload. React owns the chrome and hands this the <svg>.
 */
import type { CometPuzzle } from './engine.ts';

export const U = 100;
export const PAD = 6;

const SVG_NS = 'http://www.w3.org/2000/svg';

/*
 * A hue per comet, taken from where its head sits rather than from its index,
 * so a comet keeps its colour no matter what order the board was solved in.
 */
export function cometColour(head: number, n: number, dark: boolean): string {
  const hue = ((head * 47 + ((head / n) | 0) * 13) * 7) % 360;
  return dark ? `hsl(${hue} 70% 62%)` : `hsl(${hue} 62% 42%)`;
}

/*
 * The palette the CSS is actually serving. styles.css takes dark as the base
 * and applies light only when the system asks for it or the button pins it, so
 * a pin has to win over the media query here in exactly the same order.
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

interface CellNodes {
  fill: SVGRectElement;
  tail: SVGPathElement;
}

interface HeadNodes {
  ring: SVGCircleElement;
  label: SVGTextElement;
}

export class CometBoard {
  private puzzle: CometPuzzle | null = null;
  private rect: DOMRect | null = null;
  private cells: CellNodes[] = [];
  private heads = new Map<number, HeadNodes>();
  private dark = darkTheme();
  private cursorRing: SVGRectElement | null = null;

  constructor(private readonly svg: SVGSVGElement) {}

  /*
   * Comet colours are generated hues rather than palette tokens, so unlike
   * every other colour on the board they cannot be a var() the browser
   * re-resolves. Watching both routes to a theme is what keeps them in step.
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

  private cx(cell: number): number { return (cell % this.puzzle!.n) * U + U / 2; }
  private cy(cell: number): number { return ((cell / this.puzzle!.n) | 0) * U + U / 2; }

  /** `covered` withholds the numbers, so a board cannot be read before the clock. */
  setPuzzle(puzzle: CometPuzzle, covered = false): void {
    this.puzzle = puzzle;
    this.rect = null;
    this.cells = [];
    this.heads.clear();
    this.cursorRing = null;
    const { n } = puzzle;

    this.svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${n * U + 2 * PAD} ${n * U + 2 * PAD}`);
    this.svg.replaceChildren();
    this.svg.appendChild(node('rect', {
      x: 0, y: 0, width: n * U, height: n * U, rx: 14,
      fill: 'var(--board)', stroke: 'var(--line)', 'stroke-width': 2
    }));

    // Group order is load-bearing: the first <g> is one rect per cell.
    const fills = node('g', {});
    const tails = node('g', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' });
    const marks = node('g', {});
    for (let cell = 0; cell < n * n; cell++) {
      const fill = node('rect', {
        x: (cell % n) * U + 1, y: ((cell / n) | 0) * U + 1,
        width: U - 2, height: U - 2, fill: 'transparent'
      });
      fills.appendChild(fill);
      const tail = node('path', { d: '', stroke: 'transparent', 'stroke-width': U * 0.5, opacity: 0 });
      tails.appendChild(tail);
      this.cells.push({ fill, tail });
    }

    const grid = node('g', { stroke: 'var(--line)', 'stroke-width': 1.5, opacity: 0.55 });
    for (let i = 1; i < n; i++) {
      grid.appendChild(node('line', { x1: i * U, y1: 0, x2: i * U, y2: n * U }));
      grid.appendChild(node('line', { x1: 0, y1: i * U, x2: n * U, y2: i * U }));
    }

    for (const clue of puzzle.clues) {
      const ring = node('circle', {
        cx: this.cx(clue.cell), cy: this.cy(clue.cell), r: U * 0.3,
        fill: 'var(--board)', stroke: 'var(--ink)', 'stroke-width': 5
      });
      const label = node('text', {
        x: this.cx(clue.cell), y: this.cy(clue.cell),
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': U * 0.42, 'font-weight': 700, fill: 'var(--ink)'
      });
      label.textContent = covered ? '' : (clue.len > 0 ? String(clue.len) : '');
      marks.appendChild(ring);
      marks.appendChild(label);
      this.heads.set(clue.cell, { ring, label });
    }

    this.svg.append(fills, tails, grid, marks);
    this.svg.classList.toggle('covered', covered);
  }

  showCursor(cell: number): void {
    if (!this.puzzle) return;
    if (!this.cursorRing) {
      this.cursorRing = node('rect', {
        x: 0, y: 0, width: U - 14, height: U - 14, rx: 10,
        fill: 'none', stroke: 'var(--accent)', 'stroke-width': 5,
        'stroke-dasharray': '14 10', opacity: 0
      });
      this.svg.appendChild(this.cursorRing);
    }
    if (cell < 0) { this.cursorRing.setAttribute('opacity', '0'); return; }
    const n = this.puzzle.n;
    this.cursorRing.setAttribute('x', String((cell % n) * U + 7));
    this.cursorRing.setAttribute('y', String((((cell / n) | 0) * U) + 7));
    this.cursorRing.setAttribute('opacity', '1');
  }

  /**
   * `flights` maps a head cell to the cells its comet currently covers, head
   * first. A head with no entry has not been flown yet.
   */
  draw(flights: ReadonlyMap<number, readonly number[]>, clash: ReadonlySet<number>, solved: boolean): void {
    if (!this.puzzle) return;
    const n = this.puzzle.n;
    const owner = new Int32Array(n * n).fill(-1);
    for (const [head, cells] of flights) for (const cell of cells) owner[cell] = head;

    for (let cell = 0; cell < n * n; cell++) {
      const nodes = this.cells[cell]!;
      const head = owner[cell]!;
      const colour = head >= 0 ? cometColour(head, n, this.dark) : 'transparent';
      nodes.fill.setAttribute('fill', head >= 0 ? colour : 'transparent');
      nodes.fill.setAttribute('opacity', head >= 0 ? (clash.has(cell) ? '0.30' : '0.20') : '0');
    }

    // One stroke per comet, drawn on the tail node of its head cell.
    for (const nodes of this.cells) nodes.tail.setAttribute('opacity', '0');
    for (const [head, cells] of flights) {
      const nodes = this.cells[head]!;
      const colour = solved ? 'var(--good)' : cometColour(head, n, this.dark);
      const last = cells[cells.length - 1]!;
      nodes.tail.setAttribute('d', `M${this.cx(head)} ${this.cy(head)} L${this.cx(last)} ${this.cy(last)}`);
      nodes.tail.setAttribute('stroke', colour);
      nodes.tail.setAttribute('opacity', clash.has(head) ? '0.45' : '0.85');
    }

    for (const [cell, head] of this.heads) {
      const flown = flights.has(cell);
      head.ring.setAttribute('stroke', solved ? 'var(--good)'
        : clash.has(cell) ? 'var(--bad)'
        : flown ? cometColour(cell, n, this.dark) : 'var(--ink)');
      head.ring.setAttribute('fill', 'var(--board)');
    }
  }

  /** Reveal the numbers the cover was holding back. */
  uncover(): void {
    if (!this.puzzle) return;
    this.svg.classList.remove('covered');
    for (const clue of this.puzzle.clues) {
      const head = this.heads.get(clue.cell);
      if (head) head.label.textContent = clue.len > 0 ? String(clue.len) : '';
    }
  }
}

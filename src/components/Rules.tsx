import { useEffect, useRef } from 'react';
import type { GameMeta } from '../shell/registry.ts';
import { PATCH_DIAGRAM, QUEENS_DIAGRAM, ZIP_DIAGRAM } from './diagrams.ts';

interface Props {
  game: GameMeta;
  onClose: () => void;
}

/*
 * How to play. Opened from the header, and once automatically the first time
 * you meet a game — which is the only moment the rules are actually wanted.
 */
export default function Rules({ game, onClose }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<Element | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      (restoreTo.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="sheet" id="rules" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rulesTitle"
        tabIndex={-1}
        ref={panel}
      >
        <header className="sheet-head">
          <h2 id="rulesTitle">How to play {game.name}</h2>
          <button className="icon-btn" id="rulesClose" onClick={onClose} aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="sheet-body">
          <p className="rules-goal" id="rulesGoal">{game.howTo.goal}</p>
          <Diagram id={game.id} />

          <h3 className="rules-heading">The rules</h3>
          <ol className="rules-list" id="rulesList">
            {game.howTo.rules.map((rule, i) => (
              <li key={i}>
                <b>{rule.what}</b>
                {rule.detail && <span className="muted"> {rule.detail}</span>}
              </li>
            ))}
          </ol>

          <h3 className="rules-heading">Controls</h3>
          <dl className="rules-controls" id="rulesControls">
            {game.howTo.controls.map((control, i) => (
              <div key={i}>
                <dt><kbd>{control.keys}</kbd></dt>
                <dd>{control.what}</dd>
              </div>
            ))}
          </dl>

          <h3 className="rules-heading">Worth knowing</h3>
          <ul className="rules-tips" id="rulesTips">
            {game.howTo.tips.map((tip, i) => <li key={i} className="muted">{tip}</li>)}
          </ul>
        </div>

        {/*
          * The X in the top-right corner was the only affirmative way out, and
          * on a phone held one-handed that is the hardest point on the screen
          * to reach -- a backdrop tap being something nobody discovers. This is
          * the same dismissal, where the thumb already is. It sits outside the
          * scrolling body on purpose, so it never has to be read down to.
          */}
        <footer className="sheet-foot">
          <button className="btn primary sheet-dismiss" id="rulesGotIt" onClick={onClose}>
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}

/*
 * A small worked picture, drawn from the data in diagrams.ts — which
 * test/diagrams.js checks against the games' own engines, so the illustration
 * cannot contradict the rule printed beside it.
 */
function Diagram({ id }: { id: string }) {
  const U = 40;
  if (id === 'zip') {
    const { rows, cols, waypoints, walls, solution } = ZIP_DIAGRAM;
    const cx = (cell: number) => (cell % cols) * U + U / 2;
    const cy = (cell: number) => ((cell / cols) | 0) * U + U / 2;
    return (
      <svg className="diagram" viewBox="-6 -6 132 132" role="img"
           aria-label="A three by three board with one line through every square, taking 1, 2 and 3 in order and going around a wall.">
        <rect x="0" y="0" width={cols * U} height={rows * U} rx="8"
              fill="var(--board)" stroke="var(--line)" strokeWidth="2" />
        <g stroke="var(--line)" strokeWidth="1.5">
          {[1, 2].map(i => <line key={`v${i}`} x1={i * U} y1="4" x2={i * U} y2={rows * U - 4} />)}
          {[1, 2].map(i => <line key={`h${i}`} x1="4" y1={i * U} x2={cols * U - 4} y2={i * U} />)}
        </g>
        <polyline points={solution.map(c => `${cx(c)},${cy(c)}`).join(' ')} fill="none"
                  stroke="var(--path)" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
        {walls.map(([a, b]) => {
          const vertical = Math.abs(a - b) === 1;
          const x = vertical ? (b % cols) * U : (a % cols) * U;
          const y = vertical ? ((a / cols) | 0) * U : ((b / cols) | 0) * U;
          return vertical
            ? <line key={`${a}-${b}`} x1={x} y1={y + 4} x2={x} y2={y + U - 4}
                    stroke="var(--wall)" strokeWidth="7" strokeLinecap="round" />
            : <line key={`${a}-${b}`} x1={x + 4} y1={y} x2={x + U - 4} y2={y}
                    stroke="var(--wall)" strokeWidth="7" strokeLinecap="round" />;
        })}
        {waypoints.map((cell, i) => (
          <g key={cell}>
            <circle cx={cx(cell)} cy={cy(cell)} r="13" fill="var(--accent)" />
            <text x={cx(cell)} y={cy(cell)} textAnchor="middle" dominantBaseline="central"
                  fontSize="16" fontWeight="700" fill="var(--accent-ink)">{i + 1}</text>
          </g>
        ))}
      </svg>
    );
  }

  if (id === 'patch') {
    const { n, clues, solution } = PATCH_DIAGRAM;
    const size = 120 / n;
    const hues = ['hsl(20 62% 52%)', 'hsl(200 62% 52%)', 'hsl(150 55% 45%)'];
    return (
      <svg className="diagram" viewBox="-6 -6 132 132" role="img"
           aria-label="A three by three board covered by three boxes: a 3 as a tall strip of three squares, a 4 as a two by two square, and a 2 lying flat.">
        <rect x="0" y="0" width="120" height="120" rx="8"
              fill="var(--board)" stroke="var(--line)" strokeWidth="2" />
        {solution.map((rect, i) => (
          <g key={i}>
            <rect x={rect.c0 * size + 3} y={rect.r0 * size + 3}
                  width={rect.w * size - 6} height={rect.h * size - 6} rx="7"
                  fill={hues[i % hues.length]} opacity="0.24" />
            <rect x={rect.c0 * size + 3} y={rect.r0 * size + 3}
                  width={rect.w * size - 6} height={rect.h * size - 6} rx="7"
                  fill="none" stroke={hues[i % hues.length]} strokeWidth="4" />
          </g>
        ))}
        <g stroke="var(--line)" strokeWidth="1.5" opacity="0.45">
          {[1, 2].map(i => <line key={`v${i}`} x1={i * size} y1="4" x2={i * size} y2="116" />)}
          {[1, 2].map(i => <line key={`h${i}`} x1="4" y1={i * size} x2="116" y2={i * size} />)}
        </g>
        {clues.map(clue => (
          <text key={clue.cell}
                x={(clue.cell % n) * size + size / 2} y={((clue.cell / n) | 0) * size + size / 2}
                textAnchor="middle" dominantBaseline="central"
                fontSize="18" fontWeight="700" fill="var(--ink)">{clue.area}</text>
        ))}
      </svg>
    );
  }

  const { n, regions, solution } = QUEENS_DIAGRAM;
  const size = 120 / n;
  const tints = ['hsl(8 40% 30%)', 'hsl(152 40% 26%)', 'hsl(214 40% 30%)', 'hsl(292 38% 32%)'];
  return (
    <svg className="diagram" viewBox="-6 -6 132 132" role="img"
         aria-label="A four by four board in four colours with one queen in every row, column and colour, none of them touching.">
      {regions.map((region, cell) => (
        <rect key={cell} x={(cell % n) * size} y={((cell / n) | 0) * size}
              width={size} height={size} fill={tints[region % tints.length]} />
      ))}
      <g stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" opacity="0.85">
        {regions.map((region, cell) => {
          const row = (cell / n) | 0;
          const col = cell % n;
          const edges = [];
          if (col + 1 < n && regions[cell + 1] !== region) {
            edges.push(<line key={`v${cell}`} x1={(col + 1) * size} y1={row * size}
                             x2={(col + 1) * size} y2={(row + 1) * size} />);
          }
          if (row + 1 < n && regions[cell + n] !== region) {
            edges.push(<line key={`h${cell}`} x1={col * size} y1={(row + 1) * size}
                             x2={(col + 1) * size} y2={(row + 1) * size} />);
          }
          return edges;
        })}
      </g>
      <rect x="0" y="0" width="120" height="120" rx="8" fill="none"
            stroke="var(--line)" strokeWidth="2" />
      {solution.map((col, row) => (
        <path key={row} d="M -9 5 L -11 -6 L -5 -2 L 0 -8 L 5 -2 L 11 -6 L 9 5 Z"
              transform={`translate(${col * size + size / 2},${row * size + size / 2})`}
              fill="var(--ink)" />
      ))}
    </svg>
  );
}

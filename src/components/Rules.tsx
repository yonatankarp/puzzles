import { useEffect, useRef } from 'react';
import type { GameMeta } from '../shell/registry.ts';
import Diagram from './Diagram.tsx';

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

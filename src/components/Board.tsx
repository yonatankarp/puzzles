import type { Ref } from 'react';
import type { Snapshot } from '../shell/types.ts';
import { gameById } from '../shell/registry.ts';
import ReadyGate from './ReadyGate.tsx';

interface Props {
  ref: Ref<SVGSVGElement>;
  regionRef: Ref<HTMLDivElement>;
  announcerRef: Ref<HTMLDivElement>;
  snap: Snapshot;
  onStart: () => void;
  onHelp: () => void;
}

/*
 * React owns the frame around the board -- busy state, banner, progress bar --
 * but never the board's contents. Everything inside the <svg> is drawn
 * imperatively by BoardView, because it changes on every pointermove and every
 * animation frame: a mutation workload, not a reconciliation one.
 *
 * For assistive technology the <svg> is decorative. The accessible interface is
 * the focusable application region wrapping it, whose label carries the current
 * state, plus a live region that announces each move as it happens.
 */
export default function Board({ ref, regionRef, announcerRef, snap, onStart, onHelp }: Props) {
  const progress = snap.total ? (snap.done / snap.total) * 100 : 0;
  const label =
    `${snap.sizeLabel} board. ` +
    `${snap.done} of ${snap.total} ${snap.unit}. ` +
    (snap.solved ? 'Solved.' : snap.goal);
  const hidden = snap.phase !== 'playing';
  /*
   * This frame is shared, so the instructions behind aria-describedby cannot be
   * written into it: the literal that used to sit here read out Zip's rules and
   * Zip's keys to anyone playing Queens. Each game states its own, once, in the
   * registry beside the rules the sheet shows. Nothing from the snapshot stands
   * in for it: this is instructions, and instructions that changed as the run
   * went along would be read out afresh every time they did.
   */
  const help = gameById(snap.gameId)?.howTo.help ?? '';

  return (
    <>
      <div className="boardwrap">
        <div
          className="board-region"
          role="application"
          tabIndex={0}
          aria-label={hidden ? 'Board not yet revealed. Press Start to begin.' : label}
          aria-describedby="boardHelp"
          ref={regionRef}
        >
          <svg
            className={`board${snap.busy ? ' busy' : ''}${hidden ? ' covered' : ''}`}
            id="board" ref={ref} aria-hidden="true"
          />
        </div>
        <ReadyGate snap={snap} onStart={onStart} onHelp={onHelp} />
        <div className={`banner${snap.banner ? ' show' : ''}`} id="banner">
          <b id="bannerText" style={{ color: bannerColour(snap) }}>
            {snap.banner?.text}
            {snap.banner?.sub ? <small>{snap.banner.sub}</small> : null}
          </b>
        </div>
      </div>
      <p id="boardHelp" className="sr-only">{help}</p>
      <div id="announcer" className="sr-only" aria-live="polite" aria-atomic="true" ref={announcerRef} />
      {/* What the bar counts is the game's own word for it, not Zip's. */}
      <div
        className="progress"
        role="progressbar"
        aria-label={snap.unit}
        aria-valuemin={0}
        aria-valuemax={snap.total}
        aria-valuenow={snap.done}
      >
        <i
          id="progressFill"
          className={snap.solved ? 'done' : ''}
          style={{
            width: `${progress}%`,
            // Same ramp as the line, so the bar and the board agree.
            background: snap.solved ? undefined : (snap.progressColour ?? undefined)
          }}
        />
      </div>
    </>
  );
}

function bannerColour(snap: Snapshot): string {
  switch (snap.banner?.kind) {
    case 'bad': return 'var(--bad)';
    case 'wait': return 'var(--dim)';
    default: return 'var(--good)';
  }
}

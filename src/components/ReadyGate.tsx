import type { Snapshot } from '../shell/types.ts';

interface Props {
  snap: Snapshot;
  onStart: () => void;
  onHelp: () => void;
}

/*
 * The board is covered until you say you are ready, and the clock starts the
 * moment it is uncovered. Studying a board for free beforehand made every
 * recorded time a fiction.
 *
 * The cover is a blur rather than an empty box so the shape of the grid is
 * still legible — you can see what size you are about to get, without being
 * able to read it.
 */
export default function ReadyGate({ snap, onStart, onHelp }: Props) {
  if (snap.phase === 'playing' || !snap.ready) return null;

  const counting = snap.phase === 'counting';
  return (
    <div className={`gate${counting ? ' counting' : ''}`} id="readyGate">
      {counting
        ? (
          <div className="count" id="countdown" aria-live="assertive" aria-atomic="true">
            <span key={snap.countdown}>{snap.countdown}</span>
          </div>
        )
        : (
          <>
            <button className="btn primary start" id="startBtn" onClick={onStart}>
              Start
              <small>
                {snap.mode === 'daily' ? `Daily #${snap.day}` : snap.difficultyLabel}
                {' · '}{snap.sizeLabel} · the clock starts on reveal
              </small>
            </button>
            {/* The ? in the header is one of three identical icons and nobody
                finds it. This is the moment the rules are actually wanted. */}
            <button className="linkish" id="gateHelpBtn" onClick={onHelp}>How to play</button>
          </>
        )}
    </div>
  );
}

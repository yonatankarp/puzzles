import { useEffect, useState } from 'react';
import { formatDuration } from '../shell/daily.ts';
import { GAMES } from '../shell/registry.ts';
import { gameHref } from '../shell/route.ts';
import type { Snapshot } from '../shell/types.ts';

interface Props {
  snap: Snapshot;
  onStart: () => void;
  onHelp: () => void;
}

/** How often the "next puzzle in" line is redrawn. */
const TICK_MS = 30_000;

/*
 * Whole hours and minutes to the next puzzle. Days turn over at UTC midnight --
 * the same instant everywhere -- so the wait is computed against that rather
 * than the player's own midnight.
 */
function untilRollover(now: number): string {
  const at = new Date(now);
  const next = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
  const minutes = Math.max(1, Math.ceil((next - now) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/*
 * The board is covered until you say you are ready, and the clock starts the
 * moment it is uncovered. Studying a board for free beforehand made every
 * recorded time a fiction.
 *
 * The cover is a blur rather than an empty box so the shape of the grid is
 * still legible — you can see what size you are about to get, without being
 * able to read it.
 *
 * "Reveal" is deliberately not the word used here. The button of that name a
 * few inches below means "show me the answer", and the two senses sitting that
 * close together cost people their daily.
 */
export default function ReadyGate({ snap, onStart, onHelp }: Props) {
  const done = snap.mode === 'daily' ? snap.dailyResult : null;
  const [now, setNow] = useState(() => Date.now());

  /*
   * Only the finished gate counts down, and only it needs a clock. The
   * dependency is a boolean rather than the result object, which the core hands
   * over freshly built on every published frame.
   */
  const finished = !!done;
  useEffect(() => {
    if (!finished) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [finished]);

  if (snap.phase === 'playing' || !snap.ready) return null;

  if (snap.phase === 'counting') {
    return (
      <div className="gate counting" id="readyGate">
        <div className="count" id="countdown" aria-live="assertive" aria-atomic="true">
          <span key={snap.countdown}>{snap.countdown}</span>
        </div>
      </div>
    );
  }

  /*
   * Today is already in the books: the first solve of a day is the one that
   * counts, so a second run changes nothing. Offering the same full-width Start
   * as an unplayed day pointed the most prominent control on the screen at
   * nothing. What is left that is real: how it went, when the next one lands,
   * and the other game.
   */
  if (done) {
    const other = GAMES.find(game => game.id !== snap.gameId && game.ready);
    return (
      <div className="gate" id="readyGate">
        <div className="btn start" id="gateDone" style={{ cursor: 'default' }}>
          Solved in {formatDuration(done.ms)}
          <small>
            Daily #{snap.day} · {snap.difficultyLabel} · {snap.sizeLabel}
            {done.hinted && ' · used a hint'}
          </small>
          <small>
            {snap.streak >= 2 && <>🔥 {snap.streak} day streak · </>}
            next puzzle in {untilRollover(now)}
          </small>
        </div>
        <button className="linkish" id="replayBtn" onClick={onStart}>
          Play it again — today’s time is already banked
        </button>
        {other && (
          <button className="linkish" id="otherGameBtn" onClick={() => { location.hash = gameHref(other.id); }}>
            Or today’s {other.name}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="gate" id="readyGate">
      <button className="btn primary start" id="startBtn" onClick={onStart}>
        Start
        <small>
          {snap.mode === 'daily' ? `Daily #${snap.day} · ${snap.difficultyLabel}` : snap.difficultyLabel}
          {' · '}{snap.sizeLabel}
        </small>
        <small>the clock starts when the board is uncovered</small>
      </button>
      {/* The ? in the header is one of three identical icons and nobody
          finds it. This is the moment the rules are actually wanted. */}
      <button className="linkish" id="gateHelpBtn" onClick={onHelp}>How to play</button>
    </div>
  );
}

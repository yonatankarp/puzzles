import { formatDuration as formatTime } from '../shell/daily.ts';
import type { Snapshot } from '../shell/types.ts';
import Seed from './Seed.tsx';

interface Props {
  snap: Snapshot;
  onToggleAutoNext: () => void;
  onShareSeed: () => Promise<'shared' | 'copied' | 'cancelled' | 'failed'>;
}

export default function Status({ snap, onToggleAutoNext, onShareSeed }: Props) {
  const { session } = snap;
  const summary = session.solved
    ? `${session.solved} solved · avg ${formatTime(session.total / session.solved)}` +
      (session.streak >= 2 ? ` · streak ${session.streak}` : '')
    : 'no solves yet';

  return (
    <>
      <div className="status">
        <div>
          <b id="filled">{snap.done}</b> / <span id="total">{snap.total}</span>
          {snap.backtracks > 0 && <span id="backtracks"> · ↩ {snap.backtracks}</span>}
        </div>
        <div id="tierStats">{snap.difficultyLabel} · {snap.sizeLabel}</div>
        <div>best <b id="best">{snap.best === null ? '—' : formatTime(snap.best)}</b></div>
      </div>
      {/* Its own row: the code and the box to paste one into are a pair, and
          sharing a line with Auto-next wrapped both of them. */}
      <div className="status">
        <Seed snap={snap} onShare={onShareSeed} />
      </div>
      {snap.mode === 'practice' && (
        <div className="status">
          <button className="chip" id="autoBtn" aria-pressed={snap.autoNext} onClick={onToggleAutoNext}>
            <span className="dot" />Auto-next
          </button>
          <div id="session">{summary}</div>
        </div>
      )}
    </>
  );
}

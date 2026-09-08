import { useEffect, useState } from 'react';
import type { Snapshot } from '../shell/types.ts';

interface Props {
  snap: Snapshot;
  onShare: () => Promise<'shared' | 'copied' | 'cancelled' | 'failed'>;
}

/** How long the chip reports what happened before going back to the seed. */
const TOLD_MS = 1600;

/*
 * Every board comes from one number, so two people holding the same number are
 * playing the same board -- which is the whole of racing someone here. Showing
 * it turns "I got 41 seconds" into something the other person can check.
 *
 * It is a button rather than text because a number you cannot get off the
 * screen is no use: tapping hands over the link that rebuilds this exact board.
 */
export default function Seed({ snap, onShare }: Props) {
  const [told, setTold] = useState<string | null>(null);

  useEffect(() => {
    if (!told) return;
    const timer = window.setTimeout(() => setTold(null), TOLD_MS);
    return () => clearTimeout(timer);
  }, [told]);

  // Nothing to name until a board has actually been generated.
  if (!snap.ready) return null;

  const share = () => {
    void onShare().then(outcome => {
      if (outcome === 'cancelled') return;
      setTold(outcome === 'failed' ? 'Copy failed' : outcome === 'copied' ? 'Link copied' : 'Shared');
    });
  };

  return (
    <button
      className="chip seed" id="seedBtn" onClick={share}
      /* The label changes to report the outcome, so it has to be spoken. */
      aria-live="polite"
      title={snap.mode === 'daily'
        ? `Today's board is built from seed ${snap.seedCode} — share it`
        : `Share this exact board: ${snap.difficultyLabel}, seed ${snap.seedCode}`}
    >
      {told ?? <>seed <b id="seedCode">{snap.seedCode}</b></>}
    </button>
  );
}

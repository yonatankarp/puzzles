import { useEffect, useState } from 'react';
import type { Mode, Phase } from '../shell/types.ts';

interface Props {
  mode: Mode;
  phase: Phase;
  onNew: () => void;
  onRestart: () => void;
  onUndo: () => void;
  onHint: () => void;
  onReveal: () => void;
}

/** How long a Reveal stays armed before the question lapses. */
const ARM_MS = 5000;

/*
 * Reveal is the only control here that cannot be taken back: it hands over the
 * solution, and a daily given away that way is never recorded, however honestly
 * it is finished afterwards. Sitting next to Hint and styled identically, it was
 * one tap from a broken streak -- so in daily mode it asks first, and only the
 * second tap gives the answer away. Practice has nothing at stake and still
 * reveals on the first tap.
 */
export default function Controls({ mode, phase, onNew, onRestart, onUndo, onHint, onReveal }: Props) {
  /*
   * Nothing here can act on a board that has not been uncovered. The shell
   * refuses these anyway and says why, but a control that looks live and does
   * nothing is its own small lie -- and Reveal looking live over a covered
   * daily was how the whole trap read as harmless.
   */
  const idle = phase !== 'playing';
  const why = idle ? 'The board is still covered — press Start first' : undefined;
  const [armed, setArmed] = useState(false);

  // A question left standing is a trap of its own, so it lapses by itself.
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  // Switching modes, or leaving play, must not leave a live confirmation behind.
  useEffect(() => { setArmed(false); }, [mode, phase]);

  const reveal = () => {
    if (mode !== 'daily') { onReveal(); return; }
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    onReveal();
  };

  return (
    <div className="controls">
      <button
        className="btn primary" id="newBtn" onClick={onNew}
        disabled={mode === 'daily'}
        title={mode === 'daily' ? 'There is one puzzle a day' : 'New puzzle'}
      >
        New
      </button>
      <button className="btn" id="restartBtn" onClick={onRestart} disabled={idle} title={why}>Restart</button>
      <button className="btn" id="undoBtn" onClick={onUndo} disabled={idle} title={why}>Undo</button>
      <button className="btn" id="hintBtn" onClick={onHint} disabled={idle} title={why}>Hint</button>
      <button
        className="btn" id="revealBtn" onClick={reveal} disabled={idle}
        /* The changed label is the confirmation, so it has to be spoken too. */
        aria-live="polite"
        style={armed ? { borderColor: 'var(--bad)', color: 'var(--bad)' } : undefined}
        title={why ?? (mode === 'daily'
          ? 'Shows the solution — today’s daily will not count'
          : 'Show the solution')}
      >
        {armed ? 'Sure?' : 'Reveal'}
      </button>
    </div>
  );
}

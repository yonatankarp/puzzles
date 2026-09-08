import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../shell/types.ts';
import { decodeBoardCode, encodeBoardCode } from '../shell/seed.ts';
import { codeHref } from '../shell/route.ts';
import { gameByCode } from '../shell/registry.ts';

interface Props {
  snap: Snapshot;
  onShare: () => Promise<'shared' | 'copied' | 'cancelled' | 'failed'>;
}

/** How long the chip reports what happened before going back to the code. */
const TOLD_MS = 1600;

/*
 * Every board comes from one code, and the code says everything needed to find
 * that board again: which game, which difficulty, which seed. Two people
 * holding the same code are playing the same board, which is the whole of
 * racing someone here.
 *
 * Both directions are on screen, because one without the other is useless: the
 * code you are playing, to hand out, and somewhere to put the one you were
 * given.
 */
export default function Seed({ snap, onShare }: Props) {
  const [told, setTold] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!told) return;
    const timer = window.setTimeout(() => setTold(null), TOLD_MS);
    return () => clearTimeout(timer);
  }, [told]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  if (!snap.ready || !snap.boardCode) return null;

  /*
   * No entry on the daily tab. There is one daily board and it is not yours to
   * choose -- and a code box there would be offering to replace it, which is
   * the one thing that must not happen: practising today's board and then
   * recording a time for it would leave a real time and a real streak with
   * nothing anywhere showing the board had been seen before.
   */
  const canPlayCodes = snap.mode === 'practice';

  const share = () => {
    void onShare().then(outcome => {
      if (outcome === 'cancelled') return;
      setTold(outcome === 'failed' ? 'Copy failed' : outcome === 'copied' ? 'Link copied' : 'Shared');
    });
  };

  const play = (event: React.FormEvent) => {
    event.preventDefault();
    const board = decodeBoardCode(entry);
    /*
     * Say which half is wrong. A code that fails its check character is a typo
     * and worth another look; a code for a game that is not here is not.
     */
    if (!board) { setProblem('That is not a board code'); return; }
    if (!gameByCode(board.game)) { setProblem(`No game called ${board.game}`); return; }
    /*
     * Navigate with the code rebuilt from what was decoded, not with the text
     * that was typed. The decoder already accepts a whole pasted link, in any
     * case, with stray spaces -- re-deriving the code here is what stops those
     * differences from having to be untangled twice, wrongly the second time.
     */
    const canonical = encodeBoardCode(board.game, board.tier, board.seed);
    if (!canonical) { setProblem('That is not a board code'); return; }
    setProblem(null);
    setOpen(false);
    setEntry('');
    location.hash = codeHref(canonical);
  };

  return (
    <div className="seedbar">
      <button
        className="chip seed" id="seedBtn" onClick={share}
        /* The label changes to report the outcome, so it has to be spoken. */
        aria-live="polite"
        title={snap.mode === 'daily'
          ? `Today's board is ${snap.boardCode} — share it to check you are both on the same one`
          : `Share this exact board — ${snap.difficultyLabel}, code ${snap.boardCode}`}
      >
        {told ?? <b id="seedCode">{snap.boardCode}</b>}
      </button>

      {canPlayCodes && (open ? (
        <form className="seed-entry" onSubmit={play}>
          <input
            ref={inputRef} id="seedInput" value={entry} inputMode="text"
            autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            placeholder="ZIP-M-109YCCQK"
            aria-label="Play a board code"
            aria-invalid={problem !== null}
            onChange={e => { setEntry(e.target.value); setProblem(null); }}
            onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setProblem(null); } }}
          />
          <button className="chip" id="seedGoBtn" type="submit">Play</button>
        </form>
      ) : (
        <button className="chip" id="seedEnterBtn" onClick={() => setOpen(true)}>
          Play a code
        </button>
      ))}
      {problem && <span className="seed-problem" id="seedProblem" role="alert">{problem}</span>}
    </div>
  );
}

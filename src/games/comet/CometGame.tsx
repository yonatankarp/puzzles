import { useEffect, useRef, useState } from 'react';
import { CometCore } from './core.ts';
import Header from '../../components/Header.tsx';
import Modes from '../../components/Modes.tsx';
import Tiers from '../../components/Tiers.tsx';
import Board from '../../components/Board.tsx';
import Controls from '../../components/Controls.tsx';
import Status from '../../components/Status.tsx';
import DailyBar from '../../components/DailyBar.tsx';
import History from '../../components/History.tsx';
import type { SharedChrome } from '../zip/ZipGame.tsx';
import type { Snapshot } from '../../shell/types.ts';
import type { SeedRoute } from '../../shell/route.ts';

interface Props {
  shared: SharedChrome;
  /** A board someone sent you, from a #/<game>/s/<tier>/<seed> link. */
  seed: SeedRoute | null;
  onBack: () => void;
}

declare global {
  interface Window { __comet?: ReturnType<CometCore['testHooks']> }
}

export default function CometGame({ shared, seed, onBack }: Props) {
  const coreRef = useRef<CometCore | null>(null);
  coreRef.current ??= new CometCore();
  const core = coreRef.current;

  const boardRef = useRef<SVGSVGElement>(null);
  const fxRef = useRef<SVGSVGElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const announcerRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<Snapshot>(() => core.snapshot());

  useEffect(() => {
    core.bindClock(clockRef.current);
    core.bindAnnouncer(announcerRef.current);
    core.bindRegion(regionRef.current);
    const unsubscribe = core.subscribe(setSnap);
    core.attach(boardRef.current!, fxRef.current!);
    /*
     * The hook exposes the solution, which is fine for a random practice board
     * and not fine for a shared daily. Vite strips this branch from a
     * production build; the browser suite builds with `--mode test`, which
     * differs by this flag alone.
     */
    if (import.meta.env.MODE !== 'production' && location.search.includes('test')) {
      window.__comet = core.testHooks();
    }
    return () => {
      unsubscribe();
      core.destroy();
      if (import.meta.env.MODE !== 'production') delete window.__comet;
    };
  }, [core]);

  useEffect(() => { core.audio.mode = shared.soundMode; }, [core, shared.soundMode]);

  /*
   * A board someone sent. Practice, because a seed link names a tier and the
   * daily is the same board for everyone already. Keyed on the numbers rather
   * than the object so re-rendering does not reload the board underneath you.
   */
  useEffect(() => {
    if (!seed) return;
    core.loadBoardCode(seed.tier, seed.seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, seed?.tier, seed?.seed]);


  return (
    <>
      <svg className="fx" ref={fxRef} aria-hidden="true" />
      <div className="wrap">
        <Header
          title="Comet"
          onBack={onBack}
          clockRef={clockRef}
          soundMode={shared.soundMode}
          onCycleSound={shared.onCycleSound}
          onCycleTheme={shared.onCycleTheme}
          onHelp={shared.onHelp}
        />
        <Modes mode={snap.mode} onPick={mode => core.setMode(mode)} />
        {snap.mode === 'practice'
          ? <Tiers current={snap.difficulty} options={snap.difficulties} onPick={id => core.setDifficulty(id as never)} />
          : <DailyBar snap={snap} onShare={() => core.share()} />}
        <Board
          ref={boardRef} regionRef={regionRef} announcerRef={announcerRef}
          snap={snap} onStart={() => core.start()} onHelp={shared.onHelp}
        />
        <Controls
          mode={snap.mode}
          phase={snap.phase}
          onNew={() => core.newPuzzle()}
          onRestart={() => core.restart()}
          onUndo={() => core.undo()}
          onHint={() => core.hint()}
          onReveal={() => core.reveal()}
        />
        <Status snap={snap} onToggleAutoNext={() => core.toggleAutoNext()} onShareSeed={() => core.shareSeed()} />
        {snap.mode === 'daily' && <History snap={snap} />}
        <div className="footer">
          <button className="version" id="versionBtn" onClick={shared.onOpenChangelog}>
            v{shared.version}
            {shared.unseen && <span className="pip" id="versionPip" aria-hidden="true" />}
            <span className="sr-only"> — what&rsquo;s changed</span>
          </button>
        </div>
        <div className="hint">
          drag from a circle to fly its comet · tap it for a comet of one
          <span className="keys">
            {' · '}<kbd>space</kbd> next circle · <kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> fly ·{' '}
            <kbd>enter</kbd> one square ·{' '}
            <kbd>U</kbd> undo · <kbd>H</kbd> hint · <kbd>R</kbd> restart · <kbd>N</kbd> new
          </span>
        </div>
      </div>
    </>
  );
}

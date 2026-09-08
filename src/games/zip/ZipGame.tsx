import { useEffect, useRef, useState } from 'react';
import { GameCore } from './core.ts';
import Header from '../../components/Header.tsx';
import Modes from '../../components/Modes.tsx';
import Tiers from '../../components/Tiers.tsx';
import Board from '../../components/Board.tsx';
import Controls from '../../components/Controls.tsx';
import Status from '../../components/Status.tsx';
import DailyBar from '../../components/DailyBar.tsx';
import History from '../../components/History.tsx';
import type { Snapshot } from '../../shell/types.ts';
import type { SoundMode } from '../../shell/audio.ts';

export interface SharedChrome {
  soundMode: SoundMode;
  onCycleSound: () => void;
  onCycleTheme: () => void;
  version: string;
  unseen: boolean;
  onOpenChangelog: () => void;
  onHelp: () => void;
}

interface Props {
  shared: SharedChrome;
  onBack: () => void;
}

declare global {
  interface Window { __zip?: ReturnType<GameCore['testHooks']> }
}

export default function ZipGame({ shared, onBack }: Props) {
  const coreRef = useRef<GameCore | null>(null);
  coreRef.current ??= new GameCore();
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
      window.__zip = core.testHooks();
    }
    return () => {
      unsubscribe();
      core.destroy();
      if (import.meta.env.MODE !== 'production') delete window.__zip;
    };
  }, [core]);

  // Sound is a collection-wide preference; the game only plays it.
  useEffect(() => { core.audio.mode = shared.soundMode; }, [core, shared.soundMode]);

  return (
    <>
      <svg className="fx" ref={fxRef} aria-hidden="true" />
      <div className="wrap">
        <Header
          title="Zip"
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
        <Status snap={snap} onToggleAutoNext={() => core.toggleAutoNext()} />
        {snap.mode === 'daily' && <History snap={snap} />}
        <div className="footer">
          <button className="version" id="versionBtn" onClick={shared.onOpenChangelog}>
            v{shared.version}
            {shared.unseen && <span className="pip" id="versionPip" aria-hidden="true" />}
            <span className="sr-only"> — what&rsquo;s changed</span>
          </button>
        </div>
        <div className="hint">
          drag from <b>1</b>
          <span className="keys">
            {' · '}<kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> move ·{' '}
            <kbd>U</kbd> undo · <kbd>H</kbd> hint · <kbd>R</kbd> restart · <kbd>N</kbd> new
          </span>
        </div>
      </div>
    </>
  );
}

import type { RefObject } from 'react';
import { SOUND_LABEL, type SoundMode } from '../shell/audio.ts';

interface Props {
  /** Shown when inside a game; omitted on the index. */
  title?: string;
  onBack?: () => void;
  clockRef?: RefObject<HTMLDivElement | null>;
  soundMode: SoundMode;
  onCycleSound: () => void;
  onCycleTheme: () => void;
  /** Only inside a game: the index has the rules on its cards already. */
  onHelp?: () => void;
}

export default function Header({ title, onBack, clockRef, soundMode, onCycleSound, onCycleTheme, onHelp }: Props) {
  const audible = soundMode !== 'off';
  return (
    <header>
      {onBack && (
        <button className="icon-btn" id="backBtn" onClick={onBack} aria-label="All games" title="All games">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      )}
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="var(--accent)"></rect>
          <g fill="var(--accent-ink)">
            <rect x="8" y="8" width="7" height="7" rx="1.5"></rect>
            <rect x="17" y="8" width="7" height="7" rx="1.5"></rect>
            <rect x="8" y="17" width="7" height="7" rx="1.5"></rect>
            <rect x="17" y="17" width="7" height="7" rx="3.5"></rect>
          </g>
        </svg>
        <span className="brand-title">{title ?? 'Puzzles'}</span>
      </div>
      <div className="spacer" />
      {onHelp && (
        <button className="icon-btn" id="helpBtn" onClick={onHelp} title="How to play" aria-label="How to play">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.2 9.3a2.9 2.9 0 1 1 3.5 3.5v1.3" />
            <path d="M12 17.2v.1" />
          </svg>
        </button>
      )}
      <button
        className="icon-btn" id="soundBtn" onClick={onCycleSound}
        aria-pressed={audible} title={SOUND_LABEL[soundMode]} aria-label="Sound"
      >
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M4 9v6h4l5 4V5L8 9H4z" />
          <path id="soundWave" d="M15.5 9.5a3.5 3.5 0 0 1 0 5" style={{ display: audible ? '' : 'none' }} />
          <path id="soundWaveFar" d="M18.5 7a7 7 0 0 1 0 10" style={{ display: soundMode === 'all' ? '' : 'none' }} />
          <path id="soundMute" d="M17 9.5l4 5m0-5l-4 5" style={{ display: audible ? 'none' : '' }} />
        </svg>
      </button>
      <button className="icon-btn" id="themeBtn" onClick={onCycleTheme} title="Theme" aria-label="Theme">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" strokeLinejoin="round" />
        </svg>
      </button>
      {clockRef && <div className="clock" id="clock" ref={clockRef}>0:00.0</div>}
    </header>
  );
}

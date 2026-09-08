import { useEffect, useState } from 'react';
import Header from './components/Header.tsx';
import Index from './components/Index.tsx';
import Changelog from './components/Changelog.tsx';
import ZipGame from './games/zip/ZipGame.tsx';
import QueensGame from './games/queens/QueensGame.tsx';
import { CURRENT_VERSION } from './shell/changelog.ts';
import { gameById } from './shell/registry.ts';
import { indexHref, parseRoute, rememberGame } from './shell/route.ts';
import { applyTheme, read as readPref, write as writePref, type Theme } from './shell/prefs.ts';
import { SOUND_MODES, type SoundMode } from './shell/audio.ts';

export default function App() {
  const [route, setRoute] = useState(() => parseRoute());
  const [seenVersion, setSeenVersion] = useState(() => readPref('app.seenVersion'));

  // App-wide preferences live here so the index has them too, not only a game.
  const [theme, setTheme] = useState<Theme>(() => (readPref('app.theme') as Theme) ?? 'system');
  const [sound, setSound] = useState<SoundMode>(() => {
    const stored = readPref('app.sound');
    return stored === 'on' ? 'all' : SOUND_MODES.includes(stored as SoundMode) ? stored as SoundMode : 'off';
  });

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { rememberGame(route.game); }, [route.game]);

  useEffect(() => {
    const sync = () => setRoute(parseRoute());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const go = (hash: string) => { location.hash = hash; };

  const cycleTheme = () => {
    const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
    writePref('app.theme', next);
  };
  const cycleSound = () => {
    const next = SOUND_MODES[(SOUND_MODES.indexOf(sound) + 1) % SOUND_MODES.length]!;
    setSound(next);
    writePref('app.sound', next);
  };

  const openChangelog = () => {
    writePref('app.seenVersion', CURRENT_VERSION);
    setSeenVersion(CURRENT_VERSION);
    history.pushState({ zip: 'changelog' }, '', '#changelog');
    setRoute(parseRoute('#changelog'));
  };
  const closeChangelog = () => {
    if (history.state?.zip === 'changelog') history.back();
    else {
      history.replaceState(null, '', location.pathname + location.search);
      setRoute(parseRoute(''));
    }
  };

  const meta = route.game ? gameById(route.game) : undefined;
  const shared = {
    soundMode: sound,
    onCycleSound: cycleSound,
    onCycleTheme: cycleTheme,
    version: CURRENT_VERSION,
    unseen: seenVersion !== CURRENT_VERSION,
    onOpenChangelog: openChangelog
  };

  return (
    <>
      {meta?.id === 'zip' && <ZipGame key="zip" shared={shared} onBack={() => go(indexHref)} />}
      {meta?.id === 'queens' && <QueensGame key="queens" shared={shared} onBack={() => go(indexHref)} />}
      {!meta && (
        <div className="wrap">
          <Header soundMode={sound} onCycleSound={cycleSound} onCycleTheme={cycleTheme} />
          <Index onOpen={id => go(`#/${id}`)} />
          <div className="footer">
            <button className="version" id="versionBtn" onClick={openChangelog}>
              v{CURRENT_VERSION}
              {shared.unseen && <span className="pip" id="versionPip" aria-hidden="true" />}
              <span className="sr-only"> — what&rsquo;s changed</span>
            </button>
          </div>
        </div>
      )}
      {route.changelog && <Changelog onClose={closeChangelog} />}
    </>
  );
}

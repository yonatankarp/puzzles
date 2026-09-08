import { useEffect, useState } from 'react';
import Header from './components/Header.tsx';
import Index from './components/Index.tsx';
import Changelog from './components/Changelog.tsx';
import Rules from './components/Rules.tsx';
import ZipGame from './games/zip/ZipGame.tsx';
import QueensGame from './games/queens/QueensGame.tsx';
import { CURRENT_VERSION } from './shell/changelog.ts';
import { gameById } from './shell/registry.ts';
import { gameHref, helpHref, indexHref, parseRoute, rememberGame } from './shell/route.ts';
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

  const openOverlay = (name: 'changelog' | 'help', game?: string | null) => {
    // Help is always a game's help; there is no such page without one.
    if (name === 'help' && !game) return;
    const hash = name === 'help' ? helpHref(game!) : `#${name}`;
    history.pushState({ overlay: name }, '', hash);
    setRoute(parseRoute(hash));
  };

  /*
   * Only step back if an overlay is what put an entry on the stack. Someone
   * arriving on a shared link has no entry of ours behind them, and going back
   * would take them off the site altogether -- so close onto whatever the
   * overlay was covering, which for #/zip/help is the game itself.
   */
  const closeOverlay = () => {
    if (history.state?.overlay) return history.back();
    const hash = route.game ? gameHref(route.game) : '';
    history.replaceState(null, '', location.pathname + location.search + hash);
    setRoute(parseRoute(hash));
  };

  const openChangelog = () => {
    writePref('app.seenVersion', CURRENT_VERSION);
    setSeenVersion(CURRENT_VERSION);
    openOverlay('changelog');
  };

  /*
   * Show a game's rules once, unasked, the first time it is opened -- which is
   * the only moment they are actually wanted. After that the header button is
   * there for anyone who wants them again.
   */
  useEffect(() => {
    if (!route.game) return;
    // Reading them counts however you arrived -- including on someone else's
    // link. Miss this and closing that link just opens them again, forever.
    if (route.overlay === 'help') return writePref(`${route.game}.seenRules`, '1');
    if (route.overlay) return;
    if (readPref(`${route.game}.seenRules`) !== null) return;
    writePref(`${route.game}.seenRules`, '1');
    openOverlay('help', route.game);
  }, [route.game, route.overlay]);

  const meta = route.game ? gameById(route.game) : undefined;
  const shared = {
    soundMode: sound,
    onCycleSound: cycleSound,
    onCycleTheme: cycleTheme,
    version: CURRENT_VERSION,
    unseen: seenVersion !== CURRENT_VERSION,
    onOpenChangelog: openChangelog,
    onHelp: () => openOverlay('help', route.game)
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
      {route.overlay === 'changelog' && <Changelog onClose={closeOverlay} />}
      {route.overlay === 'help' && meta && <Rules game={meta} onClose={closeOverlay} />}
    </>
  );
}
